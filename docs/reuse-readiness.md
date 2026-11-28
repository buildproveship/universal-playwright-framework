# Reuse readiness and authoring-candidate review readiness (RRDWEB-24, first slice)

`src/validation/reuse-readiness.ts` is an **internal** module. It is not exported
from the package root or any `exports` subpath. It produces deterministic,
reference-only metadata. It does **not** execute tests, generate code, call an AI
provider, contact a target, or grant run permission.

The module is split by responsibility: `reuse-readiness.ts` (the entry point and reuse decisions),
`reuse-readiness-candidate.ts` (candidate review readiness), `reuse-readiness-shared.ts` (snapshot
projection, limits and digests) and `reuse-readiness-types.ts` (types only). The files may import only
`node:crypto`, `scenario-selector` and each other; `scripts/reuse-readiness-reports.test.ts` checks each
file's exact imports.

## What it does

`assessReuseReadiness(input)` takes immutable snapshots of:

- `selection`: the cases pinned by a test run (`caseId`, `caseRevision`). The list
  must not be empty or contain duplicates.
- `cases`: reviewed case snapshots, each with an expected-outcome review
  (`reviewState`, `reviewedCaseRevision`, `digest`).
- `mappings`: case-to-scenario mapping records that bind a case revision to a
  scenario ID, feature path, source, feature and implementation revisions.
- `validation`: a `validateFeatureFile` result. It matches steps against the
  reviewed manifest's Cucumber Expressions and never loads step source.
- `approval`: the existing `ScenarioApproval` manifest.

The module returns one entry per selected case. Each entry has a stable `outcome`
and `code`:

| Outcome       | Codes                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reused`      | `reviewed-implementation-reused`: exactly one current approved mapping; every step matches one reviewed definition; `selectApprovedScenarios` selects the scenario.                                   |
| `missing`     | `case-snapshot-missing`, `mapping-missing`, `step-implementation-missing` (with `candidateStepIndexes`).                                                                                              |
| `ambiguous`   | `mapping-ambiguous`, `scenario-identity-ambiguous`, `step-ambiguous`.                                                                                                                                 |
| `invalidated` | `case-revision-drift`, `mapping-case-revision-drift`, `mapping-revision-drift`, `approval-stale`, `approval-mismatch`, `scenario-missing`, `scenario-validation-issues`, `feature-validation-failed`. |
| `unapproved`  | `expected-outcome-not-approved`, `mapping-not-approved`, `scenario-not-approved`.                                                                                                                     |

Checks run in this order. A case is reported against the first one it fails:

1. case snapshot present;
2. case revision drift;
3. expected-outcome approval;
4. mapping review;
5. feature validation;
6. mapping and approval revision drift;
7. **manifest integrity**;
8. scenario identity;
9. manifest membership;
10. step matches;
11. other scenario issues;
12. the existing `selectApprovedScenarios`, run as a final confirmation for `reused` only.

Manifest integrity is checked the same way the selector checks it: approved IDs
must be unique, and every approved scenario must still exist with the same tags.
It is applied before both `reused` and `step-implementation-missing`. So a stale
manifest, including tag drift on an unrelated approved scenario, produces
`approval-mismatch` and no candidate work. A unit test confirms the selector
rejects the same snapshots.

If the expected outcome is not approved for the exact case revision, no reuse or
candidate work is reported. Step-level `reused`, `missing` and `ambiguous`
statuses are reported before any candidate work. Only `missing` steps under an
approved mapping in an intact manifest become `candidateStepIndexes`.

### Snapshot contract

- **Projection.** Each input is read through an explicit allowlisted projection.
  Only own data properties of plain objects and arrays are read. Every consumed
  field is type-checked and bounded:
  - 1,000 selected cases; 10,000 case snapshots and mappings;
  - 10,000 validated scenarios and 100,000 steps;
  - 10,000 approved scenarios and 1,000 tags per scenario;
  - text up to 4,096 characters.
- **Extras.** Unconsumed extra properties are ignored and never hashed. That
  includes cyclic, BigInt and function values.
- **Malformed input.** Accessors, non-plain containers, missing or wrong-typed
  consumed fields, and oversized lists or strings return `{ valid: false, reason }`.
  Only that snapshot-contract error is caught; programming errors still throw.
- **Reference-only output.** Reports carry `authority: "reference-only"` and
  `executionAuthorized: false`, including on `reused` entries.
  - Steps contain only `index`, `status` and `implementationId`.
  - Step text, scenario names, example values, validator issue text and the
    validator's failure reason are never projected or returned.
  - Reasons are fixed text per code. The one exception is `mapping-revision-drift`,
    which names the drifted identity fields.
  - Any approved human authoring context, such as step wording for an author, must
    be a separate, intentional input.
- **Immutability and determinism.** Reports are deep-frozen, and inputs are never
  mutated. `inputDigest` and `reportDigest` are SHA-256 hashes of canonical JSON
  of the projections, so identical snapshots give identical reports.

`assessCandidateReviewReadiness(report, evidence)` checks caller-supplied
metadata about a drafted candidate. It returns `ready-for-human-review` or
`blocked`, and it always returns `acceptance: "not-accepted"` and
`executionAuthorized: false`. It blocks when any of these is true:

- the report digest is stale;
- the case is not awaiting step implementation (including unapproved outcomes);
- the expected-outcome digest differs;
- the candidate targets steps that are not missing, or leaves missing steps uncovered;
- the candidate modifies reviewed steps;
- the candidate declares assertion changes;
- any of `typecheck`, `lint` or `ownedSyntheticTests` is absent, not run, failed,
  or recorded for a different candidate revision.

The module never reads or runs candidate code.

Before it assesses a candidate, it re-projects the report as well as the
evidence; the report may have passed through JSON. It then checks the report:

- the report shape is valid;
- the `reference-only` authority is present, and `executionAuthorized: false` is
  set at both report and case level;
- each outcome matches its code;
- each step status matches its implementation ID;
- `candidateStepIndexes` match the missing steps;
- the summary counts match the cases;
- the recomputed `reportDigest` matches.

Any mismatch returns `{ valid: false }`. **These hashes detect inconsistency, not
authenticity.** Anyone can edit a report and recompute its digest. Callers must
obtain reports and evidence from a trusted source and keep upstream review and
authorization; nothing here replaces that.

## Example

```ts
import { validateFeatureFile } from "../src/validation/feature-validator";
import {
  assessCandidateReviewReadiness,
  assessReuseReadiness,
} from "../src/validation/reuse-readiness";

