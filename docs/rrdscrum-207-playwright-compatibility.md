# RRDSCRUM-207 Playwright compatibility candidate

Status: draft candidate; no customer execution, founder test approval, hosted dispatch or merge.

## Scope

The owner requested the latest stable Playwright everywhere. Registry `dist-tags.latest` resolved to **1.65.1** on 14 November 2026; the earlier 1.65.0 web result had already been superseded. This candidate updates the exact framework dependency and lockfile. Consumers must use the same exact version and this framework candidate's eventual immutable commit; an override onto a different runtime invalidates its review.

Base: `a796280c9e621a48997dc8c8ac33c21fe457712c`. All work, installed dependencies, browser downloads, test temporary directories and evidence are isolated on A010. The parallel ReleaseReady Chrome run and application checkout were not touched.

The upgrade initially failed strict compilation because Playwright's `BrowserContext.route` now returns a disposable registration. Three synthetic test wrappers discarded that return value. They now return the underlying registration and forward options; request guards, assertions, target restrictions and cleanup logic are unchanged. Playwright no longer brings `fsevents`; the install-policy check (`scripts/install-policy.test.ts`) now asserts no install-script dependencies, retaining the rule that future lifecycle dependencies require review.

The installed-package smoke now forwards `TMPDIR` into its deliberately minimal child environment so the selected isolated temporary root is retained. It still clears module hints and never exposes login credentials.

## Review guard

After the intentional package change, the unchanged committed review correctly rejects the package as stale. Candidate implementation digest before review is `7cd7225db5871158e229228c70a7c64a28ddecbeef43cac348ad7ed09160a635`.

The existing workflow in `local-adapter-contract.md` requires review of the actual change before explicitly updating the implementation digest and both JSON examples. No wildcard match, runtime self-approval, guard suppression or weakened hash comparison is proposed. Tests that modify reviewed artifacts must still reject them.

## Verification

- Registry lookup: latest stable 1.65.1; beta/next excluded.
- Exact dependency/lockfile install succeeded.
- Official matching Chromium and headless shell installed in the isolated A010 cache.
- Strict build: failed initially for the three route-wrapper return types; passed after preserving the new return value.
- Setup safety: 21/21 passed.
- Authentication-only security regression: 35/35 passed with real Chromium and synthetic loopback fixtures.
- Existing committed review rejected the intentionally changed package before any review-pin update.

- Customer login and cleanup: 123/123 passed.
- Adapter contract: 11/11 passed; all 5 Cucumber scenarios and 15 steps passed, including the independently installed immutable tarball and modified-package stale-review rejection.
- Owned-local adapter: 15/15 passed, including changed-worker rejection before browser acquisition.
- Execution and cleanup: 61/61 passed plus 10 Cucumber scenarios / 23 steps.
- Input preparation: 27/27 plus 28 scenarios / 90 steps; validation: 25/25; features: 12 scenarios / 52 steps; reporting: 8/8 plus 6 scenarios / 18 steps; lint compatibility: 5/5; TypeScript source policy: 10/10.
- Public runtime entry: 11/11 passed, including packed installation, cold-start and browser contracts.

Passing a local check does not itself authorize founder review, customer execution or merge.


## Candidate review checkpoint

Independent read-only review of the actual dependency/lockfile, route-wrapper, setup-guard and isolated-smoke diff found no blocking correctness/security issue. The reviewer confirmed that the existing reviewed-revision workflow permits explicit candidate activation after that review, with subsequent adapter/mutation verification. The implementation digest and both JSON examples were therefore updated together to the candidate digest above. This is a reviewable compatibility candidate, not founder test approval or authorization for customer execution. The stale-review comparisons and mutation tests remain unchanged.

## Consumer installation and security boundary

Pin `@playwright/test` to `1.65.1`, pin this framework to its reviewed immutable commit, regenerate the consumer lockfile, and install that version's official browsers. Do not force a different Playwright through an override: reviewed runtime resolution must still match. The synthetic reviewed implementation digest is not approval of arbitrary customer tests.

The framework-root production audit reports zero vulnerabilities with its existing overrides. A fresh tarball consumer without root overrides reports four moderate dependency findings, representing two underlying advisories: [glob cancellation traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249). npm does not apply a dependency package's overrides to the consumer tree. The installed adapter passes its execution/security contract, but that result is not a clean consumer dependency audit.

Consumers must explicitly review and retain the existing root override policy (`@cucumber/cucumber` → `glob: 14.0.4`; `minimatch@>=9` → `11.0.5`), regenerate their lock, audit the resolved installation, and verify their adapter. Do not claim production security clearance from the framework-root audit alone. This is an inherited packaging gap, separate from the Playwright upgrade; no dependency range or guard was weakened to hide it.
