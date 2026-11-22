// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Shared login-command, loopback-server and reviewed-fixture helpers with synthetic inputs; it does not run a browser or customer journey.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  createOutlineFixtureFields,
  createValidationManifest,
} from "../fixtures/input-preparation/reviewed-fixtures";
import { RuntimeLoginFailure } from "../src/input-preparation/runtime-login";
import { createServer } from "node:http";
import {
  closeLoopbackServer,
  listenOnLoopback,
  withLoopbackServer,
} from "./fixtures/loopback-server";
import { runLoginCommand } from "./login-command";

const signalNames = ["SIGINT", "SIGTERM"] as const;

/**
 * Runs `work` synchronously like an async function body: a return resolves
 * the promise and a synchronous throw rejects it.
 */
function settle<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(work());
  });
}

/** Parses one line of written failure evidence after checking it is an object. */
function evidence(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  assert.ok(typeof parsed === "object" && parsed !== null);
  return parsed as Record<string, unknown>;
}

test("login commands remove only their own signal listeners after success and cancellation", async () => {
  for (const signalName of [undefined, "SIGINT", "SIGTERM"] as const) {
    const existing = (): void => undefined;
    process.on("SIGINT", existing);
    const before = signalNames.map((name) => process.listeners(name));
    try {
      await runLoginCommand((signal) =>
        settle(() => {
          assert.equal(signal.aborted, false);
          if (signalName) process.emit(signalName);
          assert.equal(signal.aborted, signalName !== undefined);
        }),
      );
      assert.deepEqual(
        signalNames.map((name) => process.listeners(name)),
        before,
      );
    } finally {
      process.removeListener("SIGINT", existing);
    }
  }
});

test("login commands preserve safe failure evidence without exposing unknown errors", async (context) => {
  const before = signalNames.map((name) => process.listeners(name));
  const exitCode = process.exitCode;
  const output: string[] = [];
  context.mock.method(process.stderr, "write", (text: string) => {
    output.push(text);
    return true;
  });
  try {
    for (const error of [
      new Error("SYNTHETIC_PRIVATE_ERROR_CANARY"),
      new RuntimeLoginFailure(
        "request-policy",
        "confirmed",
        "off-origin",
        "request-policy",
      ),
    ]) {
      await runLoginCommand(() => Promise.reject(error));
      assert.equal(process.exitCode, 1);
      assert.deepEqual(
        signalNames.map((name) => process.listeners(name)),
        before,
      );
    }
    assert.ok(!output.join("").includes("CANARY"));
    assert.equal(evidence(output[0]).failureStage, "unclassified");
    assert.equal(evidence(output[1]).policyReason, "off-origin");
    assert.equal(evidence(output[1]).cleanupStatus, "confirmed");
  } finally {
    process.exitCode = exitCode;
  }
});

test("owned loopback fixtures close on both successful and failing consumers", async () => {
  for (const fail of [false, true]) {
    let url = "";
    const failure = new Error("Owned fixture assertion failed");
    const run = withLoopbackServer(
      (_request, response) => response.end("owned"),
      async (target) => {
        url = target;
        assert.equal(await (await fetch(url)).text(), "owned");
        if (fail) throw failure;
      },
    );
    if (fail) await assert.rejects(run, (error) => error === failure);
    else await run;
    await assert.rejects(fetch(url));
  }
});

test("test servers start and stop only through the shared loopback helpers", () => {
  // Guard for RRDSCRUM-353: hand-written listen/close sequences leak sockets
  // because they skip server.closeAllConnections().
  const scriptsDir = join(__dirname, "..", "..", "..", "scripts");
  const files = [
    ...readdirSync(scriptsDir).map((name) => join(scriptsDir, name)),
    ...readdirSync(join(scriptsDir, "fixtures")).map((name) =>
      join(scriptsDir, "fixtures", name),
    ),
  ].filter(
    (file) => file.endsWith(".ts") && !file.endsWith("loopback-server.ts"),
  );
  assert.ok(files.length > 10);
  const offenders = files.filter((file) =>
    /\.listen\(\s*0\b/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(offenders, []);
});

test("closing a loopback server ends connections a handler never finished", async () => {
  // Guard for the closeAllConnections() call: without it close() waits for the held request forever.
  const server = createServer(() => {
    // Deliberately never responds: models a held keep-alive request.
  });
  const url = await listenOnLoopback(server);
  const held = fetch(url).then(
    () => "completed",
    () => "dropped",
  );
  await new Promise<void>((resolve) => server.once("connection", resolve));
  const closed = await Promise.race([
    closeLoopbackServer(server).then(() => "closed"),
    new Promise<string>((resolve) =>
      setTimeout(() => {
        resolve("timed out");
      }, 5_000).unref(),
    ),
  ]);
  assert.equal(closed, "closed");
  assert.equal(await held, "dropped");
});

test("every script test file starts with its classification header", () => {
  const scriptsDir = join(__dirname, "..", "..", "..", "scripts");
  const files = readdirSync(scriptsDir).filter((name) =>
    name.endsWith(".test.ts"),
  );
  assert.ok(files.length > 10);
  const offenders = files.filter((name) => {
    const text = readFileSync(join(scriptsDir, name), "utf8");
    const head = /^(?:\/\/[^\n]*\n)+|^\/\*\*[\s\S]*?\*\//.exec(text)?.[0];
    return !head?.includes("Test classification:");
  });
  assert.deepEqual(offenders, []);
});

test("reviewed test fixture factories return independent copies without broadening approval", () => {
  const manifest = createValidationManifest("review-a");
  const fields = createOutlineFixtureFields();
  assert.notEqual(manifest.steps, createValidationManifest("review-a").steps);
  assert.notEqual(
    fields["approved-outline/row-a"],
    createOutlineFixtureFields()["approved-outline/row-a"],
  );
  assert.equal(
    createValidationManifest("review-b").implementationRevision,
    "review-b",
  );
  assert.deepEqual(Object.keys(fields), [
    "approved-outline/row-a",
    "approved-outline/row-b",
  ]);
});
