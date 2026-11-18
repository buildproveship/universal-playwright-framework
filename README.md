# universal-playwright-framework

`@universal/playwright-framework` runs reviewed Cucumber + Playwright scenarios for
ReleaseReady. It provides:

- execution adapters: `adapter/v1`, `adapter/v2` (owned local) and `adapter/imported-v1`;
- runtime login (`runtime-login/v1`) and reviewed input preparation (`data-references/v1`);
- offline feature validation and readable local reports;
- optional `BasePage` / `BaseComponent` classes and the `waitForVisible` readiness helper.

Consumers install it from a pinned git revision (ReleaseReady, releaseready-product-tests,
test-data-management). It is not a generic template.

## Develop

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` runs ESLint and Prettier over every TypeScript file, then every suite
(including the browser suites and the readiness tests). The individual suites are
listed under `scripts` in `package.json`.

## Guides

- [Synthetic Cucumber scenario](docs/synthetic-cucumber.md)
- [Synthetic execution adapter](docs/synthetic-execution.md)
- [Local adapter contract](docs/local-adapter-contract.md) and [imported adapter contract](docs/imported-adapter-contract.md)
- [Input preparation contract](docs/input-preparation-contract.md) and [runtime login entry](docs/runtime-login-entry.md)
- [Authoring styles](docs/authoring-styles.md): Simple, Page Objects + Components and Business Flows against the framework API
- [Private starter v1](docs/private-starter-v1.md): the approved version-pinned, private-artifact scaffold and fixed owned-loopback demonstration. It does not configure models or execute customer journeys.
