// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: exercises src/validation/reuse-readiness.ts against the synthetic reviewed-scenarios fixture through the real feature validator; does not run the product end to end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  assessCandidateReviewReadiness,
  assessReuseReadiness,
  type ReuseReadinessInput,
  type ReuseReadinessReport,
} from "../src/validation/reuse-readiness";
import { createValidationManifest } from "../fixtures/input-preparation/reviewed-fixtures";
import { approvalFor } from "./fixtures/approval";
import {
  ValidFeature,
  ValidReport,
  APPROVED_IDS,
  IMPLEMENTATION_REVISION,
  baseInput,
  caseOf,
  expectReport,
  mapping,
  readyCandidate,
  validate,
  withApprovedScenarios,
} from "./fixtures/reuse-readiness-helpers";

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
  } as ReuseReadinessInput;
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
    return copy as ReuseReadinessReport;
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

test("readiness modules never load step sources, processes or network clients", () => {
  // The module group may import only node:crypto, the scenario selector and each other,
  // each file with an exact allowed set, so a new dependency in any file fails here.
  const allowed: Record<string, string[]> = {
    "reuse-readiness": [
      "./reuse-readiness-candidate",
      "./reuse-readiness-shared",
      "./scenario-selector",
    ],
    "reuse-readiness-candidate": ["./reuse-readiness-shared"],
    "reuse-readiness-shared": ["node:crypto"],
    "reuse-readiness-types": [],
  };
  for (const [name, expected] of Object.entries(allowed)) {
    const compiled = readFileSync(
      path.join(__dirname, `../src/validation/${name}.js`),
      "utf8",
    );
    const required = [...compiled.matchAll(/require\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    assert.deepEqual([...new Set(required)].sort(), expected, name);
    assert.doesNotMatch(compiled, /\bimport\(|eval\(|new Function/, name);
  }
});
