import { fake } from "./fixtures/fake-playwright";
// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Opt-in private artifact build/install/owned-demo packaging acceptance; no customer journey, canonical registration or portal acceptance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { JSONReport } from "@playwright/test/reporter";
import { buildStarter, createStarter } from "./private-starter";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test(
  "private source-pinned artifact installs, demonstrates, and fails truthfully without a browser",
  { skip: process.env.VERIFY_PRIVATE_STARTER !== "1", timeout: 300_000 },
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), "rr-starter-artifact-"));
    try {
      const artifact = path.join(directory, "artifact");
      const receipt = buildStarter(artifact);
      const demo = path.join(directory, "demo");
      createStarter(artifact, demo, "demo", receipt.manifestSha256);
      const npmCli = process.env.npm_execpath;
      assert.ok(npmCli, "Invoke using npm run verify:private-starter");
      const setup = spawnSync(process.execPath, [npmCli, "run", "setup"], {
        cwd: demo,
        env: process.env,
        encoding: "utf8",
        timeout: 200_000,
      });
      assert.equal(setup.status, 0, setup.stdout + setup.stderr);
      const manifest: unknown = JSON.parse(
        readFileSync(
          path.join(
            demo,
            "node_modules/@releaseready/playwright-framework/package.json",
          ),
          "utf8",
        ),
      );
      assert.ok(isRecord(manifest));
      assert.equal(manifest.private, true);
      assert.equal(manifest.publishConfig, undefined);
      assert.deepEqual(manifest.scripts, {});
      const result = spawnSync(process.execPath, [npmCli, "run", "demo"], {
        cwd: demo,
        env: process.env,
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const parsedReport: unknown = JSON.parse(
        readFileSync(path.join(demo, "reports/demo-results.json"), "utf8"),
      );
      assert.ok(
        isRecord(parsedReport) &&
          Array.isArray(parsedReport.suites) &&
          isRecord(parsedReport.stats),
      );
      const report = fake<JSONReport>(parsedReport);
      const attachment =
        report.suites[0].specs[0].tests[0].results[0].attachments.find(
          (item: { name: string }) => item.name === "owned-demo",
        );
      assert.ok(
        attachment?.path !== undefined && existsSync(attachment.path),
        "actual screenshot evidence must exist",
      );
      assert.equal(report.stats.expected, 1);
      assert.equal(report.stats.unexpected, 0);
      assert.equal(report.stats.skipped, 0);
      const absent = path.join(directory, "absent");
      createStarter(artifact, absent, "demo", receipt.manifestSha256);
      symlinkSync(
        path.join(demo, "node_modules"),
        path.join(absent, "node_modules"),
        "dir",
      );
      const browserCache = path.join(directory, "empty-browser-cache");
      mkdirSync(browserCache);
      const failed = spawnSync(process.execPath, [npmCli, "run", "demo"], {
        cwd: absent,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache },
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.notEqual(failed.status, 0);
      assert.equal(failed.error, undefined);
      assert.match(failed.stdout + failed.stderr, /Executable doesn't exist/);
      assert.doesNotMatch(failed.stdout, /Fixed synthetic demo passed/);
      const customer = path.join(directory, "customer");
      createStarter(artifact, customer, "customer", receipt.manifestSha256);
      const refused = spawnSync(
        process.execPath,
        [path.join(customer, "scripts/demo.ts")],
        { cwd: customer, encoding: "utf8", timeout: 5000 },
      );
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /placeholders only/);
      console.log(
        JSON.stringify({
          sourceRevision: receipt.sourceRevision,
          manifestSha256: receipt.manifestSha256,
          demo: "passed",
          missingBrowser: "failed as expected",
          customer: "refused as expected",
          reviewStatus: "Not Reviewed",
        }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
