/**
 * Test doubles for Playwright and Node objects.
 *
 * Checked before writing this: neither Playwright nor Node ships a test-double
 * builder, and `@typescript-eslint/no-unsafe-type-assertion` flags every
 * assertion, so it cannot tell this one from a bad one. The one assertion lives
 * here. A fake may only name members that exist on `T` (excess-property check);
 * member signatures are deliberately not checked, because fakes return
 * smaller objects than the real API. `eslint.config.mts` bans `as unknown as`
 * everywhere else.
 */
export function fake<T extends object>(members: {
  [K in keyof T]?: unknown;
}): T {
  return members as T;
}
