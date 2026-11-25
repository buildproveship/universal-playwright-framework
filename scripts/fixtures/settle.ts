/** Runs `work` with async-function semantics: a synchronous throw becomes a rejection. */
export function settle<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(work());
  });
}
