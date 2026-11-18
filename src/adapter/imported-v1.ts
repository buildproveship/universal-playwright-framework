import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { BrowserContext, Page, Browser } from "@playwright/test";
import { z } from "zod";
import {
  guardLoginRequests,
  withFreshLoginPage,
} from "../execution/runtime-login-browser";
import { RuntimeLoginFailure } from "../input-preparation/runtime-login";
import { untrusted } from "../validation/untrusted";
import {
  REPOSITORY_ROOT,
  runtimePackagePath,
} from "../execution/reviewed-scenarios";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reference = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const scope = z
  .object({ tenantId: z.uuid(), projectId: z.uuid(), environmentId: z.uuid() })
  .strict();
const observationSchema = z
  .object({
    case: z
      .object({
        scope,
        id: z.uuid(),
        revision,
        snapshotDigest: hash,
        sourceTestId: z.string().min(1).max(300),
        repositoryId: z.literal("releaseready/releaseready-product-tests"),
        repositoryCommit: commit,
      })
      .strict(),
    configuration: z
      .object({ applicationVersion: revision, environmentVersion: revision })
      .strict(),
    artifactManifestDigest: hash,
    observedArtifactDigest: hash,
    framework: z
      .object({ commit, reviewedImplementationDigest: hash })
      .strict(),
    dataRequirements: z
      .object({ policyDigest: hash, requirementsDigest: hash })
      .strict(),
  })
  .strict();
const origin = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === value &&
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1" &&
        Number(url.port) >= 1024 &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });
export const importedRequestSchema = z
  .object({
    version: z.literal("first-party-imported/v1"),
    selection: z.object({ runId: z.uuid(), revision }).strict(),
    run: z.object({ id: z.uuid(), attempt: z.literal(1) }).strict(),
    observation: observationSchema,
    reviewId: z.uuid(),
    application: z
      .object({ versionId: reference, commit, artifactDigest: hash })
      .strict(),
    target: z
      .object({
        kind: z.literal("owned-local"),
        id: reference,
        origin,
        ownershipReceiptDigest: hash,
      })
      .strict(),
    configurationDigest: hash,
    preparationReceiptDigest: hash,
    approval: z.object({ id: z.uuid(), expiresAt: revision }).strict(),
    limits: z
      .object({
        runTimeoutMs: z.number().int().min(100).max(120000),
        scenarioTimeoutMs: z.number().int().min(100).max(60000),
        concurrency: z.literal(1),
        retries: z.literal(0),
      })
      .strict(),
  })
  .strict();
export type ImportedExecutionRequest = z.infer<typeof importedRequestSchema>;
export type ImportedObservation = ImportedExecutionRequest["observation"];
const contextSchema = z
  .object({
    authorization: z.literal("trusted-first-party"),
    request: importedRequestSchema,
    caseReview: z
      .object({
        id: z.uuid(),
        active: z.literal(true),
        observation: observationSchema,
      })
      .strict(),
    runApproval: z
      .object({ id: z.uuid(), active: z.literal(true), expiresAt: revision })
      .strict(),
  })
  .strict();
/** Supplied only by authenticated trusted composition, never request JSON. */
export type TrustedImportedContext = z.infer<typeof contextSchema>;
const stepStatus = z.enum([
  "passed",
  "failed",
  "skipped",
  "pending",
  "undefined",
  "ambiguous",
]);
const outcomeSchema = z
  .object({
    sourceTestId: z.string().min(1).max(300),
    startedCases: z.literal(1),
    finishedCases: z.literal(1),
    steps: z.array(stepStatus).min(1).max(200),
    hooksPassed: z.boolean(),
  })
  .strict();
export type ImportedCaseOutcome = z.infer<typeof outcomeSchema>;
export interface BorrowedImportedContext {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly origin: string;
  /** The reviewed bridge must claim exactly the actual expanded case before steps. */
  claimCase(sourceTestId: string): void;
}
let running = false;
/** Fixed server registry entry. Unknown repository code or request-supplied
 * functions/paths must never become this object. verifyImmutable rechecks exact
 * source, compiled closure and resolved dependencies against its sealed artifact.
 */
