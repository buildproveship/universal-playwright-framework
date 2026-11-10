import type { APIResponse, Route } from "playwright-core";

/** Complete response preparation before consuming the route exactly once. */
export async function settleApprovedRoute(
  route: Pick<Route, "abort" | "fulfill"> & {
    fetch(
      options: Parameters<Route["fetch"]>[0],
    ): Promise<Pick<APIResponse, "status" | "headers" | "body" | "dispose">>;
  },
  recordRedirect: (location: string | undefined) => void,
): Promise<void> {
  let prepared: {
    status: number;
    headers: Record<string, string>;
    body?: Buffer;
  };
  try {
    const response = await route.fetch({ maxRedirects: 0 });
    const status = response.status();
    const headers = response.headers();
    const redirect = status >= 300 && status < 400;
    if (redirect) recordRedirect(headers.location);
    // Context shutdown disposes API responses. Do not leave a response UID for
    // fulfill to resolve after the route has already been claimed.
    const body = redirect ? undefined : await response.body();
    await response.dispose();
    prepared = { status, headers, body };
  } catch {
    await route.abort("failed");
    return;
  }
  // Terminal operations must remain outside the preparation catch: a failed
  // terminal operation must never be retried as a second abort.
  if (prepared.status >= 300 && prepared.status < 400) {
    await route.abort("blockedbyclient");
  } else {
    await route.fulfill(prepared);
  }
}
