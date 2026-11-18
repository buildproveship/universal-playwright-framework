// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: exercises src/validation/reuse-readiness.ts against the synthetic reviewed-scenarios fixture through the real feature validator; does not run the product end to end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  validateFeatureFile,
  type FeatureValidation,
  type ReviewedStepManifest,
} from "../src/validation/feature-validator";
import {
  selectApprovedScenarios,
  type ScenarioApproval,
} from "../src/validation/scenario-selector";
import {
  assessCandidateReviewReadiness,
  assessReuseReadiness,
  type AuthoringCandidateEvidence,
  type CaseReadiness,
  type ImplementationMappingSnapshot,
  type ReuseReadinessInput,
  type ReuseReadinessReport,
  type ReviewedCaseSnapshot,
} from "../src/validation/reuse-readiness";
import { createValidationManifest } from "../fixtures/input-preparation/reviewed-fixtures";

const repositoryRoot = path.resolve(__dirname, "../../..");
const fixturePath = "fixtures/validation/reviewed-scenarios.feature";
const SOURCE_REVISION = "synthetic-source-a";
const IMPLEMENTATION_REVISION = "synthetic-steps-a";

type ValidFeature = Extract<FeatureValidation, { valid: true }>;
type ValidReport = Extract<ReuseReadinessReport, { valid: true }>;

