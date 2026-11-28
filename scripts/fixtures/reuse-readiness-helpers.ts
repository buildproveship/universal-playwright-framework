// Shared synthetic helpers for the reuse-readiness*.test.ts files; no tests are registered here.
import assert from "node:assert/strict";
import path from "node:path";
import {
  validateFeatureFile,
  type FeatureValidation,
  type ReviewedStepManifest,
} from "../../src/validation/feature-validator";
import { type ScenarioApproval } from "../../src/validation/scenario-selector";
import {
  type AuthoringCandidateEvidence,
  type CaseReadiness,
  type ImplementationMappingSnapshot,
  type ReuseReadinessInput,
  type ReuseReadinessReport,
  type ReviewedCaseSnapshot,
} from "../../src/validation/reuse-readiness";
import { createValidationManifest } from "../../fixtures/input-preparation/reviewed-fixtures";
import { approvalFor } from "./approval";

export const repositoryRoot = path.resolve(__dirname, "../../../..");
export const fixturePath = "fixtures/validation/reviewed-scenarios.feature";
export const SOURCE_REVISION = "synthetic-source-a";
export const IMPLEMENTATION_REVISION = "synthetic-steps-a";

export type ValidFeature = Extract<FeatureValidation, { valid: true }>;
export type ValidReport = Extract<ReuseReadinessReport, { valid: true }>;

export async function validate(
  manifest: ReviewedStepManifest = createValidationManifest(
    IMPLEMENTATION_REVISION,
  ),
  sourceRevision = SOURCE_REVISION,
): Promise<ValidFeature> {
  const validation = await validateFeatureFile({
    workspaceRoot: repositoryRoot,
    featurePath: fixturePath,
    sourceRevision,
    manifest,
  });
  assert.equal(validation.valid, true);
  return validation;
}

export function reviewedCase(
  caseId: string,
  overrides: Partial<ReviewedCaseSnapshot> = {},
): ReviewedCaseSnapshot {
  return {
    caseId,
    caseRevision: "case-rev-1",
    expectedOutcome: {
      reviewState: "approved",
      reviewedCaseRevision: "case-rev-1",
      digest: `outcome-${caseId}`,
    },
    ...overrides,
  };
}

export function mapping(
  mappingId: string,
  caseId: string,
  scenarioId: string,
  validation: ValidFeature,
  overrides: Partial<ImplementationMappingSnapshot> = {},
): ImplementationMappingSnapshot {
  return {
    mappingId,
    caseId,
    caseRevision: "case-rev-1",
    scenarioId,
    featurePath: validation.featurePath,
    sourceRevision: validation.sourceRevision,
    featureRevision: validation.featureRevision,
    implementationRevision: validation.implementationRevision,
    reviewState: "approved",
    ...overrides,
  };
}

export const APPROVED_IDS = [
  "approved-basic",
  "approved-outline/row-a",
  "approved-outline/row-b",
  "undefined-step",
];

export async function baseInput(): Promise<ReuseReadinessInput> {
  const validation = await validate();
  return {
    selection: [
      { caseId: "TC-basic", caseRevision: "case-rev-1" },
      { caseId: "TC-unimplemented", caseRevision: "case-rev-1" },
      { caseId: "TC-unmapped", caseRevision: "case-rev-1" },
    ],
    cases: [
      reviewedCase("TC-basic"),
      reviewedCase("TC-unimplemented"),
      reviewedCase("TC-unmapped"),
    ],
    mappings: [
      mapping("map-basic", "TC-basic", "approved-basic", validation),
      mapping("map-unimpl", "TC-unimplemented", "undefined-step", validation),
    ],
    validation,
    approval: approvalFor(validation, APPROVED_IDS),
  };
}

export function expectReport(report: ReuseReadinessReport): ValidReport {
  assert.equal(report.valid, true, report.valid ? "" : report.reason);
  return report;
}

export function caseOf(report: ValidReport, caseId: string): CaseReadiness {
  const found = report.cases.find((item) => item.caseId === caseId);
  assert.ok(found, `Expected case ${caseId} in report`);
  return found;
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

export function readyCandidate(
  report: ValidReport,
  overrides: Partial<AuthoringCandidateEvidence> = {},
): AuthoringCandidateEvidence {
  const passed = { status: "passed" as const, candidateRevision: "cand-rev-1" };
  return {
    candidateId: "candidate-1",
    caseId: "TC-unimplemented",
    candidateRevision: "cand-rev-1",
    reuseReportDigest: report.reportDigest,
    expectedOutcomeDigest: "outcome-TC-unimplemented",
    targetStepIndexes: [2],
    modifiedReviewedStepIds: [],
    assertionChanges: "none-declared",
    checks: { typecheck: passed, lint: passed, ownedSyntheticTests: passed },
    ...overrides,
  };
}

export function withApprovedScenarios(
  input: ReuseReadinessInput,
  scenarios: ScenarioApproval["scenarios"],
): ReuseReadinessInput {
  return { ...input, approval: { ...input.approval, scenarios } };
}
