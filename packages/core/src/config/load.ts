// Reading YAML files and resolving `extends` (design doc 6.2).
import type { Diagnostic } from "./check.js";
import type { ResolvedConfig } from "./schema.js";

/** A file read while loading, with its raw text. */
export interface SourceFile {
  path: string;
  text: string;
}

export interface LoadOptions {
  /** Folder holding `profiles/` (and `events/`). Default: inferred from `<home>/events/<id>/event.yaml`. */
  home?: string;
}

export interface LoadResult {
  /** Null when loading failed; `diagnostics` says why. */
  config: ResolvedConfig | null;
  /** Every file read, the entry file first. */
  files: SourceFile[];
  /** V13 (extends) and schema problems. */
  diagnostics: Diagnostic[];
}

/** Loads an event (or profile) file and merges its `extends` chain, parents first. */
export function loadConfig(file: string, options?: LoadOptions): LoadResult {
  throw new Error("not implemented: loadConfig");
}
