# Private standalone starter v1

Version: 1. Last updated: 17 November 2026. Scope: RRDWEB-34 comments [11373](https://noisegatemusicstudios.atlassian.net/browse/RRDWEB-34?focusedCommentId=11373) and [11506](https://noisegatemusicstudios.atlassian.net/browse/RRDWEB-34?focusedCommentId=11506). The owner approved this exact nonvisual starter/distribution slice; broader agentic designs remain proposals. This document records the implementation of that bounded scope, not completion of RRDWEB-24/34.

## Build and distribute privately

Use Node 24 LTS and the existing locked framework dependencies. Commit the intended changes first. No model or external customer target is involved.

```sh
npm ci --ignore-scripts
npm run starter -- build /absolute/existing-parent/empty-artifact-directory
```

The builder refuses a dirty working tree. It archives the exact commit into temporary storage, compiles that snapshot using the installed dependencies, and packs the existing framework with `private: true`, no lifecycle scripts and no public publish configuration. It copies the existing committed dependency lock graph without the repository-only `@buildproveship/config` lint settings (served from GitHub Packages, which needs a token) and the entries only they need, adds the local framework tarball with SHA-512 integrity, and emits a file-inventory SHA-256 manifest. It never runs `npm publish`, creates a repository, changes permissions or starts a hosted service.

Keep the entire output directory private under existing authorised GitHub access (for example a reviewed source-revision-specific private release artifact). Publishing/uploading is **not** performed by the builder. Preserve its printed full source revision and `manifestSha256` in the trusted delivery receipt. Do not fetch `latest` or obtain the expected hash from an untrusted artifact itself. Hashes detect byte changes but are not signatures or a substitute for trusted distribution.

## Create an empty project

Use the same source-pinned CLI that built the artifact; do not run an arbitrary downloaded CLI.

```sh
npm run starter -- create /absolute/artifact /absolute/existing-parent/new-project demo <manifestSha256>
# OR: customer instead of demo, for placeholders only
```

An existing destination must be empty and not a symlink; absent destinations require an existing parent. All artifact bytes are verified before creation. Missing/extra files, modified files, bad manifest digest or symlinks are rejected. Exclusive writes never overwrite existing files. A partial filesystem failure leaves its partial scaffold for inspection; it is not retried into or destructively removed. Choose a different empty destination after resolving the error. Repeated invocation fails rather than replacing existing work or IDs.

The generated project is private, contains one canonical `AGENTS.md`, TypeScript configuration, exact lockfile, pinned local framework artifact and source provenance. Customer mode writes only reference placeholders plus setup tooling; demo execution refuses customer mode. Demo mode adds a fixed owned loopback server fixture, a BasePage subclass and one readable Given/When/Then Playwright test. Its `.feature` counterpart is documentation, not a second executable case.

## Explicit installation and demonstration

From the generated project:

```sh
npm run setup
npm run demo  # demo mode only
```

Setup reports dependency installation, browser installation and typecheck separately. Dependency lifecycle scripts are disabled; only the pinned local Playwright CLI is used. There is no npx/global/latest fallback. A failed stage stops with recovery guidance and never claims that a demo ran. Setup may contact the normal npm and Playwright browser-download endpoints and consumes local disk, but adds no subscription/service.

The demo uses one Chromium worker, zero retries, an ephemeral `127.0.0.1` listener and only fixed owned HTML. External browser requests/WebSockets are blocked and treated as failures; service workers are disabled. The owned listener is closed in fixture teardown. Actual JSON results and screenshot attachments are saved locally. Failure or timeout is not a pass; uncertain forced termination is not evidence of successful cleanup. This is a convenience demo, **not** a security sandbox for arbitrary generated or customer code.

## Identity, test placement and remaining boundaries

No permanent-ID allocator is implemented or called. Canonical allocation, registration and founder review remain dependencies on the established Test Management service. Examples start **Not Reviewed**, synthetic and unregistered. Existing project files and identities are not touched. Generic scaffold contract/failure tests live in this framework; any customer journey acceptance belongs in the designated product/customer test-assets repository. This change does not import or execute the active migration catalog.

Not included: customer login, secret collection, customer data/pool payloads, provider/model configuration, generated-code execution, AI healing, public registry publication, deployment, portal cutover, test approval or production acceptance. Other design tickets and paused local models remain separate.

## Maintainer checks

`npm run test:private-starter` covers creation preservation/integrity and setup/cleanup failure paths without downloading dependencies. On a clean committed revision with Node 24, `npm run verify:private-starter` builds an actual artifact, installs the generated project, checks its installed private framework manifest, runs the owned demo, proves missing-browser failure and customer-mode refusal. This opt-in check may download locked dependencies/Chromium. It removes only its own temporary fixtures and prints a revision/digest-bound receipt. The browser packaging check is not customer or portal journey acceptance. Current v1 build/verification tooling is POSIX-only (`tar` and the explicit environment assignment); Windows packaging support is not claimed.
