import { createHash } from "node:crypto";
import { errors } from "playwright-core";
import {
  classifyCleanupError,
  cleanupDiagnosticsSchema,
} from "../src/execution/cleanup-diagnostics";
import {
  withIsolatedReviewedPackage,
  assertOriginalReviewUnaffected,
} from "./isolated-reviewed-package";
import { runtimePackagePath } from "../src/execution/reviewed-scenarios";
import childProcess, { type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";
import {
  executeOwnedLocalAdapter,
  executeOwnedLocalAdapterWithDiagnostics,
  validateOwnedLocalDiagnosticEnvelope,
  ownedLocalResultJsonSchema,
  getOwnedLocalReview,
  validateOwnedLocalEvidence,
  type OwnedLocalRequest,
} from "../src/adapter/v2";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, mock } from "node:test";
import {
  parseOwnedEvidence,
  readOwnedEvidence,
} from "../src/execution/owned-evidence";

const root = path.resolve(__dirname, "../../..");
const formatter = path.join(
  root,
  "dist/cucumber/src/execution/owned-evidence-formatter.js",
);
const names = [
  "the synthetic reviewed page is open",
  "I explore the owned local demo",
  "the owned local demo shows its synthetic workspace and project",
  "I return from the owned local demo to sign in",
  "the owned local sign in page is visible",
];
function configureFixture(directory: string, mode: string) {
  const support = path.join(directory, "steps.cjs");
  writeFileSync(
    support,
    `
      const {Given} = require(${JSON.stringify(require.resolve("@cucumber/cucumber"))});
      const names = ${JSON.stringify(names)};
      names.forEach((name, index) => Given(name, function () {
        if (${JSON.stringify(mode)} === "interrupted" && index === 2) process.exit(23);
        if (${JSON.stringify(mode)} === "business-failure" && index === 2) throw Error("SYNTHETIC_PRIVATE_CANARY");
      }));
      const fs = require("node:fs");
      const originalWrite = fs.writeFileSync;
      fs.writeFileSync = function (file, data, ...args) {
        if (file === process.env.WEB_EXECUTION_CLEANUP_PATH && ["malformed-diagnostic", "mismatched-diagnostic"].includes(${JSON.stringify(mode)})) {
          const report = JSON.parse(data);
          report.diagnostics = ${JSON.stringify(mode)} === "malformed-diagnostic" ? [{phase:"context-close",category:"PRIVATE_CANARY"}] : [{phase:"browser-close",category:"unclassified"}];
          data = JSON.stringify(report);
        }
        return originalWrite.call(this, file, data, ...args);
      };
      const Module = require("node:module");
      const originalLoad = Module._load;
      const browser = {
        newContext: async () => ({
          routeWebSocket: async () => {}, addInitScript: async () => {}, route: async () => {},
          newPage: async () => ({ setDefaultTimeout() {}, setDefaultNavigationTimeout() {} }),
          close: async () => { if (${JSON.stringify(mode)} !== "successful-cleanup") throw Error("SYNTHETIC_PRIVATE_CANARY"); },
        }),
        close: async () => {},
      };
      try {
        Module._load = function (name, ...args) {
          if(name === "@playwright/test") return {chromium: {connect: async () => browser}};
          return originalLoad.call(this, name, ...args);
        };
        require(${JSON.stringify(path.join(root, "dist/cucumber/features/execution/support/hooks.js"))});
      } finally { Module._load = originalLoad; }
    `,
  );
  const feature =
    mode === "unavailable-business"
      ? path.join(directory, "unreviewed.feature")
      : "fixtures/execution/reviewed-scenarios.feature";
  if (mode === "unavailable-business")
    writeFileSync(
      feature,
      readFileSync(
        path.join(root, "fixtures/execution/reviewed-scenarios.feature"),
      ),
    );
  const config = path.join(directory, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      default: {
        paths: [feature],
        require: [support],
        tags: "@scenario-id=local-demo-navigation",
      },
    }),
  );
  return config;
}
function runFixture(mode: string) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "rr139-teardown-evidence-"),
  );
  const snapshot = path.join(directory, "safe.json");
  const report = path.join(directory, "cucumber.json");
  const marker = path.join(directory, "cleanup.json");
  try {
    const config = configureFixture(directory, mode);
    // Keep this fixture usable against the parent tree for a real red baseline.
    const formats = existsSync(formatter)
      ? ["--format", `${formatter}:${snapshot}`]
      : [];
    const child = spawnSync(
      process.execPath,
      [
        path.join(
          path.dirname(runtimePackagePath("@cucumber/cucumber")),
          "bin/cucumber.js",
        ),
        "--config",
        path.relative(root, config),
        "--format",
        `json:${report}`,
        ...formats,
      ],
      {
        cwd: root,
        timeout: 10000,
        stdio: "ignore",
        env: {
          ...process.env,
          WEB_EXECUTION_PAYLOAD: JSON.stringify({
            scenario: {
              id: "local-demo-navigation",
              values: { displayName: "Synthetic" },
            },
            environment: {
              initialTargetUrl: "http://127.0.0.1:3001/",
              approvedOrigin: "http://127.0.0.1:3001",
            },
            redirectTargetUrl: "http://127.0.0.1:3002/",
          }),
          WEB_EXECUTION_BROWSER_ENDPOINT: "ws://127.0.0.1:3003",
          WEB_EXECUTION_CLEANUP_PATH: marker,
        },
      },
    );
    assert.equal(child.error, undefined);

    if (mode !== "interrupted")
      assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), {
        status: "unknown",
        failures: ["context-close"],
        injectedFailure: false,
        diagnostics: [{ phase: "context-close", category: "unclassified" }],
      });
    assert.equal(
      child.status,
      mode === "interrupted" ? 23 : 1,
      "original worker failure is preserved",
    );
    assert.throws(
      () => JSON.parse(readFileSync(report, "utf8")),
      "AfterAll failure prevents normal JSON finalization",
    );
    return existsSync(snapshot) ? readFileSync(snapshot, "utf8") : "";
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("completed business evidence survives a failing After and AfterAll without raw errors", () => {
  const raw = runFixture("cleanup-failure");
  const snapshot = JSON.parse(raw);
  assert.deepEqual(
    snapshot.steps,
    names.map(() => "passed"),
  );
  assert.equal(raw.includes("SYNTHETIC_PRIVATE_CANARY"), false);
  assert.ok(Buffer.byteLength(raw) <= 1024);
});

