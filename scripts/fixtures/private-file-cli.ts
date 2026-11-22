// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Child-process fixture that runs the partay-login CLI with mocked file and prompt access to prove the deferred private-account-file flag reads nothing; no customer login.
// Default import binds the live CommonJS module object, so the mock below is
// visible to the CLI under test (a namespace import would be a copy).
import fs from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mock } from "node:test";
import { parseArgs } from "node:util";
// A compiled ES module namespace is the live exports object, so mocks apply.
import * as partay from "../../src/customer-login/partay";

const [file] = parseArgs({ allowPositionals: true }).positionals;
if (!file) throw new Error("Expected an owned synthetic fixture path");

const protectedPaths = new Set(["descriptor", "request", file]);
const originalReadFileSync = fs.readFileSync;
let referenceReads = 0;
mock.method(
  fs,
  "readFileSync",
  (
    path: fs.PathOrFileDescriptor,
    options?: Parameters<typeof fs.readFileSync>[1],
  ) => {
    if (protectedPaths.has(String(path))) referenceReads += 1;
    if (path === "descriptor" || path === "request") return "{}";
    return originalReadFileSync(path, options);
  },
);

let promptCalls = 0;
let fileCalls = 0;
mock.method(partay, "promptAndVerifyPartayLogin", () => {
  promptCalls += 1;
  return Promise.reject(new Error("Unexpected prompt dispatch"));
});
mock.method(partay, "privateFileAndVerifyPartayLogin", () => {
  fileCalls += 1;
  return Promise.reject(new Error("Unexpected file dispatch"));
});

process.argv = [
  process.execPath,
  "owned-cli",
  "descriptor",
  "request",
  "--private-account-file",
  file,
];
// Load the CLI synchronously after the mocks above are installed.
createRequire(__filename)(join(__dirname, "../verify-partay-login.js"));
process.stdout.write(
  JSON.stringify({ referenceReads, promptCalls, fileCalls }),
);
