// Test classification: unit
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Reads the shared step source files and fails if a product brand name or sign-in/sign-up copy appears outside the owned-local-labels defaults module; it does not run a browser.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_OWNED_LOCAL_LABELS } from "../src/execution/owned-local-labels";
import { REPOSITORY_ROOT } from "../src/execution/reviewed-scenarios";

const BRAND_NAMES = /releaseready|buildproveship/i;

/** The shared owned-local steps and their support files; the defaults module is deliberately not among them. */
function sharedStepSources(): string[] {
  const directory = path.join(REPOSITORY_ROOT, "features/execution");
  const found: string[] = [];
  for (const entry of readdirSync(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(path.join(entry.parentPath, entry.name));
    }
  }
  return found;
}

test("Given the shared steps, no product brand name is hard-coded in them", () => {
  const sources = sharedStepSources();
  assert.ok(sources.length > 0);
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      BRAND_NAMES,
      `${path.relative(REPOSITORY_ROOT, file)} hard-codes a product brand name; take it from the labels option`,
    );
  }
});

test("Given the shared steps, the default sign-in copy lives only in the defaults module", () => {
  for (const file of sharedStepSources()) {
    const text = readFileSync(file, "utf8");
    const defaults: string[] = [
      DEFAULT_OWNED_LOCAL_LABELS.registerButton,
      DEFAULT_OWNED_LOCAL_LABELS.registerHeading,
      DEFAULT_OWNED_LOCAL_LABELS.signInHeading,
    ];
    for (const copy of defaults) {
      assert.ok(
        !text.includes(copy),
        `${path.relative(REPOSITORY_ROOT, file)} hard-codes "${copy}"; use resolveOwnedLocalLabels`,
      );
    }
  }
});
