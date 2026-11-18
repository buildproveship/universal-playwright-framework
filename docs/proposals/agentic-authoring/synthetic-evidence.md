# Revision 1: bounded synthetic rehearsal

## Authority and limits

On 15 November 2026, the owner replied “continue to complete the work” in the
agentic Playwright session after being asked to approve exact proposal revision 1
(commit `85557b8824b3a379313faa67f42215a89e3d8a01`) for a free synthetic rehearsal.
This records approval of that bounded implementation, not customer execution,
model use, starter distribution, production adoption or approval of any test.
The remaining product design and operational decisions in README.md stay open.

## Implemented boundary

Run `npm run test:agentic-rehearsal`. The entrypoint is a developer-owned framework
contract harness in `scripts/agentic-rehearsal.ts`, not a package export, product
route, installed assistant rule or customer E2E test. Generic synthetic integration
tests stay beside the framework; new customer E2E/QA-owned integration tests still
belong in their designated test-assets repository.

One immutable candidate string describes exactly one owned sign-in scenario in a
closed JSON grammar. The implementation rejects unknown fields, extra/missing/
renamed identities, skips, changed assertions, unsupported syntax and data
references other than `owned-sign-in-v1`. It accepts no credentials or pool
payloads. The fixture client returns a fixed synthetic user. It is not the
customer data client and provides no evidence about customer-data integration.

Only shipped fixed code executes in a worker thread. The input is never evaluated
as JavaScript and cannot supply a path, program, origin, instruction, evidence or
execution permission. The worker gets an empty environment and memory limits.
The parent waits for worker exit before reporting confirmed cleanup, terminates a
hung worker within a maximum 60-second deadline, and blocks failed execution.
Tests shorten the deadline to one second and require a worker message proving
the hang branch was entered before accepting the timeout/cleanup observation. There is one candidate, no repair loop and
no provider/model path or network/file-writing operation.

**A Node worker is not an untrusted-code security sandbox.** This is an in-memory
sign-in contract, not a browser. No arbitrary code, Playwright agent or generated
step implementation is run. A production worker, supported data-client wiring,
process-tree cleanup and sandbox policy still need separate design and evidence.
The parent process is assumed to remain alive and responsive; this is not a
crash-recoverable execution service.

Every result remains `Not Reviewed` and `executionAuthorized: false`. Success is
only `rehearsal-passed`, never approval or ready-for-customer-run. Digests bind the
observation to the input bytes; they are not signed provenance. There is no API to
submit stale or forged pass metadata. Lint/type results are recorded separately,
not invented by the worker. Existing `reuse-readiness.ts` remains unchanged and
reference-only; its regression suite runs alongside this rehearsal.

## Acceptance coverage

| Proposal case | Current evidence and limitation                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A             | Exact fixed contract runs in a real worker and remains Not Reviewed. Missing-step generation is not implemented.                                               |
| B, C          | Missing, duplicate, renamed IDs and skipped cases are blocked before worker creation.                                                                          |
| D             | Exact expected assertion text must match. No claim of general JS semantic analysis.                                                                            |
| E, L          | New immutable source gets a new digest; supplied evidence/pass flags are rejected. No production signing/provenance contract.                                  |
| F             | Execution failure blocks; existing readiness tests cover missing/failed/stale lint/type metadata. This harness does not attest lint/type execution internally. |
| G             | Closed grammar and input-size checks fail closed.                                                                                                              |
| H             | Invalid/excessive deadlines block; one candidate, no repair/provider path, zero model calls. Provider availability/token/cost enforcement is not implemented.  |
| I             | Fixed worker hang is terminated with exit evidence; fixed worker crash is blocked. No real browser-crash or hostile process-tree proof.                        |
| J, M          | Extra instruction/pool fields and external data references are rejected without echoing values. No real page or customer data is read.                         |
| K             | Existing reuse-readiness regression checks retained, not recreated.                                                                                            |

## Verification record

Executed on M3 in an isolated A010 checkout with Node 26 and locked dependencies:

- `npm run test:agentic-rehearsal`: 31 passed (12 new synthetic checks plus 19
  existing readiness checks), no skipped/cancelled tests.
- Source catalog discovers the 12 synthetic IDs and rejects missing IDs,
  duplicate IDs and duplicate definitions before test runner aggregation.
- Guard-removal probes against disposable compiled output: identity, skip,
  expected assertion, strict fields, data reference, input size, digest binding,
  budget, execution-result check and execution-authority bit all caused test
  failure. Removing worker termination left a hung mutant, which the outer
  eight-second probe watchdog killed. Compiled output was restored afterward.
- Build, lint and validator regressions are recorded in the PR against the final
  candidate. No cloud CI workflow or paid service was triggered.

Tests remain **Not Reviewed** pending the founder's Test Management workflow.
No model, browser, customer test, deployment, package publication or production
sandbox evaluation was performed. RRDWEB-24 and RRDWEB-34 are not complete merely
because this bounded rehearsal passes.
