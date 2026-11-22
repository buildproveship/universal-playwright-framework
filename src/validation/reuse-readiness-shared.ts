import { createHash } from "node:crypto";
import type {
  CaseReadiness,
  Identity,
  ImplementationMappingSnapshot,
  ProjectedApproval,
  ProjectedInput,
  ProjectedStep,
  ProjectedValidation,
  ReadinessCode,
  ReadinessOutcome,
  ReviewedCaseSnapshot,
  SelectedCaseReference,
  StepReuse,
} from "./reuse-readiness-types";

export const MAX_SELECTED_CASES = 1_000;
const MAX_CASE_SNAPSHOTS = 10_000;
export const MAX_MAPPING_SNAPSHOTS = 10_000;
// Match the feature validator's hard expansion ceilings.
const MAX_VALIDATED_SCENARIOS = 10_000;
export const MAX_VALIDATED_STEPS = 100_000;
const MAX_APPROVED_SCENARIOS = 10_000;
const MAX_TAGS_PER_SCENARIO = 1_000;
export const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REVISION_LENGTH = 512;
export const MAX_TEXT_LENGTH = 4_096;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SCENARIO_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const OUTCOMES = [
  "reused",
  "missing",
  "ambiguous",
  "invalidated",
  "unapproved",
] as const;
export const STEP_STATUSES = ["reused", "missing", "ambiguous"] as const;
export const REQUIRED_CANDIDATE_CHECKS = [
  "typecheck",
  "lint",
  "ownedSyntheticTests",
] as const;
export const IDENTITY_FIELDS = [
  "featurePath",
  "sourceRevision",
  "featureRevision",
  "implementationRevision",
] as const satisfies readonly (keyof Identity)[];

/** Raised only for caller-supplied data that fails the snapshot contract. */
class MalformedSnapshot extends Error {}

const NOT_DATA = Symbol("not-data");

export function fail(reason: string): never {
  throw new MalformedSnapshot(reason);
}

function invalid(reason: string): {
  readonly valid: false;
  readonly reason: string;
} {
  return { valid: false, reason };
}

export function guard<T>(
  project: () => T,
): T | { valid: false; reason: string } {
  try {
    return project();
  } catch (error) {
    if (error instanceof MalformedSnapshot) {
      return invalid(error.message);
    }
    throw error;
  }
}

/** Reads an own data property only; accessors are not plain snapshot data. */
export function readField(owner: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (descriptor === undefined) return undefined;
  return "value" in descriptor ? descriptor.value : NOT_DATA;
}

export function plainRecord(value: unknown, label: string): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

export function plainList(
  value: unknown,
  label: string,
  max: number,
): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    fail(`${label} must be a list`);
  }
  if (value.length > max) {
    fail(`${label} exceeds the limit of ${max} entries`);
  }
  return Array.from({ length: value.length }, (_, index) =>
    readField(value, String(index)),
  );
}

export function boundedText(
  value: unknown,
  label: string,
  max: number,
): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  if (value.length > max) {
    fail(`${label} exceeds the length limit of ${max}`);
  }
  return value;
}

export function stableId(
  value: unknown,
  label: string,
  pattern = STABLE_ID_PATTERN,
): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !pattern.test(value)
  ) {
    fail(`${label} needs a stable identifier`);
  }
  return value;
}

export function revision(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.trim() !== value ||
    value.length > MAX_REVISION_LENGTH
  ) {
    fail(`${label} needs a non-empty revision`);
  }
  return value;
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (!allowed.includes(value as T)) {
    fail(`${label} is not a known value`);
  }
  return value as T;
}

export function stepIndex(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= MAX_VALIDATED_STEPS
  ) {
    fail(`${label} must be a non-negative integer step index`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean`);
  }
  return value;
}

export function rejectDuplicates(
  values: readonly string[],
  message: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${message} ${value}`);
    seen.add(value);
  }
}

function projectIdentity(owner: object, label: string): Identity {
  return {
    featurePath: revision(
      readField(owner, "featurePath"),
      `${label} feature path`,
    ),
    sourceRevision: revision(readField(owner, "sourceRevision"), label),
    featureRevision: revision(readField(owner, "featureRevision"), label),
    implementationRevision: revision(
      readField(owner, "implementationRevision"),
      label,
    ),
  };
}

