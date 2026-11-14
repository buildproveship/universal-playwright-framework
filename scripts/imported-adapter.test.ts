/**
 * Test classification: integration
 * Review status: Not Reviewed
 * Evidence: synthetic
 * Scope: Fixed synthetic authority, actual isolated browser/HTTP lifecycle and fail-closed imported adapter; no genuine case approval or product execution.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  getImportedImplementationReview,
  IMPORTED_IMPLEMENTATION_REVISION,
} from "../src/adapter/imported-v1";
const exec = promisify(execFile);
const cases = [
  ["pass", "passed", 1],
  ["fail", "failed", 1],
  ["hook-failure", "incomplete", 1],
  ["foreign", "incomplete", 1],
  ["route-override", "incomplete", 1],
  ["wrong-case", "incomplete", 1],
  ["extra-case", "incomplete", 1],
  ["bad-count", "incomplete", 1],
  ["cancel", "cancelled", 1],
  ["revoked", "INVALID_CONTEXT", 0],
  ["expired", "INVALID_CONTEXT", 0],
  ["unknown-artifact", "UNAVAILABLE", 0],
  ["missing-data", "INVALID_REQUEST", 0],
  ["stale-runtime", "STALE_REVIEW", 0],
  ["revoke-before-acquire", "INVALID_CONTEXT", 0],
  ["tamper-before-acquire", "INVALID_CONTEXT", 0],
  ["tamper-before-load", "incomplete", 1],
  ["late-admission", "INVALID_CONTEXT", 0],
] as const;
test("installed imported implementation must have an explicit current code review before synthetic admission tests", () => {
  assert.equal(
    getImportedImplementationReview(),
    IMPORTED_IMPLEMENTATION_REVISION,
  );
});
for (const [scenario, expected, count] of cases)
  test(`imported ${scenario} preserves authority, correspondence and owned cleanup`, async () => {
    const { stdout } = await exec(
      process.execPath,
      [path.join(__dirname, "imported-adapter-fixture.js"), scenario],
      {
        timeout: 30000,
        maxBuffer: 200000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        },
      },
    );
    const actual = JSON.parse(stdout);
    assert.equal(actual.acquired, count);
    assert.equal(
      actual.result.accepted ? actual.result.status : actual.result.code,
      expected,
    );
    assert.equal(actual.foreignRequests, 0);
    assert.equal(actual.valid, scenario !== "missing-data");
    assert.equal(actual.wrongCaseAccepted, false);
    assert.equal(actual.unknownCleanupPassAccepted, false);
    if (count) {
      if (scenario === "cancel") {
        assert.ok(actual.closeEvents.includes("browser-closed"));
        assert.equal(
          actual.result.cleanup,
          actual.closeEvents.includes("context-close-rejected")
            ? "unknown"
            : "confirmed",
        );
      } else assert.equal(actual.result.cleanup, "confirmed");
      assert.equal(actual.second.code, "UNAVAILABLE");
    } else assert.equal(actual.runnerCalls, 0);
    if (scenario === "tamper-before-load") assert.equal(actual.runnerCalls, 0);
  });
