// Keys a lower layer may not change (design doc 6.4).
import type { Diagnostic } from "./check.js";

export interface LockedKey {
  /** Dotted config path, e.g. "intake.identity.google_login". */
  path: string;
  /** The only value allowed. */
  value: unknown;
  /** Why it is locked (Korean); goes into the V12 message. */
  reason: string;
}

/** One file's parsed data in the extends chain. */
export interface ConfigLayer {
  file: string;
  data: unknown;
}

/** The locked keys of design doc 6.4. */
export function lockedKeys(): LockedKey[] {
  throw new Error("not implemented: lockedKeys");
}

/** V12: every layer that sets a locked key to another value. */
export function checkLockedKeys(layers: readonly ConfigLayer[]): Diagnostic[] {
  throw new Error("not implemented: checkLockedKeys");
}
