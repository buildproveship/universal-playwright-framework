// Test classification: unit
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Fails when a tracked file still uses the old npm scope for a package name; history docs and changelogs are exempt, and email addresses are not package names.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// `git grep` (tracked files, exit 1 on no match) is the platform tool for this; no library needed.
const OLD_SCOPE = ["@release", "ready"].join("");

test("no tracked file uses the old npm scope outside history docs", () => {
  const { stdout, status } = spawnSync(
    "git",
    [
      "grep",
      "-lIE",
      "-e",
      `${OLD_SCOPE}[/:]`,
      "--",
      ".",
      ":(exclude,glob)**/CHANGELOG.md",
      ":!docs/history",
      ":!.claude",
    ],
    { encoding: "utf8" },
  );
  assert.equal(status, 1, `old npm scope found in:\n${stdout}`);
});
