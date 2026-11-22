// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Checks the locked install policy (prepack build, no prepare hook, pinned Playwright, no install scripts) and the Cucumber report assertion in isolated temporary fixtures; it does not prove customer execution or hosted deployment.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(__dirname, "../../..");

test("the package is built in prepack, has no prepare hook, and no dependency has an install script", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8"),
  ) as {
    packages: Record<
      string,
      { version?: string; hasInstallScript?: boolean; optional?: boolean }
    >;
  };
  // #86: the build moved from `prepare` to `prepack`. `prepare` would also run on
  // every consumer git-install and `npm ci`, which the release workflow does not need.
  assert.equal(manifest.scripts.prepack, "npm run build");
  assert.equal(manifest.scripts.prepare, undefined);
  assert.equal(manifest.dependencies["@playwright/test"], "1.65.1");
  assert.equal(
    lock.packages["node_modules/@playwright/test"].version,
    "1.65.1",
  );
  assert.equal(lock.packages["node_modules/playwright"].version, "1.65.1");
  assert.deepEqual(
    Object.entries(lock.packages)
      .filter(([, metadata]) => metadata.hasInstallScript)
      .map(([name]) => name),
    [],
    "Review lifecycle needs before accepting new install-script dependencies",
  );
  assert.equal(lock.packages["node_modules/fsevents"], undefined);
});

for (const passed of [true, false]) {
  test(`Cucumber report validation ${passed ? "passes" : "fails"} inside its named test`, () => {
    // Synthetic report fixtures exercise only the assertion contract. They are
    // not substituted for the real E2E report in the aggregate regression run.
    const directory = mkdtempSync(
      path.join(tmpdir(), "cucumber report contract-"),
    );
    const compiledRoot = path.join(root, "dist/cucumber");
    const compiledDirectory = path.join(directory, "dist/cucumber");
    const files = [
      "scripts/cucumber-timeouts.test.js",
      "scripts/install-policy.test.js",
      "scripts/fixtures/loopback-server.js",
      "features/support/step-timeout.js",
      "features/support/cleanup-runtime.js",
    ];
    try {
      for (const file of files) {
        const destination = path.join(compiledDirectory, file);
        mkdirSync(path.dirname(destination), { recursive: true });
        cpSync(path.join(compiledRoot, file), destination);
      }
      symlinkSync(
        path.join(root, "node_modules"),
        path.join(directory, "node_modules"),
        "junction",
      );
      mkdirSync(path.join(directory, "reports"));
      const reportPath = path.join(directory, "reports/cucumber-results.json");
      const report = JSON.stringify([
        {
          elements: [
            { steps: [{ result: { status: passed ? "passed" : "failed" } }] },
          ],
        },
      ]);
      writeFileSync(reportPath, report);
      const title = "the real Cucumber E2E report contains a passed scenario";
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        [
          "--test",
          "--test-reporter=tap",
          `--test-name-pattern=^${title}$`,
          path.join(compiledDirectory, "scripts/cucumber-timeouts.test.js"),
        ],
        { cwd: directory, encoding: "utf8", timeout: 10_000, env },
      );
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(
        result.status,
        passed ? 0 : 1,
        result.stdout + result.stderr,
      );
      assert.ok(
        result.stdout.includes(`${passed ? "ok" : "not ok"} 1 - ${title}`),
        result.stdout,
      );
      assert.equal(readFileSync(reportPath, "utf8"), report);
      if (!passed) {
        assert.match(
          result.stdout,
          /The real Cucumber E2E report must contain a passed scenario/,
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
