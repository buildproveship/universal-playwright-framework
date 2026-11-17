import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error("Use supported Node 24 LTS, then rerun npm run setup.");
  process.exit(1);
}
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli) || !existsSync(npmCli)) {
  console.error("Run npm run setup with your installed npm CLI.");
  process.exit(1);
}
const run = (args: string[], recovery: string): void => {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    console.error(recovery);
    process.exit(1);
  }
};
console.log(
  "Installing the locked dependency graph with lifecycle scripts disabled.",
);
run(
  [npmCli, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  "Dependency installation failed. Check npm access/cache and the unchanged lockfile; rerun npm run setup. No demo has run.",
);
const cli = path.resolve("node_modules/@playwright/test/cli.js");
if (!existsSync(cli)) {
  console.error(
    "Local pinned Playwright CLI unavailable; repair dependency installation. No browser or demo ran.",
  );
  process.exit(1);
}
console.log(
  "Installing Chromium for the pinned local Playwright version (download may be required).",
);
run(
  [cli, "install", "chromium"],
  "Browser installation failed. Check network/disk/browser-cache access; rerun npm run setup. No demo has run.",
);
run(
  [path.resolve("node_modules/typescript/bin/tsc"), "--noEmit"],
  "Typecheck failed. Repair the project before running the demo.",
);
console.log(
  "Dependencies, Chromium and typecheck completed. No demo or customer journey has run. Demo projects: run npm run demo separately.",
);
