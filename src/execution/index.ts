import {
  cleanupDiagnosticsSchema,
  type CleanupDiagnostic,
} from "./cleanup-diagnostics";
export type { CleanupDiagnostic } from "./cleanup-diagnostics";
import { OWNED_EVIDENCE_ID, readOwnedEvidence } from "./owned-evidence";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { chromium, type BrowserServer } from "playwright-core";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  prepareScenarioInputs,
  type PreparedInputDescriptor,
} from "../input-preparation";
import type { ExecutionTestSeam } from "./test-seam";
import type { OwnedLocalLabels } from "./owned-local-labels";
import { selectApprovedScenarios } from "../validation/scenario-selector";
import {
  loadReviewedScenarios,
  REPOSITORY_ROOT,
  reviewedFixturePolicy,
  runtimePackagePath,
} from "./reviewed-scenarios";

import {
  MAX_CONCURRENT_SCENARIOS,
  MAX_EXECUTION_RETRIES,
  MAX_EXECUTION_SCENARIOS,
  MAX_RUN_TIMEOUT_MS,
  MAX_SCENARIO_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  type ExecutionStatus,
} from "./limits";

export {
  EXECUTION_STATUSES,
  MAX_CONCURRENT_SCENARIOS,
  MAX_EXECUTION_RETRIES,
  MAX_EXECUTION_SCENARIOS,
  MAX_RUN_TIMEOUT_MS,
  MAX_SCENARIO_TIMEOUT_MS,
  type ExecutionStatus,
} from "./limits";
import {
  makeFixtureInput,
  startFixtureServer,
  closeServer,
} from "./fixture-server";
import {
  terminateOwnedProcess,
  waitForChildExit,
  stopBrowserServer,
} from "./process-control";
import {
  cucumberScenarioEvidence,
  type CucumberScenarioEvidence,
} from "./cucumber-report";
export type {
  CucumberScenarioEvidence,
  CucumberStepStatus,
} from "./cucumber-report";
export { makeFixtureInput } from "./fixture-server";
export {
  resolveWindowsTaskkill,
  terminateWindowsProcessTree,
} from "./process-control";
export type ResourceCleanupStatus =
  "not_required" | "confirmed" | "failed" | "unknown";
type WorkerStopReason =
  "scenario-timeout" | "run-timeout" | "cancelled" | "cleanup-unknown";

export interface ScenarioExecutionResult {
  readonly scenarioId: string;
  readonly status: ExecutionStatus;
  readonly cucumber?: CucumberScenarioEvidence;
  readonly cleanupStatus: ResourceCleanupStatus;
  readonly cleanupFailures: readonly string[];
  readonly cleanupDiagnostics?: readonly CleanupDiagnostic[];
  readonly workerStopped: boolean;
}

export interface ExecutionSummary {
  readonly diagnosticReference: string;
  readonly status: ExecutionStatus;
  readonly resourceCleanup: {
    readonly status: ResourceCleanupStatus;
    readonly failures: readonly string[];
    readonly browserProcessStopped: boolean | null;
    readonly blockedTargetRequestCount: number;
  };
  readonly dataRestoration: {
    readonly status: "unknown";
    readonly operationPerformed: false;
  };
  readonly scenarios: readonly ScenarioExecutionResult[];
  readonly attemptCount: number;
  readonly attempts: readonly ExecutionAttemptSummary[];
}

export interface ExecutionAttemptSummary extends SingleExecutionSummary {
  readonly attemptNumber: number;
}

export interface ExecutionOptions {
  readonly scenarioIds?: readonly string[];
  /** Trusted local composition only; public callers use adapter/v2. */
  readonly ownedLocalTarget?: {
    readonly origin: string;
    readonly labels?: Partial<OwnedLocalLabels>;
  };
  readonly browserExecutablePath?: string;
  readonly authorizationExpiresAt?: number;
  readonly beforeBrowserAcquire?: () => Promise<void>;
  readonly runTimeoutMs?: number;
  readonly scenarioTimeoutMs?: number;
  readonly maxConcurrentScenarios?: number;
  readonly retryCount?: number;
  readonly signal?: AbortSignal;
  /** Test-only fault injection; never set by production callers. */
  readonly testSeam?: ExecutionTestSeam;
  readonly onBrowserProcessStarted?: (pid: number) => void;
}

