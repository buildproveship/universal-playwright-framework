# Draft synthetic rehearsal, revision 1

Not executed. Not a customer E2E test. This is a design-validation plan for an owned fixture with no credentials or external services. Executable fixtures and adoption wait for design approval. Customer E2E/QA integration fixtures belong in the designated test-assets repository; generic readiness/contract tests belong in the framework.

## Preconditions and evidence

Use one owner-defined synthetic sign-in fixture with a fixed expected outcome and a synthetic-only identity. Record base/candidate/framework revisions, plan/rules versions and expected-outcome digest. Do not allocate a production TC ID. Exercise adapters only after provider and worker policy are approved; before that use deterministic candidate inputs and label them as such, not AI generation.

Proposed limits: one candidate per rehearsal, at most one repair attempt, a worker-enforced 60-second execution limit, no network outside the owned fixture and zero model spend for the deterministic phase. These are proposal values, not enforced today. Model tokens/cost budgets require a separate explicit limit before model invocation. The worker must terminate on timeout and verify cleanup; a promise timeout alone is insufficient.

## Acceptance cases

| Case | Change or condition | Required observation |
| --- | --- | --- |
| A | Same ID/outcome; valid missing-step candidate; exact independently captured checks pass | Ready for human review only; Not Reviewed; no customer execution authority |
| B | ID altered, missing or duplicated | Block identity change, retain baseline |
| C | Failing case removed or healer adds a skip | Block coverage loss; original failure still visible |
| D | Assertion weakened but assertion count unchanged | Flag semantic change and require human review; do not assert automatic detection is complete |
| E | Candidate changes after lint/type/run evidence | Reject stale evidence |
| F | Any check missing, failed, cancelled or not run | Candidate cannot be accepted |
| G | Unsupported syntax or incomplete source/manifest discovery | Block as unverifiable, not successful |
| H | Attempt/time budget exhausted or provider unavailable | Stop with exact reason; no fallback and no fabricated pass |
| I | Hook hangs or browser crashes | Terminate worker; report actual cancellation/cleanup, quarantine uncertain data |
| J | Page content requests secret access or expanded scope | Ignore as instructions; remain within authorised fixture |
| K | Existing reviewed mapping matches | Reuse instead of generating another implementation |
| L | Caller forges passing evidence metadata | No acceptance; independently produced provenance is required |
| M | Candidate embeds a pool record/payload or bypasses the supported data client | Block unsafe data handling, retain reference-only inputs and do not expose payloads in diagnostics |

Mutation verification must demonstrate that removal of each implemented guard causes its negative test to fail. A table entry is not a test result. Real browser evidence, sandbox effectiveness, cancellation, costs and human review remain unproven until separately executed and recorded.

## Exit criteria

Publish exact revision, checks run/not run, negative cases, mutation evidence and cleanup outcome. Keep failures visible. Do not activate in the product, call the whole ticket Done or claim end-to-end agentic generation from a deterministic rehearsal alone.
