import type { InsightEntry, SourceType } from "@/types";

export interface EntryGroup {
  id: string;
  source: SourceType;
  entries: InsightEntry[];
  /** Timestamp of the first (newest) entry in the group */
  timestamp: string;
}

export interface DaySection {
  dateKey: string; // "YYYY-MM-DD"
  date: Date;
  label: string; // "Vandaag" | "Gisteren" | "ma 2 mrt"
  relativeLabel: string; // "" | "gisteren" | "3 dagen geleden" | "1 week geleden"
  ageInDays: number;
  weekLabel: string; // "23 februari – 1 maart" when ageInDays >= 7, else ""
  groups: EntryGroup[];
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDaysDiff(date: Date, now: Date): number {
  const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d2 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((d1.getTime() - d2.getTime()) / 86400000);
}

function formatDayLabel(date: Date, days: number): string {
  if (days === 0) return "Vandaag";
  if (days === 1) return "Gisteren";
  return date.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatRelativeLabel(days: number): string {
  if (days === 0) return "";
  if (days === 1) return "gisteren";
  if (days < 7) return `${days} dagen geleden`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week geleden";
  if (weeks < 5) return `${weeks} weken geleden`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 maand geleden";
  return `${months} maanden geleden`;
}

function formatWeekLabel(date: Date): string {
  // Find Monday of the ISO week containing `date`
  const day = date.getDay(); // 0=Sun … 6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + mondayOffset,
  );
  const sunday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6,
  );

  const fmt = (d: Date) =>
    d.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });

  return `${fmt(monday)} – ${fmt(sunday)}`;
}

/** Group consecutive entries that share the same source type */
function groupConsecutive(entries: InsightEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.source === entry.meta.source) {
      last.entries.push(entry);
    } else {
      groups.push({
        id: entry.id,
        source: entry.meta.source,
        entries: [entry],
        timestamp: entry.meta.timestamp,
      });
    }
  }
  return groups;
}

/**
 * Split a sorted (newest-first) entries array into day sections,
 * each containing consecutive same-source groups.
 */
export function buildDaySections(entries: InsightEntry[]): DaySection[] {
  const now = new Date();

  // Bucket entries by local calendar date
  const dayMap = new Map<string, InsightEntry[]>();
  for (const entry of entries) {
    const key = toLocalDateKey(new Date(entry.meta.timestamp));
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(entry);
  }

  // Newest day first
  const sortedKeys = [...dayMap.keys()].sort((a, b) => b.localeCompare(a));

  return sortedKeys.map((key) => {
    const dayEntries = dayMap
      .get(key)!
      .sort(
        (a, b) =>
          new Date(b.meta.timestamp).getTime() -
          new Date(a.meta.timestamp).getTime(),
      );

    // Build date at noon to avoid DST/timezone edge cases
    const [y, mo, d] = key.split("-").map(Number);
    const date = new Date(y, mo - 1, d, 12);
    const ageInDays = getDaysDiff(date, now);

    return {
      dateKey: key,
      date,
      label: formatDayLabel(date, ageInDays),
      relativeLabel: formatRelativeLabel(ageInDays),
      ageInDays,
      weekLabel: ageInDays >= 7 ? formatWeekLabel(date) : "",
      groups: groupConsecutive(dayEntries),
    };
  });
}