export interface RegisteredImportedArtifact {
  readonly policy: "normal-ui-only";
  readonly observation: ImportedObservation;
  verifyImmutable(): Promise<ImportedObservation>;
  runWithInjectedContext(
    selection: ImportedObservation["case"],
    signal: AbortSignal,
    context: BorrowedImportedContext,
  ): Promise<ImportedCaseOutcome>;
}
export interface ImportedExecutionOptions {
  /** Mandatory parent IPC admission: freshly revalidate review, run approval,
   * target ownership, app pin, configuration and prepared data before acquisition. */
  beforeAcquire(request: ImportedExecutionRequest): Promise<void>;
  signal?: AbortSignal;
  /** Trusted synthetic test seam, never serialized or exposed to route bodies. */
  launchBrowser?: (timeoutMs: number) => Promise<Browser>;
}
const rejection = z
  .object({
    version: z.literal("first-party-imported/v1"),
    accepted: z.literal(false),
    resourceAcquisition: z.literal("not_started"),
    code: z.enum([
      "INVALID_REQUEST",
      "INVALID_CONTEXT",
      "STALE_REVIEW",
      "UNAVAILABLE",
      "CANCELLED",
    ]),
  })
  .strict();
const accepted = z
  .object({
    version: z.literal("first-party-imported/v1"),
    accepted: z.literal(true),
    request: importedRequestSchema,
    status: z.enum([
      "passed",
      "failed",
      "incomplete",
      "cancelled",
      "timed_out",
    ]),
    case: z
      .object({
        id: z.uuid(),
        revision,
        sourceTestId: z.string().min(1).max(300),
        executionState: z.enum(["executed", "unknown"]),
        steps: z.array(stepStatus).max(200),
        hooksPassed: z.boolean().nullable(),
      })
      .strict(),
    cleanup: z.enum(["confirmed", "unknown", "not_required"]),
    policyPassed: z.boolean().nullable(),
  })
  .strict();
export const importedRequestJsonSchema = z.toJSONSchema(importedRequestSchema);
export const importedResultJsonSchema = z.toJSONSchema(
  z.union([rejection, accepted]),
);
export type ImportedExecutionResult =
  z.infer<typeof rejection> | z.infer<typeof accepted>;
function reject(
  code: z.infer<typeof rejection>["code"],
): ImportedExecutionResult {
  return {
    version: "first-party-imported/v1",
    accepted: false,
    resourceAcquisition: "not_started",
    code,
  };
}

// Candidate only until independent implementation review explicitly updates it.
export const IMPORTED_IMPLEMENTATION_REVISION =
  "3e015bffc26fc40cb5598ad3b4d12b59f32ce458fce115314c2947c8122b97b7";
export function calculateImportedImplementationRevision(): string {
  const digest = createHash("sha256");
  for (const file of [
    "package.json",
    "src/adapter/imported-v1.ts",
    "dist/cucumber/src/adapter/imported-v1.js",
    "src/execution/reviewed-scenarios.ts",
    "dist/cucumber/src/execution/reviewed-scenarios.js",
    "src/execution/runtime-login-browser.ts",
    "dist/cucumber/src/execution/runtime-login-browser.js",
    "src/input-preparation/runtime-login.ts",
    "dist/cucumber/src/input-preparation/runtime-login.js",
  ]) {
    let contents = readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
    if (file.includes("adapter/imported-v1"))
      contents = contents.replace(
        IMPORTED_IMPLEMENTATION_REVISION,
        "<reviewed-imported-implementation>",
      );
    digest.update(file).update("\0").update(contents).update("\0");
  }
  for (const dependency of [
    "@playwright/test",
    "playwright",
    "playwright-core",
    "zod",
  ])
    digest
      .update(dependency)
      .update(readFileSync(runtimePackagePath(dependency)));
  return digest.digest("hex");
}
export function getImportedImplementationReview(): string {
  if (
    calculateImportedImplementationRevision() !==
    IMPORTED_IMPLEMENTATION_REVISION
  )
    throw new Error("Imported implementation review unavailable");
  return IMPORTED_IMPLEMENTATION_REVISION;
}
async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Admission unavailable"));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function validateImportedEvidence(
  request: unknown,
  result: unknown,
): result is ImportedExecutionResult {
  const wanted = importedRequestSchema.safeParse(request);
  if (!wanted.success) return false;
  if (rejection.safeParse(result).success) return true;
  const parsed = accepted.safeParse(result);
  if (!parsed.success || !isDeepStrictEqual(parsed.data.request, wanted.data))
    return false;
  const evidence = parsed.data,
    selected = wanted.data.observation.case;
  return (
    evidence.case.id === selected.id &&
    evidence.case.revision === selected.revision &&
    evidence.case.sourceTestId === selected.sourceTestId &&
    (evidence.status !== "passed" ||
      (evidence.cleanup === "confirmed" &&
        evidence.policyPassed === true &&
        evidence.case.executionState === "executed" &&
        evidence.case.hooksPassed === true &&
        evidence.case.steps.length > 0 &&
        evidence.case.steps.every((step) => step === "passed")))
  );
}

