// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Separate installed Playwright assertion code shares the framework's real empty browser without initializing two test runners; no customer execution.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runFixture } from "./fixtures/run-fixture";
test("RR207-PLAYWRIGHT-ISOLATION-001 an independently installed product assertion package uses the borrowed browser", async () => {
  const { stdout } = await runFixture(
    path.join(__dirname, "isolated-product-playwright.fixture.js"),
  );
  assert.deepEqual(JSON.parse(stdout), {
    productAssertionPassed: true,
  });
});