async function validate(
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

function approvalFor(
  validation: ValidFeature,
  ids: readonly string[],
): ScenarioApproval {
  return {
    featurePath: validation.featurePath,
    sourceRevision: validation.sourceRevision,
    featureRevision: validation.featureRevision,
    implementationRevision: validation.implementationRevision,
    scenarios: ids.map((id) => {
      const scenario = validation.scenarios.find((item) => item.id === id);
      assert.ok(scenario, `Expected synthetic scenario ${id}`);
      return { id, tags: [...scenario.tags] };
    }),
  };
}

function reviewedCase(
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

function mapping(
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

const APPROVED_IDS = [
  "approved-basic",
  "approved-outline/row-a",
  "approved-outline/row-b",
  "undefined-step",
];

async function baseInput(): Promise<ReuseReadinessInput> {
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

function expectReport(report: ReuseReadinessReport): ValidReport {
  assert.equal(report.valid, true, report.valid ? "" : report.reason);
  return report;
}

function caseOf(report: ValidReport, caseId: string): CaseReadiness {
  const found = report.cases.find((item) => item.caseId === caseId);
  assert.ok(found, `Expected case ${caseId} in report`);
  return found;
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

test("reuses an approved mapping whose reviewed steps all match, as reference-only metadata", async () => {
  const report = expectReport(assessReuseReadiness(await baseInput()));

  assert.equal(report.authority, "reference-only");
  assert.equal(report.executionAuthorized, false);
  assert.match(report.inputDigest, /^[a-f0-9]{64}$/);
  assert.match(report.reportDigest, /^[a-f0-9]{64}$/);

  const basic = caseOf(report, "TC-basic");
  assert.equal(basic.outcome, "reused");
  assert.equal(basic.code, "reviewed-implementation-reused");
  assert.equal(basic.scenarioId, "approved-basic");
  assert.deepEqual(basic.mappingIds, ["map-basic"]);
  assert.equal(basic.executionAuthorized, false);
  assert.deepEqual(
    basic.steps.map((step) => [step.status, step.implementationId]),
    [
      ["reused", "common-setup"],
      ["reused", "rule-setup"],
      ["reused", "open-demo"],
    ],
  );
  assert.deepEqual(basic.candidateStepIndexes, []);
  assert.deepEqual(report.summary, {
    reused: 1,
    missing: 2,
    ambiguous: 0,
    invalidated: 0,
    unapproved: 0,
  });
  assert.deepEqual(
    report.cases.map((item) => item.caseId),
    ["TC-basic", "TC-unimplemented", "TC-unmapped"],
  );
});

test("reports reused steps before identifying only missing steps as candidate work", async () => {
  const report = expectReport(assessReuseReadiness(await baseInput()));

  const unimplemented = caseOf(report, "TC-unimplemented");
  assert.equal(unimplemented.outcome, "missing");
  assert.equal(unimplemented.code, "step-implementation-missing");
  assert.deepEqual(
    unimplemented.steps.map((step) => step.status),
    ["reused", "reused", "missing"],
  );
  assert.equal(unimplemented.steps[2]?.implementationId, null);
  assert.deepEqual(unimplemented.candidateStepIndexes, [2]);
  assert.equal(unimplemented.expectedOutcomeDigest, "outcome-TC-unimplemented");

  const unmapped = caseOf(report, "TC-unmapped");
  assert.equal(unmapped.outcome, "missing");
  assert.equal(unmapped.code, "mapping-missing");
  assert.equal(unmapped.scenarioId, null);
  assert.deepEqual(unmapped.steps, []);
  assert.deepEqual(unmapped.candidateStepIndexes, []);
});

test("keeps ambiguous mappings, scenario identities and step matches explicit", async () => {
  const input = await baseInput();
  const twoMappings = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        ...input.mappings,
        mapping(
          "map-basic-alt",
          "TC-basic",
          "approved-outline/row-a",
          input.validation as ValidFeature,
        ),
      ],
    }),
  );
  const basic = caseOf(twoMappings, "TC-basic");
  assert.equal(basic.outcome, "ambiguous");
  assert.equal(basic.code, "mapping-ambiguous");
  assert.deepEqual(basic.mappingIds, ["map-basic", "map-basic-alt"]);
  assert.equal(basic.scenarioId, null);

  const overlapping = await validate({
    implementationRevision: IMPLEMENTATION_REVISION,
    steps: [
      ...createValidationManifest(IMPLEMENTATION_REVISION).steps,
      { id: "open-any-demo", expression: "the demo page is {word}" },
    ],
  });
  const ambiguousStep = expectReport(
    assessReuseReadiness({
      ...input,
      selection: [{ caseId: "TC-basic", caseRevision: "case-rev-1" }],
      cases: [reviewedCase("TC-basic")],
      mappings: [
        mapping("map-basic", "TC-basic", "approved-basic", overlapping),
      ],
      validation: overlapping,
      approval: approvalFor(overlapping, APPROVED_IDS),
    }),
  );
  const step = caseOf(ambiguousStep, "TC-basic");
  assert.equal(step.outcome, "ambiguous");
  assert.equal(step.code, "step-ambiguous");
  assert.equal(step.steps[2]?.status, "ambiguous");
  assert.deepEqual(step.candidateStepIndexes, []);

  const validation = input.validation as ValidFeature;
  const duplicateIdentity = expectReport(
    assessReuseReadiness({
      ...input,
      validation: {
        ...validation,
        scenarios: [...validation.scenarios, validation.scenarios[0]],
      },
    }),
  );
  assert.equal(
    caseOf(duplicateIdentity, "TC-basic").code,
    "scenario-identity-ambiguous",
  );
});

test("invalidates case, mapping, implementation, feature and approval revision drift", async () => {
  const input = await baseInput();
  const validation = input.validation as ValidFeature;

  const caseDrift = expectReport(
    assessReuseReadiness({
      ...input,
      cases: [
        reviewedCase("TC-basic", {
          caseRevision: "case-rev-2",
          expectedOutcome: {
            reviewState: "approved",
            reviewedCaseRevision: "case-rev-2",
            digest: "outcome-TC-basic",
          },
        }),
        ...input.cases.slice(1),
      ],
    }),
  );
  assert.equal(caseOf(caseDrift, "TC-basic").outcome, "invalidated");
  assert.equal(caseOf(caseDrift, "TC-basic").code, "case-revision-drift");

  const mappingCaseDrift = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        mapping("map-basic", "TC-basic", "approved-basic", validation, {
          caseRevision: "case-rev-0",
        }),
      ],
    }),
  );
  assert.equal(
    caseOf(mappingCaseDrift, "TC-basic").code,
    "mapping-case-revision-drift",
  );

  const implementationDrift = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        mapping("map-basic", "TC-basic", "approved-basic", validation, {
          implementationRevision: "synthetic-steps-old",
        }),
      ],
    }),
  );
  const drifted = caseOf(implementationDrift, "TC-basic");
  assert.equal(drifted.outcome, "invalidated");
  assert.equal(drifted.code, "mapping-revision-drift");
  assert.match(drifted.reason, /implementationRevision/);

  const featureDrift = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        mapping("map-basic", "TC-basic", "approved-basic", validation, {
          featureRevision: "0".repeat(64),
        }),
      ],
    }),
  );
  assert.match(caseOf(featureDrift, "TC-basic").reason, /featureRevision/);

  const newerSource = await validate(undefined, "synthetic-source-b");
  const staleApproval = expectReport(
    assessReuseReadiness({
      ...input,
      validation: newerSource,
      mappings: [
        mapping("map-basic", "TC-basic", "approved-basic", newerSource),
      ],
    }),
  );
  assert.equal(caseOf(staleApproval, "TC-basic").code, "approval-stale");

  const tagDrift = expectReport(
    assessReuseReadiness({
      ...input,
      approval: {
        ...input.approval,
        scenarios: input.approval.scenarios.map((approved) =>
          approved.id === "approved-basic"
            ? { id: approved.id, tags: ["@changed-tag"] }
            : approved,
        ),
      },
    }),
  );
  const tags = caseOf(tagDrift, "TC-basic");
  assert.equal(tags.outcome, "invalidated");
  assert.equal(tags.code, "approval-mismatch");
  assert.match(tags.reason, /stale/);

  const removedScenario = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        mapping("map-basic", "TC-basic", "removed-scenario", validation),
      ],
    }),
  );
  assert.equal(caseOf(removedScenario, "TC-basic").code, "scenario-missing");
});

