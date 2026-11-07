import { errors } from "playwright-core";
import { z } from "zod";

/** Value-free observations only; categories do not identify a root cause. */
export const cleanupDiagnosticsSchema = z
  .array(
    z
      .object({
        phase: z.enum(["context-close", "browser-close"]),
        category: z.enum(["playwright-timeout", "unclassified"]),
      })
      .strict(),
  )
  .max(2)
  .refine(
    (items) => new Set(items.map((item) => item.phase)).size === items.length,
  );

export type CleanupDiagnostic = z.infer<
  typeof cleanupDiagnosticsSchema
>[number];

export function classifyCleanupError(
  phase: CleanupDiagnostic["phase"],
  error: unknown,
): CleanupDiagnostic {
  // Never read name, message, stack, code, cause or arbitrary properties.
  // A proxy can throw during instanceof; it must not replace the close error.
  try {
    if (error instanceof errors.TimeoutError) {
      return { phase, category: "playwright-timeout" };
    }
  } catch {
    // Unrecognized identities (including cross-realm errors) remain unclassified.
  }
  return { phase, category: "unclassified" };
}
