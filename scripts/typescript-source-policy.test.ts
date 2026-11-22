// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Runs the TypeScript source-policy check against synthetic temporary source trees and git state; it does not check the real repository tree.
import ts from "typescript";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findAuthoredJavaScriptPaths,
  resolveGitExecutable,
} from "./check-typescript-source-policy";

describe("TypeScript source policy", () => {
  it("detects authored JavaScript across application and test code extensions", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "src/app.js",
        "tests/browser.jsx",
        "scripts/task.cjs",
        "features/steps/example.mjs",
        "src/app.ts",
      ]),
      [
        "features/steps/example.mjs",
        "scripts/task.cjs",
        "src/app.js",
        "tests/browser.jsx",
      ],
    );
  });

  it("excludes generated output and third-party/vendor paths", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "dist/app.js",
        "build/app.js",
        "generated/app.js",
        "vendor/browser.js",
        "third_party/tool.js",
        "node_modules/package/index.js",
        "src/node_modules/package/index.js",
        "src/client.generated.js",
        "src/client.min.js",
      ]),
      [],
    );
  });

  it("does not exempt nested source directories just because they resemble generated or vendor output", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "scripts/build/release.js",
        "src/out/format.js",
        "src/vendor/owned.js",
        "tests/generated/helpers.js",
      ]),
      [
        "scripts/build/release.js",
        "src/out/format.js",
        "src/vendor/owned.js",
        "tests/generated/helpers.js",
      ],
    );
  });

  it("does not mistake TypeScript or non-code configuration and feature files for JavaScript", () => {
    assert.deepEqual(
      findAuthoredJavaScriptPaths([
        "scripts/check.ts",
        "features/login.feature",
        "config/playwright.json",
        ".github/workflows/test.yml",
      ]),
      [],
    );
  });
});

it("preserves code-unit ordering for mixed case, punctuation and Unicode paths", () => {
  const names = [
    "z",
    "a",
    "Z",
    "A",
    "_",
    "é",
    "e\u0301",
    "\u{10000}",
    "\uE000",
    "a10",
    "a2",
    "a",
  ];
  const paths = names.map((name) => `src/${name}.js`);
  assert.deepEqual(findAuthoredJavaScriptPaths(paths), [
    "src/A.js",
    "src/Z.js",
    "src/_.js",
    "src/a.js",
    "src/a.js",
    "src/a10.js",
    "src/a2.js",
    "src/e\u0301.js",
    "src/z.js",
    "src/é.js",
    "src/\u{10000}.js",
    "src/\uE000.js",
  ]);
});

describe("trusted Git executable configuration", () => {
  it("uses fixed platform defaults without PATH lookup", () => {
    const previous = process.env.PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE;
    delete process.env.PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE;
    try {
      assert.equal(resolveGitExecutable("linux"), "/usr/bin/git");
      assert.equal(resolveGitExecutable("darwin"), "/usr/bin/git");
      assert.equal(resolveGitExecutable("freebsd"), "/usr/local/bin/git");
      assert.equal(
        resolveGitExecutable("win32"),
        String.raw`C:\Program Files\Git\cmd\git.exe`,
      );
    } finally {
      if (previous === undefined)
        delete process.env.PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE;
      else process.env.PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE = previous;
    }
  });
  it("supports trusted custom absolute installation paths", () => {
    for (const value of [
      "/nix/store/owned-git/bin/git",
      "/opt/custom git/bin/git",
    ]) {
      assert.equal(resolveGitExecutable("linux", value), value);
    }
    for (const value of [
      String.raw`D:\Git\cmd\git.exe`,
      "D:/Tools/Git/git.exe",
    ]) {
      assert.equal(resolveGitExecutable("win32", value), value);
    }
  });
  it("rejects ambiguous or nonlocal configured paths", () => {
    for (const value of ["", "git", "./git", "../git", "git\0.exe"]) {
      assert.throws(() => resolveGitExecutable("linux", value));
      assert.throws(() => resolveGitExecutable("win32", value));
    }
    assert.throws(() => resolveGitExecutable("linux", "/tmp/git\0"));
    for (const value of [
      "C:git.exe",
      "/Git/git.exe",
      String.raw`\Git\git.exe`,
      String.raw`\\host\share\git.exe`,
      "C:/git\0.exe",
    ]) {
      assert.throws(() => resolveGitExecutable("win32", value));
    }
  });
});

it("keeps tracked and untracked policy enforcement independent of PATH", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "framework-git-policy-"));
  const git = resolveGitExecutable();
  const script = path.join(__dirname, "check-typescript-source-policy.js");
  try {
    const poison = path.join(directory, "poison");
    mkdirSync(poison);
    writeFileSync(path.join(poison, "git"), "#!/bin/sh\nexit 97\n", {
      mode: 0o755,
    });
    writeFileSync(path.join(poison, "git.cmd"), "@exit /b 97\r\n");
    execFileSync(git, ["init", "--quiet"], { cwd: directory });
    writeFileSync(path.join(directory, ".gitignore"), "poison/\n");
    writeFileSync(path.join(directory, "owned.ts"), "export {};\n");
    execFileSync(git, ["add", ".gitignore", "owned.ts"], { cwd: directory });
    const indexPath = path.join(directory, ".git", "index");
    const beforeIndex = readFileSync(indexPath);
    const run = (configured = git) =>
      spawnSync(process.execPath, [script], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: poison,
          PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE: configured,
        },
        encoding: "utf8",
      });
    assert.equal(run().status, 0);
    writeFileSync(path.join(directory, "untracked.js"), "export {};\n");
    const blocked = run();
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /untracked\.js/);
    assert.deepEqual(readFileSync(indexPath), beforeIndex);
    assert.equal(
      readFileSync(path.join(directory, "owned.ts"), "utf8"),
      "export {};\n",
    );
    assert.equal(run("git").status, 1);
    const absent = run(path.join(directory, "missing-git"));
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /ENOENT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("requires explicit comparators at the source-policy and preparation sort sites", () => {
  for (const [relativePath, expectedCount] of [
    ["scripts/check-typescript-source-policy.ts", 1],
    ["features/input-preparation/data-reference.steps.ts", 1],
    ["src/input-preparation/index.ts", 2],
  ] as const) {
    const source = ts.createSourceFile(
      relativePath,
      readFileSync(path.resolve(__dirname, "../../..", relativePath), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    let count = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "sort"
      ) {
        count += 1;
        assert.equal(
          node.arguments.length,
          1,
          `${relativePath} must supply an explicit sort comparator`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(count, expectedCount, `${relativePath} expected sort sites`);
  }
});
