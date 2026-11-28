// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Exercises the login contract against owned local transport fixtures with synthetic credentials; no real customer login or external traffic is performed.
import { fake } from "./fixtures/fake-playwright";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { mock, test } from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  type Browser,
  type BrowserContext,
  type Route,
  type WebSocketRoute,
} from "@playwright/test";
import type { RuntimeSecretProvider } from "../src/input-preparation";
import {
  RuntimeLoginFailure,
  RUNTIME_LOGIN_FAILURE_STAGES,
  RUNTIME_LOGIN_CLEANUP_STATUSES,
  RUNTIME_LOGIN_POLICY_REASONS,
  consumeRuntimeLoginInputs,
} from "../src/input-preparation/runtime-login";
import {
  verifyPartayLogin,
  partayLoginFailureReport,
  privateFileAndVerifyPartayLogin,
} from "../src/customer-login/partay";
import {
  guardLoginRequests,
  withFreshLoginPage,
} from "../src/execution/runtime-login-browser";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fsPromises from "node:fs/promises";
import * as runtimeLoginModule from "../src/input-preparation/runtime-login";
import { tmpdir } from "node:os";
import {
  PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE,
  PrivateFileLoginDeferredError,
  withPrivateFileLoginInputs,
} from "../src/input-preparation/private-login-file";
import { settle } from "./fixtures/settle";
import {
  assertDisposed,
  assertFailure,
  canary,
  fixture,
  noop,
} from "./fixtures/partay-login-helpers";