test("failed business steps remain failed while later steps stay skipped", () => {
  const raw = runFixture("business-failure");
  assert.deepEqual(
    parseOwnedEvidence(raw, "local-demo-navigation")?.steps.map(
      (step) => step.status,
    ),
    ["passed", "passed", "failed", "skipped", "skipped"],
  );
  assert.equal(raw.includes("SYNTHETIC_PRIVATE_CANARY"), false);
});

test("interruption before testCaseFinished supplies no completed-case evidence", () => {
  assert.equal(
    parseOwnedEvidence(runFixture("interrupted"), "local-demo-navigation"),
    undefined,
  );
});

test("partial, repeated, mismatched and oversized snapshots fail closed", () => {
  const valid = JSON.stringify({
    schemaVersion: 1,
    scenarioId: "local-demo-navigation",
    steps: names.map(() => "passed"),
  });
  assert.equal(parseOwnedEvidence(valid, "browser-flow"), undefined);
  for (const raw of [
    "",
    "{",
    valid + valid,
    valid.replace('"passed"', '"forged"'),
    valid.replace("schemaVersion", "unexpected"),
    JSON.stringify({
      schemaVersion: 1,
      scenarioId: "local-demo-navigation",
      steps: ["passed"],
    }),
    " ".repeat(1025) + valid,
  ]) {
    assert.equal(parseOwnedEvidence(raw, "local-demo-navigation"), undefined);
  }
});

test("snapshot shape accepts all six top-level key orders", () => {
  const entries: [string, unknown][] = [
    ["schemaVersion", 1],
    ["scenarioId", "local-demo-navigation"],
    ["steps", names.map(() => "passed")],
  ];
  for (const order of [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]) {
    const raw = JSON.stringify(
      Object.fromEntries(order.map((index) => entries[index])),
    );
    assert.deepEqual(
      parseOwnedEvidence(raw, "local-demo-navigation")?.steps,
      names.map((name) => ({ name, status: "passed" })),
    );
  }
});

