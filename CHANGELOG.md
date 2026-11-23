# Changelog

## 3.0.0 - 2026-11-23

### Breaking

- BPS-49: the package is now `@buildproveship/playwright-framework` (GitHub Packages scope follows the renamed `buildproveship` org). Change the dependency, imports and `.npmrc` (`@buildproveship:registry=https://npm.pkg.github.com`); the API is unchanged. Depends on `@buildproveship/config` ^5.0.0 for development.
- Guard: `scripts/npm-scope.test.ts` fails on any old-scope package reference outside history docs.

## 2.1.0 - 2026-11-23

### Added

- RRDSCRUM-466: the owned-local v2 request accepts an optional `target.labels` object (`registerButton`, `registerHeading`, `signInHeading`) so a product can pass its own sign-in and sign-up copy to the shared owned-local steps. Omitted labels keep the 2.0.0 wording, so existing callers are unaffected. `ExecutionOptions.ownedLocalTarget` takes the same `labels`.
- Guard: `shared-steps-no-product-copy.test.ts` fails if a product brand name or the default sign-in copy is hard-coded in the shared steps outside `src/execution/owned-local-labels.ts`.

### Changed

- The review pins (`REVIEWED_IMPLEMENTATION_REVISION`, `IMPORTED_IMPLEMENTATION_REVISION`) and the adapter fixtures are recalculated for the changed step files. Test review status remains Not Reviewed.

## 2026-11-20

### Changed

- CI: documentation-only pull requests skip `pr.yml`; the browser suites run weekly instead of nightly and a scheduled run skips when `main` is unchanged since the last success; Playwright browsers are cached across runs (owner decision, 20 Nov 2026).
- CI runs on GitHub-hosted `ubuntu-24.04` (pr, nightly, release); Playwright installs Chromium with `--with-deps`.
- Drop the removed `cleanupFaultInjected` and `workerStallInjected` fields from the expectations in `execution-adapter.test.ts` and `owned-local-adapter.test.ts` (they were left stale by UPF-11 and failed the nightly browser suites).

## 2026-11-14

### Changed

- RRDSCRUM-207: align the framework and lockfile with the latest stable Playwright 1.65.1, with matching official Chromium used for local verification.
- Preserve the new Playwright route-registration return value and options in synthetic login test interceptors.
- Forward the selected temporary directory into the independently installed adapter smoke process.

The compatibility candidate received independent code review before its implementation digest and both JSON examples were updated together; final verification and founder review remain separate gates. Test review status remains Not Reviewed; this change does not grant customer execution or merge approval.
