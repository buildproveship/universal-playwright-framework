import type { FeatureValidation } from "./feature-validator";
import type { ScenarioApproval } from "./scenario-selector";

export type ReadinessCode =
  | "reviewed-implementation-reused"
  | "case-snapshot-missing"
  | "mapping-missing"
  | "step-implementation-missing"
  | "mapping-ambiguous"
  | "scenario-identity-ambiguous"
  | "step-ambiguous"
  | "case-revision-drift"
  | "mapping-case-revision-drift"
  | "feature-validation-failed"
  | "mapping-revision-drift"
  | "approval-stale"
  | "approval-mismatch"
  | "scenario-missing"
  | "scenario-validation-issues"
  | "expected-outcome-not-approved"
  | "mapping-not-approved"
  | "scenario-not-approved";

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

type CandidateBlockerCode =
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

export interface Identity {
  readonly featurePath: string;
  readonly sourceRevision: string;
  readonly featureRevision: string;
  readonly implementationRevision: string;
}

export interface ProjectedStep {
  readonly index: number;
  readonly implementationId: string | null;
  readonly issue: "undefined" | "ambiguous" | null;
}

export interface ProjectedScenario {
  readonly id: string | null;
  readonly tags: readonly string[];
  readonly runnable: boolean;
  readonly steps: readonly ProjectedStep[];
}

export type ProjectedValidation =
  | { readonly valid: false; readonly reason: string }
  | (Identity & {
      readonly valid: true;
      readonly scenarios: readonly ProjectedScenario[];
    });

export type ProjectedApproval = Identity & {
  readonly scenarios: readonly {
    readonly id: string;
    readonly tags: readonly string[];
  }[];
};

export interface ProjectedInput {
  readonly selection: readonly SelectedCaseReference[];
  readonly cases: readonly ReviewedCaseSnapshot[];
  readonly mappings: readonly ImplementationMappingSnapshot[];
  readonly validation: ProjectedValidation;
  readonly approval: ProjectedApproval;
}

export type ValidReport = Extract<ReuseReadinessReport, { valid: true }>;
