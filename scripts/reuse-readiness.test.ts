// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: exercises src/validation/reuse-readiness.ts against the synthetic reviewed-scenarios fixture through the real feature validator; does not run the product end to end.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessReuseReadiness,
  type ReuseReadinessInput,
} from "../src/validation/reuse-readiness";
import { createValidationManifest } from "../fixtures/input-preparation/reviewed-fixtures";
import { approvalFor } from "./fixtures/approval";
import {
  ValidFeature,
  APPROVED_IDS,
  IMPLEMENTATION_REVISION,
  baseInput,
  caseOf,
  deepFreeze,
  expectReport,
  mapping,
  reviewedCase,
  validate,
} from "./fixtures/reuse-readiness-helpers";

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