interface SingleExecutionSummary {
  readonly diagnosticReference: string;
  readonly status: ExecutionStatus;
  readonly resourceCleanup: ExecutionSummary["resourceCleanup"];
  readonly dataRestoration: ExecutionSummary["dataRestoration"];
  readonly scenarios: readonly ScenarioExecutionResult[];
}

interface WorkerPayload {
  readonly scenario: {
    readonly id: string;
    readonly values: PreparedInputDescriptor["scenarios"][number]["values"];
  };
  readonly environment: PreparedInputDescriptor["environment"];
  readonly redirectTargetUrl: string;
  readonly ownedLocalLabels?: Partial<OwnedLocalLabels>;
}

interface CleanupReport {
  readonly diagnostics?: readonly CleanupDiagnostic[];
  readonly status: ResourceCleanupStatus;
  readonly failures: readonly string[];
}

const CUCUMBER_BIN = path.join(
  path.dirname(runtimePackagePath("@cucumber/cucumber")),
  "bin/cucumber.js",
);
const CUCUMBER_CONFIG = "cucumber-execution.json";
const DEFAULT_RUN_TIMEOUT_MS = 90_000;
const DEFAULT_SCENARIO_TIMEOUT_MS = 30_000;

function validateOptions(
  options: ExecutionOptions,
  minimumRunTimeoutMs = MIN_TIMEOUT_MS,
): {
  readonly runTimeoutMs: number;
  readonly scenarioTimeoutMs: number;
  readonly concurrency: number;
  readonly retryCount: number;
} {
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const scenarioTimeoutMs =
    options.scenarioTimeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS;
  const concurrency = options.maxConcurrentScenarios ?? 1;
  const retryCount = options.retryCount ?? 0;
  const testAssertionMismatchAttempts =
    options.testSeam?.assertionMismatchAttempts ?? [];
  if (
    !Number.isSafeInteger(runTimeoutMs) ||
    runTimeoutMs < minimumRunTimeoutMs ||
    runTimeoutMs > MAX_RUN_TIMEOUT_MS ||
    !Number.isSafeInteger(scenarioTimeoutMs) ||
    scenarioTimeoutMs < MIN_TIMEOUT_MS ||
    scenarioTimeoutMs > MAX_SCENARIO_TIMEOUT_MS ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENT_SCENARIOS ||
    !Number.isSafeInteger(retryCount) ||
    retryCount < 0 ||
    retryCount > MAX_EXECUTION_RETRIES ||
    !Array.isArray(testAssertionMismatchAttempts) ||
    testAssertionMismatchAttempts.some(
      (attempt) =>
        !Number.isSafeInteger(attempt) ||
        attempt < 1 ||
        attempt > retryCount + 1,
    ) ||
    (testAssertionMismatchAttempts.length > 0 &&
      !options.scenarioIds?.includes("retry-assertion-flow"))
  ) {
    throw new RangeError("Synthetic execution limits are outside their bounds");
  }
  if (options.ownedLocalTarget) {
    const origin = new URL(options.ownedLocalTarget.origin);
    if (
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      !origin.port ||
      origin.origin !== options.ownedLocalTarget.origin ||
      options.scenarioIds?.length !== 1 ||
      options.scenarioIds[0] !== "local-demo-navigation" ||
      retryCount !== 0 ||
      concurrency !== 1
    ) {
      throw new RangeError(
        "Owned local execution is outside its reviewed boundary",
      );
    }
  } else if (options.scenarioIds?.includes("local-demo-navigation")) {
    throw new RangeError("Owned local target is required");
  }
  return { runTimeoutMs, scenarioTimeoutMs, concurrency, retryCount };
}

function safeCleanupReport(reportPath: string): CleanupReport | undefined {
  try {
    const report = JSON.parse(
      readFileSync(reportPath, "utf8"),
    ) as Partial<CleanupReport>;
    if (
      !["confirmed", "failed", "unknown"].includes(String(report.status)) ||
      !Array.isArray(report.failures) ||
      report.failures.some(
        (failure) =>
          typeof failure !== "string" || !/^[a-z-]{1,48}$/.test(failure),
      )
    ) {
      return undefined;
    }
    if (report.diagnostics !== undefined) {
      const diagnostics = cleanupDiagnosticsSchema.safeParse(
        report.diagnostics,
      );
      if (
        !diagnostics.success ||
        diagnostics.data.some((item) => !report.failures?.includes(item.phase))
      )
        return undefined;
      return { ...report, diagnostics: diagnostics.data } as CleanupReport;
    }
    return report as CleanupReport;
  } catch {
    return undefined;
  }
}

