import type { FeatureValidation } from "./feature-validator";
import { selectApprovedScenarios } from "./scenario-selector";
import type {
  CaseReadiness,
  ImplementationMappingSnapshot,
  ProjectedApproval,
  ProjectedScenario,
  ProjectedValidation,
  ReadinessCode,
  ReuseReadinessInput,
  ReuseReadinessReport,
  ReviewedCaseSnapshot,
  SelectedCaseReference,
  StepReuse,
} from "./reuse-readiness-types";
import {
  IDENTITY_FIELDS,
  OUTCOME_BY_CODE,
  deepFreeze,
  digest,
  guard,
  missingStepIndexes,
  projectInput,
  reportDigestOf,
  summarize,
} from "./reuse-readiness-shared";

export type {
  AuthoringCandidateEvidence,
  CaseReadiness,
  ImplementationMappingSnapshot,
  ReuseReadinessInput,
  ReuseReadinessReport,
  ReviewedCaseSnapshot,
} from "./reuse-readiness-types";
export { assessCandidateReviewReadiness } from "./reuse-readiness-candidate";

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
