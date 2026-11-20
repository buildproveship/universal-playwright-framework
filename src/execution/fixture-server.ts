// Loopback fixture server for the owned-synthetic scenarios, and the fixture input it serves.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { INPUT_FIXTURE_PATH, REPOSITORY_ROOT } from "./reviewed-scenarios";

interface FixtureDocument {
  readonly environment: {
    approvedOrigin: string;
    initialTargetUrl: string;
  };
  accounts: { reference: string }[];
  scenarios: { id: string; accountReference: string }[];
}

export function makeFixtureInput(
  selectedIds: readonly string[],
  approvedOrigin: string,
): string {
  const input = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, INPUT_FIXTURE_PATH), "utf8"),
  ) as FixtureDocument & Record<string, unknown>;
  input.environment.approvedOrigin = approvedOrigin;
  input.environment.initialTargetUrl = `${approvedOrigin}/demo`;
  const selected = new Set(selectedIds);
  const selectedScenarios = input.scenarios.filter((scenario) =>
    selected.has(scenario.id),
  );
  const accountReferences = new Set(
    selectedScenarios.map((scenario) => scenario.accountReference),
  );
  input.scenarios = selectedScenarios;
  input.accounts = input.accounts.filter((account) =>
    accountReferences.has(account.reference),
  );
  return JSON.stringify(input);
}

export async function startFixtureServer(): Promise<{
  readonly server: Server;
  readonly sockets: Set<Socket>;
  readonly origin: string;
  readonly redirectServer: Server;
  readonly redirectSockets: Set<Socket>;
  readonly redirectTargetUrl: string;
  readonly blockedTargetRequestCount: () => number;
}> {
  let blockedTargetRequestCount = 0;
  const redirectServer = createServer((_request, response) => {
    blockedTargetRequestCount += 1;
    response.writeHead(200).end();
  });
  const redirectSockets = new Set<Socket>();
  redirectServer.on("connection", (socket) => {
    redirectSockets.add(socket);
    socket.once("close", () => redirectSockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    redirectServer.once("error", reject);
    redirectServer.listen(0, "127.0.0.1", resolve);
  });
  const redirectAddress = redirectServer.address();
  if (!redirectAddress || typeof redirectAddress === "string") {
    throw new Error("Owned redirect-destination server did not start");
  }
  const redirectTargetUrl = `http://127.0.0.1:${redirectAddress.port}/blocked`;
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: redirectTargetUrl }).end();
      return;
    }
    if (request.url !== "/demo") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html lang="en">
        <head><title>Reviewed synthetic page</title></head>
        <body>
          <label>Display name <input aria-label="Display name"></label>
          <button type="button">Continue</button>
          <p role="status">Waiting</p>
          <script>
            document.querySelector('button').addEventListener('click', () => {
              const name = document.querySelector('input').value;
              document.querySelector('[role="status"]').textContent = 'Welcome, ' + name;
            });
          </script>
        </body>
      </html>`);
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Owned synthetic server did not start");
    }
    return {
      server,
      sockets,
      origin: `http://127.0.0.1:${address.port}`,
      redirectServer,
      redirectSockets,
      redirectTargetUrl,
      blockedTargetRequestCount: () => blockedTargetRequestCount,
    };
  } catch (error) {
    await closeServer(redirectServer, redirectSockets);
    throw error;
  }
}

export function closeServer(
  server: Server | undefined,
  sockets: ReadonlySet<Socket>,
  ignoreCallback = false,
): Promise<{ readonly closed: boolean }> {
  if (!server) {
    return Promise.resolve({ closed: true });
  }
  return new Promise((resolve) => {
    let settled = false;
    let injectedTimer: ReturnType<typeof setTimeout> | undefined;
    const forcedClose: { timer?: ReturnType<typeof setTimeout> } = {};
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (closed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const timer of [injectedTimer, forcedClose.timer, finalTimer]) {
        if (timer) {
          clearTimeout(timer);
        }
      }
      resolve({ closed });
    };
    const verifyStopped = (): boolean =>
      !server.listening && sockets.size === 0;
    const initiateClose = (observeCallback: boolean): void => {
      if (!server.listening) {
        if (verifyStopped()) {
          finish(true);
        }
        return;
      }
      server.close((error) => {
        if (observeCallback) {
          if (!error && verifyStopped()) {
            finish(true);
          }
        }
      });
    };
    if (ignoreCallback) {
      initiateClose(false);
      injectedTimer = setTimeout(() => {
        if (verifyStopped()) {
          finish(true);
        }
      }, 200);
    } else {
      initiateClose(true);
    }
    forcedClose.timer = setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (server.listening) {
        initiateClose(true);
      }
      finalTimer = setTimeout(() => {
        finish(verifyStopped());
      }, 500);
    }, 1_000);
  });
}
