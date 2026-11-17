// Copies the bundled preset YAML (src/config/presets) next to the compiled loader, so dist/ works
// on its own. The copies are build output.
import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
cpSync(path.join(pkg, "src", "config", "presets"), path.join(pkg, "dist", "config", "presets"), { recursive: true });
console.log("copied src/config/presets into dist/config/presets");
