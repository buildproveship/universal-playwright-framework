import assert from "node:assert/strict";
import { createServer, type RequestListener, type Server } from "node:http";

// Platform only: node:http already provides listen and closeAllConnections.
// These two helpers are the one place tests start and stop a loopback server.
export async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/`;
}

export async function closeLoopbackServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
}

export async function withLoopbackServer(
  handler: RequestListener,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  const url = await listenOnLoopback(server);
  try {
    await run(url);
  } finally {
    await closeLoopbackServer(server);
  }
}
