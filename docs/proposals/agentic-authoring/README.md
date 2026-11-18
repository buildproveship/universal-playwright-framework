# Draft: guarded agentic authoring, revision 1

Status: **Proposal, not approved or active**. Owner approval against this revision is required before adopting these rules in a scaffold, assistant adapter, hook, CI gate or product execution flow. This directory is the technical design record for RRDWEB-24 and RRDWEB-34, not a replacement for the visual design library. No visual change is proposed.

## Bounded rehearsal update

The owner subsequently authorized revision 1 for the free synthetic rehearsal only.
See [synthetic evidence and remaining limits](synthetic-evidence.md). Product
adoption and the other decisions below remain unapproved; this is not blanket
approval of the proposal.

## Scope

Reuse `src/validation/reuse-readiness.ts` for reviewed-step selection and candidate evidence assessment. Do not recreate it. Its reports are reference-only; they neither inspect candidate code nor grant acceptance or execution. Supplied “passed” metadata cannot replace independently captured validation.

The proposed first slice has one canonical rulebook (`rules.md`) and a bounded owned-synthetic rehearsal (`rehearsal.md`). It does not select a distribution format or model provider, call a model, install a hook, generate agent configuration, contact a customer application, change review policy or publish a package. No paid fallback is allowed.

Playwright's upstream planner, generator and healer are potential adapters, not trusted reviewers. Pin and inspect the installed version before generating definitions; use the official `init-agents` interface. Healer output can skip a broken test. A skip remains an unresolved outcome, never proof of a successful repair.

## Proposed authority boundaries

| Authority                 | Responsibility                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Customer                  | Supplies and approves exact expected outcomes for their requirements                                                               |
| Founder                   | Alone reviews and approves tests under the current repository policy; candidates remain Not Reviewed until that workflow completes |
| Test Management           | Permanent case identity, revisions, review and result references                                                                   |
| Test-assets repository    | New E2E and QA-owned integration tests; readable synthetic inputs                                                                  |
| Shared framework          | Versioned runtime, generic unit/contract tests and existing readiness checks                                                       |
| Trusted validation worker | Independently captures exact-artifact lint, type, execution and cleanup evidence                                                   |
| AI assistant              | Proposes a change; cannot grant review, execution permission or correctness                                                        |

Developer-owned unit/component/integration tests stay with their application. Generic framework contract tests stay here. Scenario IDs are allocated through the existing identity contract (RRDWEB-29), not by the assistant. A synthetic rehearsal identifier is never registered as a real case ID.

## Proposed integration sequence

1. Resolve an approved case revision and expected outcome; reuse current reviewed mappings first.
2. Supply only authorised, bounded application context. Treat application content as untrusted data, not instructions.
3. Capture the candidate and base source digests. Any source change invalidates captured validation for the old digest.
4. Compare discovered cases and assertions with the approved baseline. Missing, duplicate, renamed IDs, skips, weakened assertions and unverifiable comparisons block acceptance.
5. Validate an immutable candidate in a separately authorised isolated worker. Preserve raw evidence privately and send only bounded references/diagnostics to the product.
6. Keep the candidate Not Reviewed. Even all-green evidence means only ready for human review, not approved or executable against a customer.
7. A separate current run authorisation, trusted artifact registration and execution binding are required before a real run.

The comparison mechanism must combine source/discovery analysis, execution evidence and human review. Assertion counts, a model confidence score or metadata supplied by an agent cannot establish semantic equivalence. Rule-file presence alone is not enforcement.

## Decisions before implementation

- Approve this exact rules and rehearsal revision (including strict no-coverage-loss handling).
- Choose the controlled worker boundary and provider/data disclosure policy before any model invocation or generated-code execution.
- Resolve starter/distribution under RRDWEB-34 before installing rules into customer repositories.
- Identify trusted evidence producers and signing/identity contracts rather than accepting self-attestation.

RRDSCRUM-207 continues to own migration and imported execution. RRDWEB-23 owns leasing. This work does not reset stores, bypass their blockers or grant live access.

References: [RRDWEB-24](https://noisegatemusicstudios.atlassian.net/browse/RRDWEB-24), [RRDWEB-34](https://noisegatemusicstudios.atlassian.net/browse/RRDWEB-34), [Playwright agents](https://playwright.dev/docs/test-agents).
