/**
 * What a value typed `T` may really hold when it comes from an untyped JavaScript caller, a parsed file or IPC:
 * any level may be missing or null and every leaf is `unknown`. Assign the typed value to this view before a
 * defensive runtime check, so the check reads honestly and the type checker keeps it.
 */
export type UntrustedShape<T> = T extends object
  ? UntrustedFields<T> | null | undefined
  : T extends null | undefined
    ? null | undefined
    : unknown;

/** Every field optional and untrusted; a list stays a list (homomorphic mapped type). */
export type UntrustedFields<T> = {
  readonly [K in keyof T]?: UntrustedShape<T[K]>;
};

/**
 * The same value seen as {@link UntrustedShape}. A function rather than an annotated `const`, because TypeScript
 * narrows an annotated `const` back to the assigned value's type.
 */
export function untrusted<T>(value: T): UntrustedShape<T> {
  return value as UntrustedShape<T>;
}

/** `Array.isArray` for an {@link UntrustedShape} list, keeping its element type instead of `any[]`. */
export function isList<T>(
  value: readonly T[] | null | undefined,
): value is readonly T[] {
  return Array.isArray(value);
}
