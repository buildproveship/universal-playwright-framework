// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Exercises the login contract against owned local transport fixtures with synthetic credentials; no real customer login or external traffic is performed.
import { fake } from "./fixtures/fake-playwright";
import {
  closeLoopbackServer,
  listenOnLoopback,
} from "./fixtures/loopback-server";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "@playwright/test";
import type { RuntimeSecretProvider } from "../src/input-preparation";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import {
  PARTAY_LOGIN_URL,
  verifyPartayLogin,
} from "../src/customer-login/partay";
import {
  guardLoginRequests,
  LOGIN_CLEANUP_TIMEOUT_MS,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";
import { settle } from "./fixtures/settle";
import {
  assertDisposed,
  assertFailure,
  assertSafe,
  canary,
  fixture,
  ownedBrowser,
} from "./fixtures/partay-login-helpers";

for (const fault of ["launch", "context", "page"] as const) {
  test(`offline ${fault} startup failure reports independent cleanup status and makes one attempt`, async () => {
    const { descriptor, request, provider } = fixture();
    let launches = 0;
    let browserCloses = 0;
    let contextCloses = 0;
    await assert.rejects(
      verifyPartayLogin(descriptor, request, provider, {
        launchBrowser: () =>
          settle(() => {
            launches += 1;
            if (fault === "launch") throw new Error(canary.password);
            return fake<Browser>({
              close: () => {
                browserCloses += 1;
                return Promise.resolve();
              },
              newContext: () =>
                settle(() => {
                  if (fault === "context") throw new Error(canary.password);
                  return {
                    setOffline: () => Promise.resolve(),
                    close: () => {
                      contextCloses += 1;
                      return Promise.resolve();
                    },
                    newPage: () => Promise.reject(new Error(canary.password)),
                  };
                }),
            });
          }),
      }),
      (error) =>
        assertFailure(
          error,
          "browser-startup",
          fault === "launch" ? "not-acquired" : "confirmed",
        ),
    );
    assert.equal(launches, 1);
    assert.equal(browserCloses, fault === "launch" ? 0 : 1);
    assert.equal(contextCloses, fault === "page" ? 1 : 0);
    await assertDisposed(provider, request);
  });
}

test("exact target, rendered Partay and hidden overlay succeed with one submit and fresh cleanup", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("success");
  const receipt = await verifyPartayLogin(descriptor, request, provider, owned);
  assert.equal(receipt.status, "completed");
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contexts, 1);
  assert.equal(owned.contextWasEmpty, true);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  assert.deepEqual(owned.requests, [PARTAY_LOGIN_URL]);
  assert.ok(!JSON.stringify(receipt).includes(canary.username));
  assert.ok(!JSON.stringify(receipt).includes(canary.password));
  await assertDisposed(provider, request);
});

test("offline navigation failure is distinct from startup and submission; cleanup is confirmed", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("navigation-failure");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, owned),
    (error) => assertFailure(error, "navigation", "confirmed"),
  );
  assert.equal(owned.submissions, 0);
  assert.equal(owned.contexts, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  assert.deepEqual(owned.requests, []);
  await assertDisposed(provider, request);
});