test("private-file entry points reject before touching or consuming synthetic input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "owned-private-login-"));
  const file = join(directory, "account.json");
  const repositoryRoot = join(directory, "repository");
  const contents = JSON.stringify(canary);
  const { descriptor, request, provider } = fixture();
  provider.dispose();
  let consumed = 0;
  let browserAcquisitions = 0;
  try {
    await mkdir(repositoryRoot, { mode: 0o700 });
    await writeFile(file, contents, { mode: 0o600 });
    const fileSpies = [
      mock.method(fsPromises, "access"),
      mock.method(fsPromises, "lstat"),
      mock.method(fsPromises, "open"),
      mock.method(fsPromises, "readFile"),
      mock.method(fsPromises, "realpath"),
      mock.method(fsPromises, "stat"),
      mock.method(fsPromises, "unlink"),
    ];
    const providerSpy = mock.method(
      runtimeLoginModule,
      "InMemoryRuntimeSecretProvider",
    );
    const consumerSpy = mock.method(
      runtimeLoginModule,
      "consumeRuntimeLoginInputs",
    );
    try {
      await assert.rejects(
        withPrivateFileLoginInputs(
          descriptor,
          request,
          file,
          repositoryRoot,
          () => {
            consumed += 1;
            return Promise.resolve();
          },
        ),
        assertPrivateFileDeferred,
      );
      await assert.rejects(
        privateFileAndVerifyPartayLogin(
          descriptor,
          request,
          file,
          repositoryRoot,
          {
            launchBrowser: () => {
              browserAcquisitions += 1;
              return Promise.reject(
                new Error("Unexpected browser acquisition"),
              );
            },
          },
        ),
        assertPrivateFileDeferred,
      );
      assert.deepEqual(
        fileSpies.map((spy) => spy.mock.calls.length),
        [0, 0, 0, 0, 0, 0, 0],
      );
      assert.equal(providerSpy.mock.calls.length, 0);
      assert.equal(consumerSpy.mock.calls.length, 0);
      assert.equal(consumed, 0);
      assert.equal(browserAcquisitions, 0);
    } finally {
      for (const spy of fileSpies) spy.mock.restore();
      providerSpy.mock.restore();
      consumerSpy.mock.restore();
    }
    assert.equal(await readFile(file, "utf8"), contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function assertPrivateFileDeferred(error: unknown): boolean {
  assert.ok(error instanceof PrivateFileLoginDeferredError);
  assert.equal(error.message, PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE);
  assert.ok(!inspect(error).includes(canary.username));
  assert.ok(!inspect(error).includes(canary.password));
  return true;
}

test("CLI rejects private-account-file mode before reading references or dispatching login", async () => {
  const directory = await mkdtemp(join(tmpdir(), "owned-private-cli-"));
  const file = join(directory, "account.json");
  const contents = JSON.stringify(canary);
  try {
    await writeFile(file, contents, { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [join(__dirname, "fixtures/private-file-cli.js"), file],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      referenceReads: 0,
      promptCalls: 0,
      fileCalls: 0,
    });
    assert.equal(result.stderr, `${PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE}\n`);
    assert.equal(await readFile(file, "utf8"), contents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI help documents that private-account-file input is deferred from MVP", () => {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, "verify-partay-login.js"), "--help"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--private-account-file/);
  assert.match(result.stdout, /deferred and excluded from the MVP/);
  assert.equal(result.stderr, "");
});

test("failure reports allowlist both dimensions and never serialize arbitrary errors or causes", () => {
  for (const stage of RUNTIME_LOGIN_FAILURE_STAGES) {
    for (const status of RUNTIME_LOGIN_CLEANUP_STATUSES) {
      const error = new RuntimeLoginFailure(stage, status);
      Object.assign(error, {
        message: canary.password,
        cause: new Error(canary.username),
        request: canary,
      });
      assert.deepEqual(partayLoginFailureReport(error), {
        status: "not-verified",
        failureStage: stage,
        failureClassification: "unknown",
        cleanupStatus: status,
        automaticRetryAttempted: false,
      });
    }
  }
  for (const value of [
    canary.password,
    new Error(canary.password, { cause: canary.username }),
    { failureStage: canary.username, cleanupStatus: canary.password },
    undefined,
  ]) {
    assert.deepEqual(partayLoginFailureReport(value), {
      status: "not-verified",
      failureStage: "unclassified",
      failureClassification: "unknown",
      cleanupStatus: "unconfirmed",
      automaticRetryAttempted: false,
    });
    const error = new RuntimeLoginFailure(value, value);
    assertFailure(error, "unclassified", "unconfirmed");
    const poisoned = Object.assign(
      new RuntimeLoginFailure("navigation", "confirmed"),
      { failureStage: value, cleanupStatus: value },
    );
    assert.deepEqual(
      partayLoginFailureReport(poisoned),
      partayLoginFailureReport(undefined),
    );
  }
});

test("policy reason accepts only primitive allowlisted values and ignores poisoned accessors", () => {
  let invoked = 0;
  const poison = {
    toString() {
      invoked += 1;
      throw new Error(canary.password);
    },
    toJSON() {
      invoked += 1;
      return canary.password;
    },
  };
  for (const value of [
    canary.password,
    `http-redirect ${canary.username}`,
    "https://owned.invalid/private",
    ["off-origin"],
    poison,
    new String("websocket"),
    null,
    undefined,
  ]) {
    assertFailure(
      new RuntimeLoginFailure("request-policy", "confirmed", value),
      "request-policy",
      "confirmed",
    );
    const poisoned = Object.assign(
      new RuntimeLoginFailure("request-policy", "confirmed"),
      { policyReason: value, cause: new Error(canary.password) },
    );
    assertFailure(
      RuntimeLoginFailure.fromUnknown(poisoned),
      "request-policy",
      "confirmed",
    );
  }
  const accessor = new RuntimeLoginFailure(
    "request-policy",
    "confirmed",
    "off-origin",
  );
  for (const key of [
    "failureStage",
    "cleanupStatus",
    "policyReason",
    "failureClassification",
  ]) {
    Object.defineProperty(accessor, key, {
      get() {
        invoked += 1;
        throw new Error(canary.password);
      },
    });
  }
  assert.deepEqual(
    partayLoginFailureReport(accessor),
    partayLoginFailureReport(undefined),
  );
  const proxy = new Proxy(accessor, {
    getOwnPropertyDescriptor() {
      throw new Error(canary.password);
    },
  });
  assert.deepEqual(
    partayLoginFailureReport(proxy),
    partayLoginFailureReport(undefined),
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(
    partayLoginFailureReport(revoked.proxy),
    partayLoginFailureReport(undefined),
  );
  assert.equal(invoked, 0);
});

for (const reason of RUNTIME_LOGIN_POLICY_REASONS) {
  test(`offline ${reason} propagates through guard, cleanup, input disposal and CLI without raw data`, async () => {
    const { descriptor, request, provider } = fixture();
    let handleRequest!: (route: Route) => Promise<void>;
    let handleSocket!: (socket: WebSocketRoute) => void;
    let fetched = 0;
    let aborted = 0;
    let disposed = 0;
    let socketClosed = 0;
    const context = fake<BrowserContext>({
      route: (_pattern: string, handler: typeof handleRequest) => {
        handleRequest = handler;
        return Promise.resolve();
      },
      routeWebSocket: (_pattern: string, handler: typeof handleSocket) => {
        handleSocket = handler;
        return Promise.resolve();
      },
    });
    const login = "http://127.0.0.1:1/";
    const assertAllowed = await guardLoginRequests(
      context,
      new URL(login).origin,
      login,
    );
    const route = fake<Route>({
      request: () => ({
        url: () =>
          reason === "off-origin"
            ? `http://127.0.0.1:2/${canary.password}`
            : reason === "document-destination"
              ? `${login}${canary.password}`
              : login,
        isNavigationRequest: () => true,
      }),
      abort: () => {
        aborted += 1;
        return Promise.resolve();
      },
      fetch: (options: unknown) =>
        settle(() => {
          fetched += 1;
          assert.deepEqual(options, { maxRedirects: 0 });
          if (reason === "transport-error")
            throw new Error(canary.password, { cause: canary.username });
          return {
            status: () => 302,
            dispose: () => {
              disposed += 1;
              return Promise.resolve();
            },
          };
        }),
      fulfill: () =>
        settle(() => assert.fail("Blocked response must not be fulfilled")),
    });
    if (reason === "websocket")
      handleSocket(
        fake<WebSocketRoute>({
          close: () => {
            socketClosed += 1;
          },
        }),
      );
    else await handleRequest(route);
    assert.equal(
      fetched,
      ["http-redirect", "transport-error"].includes(reason) ? 1 : 0,
    );
    assert.equal(disposed, reason === "http-redirect" ? 1 : 0);
    assert.equal(aborted, reason === "websocket" ? 0 : 1);
    assert.equal(socketClosed, reason === "websocket" ? 1 : 0);
    // A later failure must not replace the first category.
    await handleRequest(
      fake<Route>({
        ...route,
        fetch: () => Promise.reject(new Error(canary.password)),
        request: () => ({ url: () => login, isNavigationRequest: () => false }),
      }),
    );
    let closes = 0;
    let launches = 0;
    await assert.rejects(
      consumeRuntimeLoginInputs(
        descriptor,
        request,
        {
          resolve: provider.resolve.bind(provider),
          dispose: () => {
            provider.dispose();
            throw new Error(canary.password);
          },
        },
        async () =>
          withFreshLoginPage(
            (_page, setStage) =>
              settle(() => {
                setStage("request-policy");
                assertAllowed();
              }),
            {
              launchBrowser: () => {
                launches += 1;
                return Promise.resolve(
                  fake<Browser>({
                    close: () => {
                      closes += 1;
                      return Promise.resolve();
                    },
                    newContext: () =>
                      Promise.resolve({
                        setOffline: () => Promise.resolve(),
                        close: () => {
                          closes += 1;
                          return Promise.resolve();
                        },
                        newPage: () =>
                          Promise.resolve({
                            setDefaultTimeout: noop,
                            setDefaultNavigationTimeout: noop,
                          }),
                      }),
                  }),
                );
              },
            },
          ),
      ),
      (error) => assertFailure(error, "request-policy", "confirmed", reason),
    );
    assert.equal(launches, 1);
    assert.equal(closes, 2);
    await assertDisposed(provider, request);

    // Exercise the real CLI serializer with an in-process stub; no prompt,
    // customer navigation, files, credentials or runtime request is needed.
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const runtime = require(${JSON.stringify(join(__dirname, "../src/input-preparation/runtime-login.js"))});
      const partay = require(${JSON.stringify(join(__dirname, "../src/customer-login/partay.js"))});
      const fs = require("node:fs");
      const read = fs.readFileSync;
      fs.readFileSync = (path, ...args) =>
        path === "descriptor" || path === "request" ? "{}" : read(path, ...args);
      process.argv = [process.execPath, "owned-cli", "descriptor", "request"];
      partay.promptAndVerifyPartayLogin = async () => {
        const error = new runtime.RuntimeLoginFailure("request-policy", "confirmed", ${JSON.stringify(reason)});
        error.message = ${JSON.stringify(canary.password)};
        error.cause = new Error(${JSON.stringify(canary.username)});
        throw error;
      };
      require(${JSON.stringify(join(__dirname, "verify-partay-login.js"))});
    `,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(
      JSON.parse(result.stderr),
      partayLoginFailureReport(
        new RuntimeLoginFailure("request-policy", "confirmed", reason),
      ),
    );
  });
}

test("shared boundary reconstructs only safe metadata and disposes even when disposal throws", async () => {
  const { descriptor, request, provider } = fixture();
  let disposals = 0;
  const poisoned = Object.assign(
    new RuntimeLoginFailure("navigation", "confirmed"),
    {
      message: canary.password,
      cause: new Error(canary.username),
      request: canary,
    },
  );
  const wrapped: RuntimeSecretProvider = {
    resolve: provider.resolve.bind(provider),
    dispose: () => {
      disposals += 1;
      provider.dispose();
      throw new Error(canary.password);
    },
  };
  await assert.rejects(
    consumeRuntimeLoginInputs(descriptor, request, wrapped, () =>
      Promise.reject(poisoned),
    ),
    (error) => assertFailure(error, "navigation", "confirmed"),
  );
  assert.equal(disposals, 1);
  await assertDisposed(provider, request);
});

test("provider disposal failure after consumer completion cannot produce a receipt", async () => {
  const { descriptor, request, provider } = fixture();
  let disposals = 0;
  await assert.rejects(
    consumeRuntimeLoginInputs(
      descriptor,
      request,
      {
        resolve: provider.resolve.bind(provider),
        dispose: () => {
          disposals += 1;
          provider.dispose();
          throw new Error(canary.password);
        },
      },
      () => Promise.resolve(),
    ),
    (error) => assertFailure(error, "input-disposal", "unconfirmed"),
  );
  assert.equal(disposals, 1);
  await assertDisposed(provider, request);
});

test("interrupted pending launcher cannot report not-acquired or confirmed cleanup", async () => {
  const { descriptor, request, provider } = fixture();
  const controller = new AbortController();
  let launches = 0;
  await assert.rejects(
    verifyPartayLogin(descriptor, request, provider, {
      signal: controller.signal,
      launchBrowser: async () => {
        launches += 1;
        controller.abort();
        return new Promise<Browser>(() => undefined);
      },
    }),
    (error) => assertFailure(error, "browser-startup", "unconfirmed"),
  );
  assert.equal(launches, 1);
  await assertDisposed(provider, request);
});

test("CLI input failures emit only safe structured metadata and no success receipt", () => {
  for (const args of [[], [canary.username, canary.password]]) {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, "verify-partay-login.js"), ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      status: "not-verified",
      failureStage: "input-validation",
      failureClassification: "input",
      cleanupStatus: "not-acquired",
      automaticRetryAttempted: false,
    });
    assert.ok(!result.stderr.includes(canary.username));
    assert.ok(!result.stderr.includes(canary.password));
  }
});
