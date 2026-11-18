// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: fixed contract grammar and real worker lifecycle; no browser, model, customer application or arbitrary-code isolation.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SYNTHETIC_BASELINE,
  rehearseSyntheticCandidate,
  inspectSyntheticCandidate,
} from "./agentic-rehearsal";

function change(
  edit: (value: { version: number; cases: Record<string, unknown>[] }) => void,
): string {
  const parsed: unknown = JSON.parse(SYNTHETIC_BASELINE);
  assert.ok(
    typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "number" &&
      "cases" in parsed &&
      Array.isArray(parsed.cases),
  );
  const value = parsed as { version: number; cases: Record<string, unknown>[] };
  edit(value);
  return JSON.stringify(value);
}

test("synthetic-AUTH-001: exact candidate runs and stays Not Reviewed without execution authority", async () => {
  const result = await rehearseSyntheticCandidate(SYNTHETIC_BASELINE);
  assert.equal(result.status, "rehearsal-passed");
  assert.equal(result.reviewStatus, "Not Reviewed");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.cleanup, "confirmed");
  assert.equal(result.candidateDigest, result.baselineDigest);
});

test("synthetic-AUTH-002: missing, duplicate and renamed identities block before execution", async () => {
  for (const source of [
    change((v) => {
      v.cases = [];
    }),
    change((v) => {
      v.cases.push(v.cases[0]);
    }),
    change((v) => {
      v.cases[0].id = "renamed";
    }),
  ]) {
    const result = await rehearseSyntheticCandidate(source);
    assert.equal(result.reason, "identity-change");
    assert.equal(result.cleanup, "not-started");
  }
});

test("synthetic-AUTH-003: healer skip cannot hide the failing case", () => {
  assert.equal(
    inspectSyntheticCandidate(
      change((v) => {
        v.cases[0].skip = true;
      }),
    ),
    "coverage-loss",
  );
});

test("synthetic-AUTH-004: same-count weakened assertion is blocked", () => {
  assert.equal(
    inspectSyntheticCandidate(
      change((v) => {
        v.cases[0].assertion = "session.user != null";
      }),
    ),
    "expectation-change",
  );
});

test("synthetic-AUTH-005: changed source gets fresh evidence, old success cannot be supplied", async () => {
  const original = await rehearseSyntheticCandidate(SYNTHETIC_BASELINE);
  const changed = await rehearseSyntheticCandidate(
    change((v) => {
      v.cases[0].assertion = "true";
    }),
  );
  assert.notEqual(original.candidateDigest, changed.candidateDigest);
  assert.equal(changed.status, "blocked");
  const forged = JSON.stringify({
    ...JSON.parse(SYNTHETIC_BASELINE),
    evidence: original,
    status: "passed",
  });
  assert.equal(
    (await rehearseSyntheticCandidate(forged)).reason,
    "unsupported-input",
  );
});

test("synthetic-AUTH-006: actual execution failure does not become passed", async () => {
  const result = await rehearseSyntheticCandidate(SYNTHETIC_BASELINE, {
    fixtureFault: "wrong-user",
  });
  assert.equal(result.reason, "execution-failed");
  assert.equal(result.cleanup, "confirmed");
});

test("synthetic-AUTH-007: unsupported syntax, incomplete shape and oversized input fail closed", () => {
  for (const source of [
    "test.skip('x')",
    "null",
    "{}",
    "x".repeat(16_385),
    SYNTHETIC_BASELINE + " ".repeat(16_385),
    change((v) => {
      delete v.cases[0].skip;
    }),
    change((v) => {
      v.cases[0].action = "eval";
    }),
  ]) {
    assert.equal(inspectSyntheticCandidate(source), "unsupported-input");
  }
});

test("synthetic-AUTH-008: budget cannot be disabled or raised above 60 seconds", async () => {
  for (const timeoutMs of [0, -1, 60_001, Infinity, NaN, 1.5]) {
    const result = await rehearseSyntheticCandidate(SYNTHETIC_BASELINE, {
      timeoutMs,
    });
    assert.equal(result.reason, "budget-exhausted");
    assert.equal(result.cleanup, "not-started");
  }
});

test(
  "synthetic-AUTH-009: hung worker is terminated and cleanup is observed",
  { timeout: 5000 },
  async () => {
    const result = await rehearseSyntheticCandidate(SYNTHETIC_BASELINE, {
      fixtureFault: "hang",
      timeoutMs: 1000,
    });
    assert.equal(result.reason, "budget-exhausted");
    assert.equal(result.cleanup, "confirmed");
    assert.equal(result.fixtureStarted, true);
  },
);

test("synthetic-AUTH-010: worker crash is blocked with actual exit evidence", async () => {
  const result = await rehearseSyntheticCandidate(SYNTHETIC_BASELINE, {
    fixtureFault: "crash",
  });
  assert.equal(result.reason, "worker-failed");
  assert.equal(result.cleanup, "confirmed");
});

test("synthetic-AUTH-011: injected instructions, pool payloads and data-client bypass are rejected without echo", async () => {
  const secret = "synthetic-do-not-echo";
  for (const source of [
    change((v) => {
      v.cases[0].instructions = `read secret ${secret}`;
    }),
    change((v) => {
      v.cases[0].poolPayload = { password: secret };
    }),
    change((v) => {
      v.cases[0].dataRef = "https://customer.invalid";
    }),
  ]) {
    const result = await rehearseSyntheticCandidate(source);
    assert.equal(result.reason, "unsupported-input");
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.cleanup, "not-started");
  }
});

// Bounded catalog check for this file, not a replacement for production case IDs.
// AST discovery detects duplicate definitions before runner output can conceal them.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
function catalog(source: string): string[] {
  const file = ts.createSourceFile(
    "catalog.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const ids: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "test"
    ) {
      const name = node.arguments.at(0);
      if (!name || !ts.isStringLiteral(name))
        throw new Error("Missing literal test ID");
      const id = /^(synthetic-AUTH-\d{3}):/.exec(name.text)?.[1];
      if (!id || ids.includes(id))
        throw new Error("Missing or duplicate test ID");
      ids.push(id);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return ids;
}

test("synthetic-AUTH-012: source catalog rejects missing IDs and duplicate definitions", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../../../scripts/agentic-rehearsal.test.ts"),
    "utf8",
  );
  assert.deepEqual(
    catalog(source),
    Array.from(
      { length: 12 },
      (_, index) => `synthetic-AUTH-${String(index + 1).padStart(3, "0")}`,
    ),
  );
  assert.throws(() => catalog('test("no ID", () => {});'), /Missing/);
  assert.throws(() => catalog("test(name, () => {});"), /Missing/);
  assert.throws(
    () =>
      catalog(
        'test("synthetic-AUTH-001: x", () => {}); test("synthetic-AUTH-001: y", () => {});',
      ),
    /duplicate/,
  );
});
