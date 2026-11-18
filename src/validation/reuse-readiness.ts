import { createHash } from "node:crypto";
import type { FeatureValidation } from "./feature-validator";
import {
  selectApprovedScenarios,
  type ScenarioApproval,
} from "./scenario-selector";

export interface SelectedCaseReference {
  readonly caseId: string;
  readonly caseRevision: string;
}

export interface ReviewedCaseSnapshot {
  readonly caseId: string;
  readonly caseRevision: string;
  readonly expectedOutcome: {
    readonly reviewState: "approved" | "pending" | "rejected";
    readonly reviewedCaseRevision: string;
    readonly digest: string;
  };
}

export interface ImplementationMappingSnapshot {
  readonly mappingId: string;
  readonly caseId: string;
  readonly caseRevision: string;
  readonly scenarioId: string;
  readonly featurePath: string;
  readonly sourceRevision: string;
  readonly featureRevision: string;
  readonly implementationRevision: string;
  readonly reviewState: "approved" | "proposed" | "rejected";
}

export interface ReuseReadinessInput {
  readonly selection: readonly SelectedCaseReference[];
  readonly cases: readonly ReviewedCaseSnapshot[];
  readonly mappings: readonly ImplementationMappingSnapshot[];
  readonly validation: FeatureValidation;
  readonly approval: ScenarioApproval;
}

export type ReadinessOutcome =
  "reused" | "missing" | "ambiguous" | "invalidated" | "unapproved";

const OUTCOME_BY_CODE = {
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
} as const satisfies Record<string, ReadinessOutcome>;

export type ReadinessCode = keyof typeof OUTCOME_BY_CODE;

/** Fixed, sanitized explanations; no feature text or upstream reasons. */
const REASON_BY_CODE: Record<ReadinessCode, string> = {
  "reviewed-implementation-reused":
    "Every step matches exactly one reviewed step definition under a current approved mapping",
  "case-snapshot-missing":
    "No reviewed case snapshot was supplied for the selected case",
  "mapping-missing":
    "No reviewed case-to-scenario mapping exists for this case revision",
  "step-implementation-missing":
    "At least one step has no reviewed step definition",
  "mapping-ambiguous":
    "More than one approved mapping exists for this case revision",
  "scenario-identity-ambiguous":
    "Mapped scenario identifier resolves to more than one scenario",
  "step-ambiguous":
    "At least one step matches more than one reviewed step definition",
  "case-revision-drift":
    "Selected case revision differs from the current reviewed case revision",
  "mapping-case-revision-drift":
    "Approved mappings exist only for a different case revision",
  "feature-validation-failed":
    "Feature validation failed; see the validator output for details",
  "mapping-revision-drift":
    "Approved mapping no longer matches the validated feature or implementation",
  "approval-stale":
    "Scenario approval is stale; feature or implementation revision changed",
  "approval-mismatch":
    "Scenario approval is stale or inconsistent; an approved scenario identifier or its tags changed",
  "scenario-missing": "Mapped scenario is not present in the validated feature",
  "scenario-validation-issues":
    "Mapped scenario has validation issues other than step matching",
  "expected-outcome-not-approved":
    "Expected outcome is not approved for this exact case revision; no reuse or candidate work",
  "mapping-not-approved":
    "Mappings for this case revision are proposed or rejected, not approved",
  "scenario-not-approved":
    "Mapped scenario is not in the approved scenario manifest",
};

export interface StepReuse {
  readonly index: number;
  readonly status: "reused" | "missing" | "ambiguous";
  readonly implementationId: string | null;
}

export interface CaseReadiness {
  readonly caseId: string;
  readonly caseRevision: string;
  readonly outcome: ReadinessOutcome;
  readonly code: ReadinessCode;
  readonly reason: string;
  readonly mappingIds: readonly string[];
  readonly scenarioId: string | null;
  readonly expectedOutcomeDigest: string | null;
  readonly steps: readonly StepReuse[];
  readonly candidateStepIndexes: readonly number[];
  readonly executionAuthorized: false;
}

export type ReuseReadinessReport =
  | { readonly valid: false; readonly reason: string }
  | {
      readonly valid: true;
      readonly reportVersion: 1;
      readonly authority: "reference-only";
      readonly executionAuthorized: false;
      readonly inputDigest: string;
      readonly reportDigest: string;
      readonly cases: readonly CaseReadiness[];
      readonly summary: Readonly<Record<ReadinessOutcome, number>>;
    };

