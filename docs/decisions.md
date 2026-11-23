# Decisions

Owner decisions that change how this repository is built, checked or released. Newest first.

## 20 November 2026: minimum Actions spend ($10/month organisation budget)

- **Decided by:** the owner (no clients yet; the organisation's Actions budget is a $10/month hard stop).
- **Scope:** `pr.yml` skips documentation-only pull requests (`**/*.md`, `docs/**`); no status check is required (branch protection is unavailable on the free plan), so skipped checks block nothing. `nightly.yml` (browser suites) runs weekly (Sunday) and on demand, and a scheduled run exits early when `main` has no new commit since the last successful run. Playwright browsers are cached by lockfile hash. Every job has `timeout-minutes`.

## 20 November 2026: CI runs on GitHub-hosted Ubuntu

- **Decided by:** the owner.
- **Scope:** every workflow (`pr.yml`, `nightly.yml`, `release.yml`) runs on GitHub-hosted `ubuntu-24.04`. The macOS arm64 runner (`rr-local`) is reserved for tests that need macOS; no job here does. Pull request jobs skip drafts, and `concurrency` cancels superseded runs (release does not cancel).
- **Replaces:** the 19 November 2026 decision below.

## 19 November 2026: CI runs on the self-hosted runner (superseded)

- **Scope:** private-repo Actions minutes are unavailable, so `pr.yml`, `nightly.yml` and `release.yml` run on the organisation's self-hosted macOS arm64 runner (`runs-on: [self-hosted, rr-local]`). Pull request jobs skip drafts. No job needs Linux.

## 18 November 2026: light pull request checks in GitHub Actions

- **Decided by:** the owner, choosing "Apply all six (Recommended)" for the cross-repo programme (recommendations 1 and 2).
- **Scope:** `.github/workflows/pr.yml` runs on every pull request to `main`: install, build, lint, typecheck and unit tests (a few minutes). Suites that launch a browser or a local server (Playwright, Cucumber browser profiles, browser login and isolation tests, the readiness tests) run only on demand (`workflow_dispatch`) and nightly, in `.github/workflows/nightly.yml`.
- **Replaces:** the 12 November 2026 decision that routine checks do not run in GitHub Actions (RRDPLAT-44), for this light set only. Everything else stays as that decision set it, including the manual code-quality scan workflow.
- **Tooling:** ESLint, Prettier, the tsconfig base and the Renovate preset come from the shared `@buildproveship/config` package ([buildproveship/config](https://github.com/buildproveship/config)); local overrides carry a comment with their reason.
