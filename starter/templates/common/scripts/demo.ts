import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const provenance = JSON.parse(readFileSync("starter-provenance.json", "utf8"));
if (provenance.mode !== "demo") {
  console.error(
    "Customer mode is placeholders only. Execution is not configured.",
  );
  process.exit(1);
}
const cli = path.resolve("node_modules/@playwright/test/cli.js");
if (!existsSync(cli)) {
  console.error(
    "Pinned Playwright dependency unavailable. Run npm run setup; no demo ran.",
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [cli, "test", "--config=playwright.config.ts"],
  { stdio: "inherit", timeout: 60_000 },
);
if (result.error || result.status !== 0) {
  console.error(
    "Demo failed or timed out. Inspect reports and browser installation; no pass or customer acceptance is claimed.",
  );
  process.exit(1);
}
console.log(
  "Fixed synthetic demo passed. See reports/ and test-results/. Not Reviewed; no canonical IDs or registration.",
);
