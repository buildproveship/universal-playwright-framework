import assert from "node:assert/strict";
import type { FeatureValidation } from "../../src/validation/feature-validator";
import type { ScenarioApproval } from "../../src/validation/scenario-selector";

/** A synthetic approval of the scenarios `ids` at the validated feature's exact revisions. */
export function approvalFor(
  validation: Extract<FeatureValidation, { valid: true }>,
  ids: readonly string[],
): ScenarioApproval {
  return {
    featurePath: validation.featurePath,
    sourceRevision: validation.sourceRevision,
    featureRevision: validation.featureRevision,
    implementationRevision: validation.implementationRevision,
    scenarios: ids.map((id) => {
      const scenario = validation.scenarios.find((item) => item.id === id);
      assert.ok(scenario, `Expected synthetic scenario ${id}`);
      return { id, tags: [...scenario.tags] };
    }),
  };
}
