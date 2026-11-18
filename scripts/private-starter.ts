import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePackedTarball } from "./npm-pack-metadata";
import { resolveGitExecutable } from "./check-typescript-source-policy";

const FORMAT = "releaseready-private-starter/v1";
const PACKAGE = "@universal/playwright-framework";
const sourceRoot = path.resolve(__dirname, "../../..");
interface Manifest {
  format: string;
  sourceRevision: string;
  files: Record<string, string>;
}
export const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

function regularFiles(root: string, prefix = ""): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix)).sort()) {
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const stat = lstatSync(path.join(root, relative));
    if (stat.isDirectory()) result.push(...regularFiles(root, relative));
    else if (stat.isFile()) result.push(relative);
    else
      throw new Error(
        "Artifact must contain only regular files and directories, not symlinks",
      );
  }
  return result;
}
interface PackageMetadata {
  name: string;
  version: string;
  private?: boolean;
  scripts?: Record<string, string>;
  publishConfig?: unknown;
  files?: string[];
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: unknown;
  engines?: Record<string, string>;
}
interface LockMetadata {
  name: string;
  version: string;
  packages: Record<string, unknown>;
}
/** The parsed manifest's file inventory must be a plain object of digests; JSON gives no such guarantee. */
function isFileInventory(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function json(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}
function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
function requireEmptyDirectory(directory: string): void {
  if (existsSync(directory)) {
    if (
      !lstatSync(directory).isDirectory() ||
      readdirSync(directory).length !== 0
    )
      throw new Error(
        "Destination must be an empty directory; existing files are preserved",
      );
  } else mkdirSync(directory); // Parent must already exist; never recursively create arbitrary paths.
}
function runNpm(args: string[], cwd: string): string {
  const cli = process.env.npm_execpath;
  if (!cli || !path.isAbsolute(cli) || !lstatSync(cli).isFile())
    throw new Error(
      "Run this command through npm run starter so the installed npm CLI is explicit",
    );
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** Builds a private artifact from a clean, committed revision. No registry publication. */
export function buildStarter(output: string): {
  sourceRevision: string;
  manifestSha256: string;
} {
  const git = resolveGitExecutable();
  const gitRead = (...args: string[]): string =>
    execFileSync(git, args, { cwd: sourceRoot, encoding: "utf8" }).trim();
  if (gitRead("status", "--porcelain", "--untracked-files=all"))
    throw new Error(
      "Commit the intended source first; refusing to label uncommitted files with a revision",
    );
  const revision = gitRead("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("A full source revision is required");
  const destination = path.resolve(output);
  if (
    destination === sourceRoot ||
    destination.startsWith(sourceRoot + path.sep)
  )
    throw new Error("Build the artifact outside the source checkout");
  requireEmptyDirectory(destination);
  const scratch = mkdtempSync(path.join(tmpdir(), "rr-private-starter-"));
  try {
    // Compile an exact committed snapshot, never stale/ignored dist files from the working tree.
    const snapshot = path.join(scratch, "framework");
    mkdirSync(snapshot);
    const archive = execFileSync(git, ["archive", revision], {
      cwd: sourceRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    execFileSync("/usr/bin/tar", ["-xf", "-", "-C", snapshot], {
      input: archive,
    });
    symlinkSync(
      path.join(sourceRoot, "node_modules"),
      path.join(snapshot, "node_modules"),
      "dir",
    );
    runNpm(["run", "--ignore-scripts", "build"], snapshot);
    const original = json(
      path.join(snapshot, "package.json"),
    ) as PackageMetadata;
    const packaged = { ...original, private: true, scripts: {} };
    delete packaged.publishConfig;
    // Replace only our newly archived, owned snapshot manifest. Destination writes remain exclusive.
    writeFileSync(
      path.join(snapshot, "package.json"),
      JSON.stringify(packaged, null, 2) + "\n",
    );
    const packed = runNpm(
      ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
      snapshot,
    );
    const tarball = resolvePackedTarball(scratch, packed, PACKAGE);
    mkdirSync(path.join(destination, "common"));
    cpSync(
      path.join(snapshot, "starter/templates/common"),
      path.join(destination, "common"),
      { recursive: true },
    );
    cpSync(
      path.join(snapshot, "starter/templates/demo"),
      path.join(destination, "demo"),
      { recursive: true },
    );
    cpSync(
      path.join(snapshot, "starter/templates/customer"),
      path.join(destination, "customer"),
      { recursive: true },
    );
    mkdirSync(path.join(destination, "common/vendor"));
    cpSync(tarball, path.join(destination, "common/vendor/framework.tgz"));
    // Adopt exact existing locked dependency graph, including dev tools. No resolver or "latest" fetch.
    const lock = json(path.join(snapshot, "package-lock.json")) as LockMetadata;
    const name = "releaseready-private-test-assets";
    const dependencies = {
      ...original.dependencies,
      [PACKAGE]: "file:vendor/framework.tgz",
    };
    const manifest = {
      name,
      version: "0.0.0",
      private: true,
      type: "module",
      engines: { node: ">=24 <25" },
      scripts: {
        setup: "node scripts/setup.ts",
        typecheck: "tsc --noEmit",
        demo: "node scripts/demo.ts",
      },
      dependencies,
      devDependencies: original.devDependencies,
      overrides: original.overrides,
    };
    lock.name = name;
    lock.version = "0.0.0";
    lock.packages[""] = {
      name,
      version: "0.0.0",
      dependencies,
      devDependencies: original.devDependencies,
      engines: manifest.engines,
    };
    lock.packages[`node_modules/${PACKAGE}`] = {
      version: original.version,
      resolved: "file:vendor/framework.tgz",
      integrity:
        "sha512-" +
        createHash("sha512").update(readFileSync(tarball)).digest("base64"),
      dependencies: original.dependencies,
      engines: original.engines,
    };
    writeJson(path.join(destination, "common/package.json"), manifest);
    writeJson(path.join(destination, "common/package-lock.json"), lock);
    const files = Object.fromEntries(
      regularFiles(destination).map((file) => [
        file,
        sha256(readFileSync(path.join(destination, file))),
      ]),
    );
    const metadata: Manifest = {
      format: FORMAT,
      sourceRevision: revision,
      files,
    };
    writeJson(path.join(destination, "starter.json"), metadata);
    return {
      sourceRevision: revision,
      manifestSha256: sha256(
        readFileSync(path.join(destination, "starter.json")),
      ),
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Verify all bytes before writing. The expected manifest digest must come from the trusted build receipt. */
export function createStarter(
  artifact: string,
  destination: string,
  mode: string,
  expectedDigest: string,
): void {
  // The mode comes from the command line, so it is checked here rather than trusted as a Mode.
  if (mode !== "demo" && mode !== "customer")
    throw new Error("Choose demo or customer mode");
  if (!/^[a-f0-9]{64}$/.test(expectedDigest))
    throw new Error("Expected manifest SHA-256 is required");
  if (!lstatSync(artifact).isDirectory())
    throw new Error("Artifact must be a directory, not a symlink");
  const allFiles = regularFiles(artifact);
  const raw = readFileSync(path.join(artifact, "starter.json"));
  if (sha256(raw) !== expectedDigest)
    throw new Error("Artifact manifest digest mismatch");
  const metadata = JSON.parse(raw.toString()) as Manifest;
  if (
    metadata.format !== FORMAT ||
    !/^[a-f0-9]{40}$/.test(metadata.sourceRevision) ||
    !isFileInventory(metadata.files)
  )
    throw new Error("Unsupported starter manifest");
  const files = Object.keys(metadata.files).sort();
  if (
    JSON.stringify(
      allFiles.filter((file) => file !== "starter.json").sort(),
    ) !== JSON.stringify(files)
  )
    throw new Error("Artifact file inventory mismatch");
  const selected = new Map<string, Buffer>();
  for (const file of files) {
    if (
      !/^(common|demo|customer)\/[A-Za-z0-9_./-]+$/.test(file) ||
      file
        .split("/")
        .some((part) => part === "." || part === ".." || part === "")
    )
      throw new Error("Unsafe artifact path");
    const bytes = readFileSync(path.join(artifact, file));
    if (sha256(bytes) !== metadata.files[file])
      throw new Error("Artifact file digest mismatch");
    if (file.startsWith("common/") || file.startsWith(mode + "/")) {
      const relative = file.slice(file.indexOf("/") + 1);
      if (selected.has(relative)) throw new Error("Artifact paths overlap");
      selected.set(relative, bytes);
    }
  }
  const starterManifest = selected.get("package.json");
  if (
    !starterManifest ||
    !selected.has("package-lock.json") ||
    !selected.has("vendor/framework.tgz")
  )
    throw new Error("Artifact is missing required project files");
  const starterPackage = JSON.parse(starterManifest.toString()) as {
    readonly private?: unknown;
  } | null;
  if (starterPackage?.private !== true)
    throw new Error("Starter project must be private");
  const target = path.resolve(destination);
  requireEmptyDirectory(target);
  for (const [file, bytes] of selected) {
    const output = path.join(target, file);
    mkdirSync(path.dirname(output), { recursive: true });
    // wx is deliberate: repeat/racing writes never replace another file.
    writeFileSync(output, bytes, { flag: "wx" });
  }
  writeJson(path.join(target, "starter-provenance.json"), {
    format: FORMAT,
    sourceRevision: metadata.sourceRevision,
    manifestSha256: expectedDigest,
    mode,
    reviewStatus: "Not Reviewed",
    identityStatus:
      "unallocated; use canonical Test Management allocation before registration",
    registered: false,
  });
}

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "build" && args.length === 1)
      console.log(JSON.stringify(buildStarter(args[0])));
    else if (command === "create" && args.length === 4) {
      createStarter(args[0], args[1], args[2], args[3]);
      console.log(
        "Created private Not Reviewed project. Dependencies and browser are NOT installed. Run npm run setup in the project. No IDs allocated or cases registered.",
      );
    } else
      throw new Error(
        "Usage: npm run starter -- build <empty-output> | create <artifact> <empty-project> <demo|customer> <manifest-sha256>",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Starter failed");
    process.exitCode = 1;
  }
}
