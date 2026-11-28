/** Restores test data after every scenario, whether it passed or failed.
 * The restorer is injected (structurally typed) so the framework does not depend on a particular
 * client; the API framework `test-data-restore/v1` `createRestoreClient` fits it.
 * The client itself refuses any environment except Dev and UAT.
 */
export interface ScenarioRestorer {
  restoreAll(): Promise<void>;
}

export interface RestoreAfterScenarioOptions {
  readonly restorer: ScenarioRestorer;
  /** Reports a restore failure; the failure is also thrown so the scenario fails visibly. */
  readonly onFailure?: (error: unknown) => void;
}

/** Cucumber `After` body: pass it to `After(...)`. A failed restore fails the scenario, because the
 * next test would otherwise run against changed data. */
export function restoreAfterScenario(
  options: RestoreAfterScenarioOptions,
): () => Promise<void> {
  return async () => {
    try {
      await options.restorer.restoreAll();
    } catch (error) {
      options.onFailure?.(error);
      throw new Error("Test data restore failed after the scenario", {
        cause: error,
      });
    }
  };
}

/** Restore settings from the environment, or undefined when restore is switched off.
 * `BPS_TEST_DATA_RESTORE=off` is the only way to switch it off, and only outside CI. */
export function readRestoreSettings(
  env: Readonly<Record<string, string | undefined>>,
):
  | {
      readonly environment: string;
      readonly baseUrl: string;
      readonly token: string;
      readonly mailpitUrl?: string;
    }
  | undefined {
  if (env.BPS_TEST_DATA_RESTORE === "off") {
    if (env.CI) {
      throw new Error("Test data restore cannot be switched off in CI");
    }
    return undefined;
  }
  const { BPS_ENVIRONMENT, BPS_RESTORE_URL, BPS_RESTORE_TOKEN } = env;
  if (!BPS_ENVIRONMENT || !BPS_RESTORE_URL || !BPS_RESTORE_TOKEN) {
    throw new Error(
      "Test data restore needs BPS_ENVIRONMENT, BPS_RESTORE_URL and BPS_RESTORE_TOKEN (or BPS_TEST_DATA_RESTORE=off outside CI)",
    );
  }
  return {
    environment: BPS_ENVIRONMENT,
    baseUrl: BPS_RESTORE_URL,
    token: BPS_RESTORE_TOKEN,
    mailpitUrl: env.BPS_MAILPIT_URL,
  };
}
