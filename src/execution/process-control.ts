// Stopping worker process groups and the browser server, on POSIX and Windows.
import { execFile, type ChildProcess } from "node:child_process";
import { type BrowserServer } from "playwright-core";
import path from "node:path";

export interface BrowserStopResult {
  readonly stopped: boolean;
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForGroupExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !groupExists(pid);
}

const TASKKILL_VARIABLE = "PLAYWRIGHT_FRAMEWORK_TASKKILL_EXECUTABLE";

/**
 * @internal Exported for focused regression tests, not the public package API.
 * Deployment trust boundary: the operator must provide a taskkill.exe whose
 * file and parent directories are protected against untrusted modification.
 * Syntax validation does NOT validate ACLs, provenance, or reparse points.
 * Never derive this executable from PATH, SystemRoot, or the working directory.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true;
  }
  return false;
}

export function resolveWindowsTaskkill(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const executable = environment[TASKKILL_VARIABLE];
  if (
    !executable ||
    !/^[a-z]:\\/i.test(executable) ||
    /["<>|?*]/.test(executable) ||
    hasControlCharacter(executable) ||
    executable.slice(2).includes(":") ||
    executable.includes("/") ||
    executable
      .split("\\")
      .some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          /[. ]$/.test(segment),
      ) ||
    path.win32.basename(executable).toLowerCase() !== "taskkill.exe"
  ) {
    return undefined;
  }
  return executable;
}

/**
 * @internal Exported for focused regression tests, not the public package API.
 * Success confirms taskkill's exit only; callers must still observe child exit.
 */
export async function terminateWindowsProcessTree(
  pid: number,
): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }
  const executable = resolveWindowsTaskkill();
  if (!executable) {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    try {
      execFile(
        executable,
        ["/PID", String(pid), "/T", "/F"],
        { timeout: 3_000, windowsHide: true },
        (error) => {
          resolve(!error);
        },
      );
    } catch {
      resolve(false);
    }
  });
}

export async function terminateOwnedProcess(
  child: ChildProcess,
): Promise<boolean> {
  const pid = child.pid;
  if (!pid) {
    return true;
  }
  if (process.platform === "win32") {
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
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return waitForChildExit(child, 500);
    }
  }
  if (await waitForGroupExit(pid, 300)) {
    return waitForChildExit(child, 500);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return waitForChildExit(child, 500);
    }
  }
  return (
    (await waitForGroupExit(pid, 1_000)) && (await waitForChildExit(child, 500))
  );
}

export async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return child.exitCode !== null || child.signalCode !== null;
}

export async function stopBrowserServer(
  browserServer: BrowserServer,
  testPendingClose = false,
  testUnknownState = false,
): Promise<BrowserStopResult> {
  const browserProcess = browserServer.process();
  const close = testPendingClose
    ? new Promise<void>(() => undefined)
    : browserServer.close();
  void close.catch(() => undefined);
  if (await waitForChildExit(browserProcess, testPendingClose ? 200 : 1_500)) {
    return { stopped: !testUnknownState };
  }

  const kill = browserServer.kill();
  void kill.catch(() => undefined);
  if (await waitForChildExit(browserProcess, 1_000)) {
    return { stopped: !testUnknownState };
  }
  browserProcess.kill("SIGTERM");
  if (await waitForChildExit(browserProcess, 500)) {
    return { stopped: !testUnknownState };
  }
  browserProcess.kill("SIGKILL");
  return {
    stopped:
      !testUnknownState && (await waitForChildExit(browserProcess, 1_000)),
  };
}
