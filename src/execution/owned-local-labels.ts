/**
 * The product copy the shared owned-local sign-in steps look for. This is the
 * only module that may carry product wording; steps read the labels from here
 * or from the labels the consumer passes in `target.labels`.
 */
export interface OwnedLocalLabels {
  /** Accessible name of the button that opens account registration. */
  readonly registerButton: string;
  /** Accessible name of the registration page heading. */
  readonly registerHeading: string;
  /** Accessible name of the sign-in page heading. */
  readonly signInHeading: string;
}

/** The 2.0.0 wording, kept so callers that pass no labels behave as before. */
export const DEFAULT_OWNED_LOCAL_LABELS: OwnedLocalLabels = {
  registerButton: "New here? Create your ReleaseReady account",
  registerHeading: "Create your account",
  signInHeading: "Sign in to ReleaseReady",
};

export const OWNED_LOCAL_LABEL_MAX_LENGTH = 200;

export function resolveOwnedLocalLabels(
  override: Partial<OwnedLocalLabels> | undefined,
): OwnedLocalLabels {
  return { ...DEFAULT_OWNED_LOCAL_LABELS, ...override };
}
