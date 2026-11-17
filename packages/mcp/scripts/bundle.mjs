// Bundles the server into one ESM file, dist/index.js, with every npm library it uses inside, so the
// published package has no runtime dependencies (SPEC 13.3, D1). Node built-ins stay imports.
//
//   node scripts/bundle.mjs            writes dist/index.js and build/metafile.json
//   node scripts/bundle.mjs --compare  prints raw and gzip sizes of the minify options, writes nothing
//
// build/metafile.json is esbuild's record of every file that went into the bundle. scripts/third-party.mjs
// turns it into THIRD_PARTY_LICENSES and dist/sbom.cdx.json, and scripts/check-package.mjs checks both
// against it. build/ is not published.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(pkgDir, "dist", "index.js");
const METAFILE = path.join(pkgDir, "build", "metafile.json");

// ESM has no `require`, but the CommonJS libraries in the bundle (ajv, google-auth-library, ...) call it
// for Node built-ins. The alias keeps clear of a `createRequire` that bundled code imports itself.
const BANNER = [
  'import { createRequire as __bundleCreateRequire } from "node:module";',
  "const require = __bundleCreateRequire(import.meta.url);",
].join("\n");

const VARIANTS = {
  "no minify": {},
  minify: { minify: true },
  "minify + keepNames": { minify: true, keepNames: true },
};
// keepNames keeps function and class names (stack traces, error names). It cost about 5% over plain minify
// when chosen (2026-11-17); the rule was to drop it above 15%. --compare shows the current numbers.
const CHOSEN = "minify + keepNames";

function options(variant) {
  return {
    absWorkingDir: pkgDir,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // Built-ins with and without the node: prefix (node:sqlite only exists with it).
    external: ["node:*", ...builtinModules],
    // esbuild keeps the entry's `#!/usr/bin/env node` as the first line, above the banner.
    banner: { js: BANNER },
    charset: "utf8",
    legalComments: "eof",
    metafile: true,
    write: false,
    logLevel: "warning",
    // A require() or import() whose argument is not a string literal stays a runtime lookup that the bundle
    // cannot satisfy. esbuild reports one inside node_modules, where all the third-party code is, only at
    // debug level; raise it to a warning so the check in bundle() fails the build.
    logOverride: { "unsupported-require-call": "warning", "unsupported-dynamic-import": "warning" },
    ...VARIANTS[variant],
  };
}

async function bundle(variant) {
  const result = await build(options(variant));
  // A warning (say, a require() esbuild cannot follow) usually means the bundle would need a file at runtime.
  if (result.warnings.length > 0) throw new Error(`esbuild gave ${result.warnings.length} warning(s); see above`);
  const [out] = result.outputFiles;
  return { contents: out.contents, metafile: result.metafile, gzip: gzipSync(out.contents).length };
}

const fmt = (n) => n.toLocaleString("en-US");

if (process.argv.includes("--compare")) {
  const rows = [];
  for (const variant of Object.keys(VARIANTS)) {
    const { contents, gzip } = await bundle(variant);
    rows.push({ variant, raw: contents.length, gzip });
  }
  const base = rows.find((r) => r.variant === "minify");
  const pct = (a, b) => `${a >= b ? "+" : ""}${((a / b - 1) * 100).toFixed(1)}%`;
  for (const r of rows) {
    const vs = r === base ? "" : `  (${pct(r.raw, base.raw)} raw, ${pct(r.gzip, base.gzip)} gzip vs minify)`;
    console.log(`${r.variant.padEnd(20)} ${fmt(r.raw).padStart(10)} B raw ${fmt(r.gzip).padStart(9)} B gzip${vs}${r.variant === CHOSEN ? "  <- used" : ""}`);
  }
} else {
  const { contents, metafile, gzip } = await bundle(CHOSEN);
  // Everything in dist/ is published ("files" in package.json), so start from an empty folder.
  rmSync(path.dirname(BUNDLE), { recursive: true, force: true });
  mkdirSync(path.dirname(BUNDLE), { recursive: true });
  writeFileSync(BUNDLE, contents);
  mkdirSync(path.dirname(METAFILE), { recursive: true });
  writeFileSync(METAFILE, JSON.stringify(metafile, null, 1) + "\n");
  console.log(`bundled dist/index.js: ${fmt(contents.length)} B, gzip ${fmt(gzip)} B (${CHOSEN})`);
}
