// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Exercises the login contract against owned local transport fixtures with synthetic credentials; no real customer login or external traffic is performed.
import { fake } from "./fixtures/fake-playwright";
import {
  closeLoopbackServer,
  listenOnLoopback,
} from "./fixtures/loopback-server";
import { launchAuthenticationFixtureBrowser } from "./fixtures/authentication-fixture-launcher";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Route,
} from "@playwright/test";
import {
  RuntimeLoginFailure,
  consumeRuntimeLoginInputs,
} from "../src/input-preparation/runtime-login";
import {
  PARTAY_LOGIN_URL,
  verifyPartayLogin,
  partayLoginFailureReport,
} from "../src/customer-login/partay";
import {
  guardLoginRequests,
  LOGIN_CLEANUP_TIMEOUT_MS,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";
import {
  assertDisposed,
  assertSafe,
  canary,
  fixture,
  noop,
  ownedBrowser,
} from "./fixtures/partay-login-helpers";

test("close rejections arriving after the cleanup bound stay handled and cannot produce success", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("success");
  let rescue: (() => Promise<void>) | undefined;
  const lateCloses: Promise<void>[] = [];
  const lateReject = (): Promise<void> => {
    const rejection = delay(LOGIN_CLEANUP_TIMEOUT_MS + 200).then(() => {
      throw new Error(canary.password);
    });
    lateCloses.push(rejection);
    return rejection;
  };
  try {
    await assert.rejects(
      verifyPartayLogin(descriptor, request, provider, {
        launchBrowser: async (timeout) => {
          const browser = await owned.launchBrowser(timeout);
          rescue = browser.close.bind(browser);
          browser.close = lateReject;
          const newContext = browser.newContext.bind(browser);
          browser.newContext = async (options) => {
            const context = await newContext(options);
            context.close = lateReject;
            return context;
          };
          return browser;
        },
      }),
      assertSafe,
    );
    assert.equal(owned.submissions, 1);
    assert.equal(lateCloses.length, 2);
    await assertDisposed(provider, request);
    // Let both delayed failures arrive after the consumer has already returned.
    await delay(LOGIN_CLEANUP_TIMEOUT_MS);
  } finally {
    await rescue?.();
  }
});

test("cancellation during context acquisition closes late context and browser", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  const owned = ownedBrowser("success");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      signal: controller.signal,
      launchBrowser: async (timeout) => {
        const browser = await owned.launchBrowser(timeout);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          const context = await newContext(options);
          controller.abort();
          return context;
        };
        return browser;
      },
    }),
    assertSafe,
  );
  for (let i = 0; i < 100 && !owned.contextClosed; i += 1) await delay(20);
  assert.equal(owned.submissions, 0);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});

test("cleanup errors cannot turn a completed login into success or expose secrets", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("success");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      launchBrowser: async (timeout) => {
        const browser = await owned.launchBrowser(timeout);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          const context = await newContext(options);
          const close = context.close.bind(context);
          context.close = async () => {
            await close();
            throw new Error(canary.password);
          };
          return context;
        };
        return browser;
      },
    }),
    assertSafe,
  );
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});

test("Given raw assertion-shaped errors, when reported, then evidence stays unknown", () => {
  for (const error of [
    new Error("AssertionError: expected Partay"),
    new RuntimeLoginFailure("brand-text", "confirmed"),
    { failureStage: "brand-text", failureClassification: "assertion-failed" },
  ]) {
    assert.equal(
      partayLoginFailureReport(error).failureClassification,
      "unknown",
    );
  }
});

test("Given a completed value mismatch, when cleanup finishes, then it is assertion evidence only", async () => {
  const { descriptor, request, provider } = fixture();
  await assert.rejects(
    verifyPartayLogin(
      descriptor,
      request,
      provider,
      ownedBrowser("wrong-logo"),
    ),
    (error) => {
      const report = partayLoginFailureReport(error);
      assert.equal(report.failureClassification, "assertion-failed");
      assert.equal(report.failureStage, "brand-text");
      assert.equal(report.cleanupStatus, "confirmed");
      assert.equal(report.status, "not-verified");
      return true;
    },
  );
});

