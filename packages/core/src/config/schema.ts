// zod schemas for config v2 files (design doc 6.1). Placeholder: only the top-level keys every
// file kind shares; the full event / profile / preset schemas replace it.
import { z } from "zod";

export const CONFIG_KINDS = ["event", "profile", "preset"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/** One YAML file as written: `schema: 2`, its kind and what it extends; other sections pass through. */
export const ConfigFileSchema = z.looseObject({
  schema: z.literal(2),
  kind: z.enum(CONFIG_KINDS),
  extends: z.union([z.string(), z.array(z.string())]).optional(),
});
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** An event config with every `extends` merged in and defaults applied; what check and build take. */
export type ResolvedConfig = ConfigFile;
