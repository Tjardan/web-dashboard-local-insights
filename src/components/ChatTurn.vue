<script setup lang="ts">
import { ref, computed } from "vue";
import { useElementSize } from "@vueuse/core";
import { highlightText } from "@/utils/highlight-text";

// ── Types ─────────────────────────────────────────────────────────────
interface ToolCallInfo {
  toolId: string;
  label: string;
  args: Record<string, unknown> | null;
  result?: string;
}

interface ConversationTurn {
  turnIndex: number;
  timestamp: string;
  userMessage: string;
  aiResponse: string;
  modelId: string;
  toolCalls: ToolCallInfo[];
}

interface TodoItem {
  id: number;
  title: string;
  status: "not-started" | "in-progress" | "completed";
}

interface TextSegment {
  type: "text" | "code" | "thinking";
  content: string;
  lang?: string;
  label?: string;
}

interface KvEntry {
  key: string;
  value: unknown;
  fieldType: "command" | "long" | "bool" | "simple" | "object";
}

// ── Props & state ─────────────────────────────────────────────────────
const props = defineProps<{
  turn: ConversationTurn;
  initiallyExpanded?: boolean;
  searchQuery?: string;
}>();

const expandedTools = ref(new Set<number>());
const expandedThinking = ref(new Set<number>());
const responseExpanded = ref(false);
const copiedKey = ref<string | null>(null);
const turnCollapsed = ref(!props.initiallyExpanded);

const rootEl = ref<HTMLElement | null>(null);
const { width: containerWidth } = useElementSize(rootEl);
// ~0.65 chars/px gives ~8 readable lines across any content width; min 300
const RESPONSE_TRUNCATE = computed(() =>
  Math.max(300, Math.floor(containerWidth.value * 0.65)),
);

// ── Actions ───────────────────────────────────────────────────────────
function toggleTool(idx: number) {
  if (expandedTools.value.has(idx)) {
    expandedTools.value.delete(idx);
  } else {
    expandedTools.value.add(idx);
  }
  expandedTools.value = new Set(expandedTools.value);
}

async function copyText(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    setTimeout(() => {
      copiedKey.value = null;
    }, 1800);
  } catch {
    // clipboard unavailable in insecure context
  }
}