for (const outcome of [
  "assertion",
  "raw-error",
  "navigation",
  "cancel",
  "timeout",
  "policy-before-error",
  "policy-during-cleanup",
  "cancel-during-cleanup",
  "deadline-during-cleanup",
  "policy-with-cancel-during-cleanup",
  "policy-with-deadline-during-cleanup",
  "pending-transport",
  "cleanup-failure",
] as const) {
  test(`Given ${outcome}, when login evidence is finalized, then only a completed comparison is classified as an assertion`, async () => {
    const controller = new AbortController();
    let requestHandler: (route: Route) => Promise<void> = () =>
      Promise.resolve();
    let closes = 0;
    const blockedRequest = (): Promise<void> =>
      requestHandler(
        fake<Route>({
          request: () => ({
            url: () => "https://blocked.invalid/",
            isNavigationRequest: () => false,
          }),
          abort: () => Promise.resolve(),
        }),
      );
    const context = fake<BrowserContext>({
      setOffline: () => Promise.resolve(),
      routeWebSocket: () => Promise.resolve(),
      route: (_pattern: string, handler: typeof requestHandler) => {
        requestHandler = handler;
        return Promise.resolve();
      },
      close: async () => {
        closes += 1;
        if (outcome.includes("cancel-during-cleanup")) controller.abort();
        if (outcome.includes("deadline-during-cleanup")) await delay(60);
        if (outcome.startsWith("policy") && outcome.endsWith("during-cleanup"))
          await blockedRequest();
        if (outcome === "cleanup-failure") throw new Error(canary.password);
      },
      newPage: () =>
        Promise.resolve({
          context: () => context,
          setDefaultTimeout: noop,
          setDefaultNavigationTimeout: noop,
        }),
    });
    await assert.rejects(
      withFreshLoginPage(
        async (_page, setStage) => {
          await guardLoginRequests(
            context,
            new URL(PARTAY_LOGIN_URL).origin,
            PARTAY_LOGIN_URL,
          );
          setStage(outcome === "navigation" ? "navigation" : "brand-text");
          if (outcome === "timeout") await new Promise<void>(() => undefined);
          if (outcome === "cancel") controller.abort();
          if (outcome === "policy-before-error") await blockedRequest();
          if (outcome === "pending-transport") {
            void requestHandler(
              fake<Route>({
                request: () => ({
                  url: () => PARTAY_LOGIN_URL,
                  isNavigationRequest: () => false,
                }),
                fetch: () => new Promise(() => undefined),
              }),
            );
          }
          if (outcome === "raw-error" || outcome === "navigation")
            throw new Error(canary.password);
          throw new RuntimeLoginFailure(
            "brand-text",
            "unconfirmed",
            undefined,
            "assertion-failed",
          );
        },
        {
          timeoutMs: 50,
          signal: controller.signal,
          launchBrowser: () =>
            Promise.resolve(
              fake<Browser>({
                newContext: () => Promise.resolve(context),
                close: () => {
                  closes += 1;
                  return Promise.resolve();
                },
              }),
            ),
        },
      ),
      (error) => {
        assertSafe(error);
        const report = partayLoginFailureReport(error);
        const expected = {
          assertion: "assertion-failed",
          "raw-error": "operational",
          navigation: "navigation",
          cancel: "interrupted",
          timeout: "timed-out",
          "policy-before-error": "request-policy",
          "policy-during-cleanup": "request-policy",
          "cancel-during-cleanup": "interrupted",
          // The comparison completed before the work deadline. Confirmed
          // cleanup uses its own budget and must preserve that evidence.
          "deadline-during-cleanup": "assertion-failed",
          "policy-with-cancel-during-cleanup": "request-policy",
          "policy-with-deadline-during-cleanup": "request-policy",
          "pending-transport": "request-policy",
          "cleanup-failure": "assertion-failed",
        };
        assert.equal(report.failureClassification, expected[outcome]);
        assert.equal(
          report.cleanupStatus,
          outcome === "cleanup-failure" ? "unconfirmed" : "confirmed",
        );
        if (outcome.startsWith("policy")) {
          assert.equal(report.failureStage, "request-policy");
          assert.equal(report.policyReason, "off-origin");
        }
        return true;
      },
    );
    assert.equal(closes, 2);
  });
}