test("treats unapproved expected outcomes, mappings and scenarios as non-executable", async () => {
  const input = await baseInput();
  const validation = input.validation as ValidFeature;

  for (const expectedOutcome of [
    {
      reviewState: "pending" as const,
      reviewedCaseRevision: "case-rev-1",
      digest: "outcome-TC-basic",
    },
    {
      reviewState: "rejected" as const,
      reviewedCaseRevision: "case-rev-1",
      digest: "outcome-TC-basic",
    },
    {
      reviewState: "approved" as const,
      reviewedCaseRevision: "case-rev-0",
      digest: "outcome-TC-basic",
    },
  ]) {
    const report = expectReport(
      assessReuseReadiness({
        ...input,
        cases: [
          reviewedCase("TC-basic", { expectedOutcome }),
          ...input.cases.slice(1),
        ],
      }),
    );
    const basic = caseOf(report, "TC-basic");
    assert.equal(basic.outcome, "unapproved");
    assert.equal(basic.code, "expected-outcome-not-approved");
    assert.equal(basic.expectedOutcomeDigest, null);
    assert.deepEqual(basic.steps, []);
    assert.equal(basic.executionAuthorized, false);
  }

  const proposed = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        mapping("map-basic", "TC-basic", "approved-basic", validation, {
          reviewState: "proposed",
        }),
      ],
    }),
  );
  assert.equal(caseOf(proposed, "TC-basic").outcome, "unapproved");
  assert.equal(caseOf(proposed, "TC-basic").code, "mapping-not-approved");

  const notInManifest = expectReport(
    assessReuseReadiness({
      ...input,
      approval: approvalFor(validation, ["approved-outline/row-a"]),
    }),
  );
  assert.equal(caseOf(notInManifest, "TC-basic").code, "scenario-not-approved");
});

test("does not reuse anything when feature validation failed", async () => {
  const input = await baseInput();
  const report = expectReport(
    assessReuseReadiness({
      ...input,
      validation: { valid: false, reason: "Feature contains invalid Gherkin" },
    }),
  );
  const basic = caseOf(report, "TC-basic");
  assert.equal(basic.outcome, "invalidated");
  assert.equal(basic.code, "feature-validation-failed");
  assert.doesNotMatch(basic.reason, /invalid Gherkin/);
  assert.equal(caseOf(report, "TC-unmapped").code, "mapping-missing");
});

