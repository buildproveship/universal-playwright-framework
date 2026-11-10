import assert from "node:assert/strict";
import { test } from "node:test";
import type { Route } from "playwright-core";
import { settleApprovedRoute } from "../src/execution/guarded-route";

function fixture(
  options: {
    status?: number;
    failure?: "fetch" | "body" | "dispose" | "fulfill" | "abort";
  } = {},
) {
  const events: string[] = [];
  const failure = new Error("synthetic operation failure");
  let fulfilled: Parameters<Route["fulfill"]>[0];
  const response = {
    status: () => options.status ?? 200,
    headers: () => ({ location: "/blocked", "content-type": "text/plain" }),
    body: async () => {
      events.push("body");
      if (options.failure === "body") throw failure;
      return Buffer.from("synthetic");
    },
    dispose: async () => {
      events.push("dispose");
      if (options.failure === "dispose") throw failure;
    },
  };
  const route = {
    fetch: async (input: Parameters<Route["fetch"]>[0]) => {
      assert.deepEqual(input, { maxRedirects: 0 });
      events.push("fetch");
      if (options.failure === "fetch") throw failure;
      return response;
    },
    abort: async (reason?: string) => {
      events.push(`abort:${reason}`);
      if (options.failure === "abort") throw failure;
    },
    fulfill: async (input: Parameters<Route["fulfill"]>[0]) => {
      events.push("fulfill");
      fulfilled = input;
      if (options.failure === "fulfill") throw failure;
    },
  };
  return { route, events, failure, fulfilled: () => fulfilled };
}

test("An allowed response is materialized and released before a single fulfillment", async () => {
  const f = fixture();
  await settleApprovedRoute(f.route, () => assert.fail("not a redirect"));
  assert.deepEqual(f.events, ["fetch", "body", "dispose", "fulfill"]);
  assert.equal(f.fulfilled()?.body?.toString(), "synthetic");
  assert.equal(f.fulfilled()?.status, 200);
  assert.equal(f.fulfilled()?.response, undefined);
});
for (const phase of ["fetch", "body", "dispose"] as const) {
  test(`A ${phase} failure aborts an unconsumed route exactly once`, async () => {
    const f = fixture({ failure: phase });
    await settleApprovedRoute(f.route, () => {});
    assert.equal(f.events.filter((x) => x.startsWith("abort:")).length, 1);
    assert.equal(f.events.at(-1), "abort:failed");
    assert.equal(f.fulfilled(), undefined);
  });
}
test("A redirect disposal racing context shutdown never double-aborts", async () => {
  const f = fixture({ status: 302, failure: "dispose" });
  const redirects: (string | undefined)[] = [];
  await settleApprovedRoute(f.route, (location) => redirects.push(location));
  assert.deepEqual(f.events, ["fetch", "dispose", "abort:failed"]);
  assert.deepEqual(redirects, ["/blocked"]);
});
test("Redirects are blocked without following or fulfilling them", async () => {
  const f = fixture({ status: 302 });
  await settleApprovedRoute(f.route, () => {});
  assert.deepEqual(f.events, ["fetch", "dispose", "abort:blockedbyclient"]);
});
for (const terminal of ["fulfill", "abort"] as const) {
  test(`A failed terminal ${terminal} remains visible and is never retried`, async () => {
    const f = fixture({
      status: terminal === "abort" ? 302 : 200,
      failure: terminal,
    });
    await assert.rejects(
      settleApprovedRoute(f.route, () => {}),
      (error) => error === f.failure,
    );
    assert.equal(
      f.events.filter((x) => x === "fulfill" || x.startsWith("abort:")).length,
      1,
    );
  });
}