for (const mode of [
  "rejected",
  "wrong-url",
  "wrong-logo",
  "hidden-logo",
  "redirect",
  "missing-form",
  "missing-username",
  "missing-password",
  "disabled-submit",
  "blocked-request",
] as const) {
  test(`owned ${mode} cannot pass; no retry, secret-bearing error or retained context`, async () => {
    const { descriptor, request, provider } = fixture();
    const owned = ownedBrowser(mode);
    await assert.rejects(
      verifyPartayLogin(descriptor, request, provider, {
        ...owned,
        timeoutMs: 2000,
      }),
      (error) => {
        assertSafe(error);
        assert.ok(error instanceof RuntimeLoginFailure);
        const stages = {
          rejected: "overlay-dismissal",
          "wrong-url": "final-url",
          "wrong-logo": "brand-text",
          "hidden-logo": "brand-visible",
          redirect: "request-policy",
          "missing-form": "form-visible",
          "missing-username": "username-fill",
          "missing-password": "password-fill",
          "disabled-submit": "submit-click",
          "blocked-request": "request-policy",
        };
        assert.equal(error.failureStage, stages[mode]);
        // Deadline cancellation closes both resources independently; a close
        // rejection must not be upgraded merely because the process exited.
        if (mode === "wrong-logo")
          assert.equal(error.cleanupStatus, "confirmed");
        else assert.notEqual(error.cleanupStatus, "not-acquired");
        return true;
      },
    );
    assert.equal(
      owned.submissions,
      [
        "missing-form",
        "missing-username",
        "missing-password",
        "disabled-submit",
      ].includes(mode)
        ? 0
        : 1,
    );
    assert.equal(owned.contextClosed, true);
    assert.equal(owned.browserClosed, true);
    assert.deepEqual(owned.requests, [PARTAY_LOGIN_URL]);
    await assertDisposed(provider, request);
  });
}

test("cancellation during login closes browser and disposes provider", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  const owned = ownedBrowser("waiting", () => {
    controller.abort();
  });
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      ...owned,
      signal: controller.signal,
    }),
    (error) => {
      assertSafe(error);
      assert.ok(error instanceof RuntimeLoginFailure);
      assert.ok(
        ["submit-click", "overlay-dismissal"].includes(error.failureStage),
      );
      assert.notEqual(error.cleanupStatus, "not-acquired");
      return true;
    },
  );
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});

test("timeout during login closes browser and disposes provider", async () => {
  const { descriptor, request, provider } = fixture();
  const owned = ownedBrowser("waiting");
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      ...owned,
      timeoutMs: 2000,
    }),
    assertSafe,
  );
  assert.equal(owned.submissions, 1);
  assert.equal(owned.contextClosed, true);
  assert.equal(owned.browserClosed, true);
  await assertDisposed(provider, request);
});

for (const fault of [
  "cancelled",
  "target",
  "scope",
  "empty",
  "expired",
] as const) {
  test(`${fault} preflight rejects before browser acquisition and disposes input`, async () => {
    const prepared = fixture();
    let { descriptor, request } = prepared;
    const { provider } = prepared;
    const controller = new AbortController();
    let launches = 0;
    let disposed = false;
    let injected: RuntimeSecretProvider = provider;
    if (fault === "cancelled") controller.abort();
    if (fault === "target")
      descriptor = {
        ...descriptor,
        environment: {
          ...descriptor.environment,
          initialTargetUrl: `${PARTAY_LOGIN_URL}?unapproved=1`,
        },
      };
    if (fault === "scope")
      request = {
        ...request,
        scope: {
          ...request.scope,
          environment: {
            ...request.scope.environment,
            approvedOrigin: "https://other.invalid",
          },
        },
      };
    if (fault === "expired")
      request = { ...request, expiresAt: Date.now() - 1 };
    if (fault === "empty") {
      injected = {
        resolve: () => Promise.resolve(""),
        dispose: () => {
          disposed = true;
        },
      };
      provider.dispose();
    }
    await assert.rejects(
      verifyPartayLogin(descriptor, request, injected, {
        signal: controller.signal,
        launchBrowser: () => {
          launches += 1;
          return Promise.reject(new Error(canary.password));
        },
      }),
      (error) =>
        assertFailure(
          error,
          fault === "cancelled" ? "browser-startup" : "input-validation",
          "not-acquired",
        ),
    );
    assert.equal(launches, 0);
    if (fault === "empty") assert.equal(disposed, true);
    else await assertDisposed(provider, request);
  });
}

test("late browser acquisition after cancellation is still closed", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  let browser: Browser | undefined;
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      signal: controller.signal,
      launchBrowser: async (timeout) => {
        controller.abort();
        browser = await chromium.launch({ headless: true, timeout });
        return browser;
      },
    }),
    assertSafe,
  );
  for (let i = 0; i < 100 && !browser; i += 1) await delay(20);
  for (let i = 0; i < 100 && browser?.isConnected(); i += 1) await delay(20);
  assert.equal(browser?.isConnected(), false);
  await assertDisposed(provider, request);
});

