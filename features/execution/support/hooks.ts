// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Cucumber hooks that own the browser context lifecycle and cleanup diagnostics for the reviewed synthetic execution scenarios; no customer targets.
import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  setDefaultTimeout,
  setWorldConstructor,
  World,
  type ITestCaseHookParameter,
} from "@cucumber/cucumber";
import { chromium, type Browser } from "@playwright/test";
import { settleApprovedRoute } from "../../../src/execution/guarded-route";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { getStepTimeoutMs } from "../../support/step-timeout";
import type { ExecutionPayload, ExecutionWorld } from "./world";

import type { UntrustedFields } from "../../../src/validation/untrusted";
import {
  classifyCleanupError,
  type CleanupDiagnostic,
} from "../../../src/execution/cleanup-diagnostics";

const failures: string[] = [];
const diagnostics: CleanupDiagnostic[] = [];
let browser: Browser | undefined;
let payload: ExecutionPayload | undefined;
let cleanupPath: string | undefined;
let contextClosed = false;
let browserDisconnected = false;

class CucumberExecutionWorld extends World implements ExecutionWorld {
  browser?: Browser;
  context?: ExecutionWorld["context"];
  page?: ExecutionWorld["page"];
  payload?: ExecutionPayload;
  blockedDestinations: string[] = [];
}

setDefaultTimeout(getStepTimeoutMs(process.env.CUCUMBER_STEP_TIMEOUT_MS));
setWorldConstructor(CucumberExecutionWorld);

function parsePayload(value: string | undefined): ExecutionPayload {
  if (!value) {
    throw new Error("Execution payload is missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Execution payload is invalid");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Execution payload is invalid");
  }
  // An object, checked above; every field is still checked before it is used.
  const candidate = parsed as UntrustedFields<ExecutionPayload>;
  const target = candidate.environment?.initialTargetUrl;
  const origin = candidate.environment?.approvedOrigin;
  const redirectTarget = candidate.redirectTargetUrl;
  const scenario = candidate.scenario;
  if (
    typeof target !== "string" ||
    typeof origin !== "string" ||
    typeof redirectTarget !== "string" ||
    typeof scenario?.id !== "string" ||
    typeof scenario.values?.displayName !== "string"
  ) {
    throw new Error("Execution payload is invalid");
  }
  const targetUrl = new URL(target);
  const approvedOrigin = new URL(origin);
  const redirectUrl = new URL(redirectTarget);
  if (
    !["http:", "https:"].includes(targetUrl.protocol) ||
    targetUrl.origin !== approvedOrigin.origin ||
    approvedOrigin.hostname !== "127.0.0.1" ||
    targetUrl.username !== "" ||
    targetUrl.password !== "" ||
    redirectUrl.protocol !== "http:" ||
    redirectUrl.hostname !== "127.0.0.1" ||
    redirectUrl.origin === approvedOrigin.origin
  ) {
    throw new Error("Execution target is outside the owned loopback origin");
  }
  const labels: unknown = candidate.ownedLocalLabels;
  if (
    labels !== undefined &&
    (typeof labels !== "object" ||
      labels === null ||
      Object.values(labels).some((value) => typeof value !== "string"))
  ) {
    throw new Error("Execution payload is invalid");
  }
  return candidate as ExecutionPayload;
}

BeforeAll(async function () {
  payload = parsePayload(process.env.WEB_EXECUTION_PAYLOAD);
  const endpoint = process.env.WEB_EXECUTION_BROWSER_ENDPOINT;
  if (!endpoint) {
    throw new Error("Owned browser server endpoint is missing");
  }
  const destination = process.env.WEB_EXECUTION_CLEANUP_PATH;
  if (!destination || !path.isAbsolute(destination)) {
    throw new Error("Execution cleanup report path is missing");
  }
  cleanupPath = destination;
  browser = await chromium.connect(endpoint, { timeout: 10_000 });
  if (process.env.WEB_EXECUTION_TEST_CLEANUP_FAILURE === "worker-stall") {
    // Deliberately never settles: the parent must detect the stalled worker.
    await new Promise<void>(() => undefined);
  }
});

Before(async function (
  this: CucumberExecutionWorld,
  { pickle }: ITestCaseHookParameter,
) {
  const scenarioId = pickle.tags
    .map((tag) => tag.name)
    .find((tag) => tag.startsWith("@scenario-id="))
    ?.slice("@scenario-id=".length);
  if (!browser || !payload || scenarioId !== payload.scenario.id) {
    throw new Error("Selected scenario does not match its prepared inputs");
  }
  this.browser = browser;
  this.payload = payload;
  this.context = await browser.newContext({ serviceWorkers: "block" });
  await this.context.routeWebSocket("**/*", (socket) => socket.close());
  await this.context.addInitScript(() => {
    for (const name of [
      "RTCPeerConnection",
      "webkitRTCPeerConnection",
      "WebTransport",
    ]) {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: false,
        writable: false,
      });
    }
  });
  await this.context.route("**/*", async (route) => {
    let destination: URL | undefined;
    try {
      destination = new URL(route.request().url());
    } catch {
      destination = undefined;
    }
    if (
      !destination ||
      !["http:", "https:"].includes(destination.protocol) ||
      destination.origin !== payload?.environment.approvedOrigin ||
      destination.username !== "" ||
      destination.password !== ""
    ) {
      this.blockedDestinations.push(route.request().url());
      await route.abort("blockedbyclient");
      return;
    }
    await settleApprovedRoute(route, (location) => {
      if (location) {
        try {
          this.blockedDestinations.push(new URL(location, destination).href);
        } catch {
          this.blockedDestinations.push("invalid-redirect");
        }
      }
    });
  });
  this.page = await this.context.newPage();
  this.page.setDefaultTimeout(5_000);
  this.page.setDefaultNavigationTimeout(10_000);
});

After(async function (this: CucumberExecutionWorld) {
  if (!this.context) {
    return;
  }
  try {
    await this.context.close();
    contextClosed = true;
  } catch (error) {
    failures.push("context-close");
    diagnostics.push(classifyCleanupError("context-close", error));
    // eslint-disable-next-line preserve-caught-error -- the raw error is withheld from evidence; its class is kept in diagnostics
    throw new Error("Scenario context cleanup failed");
  }
  if (process.env.WEB_EXECUTION_TEST_CLEANUP_FAILURE === "context") {
    failures.push("context-close-injected");
    throw new Error("Injected scenario context cleanup failure");
  }
});

AfterAll(async function () {
  if (browser) {
    try {
      await browser.close();
      browserDisconnected = true;
    } catch (error) {
      failures.push("browser-close");
      diagnostics.push(classifyCleanupError("browser-close", error));
    }
  }
  const cleanupStatus = failures.some(
    (failure) => !failure.endsWith("-injected"),
  )
    ? "unknown"
    : failures.length > 0
      ? "failed"
      : contextClosed && browserDisconnected
        ? "confirmed"
        : "unknown";
  try {
    if (!cleanupPath) {
      throw new Error("Cleanup report path is unavailable");
    }
    writeFileSync(
      cleanupPath,
      JSON.stringify({
        status: cleanupStatus,
        failures,
        ...(diagnostics.length ? { diagnostics } : {}),
      }),
      { encoding: "utf8", flag: "wx" },
    );
  } catch {
    failures.push("cleanup-report");
    throw new Error("Execution cleanup report could not be written");
  }
  if (failures.some((failure) => !failure.endsWith("-injected"))) {
    throw new Error("Execution resource cleanup failed");
  }
});
