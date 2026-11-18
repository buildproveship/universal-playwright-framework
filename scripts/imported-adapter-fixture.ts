/**
 * Test classification: integration
 * Review status: Not Reviewed
 * Evidence: synthetic
 * Scope: Fixed local test authority and local HTTP targets exercise the imported adapter; no TCM receipt, founder approval or customer run is created.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import { chromium } from "@playwright/test";
import {
  executeImportedCase,
  IMPORTED_IMPLEMENTATION_REVISION,
  validateImportedEvidence,
  type ImportedExecutionRequest,
  type RegisteredImportedArtifact,
  type TrustedImportedContext,
} from "../src/adapter/imported-v1";

async function main() {
  const scenario = process.argv[2];
  const allowed = [
    "pass",
    "fail",
    "hook-failure",
    "foreign",
    "route-override",
    "wrong-case",
    "extra-case",
    "bad-count",
    "cancel",
    "revoked",
    "expired",
    "unknown-artifact",
    "missing-data",
    "stale-runtime",
    "revoke-before-acquire",
    "tamper-before-acquire",
    "tamper-before-load",
    "late-admission",
  ];
  assert.ok(allowed.includes(scenario));
  const closeEvents: string[] = [];
  let foreignRequests = 0,
    acquired = 0,
    admissions = 0,
    verifications = 0,
    runnerCalls = 0;
  const own = createServer((_req, res) =>
    res.end(
      '<html><body><p id="ready">Owned synthetic fixture</p></body></html>',
    ),
  );
  const foreign = createServer((_req, res) => {
    foreignRequests++;
    res.end("Foreign synthetic target");
  });
  const listen = (server: ReturnType<typeof createServer>) =>
    new Promise<number>((resolve) =>
      server.listen(0, "127.0.0.1", () => {
        resolve((server.address() as { port: number }).port);
      }),
    );
  const port = await listen(own),
    other = await listen(foreign);
  const digest = "a".repeat(64);
  const request: ImportedExecutionRequest = {
    version: "first-party-imported/v1",
    selection: { runId: randomUUID(), revision: 1 },
    run: { id: randomUUID(), attempt: 1 },
    observation: {
      case: {
        scope: {
          tenantId: randomUUID(),
          projectId: randomUUID(),
          environmentId: randomUUID(),
        },
        id: randomUUID(),
        revision: 1,
        snapshotDigest: digest,
        sourceTestId: "synthetic-existing-source-id",
        repositoryId: "releaseready/releaseready-product-tests",
        repositoryCommit: "a".repeat(40),
      },
      configuration: { applicationVersion: 1, environmentVersion: 1 },
      artifactManifestDigest: digest,
      observedArtifactDigest: digest,
      framework: {
        commit: "b".repeat(40),
        reviewedImplementationDigest: IMPORTED_IMPLEMENTATION_REVISION,
      },
      dataRequirements: { policyDigest: digest, requirementsDigest: digest },
    },
    reviewId: randomUUID(),
    application: {
      versionId: "synthetic-app-1",
      commit: "c".repeat(40),
      artifactDigest: digest,
    },
    target: {
      kind: "owned-local",
      id: "synthetic-owned-target",
      origin: `http://127.0.0.1:${port}`,
      ownershipReceiptDigest: digest,
    },
    configurationDigest: digest,
    preparationReceiptDigest: digest,
    approval: { id: randomUUID(), expiresAt: Date.now() + 60000 },
    limits: {
      runTimeoutMs: 10000,
      scenarioTimeoutMs: 10000,
      concurrency: 1,
      retries: 0,
    },
  };
  if (scenario === "late-admission") request.limits.scenarioTimeoutMs = 100;
  const context: TrustedImportedContext = {
    authorization: "trusted-first-party",
    request: structuredClone(request),
    caseReview: {
      id: request.reviewId,
      active: true,
      observation: structuredClone(request.observation),
    },
    runApproval: {
      id: request.approval.id,
      active: true,
      expiresAt: request.approval.expiresAt,
    },
  };
  const controller = new AbortController();
  const artifact: RegisteredImportedArtifact = {
    policy: "normal-ui-only",
    observation: structuredClone(request.observation),
    async verifyImmutable() {
      verifications++;
      if (
        (scenario === "tamper-before-acquire" && verifications === 2) ||
        (scenario === "tamper-before-load" && verifications === 3)
      )
        return {
          ...request.observation,
          observedArtifactDigest: "b".repeat(64),
        };
      return structuredClone(request.observation);
    },
    async runWithInjectedContext(selected, _signal, borrowed) {
      runnerCalls++;
      borrowed.claimCase(
        scenario === "wrong-case" ? "wrong-source" : selected.sourceTestId,
      );
      if (scenario === "extra-case") borrowed.claimCase(selected.sourceTestId);
      await borrowed.page.goto(request.target.origin);
      assert.equal(
        await borrowed.page.locator("#ready").textContent(),
        "Owned synthetic fixture",
      );
      if (scenario === "foreign")
        await borrowed.page
          .goto(`http://127.0.0.1:${other}`)
          .catch(() => undefined);
      if (scenario === "route-override")
        await Promise.resolve()
          .then(() => borrowed.page.route("**/*", (route) => route.continue()))
          .catch(() => undefined);
      if (scenario === "cancel") {
        setTimeout(() => {
          controller.abort();
        }, 20);
        await borrowed.page.waitForTimeout(1000);
      }
      return {
        sourceTestId: selected.sourceTestId,
        startedCases: scenario === "bad-count" ? (2 as 1) : 1,
        finishedCases: 1,
        steps: [scenario === "fail" ? "failed" : "passed"],
        hooksPassed: scenario !== "hook-failure",
      };
    },
  };
  let trusted: unknown = context,
    input: unknown = request;
  if (scenario === "revoked")
    trusted = {
      ...context,
      caseReview: { ...context.caseReview, active: false },
    };
  if (scenario === "expired") {
    request.approval.expiresAt = Date.now() - 1;
    context.request = structuredClone(request);
    context.runApproval.expiresAt = request.approval.expiresAt;
  }
  if (scenario === "missing-data")
    input = {
      ...request,
      observation: { ...request.observation, dataRequirements: {} },
    };
  const original = fs.readFileSync;
  if (scenario === "stale-runtime")
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) =>
      String(args[0]).endsWith("src/adapter/imported-v1.ts")
        ? String(original(...args)) + "tamper"
        : original(...args)) as typeof fs.readFileSync;
  try {
    const result = await executeImportedCase(
      input,
      trusted,
      scenario === "unknown-artifact" ? undefined : artifact,
      {
        signal: controller.signal,
        async beforeAcquire() {
          admissions++;
          if (scenario === "late-admission")
            await new Promise((resolve) => setTimeout(resolve, 300));
          if (scenario === "revoke-before-acquire")
            throw new Error("Synthetic approval revoked");
        },
        async launchBrowser(timeout) {
          acquired++;
          const browser = await chromium.launch({ headless: true, timeout });
          const newContext = browser.newContext.bind(browser);
          browser.newContext = async (...args) => {
            const context = await newContext(...args);
            const close = context.close.bind(context);
            context.close = async (...options) => {
              try {
                await close(...options);
                closeEvents.push("context-closed");
              } catch (error) {
                closeEvents.push("context-close-rejected");
                throw error;
              }
            };
            return context;
          };
          const close = browser.close.bind(browser);
          browser.close = async (...options) => {
            try {
              await close(...options);
              closeEvents.push("browser-closed");
            } catch (error) {
              closeEvents.push("browser-close-rejected");
              throw error;
            }
          };
          return browser;
        },
      },
    );
    if (scenario === "late-admission")
      await new Promise((resolve) => setTimeout(resolve, 500));
    const valid = validateImportedEvidence(input, result);
    const altered = result.accepted
      ? { ...result, case: { ...result.case, id: randomUUID() } }
      : undefined;
    const forged = result.accepted
      ? { ...result, status: "passed", cleanup: "unknown" }
      : undefined;
    const second = acquired
      ? await executeImportedCase(request, context, artifact, {
          async beforeAcquire() {
            throw new Error("Consumed worker must not reach admission");
          },
        })
      : undefined;
    process.stdout.write(
      JSON.stringify({
        result,
        closeEvents,
        acquired,
        admissions,
        verifications,
        runnerCalls,
        foreignRequests,
        valid,
        wrongCaseAccepted: altered
          ? validateImportedEvidence(request, altered)
          : false,
        unknownCleanupPassAccepted: forged
          ? validateImportedEvidence(request, forged)
          : false,
        second,
      }),
    );
  } finally {
    fs.readFileSync = original;
    await Promise.all(
      [own, foreign].map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => {
              if (error) reject(error);
              else resolve();
            }),
          ),
      ),
    );
  }
}
void main().catch(() => {
  process.exitCode = 1;
});