export interface CandidateCheckEvidence {
  readonly status: "passed" | "failed" | "not-run";
  readonly candidateRevision: string;
}

export interface AuthoringCandidateEvidence {
  readonly candidateId: string;
  readonly caseId: string;
  readonly candidateRevision: string;
  readonly reuseReportDigest: string;
  readonly expectedOutcomeDigest: string;
  readonly targetStepIndexes: readonly number[];
  readonly modifiedReviewedStepIds: readonly string[];
  readonly assertionChanges: "none-declared" | "declared";
  readonly checks: {
    readonly typecheck?: CandidateCheckEvidence;
    readonly lint?: CandidateCheckEvidence;
    readonly ownedSyntheticTests?: CandidateCheckEvidence;
  };
}

export type CandidateBlockerCode =
  | "reuse-report-stale"
  | "case-not-in-report"
  | "case-not-awaiting-step-implementation"
  | "expected-outcome-changed"
  | "target-step-not-missing"
  | "missing-step-not-targeted"
  | "reviewed-step-modified"
  | "assertion-change-declared"
  | "validation-missing"
  | "validation-failed"
  | "validation-stale";

export interface CandidateBlocker {
  readonly code: CandidateBlockerCode;
  readonly detail: string;
}

export type CandidateReviewReadiness =
  | { readonly valid: false; readonly reason: string }
  | {
      readonly valid: true;
      readonly candidateId: string;
      readonly caseId: string;
      readonly status: "ready-for-human-review" | "blocked";
      readonly blockers: readonly CandidateBlocker[];
      readonly acceptance: "not-accepted";
      readonly executionAuthorized: false;
      readonly humanReviewRequired: readonly string[];
      readonly reportDigest: string;
      readonly evidenceDigest: string;
    };

export const MAX_SELECTED_CASES = 1_000;
export const MAX_CASE_SNAPSHOTS = 10_000;
export const MAX_MAPPING_SNAPSHOTS = 10_000;
// Match the feature validator's hard expansion ceilings.
export const MAX_VALIDATED_SCENARIOS = 10_000;
export const MAX_VALIDATED_STEPS = 100_000;
const MAX_APPROVED_SCENARIOS = 10_000;
const MAX_TAGS_PER_SCENARIO = 1_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REVISION_LENGTH = 512;
const MAX_TEXT_LENGTH = 4_096;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCENARIO_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const OUTCOMES = [
  "reused",
  "missing",
  "ambiguous",
  "invalidated",
  "unapproved",
] as const;
const STEP_STATUSES = ["reused", "missing", "ambiguous"] as const;
const REQUIRED_CANDIDATE_CHECKS = [
  "typecheck",
  "lint",
  "ownedSyntheticTests",
] as const;
const IDENTITY_FIELDS = [
  "featurePath",
  "sourceRevision",
  "featureRevision",
  "implementationRevision",
] as const;

/** Decisions this module cannot make; a ready candidate still needs all of them. */
export const CANDIDATE_HUMAN_REVIEW_REQUIRED: readonly string[] = Object.freeze(
  [
    "Assertions prove the approved expected outcome and were not weakened or removed",
    "Code belongs in the correct repository (generic public framework or private customer automation)",
    "A reviewed implementation revision and pin update cover the candidate code",
    "The case-to-implementation mapping is approved for the exact case and implementation revisions",
  ],
);

type Identity = Record<(typeof IDENTITY_FIELDS)[number], string>;

interface ProjectedStep {
  readonly index: number;
  readonly implementationId: string | null;
  readonly issue: "undefined" | "ambiguous" | null;
}

interface ProjectedScenario {
  readonly id: string | null;
  readonly tags: readonly string[];
  readonly runnable: boolean;
  readonly steps: readonly ProjectedStep[];
}

type ProjectedValidation =
  | { readonly valid: false; readonly reason: string }
  | (Identity & {
      readonly valid: true;
      readonly scenarios: readonly ProjectedScenario[];
    });

type ProjectedApproval = Identity & {
  readonly scenarios: readonly {
    readonly id: string;
    readonly tags: readonly string[];
  }[];
};

