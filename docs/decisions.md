# Decisions

Owner decisions that change how this repository is built, checked or released. Newest first.

## 19 November 2026: CI runs on the self-hosted runner

- **Scope:** private-repo Actions minutes are unavailable, so `pr.yml`, `nightly.yml` and `release.yml` run on the organisation's self-hosted macOS arm64 runner (`runs-on: [self-hosted, rr-local]`). Pull request jobs skip drafts. No job needs Linux.

## 18 November 2026: light pull request checks in GitHub Actions

- **Decided by:** the owner, choosing "Apply all six (Recommended)" for the cross-repo programme (recommendations 1 and 2).
- **Scope:** `.github/workflows/pr.yml` runs on every pull request to `main`: install, build, lint, typecheck and unit tests (a few minutes). Suites that launch a browser or a local server (Playwright, Cucumber browser profiles, browser login and isolation tests, the readiness tests) run only on demand (`workflow_dispatch`) and nightly, in `.github/workflows/nightly.yml`.
- **Replaces:** the 12 November 2026 decision that routine checks do not run in GitHub Actions (RRDPLAT-44), for this light set only. Everything else stays as that decision set it, including the manual code-quality scan workflow.
- **Tooling:** ESLint, Prettier, the tsconfig base and the Renovate preset come from the shared `@releaseready/config` package ([releaseready/config](https://github.com/releaseready/config)); local overrides carry a comment with their reason.