function workerEnvironment(
  payload: WorkerPayload,
  cleanupPath: string,
  testCleanupFailure: ExecutionTestSeam["cleanupFailure"],
  browserEndpoint: string,
  testAssertionMismatch: boolean,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "WINDIR",
    "PLAYWRIGHT_BROWSERS_PATH",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }
  env.CUCUMBER_STEP_TIMEOUT_MS = String(MAX_SCENARIO_TIMEOUT_MS);
  env.WEB_EXECUTION_PAYLOAD = JSON.stringify(payload);
  env.WEB_EXECUTION_CLEANUP_PATH = cleanupPath;
  env.WEB_EXECUTION_BROWSER_ENDPOINT = browserEndpoint;
  if (testAssertionMismatch) {
    env.WEB_EXECUTION_TEST_ASSERTION_MISMATCH = "1";
  }
  if (testCleanupFailure) {
    env.WEB_EXECUTION_TEST_CLEANUP_FAILURE = testCleanupFailure;
  }
  return env;
}

function stoppedStatus(
  reason: WorkerStopReason,
  workerStopped: boolean,
): ExecutionStatus {
  if (reason === "scenario-timeout" || reason === "run-timeout") {
    return "timed_out";
  }
  return reason === "cancelled" && workerStopped ? "cancelled" : "failed";
}

