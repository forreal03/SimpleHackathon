// Public event.json for the site and the server (design doc 8.1).
import type { ResolvedConfig } from "../config/schema.js";

/** Placeholder shape: the fixed keys of design doc 8.1; the sections are defined with the builder. */
export interface EventJson {
  schema: 2;
  kit: { version: string };
  /** First 16 hex chars of the sha256 of the normalized JSON. */
  config_hash: string;
  [section: string]: unknown;
}

/** Builds the public JSON: drops roster, github, repo, reviewers, app_policy and other staff-only values. */
export function buildEventJson(resolved: ResolvedConfig): EventJson {
  throw new Error("not implemented: buildEventJson");
}
