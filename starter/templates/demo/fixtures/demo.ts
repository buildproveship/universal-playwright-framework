import { createServer } from "node:http";
import { test as base, expect } from "@playwright/test";
import { DemoPage } from "../pages/demo-page.ts";

export const test = base.extend<{ demo: DemoPage }>({
  demo: async ({ page, context }, use) => {
    // Fixed owned fixture; no public website, customer inputs, credentials or generated code.
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/html",
        "cache-control": "no-store",
      });
      response.end(
        "<!doctype html><html><head><title>Owned synthetic demo</title></head><body><h1>ReleaseReady synthetic demo</h1><button onclick=\"document.querySelector('output').textContent='Confirmed'\">Confirm demo</button><output role=\"status\">Ready</output></body></html>",
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    let externalAttempt = false;
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Owned loopback fixture failed to bind");
      const origin = `http://127.0.0.1:${address.port}`;
      await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          externalAttempt = true;
          await route.abort("blockedbyclient");
        } else await route.continue();
      });
      await context.routeWebSocket("**/*", (socket) => {
        externalAttempt = true;
        socket.close();
      });
      await use(new DemoPage(page, origin));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      expect(
        externalAttempt,
        "Demo must not attempt non-fixture network access",
      ).toBe(false);
    }
  },
});
export { expect };