test("Given failed input disposal after an assertion, then evidence is operational with browser cleanup separate", async () => {
  const { descriptor, request, provider } = fixture();
  await assert.rejects(
    consumeRuntimeLoginInputs(
      descriptor,
      request,
      {
        resolve: provider.resolve.bind(provider),
        dispose() {
          provider.dispose();
          throw new Error(canary.password);
        },
      },
      () =>
        Promise.reject(
          new RuntimeLoginFailure(
            "brand-text",
            "confirmed",
            undefined,
            "assertion-failed",
          ),
        ),
    ),
    (error) => {
      assertSafe(error);
      assert.equal(
        partayLoginFailureReport(error).failureClassification,
        "operational",
      );
      assert.equal(partayLoginFailureReport(error).cleanupStatus, "confirmed");
      return true;
    },
  );
});

test("Given invalid or accessor classification, then the report never promotes it to assertion evidence", () => {
  for (const value of [
    canary.password,
    new String("assertion-failed"),
    { toString: () => "assertion-failed" },
  ]) {
    const error = new RuntimeLoginFailure(
      "brand-text",
      "confirmed",
      undefined,
      value,
    );
    assert.equal(
      partayLoginFailureReport(error).failureClassification,
      "unknown",
    );
  }
  const error = new RuntimeLoginFailure(
    "brand-text",
    "confirmed",
    undefined,
    "assertion-failed",
  );
  Object.defineProperty(error, "failureClassification", {
    get() {
      throw new Error(canary.password);
    },
  });
  assert.equal(
    partayLoginFailureReport(error).failureClassification,
    "unknown",
  );
  assert.equal(
    partayLoginFailureReport(
      new RuntimeLoginFailure(
        "navigation",
        "confirmed",
        undefined,
        "assertion-failed",
      ),
    ).failureClassification,
    "unknown",
  );
});

