import type { Readable, Writable } from "node:stream";
import type { PreparedInputDescriptor } from ".";
import {
  RuntimeLoginError,
  type RuntimeLoginAccount,
  type RuntimeLoginRequest,
  type RuntimeLoginResult,
} from "./runtime-login";

export interface OperatorTerminalInput extends Readable {
  readonly isTTY: boolean;
  readonly isRaw: boolean;
  setRawMode(mode: boolean): unknown;
}

export interface OperatorTerminalOutput extends Writable {
  readonly isTTY: boolean;
}

/** P13 / RRDPLAT-39: inherited-terminal capture is disabled in every environment.
 * Keep the public signature for callers; D15 must supply a separately reviewed
 * secure capture surface. Never inspect input, switch terminal mode, or fall back.
 * The independent in-process provider/consumer contract remains available.
 */
export function withOperatorLoginInputs(
  _descriptor: PreparedInputDescriptor,
  _request: RuntimeLoginRequest,
  _consume: (account: RuntimeLoginAccount) => Promise<void>,
  _options: {
    readonly input?: OperatorTerminalInput;
    readonly output?: OperatorTerminalOutput;
    readonly signal?: AbortSignal;
  } = {},
): Promise<RuntimeLoginResult> {
  return Promise.reject(new RuntimeLoginError("runtime-input-unavailable"));
}