test("launcher failure is sanitized and disposes input", async () => {
  const { descriptor, request, provider } = fixture();
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      launchBrowser: () => Promise.reject(new Error(canary.password)),
    }),
    (error) => assertFailure(error, "browser-startup", "not-acquired"),
  );
  await assertDisposed(provider, request);
});

async function localTransport(
  run: (
    source: string,
    destination: string,
    counts: Map<string, number>,
  ) => Promise<void>,
): Promise<void> {
  const counts = new Map<string, number>();
  const destination = createServer((request, response) => {
    counts.set("destination", (counts.get("destination") ?? 0) + 1);
    request.resume();
    response.end("unintended");
  });
  destination.on("upgrade", (_request, socket) => {
    counts.set("destination", (counts.get("destination") ?? 0) + 1);
    socket.destroy();
  });
  let destinationUrl = "";
  const source = createServer((request, response) => {
    const path = request.url ?? "/";
    counts.set(path, (counts.get(path) ?? 0) + 1);
    request.resume();
    if (path === "/" || path === "/api") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Owned login</title>");
    } else {
      response.statusCode = Number(/^\/(\d+)/.exec(path)?.[1] ?? 302);
      response.setHeader(
        "Location",
        path.includes("chain")
          ? "/hop"
          : path.includes("same-origin")
            ? "/unapproved"
            : destinationUrl,
      );
      response.end();
    }
  });
  try {
    destinationUrl = await listenOnLoopback(destination);
    await run(await listenOnLoopback(source), destinationUrl, counts);
  } finally {
    await Promise.all([source, destination].map(closeLoopbackServer));
  }
}

for (const status of [301, 302, 303, 307, 308]) {
  for (const kind of ["external", "same-origin", "chain"]) {
    test(`real HTTP ${status} ${kind} document redirect sends zero destination requests`, async () => {
      await localTransport(async (source, _destination, counts) => {
        const login = `${source}${status}-${kind}`;
        await assert.rejects(
          withFreshLoginPage(async (page) => {
            await guardLoginRequests(
              page.context(),
              new URL(source).origin,
              login,
            );
            await page.goto(login);
          }),
        );
        assert.equal(counts.get(`/${status}-${kind}`), 1);
        assert.equal(counts.get("/hop") ?? 0, 0);
        assert.equal(counts.get("/unapproved") ?? 0, 0);
        assert.equal(counts.get("destination") ?? 0, 0);
      });
    });
  }
}

test("approved same-origin document and non-navigation POST remain usable", async () => {
  await localTransport(async (source, _destination, counts) => {
    await withFreshLoginPage(async (page) => {
      const assertAllowed = await guardLoginRequests(
        page.context(),
        new URL(source).origin,
        source,
      );
      await page.goto(source);
      assert.equal(
        await page.evaluate(
          async () =>
            (await fetch("/api", { method: "POST", body: "owned-value" }))
              .status,
        ),
        200,
      );
      assertAllowed();
    });
    assert.equal(counts.get("/"), 1);
    assert.equal(counts.get("/api"), 1);
    assert.equal(counts.get("destination") ?? 0, 0);
  });
});