test("snapshot shape rejects non-objects, missing or extra keys and deceptive property names", () => {
  const entries: [string, unknown][] = [
    ["schemaVersion", 1],
    ["scenarioId", "local-demo-navigation"],
    ["steps", names.map(() => "passed")],
  ];
  const valid = Object.fromEntries(entries);
  const invalid: unknown[] = [
    null,
    false,
    true,
    1,
    "scenarioId,schemaVersion,steps",
    [],
    [valid],
    {},
    { ...valid, schemaVersion: "1" },
    { ...valid, schemaVersion: 2 },
    { ...valid, scenarioId: "browser-flow" },
    { ...valid, steps: { length: 5 } },
    { ...valid, steps: ["passed", "passed", null, "passed", "passed"] },
  ];
  for (let omitted = 0; omitted < entries.length; omitted++) {
    const remaining = entries.filter((_, index) => index !== omitted);
    invalid.push(Object.fromEntries(remaining));
    for (const key of [
      "",
      "extra",
      "__proto__",
      "constructor",
      "toString",
      "scenarioId,schemaVersion,steps",
      "schemaVersion\u0000",
      "SchemaVersion",
      "\uff53chemaVersion",
    ]) {
      // fromEntries preserves __proto__ as an own data key in the JSON input.
      invalid.push(Object.fromEntries([...remaining, [key, 1]]));
      invalid.push(Object.fromEntries([...entries, [key, 1]]));
    }
  }
  for (const value of invalid) {
    assert.equal(
      parseOwnedEvidence(JSON.stringify(value), "local-demo-navigation"),
      undefined,
    );
  }
});

