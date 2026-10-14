import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)));

describe("daemon module", () => {
  /**
   * Regression guard. The CLI bootstrap used to live in daemon.ts behind an
   * `import.meta.url === argv[1]` check. Once the server was bundled into a
   * single file that check became true for the *server's* entry point, so the
   * packaged extension ran a second reveal loop. Keeping daemon.ts free of
   * top-level side effects is what prevents that, so assert it directly.
   */
  it("has no top-level side effects that could fire when bundled", () => {
    const source = readFileSync(resolve(SRC, "daemon.ts"), "utf8");
    assert.equal(/^\s*if\s*\(\s*isMainModule/m.test(source), false, "daemon.ts must not self-execute");
    assert.equal(/^\s*(revealPendingLocalCommits|watchPendingLocalCommits)\s*\(/m.test(source), false);
  });

  it("exposes both the one-shot sweep and the watch loop", () => {
    const source = readFileSync(resolve(SRC, "daemon.ts"), "utf8");
    assert.match(source, /export async function revealPendingLocalCommits/);
    assert.match(source, /export async function watchPendingLocalCommits/);
  });
});
