# RRDSCRUM-207 owned public navigation reconciliation

The approved ReleaseReady sign-in screen no longer offers the demo entry used by
the synthetic owned-local fixture. The replacement follows existing public UI:
Sign in → Create your account → Sign in. It submits no registration data, acquires
no account/session and introduces no authentication shortcut or design change.

The existing `local-demo-navigation` scenario ID and step IDs remain stable; their
historical tokens are identity, not an instruction to restore removed UI. The
scenario name, expressions, exact v2 evidence vocabulary and content digests are
updated together. Prior source/feature/implementation approvals must return
`STALE_REVIEW`; no old approval is silently transferred to this revision.

The isolated synthetic browser fixture exercises the same controls and retains a
wrong-screen failure case plus cleanup/cancellation/evidence checks. These tests
are not founder approval or execution evidence for canonical customer cases.

Consumers must pin this framework revision and regenerate strict adapter schema
mirrors. The imported-v1 implementation closure includes reviewed-scenarios, so
its digest must change too. Product execution manifests/review references must
be rebuilt for the new pin; old selected versions remain pinned to their original
artifacts. Central owned-local authoring prose must match this public journey.
Central cancellation fixtures must stop waiting for the removed demo response;
replace their hold with a real boundary of this journey while preserving actual
worker-start and cleanup assertions. Do not mark downstream checks passed until
those consumers have been tested. No product-tests scenario IDs are moved here.
