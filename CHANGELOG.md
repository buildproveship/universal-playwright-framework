# Changelog

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
