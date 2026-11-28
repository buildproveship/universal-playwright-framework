// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: exercises src/validation/reuse-readiness.ts against the synthetic reviewed-scenarios fixture through the real feature validator; does not run the product end to end.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectApprovedScenarios,
  type ScenarioApproval,
} from "../src/validation/scenario-selector";
import {
  assessCandidateReviewReadiness,
  assessReuseReadiness,
  type AuthoringCandidateEvidence,
} from "../src/validation/reuse-readiness";
import {
  baseInput,
  caseOf,
  expectReport,
  readyCandidate,
  reviewedCase,
  withApprovedScenarios,
} from "./fixtures/reuse-readiness-helpers";

test("marks a fully evidenced candidate only as ready for human review", async () => {
  const report = expectReport(assessReuseReadiness(await baseInput()));
  const reportJson = JSON.stringify(report);
  const readiness = assessCandidateReviewReadiness(
    report,
    readyCandidate(report),
  );
  assert.equal(readiness.valid, true);
  assert.equal(readiness.status, "ready-for-human-review");
  assert.deepEqual(readiness.blockers, []);
  assert.equal(readiness.acceptance, "not-accepted");
  assert.equal(readiness.executionAuthorized, false);
  assert.equal(readiness.reportDigest, report.reportDigest);
  assert.match(readiness.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.ok(
    readiness.humanReviewRequired.some((item) => /assertion/i.test(item)),
  );
  assert.ok(Object.isFrozen(readiness));
  assert.equal(JSON.stringify(report), reportJson);
});

test("blocks candidates with failed, missing or stale validation and outcome or assertion changes", async () => {
  const report = expectReport(assessReuseReadiness(await baseInput()));
  const failed = { status: "failed" as const, candidateRevision: "cand-rev-1" };
  const notRun = {
    status: "not-run" as const,
    candidateRevision: "cand-rev-1",
  };
  const stale = { status: "passed" as const, candidateRevision: "cand-rev-0" };
  const baseChecks = readyCandidate(report).checks;

  const scenarios: [string, Partial<AuthoringCandidateEvidence>, string][] = [
    [
      "failed lint",
      { checks: { ...baseChecks, lint: failed } },
      "validation-failed",
    ],
    [
      "not-run tests",
      { checks: { ...baseChecks, ownedSyntheticTests: notRun } },
      "validation-missing",
    ],
    [
      "absent typecheck",
      {
        checks: {
          lint: baseChecks.lint,
          ownedSyntheticTests: baseChecks.ownedSyntheticTests,
        },
      },
      "validation-missing",
    ],
    [
      "stale typecheck",
      { checks: { ...baseChecks, typecheck: stale } },
      "validation-stale",
    ],
    [
      "changed outcome",
      { expectedOutcomeDigest: "outcome-rewritten" },
      "expected-outcome-changed",
    ],
    [
      "declared assertion change",
      { assertionChanges: "declared" },
      "assertion-change-declared",
    ],
    [
      "modified reviewed step",
      { modifiedReviewedStepIds: ["common-setup"] },
      "reviewed-step-modified",
    ],
    [
      "targets reused step",
      { targetStepIndexes: [0, 2] },
      "target-step-not-missing",
    ],
    [
      "stale report",
      { reuseReportDigest: "f".repeat(64) },
      "reuse-report-stale",
    ],
    ["unknown case", { caseId: "TC-other" }, "case-not-in-report"],
    [
      "case without step gap",
      { caseId: "TC-basic", expectedOutcomeDigest: "outcome-TC-basic" },
      "case-not-awaiting-step-implementation",
    ],
  ];

  for (const [label, overrides, code] of scenarios) {
    const readiness = assessCandidateReviewReadiness(
      report,
      readyCandidate(report, overrides),
    );
    assert.equal(readiness.valid, true, label);
    assert.equal(readiness.status, "blocked", label);
    assert.equal(readiness.acceptance, "not-accepted", label);
    assert.equal(readiness.executionAuthorized, false, label);
    assert.ok(
      readiness.blockers.some((blocker) => blocker.code === code),
      `${label}: expected ${code}, got ${readiness.blockers.map((b) => b.code).join(",")}`,
    );
  }
});

test("blocks candidates for unapproved outcomes and rejects malformed candidate evidence", async () => {
  const input = await baseInput();
  const unapproved = expectReport(
    assessReuseReadiness({
      ...input,
      cases: [
        input.cases[0],
        reviewedCase("TC-unimplemented", {
          expectedOutcome: {
            reviewState: "pending",
            reviewedCaseRevision: "case-rev-1",
            digest: "outcome-TC-unimplemented",
          },
        }),
        input.cases[2],
      ],
    }),
  );
  const blocked = assessCandidateReviewReadiness(
    unapproved,
    readyCandidate(unapproved),
  );
  assert.equal(blocked.valid, true);
  assert.equal(blocked.status, "blocked");
  assert.ok(
    blocked.blockers.some(
      (blocker) => blocker.code === "case-not-awaiting-step-implementation",
    ),
  );

  const report = expectReport(assessReuseReadiness(input));
  const malformed: [string, unknown][] = [
    ["empty targets", readyCandidate(report, { targetStepIndexes: [] })],
    [
      "duplicate targets",
      readyCandidate(report, { targetStepIndexes: [2, 2] }),
    ],
    ["negative target", readyCandidate(report, { targetStepIndexes: [-1] })],
    [
      "unknown assertion declaration",
      { ...readyCandidate(report), assertionChanges: "trust-me" },
    ],
    [
      "unknown check status",
      {
        ...readyCandidate(report),
        checks: {
          typecheck: { status: "skipped", candidateRevision: "cand-rev-1" },
        },
      },
    ],
    ["null candidate", null],
  ];
  for (const [label, candidate] of malformed) {
    const result = assessCandidateReviewReadiness(
      report,
      candidate as AuthoringCandidateEvidence,
    );
    assert.equal(result.valid, false, label);
  }
  assert.equal(
    assessCandidateReviewReadiness(
      { valid: false, reason: "bad input" },
      readyCandidate(report),
    ).valid,
    false,
  );
});

test("applies approval manifest integrity before reuse or candidate eligibility", async () => {
  const input = await baseInput();
  const approved = input.approval.scenarios;
  const retag = (id: string) =>
    approved.map((entry) =>
      entry.id === id ? { id, tags: [...entry.tags, "@drifted"] } : entry,
    );
  const variants: [string, ScenarioApproval["scenarios"]][] = [
    ["changed tag on missing-step scenario", retag("undefined-step")],
    ["unrelated approved scenario tag drift", retag("approved-outline/row-b")],
    ["duplicate approval identifiers", [...approved, approved[0]]],
    [
      "approved identifier missing from feature",
      [...approved, { id: "ghost-scenario", tags: [] }],
    ],
  ];

  for (const [label, scenarios] of variants) {
    const drifted = withApprovedScenarios(input, scenarios);
    const report = expectReport(assessReuseReadiness(drifted));
    for (const caseId of ["TC-basic", "TC-unimplemented"]) {
      const entry = caseOf(report, caseId);
      assert.equal(entry.outcome, "invalidated", `${label}: ${caseId}`);
      assert.equal(entry.code, "approval-mismatch", `${label}: ${caseId}`);
      assert.deepEqual(entry.candidateStepIndexes, [], `${label}: ${caseId}`);
    }
    // Parity with the existing selector semantics for the same snapshot.
    assert.equal(
      selectApprovedScenarios(drifted.validation, drifted.approval).runnable,
      false,
      label,
    );
    const candidate = assessCandidateReviewReadiness(
      report,
      readyCandidate(report),
    );
    assert.equal(candidate.valid && candidate.status, "blocked", label);
  }
});