/** Called inside the existing owned worker; no process or browser is acquired
 * for rejected authority/artifact references. This is not an arbitrary-code sandbox. */
export async function executeImportedCase(
  input: unknown,
  trusted: unknown,
  artifact: RegisteredImportedArtifact | undefined,
  options: ImportedExecutionOptions,
): Promise<ImportedExecutionResult> {
  const parsed = importedRequestSchema.safeParse(input);
  if (!parsed.success) return reject("INVALID_REQUEST");
  const request = parsed.data;
  const authority = contextSchema.safeParse(trusted);
  if (
    !authority.success ||
    !isDeepStrictEqual(authority.data.request, request) ||
    !isDeepStrictEqual(
      authority.data.caseReview.observation,
      request.observation,
    ) ||
    authority.data.caseReview.id !== request.reviewId ||
    authority.data.runApproval.id !== request.approval.id ||
    authority.data.runApproval.expiresAt !== request.approval.expiresAt ||
    // Untyped callers can omit the hook or pass something else.
    typeof untrusted(options)?.beforeAcquire !== "function"
  )
    return reject("INVALID_CONTEXT");
  if (
    running ||
    !artifact ||
    // A registry entry is checked again rather than trusted for its declared policy.
    untrusted(artifact)?.policy !== "normal-ui-only" ||
    !isDeepStrictEqual(artifact.observation, request.observation)
  )
    return reject("UNAVAILABLE");
  const deadline = Math.min(
    Date.now() + request.limits.runTimeoutMs,
    request.approval.expiresAt,
  );
  let acquisitionDeadline = deadline;
  const active = () => {
    if (Date.now() >= acquisitionDeadline) throw new Error("Run expired");
    if (options.signal?.aborted || controller.signal.aborted)
      throw new Error("Cancelled");
    const remaining = request.approval.expiresAt - Date.now();
    if (remaining <= 0 || remaining > 3600000)
      throw new Error("Approval expired");
  };
  running = true;
  let acquired = false,
    claims = 0;
  // Set inside the launch callback; read afresh where the type checker cannot see that.
  const isAcquired = (): boolean => acquired;
  let interceptionAttempted = false;
  let outcome: ImportedCaseOutcome | undefined;
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    try {
      active();
    } catch {
      return reject(options.signal?.aborted ? "CANCELLED" : "INVALID_CONTEXT");
    }
    try {
      if (
        getImportedImplementationReview() !==
        request.observation.framework.reviewedImplementationDigest
      )
        return reject("STALE_REVIEW");
    } catch {
      return reject(options.signal?.aborted ? "CANCELLED" : "STALE_REVIEW");
    }
    const verify = async () => {
      active();
      const observed = await bounded(
        artifact.verifyImmutable(),
        Math.max(1, Math.min(2500, deadline - Date.now())),
      );
      if (!isDeepStrictEqual(observed, request.observation))
        throw new Error("Artifact changed");
      active();
    };
    try {
      await verify();
    } catch {
      return reject(options.signal?.aborted ? "CANCELLED" : "INVALID_CONTEXT");
    }
    acquisitionDeadline = Math.min(
      deadline,
      Date.now() + request.limits.scenarioTimeoutMs,
    );
    try {
      await withFreshLoginPage(
        async (page) => {
          await guardLoginRequests(
            page.context(),
            request.target.origin,
            request.target.origin + "/",
            {
              allow: (request) =>
                Promise.resolve(
                  ["GET", "HEAD", "POST"].includes(request.method()),
                ),
              response: () => undefined,
              assertComplete: () => undefined,
            },
          );
          // Page routes outrank context routes. This first-party slice deliberately
          // does not admit network fault-injection cases that would bypass the guard.
          const unavailable = () => {
            interceptionAttempted = true;
            throw new Error(
              "Network interception is unavailable in this admitted policy",
            );
          };
          for (const owner of [page, page.context()])
            for (const method of [
              "route",
              "unroute",
              "unrouteAll",
              "routeFromHAR",
              "routeWebSocket",
            ])
              Object.defineProperty(owner, method, {
                value: unavailable,
                writable: false,
                configurable: false,
              });
          await page.setViewportSize({ width: 1200, height: 1000 });
          const borrowed = Object.freeze({
            page,
            context: page.context(),
            origin: request.target.origin,
            claimCase(sourceTestId: string) {
              if (
                ++claims !== 1 ||
                sourceTestId !== request.observation.case.sourceTestId
              )
                throw new Error("Selected case mismatch");
            },
          });
          {
            // Recheck the immutable implementation immediately before loading it.
            const observed = await bounded(
              artifact.verifyImmutable(),
              Math.max(1, Math.min(2500, deadline - Date.now())),
            );
            if (!isDeepStrictEqual(observed, request.observation))
              throw new Error("Artifact changed");
            active();
            const raw = await artifact.runWithInjectedContext(
              structuredClone(request.observation.case),
              controller.signal,
              borrowed,
            );
            if (interceptionAttempted)
              throw new Error("Imported transport policy rejected an override");
            const result = outcomeSchema.safeParse(raw);
            if (
              !result.success ||
              claims !== 1 ||
              result.data.sourceTestId !== request.observation.case.sourceTestId
            )
              throw new Error("Execution evidence unavailable");
            outcome = result.data;
          }
        },
        {
          timeoutMs: Math.max(
            1,
            Math.min(deadline - Date.now(), request.limits.scenarioTimeoutMs),
          ),
          signal: controller.signal,
          launchBrowser: async (timeout) => {
            await verify();
            await bounded(
              options.beforeAcquire(structuredClone(request)),
              Math.max(1, Math.min(2500, acquisitionDeadline - Date.now())),
            );
            active();
            let launch = options.launchBrowser;
            if (!launch) {
              const { chromium } = await import("playwright-core");
              launch = (remaining) =>
                chromium.launch({ headless: true, timeout: remaining });
            }
            active();
            const remaining = Math.min(
              timeout,
              acquisitionDeadline - Date.now(),
            );
            if (remaining <= 0) throw new Error("Admission deadline expired");
            acquired = true;
            return launch(remaining);
          },
        },
      );
      const status = outcome?.steps.some((step) => step === "failed")
        ? "failed"
        : outcome?.hooksPassed &&
            outcome.steps.every((step) => step === "passed")
          ? "passed"
          : "incomplete";
      return {
        version: request.version,
        accepted: true,
        request,
        status,
        case: {
          id: request.observation.case.id,
          revision: request.observation.case.revision,
          sourceTestId: request.observation.case.sourceTestId,
          executionState: outcome ? "executed" : "unknown",
          steps: outcome?.steps ?? [],
          hooksPassed: outcome?.hooksPassed ?? null,
        },
        cleanup: "confirmed",
        policyPassed: true,
      };
    } catch (error) {
      if (!isAcquired())
        return reject(
          options.signal?.aborted ? "CANCELLED" : "INVALID_CONTEXT",
        );
      const failure = RuntimeLoginFailure.fromUnknown(error);
      const status = options.signal?.aborted
        ? "cancelled"
        : failure?.failureClassification === "timed-out"
          ? "timed_out"
          : "incomplete";
      return {
        version: request.version,
        accepted: true,
        request,
        status,
        case: {
          id: request.observation.case.id,
          revision: request.observation.case.revision,
          sourceTestId: request.observation.case.sourceTestId,
          executionState: outcome ? "executed" : "unknown",
          steps: outcome?.steps ?? [],
          hooksPassed: outcome?.hooksPassed ?? null,
        },
        cleanup:
          failure?.cleanupStatus === "confirmed" ? "confirmed" : "unknown",
        policyPassed:
          failure?.failureClassification === "request-policy" ? false : null,
      };
    }
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", cancel);
    if (!isAcquired()) running = false;
  }
}
