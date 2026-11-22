import type {
  AuthoringCandidateEvidence,
  CandidateBlocker,
  CandidateCheckEvidence,
  CandidateReviewReadiness,
  CaseReadiness,
  ReadinessCode,
  ReuseReadinessReport,
  StepReuse,
  ValidReport,
} from "./reuse-readiness-types";
import {
  DIGEST_PATTERN,
  MAX_IDENTIFIER_LENGTH,
  MAX_MAPPING_SNAPSHOTS,
  MAX_SELECTED_CASES,
  MAX_TEXT_LENGTH,
  MAX_VALIDATED_STEPS,
  OUTCOMES,
  OUTCOME_BY_CODE,
  REQUIRED_CANDIDATE_CHECKS,
  SCENARIO_ID_PATTERN,
  STEP_STATUSES,
  boundedText,
  deepFreeze,
  digest,
  fail,
  guard,
  missingStepIndexes,
  oneOf,
  plainList,
  plainRecord,
  readField,
  rejectDuplicates,
  reportDigestOf,
  revision,
  stableId,
  stepIndex,
  summarize,
} from "./reuse-readiness-shared";

/** Decisions this module cannot make; a ready candidate still needs all of them. */
const CANDIDATE_HUMAN_REVIEW_REQUIRED: readonly string[] = Object.freeze([
  "Assertions prove the approved expected outcome and were not weakened or removed",
  "Code belongs in the correct repository (generic public framework or private customer automation)",
  "A reviewed implementation revision and pin update cover the candidate code",
  "The case-to-implementation mapping is approved for the exact case and implementation revisions",
]);

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
