import assert from "node:assert/strict";

/** Test-only clock: pause work callbacks, then restore their real remaining time. */
export function pauseWorkClock() {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const nativeNow = Date.now;
  interface Timer {
    callback: (...args: unknown[]) => void;
    args: unknown[];
    due: number;
    referenced: boolean;
    native?: ReturnType<typeof setTimeout>;
  }
  const owned = new Map<object, Timer>();
  const known = new WeakSet();
  const now = nativeNow();
  let allocated = 0;
  let failed = false;
  let paused = true;
  const allocate = (callback: unknown, delay = 1, ...args: unknown[]) => {
    if (typeof callback !== "function" || ++allocated > 128) {
      failed = true;
      throw new Error("Invalid virtual timer allocation");
    }
    // Node normalizes unsupported/zero/sub-millisecond delays to one millisecond.
    const normalized =
      Number.isFinite(delay) && delay >= 1 && delay <= 2147483647
        ? Math.trunc(delay)
        : 1;
    const timer: Timer = {
      callback: callback as (...values: unknown[]) => void,
      args,
      due: nativeNow() + normalized,
      referenced: true,
    };
    const handle = {
      ref() {
        timer.referenced = true;
        timer.native?.ref?.();
        return this;
      },
      unref() {
        timer.referenced = false;
        timer.native?.unref?.();
        return this;
      },
      hasRef() {
        return timer.referenced;
      },
      refresh() {
        failed = true;
        throw new Error("Unsupported virtual timer refresh");
      },
    };
    owned.set(handle, timer);
    known.add(handle);
    return handle;
  };
  Object.defineProperty(globalThis, "setTimeout", { value: allocate });
  Object.defineProperty(globalThis, "clearTimeout", {
    value: (handle: Parameters<typeof clearTimeout>[0]) => {
      if (handle && typeof handle === "object" && known.has(handle)) {
        const timer = owned.get(handle);
        nativeClearTimeout(timer?.native);
        owned.delete(handle);
      } else {
        nativeClearTimeout(handle);
      }
    },
  });
  Date.now = () => now;
  const restoreWork = () => {
    if (paused) {
      Date.now = nativeNow;
      globalThis.setTimeout = nativeSetTimeout;
      paused = false;
      for (const [handle, timer] of owned) {
        timer.native = nativeSetTimeout(
          () => {
            owned.delete(handle);
            timer.callback.apply(handle, timer.args);
          },
          Math.max(0, timer.due - nativeNow()),
        );
        if (!timer.referenced) timer.native.unref?.();
      }
    }
  };
  return {
    restoreWork,
    finish() {
      restoreWork();
      globalThis.clearTimeout = nativeClearTimeout;
      assert.equal(failed, false, "virtual clock failure");
      assert.equal(owned.size, 0, "outstanding virtual timers");
    },
  };
}
