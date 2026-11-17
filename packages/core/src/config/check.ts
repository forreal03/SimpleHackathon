// Validation rules V1–V15 (design doc 7).
import type { SourceFile } from "./load.js";
import type { ResolvedConfig } from "./schema.js";

export type Severity = "error" | "warning" | "info";

/** One finding. `path` is a dotted config path ("scoring.formula"); `message` is Korean. */
export interface Diagnostic {
  /** Rule id, e.g. "V4". */
  id: string;
  severity: Severity;
  path: string;
  message: string;
}

export interface CheckContext {
  /** Raw text of every file in the extends chain (V8 scans it for secrets). */
  files: SourceFile[];
}

/** Runs every rule; any `error` means the config must not be built. */
export function checkConfig(resolved: ResolvedConfig, ctx: CheckContext): Diagnostic[] {
  throw new Error("not implemented: checkConfig");
}
