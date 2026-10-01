import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Test setup for DevPulse.
 *
 * Deliberately narrow: the things worth testing here are the parsers and the
 * ranking, which are pure functions over data that is painful to produce by
 * hand in a browser. `vue-tsc -b` checks that the types line up; it has no
 * opinion about whether a JSONL patch stream replays correctly or whether a
 * cache entry is still valid, and every bug found in this area so far was of
 * that second kind.
 *
 * Tests live next to the code as `*.test.ts`. The environment is Node, because
 * nothing under test touches the DOM — a test that needs one declares it with
 * `// @vitest-environment happy-dom` at the top of the file.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Tests import the package sources, not dist/, so a change is covered
      // before `npm run build:packages` has run.
      "@devpulse/search-shared": fileURLToPath(
        new URL("./packages/search-shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    // The default reporter redraws the whole run; this one appends, which is
    // what you want when the output is read from a log rather than a terminal.
    reporters: process.env["CI"] ? ["default"] : ["dot"],
  },
});
