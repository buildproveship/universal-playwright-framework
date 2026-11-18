import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import type { CucumberScenarioEvidence, CucumberStepStatus } from "./index";

// Fixed reviewed journey only: never serialize runtime values or error messages.
export const OWNED_EVIDENCE_ID = "local-demo-navigation";
export const OWNED_EVIDENCE_FEATURE = "Execute reviewed synthetic scenarios";
export const OWNED_EVIDENCE_SCENARIO =
  "A visitor opens account registration and returns to sign in";
export const OWNED_EVIDENCE_STEPS = [
  "the synthetic reviewed page is open",
  "I open owned local account registration",
  "the owned local account registration page is visible",
  "I return from owned local account registration to sign in",
  "the owned local sign in page is visible",
] as const;
export const OWNED_EVIDENCE_STATUSES: readonly CucumberStepStatus[] = [
  "passed",
  "failed",
  "skipped",
  "pending",
  "undefined",
  "ambiguous",
  "unknown",
];
export const MAX_OWNED_EVIDENCE_BYTES = 1024;

export function parseOwnedEvidence(
  raw: string,
  scenarioId: string,
): CucumberScenarioEvidence | undefined {
  if (
    scenarioId !== OWNED_EVIDENCE_ID ||
    Buffer.byteLength(raw) > MAX_OWNED_EVIDENCE_BYTES
  )
    return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    // A plain object, checked above.
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const steps = record.steps;
    if (
      keys.length !== 3 ||
      !keys.every(
        (key) =>
          key === "scenarioId" || key === "schemaVersion" || key === "steps",
      ) ||
      record.schemaVersion !== 1 ||
      record.scenarioId !== OWNED_EVIDENCE_ID ||
      !Array.isArray(steps) ||
      steps.length !== OWNED_EVIDENCE_STEPS.length ||
      !steps.every(
        (status: unknown): status is CucumberStepStatus =>
          typeof status === "string" &&
          OWNED_EVIDENCE_STATUSES.includes(status as CucumberStepStatus),
      )
    )
      return undefined;
    return {
      featureName: OWNED_EVIDENCE_FEATURE,
      scenarioName: OWNED_EVIDENCE_SCENARIO,
      steps: OWNED_EVIDENCE_STEPS.map((name, index) => ({
        name,
        status: steps[index],
      })),
    };
  } catch {
    return undefined;
  }
}

export function readOwnedEvidence(
  file: string,
  scenarioId: string,
): CucumberScenarioEvidence | undefined {
  let fd: number | undefined;
  try {
    const before = lstatSync(file);
    if (!before.isFile() || before.size > MAX_OWNED_EVIDENCE_BYTES)
      return undefined;
    fd = openSync(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const after = fstatSync(fd);
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      after.size > MAX_OWNED_EVIDENCE_BYTES
    )
      return undefined;
    const bytes = Buffer.alloc(MAX_OWNED_EVIDENCE_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null);
      if (count === 0) break;
      used += count;
    }
    return parseOwnedEvidence(
      bytes.subarray(0, used).toString("utf8"),
      scenarioId,
    );
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* Evidence stays unavailable on I/O failure. */
      }
    }
  }
}
