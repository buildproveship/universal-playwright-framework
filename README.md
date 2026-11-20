# universal-playwright-framework

`@releaseready/playwright-framework` runs reviewed Cucumber + Playwright scenarios for
ReleaseReady. It provides:

- execution adapters: `adapter/v1`, `adapter/v2` (owned local) and `adapter/imported-v1`;
- runtime login (`runtime-login/v1`) and reviewed input preparation (`data-references/v1`);
- offline feature validation and readable local reports;
- optional `BasePage` / `BaseComponent` classes and the `waitForVisible` readiness helper.

It is published to GitHub Packages with built output and an `exports` map.
Consumers (ReleaseReady, releaseready-product-tests, test-data-management) depend on a
semver range, never a git revision, and never build it:

```bash
echo "@releaseready:registry=https://npm.pkg.github.com" >> .npmrc
npm install @releaseready/playwright-framework@^2.0.0
```

It is not a generic template.

This framework is browser-only. API testing (native `fetch` and k6) is owned by
[universal-api-framework](https://github.com/releaseready/universal-api-framework); do not add an
API client here.

## Release

Bump `version` in `package.json` (semver) in a pull request and merge it, then push a
matching tag (`git tag v1.0.1 && git push origin v1.0.1`). `release.yml` runs the
check and unit tests and publishes with `GITHUB_TOKEN`; `npm publish` builds in
`prepack`. Run `npm run review:revision` and update `REVIEWED_IMPLEMENTATION_REVISION`
whenever the reviewed runtime files or the runtime parts of `package.json`
(`dependencies`, `exports`) change. Scripts, devDependencies and the version are not
hashed. `npm test` runs `check:review-pins` and fails with the new digests when a pin
is stale.

## Licence

Proprietary: `"license": "UNLICENSED"`. The package is published to the private
GitHub Packages registry for ReleaseReady only. It is not marked `private: true`,
because `npm publish` refuses private packages.

## Develop

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` runs `npm run check` (build, typecheck, ESLint and Prettier), then
`npm run test:unit` (no browser) and `npm run test:browser` (the suites that launch
a browser or a local server, including the readiness tests). ESLint, Prettier and
the tsconfig base come from the shared `@releaseready/config` package, which
installs from GitHub Packages: locally, `export NODE_AUTH_TOKEN=$(gh auth token)`
(a token with `read:packages`) before `npm ci`. Pull requests run the check and
unit tests in GitHub Actions (`pr.yml`) on GitHub-hosted `ubuntu-24.04`
runners; the browser suites run nightly there too (`nightly.yml`). The individual suites are listed under `scripts` in
`package.json`.

## Guides

- [Synthetic Cucumber scenario](docs/synthetic-cucumber.md)
- [Synthetic execution adapter](docs/synthetic-execution.md)
- [Local adapter contract](docs/local-adapter-contract.md) and [imported adapter contract](docs/imported-adapter-contract.md)
- [Input preparation contract](docs/input-preparation-contract.md) and [runtime login entry](docs/runtime-login-entry.md)
- [Authoring styles](docs/authoring-styles.md): Simple, Page Objects + Components and Business Flows against the framework API
- [Private starter v1](docs/private-starter-v1.md): the approved version-pinned, private-artifact scaffold and fixed owned-loopback demonstration. It does not configure models or execute customer journeys.
