# Private BuildProveShip test-assets starter v1

This is an unregistered synthetic starter, not AI generation or customer execution. See `starter-provenance.json` for the exact framework source revision and trusted artifact digest. `AGENTS.md` is the single authoring rulebook. Canonical case-ID allocation remains a dependency on the established Test Management service: no replacement IDs or registration are performed.

## Setup (Node 24 LTS)

1. Review the pinned private artifact/source receipt. Keep this project and `vendor/framework.tgz` private, under existing authorised GitHub access. Do not publish either to npm.
2. Run `npm run setup`. It installs the locked graph with lifecycle scripts disabled, explicitly installs the matching Chromium browser, then typechecks. This may download packages/browser from their normal registries. It does not run tests, configure models, or collect secrets. Failure stops with recovery guidance.
3. **Demo mode only:** `npm run demo` runs a fixed owned loopback fixture with external browser requests blocked, one worker and no retries. Read the actual result in `reports/demo-results.json` and screenshot attachment in `test-results/`. Missing dependencies/browser and assertion failures are failures, not passes. This fixture is not a security sandbox for arbitrary code.
4. **Customer mode:** only placeholders are supplied. `npm run demo` refuses to run. No customer URL, data payload or credentials should be entered for this demonstration.

The example reuses the pinned framework BasePage, a Playwright fixture and readable Given/When/Then steps. `demo.feature` is the nonexecuted readable counterpart, not a duplicate case. Tests remain Not Reviewed. Standalone demo success does not approve customer tests, migrate identities, enable portal execution, or complete RRDWEB-24/34.

All existing dependency versions/integrities are inherited from the framework's committed lockfile; `npm ci` uses them, never an unpinned latest starter. Dependencies are deliberately not reduced in v1, to retain this existing locked graph. Generated source may be edited only under normal review; evidence from an earlier revision is not acceptance of later edits. Re-run the applicable checks after changes.
