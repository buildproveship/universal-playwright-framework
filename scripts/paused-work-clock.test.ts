import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "@playwright/test";
import { pauseWorkClock } from "./fixtures/paused-work-clock";
import {
  withFreshLoginPage,
  LOGIN_CLEANUP_TIMEOUT_MS,
} from "../src/execution/runtime-login-browser";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";

test("paused clock restores remaining delay, callback receiver and arguments", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const clock = pauseWorkClock();
  let called = false;
  const handle = setTimeout(
    function (this: unknown, value: string) {
      assert.equal(this, handle);
      assert.equal(value, "fixed");
      called = true;
    },
    100,
    "fixed",
  );
  handle.unref();
  assert.equal(handle.hasRef(), false);
  handle.ref();
  t.mock.timers.tick(40);
  assert.equal(called, false);
  clock.restoreWork();
  t.mock.timers.tick(59);
  assert.equal(called, false);
  t.mock.timers.tick(1);
  assert.equal(called, true);
  clock.finish();
});

test("paused clock cancellation retains ownership after native restoration", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const clock = pauseWorkClock();
  let calls = 0;
  const first = setTimeout(() => calls++, 20);
  const second = setTimeout(() => calls++, 20);
  clearTimeout(first);
  clock.restoreWork();
  clearTimeout(first);
  clearTimeout(second);
  const native = setTimeout(() => calls++, 20);
  clearTimeout(native);
  t.mock.timers.tick(20);
  assert.equal(calls, 0);
  clock.finish();
});

for (const fault of ["capacity", "refresh"] as const) {
  test(`paused clock retains ${fault} failure even when the caller catches it`, () => {
    const originalSet = globalThis.setTimeout;
    const originalClear = globalThis.clearTimeout;
    const originalNow = Date.now;
    const clock = pauseWorkClock();
    const handles: ReturnType<typeof setTimeout>[] = [];
    if (fault === "capacity") {
      for (let index = 0; index < 128; index++)
        handles.push(setTimeout(() => {}, 100));
      assert.throws(() => setTimeout(() => {}, 100));
    } else {
      const handle = setTimeout(() => {}, 100);
      handles.push(handle);
      assert.throws(() => handle.refresh());
    }
    for (const handle of handles) clearTimeout(handle);
    assert.throws(
      () => {
        clock.finish();
      },
      {
        code: "ERR_ASSERTION",
        actual: true,
        expected: false,
        operator: "strictEqual",
      },
    );
    assert.equal(globalThis.setTimeout, originalSet);
    assert.equal(globalThis.clearTimeout, originalClear);
    assert.equal(Date.now, originalNow);
  });
}

test("early context failure cannot leave the cleanup deadline paused", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  const clock = pauseWorkClock();
  let closeStarted!: () => void;
  const closing = new Promise<void>((resolve) => {
    closeStarted = resolve;
  });
  let entered = false;
  let settled = false;
  const browser = {
    newContext: async () => {
      throw new Error("owned context failure");
    },
    close: async () => {
      closeStarted();
      await new Promise<void>(() => {});
    },
  } as unknown as Browser;
  const operation = withFreshLoginPage(
    async () => {
      entered = true;
    },
    {
      timeoutMs: 1000,
      launchBrowser: async () => browser,
    },
  );
  const checked = assert
    .rejects(operation, (error) => {
      assert.ok(error instanceof RuntimeLoginFailure);
      assert.equal(error.cleanupStatus, "unconfirmed");
      assert.equal(error.failureClassification, "timed-out");
      return true;
    })
    .then(() => {
      settled = true;
    });
  try {
    await closing;
    t.mock.timers.tick(1000);
    clock.restoreWork();
    t.mock.timers.tick(LOGIN_CLEANUP_TIMEOUT_MS - 1001);
    await Promise.resolve();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await checked;
    assert.equal(entered, false);
  } finally {
    clock.finish();
  }
});
