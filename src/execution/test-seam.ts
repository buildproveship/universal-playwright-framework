/**
 * Test-only fault-injection seam for `executeReviewedScenarios`.
 *
 * Production callers (adapter v1/v2) never pass it. Injected faults are not
 * reported in any result: tests observe their real effect (cleanup status,
 * failures, retry attempts) instead of a flag on the published result.
 */
export interface ExecutionTestSeam {
  readonly cleanupFailure?:
    "context" | "server-pending" | "worker-stall" | "browser-state-unknown";
  readonly assertionMismatchAttempts?: readonly number[];
  readonly now?: () => number;
  readonly onAttemptCleanupStarted?: () => void;
}