function projectTags(value: unknown, label: string): string[] {
  return plainList(value, `${label} tags`, MAX_TAGS_PER_SCENARIO).map((tag) =>
    boundedText(tag, `${label} tag`, MAX_TEXT_LENGTH),
  );
}

function projectSelection(value: unknown): SelectedCaseReference[] {
  const entries = plainList(value, "Selection", MAX_SELECTED_CASES);
  if (entries.length === 0) {
    fail("Selection must contain at least one case");
  }
  const selection = entries.map((entry) => {
    const owner = plainRecord(entry, "Selected case");
    const caseId = stableId(readField(owner, "caseId"), "Selected case");
    return {
      caseId,
      caseRevision: revision(
        readField(owner, "caseRevision"),
        `Selected case ${caseId}`,
      ),
    };
  });
  rejectDuplicates(
    selection.map((entry) => entry.caseId),
    "Selection contains duplicate selected case",
  );
  return selection;
}

function projectCases(value: unknown): ReviewedCaseSnapshot[] {
  const cases = plainList(value, "Case snapshots", MAX_CASE_SNAPSHOTS).map(
    (entry) => {
      const owner = plainRecord(entry, "Case snapshot");
      const caseId = stableId(readField(owner, "caseId"), "Case snapshot");
      const label = `Case snapshot ${caseId}`;
      const outcomeValue = readField(owner, "expectedOutcome");
      if (outcomeValue === undefined) {
        fail(`${label} needs an expected outcome review`);
      }
      const outcome = plainRecord(outcomeValue, `${label} expected outcome`);
      return {
        caseId,
        caseRevision: revision(readField(owner, "caseRevision"), label),
        expectedOutcome: {
          reviewState: oneOf(
            readField(outcome, "reviewState"),
            ["approved", "pending", "rejected"] as const,
            `${label} expected outcome review state`,
          ),
          reviewedCaseRevision: revision(
            readField(outcome, "reviewedCaseRevision"),
            `${label} expected outcome`,
          ),
          digest: revision(
            readField(outcome, "digest"),
            `${label} expected outcome digest`,
          ),
        },
      };
    },
  );
  rejectDuplicates(
    cases.map((entry) => entry.caseId),
    "Input contains duplicate case snapshot",
  );
  return cases;
}

function projectMappings(value: unknown): ImplementationMappingSnapshot[] {
  const mappings = plainList(
    value,
    "Mapping snapshots",
    MAX_MAPPING_SNAPSHOTS,
  ).map((entry) => {
    const owner = plainRecord(entry, "Mapping snapshot");
    const mappingId = stableId(
      readField(owner, "mappingId"),
      "Mapping snapshot",
    );
    const label = `Mapping ${mappingId}`;
    return {
      mappingId,
      caseId: stableId(readField(owner, "caseId"), `${label} case`),
      caseRevision: revision(readField(owner, "caseRevision"), label),
      scenarioId: stableId(
        readField(owner, "scenarioId"),
        `${label} scenario`,
        SCENARIO_ID_PATTERN,
      ),
      ...projectIdentity(owner, label),
      reviewState: oneOf(
        readField(owner, "reviewState"),
        ["approved", "proposed", "rejected"] as const,
        `${label} review state`,
      ),
    };
  });
  rejectDuplicates(
    mappings.map((entry) => entry.mappingId),
    "Input contains duplicate mapping",
  );
  return mappings;
}

function projectStep(value: unknown, label: string): ProjectedStep {
  const owner = plainRecord(value, label);
  const implementationValue = readField(owner, "implementationId");
  const issueValue = readField(owner, "issue");
  const implementationId =
    implementationValue === undefined
      ? null
      : boundedText(
          implementationValue,
          `${label} implementation`,
          MAX_IDENTIFIER_LENGTH,
        );
  const issue =
    issueValue === undefined
      ? null
      : oneOf(
          issueValue,
          ["undefined", "ambiguous"] as const,
          `${label} issue`,
        );
  if ((implementationId === null) === (issue === null)) {
    fail(`${label} needs exactly one implementation identifier or issue`);
  }
  return {
    index: stepIndex(readField(owner, "index"), label),
    implementationId,
    issue,
  };
}

/**
 * Projects only the validator fields this module consumes. Step text, names,
 * example values and issue text are deliberately dropped before hashing.
 */
