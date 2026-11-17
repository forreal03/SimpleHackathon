// Bundles src/runtime into dist/runtime.gs.js: one IIFE that defines the global `SHK`, for the
// Apps Script server. Run directly (npm run build) or import buildRuntime() (the parity tests do).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RUNTIME_OUT = path.join(pkgDir, "dist", "runtime.gs.js");

/** Builds the bundle and returns its text. With `write: false` nothing is written to disk. */
export async function buildRuntime({ write = true } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const result = await build({
    entryPoints: [path.join(pkgDir, "src", "runtime", "index.ts")],
    outfile: RUNTIME_OUT,
    bundle: true,
    format: "iife",
    globalName: "SHK",
    target: "es2019",
    platform: "neutral",
    banner: { js: `// ${pkg.name} runtime v${pkg.version}. Generated from src/runtime by scripts/build-runtime.mjs; do not edit.` },
    write: false,
    logLevel: "warning",
  });
  const text = result.outputFiles[0].text;
  if (write) {
    mkdirSync(path.dirname(RUNTIME_OUT), { recursive: true });
    writeFileSync(RUNTIME_OUT, text);
  }
  return text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildRuntime();
  console.log(`built ${path.relative(process.cwd(), RUNTIME_OUT)}`);
}