// ── Display helpers ────────────────────────────────────────────────────
function formatTime(ts: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortModelId(id: string): string {
  if (!id) return "";
  return id.split("/").pop() ?? id;
}

function argPreview(
  toolId: string,
  args: Record<string, unknown> | null,
): string {
  if (!args) return "";
  const name = toolId.toLowerCase();
  const val =
    args["command"] ??
    args["code"] ??
    args["input"] ??
    (name.includes("read") || name.includes("view") || name.includes("file")
      ? (args["path"] ?? args["file"] ?? args["url"] ?? args["files"])
      : null) ??
    (name.includes("navigate") || name.includes("open") ? args["url"] : null) ??
    (name.includes("edit") || name.includes("write") ? args["path"] : null) ??
    args["path"] ??
    args["url"] ??
    args["query"] ??
    args["pattern"] ??
    args["text"] ??
    args["files"] ??
    Object.values(args)[0] ??
    "";
  const s = Array.isArray(val) ? val.join(", ") : String(val);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

// ── Text segment parsing ──────────────────────────────────────────────
const THINKING_RE = /<(thinking|reflection|reasoning)>([\s\S]*?)<\/\1>/gi;
const CODE_RE = /```([^\s`]*)\n([\s\S]*?)```/g;

function parseSegments(text: string): TextSegment[] {
  // Build a combined list of all special ranges (thinking + code blocks)
  type Range = { start: number; end: number; seg: TextSegment };
  const ranges: Range[] = [];

  let m: RegExpExecArray | null;

  THINKING_RE.lastIndex = 0;
  while ((m = THINKING_RE.exec(text)) !== null) {
    ranges.push({
      start: m.index,
      end: m.index + m[0].length,
      seg: { type: "thinking", label: m[1].toLowerCase(), content: m[2] },
    });
  }

  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(text)) !== null) {
    ranges.push({
      start: m.index,
      end: m.index + m[0].length,
      seg: {
        type: "code",
        lang: m[1] || undefined,
        content: m[2].replace(/\n$/, ""),
      },
    });
  }

  // Catch unclosed thinking/reflection/reasoning tags (text truncated before closing tag)
  const OPEN_TAG_RE = /<(thinking|reflection|reasoning)>/gi;
  let ot: RegExpExecArray | null;
  OPEN_TAG_RE.lastIndex = 0;
  while ((ot = OPEN_TAG_RE.exec(text)) !== null) {
    const pos = ot.index;
    if (!ranges.some((r) => r.start <= pos && pos < r.end)) {
      ranges.push({
        start: pos,
        end: text.length,
        seg: {
          type: "thinking",
          label: ot[1].toLowerCase(),
          content: text.slice(pos + ot[0].length),
        },
      });
    }
  }

  // Sort by position
  ranges.sort((a, b) => a.start - b.start);

  const segments: TextSegment[] = [];
  let last = 0;
  for (const r of ranges) {
    if (r.start < last) continue; // skip overlapping
    if (r.start > last)
      segments.push({ type: "text", content: text.slice(last, r.start) });
    segments.push(r.seg);
    last = r.end;
  }
  if (last < text.length)
    segments.push({ type: "text", content: text.slice(last) });

  return segments.filter(
    (s) => s.type !== "text" || s.content.trim().length > 0,
  );
}

function thinkingPreview(content: string): string {
  const firstLine = content.trimStart().split("\n")[0].trim();
  // allow ~0.45 chars/px of available width so there's room for label/icon; min 80
  const limit = Math.max(80, Math.floor(containerWidth.value * 0.45));
  return firstLine.length > limit ? firstLine.slice(0, limit) + "…" : firstLine;
}

function textToParagraphs(text: string): string[][] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.split("\n"))
    .filter((lines) => lines.some((l) => l.trim().length > 0));
}

function userMsgPreview(msg: string): string {
  const line = msg.trimStart().split("\n")[0];
  return line.length > 80 ? line.slice(0, 80) + "…" : line;
}

const isTruncated = (text: string) => text.length > RESPONSE_TRUNCATE.value;

const displayText = computed(() => {
  const t = props.turn.aiResponse;
  if (responseExpanded.value || !isTruncated(t)) return t;
  return t.slice(0, RESPONSE_TRUNCATE.value) + "…";
});

const displaySegments = computed(() => parseSegments(displayText.value));

// ── Args rendering ────────────────────────────────────────────────────
type ArgsMode = "todo" | "search" | "kv";

function getArgsMode(_toolId: string, args: Record<string, unknown>): ArgsMode {
  if ("todoList" in args && Array.isArray(args["todoList"])) return "todo";
  if ("pattern" in args || "isRegexp" in args) return "search";
  return "kv";
}

function getTodoItems(args: Record<string, unknown>): TodoItem[] {
  return (args["todoList"] ?? []) as TodoItem[];
}

const COMMAND_KEYS = new Set(["command", "code", "script"]);

function getKvEntries(args: Record<string, unknown>): KvEntry[] {
  return Object.entries(args).map(([key, value]) => {
    let fieldType: KvEntry["fieldType"] = "simple";
    if (typeof value === "boolean") {
      fieldType = "bool";
    } else if (COMMAND_KEYS.has(key)) {
      fieldType = "command";
    } else if (
      typeof value === "string" &&
      (value.includes("\n") || value.length > 100)
    ) {
      fieldType = "long";
    } else if (typeof value === "object" && value !== null) {
      fieldType = "object";
    }
    return { key, value, fieldType };
  });
}

const SEARCH_KEY_ORDER = [
  "pattern",
  "query",
  "isRegexp",
  "includePattern",
  "includeIgnoredFiles",
  "maxResults",
  "limit",
];

function getSearchEntries(args: Record<string, unknown>): KvEntry[] {
  const entries = getKvEntries(args);
  entries.sort((a, b) => {
    const ai = SEARCH_KEY_ORDER.indexOf(a.key);
    const bi = SEARCH_KEY_ORDER.indexOf(b.key);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return entries;
}

function formatSimple(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value, null, 2);
}

// ── Search highlighting helpers ─────────────────────────────────────
function hlText(text: string): string {
  return props.searchQuery?.trim()
    ? highlightText(text, props.searchQuery)
    : text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render a paragraph (array of lines) as safe HTML with highlights and <br> separators. */
function hlPara(lines: string[]): string {
  const joined = lines.join("\n");
  const escaped = props.searchQuery?.trim()
    ? highlightText(joined, props.searchQuery)
    : joined.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br>");
}

</script>

<template>
  <div class="chat-turn" ref="rootEl">
    <!-- Turn header (click to collapse/expand) -->
    <button
      class="chat-turn__header"
      @click.stop="turnCollapsed = !turnCollapsed"
    >
      <div class="chat-turn__meta">
        <span class="chat-turn__num">turn {{ turn.turnIndex + 1 }}</span>
        <span v-if="turn.modelId" class="chat-turn__model">{{
          shortModelId(turn.modelId)
        }}</span>
        <span
          v-if="turnCollapsed && turn.userMessage"
          class="chat-turn__preview"
          v-html="hlText(userMsgPreview(turn.userMessage))"
        />
      </div>
      <div class="chat-turn__actions">
        <span v-if="turn.timestamp" class="chat-turn__time">{{
          formatTime(turn.timestamp)
        }}</span>
        <span
          class="chat-turn__chevron"
          :class="{ 'chat-turn__chevron--collapsed': turnCollapsed }"
        >
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </div>
    </button>

    <Transition name="turn-expand">
      <div v-if="!turnCollapsed" class="chat-turn__body">
        <!-- User message -->
        <div class="chat-block chat-block--user">
          <span class="chat-block__role">user</span>
          <p class="chat-block__text" v-html="hlText(turn.userMessage || '—')" />
        </div>

        <!-- Tool calls -->
        <div v-if="(turn.toolCalls ?? []).length > 0" class="tool-calls">
          <div
            v-for="(tool, idx) in turn.toolCalls"
            :key="idx"
            class="tool-call"
          >
            <div class="tool-call__row">
              <span class="tool-call__chip">
                <span class="tool-call__icon">⚙</span>
                <span class="tool-call__label">{{ tool.label }}</span>
              </span>
              <span
                v-if="argPreview(tool.toolId, tool.args)"
                class="tool-call__preview"
              >
                {{ argPreview(tool.toolId, tool.args) }}
              </span>
              <button
                v-if="tool.args || tool.result"
                class="tool-call__toggle"
                :title="
                  expandedTools.has(idx)
                    ? 'Details verbergen'
                    : 'Details weergeven'
                "
                @click.stop="toggleTool(idx)"
              >
                <span class="tool-call__toggle-icon">{{
                  expandedTools.has(idx) ? "⊟" : "⊞"
                }}</span>
                {{ expandedTools.has(idx) ? "verberg" : "details" }}
              </button>
            </div>

            <template v-if="expandedTools.has(idx)">
              <!-- ── Todo list ── -->
              <div
                v-if="
                  tool.args && getArgsMode(tool.toolId, tool.args) === 'todo'
                "
                class="args-todo"
              >
                <div
                  v-for="item in getTodoItems(tool.args)"
                  :key="item.id"
                  class="args-todo__item"
                  :class="`args-todo__item--${item.status}`"
                >
                  <span class="args-todo__icon">{{
                    item.status === "completed"
                      ? "✓"
                      : item.status === "in-progress"
                        ? "◉"
                        : "○"
                  }}</span>
                  <span class="args-todo__title">{{ item.title }}</span>
                  <span class="args-todo__badge">{{
                    item.status.replace(/-/g, "\u2011")
                  }}</span>
                </div>
              </div>

              <!-- ── Search / regex ── -->
              <div
                v-else-if="
                  tool.args && getArgsMode(tool.toolId, tool.args) === 'search'
                "
                class="args-search"
              >
                <template
                  v-for="entry in getSearchEntries(tool.args)"
                  :key="entry.key"
                >
                  <!-- Pattern / query get the regex treatment -->
                  <div
                    v-if="entry.key === 'pattern' || entry.key === 'query'"
                    class="args-search__pattern-row"
                  >
                    <span class="args-search__slash">/</span>
                    <code class="args-search__regex">{{ entry.value }}</code>
                    <span class="args-search__slash">/</span>
                    <button
                      class="copy-btn"
                      @click.stop="copyText(String(entry.value), `re-${idx}`)"
                    >
                      {{ copiedKey === `re-${idx}` ? "✓" : "⎘ kopieer" }}
                    </button>
                  </div>
                  <!-- Boolean flags -->
                  <div
                    v-else-if="entry.fieldType === 'bool'"
                    class="args-search__meta"
                  >
                    <span class="args-kv__key">{{ entry.key }}</span>
                    <span
                      class="args-kv__bool"
                      :class="
                        entry.value
                          ? 'args-kv__bool--true'
                          : 'args-kv__bool--false'
                      "
                      >{{ entry.value }}</span
                    >
                  </div>
                  <!-- Other meta (skip nullish) -->
                  <div
                    v-else-if="
                      entry.value !== undefined &&
                      entry.value !== null &&
                      String(entry.value) !== 'undefined'
                    "
                    class="args-search__meta"
                  >
                    <span class="args-kv__key">{{ entry.key }}</span>
                    <code class="args-kv__simple">{{ entry.value }}</code>
                  </div>
                </template>
              </div>

              <!-- ── Generic KV ── -->
              <div v-else-if="tool.args" class="args-kv">
                <div
                  v-for="entry in getKvEntries(tool.args)"
                  :key="entry.key"
                  class="args-kv__row"
                >
                  <span class="args-kv__key">{{ entry.key }}</span>
                  <div class="args-kv__val-wrap">
                    <!-- terminal command -->
                    <template v-if="entry.fieldType === 'command'">
                      <div class="args-kv__cmd">
                        <span class="args-kv__cmd-prompt">$</span>
                        <code class="args-kv__cmd-text">{{ entry.value }}</code>
                      </div>
                      <button
                        class="copy-btn"
                        @click.stop="
                          copyText(
                            String(entry.value),
                            `cmd-${idx}-${entry.key}`,
                          )
                        "
                      >
                        {{
                          copiedKey === `cmd-${idx}-${entry.key}` ? "✓" : "⎘"
                        }}
                      </button>
                    </template>
                    <!-- long / multiline text -->
                    <template v-else-if="entry.fieldType === 'long'">
                      <pre class="args-kv__long">{{ entry.value }}</pre>
                      <button
                        class="copy-btn copy-btn--sm"
                        @click.stop="
                          copyText(
                            String(entry.value),
                            `long-${idx}-${entry.key}`,
                          )
                        "
                      >
                        {{
                          copiedKey === `long-${idx}-${entry.key}` ? "✓" : "⎘"
                        }}
                      </button>
                    </template>
                    <!-- boolean -->
                    <template v-else-if="entry.fieldType === 'bool'">
                      <span
                        class="args-kv__bool"
                        :class="
                          entry.value
                            ? 'args-kv__bool--true'
                            : 'args-kv__bool--false'
                        "
                        >{{ entry.value }}</span
                      >
                    </template>
                    <!-- object / array -->
                    <template v-else-if="entry.fieldType === 'object'">
                      <pre class="args-kv__long">{{
                        formatSimple(entry.value)
                      }}</pre>
                    </template>
                    <!-- simple string / number -->
                    <template v-else>
                      <code class="args-kv__simple">{{
                        formatSimple(entry.value)
                      }}</code>
                      <button
                        v-if="typeof entry.value === 'string'"
                        class="copy-btn copy-btn--sm"
                        @click.stop="
                          copyText(
                            String(entry.value),
                            `kv-${idx}-${entry.key}`,
                          )
                        "
                      >
                        {{ copiedKey === `kv-${idx}-${entry.key}` ? "✓" : "⎘" }}
                      </button>
                    </template>
                  </div>
                </div>
              </div>

              <!-- Tool result -->
              <div v-if="tool.result" class="tool-result">
                <div class="tool-result__bar">
                  <span class="tool-result__label">result</span>
                  <button
                    class="copy-btn copy-btn--sm"
                    @click.stop="copyText(tool.result, `res-${idx}`)"
                  >
                    {{ copiedKey === `res-${idx}` ? "✓" : "⎘" }}
                  </button>
                </div>
                <div class="tool-result__body">{{ tool.result }}</div>
              </div>
            </template>
          </div>
        </div>

        <!-- AI response -->
        <div v-if="turn.aiResponse" class="chat-block chat-block--copilot">
          <div class="chat-block__role-row">
            <span class="chat-block__role">copilot</span>
            <button
              class="copy-btn copy-btn--sm"
              @click.stop="copyText(turn.aiResponse, `resp-${turn.turnIndex}`)"
            >
              {{
                copiedKey === `resp-${turn.turnIndex}`
                  ? "✓ gekopieerd"
                  : "⎘ kopieer"
              }}
            </button>
          </div>
          <div class="chat-block__body">
            <template v-for="(seg, si) in displaySegments" :key="si">
              <div v-if="seg.type === 'thinking'" class="thinking-block">
                <button
                  class="thinking-block__bar"
                  :class="{ 'thinking-block__bar--expanded': expandedThinking.has(si) }"
                  @click.stop="
                    expandedThinking.has(si)
                      ? (expandedThinking.delete(si),
                        (expandedThinking = new Set(expandedThinking)))
                      : (expandedThinking.add(si),
                        (expandedThinking = new Set(expandedThinking)))
                  "
                >
                  <svg
                    class="thinking-block__chevron"
                    :class="{ 'thinking-block__chevron--up': expandedThinking.has(si) }"
                    width="11" height="7"
                    viewBox="0 0 11 7"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M1 1L5.5 6L10 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <span class="thinking-block__label">{{
                    seg.label ?? "thinking"
                  }}</span>
                  <span
                    v-if="!expandedThinking.has(si)"
                    class="thinking-block__preview"
                  >
                    {{ thinkingPreview(seg.content) }}&hellip;
                  </span>
                  <span v-else class="thinking-block__collapse-hint">Inklappen</span>
                </button>
                <div
                  v-if="expandedThinking.has(si)"
                  class="thinking-block__body"
                >
                  {{ seg.content }}
                </div>
              </div>
              <div v-else-if="seg.type === 'text'" class="chat-text">
                <p
                  v-for="(para, pi) in textToParagraphs(seg.content)"
                  :key="pi"
                  class="chat-para"
                  v-html="hlPara(para)"
                />
              </div>
              <div v-else class="code-block">
                <div class="code-block__bar">
                  <span class="code-block__lang">{{ seg.lang || "code" }}</span>
                  <button
                    class="copy-btn"
                    @click.stop="
                      copyText(seg.content, `code-${turn.turnIndex}-${si}`)
                    "
                  >
                    {{
                      copiedKey === `code-${turn.turnIndex}-${si}`
                        ? "✓ gekopieerd"
                        : "⎘ kopieer"
                    }}
                  </button>
                </div>
                <pre
                  class="code-block__pre"
                ><code>{{ seg.content }}</code></pre>
              </div>
            </template>
          </div>
          <button
            v-if="isTruncated(turn.aiResponse)"
            class="chat-block__expand"
            :class="{ 'chat-block__expand--expanded': responseExpanded }"
            @click.stop="responseExpanded = !responseExpanded"
          >
            <svg
              class="chat-block__expand-icon"
              :class="{ 'chat-block__expand-icon--up': responseExpanded }"
              width="12"
              height="8"
              viewBox="0 0 12 8"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 1L6 7L11 1"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ responseExpanded ? "toon minder" : "toon volledig" }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Turn wrapper ── */
.chat-turn {
  position: relative;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

/* Vertical gradient line on the left */
.chat-turn::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.4rem;
  bottom: 0.4rem;
  width: 2px;
  background: linear-gradient(
    to bottom,
    var(--neon-magenta) 0%,
    rgba(139, 92, 246, 0.7) 50%,
    var(--neon-cyan) 100%
  );
  border-radius: 1px;
  opacity: 0.55;
}

/* ── Turn header ── */
.chat-turn__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.15rem;
  width: calc(100% + 0.6rem);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 0.35rem 0.55rem;
  margin-left: -0.3rem;
  cursor: pointer;
  text-align: left;
  border-radius: 5px;
  color: inherit;
  font: inherit;
  transition: background 0.15s, border-color 0.2s;
}

.chat-turn__header:hover {
  background: rgba(0, 240, 255, 0.06);
  border-color: rgba(0, 240, 255, 0.22);
}

.chat-turn__header:hover .chat-turn__chevron {
  color: var(--neon-cyan);
}

.chat-turn__meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.chat-turn__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.chat-turn__body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.chat-turn__num {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.chat-turn__model {
  font-size: 0.72rem;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  color: var(--neon-purple);
  padding: 0.1rem 0.4rem;
  border: 1px solid rgba(139, 92, 246, 0.45);
  border-radius: 4px;
  background: rgba(139, 92, 246, 0.1);
}

.chat-turn__time {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.chat-turn__preview {
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.chat-turn__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.3rem;
  height: 1.3rem;
  flex-shrink: 0;
  color: rgba(0, 240, 255, 0.5);
  transition:
    transform 0.2s var(--ease-out-expo),
    color 0.15s;
  transform: rotate(0deg);
}

.chat-turn__chevron--collapsed {
  transform: rotate(-90deg);
  color: var(--text-secondary);
}

/* ── Turn expand transition ── */
.turn-expand-enter-active,
.turn-expand-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.3s var(--ease-out-expo);
}

.turn-expand-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.turn-expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ── Message blocks ── */
.chat-block {
  border-radius: 0 var(--radius) var(--radius) 0;
  padding: 0.6rem 0.8rem;
  border-left: 2px solid transparent;
}

.chat-block--user {
  background: rgba(255, 0, 170, 0.08);
  border-left-color: var(--neon-magenta);
}

.chat-block--copilot {
  background: rgba(0, 240, 255, 0.07);
  border-left-color: var(--neon-cyan);
}

.chat-block__role-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.chat-block__role {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.chat-block--user .chat-block__role {
  color: rgba(255, 0, 170, 0.9);
}

.chat-block--copilot .chat-block__role {
  color: rgba(0, 240, 255, 0.75);
}

/* User message keeps simple pre-wrap */
.chat-block__text {
  font-size: 0.88rem;
  line-height: 1.65;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 0;
}

/* Copilot body: column of text-segments + code-blocks */
.chat-block__body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.chat-text {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.chat-para {
  font-size: 0.88rem;
  line-height: 1.7;
  color: var(--text-primary);
  overflow-wrap: break-word;
  word-break: break-word;
  margin: 0;
}

.chat-block__expand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: calc(100% + 1.6rem);
  margin: 0.5rem -0.8rem -0.6rem;
  padding: 0.45rem 0.8rem;
  background: rgba(0, 240, 255, 0.04);
  border: none;
  border-top: 1px solid rgba(0, 240, 255, 0.1);
  border-radius: 0 0 var(--radius, 8px) var(--radius, 8px);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
  transition: background 0.2s, color 0.2s, border-top-color 0.2s;
}

.chat-block__expand:hover,
.chat-block__expand--expanded {
  background: rgba(0, 240, 255, 0.09);
  border-top-color: rgba(0, 240, 255, 0.28);
  color: var(--neon-cyan);
}

.chat-block__expand-icon {
  flex-shrink: 0;
  transition: transform 0.25s var(--ease-out-expo, cubic-bezier(0.33, 1, 0.68, 1));
}

.chat-block__expand-icon--up {
  transform: rotate(180deg);
}

/* ── Copy button ── */
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.18rem 0.55rem;
  background: rgba(0, 240, 255, 0.07);
  border: 1px solid rgba(0, 240, 255, 0.22);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.72rem;
  color: rgba(0, 240, 255, 0.8);
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}

.copy-btn:hover {
  background: rgba(0, 240, 255, 0.14);
  border-color: rgba(0, 240, 255, 0.5);
  color: var(--neon-cyan);
}

.copy-btn--sm {
  padding: 0.12rem 0.35rem;
  font-size: 0.68rem;
}

/* ── Code blocks ── */
.code-block {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 240, 255, 0.18);
  background: rgba(0, 8, 20, 0.7);
}

.code-block__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.28rem 0.75rem;
  background: rgba(0, 240, 255, 0.05);
  border-bottom: 1px solid rgba(0, 240, 255, 0.1);
}

.code-block__lang {
  font-size: 0.68rem;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  color: rgba(0, 240, 255, 0.55);
  text-transform: lowercase;
  letter-spacing: 0.04em;
}

.code-block__pre {
  margin: 0;
  padding: 0.7rem 0.9rem;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  font-size: 0.81rem;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre;
  overflow-x: auto;
  max-height: 420px;
  overflow-y: auto;
}

/* ── Tool calls ── */
.tool-calls {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 0.1rem;
}

.tool-call {
  border-left: 2px solid rgba(139, 92, 246, 0.55);
  padding-left: 0.6rem;
}

.tool-call__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tool-call__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid rgba(139, 92, 246, 0.55);
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.12);
  font-size: 0.78rem;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  color: var(--neon-purple);
  white-space: nowrap;
}

.tool-call__icon {
  opacity: 0.85;
}

.tool-call__preview {
  font-size: 0.78rem;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.tool-call__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--neon-purple);
  padding: 0.15rem 0.5rem;
  transition:
    background 0.15s,
    border-color 0.15s;
  margin-left: auto;
  white-space: nowrap;
}

.tool-call__toggle:hover {
  background: rgba(139, 92, 246, 0.22);
  border-color: rgba(139, 92, 246, 0.65);
}

.tool-call__toggle-icon {
  font-size: 0.9rem;
  line-height: 1;
  opacity: 0.9;
}

/* ── Tool result ── */
.tool-result {
  margin-top: 0.35rem;
  border: 1px solid rgba(0, 240, 255, 0.12);
  border-radius: 6px;
  overflow: hidden;
}

.tool-result__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.65rem;
  background: rgba(0, 240, 255, 0.04);
  border-bottom: 1px solid rgba(0, 240, 255, 0.08);
}

.tool-result__label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(0, 240, 255, 0.5);
}

.tool-result__body {
  padding: 0.5rem 0.75rem;
  font-size: 0.78rem;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  color: var(--text-secondary);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}

/* ── Args: todo list ── */
.args-todo {
  margin-top: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.args-todo__item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.3rem 0.65rem;
  border-radius: 5px;
  font-size: 0.8rem;
  border: 1px solid transparent;
}

.args-todo__item--completed {
  background: rgba(57, 255, 20, 0.05);
  border-color: rgba(57, 255, 20, 0.2);
}

.args-todo__item--in-progress {
  background: rgba(0, 240, 255, 0.06);
  border-color: rgba(0, 240, 255, 0.25);
}

.args-todo__item--not-started {
  background: rgba(255, 255, 255, 0.025);
  border-color: rgba(255, 255, 255, 0.07);
}

.args-todo__icon {
  font-size: 0.85rem;
  width: 1rem;
  flex-shrink: 0;
  text-align: center;
}

.args-todo__item--completed .args-todo__icon {
  color: var(--neon-green);
}
.args-todo__item--in-progress .args-todo__icon {
  color: var(--neon-cyan);
}
.args-todo__item--not-started .args-todo__icon {
  color: var(--text-muted);
}

.args-todo__title {
  flex: 1;
  color: var(--text-primary);
  line-height: 1.4;
}

.args-todo__item--completed .args-todo__title {
  /* text-decoration: line-through; */
  color: var(--text-secondary);
}

.args-todo__item--in-progress .args-todo__title {
  color: var(--neon-cyan);
}

.args-todo__badge {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.08rem 0.38rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.args-todo__item--completed .args-todo__badge {
  background: rgba(57, 255, 20, 0.1);
  color: var(--neon-green);
  border: 1px solid rgba(57, 255, 20, 0.28);
}

.args-todo__item--in-progress .args-todo__badge {
  background: rgba(0, 240, 255, 0.1);
  color: var(--neon-cyan);
  border: 1px solid rgba(0, 240, 255, 0.28);
}

.args-todo__item--not-started .args-todo__badge {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* ── Args: search / regex ── */
.args-search {
  margin-top: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.args-search__pattern-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  background: rgba(255, 150, 0, 0.05);
  border: 1px solid rgba(255, 150, 0, 0.28);
  border-radius: 6px;
}

.args-search__slash {
  color: rgba(255, 150, 0, 0.7);
  font-family: "Cascadia Code", "Fira Code", monospace;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
}

.args-search__regex {
  flex: 1;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  font-size: 0.83rem;
  color: var(--neon-green);
  background: none;
  word-break: break-all;
}

.args-search__meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.78rem;
  padding: 0 0.15rem;
}

/* ── Args: generic KV ── */
.args-kv {
  margin-top: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
}

.args-kv__row {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  align-items: start;
  gap: 0.5rem;
  font-size: 0.78rem;
}

.args-kv__key {
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  color: var(--neon-purple);
  opacity: 0.85;
  padding-top: 0.15rem;
  word-break: break-word;
}

.args-kv__val-wrap {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  min-width: 0;
}

/* Terminal command */
.args-kv__cmd {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.6rem;
  background: rgba(57, 255, 20, 0.05);
  border: 1px solid rgba(57, 255, 20, 0.2);
  border-radius: 5px;
  min-width: 0;
}

.args-kv__cmd-prompt {
  color: rgba(57, 255, 20, 0.6);
  font-family: monospace;
  font-weight: 700;
  flex-shrink: 0;
}

.args-kv__cmd-text {
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  font-size: 0.8rem;
  color: var(--neon-green);
  word-break: break-all;
  background: none;
}

/* Long / multiline text */
.args-kv__long {
  flex: 1;
  margin: 0;
  padding: 0.38rem 0.6rem;
  background: rgba(139, 92, 246, 0.05);
  border: 1px solid rgba(139, 92, 246, 0.15);
  border-radius: 5px;
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-secondary);
  max-height: 160px;
  overflow-y: auto;
  overflow-x: auto;
  white-space: pre;
  min-width: 0;
}

/* Boolean pill */
.args-kv__bool {
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  font-family: "Cascadia Code", "Fira Code", monospace;
  font-size: 0.72rem;
  font-weight: 700;
}

.args-kv__bool--true {
  background: rgba(57, 255, 20, 0.1);
  color: var(--neon-green);
  border: 1px solid rgba(57, 255, 20, 0.3);
}

.args-kv__bool--false {
  background: rgba(255, 0, 170, 0.08);
  color: var(--neon-magenta);
  border: 1px solid rgba(255, 0, 170, 0.25);
}

/* Simple inline value */
.args-kv__simple {
  font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", monospace;
  font-size: 0.8rem;
  color: var(--text-primary);
  word-break: break-word;
  background: none;
  flex: 1;
}

/* ── Thinking blocks ── */
.thinking-block {
  border: 1px dashed rgba(255, 185, 40, 0.35);
  border-radius: 6px;
  background: rgba(255, 185, 40, 0.04);
  overflow: hidden;
}

.thinking-block__bar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.32rem 0.65rem;
  background: rgba(255, 185, 40, 0.06);
  border: none;
  border-bottom: 1px dashed rgba(255, 185, 40, 0.2);
  cursor: pointer;
  text-align: left;
  color: inherit;
  transition: background 0.15s;
}

.thinking-block__bar:hover {
  background: rgba(255, 185, 40, 0.1);
}

.thinking-block__chevron {
  color: rgba(255, 185, 40, 0.9);
  flex-shrink: 0;
  transition: transform 0.22s cubic-bezier(0.33, 1, 0.68, 1);
}

.thinking-block__chevron--up {
  transform: rotate(180deg);
}

.thinking-block__label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(255, 185, 40, 0.9);
  flex-shrink: 0;
}

.thinking-block__collapse-hint {
  margin-left: auto;
  font-size: 0.7rem;
  color: rgba(255, 185, 40, 0.55);
  font-weight: 500;
  letter-spacing: 0.03em;
}

.thinking-block__preview {
  font-size: 0.8rem;
  color: rgba(255, 185, 40, 0.6);
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.thinking-block__body {
  padding: 0.55rem 0.8rem;
  font-size: 0.82rem;
  line-height: 1.65;
  color: rgba(225, 190, 120, 0.95);
  font-style: italic;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 520px;
  overflow-y: auto;
}
</style>
