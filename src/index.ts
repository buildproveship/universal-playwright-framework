/**
 * Root entry point of @universal/playwright-framework.
 */

// Optional page-object base classes
export { BasePage } from "./pages/base-page";
export { BaseComponent } from "./components/base-component";

export { executeAdapter } from "./adapter/v1";
export type {
  AdapterRequest,
  AdapterResult,
  AdapterError,
  TrustedAdapterContext,
} from "./adapter/v1";

// Keep root compatibility while maintaining runtime-login exports in one place.
export * from "./runtime-login/v1";
export type {
  ReviewedDataReferenceInput,
  ReviewedFixtureFieldPolicy,
} from "./input-preparation";
export {
  prepareScenarioInputs,
  InputPreparationError,
} from "./input-preparation";

// Public offline review boundary; validation never grants execution permission.
export { validateFeatureFile } from "./validation/feature-validator";
export type {
  FeatureValidation,
  ReviewedStepManifest,
  ValidateFeatureInput,
} from "./validation/feature-validator";
export type { ScenarioApproval } from "./validation/scenario-selector";

export { waitForVisible } from "./readiness/wait-for-visible";
