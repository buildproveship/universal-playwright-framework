// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Shared synthetic owned-local v2 request for the adapter tests; it exercises no behaviour itself.
import {
  getOwnedLocalReview,
  type OwnedLocalRequest,
} from "../../src/adapter/v2";

/** A reviewed owned-local request for the synthetic target at `origin`. */
export async function requestFor(
  origin = "http://127.0.0.1:34567",
  labels?: NonNullable<OwnedLocalRequest["target"]["labels"]>,
): Promise<OwnedLocalRequest> {
  const review = await getOwnedLocalReview();
  return {
    version: 2,
    run: { id: "synthetic-run", gitRevision: "a".repeat(40) },
    target: {
      kind: "owned-local",
      id: "synthetic-target",
      origin,
      ...(labels ? { labels } : {}),
    },
    scenarioIds: ["local-demo-navigation"],
    binding: {
      tenantId: "synthetic-tenant",
      projectId: "synthetic-project",
      environmentId: "synthetic-dev",
      caseId: "synthetic-case",
      caseRevision: 1,
      caseSourceHash: "b".repeat(64),
      dataRevision: "c".repeat(64),
      configurationRevision: "d".repeat(64),
      implementationRevision: review.approval.implementationRevision,
      approvalId: "synthetic-approval",
      attempt: 1,
    },
    ...review,
    limits: {
      runTimeoutMs: 20000,
      scenarioTimeoutMs: 15000,
      maxConcurrentScenarios: 1,
      retryCount: 0,
    },
  };
}
