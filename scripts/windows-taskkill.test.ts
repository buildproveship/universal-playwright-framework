import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  resolveWindowsTaskkill,
  terminateWindowsProcessTree,
} from "../src/execution";

const variable = "PLAYWRIGHT_FRAMEWORK_TASKKILL_EXECUTABLE";
const trustedPath = String.raw`D:\Windows\System32\taskkill.exe`;

describe("Windows taskkill deployment trust boundary", () => {
  it("requires an explicit operator path and ignores ambient executable search inputs", () => {
    assert.equal(resolveWindowsTaskkill({}), undefined);
    assert.equal(
      resolveWindowsTaskkill({
        PATH: String.raw`C:\attacker`,
        SystemRoot: String.raw`C:\attacker`,
        WINDIR: String.raw`C:\attacker`,
      }),
      undefined,
    );
    assert.equal(
      resolveWindowsTaskkill({ [variable]: trustedPath }),
      trustedPath,
    );
    const withSpaces = String.raw`E:\Protected Tools\TASKKILL.EXE`;
    assert.equal(
      resolveWindowsTaskkill({ [variable]: withSpaces }),
      withSpaces,
    );
  });

  it("rejects relative, network, device, traversal and ambiguous paths without searching", () => {
    for (const value of [
      "",
      "taskkill.exe",
      String.raw`C:taskkill.exe`,
      String.raw`\Windows\taskkill.exe`,
      String.raw`\\host\share\taskkill.exe`,
      String.raw`\\?\C:\Windows\taskkill.exe`,
      "/usr/bin/taskkill.exe",
      "C:/Windows/taskkill.exe",
      String.raw`C:\Windows\..\taskkill.exe`,
      String.raw`C:\Windows\.\taskkill.exe`,
      String.raw`C:\Windows.\taskkill.exe`,
      String.raw`C:\Windows \taskkill.exe`,
      String.raw`C:\Windows\taskkill.exe:stream`,
      String.raw`C:\Windows\other.exe`,
      trustedPath + "\0",
      '"' + trustedPath + '"',
      trustedPath + " /T",
      String.raw`C:\*\taskkill.exe`,
    ]) {
      assert.equal(
        resolveWindowsTaskkill({ [variable]: value }),
        undefined,
        value,
      );
    }
  });

  for (const outcome of [
    "success",
    "error",
    "timeout",
    "throw",
    "missing",
    "invalid",
  ]) {
    it(`preserves invocation semantics for ${outcome}`, async (context) => {
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { value: "win32" });
      context.after(() => Object.defineProperty(process, "platform", platform));
      const previous = process.env[variable];
      context.after(() => {
        if (previous === undefined) delete process.env[variable];
        else process.env[variable] = previous;
      });
      if (outcome === "missing") delete process.env[variable];
      else
        process.env[variable] =
          outcome === "invalid" ? "taskkill.exe" : trustedPath;
      const invocation = context.mock.method(
        childProcess,
        "execFile",
        (...args: unknown[]) => {
          assert.equal(args[0], trustedPath);
          assert.deepEqual(args[1], ["/PID", "1234", "/T", "/F"]);
          assert.deepEqual(args[2], { timeout: 3_000, windowsHide: true });
          if (outcome === "throw")
            throw new Error("spawn failed synchronously");
          const callback = args[3] as (error: Error | null) => void;
          callback(outcome === "success" ? null : new Error(outcome));
        },
      );
      assert.equal(
        await terminateWindowsProcessTree(1234),
        outcome === "success",
      );
      assert.equal(
        invocation.mock.callCount(),
        ["missing", "invalid"].includes(outcome) ? 0 : 1,
      );
    });
  }

  it("never invokes a Windows executable on a non-Windows host", async (context) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const previous = process.env[variable];
    context.after(() => {
      Object.defineProperty(process, "platform", platform);
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
    });
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env[variable] = trustedPath;
    const invocation = context.mock.method(childProcess, "execFile", () => {
      assert.fail("Non-Windows hosts must not invoke taskkill");
    });
    assert.equal(await terminateWindowsProcessTree(1234), false);
    assert.equal(invocation.mock.callCount(), 0);
  });

  it("guards the existing child-exit check and conservative fallback against recurrence", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/execution/index.ts"),
      "utf8",
    );
    const branch = source.slice(
      source.indexOf('  if (process.platform === "win32")'),
      source.indexOf('  try {\n    process.kill(-pid, "SIGTERM")'),
    );
    assert.equal(
      branch.trim(),
      `if (process.platform === "win32") {
    const treeTerminated = await terminateWindowsProcessTree(pid);
    if (treeTerminated) {
      return waitForChildExit(child, 1_000);
    }
    child.kill("SIGTERM");
    const exited = await waitForChildExit(child, 300);
    if (!exited) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 1_000);
    }
    return false;
  }`,
    );
    assert.doesNotMatch(branch, /execFile\s*\(/);
    const publicBarrel = readFileSync(
      path.join(process.cwd(), "src/index.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      publicBarrel,
      /resolveWindowsTaskkill|terminateWindowsProcessTree/,
    );
    assert.doesNotMatch(
      publicBarrel,
      /export\s+\*\s+from\s+["']\.\/execution["']/,
    );
    const helper = source.slice(
      source.indexOf("const TASKKILL_VARIABLE"),
      source.indexOf("async function terminateOwnedProcess"),
    );
    assert.doesNotMatch(helper, /process\.env\.(PATH|SystemRoot|WINDIR)/i);
    assert.doesNotMatch(helper, /execFile\s*\(\s*["']/);
  });
});
