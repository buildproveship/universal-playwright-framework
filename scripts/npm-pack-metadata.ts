import { lstatSync } from "node:fs";
import path from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the single tarball file name from `npm pack --json` stdout.
 * npm <= 11 prints `[entry]`; npm 12 prints `{ "<package name>": entry }`.
 * Exactly one entry for the expected package is accepted.
 */
export function packedTarballName(
  stdout: string,
  expectedName: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("npm pack did not print JSON metadata");
  }

  let entry: unknown;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      throw new Error("npm pack metadata must describe exactly one package");
    }
    entry = parsed[0];
  } else if (isRecord(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== expectedName) {
      throw new Error(
        "npm pack metadata must describe exactly the expected package",
      );
    }
    entry = parsed[expectedName];
  } else {
    throw new Error("npm pack metadata has an unsupported shape");
  }

  if (!isRecord(entry) || entry.name !== expectedName) {
    throw new Error("npm pack metadata does not describe the expected package");
  }
  const filename = entry.filename;
  if (
    typeof filename !== "string" ||
    filename.includes("\0") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    path.basename(filename) !== filename ||
    path.win32.basename(filename) !== filename ||
    !/^[^.].*\.tgz$/.test(filename)
  ) {
    throw new Error("npm pack metadata must name a plain .tgz file name");
  }
  return filename;
}

/** Resolves the packed tarball as a regular, non-symlinked file in `destination`. */
export function resolvePackedTarball(
  destination: string,
  stdout: string,
  expectedName: string,
): string {
  const tarball = path.join(
    destination,
    packedTarballName(stdout, expectedName),
  );
  if (path.dirname(tarball) !== path.resolve(destination)) {
    throw new Error("Packed tarball must stay in the pack destination");
  }
  let stats;
  try {
    stats = lstatSync(tarball);
  } catch {
    throw new Error("Packed tarball was not written to the pack destination");
  }
  if (!stats.isFile()) {
    throw new Error("Packed tarball must be a regular file");
  }
  return tarball;
}