for (const action of [
  "fetch",
  "form",
  "iframe-form",
  "fetch-redirect-chain",
  "fetch-redirect-external",
  "websocket",
]) {
  test(`real ${action} submission sends zero unintended requests`, async () => {
    await localTransport(async (source, destination, counts) => {
      await assert.rejects(
        withFreshLoginPage(async (page) => {
          const assertAllowed = await guardLoginRequests(
            page.context(),
            new URL(source).origin,
            source,
          );
          await page.goto(source);
          const url = action.startsWith("fetch-redirect")
            ? `${source}307-${action.endsWith("chain") ? "chain" : "external"}`
            : destination;
          if (action === "websocket") {
            await page.evaluate(
              (destination) =>
                new Promise<void>((resolve) => {
                  const socket = new WebSocket(
                    destination.replace("http:", "ws:"),
                  );
                  socket.onerror = () => {
                    resolve();
                  };
                  socket.onclose = () => {
                    resolve();
                  };
                }),
              destination,
            );
            assertAllowed();
            return;
          }
          const failed = page.waitForEvent("requestfailed", {
            predicate: (request) => request.url() === url,
          });
          await page.evaluate(
            ({ url, action, canary }) => {
              if (action.startsWith("fetch")) {
                void fetch(url, {
                  method: "POST",
                  body: canary.password,
                }).catch(() => undefined);
              } else {
                const form = document.createElement("form");
                form.method = "POST";
                form.action = url;
                if (action === "iframe-form") {
                  const iframe = document.createElement("iframe");
                  iframe.name = "submission";
                  document.body.append(iframe);
                  form.target = iframe.name;
                }
                const input = document.createElement("input");
                input.name = "password";
                input.value = canary.password;
                form.append(input);
                document.body.append(form);
                form.submit();
              }
            },
            { url, action, canary },
          );
          await failed;
          assertAllowed();
        }),
      );
      assert.equal(counts.get("destination") ?? 0, 0);
      assert.equal(counts.get("/hop") ?? 0, 0);
      assert.equal(counts.get("/unapproved") ?? 0, 0);
      if (action.startsWith("fetch-redirect"))
        assert.equal(
          counts.get(`/307-${action.endsWith("chain") ? "chain" : "external"}`),
          1,
        );
    });
  });
}

for (const fault of ["context", "browser", "both"]) {
  for (const outcome of ["success", "failure", "cancel", "timeout"] as const) {
    test(`never-settling ${fault} close after ${outcome} is bounded, safe and disposes provider`, async () => {
      const { descriptor, request, provider } = fixture();
      const controller = new AbortController();
      const owned = ownedBrowser(
        outcome === "failure"
          ? "wrong-logo"
          : outcome === "success"
            ? "success"
            : "waiting",
        outcome === "cancel"
          ? () => {
              controller.abort();
            }
          : undefined,
      );
      let contextAttempts = 0;
      let browserAttempts = 0;
      let cleanupStarted = 0;
      let rescue: (() => Promise<void>) | undefined;
      const started = Date.now();
      try {
        await assert.rejects(
          verifyPartayLogin(descriptor, request, provider, {
            signal: controller.signal,
            timeoutMs: 2000,
            launchBrowser: async (timeout) => {
              const browser = await owned.launchBrowser(timeout);
              const browserClose = browser.close.bind(browser);
              rescue = browserClose;
              browser.close = async () => {
                browserAttempts += 1;
                if (fault !== "context")
                  await new Promise<void>(() => undefined);
                else await browserClose();
              };
              const newContext = browser.newContext.bind(browser);
              browser.newContext = async (options) => {
                const context = await newContext(options);
                const contextClose = context.close.bind(context);
                context.close = async () => {
                  contextAttempts += 1;
                  cleanupStarted = Date.now();
                  if (fault !== "browser")
                    await new Promise<void>(() => undefined);
                  else await contextClose();
                };
                return context;
              };
              return browser;
            },
          }),
          (error) =>
            assertFailure(
              error,
              outcome === "success"
                ? "cleanup"
                : outcome === "failure"
                  ? "brand-text"
                  : outcome === "cancel"
                    ? "submit-click"
                    : "overlay-dismissal",
              "unconfirmed",
            ),
        );
        assert.ok(
          Date.now() - started < 2000 + LOGIN_CLEANUP_TIMEOUT_MS + 1500,
        );
        assert.equal(contextAttempts, 1);
        assert.equal(browserAttempts, 1);
        assert.equal(owned.submissions, 1);
        assert.ok(Date.now() - cleanupStarted < LOGIN_CLEANUP_TIMEOUT_MS + 300);
        await assertDisposed(provider, request);
      } finally {
        await rescue?.();
      }
    });
  }
}