test("snapshot reader rejects unsafe filesystem types and size before reading", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rr139-evidence-input-"));
  try {
    const file = path.join(directory, "evidence"),
      link = path.join(directory, "link"),
      fifo = path.join(directory, "fifo");
    writeFileSync(file, "x".repeat(1025));
    symlinkSync(file, link);
    assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
    // Bound any accidental FIFO blocking in a subprocess rather than the test runner.
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const assert=require("node:assert/strict");
      const {readOwnedEvidence}=require(${JSON.stringify(path.join(root, "dist/cucumber/src/execution/owned-evidence.js"))});
      for(const file of ${JSON.stringify([file, link, fifo, directory])}) assert.equal(readOwnedEvidence(file,"local-demo-navigation"),undefined);
    `,
      ],
      { timeout: 3000, stdio: "ignore" },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.equal(
      readOwnedEvidence(
        path.join(directory, "missing"),
        "local-demo-navigation",
      ),
      undefined,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const { diagnosticsEnabled, mode } of [
  { diagnosticsEnabled: false, mode: "cleanup-failure" },
  ...[
    "cleanup-failure",
    "concurrent-cleanup-failure",
    "successful-cleanup",
    "malformed-diagnostic",
    "mismatched-diagnostic",
    "unavailable-business",
  ].map((mode) => ({ diagnosticsEnabled: true, mode })),
]) {
  test(`v2 runner retains completed steps and operational failure through actual hooks (${mode}, diagnostics=${diagnosticsEnabled})`, async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "rr139-runner-evidence-"),
    );
    const config = configureFixture(directory, mode);
    const originalSpawn = childProcess.spawn;
    // Owned inert child stands in for the browser process; no browser is launched.
    const browserChildren: {
      child: ReturnType<typeof originalSpawn>;
      exited: Promise<unknown>;
    }[] = [];
    const launch = mock.method(chromium, "launchServer", async () => {
      const child = originalSpawn(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { stdio: "ignore" },
      );
      const exited = once(child, "exit");
      browserChildren.push({ child, exited });
      return {
        process: () => child,
        wsEndpoint: () => "ws://127.0.0.1:3003",
        close: async () => {
          child.kill();
          await exited;
        },
        kill: async () => {
          child.kill("SIGKILL");
          await exited;
        },
      } as never;
    });
    const worker = mock.method(
      childProcess,
      "spawn",
      (command: string, args: readonly string[], options: SpawnOptions) => {
        const argv = [...args];
        const index = argv.indexOf("--config");
        assert.ok(index > 0, "only the Cucumber worker is substituted");
        argv[index + 1] = path.relative(root, config);
        return originalSpawn(command, argv, options);
      },
    );
    try {
      const review = await getOwnedLocalReview();
      const request: OwnedLocalRequest = {
        version: 2,
        run: { id: "synthetic-run", gitRevision: "a".repeat(40) },
        target: {
          kind: "owned-local",
          id: "synthetic-target",
          origin: "http://127.0.0.1:34567",
        },
        scenarioIds: ["local-demo-navigation"],
        binding: {
          tenantId: "synthetic-tenant",
          projectId: "synthetic-project",
          environmentId: "synthetic-dev",
          caseId: "synthetic-case",
          caseRevision: 1,
          caseSourceHash: "b".repeat(64),
          dataRevision: "c".repeat(64),
          configurationRevision: "d".repeat(64),
          implementationRevision: review.approval.implementationRevision,
          approvalId: "synthetic-approval",
          attempt: 1,
        },
        ...review,
        limits: {
          runTimeoutMs: 20000,
          scenarioTimeoutMs: 15000,
          maxConcurrentScenarios: 1,
          retryCount: 0,
        },
      };
      let admissions = 0;
      const execution = diagnosticsEnabled
        ? executeOwnedLocalAdapterWithDiagnostics
        : executeOwnedLocalAdapter;
      const invocationCount = mode === "concurrent-cleanup-failure" ? 2 : 1;
      const settlements = await Promise.allSettled(
        Array.from({ length: invocationCount }, () =>
          execution(
            request,
            {
              version: 2,
              authorization: "owned-local",
              callerId: "synthetic-owner",
              request,
              approval: { active: true, expiresAt: Date.now() + 60000 },
            },
            undefined,
            async () => {
              admissions++;
            },
          ),
        ),
      );
      // Both invocations must settle before shared mocks or fixtures are restored.
      const outcomes = settlements.map((settlement) => {
        if (settlement.status === "rejected") throw settlement.reason;
        return settlement.value;
      });
      for (const outcome of outcomes) {
        const result =
          "diagnosticsVersion" in outcome ? outcome.result : outcome;
        if ("diagnosticsVersion" in outcome) {
          assert.equal(
            validateOwnedLocalDiagnosticEnvelope(request, outcome),
            true,
          );
          assert.deepEqual(
            outcome.cleanupDiagnostics,
            mode.endsWith("cleanup-failure")
              ? [
                  {
                    attemptNumber: 1,
                    scenarioId: "local-demo-navigation",
                    phase: "context-close",
                    category: "unclassified",
                  },
                ]
              : [],
          );
          const entry = {
            attemptNumber: 1,
            scenarioId: "local-demo-navigation",
            phase: "context-close",
            category: "unclassified",
          };
          for (const cleanupDiagnostics of [
            [{ ...entry, category: "PRIVATE_CANARY" }],
            [{ ...entry, message: "PRIVATE_CANARY" }],
            [entry, entry],
            [{ ...entry, phase: "browser-close" }],
            [{ ...entry, attemptNumber: 2 }],
          ]) {
            assert.equal(
              validateOwnedLocalDiagnosticEnvelope(request, {
                ...outcome,
                cleanupDiagnostics,
              }),
              false,
            );
          }
          assert.equal(
            validateOwnedLocalDiagnosticEnvelope(request, {
              ...outcome,
              diagnosticsVersion: 2,
            }),
            false,
          );
          assert.equal(
            JSON.stringify(outcome).includes("SYNTHETIC_PRIVATE_CANARY"),
            false,
          );
        }
        assert.equal(
          JSON.stringify(result).includes("cleanupDiagnostics"),
          false,
        );
        assert.equal(admissions, invocationCount);
        assert.equal(launch.mock.callCount(), invocationCount);
        assert.equal(worker.mock.callCount(), invocationCount);
        assert.equal(result.accepted, true);
        if (!result.accepted) throw new Error("Expected accepted execution");
        assert.equal(validateOwnedLocalEvidence(request, result), true);
        assert.equal(
          result.report.status,
          mode === "successful-cleanup" ? "passed" : "incomplete",
        );
        assert.equal(
          result.report.scenarios[0].status,
          mode === "successful-cleanup" ? "passed" : "incomplete",
        );
        assert.equal(
          result.report.scenarios[0].evidenceStatus,
          mode === "unavailable-business" ? "unavailable" : "available",
        );
        assert.equal(
          result.report.scenarios[0].executionState,
          mode === "unavailable-business" ? "unknown" : "executed",
        );
        assert.deepEqual(
          result.report.scenarios[0].steps.map((step) => step.status),
          mode === "unavailable-business" ? [] : names.map(() => "passed"),
        );
        assert.deepEqual(
          result.lifecycle.attempts[0].scenarios[0].cleanupFailures,
          mode === "successful-cleanup"
            ? []
            : [
                mode === "malformed-diagnostic" ||
                mode === "mismatched-diagnostic"
                  ? "cleanup-evidence-missing"
                  : "context-close",
              ],
        );
        assert.equal(
          result.lifecycle.attempts[0].scenarios[0].workerStopped,
          true,
        );
        // Existing engine behavior: process termination confirms resource cleanup,
        // while the earlier context-close failure and incomplete outcome stay visible.
        assert.equal(result.lifecycle.resourceCleanup.status, "confirmed");
        assert.equal(
          result.lifecycle.resourceCleanup.browserProcessStopped,
          true,
        );
        assert.equal(
          JSON.stringify(result).includes("SYNTHETIC_PRIVATE_CANARY"),
          false,
        );
      }
      if (
        outcomes.length === 2 &&
        "diagnosticsVersion" in outcomes[0] &&
        "diagnosticsVersion" in outcomes[1]
      ) {
        assert.notEqual(
          outcomes[0].cleanupDiagnostics,
          outcomes[1].cleanupDiagnostics,
        );
        outcomes[0].cleanupDiagnostics.length = 0;
        assert.equal(outcomes[1].cleanupDiagnostics.length, 1);
      }
    } finally {
      worker.mock.restore();
      launch.mock.restore();
      for (const { child, exited } of browserChildren) {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("formatter refuses identity mismatch, incomplete results and retries; emits once", async () => {
  const { EventEmitter } = await import("node:events");
  const { default: OwnedEvidenceFormatter } = await import(
    "../src/execution/owned-evidence-formatter"
  );
  const base = {
    attempt: 0,
    willBeRetried: false,
    pickle: {
      uri: "fixtures/execution/reviewed-scenarios.feature",
      name: "A visitor explores the owned local demo and returns to sign in",
      tags: [{ name: "@scenario-id=local-demo-navigation" }],
      steps: names.map((text, i) => ({ id: String(i), text })),
    },
    gherkinDocument: {
      feature: { name: "Execute reviewed synthetic scenarios" },
    },
    testCase: {
      testSteps: names.map((_, i) => ({
        id: String(i),
        pickleStepId: String(i),
      })),
    },
    stepResults: Object.fromEntries(
      names.map((_, i) => [
        String(i),
        { status: "PASSED", message: "SYNTHETIC_PRIVATE_CANARY" },
      ]),
    ),
  };
  const variants = [
    { ...base, willBeRetried: true },
    { ...base, attempt: 1 },
    { ...base, pickle: { ...base.pickle, uri: "unapproved" } },
    { ...base, pickle: { ...base.pickle, name: "SYNTHETIC_PRIVATE_CANARY" } },
    { ...base, pickle: { ...base.pickle, steps: base.pickle.steps.slice(1) } },
    { ...base, stepResults: {} },
  ];
  for (const attempt of [...variants, base]) {
    const events = new EventEmitter(),
      output: string[] = [];
    new OwnedEvidenceFormatter({
      parsedArgvOptions: {},
      eventBroadcaster: events,
      eventDataCollector: { getTestCaseAttempt: () => attempt },
      log: (line: string) => output.push(line),
    } as never);
    events.emit("envelope", {
      testCaseFinished: { testCaseStartedId: "synthetic" },
    });
    events.emit("envelope", {
      testCaseFinished: { testCaseStartedId: "synthetic" },
    });
    assert.equal(output.length, attempt === base ? 1 : 0);
    assert.equal(output.join("").includes("SYNTHETIC_PRIVATE_CANARY"), false);
  }
});

test("new source and runtime helpers are fingerprinted; changed artifacts reject stale review", async () => {
  await withIsolatedReviewedPackage(async (isolated) => {
    const { calculateReviewedImplementationRevision, loadReviewedScenarios } =
      (await import(
        path.join(isolated, "dist/cucumber/src/execution/reviewed-scenarios.js")
      )) as typeof import("../src/execution/reviewed-scenarios");
    await loadReviewedScenarios();
    const baseline = calculateReviewedImplementationRevision();
    for (const file of [
      "src/execution/owned-evidence.ts",
      "src/execution/owned-evidence-formatter.ts",
      "dist/cucumber/src/execution/owned-evidence.js",
      "dist/cucumber/src/execution/owned-evidence-formatter.js",
    ]) {
      const full = path.join(isolated, file),
        original = readFileSync(full);
      try {
        writeFileSync(
          full,
          Buffer.concat([
            original,
            Buffer.from("\n// synthetic identity mutation\n"),
          ]),
        );
        assert.notEqual(calculateReviewedImplementationRevision(), baseline);
        await assert.rejects(loadReviewedScenarios(), /review is stale/);
        assertOriginalReviewUnaffected(file, isolated, original);
      } finally {
        writeFileSync(full, original);
      }
      assert.equal(calculateReviewedImplementationRevision(), baseline);
      await loadReviewedScenarios();
    }
  });
});

test("isolated package is removed even when a mutation assertion fails", async () => {
  let owned = "";
  await assert.rejects(
    withIsolatedReviewedPackage(async (isolated) => {
      owned = isolated;
      writeFileSync(
        path.join(isolated, "src/execution/owned-evidence.ts"),
        "synthetic mutation",
      );
      throw new Error("synthetic assertion failure");
    }),
    /synthetic assertion failure/,
  );
  assert.equal(existsSync(owned), false);
  const { loadReviewedScenarios } = await import(
    "../src/execution/reviewed-scenarios"
  );
  await loadReviewedScenarios();
});

test("cleanup diagnostic classifier never reads error values or trusts error names", () => {
  const phase = "context-close";
  assert.deepEqual(
    classifyCleanupError(phase, new errors.TimeoutError("PRIVATE_CANARY")),
    { phase, category: "playwright-timeout" },
  );
  const hostile = new Proxy(
    {},
    {
      get() {
        throw Error("PRIVATE_CANARY");
      },
      getPrototypeOf() {
        throw Error("PRIVATE_CANARY");
      },
    },
  );
  for (const error of [
    undefined,
    null,
    false,
    0,
    "PRIVATE_CANARY",
    { name: "TimeoutError", message: "PRIVATE_CANARY" },
    new Error("PRIVATE_CANARY"),
    hostile,
  ]) {
    assert.deepEqual(classifyCleanupError(phase, error), {
      phase,
      category: "unclassified",
    });
  }
});

test("cleanup diagnostic schema rejects values, extra keys, duplicates and unbounded arrays", () => {
  const entry = { phase: "context-close", category: "unclassified" };
  assert.equal(cleanupDiagnosticsSchema.safeParse([entry]).success, true);
  for (const value of [
    null,
    {},
    [null],
    [{ ...entry, phase: "PRIVATE_CANARY" }],
    [{ ...entry, category: "Error" }],
    [{ ...entry, message: "PRIVATE_CANARY" }],
    [entry, entry],
    [entry, entry, entry],
  ]) {
    assert.equal(cleanupDiagnosticsSchema.safeParse(value).success, false);
  }
});

test("actual cleanup hooks preserve sanitized throws and failure precedence with classified errors", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "rr139-cleanup-diagnostic-"),
  );
  try {
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const Module = require("node:module");
      const original = Module._load;
      const {errors} = require("playwright-core");
      const callbacks = {};
      const timeout = new errors.TimeoutError("PRIVATE_CANARY");
      const browser = { close: async () => {throw timeout;} };
      const cucumber = Object.fromEntries(["Before", "BeforeAll", "After", "AfterAll"].map(name => [name, fn => callbacks[name] = fn]));
      Object.assign(cucumber, {World: class {}, setWorldConstructor() {}, setDefaultTimeout() {}});
      Module._load = function(name, ...args) {
        if(name === "@cucumber/cucumber") return cucumber;
        if(name === "@playwright/test") return {chromium: {connect: async () => browser}};
        return original.call(this, name, ...args);
      };
      try { require(${JSON.stringify(path.join(root, "dist/cucumber/features/execution/support/hooks.js"))}); }
      finally {Module._load = original;}
      (async () => {
        await callbacks.BeforeAll();
        await assert.rejects(callbacks.After.call({context: {close: async () => {throw timeout;}}}), error => error !== timeout && error.message === "Scenario context cleanup failed" && !error.stack.includes("PRIVATE_CANARY"));
        await assert.rejects(callbacks.AfterAll(), error => error !== timeout && error.message === "Execution resource cleanup failed" && !error.stack.includes("PRIVATE_CANARY"));
        const bytes = fs.readFileSync(process.env.WEB_EXECUTION_CLEANUP_PATH, "utf8");
        assert.equal(bytes.includes("PRIVATE_CANARY"), false);
        assert.deepEqual(JSON.parse(bytes), {status:"unknown", failures:["context-close","browser-close"], injectedFailure:false, diagnostics:[{phase:"context-close",category:"playwright-timeout"},{phase:"browser-close",category:"playwright-timeout"}]});
        // A report write failure retains its existing precedence over cleanup failures.
        await assert.rejects(callbacks.AfterAll(), error => error.message === "Execution cleanup report could not be written");
      })().catch(() => {process.exitCode=1;});
    `,
      ],
      {
        cwd: root,
        timeout: 10000,
        encoding: "utf8",
        env: {
          ...process.env,
          WEB_EXECUTION_PAYLOAD: JSON.stringify({
            scenario: {
              id: "local-demo-navigation",
              values: { displayName: "Synthetic" },
            },
            environment: {
              initialTargetUrl: "http://127.0.0.1:3001/",
              approvedOrigin: "http://127.0.0.1:3001",
            },
            redirectTargetUrl: "http://127.0.0.1:3002/",
          }),
          WEB_EXECUTION_BROWSER_ENDPOINT: "ws://127.0.0.1:3003",
          WEB_EXECUTION_CLEANUP_PATH: path.join(directory, "cleanup.json"),
        },
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(
      child.status,
      0,
      "hook identity and sanitized report assertions must pass",
    );
    assert.equal(child.stdout.includes("PRIVATE_CANARY"), false);
    assert.equal(child.stderr.includes("PRIVATE_CANARY"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("opt-in diagnostic invocations have isolated empty envelopes for rejected input", async () => {
  let admissions = 0;
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      executeOwnedLocalAdapterWithDiagnostics({}, {}, undefined, async () => {
        admissions++;
      }),
    ),
  );
  assert.equal(admissions, 0);
  for (const result of results) {
    assert.equal(result.result.accepted, false);
    assert.deepEqual(result.cleanupDiagnostics, []);
  }
  assert.notEqual(results[0].cleanupDiagnostics, results[1].cleanupDiagnostics);
  results[0].cleanupDiagnostics.push({
    attemptNumber: 1,
    scenarioId: "local-demo-navigation",
    phase: "context-close",
    category: "unclassified",
  });
  assert.deepEqual(results[1].cleanupDiagnostics, []);
});

test("default v2 JSON schema remains byte-identical to the published strict contract", () => {
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(ownedLocalResultJsonSchema))
      .digest("hex"),
    "bde917ed984c94995975c39d4fa749b53bb2ee5f3d985eaba41d240865c6191f",
  );
});
