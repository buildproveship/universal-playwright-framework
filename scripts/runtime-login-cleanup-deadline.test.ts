import { fake } from "./fixtures/fake-playwright";
// Test classification: unit
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Drives withFreshLoginPage cleanup-deadline handling with an in-memory browser double and a mocked clock; no real browser or login is exercised.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser } from "@playwright/test";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import {
  LOGIN_CLEANUP_TIMEOUT_MS,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";

const noop = (): void => undefined;

/** Runs `body` with async-function semantics: a synchronous throw becomes a rejection. */
function settle<T>(body: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(body());
  });
}

for (const scenario of [
  { name: "on-time successful", elapsed: 1, rejects: false },
  {
    name: "deadline-boundary successful",
    elapsed: LOGIN_CLEANUP_TIMEOUT_MS,
    rejects: false,
  },
  {
    name: "late successful",
    elapsed: LOGIN_CLEANUP_TIMEOUT_MS + 1,
    rejects: false,
  },
  { name: "on-time failing", elapsed: 1, rejects: true },
  {
    name: "late failing",
    elapsed: LOGIN_CLEANUP_TIMEOUT_MS + 1,
    rejects: true,
  },
]) {
  test(`Given ${scenario.name} closure before timer delivery, enforce the cleanup deadline`, async (context) => {
    let now = 100_000;
    context.mock.method(Date, "now", () => now);
    const events: string[] = [];
    const browser = fake<Browser>({
      newContext: () =>
        Promise.resolve({
          setOffline: (offline: boolean) =>
            settle(() => {
              assert.equal(offline, true);
              events.push("offline-start", "offline-confirmed");
            }),
          close: () => {
            events.push("context-close");
            return Promise.resolve();
          },
          newPage: () =>
            Promise.resolve({
              setDefaultTimeout: noop,
              setDefaultNavigationTimeout: noop,
            }),
        }),
      close: () =>
        settle(() => {
          events.push("browser-close");
          // Advance wall time without yielding to the real deadline timer.
          now += scenario.elapsed;
          if (scenario.rejects) throw new Error("owned close failure");
          events.push("browser-closed");
        }),
    });
    const operation = withFreshLoginPage(() => Promise.resolve(), {
      launchBrowser: () => Promise.resolve(browser),
    });
    const expired = scenario.elapsed >= LOGIN_CLEANUP_TIMEOUT_MS;
    if (expired || scenario.rejects) {
      await assert.rejects(operation, (error) => {
        assert.ok(error instanceof RuntimeLoginFailure);
        assert.equal(error.failureStage, "cleanup");
        assert.equal(error.cleanupStatus, "unconfirmed");
        assert.equal(
          error.failureClassification,
          expired ? "timed-out" : "operational",
        );
        assert.ok(!error.message.includes("owned close failure"));
        return true;
      });
    } else {
      await operation;
    }
    assert.deepEqual(events, [
      "offline-start",
      "offline-confirmed",
      "context-close",
      "browser-close",
      ...(scenario.rejects ? [] : ["browser-closed"]),
    ]);
  });
}