const validation = await validateFeatureFile({
  workspaceRoot,
  featurePath,
  sourceRevision,
  manifest,
});
const report = assessReuseReadiness({
  selection,
  cases,
  mappings,
  validation,
  approval,
});
if (report.valid) {
  for (const entry of report.cases)
    console.log(entry.caseId, entry.outcome, entry.code);
}
const review = assessCandidateReviewReadiness(report, candidateEvidence);
// review.status === "ready-for-human-review" only means a person may now review it.
```

### Running the tests

The tests run as part of the existing validation stage, so they are included in
`npm run test:validation` and the aggregate `npm run test:features:regression`.
`scripts/feature-validation.test.ts` registers them with a side-effect import. For
focused feedback, run:

```sh
npm run build:cucumber && node --test dist/cucumber/scripts/reuse-readiness.test.js dist/cucumber/scripts/reuse-readiness-candidates.test.js dist/cucumber/scripts/reuse-readiness-reports.test.js
```

The tests use only `fixtures/validation/reviewed-scenarios.feature` and synthetic
in-memory snapshots, including synthetic secret markers.

**Proposed script and pin plan (root decides).** A dedicated
`test:reuse-readiness` script would change `package.json`; only its `dependencies` and `exports` are hashed into
`REVIEWED_IMPLEMENTATION_REVISION`, so a script-only change would not need a re-pin. Doing that safely takes one reviewed change
with these steps:

1. Add the script, and optionally list it in `test:features:regression`.
2. Remove the side-effect import, so the tests don't run twice.
3. Run `npm run review:revision` to get the new candidate digest.
4. Update the pin in `src/execution/reviewed-scenarios.ts` after review.
5. Rerun `npm run test:execution` and `npm run test:adapter` to confirm the pin.

None of this is done here.

## Limitations and remaining human review

- **Assertion safety is not proven.** `assertionChanges: "none-declared"` and
  `modifiedReviewedStepIds: []` are self-reported. No string matching here can
  show that an assertion still proves the approved expected outcome. A human
  reviewer must check assertion strength, code placement (public generic code or
  private customer code), the implementation revision and pin update, and the
  mapping approval. See `CANDIDATE_HUMAN_REVIEW_REQUIRED`.
- Validation-check evidence is metadata supplied by the caller. This module does
  not verify that the checks ran.
- Each report covers one validated feature. A mapping to a different feature is
  reported as `mapping-revision-drift` (`featurePath`).
- Manifest integrity follows `selectApprovedScenarios` semantics. If tags drift on
  any approved scenario in the manifest, every mapped case in that feature is
  reported as `approval-mismatch`, including cases that would otherwise be
  candidate work. The integrity check is a local copy of the selector logic,
  because `scenario-selector.ts` is a pinned input. A parity test guards it, but
  a future selector change must be mirrored here.
- Hashes give consistency checks, not authenticity. The module does not sign
  anything or verify where reports and evidence came from.
- No `package.json` script or public export was added. `package.json`,
  `tsconfig.cucumber.json` and the validator and selector sources are inputs to
  the pinned `REVIEWED_IMPLEMENTATION_REVISION`. Changing them needs a reviewed
  pin update. Exporting this API should wait until a consumer (RRDWEB-6 or the
  central readiness projection) needs it.

## Remaining RRDWEB-24 / RRDWEB-6 dependencies

- The owner of the mapping record (TCM, the Web service or central) and its
  single writer are undecided. This module only consumes snapshots.
- No AI authoring engine, provider, budget or sandbox exists. No portal readiness
  view or arbitrary-case runner exists.
- RRDWEB-6 still needs a per-run resolver and a versioned adapter extension.
  Executing a `reused` case still requires the existing admission path, a
  human-issued run approval, and the pre-browser re-check.
- Owned-fixture validation infrastructure for candidates is not provided. Callers
  supply check evidence.
