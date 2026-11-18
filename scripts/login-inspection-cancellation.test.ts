import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { chromium, type Browser } from "@playwright/test";
import { guardInspectionRequests } from "../src/customer-login/inspection";
import {
  withFreshLoginPage,
  LOGIN_CLEANUP_TIMEOUT_MS,
} from "../src/execution/runtime-login-browser";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import { pauseWorkClock } from "./fixtures/paused-work-clock";

// Capture these before pausing work timers. Restoration also revives pending cleanup deadlines.
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;

test(
  "Given a real held transport drain, pre-deadline cancellation interrupts with native cleanup",
  { timeout: 2 * LOGIN_CLEANUP_TIMEOUT_MS + 500 },
  async () => {
    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    let admitted = false;
    const server = http.createServer((request, response) => {
      if (request.url === "/health") {
        admitted = true;
        markHeld();
        return;
      }
      response.end("<html><body>Owned drain fixture</body></html>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/`;
    const controller = new AbortController();
    let browser: Browser | undefined;
    let watchdogFired = false;
    let drainPending = false;
    let transportIncomplete = false;
    let operation: Promise<void> | undefined;
    const clock = pauseWorkClock();
    const watchdog = nativeSetTimeout(() => {
      watchdogFired = true;
      clock.restoreWork();
      controller.abort();
    }, LOGIN_CLEANUP_TIMEOUT_MS);
    try {
      operation = withFreshLoginPage(
        async (page) => {
          try {
            const policy = await guardInspectionRequests(
              page.context(),
              page,
              url,
            );
            await page.goto(url);
            await page.evaluate(() => {
              void fetch("/health").catch(() => undefined);
            });
            await held;
            let settled = false;
            const stopped = policy.stop(controller.signal);
            void stopped.then(() => {
              settled = true;
            });
            await Promise.resolve();
            assert.equal(settled, false);
            drainPending = true;
            assert.equal(watchdogFired, false);
            clock.restoreWork();
            controller.abort();
            await stopped;
            assert.throws(
              () => {
                policy.assertComplete();
              },
              {
                message: "Inspection transport incomplete",
              },
            );
            transportIncomplete = true;
          } finally {
            clock.restoreWork();
            controller.abort();
          }
        },
        {
          signal: controller.signal,
          timeoutMs: 1000,
          launchBrowser: async (timeout) => {
            assert.equal(timeout, 1000);
            browser = await chromium.launch({ headless: true, timeout });
            return browser;
          },
        },
      );
      await assert.rejects(operation, (error) => {
        const failure = RuntimeLoginFailure.fromUnknown(error);
        assert.equal(failure?.failureClassification, "interrupted");
        assert.notEqual(failure?.cleanupStatus, "not-acquired");
        return true;
      });
      assert.equal(watchdogFired, false, "native preparation watchdog fired");
      assert.equal(admitted, true);
      assert.equal(drainPending, true);
      assert.equal(transportIncomplete, true);
      assert.ok(browser);
      assert.equal(browser.isConnected(), false);
    } finally {
      clock.restoreWork();
      controller.abort();
      if (operation) await operation.catch(() => undefined);
      nativeClearTimeout(watchdog);
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      clock.finish();
    }
  },
);