test("rejects malformed, empty and duplicate selections and snapshots", async () => {
  const input = await baseInput();
  const validation = input.validation as ValidFeature;
  const cases: [string, unknown, RegExp][] = [
    ["non-object", null, /input/i],
    ["empty selection", { ...input, selection: [] }, /at least one/i],
    [
      "duplicate selection",
      {
        ...input,
        selection: [input.selection[0], input.selection[0]],
      },
      /duplicate selected case/i,
    ],
    [
      "duplicate case snapshot",
      { ...input, cases: [...input.cases, input.cases[0]] },
      /duplicate case snapshot/i,
    ],
    [
      "duplicate mapping id",
      { ...input, mappings: [...input.mappings, input.mappings[0]] },
      /duplicate mapping/i,
    ],
    [
      "unstable case id",
      {
        ...input,
        selection: [{ caseId: "TC basic", caseRevision: "case-rev-1" }],
      },
      /stable identifier/i,
    ],
    [
      "empty revision",
      { ...input, selection: [{ caseId: "TC-basic", caseRevision: " " }] },
      /revision/i,
    ],
    [
      "unknown review state",
      {
        ...input,
        mappings: [
          {
            ...mapping("map-basic", "TC-basic", "approved-basic", validation),
            reviewState: "auto-approved",
          },
        ],
      },
      /review state/i,
    ],
    [
      "missing expected outcome",
      {
        ...input,
        cases: [{ caseId: "TC-basic", caseRevision: "case-rev-1" }],
      },
      /expected outcome/i,
    ],
    ["missing approval", { ...input, approval: undefined }, /approval/i],
    [
      "function in consumed field",
      { ...input, selection: [{ caseId: "TC-basic", caseRevision: () => 1 }] },
      /revision/i,
    ],
  ];
  for (const [label, malformed, reason] of cases) {
    const result = assessReuseReadiness(malformed as ReuseReadinessInput);
    assert.equal(result.valid, false, label);
    assert.match(result.reason, reason, label);
  }
});

test("snapshots inputs immutably, freezes reports and stays deterministic", async () => {
  const input = deepFreeze(await baseInput());
  const before = JSON.stringify(input);

  const first = expectReport(assessReuseReadiness(input));
  const second = expectReport(assessReuseReadiness(input));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(first, second);
  assert.equal(first.reportDigest, second.reportDigest);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.cases));
  assert.ok(Object.isFrozen(first.cases[0]?.steps));
  assert.throws(() => {
    (first as { executionAuthorized: boolean }).executionAuthorized = true;
  }, TypeError);

  const firstJson = JSON.stringify(first);
  const changed = expectReport(
    assessReuseReadiness({
      ...input,
      selection: input.selection.slice(0, 1),
    }),
  );
  assert.notEqual(changed.inputDigest, first.inputDigest);
  assert.notEqual(changed.reportDigest, first.reportDigest);
  assert.equal(JSON.stringify(first), firstJson);
});

function readyCandidate(
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

function withApprovedScenarios(
  input: ReuseReadinessInput,
  scenarios: ScenarioApproval["scenarios"],
): ReuseReadinessInput {
  return { ...input, approval: { ...input.approval, scenarios } };
}

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

test("rejects malformed consumed fields as invalid without throwing", async () => {
  const input = await baseInput();
  const validation = input.validation as ValidFeature;
  const withScenario = (patch: Record<string, unknown>) => ({
    ...input,
    validation: {
      ...validation,
      scenarios: [{ ...validation.scenarios[0], ...patch }],
    },
  });
  const accessorSelection = Object.defineProperty(
    { caseId: "TC-basic" },
    "caseRevision",
    { enumerable: true, get: () => "case-rev-1" },
  );
  const malformed: [string, unknown][] = [
    ["null step", withScenario({ steps: [null] })],
    ["missing tags", withScenario({ tags: undefined })],
    ["non-string tag", withScenario({ tags: [42] })],
    ["fractional step index", withScenario({ steps: [{ index: 0.5 }] })],
    [
      "unknown step issue",
      withScenario({ steps: [{ index: 0, issue: "maybe" }] }),
    ],
    ["missing runnable flag", withScenario({ runnable: "yes" })],
    ["non-string scenario id", withScenario({ id: 7 })],
    [
      "approval tags missing",
      withApprovedScenarios(input, [{ id: "approved-basic" } as never]),
    ],
    ["accessor property", { ...input, selection: [accessorSelection] }],
    ["map instead of list", { ...input, mappings: new Map() }],
    [
      "failed validation without reason",
      { ...input, validation: { valid: false } },
    ],
  ];
  for (const [label, value] of malformed) {
    const result = assessReuseReadiness(value as ReuseReadinessInput);
    assert.equal(result.valid, false, label);
  }
});

test("ignores unconsumed cyclic, BigInt and function extras when snapshotting", async () => {
  const input = await baseInput();
  const baseline = expectReport(assessReuseReadiness(input));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const validation = input.validation as ValidFeature;
  const decorated = {
    ...input,
    extra: cyclic,
    selection: input.selection.map((entry) => ({
      ...entry,
      big: BigInt(1),
      callback: () => 1,
    })),
    validation: {
      ...validation,
      cyclic,
      scenarios: validation.scenarios.map((scenario) => ({
        ...scenario,
        cyclic,
      })),
    },
  } as unknown as ReuseReadinessInput;
  const report = expectReport(assessReuseReadiness(decorated));
  assert.equal(report.inputDigest, baseline.inputDigest);
  assert.equal(report.reportDigest, baseline.reportDigest);
});

test("enforces snapshot size limits", async () => {
  const input = await baseInput();
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => index);
  const oversized: [string, unknown][] = [
    [
      "selection",
      {
        ...input,
        selection: many(1_001).map((index) => ({
          caseId: `TC-${index}`,
          caseRevision: "case-rev-1",
        })),
      },
    ],
    [
      "mappings",
      {
        ...input,
        mappings: many(10_001).map((index) => ({
          ...input.mappings[0],
          mappingId: `map-${index}`,
        })),
      },
    ],
    [
      "approval scenarios",
      withApprovedScenarios(
        input,
        many(10_001).map((index) => ({ id: `s-${index}`, tags: [] })),
      ),
    ],
    [
      "tag length",
      withApprovedScenarios(input, [
        { id: "approved-basic", tags: ["@".repeat(5_000)] },
      ]),
    ],
  ];
  for (const [label, value] of oversized) {
    const result = assessReuseReadiness(value as ReuseReadinessInput);
    assert.equal(result.valid, false, label);
    assert.match(result.reason, /limit|exceed/i, label);
  }
});

