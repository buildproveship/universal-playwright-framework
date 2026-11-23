import { z } from "zod";

// The one definition of the reference primitive in this repository. test-management owns the contract
// (`@buildproveship/test-management/schema/v1`), but this package does not depend on it, so the definition lives
// here and every module imports it.
export const referenceSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
