/**
 * The single source for synthetic execution outcomes and bounds. Execution,
 * reporting and the v1/v2 adapters all read these values.
 */

export const EXECUTION_STATUSES = [
  "passed",
  "passed_after_retry",
  "failed",
  "incomplete",
  "timed_out",
  "cancelled",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const MAX_EXECUTION_SCENARIOS = 6;
export const MAX_CONCURRENT_SCENARIOS = 2;
export const MIN_TIMEOUT_MS = 50;
export const MAX_SCENARIO_TIMEOUT_MS = 60_000;
export const MAX_RUN_TIMEOUT_MS = 120_000;
export const MAX_EXECUTION_RETRIES = 2;
/** One first attempt plus at most MAX_EXECUTION_RETRIES retries. */
export const MAX_EXECUTION_ATTEMPTS = MAX_EXECUTION_RETRIES + 1;
export const MAX_CUCUMBER_REPORT_STEPS = 100;
