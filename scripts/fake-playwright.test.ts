// Test classification: unit
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: fake() returns the members it was given and the repo lint rule rejects `as unknown as`; it does not exercise Playwright.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Route } from "@playwright/test";
import { fake } from "./fixtures/fake-playwright";

test("fake returns exactly the members it was given", async () => {
  let aborted = false;
  const route = fake<Route>({
    abort: () => {
      aborted = true;
      return Promise.resolve();
    },
  });
  await route.abort();
  assert.equal(aborted, true);
  assert.equal(Object.keys(route).join(), "abort");
});

test("the repo lint rule rejects a new `as unknown as` cast", () => {
  // Guard for RRDSCRUM-375. The probe lives inside the repo so ESLint applies the real config.
  const root = path.resolve(__dirname, "../../..");
  const directory = mkdtempSync(path.join(root, "scripts", "double-cast-"));
  const probe = path.join(directory, "probe.ts");
  writeFileSync(
    probe,
    "export const value = { a: 1 } as unknown as { b: string };\n",
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/eslint/bin/eslint.js"),
        "--no-warn-ignored",
        "--rule",
        "{}",
        probe,
      ],
      { cwd: root, encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /Do not use `as unknown as`/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
