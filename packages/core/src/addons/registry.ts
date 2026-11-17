// Modules and add-ons with their dependencies (design doc 5).
import type { z } from "zod";

/** Built-in parts, on by default. */
export type ModuleId = "apply" | "submit" | "judge";

/** `planned` add-ons are listed but cannot be enabled yet. */
export type AddonStatus = "available" | "planned";

export interface AddonDef {
  id: string;
  /** Korean display name, e.g. "인기투표". */
  name: string;
  /** Modules that must be on, and top-level config sections that must exist (e.g. "github"). */
  requires: { modules: ModuleId[]; config: string[] };
  /** What turning it on adds (Korean, for check output and the MCP plan). */
  adds: string;
  status: AddonStatus;
  /** Option schema; parsing `{}` gives the defaults. */
  options: z.ZodType;
}

/** Every add-on of design doc 5.2, in table order. */
export function listAddons(): AddonDef[] {
  throw new Error("not implemented: listAddons");
}

/** The add-on with this id, or undefined for an unknown id. */
export function findAddon(id: string): AddonDef | undefined {
  throw new Error("not implemented: findAddon");
}