// The real public API, existing provider and lifecycle consume an owned page.
// Only route.fetch is remapped to loopback; no customer destination is contacted.
for (const state of [
  "authenticated",
  "known-resources",
  "onboarding",
  "unknown-gate",
  "missing-me",
  "login-428",
  "visible-onboarding",
  "registration",
] as const) {
  test(`Authentication-only public login with ${state} retains truthful scope and disposes inputs`, async () => {
    const { descriptor, request, provider } = fixture();
    const { PARTAY_AUTHENTICATION_ONLY_POLICY } =
      await import("../src/customer-login/authentication-only");
    const { DECLARED_BLOCKED_RESOURCES } =
      await import("../src/customer-login/declared-resources");
    const assets =
      state === "known-resources"
        ? DECLARED_BLOCKED_RESOURCES.map((resource) =>
            resource.resourceType === "script"
              ? `<script type="module" src="${resource.url}"></script>`
              : `<link rel="stylesheet" href="${resource.url}">`,
          ).join("")
        : "";
    const hits: string[] = [];
    let contextClosed = false;
    let browserClosed = false;
    const server = createServer((req, res) => {
      hits.push(`${String(req.method)} ${String(req.url)}`);
      if (req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          assets +
            '<div id="brandLogo">Partay</div><div id="overlay"><input id="username"><input id="password" type="password" autocomplete="current-password"><div id="authUp" hidden></div><button id="authGo">Sign in</button></div><div id="onboard" hidden>Onboarding</div><div id="bottomnav" hidden>Navigation</div>',
        );
      } else {
        if (state === "login-428" && req.url === "/auth/login")
          res.writeHead(428);
        res.end('{"token":"OWNED_RESPONSE_CANARY"}');
      }
    });
    const serverUrl = await listenOnLoopback(server);
    const serverOrigin = serverUrl.replace(/\/$/, "");
    try {
      const operation = verifyPartayLogin(descriptor, request, provider, {
        authenticationOnlyPolicy: PARTAY_AUTHENTICATION_ONLY_POLICY,
        timeoutMs: 5000,
        launchBrowser: async (timeoutMs) => {
          const browser = await launchAuthenticationFixtureBrowser(
            chromium,
            timeoutMs,
          );
          browser.on("disconnected", () => {
            browserClosed = true;
          });
          const newContext = browser.newContext.bind(browser);
          browser.newContext = async (options) => {
            assert.equal(options?.serviceWorkers, "block");
            const context = await newContext(options);
            context.on("close", () => {
              contextClosed = true;
            });
            const register = context.route.bind(context);
            context.route = async (matcher, handler) =>
              register(matcher, async (route, req) => {
                route.fetch = async (opts) => {
                  assert.equal(opts?.maxRedirects, 0);
                  assert.equal(opts.maxRetries, 0);
                  const path = new URL(req.url()).pathname;
                  // Deliberately do not forward or inspect input values/headers.
                  return context.request.fetch(`${serverOrigin}${path}`, {
                    method: req.method(),
                    maxRedirects: 0,
                  });
                };
                await handler(route, req);
              });
            const newPage = context.newPage.bind(context);
            context.newPage = async () => {
              const page = await newPage();
              const goto = page.goto.bind(page);
              page.goto = async (url, opts) => {
                const response = await goto(url, opts);
                await page.evaluate((state) => {
                  const byId = (id: string): HTMLElement => {
                    const element = document.getElementById(id);
                    if (!element) throw new Error(`Missing #${id}`);
                    return element;
                  };
                  const button = byId("authGo");
                  if (state === "registration")
                    button.textContent = "Create account";
                  button.onclick = async () => {
                    await fetch("/auth/login", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                      },
                    });
                    if (state !== "missing-me") await fetch("/me");
                    byId("overlay").hidden = true;
                    if (state === "onboarding") {
                      await fetch("/agent/characters").catch(() => undefined);
                      byId("onboard").hidden = false;
                    } else if (
                      [
                        "authenticated",
                        "known-resources",
                        "missing-me",
                        "visible-onboarding",
                      ].includes(state)
                    ) {
                      if (state === "visible-onboarding")
                        byId("onboard").hidden = false;
                      byId("bottomnav").hidden = false;
                      await fetch("/agent/greeting").catch(() => undefined);
                    }
                  };
                }, state);
                return response;
              };
              return page;
            };
            return context;
          };
          return browser;
        },
      });
      if (state === "authenticated" || state === "known-resources") {
        const result = await operation;
        assert.equal(result.authenticationOnly?.scope, "authentication-only");
        assert.equal(result.authenticationOnly.downstream, "untested-blocked");
        assert.equal(result.authenticationOnly.productDefectEvidence, false);
        assert.equal(result.authenticationOnly.excludedBackgroundRequests, 1);
        assert.equal(
          result.authenticationOnly.knownBlockedResources.total,
          state === "known-resources" ? 5 : 0,
        );
        assert.ok(!JSON.stringify(result).includes("CANARY"));
        assert.deepEqual(hits, ["GET /", "POST /auth/login", "GET /me"]);
      } else {
        await assert.rejects(operation, (error) => {
          assertSafe(error);
          const report = partayLoginFailureReport(error);
          assert.equal(report.status, "not-verified");
          assert.equal(report.automaticRetryAttempted, false);
          assert.notEqual(report.failureClassification, "assertion-failed");
          return true;
        });
        assert.ok(!hits.includes("GET /agent/characters"));
        if (state === "login-428")
          assert.deepEqual(hits, ["GET /", "POST /auth/login"]);
        if (state === "registration") assert.deepEqual(hits, ["GET /"]);
      }
      assert.equal(contextClosed, true);
      assert.equal(browserClosed, true);
      await assertDisposed(provider, request);
    } finally {
      await closeLoopbackServer(server);
    }
  });
}

test("Given an unknown explicit policy binding, reject before resolving inputs or acquiring a browser and dispose the provider", async () => {
  const { descriptor, request, provider } = fixture();
  let resolutions = 0;
  let launches = 0;
  await assert.rejects(
    verifyPartayLogin(
      descriptor,
      request,
      {
        resolve: () => {
          resolutions++;
          return Promise.resolve("SYNTHETIC_CANARY");
        },
        dispose: () => {
          provider.dispose();
        },
      },
      {
        authenticationOnlyPolicy: fake<
          import("../src/customer-login/authentication-only").AuthenticationOnlyBinding
        >({
          id: "unknown",
          revision: "v1",
        }),
        launchBrowser: () => {
          launches++;
          return Promise.reject(new Error("Unexpected launch"));
        },
      },
    ),
    assertSafe,
  );
  assert.equal(resolutions, 0);
  assert.equal(launches, 0);
  await assertDisposed(provider, request);
});
