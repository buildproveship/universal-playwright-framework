import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Runs a fixture script in a child Node process that sees only the path, home, temp and browser locations. */
export function runFixture(script: string, args: readonly string[] = []) {
  return exec(process.execPath, [script, ...args], {
    timeout: 30000,
    maxBuffer: 200000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    },
  });
}
