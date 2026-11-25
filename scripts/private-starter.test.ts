// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Private scaffold byte integrity, preservation, mode boundaries and setup failures in disposable fixtures; not customer or production acceptance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createStarter,
  sha256,
  starterDependencyGraph,
  starterLockPackages,
} from "./private-starter";
import { settle } from "./fixtures/settle";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const root = path.resolve(__dirname, "../../..");
function fixture(
  use: (directory: string, artifact: string, digest: string) => void,
): void {
  const directory = mkdtempSync(path.join(tmpdir(), "rr-starter-test-"));
  const artifact = path.join(directory, "artifact");
  mkdirSync(artifact);
  const files: Record<string, string> = {
    "common/package.json": JSON.stringify({ private: true, type: "module" }),
    "common/package-lock.json": "{}",
    "common/vendor/framework.tgz": "synthetic tar bytes",
    "demo/tests/demo.spec.ts": "// fixed demo",
    "customer/placeholder.txt": "<data-reference>",
  };
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(artifact, file)), { recursive: true });
    writeFileSync(path.join(artifact, file), bytes);
  }
  const metadata = {
    format: "releaseready-private-starter/v1",
    sourceRevision: "a".repeat(40),
    files: Object.fromEntries(
      Object.entries(files).map(([file, bytes]) => [file, sha256(bytes)]),
    ),
  };
  writeFileSync(path.join(artifact, "starter.json"), JSON.stringify(metadata));
  try {
    use(
      directory,
      artifact,
      sha256(readFileSync(path.join(artifact, "starter.json"))),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
for (const mode of ["demo", "customer"] as const) {
  test(`creates only the ${mode} slice with exact private provenance and no allocated identities`, () => {
    fixture((directory, artifact, digest) => {
      const target = path.join(directory, "project");
      createStarter(artifact, target, mode, digest);
      assert.equal(
        existsSync(path.join(target, "tests/demo.spec.ts")),
        mode === "demo",
      );
      assert.equal(
        existsSync(path.join(target, "placeholder.txt")),
        mode === "customer",
      );
      const provenance: unknown = JSON.parse(
        readFileSync(path.join(target, "starter-provenance.json"), "utf8"),
      );
      assert.ok(isRecord(provenance));
      assert.equal(provenance.sourceRevision, "a".repeat(40));
      assert.equal(provenance.manifestSha256, digest);
      assert.equal(provenance.reviewStatus, "Not Reviewed");
      assert.equal(provenance.registered, false);
      assert.ok(typeof provenance.identityStatus === "string");
      assert.match(provenance.identityStatus, /^unallocated/);
      assert.deepEqual(
        readFileSync(path.join(target, "vendor/framework.tgz")),
        readFileSync(path.join(artifact, "common/vendor/framework.tgz")),
      );
    });
  });
}
test("accepts an existing empty destination but refuses repeat invocation without changing bytes", () => {
  fixture((directory, artifact, digest) => {
    const target = path.join(directory, "project");
    mkdirSync(target);
    createStarter(artifact, target, "demo", digest);
    const before = readFileSync(path.join(target, "starter-provenance.json"));
    assert.throws(() => {
      createStarter(artifact, target, "demo", digest);
    }, /empty directory/);
    assert.deepEqual(
      readFileSync(path.join(target, "starter-provenance.json")),
      before,
    );
  });
});
test("refuses nonempty destinations and preserves existing canonical IDs", () => {
  fixture((directory, artifact, digest) => {
    const target = path.join(directory, "project");
    mkdirSync(target);
    const baseline =
      '{"caseId":"existing-canonical-id","review":"owner-owned"}';
    writeFileSync(path.join(target, "identity.json"), baseline);
    assert.throws(() => {
      createStarter(artifact, target, "demo", digest);
    }, /empty directory/);
    assert.deepEqual(readdirSync(target), ["identity.json"]);
    assert.equal(
      readFileSync(path.join(target, "identity.json"), "utf8"),
      baseline,
    );
  });
});
for (const kind of ["file", "manifest", "extra", "symlink"] as const) {
  test(`rejects ${kind} artifact tampering before writing destination`, () => {
    fixture((directory, artifact, digest) => {
      if (kind === "file")
        writeFileSync(
          path.join(artifact, "demo/tests/demo.spec.ts"),
          "changed",
        );
      if (kind === "manifest")
        writeFileSync(path.join(artifact, "starter.json"), "{}");
      if (kind === "extra")
        writeFileSync(path.join(artifact, "unexpected"), "extra");
      if (kind === "symlink")
        symlinkSync(
          path.join(artifact, "common/package.json"),
          path.join(artifact, "link"),
        );
      const target = path.join(directory, "project");
      assert.throws(() => {
        createStarter(artifact, target, "demo", digest);
      });
      assert.equal(existsSync(target), false);
    });
  });
}
test("rejects destination symlinks rather than writing into another directory", () => {
  fixture((directory, artifact, digest) => {
    const actual = path.join(directory, "actual");
    const target = path.join(directory, "target");
    mkdirSync(actual);
    symlinkSync(actual, target, "dir");
    assert.throws(() => {
      createStarter(artifact, target, "demo", digest);
    });
    assert.deepEqual(readdirSync(actual), []);
  });
});
test("requires an explicit trusted manifest digest and supported mode", () => {
  fixture((directory, artifact) => {
    assert.throws(() => {
      createStarter(artifact, path.join(directory, "project"), "demo", "");
    }, /SHA-256/);
    assert.throws(() => {
      createStarter(
        artifact,
        path.join(directory, "project"),
        "other",
        "a".repeat(64),
      );
    }, /Choose/);
  });
});
test("templates are reference-only, keep one rulebook and never assign canonical IDs", () => {
  const inputs: unknown = JSON.parse(
    readFileSync(
      path.join(root, "starter/templates/common/customer-inputs.example.json"),
      "utf8",
    ),
  );
  assert.ok(isRecord(inputs));
  assert.deepEqual(Object.keys(inputs), [
    "targetUrl",
    "dataReference",
    "execution",
  ]);
  assert.ok(typeof inputs.targetUrl === "string");
  assert.ok(typeof inputs.dataReference === "string");
  assert.match(inputs.targetUrl, /^</);
  assert.match(inputs.dataReference, /^</);
  const rules = readFileSync(
    path.join(root, "starter/templates/common/AGENTS.md"),
    "utf8",
  );
  assert.match(rules, /does not allocate IDs/);
  assert.match(rules, /Only the founder/);
  assert.match(rules, /Not Reviewed/);
  const demo = readFileSync(
    path.join(root, "starter/templates/demo/tests/demo.spec.ts"),
    "utf8",
  );
  assert.match(demo, /extends|fixtures\/demo/);
  assert.match(demo, /Review status: Not Reviewed/);
  assert.doesNotMatch(
    demo,
    /@case:|@rr-case:|@test-id:|password|token|secret/i,
  );
  const page = readFileSync(
    path.join(root, "starter/templates/demo/pages/demo-page.ts"),
    "utf8",
  );
  assert.match(page, /extends BasePage/);
  assert.match(page, /@buildproveship\/playwright-framework/);
});

function runSetup(
  stage: "success" | "dependency" | "missing-cli" | "browser" | "typecheck",
) {
  const directory = mkdtempSync(path.join(tmpdir(), "rr-starter-setup-"));
  try {
    writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
    const npmStub = path.join(directory, "npm.cjs");
    writeFileSync(
      npmStub,
      `const fs=require('node:fs');const path=require('node:path');
fs.appendFileSync('commands.log',JSON.stringify(process.argv.slice(2))+'\\n');
if(process.env.FAIL_STAGE==='dependency')process.exit(42);
if(process.env.FAIL_STAGE!=='missing-cli') { fs.mkdirSync('node_modules/@playwright/test',{recursive:true});fs.writeFileSync('node_modules/@playwright/test/cli.js',"require('node:fs').appendFileSync('commands.log','browser\\\\n');if(process.env.FAIL_STAGE==='browser')process.exit(43);"); }
fs.mkdirSync('node_modules/typescript/bin',{recursive:true});fs.writeFileSync('node_modules/typescript/bin/tsc',"require('node:fs').appendFileSync('commands.log','typecheck\\\\n');if(process.env.FAIL_STAGE==='typecheck')process.exit(44);");`,
    );
    const result = spawnSync(
      process.execPath,
      [path.join(root, "starter/templates/common/scripts/setup.ts")],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, npm_execpath: npmStub, FAIL_STAGE: stage },
      },
    );
    return {
      ...result,
      commands: existsSync(path.join(directory, "commands.log"))
        ? readFileSync(path.join(directory, "commands.log"), "utf8")
        : "",
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
for (const stage of [
  "dependency",
  "missing-cli",
  "browser",
  "typecheck",
] as const) {
  test(`setup stops truthfully at ${stage} failure without claiming success`, () => {
    const result = runSetup(stage);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      result.stdout,
      /Dependencies, Chromium and typecheck completed/,
    );
    assert.match(result.stderr, /failed|unavailable/);
    assert.match(result.commands, /ci.*--ignore-scripts/);
    if (stage === "dependency" || stage === "missing-cli")
      assert.doesNotMatch(result.commands, /browser/);
    if (stage === "browser") assert.doesNotMatch(result.commands, /typecheck/);
  });
}
test("setup explicitly installs pinned dependencies/browser and typechecks without running tests", () => {
  const result = runSetup("success");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /ci.*--ignore-scripts/);
  assert.match(result.commands, /browser/);
  assert.match(result.commands, /typecheck/);
  assert.match(result.stdout, /No demo or customer journey has run/);
});
for (const mode of ["customer", "demo"]) {
  test(`demo command refuses ${mode === "customer" ? "customer mode" : "missing installed dependency"}`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "rr-demo-refusal-"));
    try {
      writeFileSync(
        path.join(directory, "starter-provenance.json"),
        JSON.stringify({ mode }),
      );
      const result = spawnSync(
        process.execPath,
        [path.join(root, "starter/templates/common/scripts/demo.ts")],
        { cwd: directory, encoding: "utf8", timeout: 5000 },
      );
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        mode === "customer" ? /placeholders only/ : /dependency unavailable/,
      );
      assert.doesNotMatch(result.stdout, /passed/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const failure of [
  "route",
  "websocket",
  "use",
  "none",
  "external-http",
  "external-websocket",
  "same-origin",
] as const) {
  test(`owned demo closes its actual listener after ${failure} setup/use outcome`, async () => {
    const http = await import("node:http");
    const ts = await import("typescript");
    const { runInNewContext } = await import("node:vm");
    let listener: import("node:http").Server | undefined;
    let fixtureFunction: (
      args: unknown,
      use: () => Promise<void>,
    ) => Promise<void> = () =>
      Promise.reject(new Error("Fixture not registered"));
    const compiled = ts.transpileModule(
      readFileSync(
        path.join(root, "starter/templates/demo/fixtures/demo.ts"),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    );
    runInNewContext(compiled.outputText, {
      exports: {},
      URL,
      require: (name: string) => {
        if (name === "node:http")
          return {
            createServer: (...args: Parameters<typeof http.createServer>) => {
              listener = http.createServer(...args);
              return listener;
            },
          };
        if (name === "@playwright/test")
          return {
            test: {
              extend: (fixtures: { demo: typeof fixtureFunction }) => {
                fixtureFunction = fixtures.demo;
              },
            },
            expect: (actual: unknown) => ({
              toBe: (expected: unknown) => {
                assert.equal(actual, expected);
              },
            }),
          };
        if (name === "../pages/demo-page.ts")
          return {
            DemoPage: class {
              readonly args: unknown[];
              constructor(...args: unknown[]) {
                this.args = args;
              }
            },
          };
        throw new Error("Unexpected import");
      },
    });
    interface Route {
      request: () => { url: () => string };
      abort: () => Promise<void>;
      continue: () => Promise<void>;
    }
    let routeHandler: ((route: Route) => Promise<void>) | undefined;
    let socketHandler: ((socket: { close: () => void }) => void) | undefined;
    let aborted = 0,
      continued = 0,
      closed = 0;
    const context = {
      route: (_pattern: string, handler: typeof routeHandler) =>
        settle(() => {
          if (failure === "route") throw new Error("route failed");
          routeHandler = handler;
        }),
      routeWebSocket: (_pattern: string, handler: typeof socketHandler) =>
        settle(() => {
          if (failure === "websocket") throw new Error("websocket failed");
          socketHandler = handler;
        }),
    };
    const promise = fixtureFunction({ page: {}, context }, async () => {
      if (failure === "use") throw new Error("use failed");
      if (failure === "external-http" || failure === "same-origin") {
        assert.ok(routeHandler);
        const address = listener?.address();
        assert.ok(address && typeof address !== "string");
        await routeHandler({
          request: () => ({
            url: () =>
              failure === "external-http"
                ? "https://not-contacted.invalid/"
                : `http://127.0.0.1:${address.port}/`,
          }),
          abort: () => {
            aborted++;
            return Promise.resolve();
          },
          continue: () => {
            continued++;
            return Promise.resolve();
          },
        });
      }
      if (failure === "external-websocket") {
        assert.ok(socketHandler);
        socketHandler({
          close: () => {
            closed++;
          },
        });
      }
    });
    try {
      if (failure === "none" || failure === "same-origin") await promise;
      else if (failure.startsWith("external-"))
        await assert.rejects(promise, { name: "AssertionError" });
      else await assert.rejects(promise, new RegExp(failure + " failed"));
      if (failure === "external-http") {
        assert.equal(aborted, 1);
        assert.equal(continued, 0);
      }
      if (failure === "same-origin") {
        assert.equal(aborted, 0);
        assert.equal(continued, 1);
      }
      if (failure === "external-websocket") assert.equal(closed, 1);
      assert.ok(listener);
      assert.equal(
        listener.listening,
        false,
        "owned listener must be closed even if setup throws",
      );
    } finally {
      listener?.closeAllConnections();
      listener?.close();
    }
  });
}

test("starter lock keeps exactly the entries its own dependencies reach, resolved as Node resolves them", () => {
  const packages = {
    "": { name: "source" },
    "node_modules/runtime": {
      dependencies: { shared: "1.0.0", nested: "2.0.0" },
      optionalDependencies: { "absent-optional": "1.0.0" },
    },
    "node_modules/runtime/node_modules/nested": {
      peerDependencies: { peer: "1.0.0" },
    },
    "node_modules/nested": { version: "1.0.0" },
    "node_modules/shared": {},
    "node_modules/peer": {},
    "node_modules/lint-only": { dependencies: { "lint-helper": "1.0.0" } },
    "node_modules/lint-helper": {},
  };
  assert.deepEqual(Object.keys(starterLockPackages(packages, ["runtime"])), [
    "",
    "node_modules/runtime",
    "node_modules/runtime/node_modules/nested",
    "node_modules/shared",
    "node_modules/peer",
  ]);
});

test("the starter built from this repository's lock needs nothing from GitHub Packages", () => {
  const root = path.resolve(__dirname, "../../..");
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const lock = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8"),
  ) as { packages: Record<string, { resolved?: string } | undefined> };
  assert.ok("@buildproveship/config" in manifest.devDependencies);
  const graph = starterDependencyGraph(manifest, lock.packages);
  assert.equal("@buildproveship/config" in graph.devDependencies, false);
  for (const name of [
    ...Object.keys(manifest.dependencies),
    "typescript",
    "@types/node",
  ]) {
    assert.ok(`node_modules/${name}` in graph.packages, name);
  }
  const fromGitHubPackages = Object.entries(graph.packages).filter(
    ([, entry]) =>
      (entry as { resolved?: string } | undefined)?.resolved?.startsWith(
        "https://npm.pkg.github.com/",
      ) === true,
  );
  assert.deepEqual(fromGitHubPackages, []);
});
