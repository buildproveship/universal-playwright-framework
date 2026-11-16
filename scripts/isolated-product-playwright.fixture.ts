// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: A separate product assertion package borrows an empty real browser; no customer scenario, network request or canonical execution.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFreshLoginPage } from "../src/execution/runtime-login-browser";
async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "rr207-product-playwright-"));
  try {
    writeFileSync(path.join(root, "package.json"), '{"private":true}');
    for (const dependency of [
      "@playwright/test",
      "playwright",
      "playwright-core",
    ]) {
      const destination = path.join(root, "node_modules", dependency);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(
        path.dirname(require.resolve(`${dependency}/package.json`)),
        destination,
        { recursive: true },
      );
    }
    const productRequire = createRequire(path.join(root, "package.json"));
    let asserted = false;
    await withFreshLoginPage(
      async (page) => {
        try {
          const product = productRequire(
            "@playwright/test",
          ) as typeof import("@playwright/test");
          await product.expect(page).toHaveURL("about:blank");
          asserted = true;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Requiring @playwright/test second time")
          )
            process.stderr.write("DUPLICATE_TEST_RUNNER\n");
          throw error;
        }
      },
      { timeoutMs: 10000 },
    );
    assert.equal(asserted, true);
    process.stdout.write(JSON.stringify({ productAssertionPassed: true }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(() => {
  process.exitCode = 1;
});