const LEAK_PROBE = "leak-probe-aaaa-0000";

test("keeps reports reference-only without feature text, values or validator reasons", async () => {
  const input = await baseInput();
  const validation = input.validation as ValidFeature;
  const marked: ReuseReadinessInput = {
    ...input,
    cases: input.cases.map((entry) => ({
      ...entry,
      notes: LEAK_PROBE,
    })),
    validation: {
      ...validation,
      scenarios: validation.scenarios.map((scenario) => ({
        ...scenario,
        name: `${scenario.name} ${LEAK_PROBE}`,
        exampleRow: { caseId: "row", values: { secret: LEAK_PROBE } },
        issues: scenario.issues.map((issue) => `${issue} ${LEAK_PROBE}`),
        steps: scenario.steps.map((step) => ({
          ...step,
          text: `${step.text} ${LEAK_PROBE}`,
        })),
      })),
    },
  };
  const report = expectReport(assessReuseReadiness(marked));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(LEAK_PROBE));
  assert.deepEqual(Object.keys(caseOf(report, "TC-basic").steps[0] ?? {}), [
    "index",
    "status",
    "implementationId",
  ]);
  const candidate = assessCandidateReviewReadiness(
    report,
    readyCandidate(report),
  );
  assert.doesNotMatch(JSON.stringify(candidate), new RegExp(LEAK_PROBE));

  const failed = expectReport(
    assessReuseReadiness({
      ...input,
      validation: { valid: false, reason: `Bad Gherkin ${LEAK_PROBE}` },
    }),
  );
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(LEAK_PROBE));

  const issues = expectReport(
    assessReuseReadiness({
      ...marked,
      validation: {
        ...(marked.validation as ValidFeature),
        scenarios: (marked.validation as ValidFeature).scenarios.map(
          (scenario) =>
            scenario.id === "approved-basic"
              ? { ...scenario, runnable: false }
              : scenario,
        ),
      },
    }),
  );
  assert.equal(caseOf(issues, "TC-basic").code, "scenario-validation-issues");
  assert.doesNotMatch(JSON.stringify(issues), new RegExp(LEAK_PROBE));
});

