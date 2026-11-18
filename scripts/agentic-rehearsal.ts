/** Owned synthetic contract rehearsal, not a generated-code sandbox or product API. */
import { createHash } from "node:crypto";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { z } from "zod";

const scenario = z.strictObject({
  id: z.string().max(80),
  action: z.literal("sign-in"),
  dataRef: z.literal("owned-sign-in-v1"),
  assertion: z.string().max(80),
  skip: z.boolean(),
});
const candidateSchema = z.strictObject({
  version: z.literal(1),
  cases: z.array(scenario).max(2),
});

// Synthetic IDs only. These are not allocated Test Management case identities.
export const SYNTHETIC_BASELINE = JSON.stringify({
  version: 1,
  cases: [
    {
      id: "synthetic-sign-in",
      action: "sign-in",
      dataRef: "owned-sign-in-v1",
      assertion: "session.user === owned-user",
      skip: false,
    },
  ],
});

export type BlockReason =
  | "unsupported-input"
  | "identity-change"
  | "coverage-loss"
  | "expectation-change"
  | "budget-exhausted"
  | "worker-failed"
  | "execution-failed"
  | "cleanup-unconfirmed";
export interface RehearsalResult {
  status: "blocked" | "rehearsal-passed";
  reason?: BlockReason;
  candidateDigest: string;
  baselineDigest: string;
  reviewStatus: "Not Reviewed";
  executionAuthorized: false;
  evidence: "owned-synthetic-contract-only";
  cleanup: "not-started" | "confirmed" | "unconfirmed";
  fixtureStarted: boolean;
}

function digest(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/** Exact closed grammar: no inference that arbitrary JS assertions are equivalent. */
export function inspectSyntheticCandidate(source: string): BlockReason | null {
  if (Buffer.byteLength(source, "utf8") > 16_384) return "unsupported-input";
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return "unsupported-input";
  }
  const parsed = candidateSchema.safeParse(value);
  if (!parsed.success) return "unsupported-input";
  if (
    parsed.data.cases.length !== 1 ||
    parsed.data.cases[0].id !== "synthetic-sign-in"
  ) {
    return "identity-change";
  }
  if (parsed.data.cases[0].skip) return "coverage-loss";
  if (parsed.data.cases[0].assertion !== "session.user === owned-user")
    return "expectation-change";
  return null;
}

// Trusted verification controls, not fields accepted from candidate input.
// Even in tests the deadline cannot exceed the approved 60 second ceiling.
export interface RehearsalControls {
  timeoutMs?: number;
  fixtureFault?: "hang" | "crash" | "wrong-user";
}

/**
 * One immutable string, one fixed worker, zero repairs/models/network/file writes.
 * No caller-provided evidence, worker path, executable or instruction is accepted.
 * Results are observations only, never acceptance or customer-run permission.
 */
export async function rehearseSyntheticCandidate(
  source: string,
  controls: RehearsalControls = {},
): Promise<RehearsalResult> {
  const base: RehearsalResult = {
    status: "blocked",
    candidateDigest: digest(source),
    baselineDigest: digest(SYNTHETIC_BASELINE),
    reviewStatus: "Not Reviewed",
    executionAuthorized: false,
    evidence: "owned-synthetic-contract-only",
    cleanup: "not-started",
    fixtureStarted: false,
  };
  const reason = inspectSyntheticCandidate(source);
  if (reason) return { ...base, reason };
  const timeoutMs = controls.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    return { ...base, reason: "budget-exhausted" };
  }
  if (
    controls.fixtureFault !== undefined &&
    !["hang", "crash", "wrong-user"].includes(controls.fixtureFault)
  ) {
    return { ...base, reason: "unsupported-input" };
  }
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(__filename, {
        workerData: { source, fault: controls.fixtureFault },
        env: {},
        execArgv: [],
        resourceLimits: {
          maxOldGenerationSizeMb: 32,
          maxYoungGenerationSizeMb: 8,
          stackSizeMb: 2,
        },
      });
    } catch {
      resolve({ ...base, reason: "worker-failed" });
      return;
    }
    let observation: unknown;
    let fixtureStarted = false;
    let failed = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // terminate() waits for worker exit; a promise race is not cleanup evidence.
      void worker.terminate().catch(() => {
        resolve({
          ...base,
          reason: "cleanup-unconfirmed",
          cleanup: "unconfirmed",
          fixtureStarted,
        });
      });
    }, timeoutMs);
    worker.on("message", (message: unknown) => {
      if (message === "fixture-started") fixtureStarted = true;
      else observation = message;
    });
    worker.on("error", () => {
      failed = true;
    });
    worker.on("exit", (code) => {
      clearTimeout(timer);
      const expected = `passed:${base.candidateDigest}`;
      if (timedOut)
        resolve({
          ...base,
          reason: "budget-exhausted",
          cleanup: "confirmed",
          fixtureStarted,
        });
      else if (failed || code !== 0)
        resolve({
          ...base,
          reason: "worker-failed",
          cleanup: "confirmed",
          fixtureStarted,
        });
      else if (observation !== expected)
        resolve({
          ...base,
          reason: "execution-failed",
          cleanup: "confirmed",
          fixtureStarted,
        });
      else
        resolve({
          ...base,
          status: "rehearsal-passed",
          cleanup: "confirmed",
          fixtureStarted,
        });
    });
  });
}

// Only this shipped, fixed implementation runs. Candidate text is never evaluated.
if (!isMainThread) {
  const input = workerData as {
    source: string;
    fault?: RehearsalControls["fixtureFault"];
  };
  if (inspectSyntheticCandidate(input.source) !== null)
    throw new Error("Invalid fixture input");
  if (input.fault === "crash") throw new Error("Synthetic fixture crash");
  if (input.fault === "hang") {
    parentPort?.postMessage("fixture-started");
    setInterval(() => undefined, 1000);
  } else {
    // Reference-only fixture client. No pool payloads or credentials are accepted.
    const readOwnedFixture = (): { user: string } => ({ user: "owned-user" });
    const session = {
      user:
        input.fault === "wrong-user" ? "wrong-user" : readOwnedFixture().user,
    };
    parentPort?.postMessage(
      session.user === "owned-user"
        ? `passed:${digest(input.source)}`
        : "failed",
    );
  }
}
