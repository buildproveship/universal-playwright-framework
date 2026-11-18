import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { packedTarballName, resolvePackedTarball } from "./npm-pack-metadata";

const NAME = "@releaseready/playwright-framework";
const FILENAME = "releaseready-playwright-framework-1.0.0.tgz";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: `${NAME}@1.0.0`,
    name: NAME,
    version: "1.0.0",
    filename: FILENAME,
    files: [{ path: "package.json", size: 1, mode: 420 }],
    entryCount: 1,
    bundled: [],
    ...overrides,
  };
}

// npm <= 11 prints an array; npm 12 prints an object keyed by package name.
const arrayOutput = (value: unknown = entry()) =>
  JSON.stringify([value], null, 2);
const objectOutput = (value: unknown = entry(), key = NAME) =>
  JSON.stringify({ [key]: value }, null, 2);

test("reads the tarball name from npm 12 object-keyed pack output", () => {
  assert.equal(packedTarballName(objectOutput(), NAME), FILENAME);
});

test("still reads the tarball name from older array pack output", () => {
  assert.equal(packedTarballName(arrayOutput(), NAME), FILENAME);
});

test("rejects malformed, ambiguous or mismatched pack metadata", () => {
  const malformed: [string, string][] = [
    ["not JSON", "npm notice\n{}"],
    ["null", "null"],
    ["empty array", "[]"],
    ["empty object", "{}"],
    ["two array entries", JSON.stringify([entry(), entry()])],
    [
      "two packages",
      JSON.stringify({ [NAME]: entry(), other: entry({ name: "other" }) }),
    ],
    ["entry not object", arrayOutput("x")],
    ["missing filename", arrayOutput(entry({ filename: undefined }))],
    ["non-string filename", objectOutput(entry({ filename: 7 }))],
    ["array name mismatch", arrayOutput(entry({ name: "other" }))],
    ["object name mismatch", objectOutput(entry({ name: "other" }), "other")],
    ["key and entry name differ", objectOutput(entry(), "other")],
  ];
  for (const [label, stdout] of malformed) {
    assert.throws(() => packedTarballName(stdout, NAME), Error, label);
  }
});

test("rejects tarball names that are not a plain .tgz file name", () => {
  for (const filename of [
    "",
    ".",
    "..",
    "../escape.tgz",
    "nested/name.tgz",
    "nested\\name.tgz",
    "/absolute.tgz",
    "C:\\absolute.tgz",
    "name.tar",
    "name\0.tgz",
  ]) {
    assert.throws(
      () => packedTarballName(objectOutput(entry({ filename })), NAME),
      /plain \.tgz file name/,
      JSON.stringify(filename),
    );
  }
});

test("resolves only a regular tarball file inside the pack destination", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "npm-pack-metadata-"));
  const outside = mkdtempSync(path.join(tmpdir(), "npm-pack-outside-"));
  try {
    assert.throws(
      () => resolvePackedTarball(destination, objectOutput(), NAME),
      Error,
      "missing tarball",
    );
    writeFileSync(path.join(destination, FILENAME), "synthetic tarball");
    assert.equal(
      resolvePackedTarball(destination, objectOutput(), NAME),
      path.join(destination, FILENAME),
    );

    const linked = "linked-1.0.0.tgz";
    writeFileSync(path.join(outside, linked), "outside");
    symlinkSync(path.join(outside, linked), path.join(destination, linked));
    assert.throws(
      () =>
        resolvePackedTarball(
          destination,
          objectOutput(entry({ filename: linked })),
          NAME,
        ),
      Error,
      "symlinked tarball",
    );
  } finally {
    rmSync(destination, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