test("covers absent cases, uncovered missing steps and wrong feature paths", async () => {
  const input = await baseInput();
  const absent = expectReport(
    assessReuseReadiness({
      ...input,
      cases: input.cases.filter((entry) => entry.caseId !== "TC-unmapped"),
    }),
  );
  const unmapped = caseOf(absent, "TC-unmapped");
  assert.equal(unmapped.outcome, "missing");
  assert.equal(unmapped.code, "case-snapshot-missing");

  const validation = input.validation as ValidFeature;
  const wrongPath = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        mapping("map-basic", "TC-basic", "approved-basic", validation, {
          featurePath: "fixtures/validation/other.feature",
        }),
      ],
    }),
  );
  assert.equal(caseOf(wrongPath, "TC-basic").code, "mapping-revision-drift");
  assert.match(caseOf(wrongPath, "TC-basic").reason, /featurePath/);

  const withoutRuleSetup = await validate({
    implementationRevision: IMPLEMENTATION_REVISION,
    steps: createValidationManifest(IMPLEMENTATION_REVISION).steps.filter(
      (step) => step.id !== "rule-setup",
    ),
  });
  const twoGaps = expectReport(
    assessReuseReadiness({
      ...input,
      mappings: [
        mapping(
          "map-unimpl",
          "TC-unimplemented",
          "undefined-step",
          withoutRuleSetup,
        ),
      ],
      validation: withoutRuleSetup,
      approval: approvalFor(withoutRuleSetup, APPROVED_IDS),
    }),
  );
  assert.deepEqual(
    caseOf(twoGaps, "TC-unimplemented").candidateStepIndexes,
    [1, 2],
  );
  const partial = assessCandidateReviewReadiness(
    twoGaps,
    readyCandidate(twoGaps, { targetStepIndexes: [2] }),
  );
  assert.equal(partial.valid, true);
  assert.equal(partial.status, "blocked");
  assert.deepEqual(
    partial.blockers.map((blocker) => blocker.code),
    ["missing-step-not-targeted"],
  );
});

test("rejects malformed or internally inconsistent reports before candidate review", async () => {
  const report = expectReport(assessReuseReadiness(await baseInput()));
  const roundTripped = JSON.parse(JSON.stringify(report)) as ValidReport;
  const accepted = assessCandidateReviewReadiness(
    roundTripped,
    readyCandidate(report),
  );
  assert.equal(accepted.valid && accepted.status, "ready-for-human-review");

  // Tampering deliberately bypasses the report's readonly types: the copy is
  // plain JSON, and each edited container is checked to be an object first.
  type MutableJson = Record<PropertyKey, unknown>;
  const json = (value: unknown): MutableJson => {
    assert.ok(typeof value === "object" && value !== null);
    return value as MutableJson;
  };
  const tamper = (edit: (copy: MutableJson) => void) => {
    const copy = json(JSON.parse(JSON.stringify(report)));
    edit(copy);
    return copy as unknown as ReuseReadinessReport;
  };
  const tampered: [string, ReuseReadinessReport][] = [
    [
      "null case entry",
      tamper((copy) => {
        json(copy.cases)[1] = null;
      }),
    ],
    [
      "rewritten expected outcome",
      tamper((copy) => {
        json(json(copy.cases)[1]).expectedOutcomeDigest = "outcome-x";
      }),
    ],
    [
      "extra candidate step",
      tamper((copy) => {
        json(json(copy.cases)[1]).candidateStepIndexes = [0, 2];
      }),
    ],
    [
      "execution authority",
      tamper((copy) => {
        copy.executionAuthorized = true;
      }),
    ],
    [
      "case execution authority",
      tamper((copy) => {
        json(json(copy.cases)[0]).executionAuthorized = true;
      }),
    ],
    [
      "authority",
      tamper((copy) => {
        copy.authority = "execution";
      }),
    ],
    [
      "summary",
      tamper((copy) => {
        json(copy.summary).reused = 3;
      }),
    ],
    [
      "cases not a list",
      tamper((copy) => {
        copy.cases = {};
      }),
    ],
    [
      "outcome and code",
      tamper((copy) => {
        json(json(copy.cases)[0]).outcome = "missing";
      }),
    ],
  ];
  for (const [label, value] of tampered) {
    const result = assessCandidateReviewReadiness(
      value,
      readyCandidate(report, { expectedOutcomeDigest: "outcome-x" }),
    );
    assert.equal(result.valid, false, label);
  }
});

test("readiness module never loads step sources, processes or network clients", () => {
  const compiled = readFileSync(
    path.join(__dirname, "../src/validation/reuse-readiness.js"),
    "utf8",
  );
  const required = [...compiled.matchAll(/require\("([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(required.sort(), ["./scenario-selector", "node:crypto"]);
  assert.doesNotMatch(compiled, /\bimport\(|eval\(|new Function/);
});