function projectValidation(value: unknown): ProjectedValidation {
  const label = "Feature validation snapshot";
  const owner = plainRecord(value, label);
  if (!boolean(readField(owner, "valid"), `${label} valid flag`)) {
    return {
      valid: false,
      reason: boundedText(
        readField(owner, "reason"),
        `${label} reason`,
        MAX_TEXT_LENGTH,
      ),
    };
  }
  let stepCount = 0;
  const scenarios = plainList(
    readField(owner, "scenarios"),
    `${label} scenarios`,
    MAX_VALIDATED_SCENARIOS,
  ).map((entry) => {
    const scenario = plainRecord(entry, "Validated scenario");
    const idValue = readField(scenario, "id");
    const id =
      idValue === null
        ? null
        : stableId(idValue, "Validated scenario", SCENARIO_ID_PATTERN);
    const steps = plainList(
      readField(scenario, "steps"),
      "Validated scenario steps",
      MAX_VALIDATED_STEPS,
    );
    stepCount += steps.length;
    if (stepCount > MAX_VALIDATED_STEPS) {
      fail(`${label} exceeds the limit of ${MAX_VALIDATED_STEPS} steps`);
    }
    return {
      id,
      tags: projectTags(readField(scenario, "tags"), "Validated scenario"),
      runnable: boolean(
        readField(scenario, "runnable"),
        "Validated scenario runnable flag",
      ),
      steps: steps.map((step) => projectStep(step, "Validated step")),
    };
  });
  return { valid: true, ...projectIdentity(owner, label), scenarios };
}

function projectApproval(value: unknown): ProjectedApproval {
  const label = "Scenario approval snapshot";
  const owner = plainRecord(value, label);
  return {
    ...projectIdentity(owner, label),
    scenarios: plainList(
      readField(owner, "scenarios"),
      `${label} scenarios`,
      MAX_APPROVED_SCENARIOS,
    ).map((entry) => {
      const scenario = plainRecord(entry, "Approved scenario");
      return {
        id: boundedText(
          readField(scenario, "id"),
          "Approved scenario identifier",
          MAX_IDENTIFIER_LENGTH,
        ),
        tags: projectTags(readField(scenario, "tags"), "Approved scenario"),
      };
    }),
  };
}

export function projectInput(input: unknown): ProjectedInput {
  const owner = plainRecord(input, "Readiness input");
  return {
    selection: projectSelection(readField(owner, "selection")),
    cases: projectCases(readField(owner, "cases")),
    mappings: projectMappings(readField(owner, "mappings")),
    validation: projectValidation(readField(owner, "validation")),
    approval: projectApproval(readField(owner, "approval")),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

/** Hashes projected plain data only; never call with raw caller input. */
export function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export const OUTCOME_BY_CODE = {
  "reviewed-implementation-reused": "reused",
  "case-snapshot-missing": "missing",
  "mapping-missing": "missing",
  "step-implementation-missing": "missing",
  "mapping-ambiguous": "ambiguous",
  "scenario-identity-ambiguous": "ambiguous",
  "step-ambiguous": "ambiguous",
  "case-revision-drift": "invalidated",
  "mapping-case-revision-drift": "invalidated",
  "feature-validation-failed": "invalidated",
  "mapping-revision-drift": "invalidated",
  "approval-stale": "invalidated",
  "approval-mismatch": "invalidated",
  "scenario-missing": "invalidated",
  "scenario-validation-issues": "invalidated",
  "expected-outcome-not-approved": "unapproved",
  "mapping-not-approved": "unapproved",
  "scenario-not-approved": "unapproved",
} as const satisfies Record<ReadinessCode, ReadinessOutcome>;

export function missingStepIndexes(
  code: ReadinessCode,
  steps: readonly StepReuse[],
): number[] {
  return code === "step-implementation-missing"
    ? steps
        .filter((step) => step.status === "missing")
        .map((step) => step.index)
    : [];
}

export function summarize(
  cases: readonly CaseReadiness[],
): Record<ReadinessOutcome, number> {
  const summary: Record<ReadinessOutcome, number> = {
    reused: 0,
    missing: 0,
    ambiguous: 0,
    invalidated: 0,
    unapproved: 0,
  };
  for (const entry of cases) {
    summary[entry.outcome] += 1;
  }
  return summary;
}

export function reportDigestOf(
  inputDigest: string,
  cases: readonly CaseReadiness[],
): string {
  return digest({ reportVersion: 1, inputDigest, cases });
}
