import type { PreparedInputDescriptor } from ".";
import type {
  RuntimeLoginAccount,
  RuntimeLoginRequest,
  RuntimeLoginResult,
} from "./runtime-login";

export const PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE =
  "Private account-file input is deferred and excluded from the MVP.";

export class PrivateFileLoginDeferredError extends Error {
  constructor() {
    super(PRIVATE_FILE_LOGIN_DEFERRED_MESSAGE);
    this.name = "PrivateFileLoginDeferredError";
  }
}

export function withPrivateFileLoginInputs(
  _descriptor: PreparedInputDescriptor,
  _request: RuntimeLoginRequest,
  _filePath: string,
  _repositoryRoot: string,
  _consume: (account: RuntimeLoginAccount) => Promise<void>,
): Promise<RuntimeLoginResult> {
  return Promise.reject(new PrivateFileLoginDeferredError());
}
