// Shared synthetic helpers for the partay-login*.test.ts files; no tests are registered here.
import { closeLoopbackServer, listenOnLoopback } from "./loopback-server";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { createServer } from "node:http";
import { chromium, type Browser, type Page } from "@playwright/test";
import type { RuntimeSecretProvider } from "../../src/input-preparation";
import { runtimeEntryFixture } from "./runtime-entry-data";
import {
  InMemoryRuntimeSecretProvider,
  RuntimeLoginError,
  RuntimeLoginFailure,
  RUNTIME_LOGIN_FAILURE_STAGES,
  RUNTIME_LOGIN_FAILURE_CLASSIFICATIONS,
  RUNTIME_LOGIN_CLEANUP_STATUSES,
  type RuntimeLoginRequest,
} from "../../src/input-preparation/runtime-login";
import {
  PARTAY_LOGIN_URL,
  partayLoginFailureReport,
} from "../../src/customer-login/partay";

export const noop = (): void => undefined;

export const canary = {
  username: "OWNED_WEB8_USERNAME_CANARY",
  password: "OWNED_WEB8_PASSWORD_CANARY",
};

export function fixture() {
  const { descriptor, request } = runtimeEntryFixture();
  const provider = new InMemoryRuntimeSecretProvider(request, canary);
  return { descriptor, request, provider };
}

export type Mode =
  | "success"
  | "navigation-failure"
  | "rejected"
  | "wrong-url"
  | "wrong-logo"
  | "hidden-logo"
  | "redirect"
  | "missing-form"
  | "missing-username"
  | "missing-password"
  | "disabled-submit"
  | "blocked-request"
  | "waiting";

export function ownedBrowser(mode: Mode, afterSubmit?: () => void) {
  let page: Page | undefined;
  let submissions = 0;
  let contexts = 0;
  let contextClosed = false;
  let browserClosed = false;
  let contextWasEmpty = false;
  const requests: string[] = [];
  return {
    get page() {
      return page;
    },
    get submissions() {
      return submissions;
    },
    get contexts() {
      return contexts;
    },
    get contextWasEmpty() {
      return contextWasEmpty;
    },
    get contextClosed() {
      return contextClosed;
    },
    get browserClosed() {
      return browserClosed;
    },
    requests,
    async launchBrowser(timeoutMs: number): Promise<Browser> {
      const browser = await chromium.launch({
        headless: true,
        timeout: timeoutMs,
      });
      browser.on("disconnected", () => {
        browserClosed = true;
      });
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        contexts += 1;
        assert.deepEqual(options, {
          acceptDownloads: false,
          serviceWorkers: "block",
        });
        const context = await newContext(options);
        context.on("close", () => {
          contextClosed = true;
        });
        contextWasEmpty = (await context.cookies()).length === 0;
        await context.exposeBinding("ownedSubmit", () => {
          submissions += 1;
          afterSubmit?.();
        });
        const server = createServer((_request, response) => {
          response.setHeader("Content-Type", "text/html");
          response.end(`<!doctype html>
              <div id="brandLogo" ${mode === "hidden-logo" ? 'style="display:none"' : ""}>${mode === "wrong-logo" ? "Not Partay" : "Par<b>tay</b>"}</div>
              <div id="overlay" ${mode === "missing-form" ? 'style="display:none"' : ""}>
                <input id="${mode === "missing-username" ? "other-user" : "username"}"><input id="${mode === "missing-password" ? "other-password" : "password"}" type="password">
                <button id="authGo" ${mode === "disabled-submit" ? "disabled" : ""}>Sign in</button>
              </div>
              <script>
                authGo.onclick = async () => {
                  authGo.disabled = true;
                  await ownedSubmit();
                  if (username.value !== ${JSON.stringify(canary.username)} ||
                      password.value !== ${JSON.stringify(canary.password)}) return;
                  if (${JSON.stringify(mode)} === "waiting" || ${JSON.stringify(mode)} === "rejected") return;
                  if (${JSON.stringify(mode)} === "redirect") { location.href = "/not-permitted"; return; }
                  if (${JSON.stringify(mode)} === "blocked-request") {
                    try { await fetch("https://blocked.invalid/", {method:"POST"}); } catch {}
                  }
                  overlay.style.display = "none";
                  if (${JSON.stringify(mode)} === "wrong-url") history.pushState({}, "", "/other");
                };
              </script>`);
        });
        const fixtureUrl = await listenOnLoopback(server);
        browser.on("disconnected", () => {
          void closeLoopbackServer(server).catch(() => undefined);
        });
        const registerRoute = context.route.bind(context);
        context.route = async (url, handler, options) => {
          return registerRoute(
            url,
            async (route, request) => {
              // Only the transport is remapped. The production guard still checks
              // the customer URL and fetch options; no customer request is sent.
              route.fetch = async (fetchOptions) => {
                assert.equal(fetchOptions?.maxRedirects, 0);
                requests.push(route.request().url());
                assert.equal(route.request().url(), PARTAY_LOGIN_URL);
                return context.request.get(fixtureUrl, { maxRedirects: 0 });
              };
              await handler(route, request);
            },
            options,
          );
        };
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          page = await newPage();
          if (mode === "navigation-failure")
            page.goto = () => Promise.reject(new Error(canary.password));
          return page;
        };
        return context;
      };
      return browser;
    },
  };
}

export async function assertDisposed(
  provider: RuntimeSecretProvider,
  request: RuntimeLoginRequest,
): Promise<void> {
  await assert.rejects(
    provider.resolve({ ...request.account, field: "password" }, request.scope),
    {
      code: "runtime-input-unavailable",
    },
  );
}

export function assertSafe(error: unknown): boolean {
  assert.ok(error instanceof RuntimeLoginError);
  const serialized = `${JSON.stringify(error)} ${inspect(error)}`;
  assert.ok(!serialized.includes(canary.username));
  assert.ok(!serialized.includes(canary.password));
  assert.equal(error.cause, undefined);
  assert.ok(error instanceof RuntimeLoginFailure);
  assert.ok(RUNTIME_LOGIN_FAILURE_STAGES.includes(error.failureStage));
  assert.ok(RUNTIME_LOGIN_CLEANUP_STATUSES.includes(error.cleanupStatus));
  return true;
}

export function assertFailure(
  error: unknown,
  failureStage: RuntimeLoginFailure["failureStage"],
  cleanupStatus: RuntimeLoginFailure["cleanupStatus"],
  policyReason?: RuntimeLoginFailure["policyReason"],
): boolean {
  assertSafe(error);
  const { failureClassification, ...report } = partayLoginFailureReport(error);
  assert.ok(
    RUNTIME_LOGIN_FAILURE_CLASSIFICATIONS.includes(failureClassification),
  );
  assert.deepEqual(report, {
    status: "not-verified",
    failureStage,
    cleanupStatus,
    ...(policyReason ? { policyReason } : {}),
    automaticRetryAttempted: false,
  });
  return true;
}
