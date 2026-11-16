// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Real empty Chromium contexts confirm bounded timeout/cancellation cleanup; no customer pages, credentials or canonical test execution.
import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import { withFreshLoginPage } from "../src/execution/runtime-login-browser";

for (const mode of ["deadline", "cancel"] as const) {
  test(`RR207-CLEANUP-BROWSER-${mode} real browser shutdown is confirmed after interruption`, async () => {
    const controller = new AbortController();
    let entered = false;
    await assert.rejects(
      withFreshLoginPage(
        async () => {
          entered = true;
          if (mode === "cancel") controller.abort();
          await new Promise<void>(() => undefined);
        },
        { timeoutMs: 3000, signal: controller.signal },
      ),
      (error) => {
        assert.ok(error instanceof RuntimeLoginFailure);
        assert.equal(entered, true);
        assert.equal(
          error.failureClassification,
          mode === "deadline" ? "timed-out" : "interrupted",
        );
        assert.equal(error.cleanupStatus, "confirmed");
        return true;
      },
    );
  });
}