interface ProjectedInput {
  readonly selection: readonly SelectedCaseReference[];
  readonly cases: readonly ReviewedCaseSnapshot[];
  readonly mappings: readonly ImplementationMappingSnapshot[];
  readonly validation: ProjectedValidation;
  readonly approval: ProjectedApproval;
}

type ValidReport = Extract<ReuseReadinessReport, { valid: true }>;

/** Raised only for caller-supplied data that fails the snapshot contract. */
class MalformedSnapshot extends Error {}

const NOT_DATA = Symbol("not-data");

function fail(reason: string): never {
  throw new MalformedSnapshot(reason);
}

function invalid(reason: string): {
  readonly valid: false;
  readonly reason: string;
} {
  return { valid: false, reason };
}

function guard<T>(project: () => T): T | { valid: false; reason: string } {
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
function readField(owner: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (descriptor === undefined) return undefined;
  return "value" in descriptor ? descriptor.value : NOT_DATA;
}

function plainRecord(value: unknown, label: string): object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function plainList(value: unknown, label: string, max: number): unknown[] {
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

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  if (value.length > max) {
    fail(`${label} exceeds the length limit of ${max}`);
  }
  return value;
}

function stableId(
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

function revision(value: unknown, label: string): string {
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

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (!allowed.includes(value as T)) {
    fail(`${label} is not a known value`);
  }
  return value as T;
}

function stepIndex(value: unknown, label: string): number {
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

function rejectDuplicates(values: readonly string[], message: string): void {
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

function projectInput(input: unknown): ProjectedInput {
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
function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  const leftTags = new Set(left);
  const rightTags = new Set(right);
  return (
    leftTags.size === rightTags.size &&
    [...leftTags].every((tag) => rightTags.has(tag))
  );
}

/**
 * Mirrors selectApprovedScenarios' manifest integrity checks (duplicate IDs,
 * removed approved scenarios, tag drift) so they also gate candidate work,
 * which the selector cannot report because it filters non-runnable scenarios.
 */
function approvalIntegrityIntact(
  validation: Extract<ProjectedValidation, { valid: true }>,
  approval: ProjectedApproval,
): boolean {
  const approvedIds = new Set<string>();
  for (const approved of approval.scenarios) {
    if (approvedIds.has(approved.id)) return false;
    approvedIds.add(approved.id);
  }
  const scenariosById = new Map<string, ProjectedScenario>();
  for (const scenario of validation.scenarios) {
    if (scenario.id !== null) scenariosById.set(scenario.id, scenario);
  }
  return approval.scenarios.every((approved) => {
    const current = scenariosById.get(approved.id);
    return current !== undefined && sameTags(current.tags, approved.tags);
  });
}

/** The selector reads only identity, scenario IDs, tags and runnable flags. */
function selectorView(
  validation: Extract<ProjectedValidation, { valid: true }>,
): FeatureValidation {
  return {
    valid: true,
    featurePath: validation.featurePath,
    sourceRevision: validation.sourceRevision,
    featureRevision: validation.featureRevision,
    implementationRevision: validation.implementationRevision,
    scenarios: validation.scenarios.map((scenario) => ({
      id: scenario.id,
      name: "",
      tags: scenario.tags,
      steps: [],
      issues: [],
      runnable: scenario.runnable,
    })),
  };
}

interface CaseDecision {
  readonly code: ReadinessCode;
  readonly reason?: string;
  readonly mappingIds?: readonly string[];
  readonly scenarioId?: string;
  readonly steps?: readonly StepReuse[];
}

function stepReuse(scenario: ProjectedScenario): StepReuse[] {
  return scenario.steps.map((step) => ({
    index: step.index,
    status:
      step.implementationId !== null
        ? "reused"
        : step.issue === "ambiguous"
          ? "ambiguous"
          : "missing",
    implementationId: step.implementationId,
  }));
}

function decideMappedScenario(
  mapping: ImplementationMappingSnapshot,
  validation: ProjectedValidation,
  approval: ProjectedApproval,
): CaseDecision {
  const mapped = {
    mappingIds: [mapping.mappingId],
    scenarioId: mapping.scenarioId,
  };
  if (!validation.valid) {
    return { ...mapped, code: "feature-validation-failed" };
  }
  const mappingDrift = IDENTITY_FIELDS.filter(
    (field) => mapping[field] !== validation[field],
  );
  if (mappingDrift.length > 0) {
    return {
      ...mapped,
      code: "mapping-revision-drift",
      reason: `Approved mapping no longer matches the validated ${mappingDrift.join(", ")}`,
    };
  }
  if (IDENTITY_FIELDS.some((field) => approval[field] !== validation[field])) {
    return { ...mapped, code: "approval-stale" };
  }
  if (!approvalIntegrityIntact(validation, approval)) {
    return { ...mapped, code: "approval-mismatch" };
  }

  const scenarios = validation.scenarios.filter(
    (scenario) => scenario.id === mapping.scenarioId,
  );
  if (scenarios.length === 0) {
    return { ...mapped, code: "scenario-missing" };
  }
  if (scenarios.length > 1) {
    return { ...mapped, code: "scenario-identity-ambiguous" };
  }
  const [scenario] = scenarios;
  const withSteps = { ...mapped, steps: stepReuse(scenario) };
  if (!approval.scenarios.some((approved) => approved.id === scenario.id)) {
    return { ...withSteps, code: "scenario-not-approved" };
  }
  if (withSteps.steps.some((step) => step.status === "ambiguous")) {
    return { ...withSteps, code: "step-ambiguous" };
  }
  if (withSteps.steps.some((step) => step.status === "missing")) {
    return { ...withSteps, code: "step-implementation-missing" };
  }
  if (!scenario.runnable) {
    return { ...withSteps, code: "scenario-validation-issues" };
  }

  const selection = selectApprovedScenarios(
    selectorView(validation),
    approval,
    {
      scenarioIds: [mapping.scenarioId],
    },
  );
  if (
    !selection.runnable ||
    selection.scenarios.length !== 1 ||
    selection.scenarios[0].id !== mapping.scenarioId
  ) {
    return { ...withSteps, code: "approval-mismatch" };
  }
  return { ...withSteps, code: "reviewed-implementation-reused" };
}

function decideCase(
  selected: SelectedCaseReference,
  snapshot: ReviewedCaseSnapshot | undefined,
  mappings: readonly ImplementationMappingSnapshot[],
  validation: ProjectedValidation,
  approval: ProjectedApproval,
): CaseDecision {
  if (!snapshot) {
    return { code: "case-snapshot-missing" };
  }
  if (snapshot.caseRevision !== selected.caseRevision) {
    return { code: "case-revision-drift" };
  }
  const outcome = snapshot.expectedOutcome;
  if (
    outcome.reviewState !== "approved" ||
    outcome.reviewedCaseRevision !== snapshot.caseRevision
  ) {
    return { code: "expected-outcome-not-approved" };
  }

  const caseMappings = mappings.filter(
    (mapping) => mapping.caseId === selected.caseId,
  );
  const idsOf = (list: readonly ImplementationMappingSnapshot[]) =>
    list.map((mapping) => mapping.mappingId).sort();
  const approvedCurrent = caseMappings.filter(
    (mapping) =>
      mapping.reviewState === "approved" &&
      mapping.caseRevision === snapshot.caseRevision,
  );
  if (approvedCurrent.length > 1) {
    return { code: "mapping-ambiguous", mappingIds: idsOf(approvedCurrent) };
  }
  if (approvedCurrent.length === 1) {
    return decideMappedScenario(approvedCurrent[0], validation, approval);
  }
  const approvedStale = caseMappings.filter(
    (mapping) => mapping.reviewState === "approved",
  );
  if (approvedStale.length > 0) {
    return {
      code: "mapping-case-revision-drift",
      mappingIds: idsOf(approvedStale),
    };
  }
  const unreviewed = caseMappings.filter(
    (mapping) => mapping.caseRevision === snapshot.caseRevision,
  );
  if (unreviewed.length > 0) {
    return { code: "mapping-not-approved", mappingIds: idsOf(unreviewed) };
  }
  return { code: "mapping-missing" };
}

function missingStepIndexes(
  code: ReadinessCode,
  steps: readonly StepReuse[],
): number[] {
  return code === "step-implementation-missing"
    ? steps
        .filter((step) => step.status === "missing")
        .map((step) => step.index)
    : [];
}

function summarize(
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

function reportDigestOf(
  inputDigest: string,
  cases: readonly CaseReadiness[],
): string {
  return digest({ reportVersion: 1, inputDigest, cases });
}

/**
 * Deterministic reuse/readiness report for selected reviewed cases.
 * Reads only validated projections of the supplied snapshots; never loads step
 * sources, contacts targets or grants execution. Every outcome, including
 * "reused", is reference-only.
 */
export function assessReuseReadiness(
  input: ReuseReadinessInput,
): ReuseReadinessReport {
  const projected = guard(() => projectInput(input));
  if ("valid" in projected) {
    return projected;
  }

  const casesById = new Map(
    projected.cases.map((entry) => [entry.caseId, entry]),
  );
  const cases: CaseReadiness[] = projected.selection.map((selected) => {
    const caseSnapshot = casesById.get(selected.caseId);
    const decision = decideCase(
      selected,
      caseSnapshot,
      projected.mappings,
      projected.validation,
      projected.approval,
    );
    const steps = decision.steps ?? [];
    return {
      caseId: selected.caseId,
      caseRevision: selected.caseRevision,
      outcome: OUTCOME_BY_CODE[decision.code],
      code: decision.code,
      reason: decision.reason ?? REASON_BY_CODE[decision.code],
      mappingIds: decision.mappingIds ?? [],
      scenarioId: decision.scenarioId ?? null,
      expectedOutcomeDigest:
        caseSnapshot && decision.code !== "expected-outcome-not-approved"
          ? caseSnapshot.expectedOutcome.digest
          : null,
      steps,
      candidateStepIndexes: missingStepIndexes(decision.code, steps),
      executionAuthorized: false,
    };
  });

  const inputDigest = digest(projected);
  return deepFreeze({
    valid: true,
    reportVersion: 1,
    authority: "reference-only",
    executionAuthorized: false,
    inputDigest,
    reportDigest: reportDigestOf(inputDigest, cases),
    cases,
    summary: summarize(cases),
  });
}

function nullable<T>(
  value: unknown,
  project: (present: unknown) => T,
): T | null {
  return value === null ? null : project(value);
}

function sameNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function projectReportCase(value: unknown): CaseReadiness {
  const owner = plainRecord(value, "Report case");
  const code = oneOf(
    readField(owner, "code"),
    Object.keys(OUTCOME_BY_CODE) as ReadinessCode[],
    "Report case code",
  );
  const outcome = oneOf(
    readField(owner, "outcome"),
    OUTCOMES,
    "Report case outcome",
  );
  if (OUTCOME_BY_CODE[code] !== outcome) {
    fail("Report case outcome does not match its code");
  }
  const steps = plainList(
    readField(owner, "steps"),
    "Report case steps",
    MAX_VALIDATED_STEPS,
  ).map((entry): StepReuse => {
    const step = plainRecord(entry, "Report step");
    const status = oneOf(
      readField(step, "status"),
      STEP_STATUSES,
      "Report step status",
    );
    const implementationId = nullable(
      readField(step, "implementationId"),
      (present) =>
        boundedText(
          present,
          "Report step implementation",
          MAX_IDENTIFIER_LENGTH,
        ),
    );
    if ((status === "reused") !== (implementationId !== null)) {
      fail("Report step status does not match its implementation identifier");
    }
    return {
      index: stepIndex(readField(step, "index"), "Report step"),
      status,
      implementationId,
    };
  });
  const candidateStepIndexes = plainList(
    readField(owner, "candidateStepIndexes"),
    "Report candidate steps",
    MAX_VALIDATED_STEPS,
  ).map((index) => stepIndex(index, "Report candidate step"));
  if (!sameNumbers(candidateStepIndexes, missingStepIndexes(code, steps))) {
    fail("Report candidate steps do not match its missing steps");
  }
  if (readField(owner, "executionAuthorized") !== false) {
    fail("Report cases must not authorize execution");
  }
  return {
    caseId: stableId(readField(owner, "caseId"), "Report case"),
    caseRevision: revision(readField(owner, "caseRevision"), "Report case"),
    outcome,
    code,
    reason: boundedText(
      readField(owner, "reason"),
      "Report case reason",
      MAX_TEXT_LENGTH,
    ),
    mappingIds: plainList(
      readField(owner, "mappingIds"),
      "Report mapping identifiers",
      MAX_MAPPING_SNAPSHOTS,
    ).map((id) => stableId(id, "Report mapping")),
    scenarioId: nullable(readField(owner, "scenarioId"), (present) =>
      stableId(present, "Report scenario", SCENARIO_ID_PATTERN),
    ),
    expectedOutcomeDigest: nullable(
      readField(owner, "expectedOutcomeDigest"),
      (present) => revision(present, "Report expected outcome digest"),
    ),
    steps,
    candidateStepIndexes,
    executionAuthorized: false,
  };
}

/**
 * Re-projects a report (for example after JSON transport) and verifies its
 * structure and internal digest. This detects inconsistent or edited reports;
 * it is not an authenticity check, because anyone can recompute the hash.
 */
function projectReport(value: unknown): ValidReport {
  const owner = plainRecord(value, "Reuse readiness report");
  if (
    readField(owner, "valid") !== true ||
    readField(owner, "reportVersion") !== 1
  ) {
    fail("A valid reuse readiness report is required");
  }
  if (
    readField(owner, "authority") !== "reference-only" ||
    readField(owner, "executionAuthorized") !== false
  ) {
    fail("Reuse readiness reports must be reference-only");
  }
  const inputDigest = readField(owner, "inputDigest");
  const reportDigest = readField(owner, "reportDigest");
  if (
    typeof inputDigest !== "string" ||
    typeof reportDigest !== "string" ||
    !DIGEST_PATTERN.test(inputDigest) ||
    !DIGEST_PATTERN.test(reportDigest)
  ) {
    fail("Reuse readiness report digests are malformed");
  }
  const cases = plainList(
    readField(owner, "cases"),
    "Report cases",
    MAX_SELECTED_CASES,
  ).map(projectReportCase);
  rejectDuplicates(
    cases.map((entry) => entry.caseId),
    "Report contains duplicate case",
  );
  const summaryOwner = plainRecord(
    readField(owner, "summary"),
    "Report summary",
  );
  const summary = summarize(cases);
  if (
    Object.keys(summaryOwner).length !== OUTCOMES.length ||
    OUTCOMES.some(
      (outcome) => readField(summaryOwner, outcome) !== summary[outcome],
    )
  ) {
    fail("Report summary does not match its cases");
  }
  if (reportDigestOf(inputDigest, cases) !== reportDigest) {
    fail("Reuse readiness report failed its internal digest check");
  }
  return {
    valid: true,
    reportVersion: 1,
    authority: "reference-only",
    executionAuthorized: false,
    inputDigest,
    reportDigest,
    cases,
    summary,
  };
}

function projectCheck(value: unknown, label: string): CandidateCheckEvidence {
  const owner = plainRecord(value, label);
  return {
    status: oneOf(
      readField(owner, "status"),
      ["passed", "failed", "not-run"] as const,
      `${label} status`,
    ),
    candidateRevision: revision(readField(owner, "candidateRevision"), label),
  };
}

function projectCandidate(value: unknown): AuthoringCandidateEvidence {
  const owner = plainRecord(value, "Candidate evidence");
  const targetStepIndexes = plainList(
    readField(owner, "targetStepIndexes"),
    "Candidate target steps",
    MAX_VALIDATED_STEPS,
  ).map((index) => stepIndex(index, "Candidate target step"));
  if (targetStepIndexes.length === 0) {
    fail("Candidate needs a non-empty list of unique step indexes");
  }
  rejectDuplicates(
    targetStepIndexes.map(String),
    "Candidate targets duplicate step",
  );
  const checksOwner = plainRecord(
    readField(owner, "checks"),
    "Candidate validation checks",
  );
  const checks: Record<string, CandidateCheckEvidence> = {};
  for (const name of REQUIRED_CANDIDATE_CHECKS) {
    const check = readField(checksOwner, name);
    if (check !== undefined) {
      checks[name] = projectCheck(check, `Candidate ${name} check`);
    }
  }
  return {
    candidateId: stableId(readField(owner, "candidateId"), "Candidate"),
    caseId: stableId(readField(owner, "caseId"), "Candidate case"),
    candidateRevision: revision(
      readField(owner, "candidateRevision"),
      "Candidate",
    ),
    reuseReportDigest: revision(
      readField(owner, "reuseReportDigest"),
      "Candidate report digest",
    ),
    expectedOutcomeDigest: revision(
      readField(owner, "expectedOutcomeDigest"),
      "Candidate expected outcome digest",
    ),
    targetStepIndexes,
    modifiedReviewedStepIds: plainList(
      readField(owner, "modifiedReviewedStepIds"),
      "Candidate modified reviewed steps",
      MAX_VALIDATED_STEPS,
    ).map((id) =>
      boundedText(
        id,
        "Candidate modified reviewed step",
        MAX_IDENTIFIER_LENGTH,
      ),
    ),
    assertionChanges: oneOf(
      readField(owner, "assertionChanges"),
      ["none-declared", "declared"] as const,
      "Candidate assertion change declaration",
    ),
    checks,
  };
}

function candidateBlockers(
  report: ValidReport,
  candidate: AuthoringCandidateEvidence,
): CandidateBlocker[] {
  const blockers: CandidateBlocker[] = [];
  if (candidate.reuseReportDigest !== report.reportDigest) {
    blockers.push({
      code: "reuse-report-stale",
      detail: "Candidate was prepared against a different reuse report",
    });
  }
  const entry = report.cases.find((item) => item.caseId === candidate.caseId);
  if (!entry) {
    blockers.push({
      code: "case-not-in-report",
      detail: "Candidate case is not part of the reuse report",
    });
  } else {
    if (entry.code !== "step-implementation-missing") {
      blockers.push({
        code: "case-not-awaiting-step-implementation",
        detail: `Case readiness is ${entry.outcome} (${entry.code})`,
      });
    }
    if (candidate.expectedOutcomeDigest !== entry.expectedOutcomeDigest) {
      blockers.push({
        code: "expected-outcome-changed",
        detail: "Candidate does not reference the approved expected outcome",
      });
    }
    const missing = new Set(entry.candidateStepIndexes);
    const extra = candidate.targetStepIndexes.filter(
      (index) => !missing.has(index),
    );
    if (extra.length > 0) {
      blockers.push({
        code: "target-step-not-missing",
        detail: `Steps ${extra.join(", ")} are not missing reviewed definitions`,
      });
    }
    const targeted = new Set(candidate.targetStepIndexes);
    const untargeted = entry.candidateStepIndexes.filter(
      (index) => !targeted.has(index),
    );
    if (untargeted.length > 0) {
      blockers.push({
        code: "missing-step-not-targeted",
        detail: `Missing steps ${untargeted.join(", ")} are not covered`,
      });
    }
  }
  if (candidate.modifiedReviewedStepIds.length > 0) {
    blockers.push({
      code: "reviewed-step-modified",
      detail: `Candidate changes ${candidate.modifiedReviewedStepIds.length} reviewed step definition(s)`,
    });
  }
  if (candidate.assertionChanges === "declared") {
    blockers.push({
      code: "assertion-change-declared",
      detail:
        "Candidate declares assertion changes; these need separate human review",
    });
  }
  for (const name of REQUIRED_CANDIDATE_CHECKS) {
    const check = candidate.checks[name];
    if (!check || check.status === "not-run") {
      blockers.push({
        code: "validation-missing",
        detail: `${name} was not run`,
      });
    } else if (check.status === "failed") {
      blockers.push({ code: "validation-failed", detail: `${name} failed` });
    } else if (check.candidateRevision !== candidate.candidateRevision) {
      blockers.push({
        code: "validation-stale",
        detail: `${name} evidence is for a different candidate revision`,
      });
    }
  }
  return blockers;
}

/**
 * Decides only whether caller-supplied candidate evidence is complete enough to
 * request human review. It never accepts a candidate or authorizes execution,
 * and it does not inspect or run candidate code.
 */
export function assessCandidateReviewReadiness(
  report: ReuseReadinessReport,
  candidate: AuthoringCandidateEvidence,
): CandidateReviewReadiness {
  const projected = guard(() => ({
    report: projectReport(report),
    candidate: projectCandidate(candidate),
  }));
  if ("valid" in projected) {
    return projected;
  }
  const blockers = candidateBlockers(projected.report, projected.candidate);
  return deepFreeze({
    valid: true,
    candidateId: projected.candidate.candidateId,
    caseId: projected.candidate.caseId,
    status: blockers.length === 0 ? "ready-for-human-review" : "blocked",
    blockers,
    acceptance: "not-accepted",
    executionAuthorized: false,
    humanReviewRequired: [...CANDIDATE_HUMAN_REVIEW_REQUIRED],
    reportDigest: projected.report.reportDigest,
    evidenceDigest: digest(projected.candidate),
  });
}