async function executeScenario(
  scenarioId: string,
  payload: WorkerPayload,
  temporaryDirectory: string,
  browserEndpoint: string,
  timeoutMs: number,
  runSignal: AbortSignal,
  testCleanupFailure: ExecutionTestSeam["cleanupFailure"],
  testAssertionMismatch: boolean,
): Promise<ScenarioExecutionResult> {
  const reportPath = path.join(temporaryDirectory, `${scenarioId}.json`);
  const cleanupPath = path.join(
    temporaryDirectory,
    `${scenarioId}.cleanup.json`,
  );
  const child = spawn(
    process.execPath,
    [
      CUCUMBER_BIN,
      "--config",
      CUCUMBER_CONFIG,
      "--tags",
      `@scenario-id=${scenarioId}`,
      "--format",
      `json:${reportPath}`,
      ...(scenarioId === OWNED_EVIDENCE_ID
        ? [
            "--format",
            `${path.join(REPOSITORY_ROOT, "dist/cucumber/src/execution/owned-evidence-formatter.js")}:${reportPath}.completed`,
          ]
        : []),
      "--strict",
    ],
    {
      cwd: REPOSITORY_ROOT,
      detached: process.platform !== "win32",
      stdio: "ignore",
      env: workerEnvironment(
        payload,
        cleanupPath,
        testCleanupFailure,
        browserEndpoint,
        testAssertionMismatch,
      ),
    },
  );
  const spawned = new Promise<boolean>((resolve) => {
    child.once("spawn", () => {
      resolve(true);
    });
    child.once("error", () => {
      resolve(false);
    });
  });
  let resolveTermination: ((terminated: boolean) => void) | undefined;
  const terminationCompleted = new Promise<boolean>((resolve) => {
    resolveTermination = resolve;
  });
  let stopReason: WorkerStopReason | undefined;
  let termination: Promise<boolean> | undefined;
  const requestStop = (reason: WorkerStopReason): void => {
    if (stopReason || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    stopReason = reason;
    termination = spawned.then((didSpawn) =>
      didSpawn ? terminateOwnedProcess(child) : true,
    );
    void termination.then(
      (terminated) => resolveTermination?.(terminated),
      () => resolveTermination?.(false),
    );
  };
  const timeout = setTimeout(() => {
    requestStop("scenario-timeout");
  }, timeoutMs);
  const onRunAbort = (): void => {
    requestStop(
      runSignal.reason === "run-timeout"
        ? "run-timeout"
        : runSignal.reason === "cleanup-unknown"
          ? "cleanup-unknown"
          : "cancelled",
    );
  };
  runSignal.addEventListener("abort", onRunAbort);
  if (runSignal.aborted) {
    onRunAbort();
  }
  const completionPromise = new Promise<{
    readonly code: number | null;
    readonly spawnFailed: boolean;
  }>((resolve) => {
    child.once("error", () => {
      resolve({ code: null, spawnFailed: true });
    });
    child.once("exit", (code) => {
      resolve({ code, spawnFailed: false });
    });
  });
  const outcome = await Promise.race([
    completionPromise.then((completion) => ({ completion })),
    terminationCompleted.then((terminated) => ({ terminated })),
  ]);
  clearTimeout(timeout);
  runSignal.removeEventListener("abort", onRunAbort);
  if ("terminated" in outcome || stopReason) {
    const terminated =
      "terminated" in outcome
        ? outcome.terminated
        : termination
          ? await termination
          : true;
    const workerStopped = terminated && (await waitForChildExit(child, 500));
    return {
      scenarioId,
      status: stoppedStatus(stopReason ?? "cleanup-unknown", workerStopped),
      cleanupStatus: "unknown",
      cleanupFailures: [
        workerStopped
          ? "owned-process-terminated"
          : "owned-process-state-unknown",
      ],
      workerStopped,
    };
  }
  const completion = outcome.completion;
  if (completion.spawnFailed) {
    return {
      scenarioId,
      status: "incomplete",
      cleanupStatus: "unknown",
      cleanupFailures: ["worker-start"],
      workerStopped: true,
    };
  }

  const cleanup = safeCleanupReport(cleanupPath);
  const cucumber =
    cucumberScenarioEvidence(reportPath, scenarioId) ??
    readOwnedEvidence(`${reportPath}.completed`, scenarioId);
  const scenarioPassed = cucumber
    ? cucumber.steps.every((step) => step.status === "passed")
    : undefined;
  const status =
    scenarioPassed === undefined
      ? "incomplete"
      : completion.code === 0 &&
          scenarioPassed &&
          cleanup?.status === "confirmed"
        ? "passed"
        : "failed";
  return {
    scenarioId,
    status,
    ...(cucumber ? { cucumber } : {}),
    cleanupStatus: cleanup?.status ?? "unknown",
    cleanupFailures: cleanup?.failures ?? ["cleanup-evidence-missing"],
    ...(cleanup?.diagnostics
      ? { cleanupDiagnostics: cleanup.diagnostics }
      : {}),
    workerStopped: true,
  };
}

function aggregateCleanup(
  results: readonly ScenarioExecutionResult[],
  runFailures: readonly string[],
): ResourceCleanupStatus {
  if (
    results.some((result) => result.cleanupStatus === "failed") ||
    runFailures.includes("temporary-report-cleanup")
  ) {
    return "failed";
  }
  if (
    results.some((result) => result.cleanupStatus === "unknown") ||
    runFailures.length > 0
  ) {
    return "unknown";
  }
  return "confirmed";
}

function summary(
  diagnosticReference: string,
  status: ExecutionStatus,
  scenarios: readonly ScenarioExecutionResult[],
  cleanupStatus: ResourceCleanupStatus,
  cleanupFailures: readonly string[] = [],
  browserProcessStopped: boolean | null = null,
  blockedTargetRequestCount = 0,
): SingleExecutionSummary {
  return {
    diagnosticReference,
    status,
    resourceCleanup: {
      status: cleanupStatus,
      failures: cleanupFailures,
      browserProcessStopped,
      blockedTargetRequestCount,
    },
    dataRestoration: { status: "unknown", operationPerformed: false },
    scenarios,
  };
}

async function executeReviewedScenarioAttempt(
  options: ExecutionOptions = {},
  attemptNumber = 1,
): Promise<SingleExecutionSummary> {
  const { runTimeoutMs, scenarioTimeoutMs, concurrency } = validateOptions(
    options,
    1,
  );
  const diagnosticReference = randomUUID();
  const runController = new AbortController();
  const runTimer = setTimeout(() => {
    runController.abort("run-timeout");
  }, runTimeoutMs);
  const onAbort = (): void => {
    runController.abort(
      options.signal?.reason === "run-timeout"
        ? "run-timeout"
        : options.signal?.reason === "cleanup-unknown"
          ? "cleanup-unknown"
          : "cancelled",
    );
  };
  options.signal?.addEventListener("abort", onAbort);
  if (options.signal?.aborted) {
    onAbort();
  }

  const results: ScenarioExecutionResult[] = [];
  const cleanupFailures: string[] = [];
  let server: Server | undefined;
  let serverSockets = new Set<Socket>();
  let redirectServer: Server | undefined;
  let redirectSockets = new Set<Socket>();
  let blockedTargetRequestCount: (() => number) | undefined;
  let browserServer: BrowserServer | undefined;
  let browserProcessStopped: boolean | null = null;
  let browserLaunchUncertain = false;
  // Flags set in callbacks and catch blocks; read afresh where the type checker cannot see that.
  const runAborted = (): boolean => runController.signal.aborted;
  const isBrowserLaunchUncertain = (): boolean => browserLaunchUncertain;
  let resourcesAcquired = false;
  let temporaryDirectory: string | undefined;
  let status: ExecutionStatus;
  try {
    if (runController.signal.aborted) {
      status =
        runController.signal.reason === "run-timeout"
          ? "timed_out"
          : "cancelled";
      return summary(diagnosticReference, status, results, "not_required");
    }
    const { approval, validation } = await loadReviewedScenarios();
    const filters = options.scenarioIds
      ? { scenarioIds: options.scenarioIds }
      : { tags: ["@web-safe-execution-S01"] };
    const selection = selectApprovedScenarios(validation, approval, filters);
    if (!selection.runnable) {
      return summary(
        diagnosticReference,
        "incomplete",
        results,
        "not_required",
      );
    }
    if (selection.scenarios.length > MAX_EXECUTION_SCENARIOS) {
      return summary(
        diagnosticReference,
        "incomplete",
        results,
        "not_required",
      );
    }
    if (runAborted()) {
      return summary(
        diagnosticReference,
        runController.signal.reason === "run-timeout"
          ? "timed_out"
          : "cancelled",
        results,
        "not_required",
      );
    }

    if (
      options.authorizationExpiresAt !== undefined &&
      options.authorizationExpiresAt <= Date.now()
    )
      throw new Error("Execution approval expired");
    const localRuntime = options.ownedLocalTarget
      ? {
          ...options.ownedLocalTarget,
          server: undefined,
          sockets: new Set<Socket>(),
          redirectServer: undefined,
          redirectSockets: new Set<Socket>(),
          redirectTargetUrl: "http://127.0.0.1:1/blocked",
          blockedTargetRequestCount: () => 0,
        }
      : await startFixtureServer();
    server = localRuntime.server;
    serverSockets = localRuntime.sockets;
    redirectServer = localRuntime.redirectServer;
    redirectSockets = localRuntime.redirectSockets;
    blockedTargetRequestCount = localRuntime.blockedTargetRequestCount;
    resourcesAcquired = !options.ownedLocalTarget;
    const selectedIds = selection.scenarios.map((scenario) => scenario.id);
    const descriptor = prepareScenarioInputs(
      makeFixtureInput(selectedIds, localRuntime.origin),
      validation,
      approval,
      reviewedFixturePolicy,
      filters,
    );
    if (options.ownedLocalTarget) {
      (
        descriptor.environment as { initialTargetUrl: string }
      ).initialTargetUrl = `${localRuntime.origin}/`;
    }
    temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), `rrdweb4-${diagnosticReference}-`),
    );
    await options.beforeBrowserAcquire?.();
    if (
      runAborted() ||
      (options.authorizationExpiresAt !== undefined &&
        options.authorizationExpiresAt <= Date.now())
    )
      throw new Error("Execution approval unavailable");
    try {
      resourcesAcquired = true;
      browserServer = await chromium.launchServer({
        host: "127.0.0.1",
        headless: true,
        executablePath: options.browserExecutablePath,
        timeout: 10_000,
      });
      const browserProcessId = browserServer.process().pid;
      if (!browserProcessId) {
        browserLaunchUncertain = true;
        throw new Error("Owned browser process identity is unavailable");
      }
      options.onBrowserProcessStarted?.(browserProcessId);
    } catch (error) {
      browserLaunchUncertain = true;
      throw error;
    }
    // Both are set above; the workers below are closures, which lose that narrowing.
    const scenarioDirectory = temporaryDirectory;
    const browserEndpoint = browserServer.wsEndpoint();
    let nextScenario = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, selection.scenarios.length) },
      async () => {
        while (nextScenario < selection.scenarios.length && !runAborted()) {
          const index = nextScenario++;
          const scenario = selection.scenarios[index];
          const prepared = descriptor.scenarios.find(
            (candidate) => candidate.id === scenario.id,
          );
          if (!prepared) {
            results[index] = {
              scenarioId: scenario.id,
              status: "incomplete",
              cleanupStatus: "unknown",
              cleanupFailures: ["prepared-input-missing"],
              workerStopped: true,
            };
            continue;
          }
          const payload: WorkerPayload = {
            scenario: {
              id: prepared.id,
              values: prepared.values,
            },
            environment: descriptor.environment,
            redirectTargetUrl: localRuntime.redirectTargetUrl,
            ownedLocalLabels: options.ownedLocalTarget?.labels,
          };
          results[index] = await executeScenario(
            scenario.id,
            payload,
            scenarioDirectory,
            browserEndpoint,
            scenarioTimeoutMs,
            runController.signal,
            options.testSeam?.cleanupFailure,
            (options.testSeam?.assertionMismatchAttempts ?? []).includes(
              attemptNumber,
            ),
          );
          if (!runAborted()) {
            if (results[index].status === "timed_out") {
              runController.abort("run-timeout");
            } else if (results[index].cleanupStatus !== "confirmed") {
              runController.abort("cleanup-unknown");
            }
          }
        }
      },
    );
    await Promise.all(workers);
    for (let index = 0; index < selection.scenarios.length; index += 1) {
      if (!results[index]) {
        const stopReason: unknown = runController.signal.reason;
        results[index] = {
          scenarioId: selection.scenarios[index].id,
          status:
            stopReason === "run-timeout"
              ? "timed_out"
              : stopReason === "cancelled"
                ? "cancelled"
                : "incomplete",
          cleanupStatus: "unknown",
          cleanupFailures: ["scenario-not-started"],
          workerStopped: true,
        };
      }
    }
    status = runAborted()
      ? runController.signal.reason === "run-timeout"
        ? "timed_out"
        : runController.signal.reason === "cancelled"
          ? "cancelled"
          : results.some((result) => result.status === "timed_out")
            ? "timed_out"
            : "failed"
      : results.every((result) => result.status === "passed")
        ? "passed"
        : results.some((result) => result.status === "timed_out")
          ? "timed_out"
          : "failed";
  } catch {
    status =
      runController.signal.reason === "run-timeout"
        ? "timed_out"
        : runController.signal.reason === "cancelled"
          ? "cancelled"
          : "incomplete";
  } finally {
    try {
      options.testSeam?.onAttemptCleanupStarted?.();
    } catch {
      cleanupFailures.push("attempt-cleanup-hook");
    }
    clearTimeout(runTimer);
    options.signal?.removeEventListener("abort", onAbort);
    if (browserServer) {
      try {
        const browserStop = await stopBrowserServer(
          browserServer,
          options.testSeam?.cleanupFailure === "server-pending",
          options.testSeam?.cleanupFailure === "browser-state-unknown",
        );
        browserProcessStopped = browserStop.stopped;
        if (!browserStop.stopped) {
          cleanupFailures.push("browser-process-state-unknown");
        }
      } catch {
        browserProcessStopped = false;
        cleanupFailures.push("browser-process-state-unknown");
      }
    } else if (isBrowserLaunchUncertain()) {
      cleanupFailures.push("browser-launch-state-unknown");
    }
    try {
      const fixtureServer = await closeServer(
        server,
        serverSockets,
        options.testSeam?.cleanupFailure === "server-pending",
      );
      if (!fixtureServer.closed) {
        cleanupFailures.push("fixture-server-state-unknown");
      }
    } catch {
      cleanupFailures.push("fixture-server-close");
    }
    try {
      const redirectClose = await closeServer(redirectServer, redirectSockets);
      if (!redirectClose.closed) {
        cleanupFailures.push("redirect-server-state-unknown");
      }
    } catch {
      cleanupFailures.push("redirect-server-close");
    }
    if (temporaryDirectory) {
      try {
        rmSync(temporaryDirectory, { recursive: true });
      } catch {
        cleanupFailures.push("temporary-report-cleanup");
      }
    }
  }
  if (
    browserProcessStopped === true &&
    cleanupFailures.length === 0 &&
    !isBrowserLaunchUncertain()
  ) {
    for (const result of results) {
      if (result.workerStopped && result.cleanupStatus === "unknown") {
        (result as { cleanupStatus: ResourceCleanupStatus }).cleanupStatus =
          "confirmed";
      }
    }
  }
  const cleanupStatus = !resourcesAcquired
    ? "not_required"
    : isBrowserLaunchUncertain() || browserProcessStopped === false
      ? "unknown"
      : aggregateCleanup(results, cleanupFailures);
  for (const result of results) {
    if (result.status === "cancelled" && cleanupStatus !== "confirmed") {
      (result as { status: ExecutionStatus }).status = "failed";
    }
  }
  if (cleanupStatus !== "confirmed" && status === "passed") {
    status = "failed";
  }
  if (
    status === "cancelled" &&
    (cleanupStatus !== "confirmed" ||
      results.some((result) => !result.workerStopped))
  ) {
    status = "failed";
  }
  return summary(
    diagnosticReference,
    status,
    results,
    cleanupStatus,
    cleanupFailures,
    browserProcessStopped,
    blockedTargetRequestCount?.() ?? 0,
  );
}

