// Test classification: unit
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Checks cancellation-versus-deadline ordering in withFreshLoginPage using mocked timers and in-memory browser, context and page doubles; no real browser is launched.
import { fake } from "./fixtures/fake-playwright";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser } from "@playwright/test";
import { withFreshLoginPage } from "../src/execution/runtime-login-browser";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
const noop = (): undefined => undefined;
/**
 * Runs `work` synchronously like an async function body: a return resolves
 * the promise and a synchronous throw rejects it.
 */
function settle<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(work());
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function resources(events: string[]) {
  const closed = deferred();
  const page = { setDefaultTimeout: noop, setDefaultNavigationTimeout: noop };
  const context = {
    setOffline: (value: boolean) =>
      settle(() => {
        assert.equal(value, true);
        events.push("offline");
      }),
    newPage: () =>
      settle(() => {
        events.push("page");
        return page;
      }),
    close: () =>
      settle(() => {
        events.push("context-close");
      }),
  };
  const browser = {
    newContext: () =>
      settle(() => {
        events.push("context");
        return context;
      }),
    close: () =>
      settle(() => {
        events.push("browser-close");
        closed.resolve();
      }),
  };
  return { browser: fake<Browser>(browser), closed };
}
test("controlled: drain reached and cancellation wins before the 1000 ms deadline", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const events: string[] = [];
  const controller = new AbortController();
  const { browser } = resources(events);
  let classification: string | undefined;
  let cleanup: string | undefined;
  await assert.rejects(
    withFreshLoginPage(
      async () => {
        events.push("drain-entry");
        t.mock.timers.tick(999);
        events.push("cancel-request");
        controller.abort();
        // Never settles: the drain stays held until cancellation wins.
        await new Promise<void>(noop);
      },
      {
        timeoutMs: 1000,
        signal: controller.signal,
        launchBrowser: (timeout) =>
          settle(() => {
            assert.equal(timeout, 1000);
            events.push("launch");
            return browser;
          }),
      },
    ),
    (error) => {
      assert.ok(error instanceof RuntimeLoginFailure);
      classification = error.failureClassification;
      cleanup = error.cleanupStatus;
      assert.equal(classification, "interrupted");
      assert.equal(cleanup, "confirmed");
      return true;
    },
  );
  assert.deepEqual(events, [
    "launch",
    "context",
    "page",
    "drain-entry",
    "cancel-request",
    "offline",
    "context-close",
    "browser-close",
  ]);
});
test("controlled: acquisition held until the 1000 ms deadline prevents drain cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 200000 });
  const events: string[] = [];
  const launched = deferred();
  let releaseBrowser!: (browser: Browser) => void;
  const release = {
    promise: new Promise<Browser>((resolve) => {
      releaseBrowser = resolve;
    }),
    resolve: (browser: Browser) => {
      releaseBrowser(browser);
    },
  };
  const controller = new AbortController();
  const { browser, closed } = resources(events);
  let classification: string | undefined;
  let cleanup: string | undefined;
  const operation = withFreshLoginPage(
    () =>
      settle(() => {
        events.push("drain-entry");
        events.push("cancel-request");
        controller.abort();
      }),
    {
      timeoutMs: 1000,
      signal: controller.signal,
      launchBrowser: (timeout) => {
        assert.equal(timeout, 1000);
        events.push("launch-pending");
        launched.resolve();
        return release.promise;
      },
    },
  );
  const checked = assert.rejects(operation, (error) => {
    assert.ok(error instanceof RuntimeLoginFailure);
    classification = error.failureClassification;
    cleanup = error.cleanupStatus;
    assert.equal(classification, "timed-out");
    assert.equal(cleanup, "unconfirmed");
    return true;
  });
  try {
    await launched.promise;
    t.mock.timers.tick(1000);
    events.push("deadline-delivered");
    await checked;
    assert.deepEqual(events, ["launch-pending", "deadline-delivered"]);
    assert.equal(controller.signal.aborted, false);
  } finally {
    release.resolve(browser);
    await closed.promise;
  }
  assert.deepEqual(events, [
    "launch-pending",
    "deadline-delivered",
    "browser-close",
  ]);
});
