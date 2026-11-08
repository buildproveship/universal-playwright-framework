import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
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
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = path.resolve(__dirname, "../../..");
const setupScripts = ["scripts/init.sh", "setup.sh"];
const posixSetup = {
  skip: process.platform === "win32"
    ? "Bash setup execution needs a POSIX host; static setup and configuration checks still run"
    : false,
};

test("Playwright loads dotenv before reading configuration environment values", () => {
  const calls: string[] = [];
  const env: Record<string, string> = {};
  const exports: { default?: { use?: { baseURL?: string } } } = {};
  const requireStub = Object.assign(
    (name: string) => {
      calls.push(name);
      if (name === "@playwright/test") {
        return {
          devices: {},
          defineConfig: (value: unknown) => {
            calls.push("defineConfig");
            return value;
          },
        };
      }
      if (name === "dotenv") {
        return {
          config: () => {
            calls.push("dotenv.config");
            env.BASE_URL = "https://example.invalid/configured";
          },
        };
      }
      throw new Error(`Unexpected config import: ${name}`);
    },
    { resolve: (name: string) => name },
  );
  const compiled = ts.transpileModule(
    readFileSync(path.join(root, "playwright.config.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  runInNewContext(compiled.outputText, { require: requireStub, exports, process: { env } });
  assert.deepEqual(calls, ["@playwright/test", "dotenv", "dotenv.config", "defineConfig"]);
  assert.equal(exports.default?.use?.baseURL, "https://example.invalid/configured");
});

interface SetupOptions {
  packagePresent?: boolean;
  cliPresent?: boolean;
  existingEnvironment?: boolean;
  failStage?: "install" | "build" | "browser";
}

function runSetup(script: string, options: SetupOptions = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "framework setup safety-"));
  const bin = path.join(directory, "bin");
  const logPath = path.join(directory, "commands.log");
  mkdirSync(bin);
  const npmStub = `#!/bin/bash
printf 'npm %s\\n' "$*" >> "$SETUP_TEST_LOG"
case "$*" in
  'install --ignore-scripts')
    if [[ "$SETUP_TEST_FAIL" == install ]]; then exit 42; fi ;;
  'run --ignore-scripts build')
    if [[ "$SETUP_TEST_FAIL" == build ]]; then exit 43; fi ;;
  'run lint') ;;
  *) echo 'Unexpected npm command' >&2; exit 90 ;;
esac
`;
  writeFileSync(path.join(bin, "npm"), npmStub, { mode: 0o755 });
  for (const command of ["npx", "playwright"]) {
    writeFileSync(
      path.join(bin, command),
      `#!/bin/bash\nprintf 'forbidden ${command}\\n' >> "$SETUP_TEST_LOG"\nexit 91\n`,
      { mode: 0o755 },
    );
  }
  // PATH contains only owned stubs plus the two file utilities used by setup.
  // No package acquisition or real browser installation can occur in this harness.
  symlinkSync(process.execPath, path.join(bin, "node"));
  for (const command of ["cat", "mkdir"]) {
    symlinkSync(`/bin/${command}`, path.join(bin, command));
  }
  if (options.packagePresent !== false) {
    writeFileSync(path.join(directory, "package.json"), "{}\n");
  }
  if (options.cliPresent !== false) {
    const cliDirectory = path.join(directory, "node_modules/@playwright/test");
    mkdirSync(cliDirectory, { recursive: true });
    writeFileSync(
      path.join(cliDirectory, "cli.js"),
      `const fs = require("node:fs");
fs.appendFileSync(process.env.SETUP_TEST_LOG, "local-playwright " + process.argv.slice(2).join(" ") + "\\n");
if (process.argv.slice(2).join(" ") !== "install") process.exit(92);
if (process.env.SETUP_TEST_FAIL === "browser") process.exit(44);
`,
    );
  }
  const existingEnvironment = "BASE_URL=https://example.invalid/owned\n";
  if (options.existingEnvironment) {
    writeFileSync(path.join(directory, ".env"), existingEnvironment);
  }
  try {
    const result = spawnSync("/bin/bash", [path.join(root, script)], {
      cwd: directory,
      input: "\n\n\n",
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: bin,
        HOME: directory,
        SETUP_TEST_LOG: logPath,
        SETUP_TEST_FAIL: options.failStage ?? "",
      },
    });
    return {
      ...result,
      commands: existsSync(logPath)
        ? readFileSync(logPath, "utf8").trim().split("\n")
        : [],
      environment: existsSync(path.join(directory, ".env"))
        ? readFileSync(path.join(directory, ".env"), "utf8")
        : undefined,
      existingEnvironment,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const script of setupScripts) {
  test(`${script} installs without lifecycle hooks and invokes only the pinned local CLI`, posixSetup, () => {
    const result = runSetup(script);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.commands,
      script === "scripts/init.sh"
        ? [
            "npm install --ignore-scripts",
            "local-playwright install",
            "npm run --ignore-scripts build",
            "npm run lint",
          ]
        : [
            "npm install --ignore-scripts",
            "npm run --ignore-scripts build",
            "local-playwright install",
          ],
    );
    assert.ok(result.environment?.includes("localhost:3000"));
  });

  test(`${script} fails before installation outside a framework checkout`, posixSetup, () => {
    const result = runSetup(script, { packagePresent: false });
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(result.commands, []);
    assert.equal(result.environment, undefined);
  });

  test(`${script} fails closed without a local CLI, even with global commands present`, posixSetup, () => {
    const result = runSetup(script, { cliPresent: false });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Local Playwright CLI is missing/);
    assert.deepEqual(
      result.commands,
      script === "scripts/init.sh"
        ? ["npm install --ignore-scripts"]
        : ["npm install --ignore-scripts", "npm run --ignore-scripts build"],
    );
  });

  for (const [failStage, exitCode] of [
    ["install", 42],
    ["build", 43],
    ["browser", 44],
  ] as const) {
    test(`${script} preserves ${failStage} failure instead of claiming success`, posixSetup, () => {
      const result = runSetup(script, { failStage });
      assert.equal(result.status, exitCode, result.stderr);
      assert.doesNotMatch(result.stdout, /initialization complete|Setup Complete/);
      if (failStage === "install") {
        assert.deepEqual(result.commands, ["npm install --ignore-scripts"]);
      }
    });
  }

  test(`${script} uses Bash conditional tests and no on-demand package runner`, () => {
    const lines = readFileSync(path.join(root, script), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"));
    for (const line of lines) {
      assert.doesNotMatch(line, /\bif\s+\[(?!\[)/);
      assert.doesNotMatch(line, /^\s*npx\b/);
    }
  });
}

test("initialization preserves an existing environment file", posixSetup, () => {
  const result = runSetup("scripts/init.sh", { existingEnvironment: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.environment, result.existingEnvironment);
});

test("setup's explicit build replaces the reviewed prepare hook without dependency rebuilds", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; hasInstallScript?: boolean; optional?: boolean }>;
  };
  assert.equal(manifest.scripts.prepare, "npm run build");
  assert.equal(manifest.dependencies["@playwright/test"], "1.55.1");
  assert.equal(lock.packages["node_modules/@playwright/test"].version, "1.55.1");
  assert.equal(lock.packages["node_modules/playwright"].version, "1.55.1");
  assert.deepEqual(
    Object.entries(lock.packages)
      .filter(([, metadata]) => metadata.hasInstallScript)
      .map(([name]) => name),
    ["node_modules/fsevents"],
    "Review lifecycle needs before accepting new install-script dependencies",
  );
  assert.equal(lock.packages["node_modules/fsevents"].optional, true);
});

for (const config of ["config/dev.config.ts", "playwright.config.ts"]) {
  test(`${config} preserves unanchored setup discovery without redundant wildcards`, () => {
    const source = ts.createSourceFile(
      config,
      readFileSync(path.join(root, config), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const expressions: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source) === "testMatch" &&
        ts.isRegularExpressionLiteral(node.initializer)
      ) {
        expressions.push(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.equal(expressions.length, 1);
    const literal = expressions[0];
    const delimiter = literal.lastIndexOf("/");
    const matcher = new RegExp(literal.slice(1, delimiter), literal.slice(delimiter + 1));
    assert.equal(matcher.source, String.raw`\.setup\.ts`);
    const cases: Array<[string, boolean]> = [
      [".setup.ts", true],
      ["tests/auth.setup.ts", true],
      [String.raw`C:\repo\tests\auth.setup.ts`, true],
      ["auth.setup.tsx", true],
      ["auth.setup.ts.backup", true],
      ["folder\n.setup.ts\n.more", true],
      ["auth.setupXts", false],
      ["authXsetup.ts", false],
      ["auth.setup.t", false],
      ["auth.SETUP.ts", false],
      ["", false],
      ["x".repeat(200_000), false],
      [`${"x".repeat(200_000)}.setup.ts.extra`, true],
    ];
    for (const [name, matches] of cases) {
      assert.equal(matcher.test(name), matches, name.slice(0, 120));
    }
  });
}

for (const passed of [true, false]) {
  test(`Cucumber report validation ${passed ? "passes" : "fails"} inside its named test`, () => {
    // Synthetic report fixtures exercise only the assertion contract. They are
    // not substituted for the real E2E report in the aggregate regression run.
    const directory = mkdtempSync(path.join(tmpdir(), "cucumber report contract-"));
    const compiledRoot = path.join(root, "dist/cucumber");
    const compiledDirectory = path.join(directory, "dist/cucumber");
    const files = [
      "scripts/cucumber-timeouts.test.js",
      "scripts/setup-safety.test.js",
      "features/support/step-timeout.js",
      "features/support/cleanup-runtime.js",
    ];
    try {
      for (const file of files) {
        const destination = path.join(compiledDirectory, file);
        mkdirSync(path.dirname(destination), { recursive: true });
        cpSync(path.join(compiledRoot, file), destination);
      }
      symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "junction");
      mkdirSync(path.join(directory, "reports"));
      const reportPath = path.join(directory, "reports/cucumber-results.json");
      const report = JSON.stringify([
        { elements: [{ steps: [{ result: { status: passed ? "passed" : "failed" } }] }] },
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
      assert.equal(result.status, passed ? 0 : 1, result.stdout + result.stderr);
      assert.ok(result.stdout.includes(`${passed ? "ok" : "not ok"} 1 - ${title}`), result.stdout);
      assert.equal(readFileSync(reportPath, "utf8"), report);
      if (!passed) {
        assert.match(result.stdout, /The real Cucumber E2E report must contain a passed scenario/);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