export async function executeReviewedScenarios(
  options: ExecutionOptions = {},
): Promise<ExecutionSummary> {
  const { runTimeoutMs, retryCount } = validateOptions(options);
  const now = options.testSeam?.now ?? (() => performance.now());
  const deadline = now() + runTimeoutMs;
  const runController = new AbortController();
  const onAbort = (): void => {
    runController.abort("cancelled");
  };
  options.signal?.addEventListener("abort", onAbort);
  if (options.signal?.aborted) {
    onAbort();
  }
  const deadlineTimer = setTimeout(() => {
    runController.abort("run-timeout");
  }, runTimeoutMs);
  const attempts: ExecutionAttemptSummary[] = [];
  let finalStatusOverride: ExecutionStatus | undefined;

  try {
    for (
      let attemptNumber = 1;
      attemptNumber <= retryCount + 1;
      attemptNumber += 1
    ) {
      if (attemptNumber > 1 && runController.signal.aborted) {
        finalStatusOverride =
          runController.signal.reason === "run-timeout"
            ? "timed_out"
            : "cancelled";
        break;
      }
      const remainingMs = Math.floor(deadline - now());
      if (remainingMs <= 0) {
        finalStatusOverride = "timed_out";
        break;
      }
      const result = await executeReviewedScenarioAttempt(
        {
          ...options,
          runTimeoutMs: Math.min(runTimeoutMs, remainingMs),
          signal: runController.signal,
        },
        attemptNumber,
      );
      attempts.push({
        ...result,
        attemptNumber,
      });

      const canRetry =
        result.status === "failed" &&
        result.resourceCleanup.status === "confirmed" &&
        result.scenarios.every(
          (scenario) =>
            scenario.cleanupStatus === "confirmed" &&
            ["passed", "failed"].includes(scenario.status),
        ) &&
        attemptNumber <= retryCount;
      if (!canRetry) {
        break;
      }
      if (options.signal?.aborted || runController.signal.aborted) {
        finalStatusOverride =
          runController.signal.reason === "run-timeout"
            ? "timed_out"
            : "cancelled";
        break;
      }
      if (now() >= deadline) {
        finalStatusOverride = "timed_out";
        break;
      }
    }
  } finally {
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  const lastAttempt = attempts.at(-1);
  const lastResult =
    lastAttempt ??
    summary(
      randomUUID(),
      finalStatusOverride ?? "timed_out",
      [],
      "not_required",
    );
  const status =
    finalStatusOverride ??
    (lastAttempt?.status === "passed" && attempts.length > 1
      ? "passed_after_retry"
      : (lastAttempt?.status ?? "timed_out"));
  const scenarios =
    status === "passed_after_retry"
      ? lastResult.scenarios.map((scenario) =>
          scenario.status === "passed"
            ? { ...scenario, status: "passed_after_retry" as const }
            : scenario,
        )
      : lastResult.scenarios;

  return {
    diagnosticReference: lastResult.diagnosticReference,
    status,
    resourceCleanup: lastResult.resourceCleanup,
    dataRestoration: lastResult.dataRestoration,
    scenarios,
    attemptCount: attempts.length,
    attempts,
  };
}
