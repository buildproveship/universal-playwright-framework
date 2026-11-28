// Test classification: unit
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Checks the After-scenario restore hook and its settings with a fake restorer; no real app, Mailpit or browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readRestoreSettings,
  restoreAfterScenario,
} from "../src/test-data-restore/v1";

test("the hook restores once per call and a failed restore fails the scenario", async () => {
  let calls = 0;
  await restoreAfterScenario({
    restorer: {
      restoreAll: () => {
        calls += 1;
        return Promise.resolve();
      },
    },
  })();
  assert.equal(calls, 1);

  const seen: unknown[] = [];
  await assert.rejects(
    restoreAfterScenario({
      restorer: {
        restoreAll: () => Promise.reject(new Error("boom")),
      },
      onFailure: (e) => seen.push(e),
    })(),
    /restore failed/,
  );
  assert.equal(seen.length, 1);
});

test("settings: complete env is read, missing values throw, off works only outside CI", () => {
  const ok = {
    BPS_ENVIRONMENT: "dev",
    BPS_RESTORE_URL: "http://x",
    BPS_RESTORE_TOKEN: "t",
  };
  assert.equal(readRestoreSettings(ok)?.baseUrl, "http://x");
  assert.throws(() => readRestoreSettings({}));
  assert.equal(readRestoreSettings({ BPS_TEST_DATA_RESTORE: "off" }), undefined);
  assert.throws(() =>
    readRestoreSettings({ BPS_TEST_DATA_RESTORE: "off", CI: "true" }),
  );
});
