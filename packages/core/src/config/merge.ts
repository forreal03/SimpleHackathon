// Merge rules for config layers (design doc 6.3).

/**
 * Merges `over` onto `base`: null deletes, objects merge per key, keyed lists take a replacement
 * array or `{ add, remove, update }`, other arrays take a replacement or `{ append }`, everything
 * else is replaced. `path` is where the two values sit in the config (it decides which lists are
 * keyed). Neither input is modified.
 */
export function merge(base: unknown, over: unknown, path: readonly string[] = []): unknown {
  throw new Error("not implemented: merge");
}
