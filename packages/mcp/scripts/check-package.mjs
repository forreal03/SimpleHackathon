// Checks what npm would publish (SPEC 13.4, LEAN-8). `npm run smoke` runs it after `npm run build`, so CI
// fails when the package gets runtime dependencies, an oversized bundle, stray files or a gap in the
// licenses:
//   1. package.json has no dependencies field (nor optional, peer or bundled ones)
//   2. dist/index.js exists, starts with the hashbang and is within the size budget
//   3. the bundle loads nothing but Node built-ins
//   4. `npm pack --dry-run` lists exactly the expected files
//   5. THIRD_PARTY_LICENSES and dist/sbom.cdx.json cover exactly the npm packages in the bundle's metafile
//   6. the READMEs pin this package's version in their npx examples
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { bundledPackages, licensedIds, LICENSES, METAFILE, purl, SBOM } from "./third-party.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(pkgDir, "dist", "index.js");

// D1 budget. D2 (SDK v2 and a fetch-based GitHub client, SPEC 13.3) tightens this to 1 MB.
const MAX_BUNDLE_BYTES = 1_600_000;
// Every file of the tarball. Adding one is a decision: change this list with it.
const PACKED_FILES = [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_LICENSES",
  "config/.env.example",
  "config/app-policy.yaml",
  "config/event.example.yaml",
  "config/team-readme.template.md",
  "dist/index.js",
  "dist/sbom.cdx.json",
  "package.json",
];
// Non-built-in modules the bundle may still require() at runtime. Each must be optional: loaded in a
// try block and left out of the package on purpose.
const OPTIONAL_REQUIRES = new Set([
  "supports-color", // debug's 256-colour support; debug falls back to basic colours without it
]);

const failures = [];
const fail = (msg) => failures.push(msg);
const fmt = (n) => n.toLocaleString("en-US");
const diff = (actual, expected) => ({
  missing: expected.filter((x) => !actual.includes(x)),
  extra: actual.filter((x) => !expected.includes(x)),
});

// 1. No runtime dependencies: everything the server needs is in dist/index.js.
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
  if (field in pkg) fail(`package.json has "${field}"; the published package must have no runtime dependencies`);
}

// 2. The bundle: present, starts with the hashbang (it is the bin), within budget, and matches the metafile.
let metafile;
if (!existsSync(BUNDLE) || !existsSync(METAFILE)) {
  fail("dist/index.js or build/metafile.json is missing; run npm run build first");
} else {
  const bundle = readFileSync(BUNDLE);
  metafile = JSON.parse(readFileSync(METAFILE, "utf8"));
  if (!bundle.subarray(0, 20).toString("utf8").startsWith("#!/usr/bin/env node\n")) fail("dist/index.js does not start with #!/usr/bin/env node");
  if (bundle.length > MAX_BUNDLE_BYTES) fail(`dist/index.js is ${fmt(bundle.length)} B, over the ${fmt(MAX_BUNDLE_BYTES)} B budget`);
  if (metafile.outputs["dist/index.js"]?.bytes !== bundle.length) fail("build/metafile.json does not describe this dist/index.js; run npm run build");
  console.log(`bundle: dist/index.js ${fmt(bundle.length)} B (budget ${fmt(MAX_BUNDLE_BYTES)} B), gzip ${fmt(gzipSync(bundle).length)} B`);

  // 3. The bundle imports nothing but Node built-ins (and the optional requires above).
  const outside = (metafile.outputs["dist/index.js"]?.imports ?? [])
    .filter((imp) => imp.external && !isBuiltin(imp.path) && !OPTIONAL_REQUIRES.has(imp.path))
    .map((imp) => `${imp.path} (${imp.kind})`);
  if (outside.length > 0) fail(`dist/index.js loads modules that are not in it: ${[...new Set(outside)].join(", ")}`);
}

// 4. The tarball holds exactly the expected files. --ignore-scripts: the build has already run.
const npm = process.env.npm_execpath && /npm-cli\.[cm]?js$/.test(process.env.npm_execpath)
  ? { cmd: process.execPath, args: [process.env.npm_execpath] }
  : { cmd: "npm", args: [] };
const packed = JSON.parse(
  execFileSync(npm.cmd, [...npm.args, "pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32" && npm.cmd === "npm",
  }),
)[0];
const files = packed.files.map((f) => f.path).sort();
const packDiff = diff(files, PACKED_FILES);
if (packDiff.missing.length > 0) fail(`npm pack is missing: ${packDiff.missing.join(", ")}`);
if (packDiff.extra.length > 0) fail(`npm pack has unexpected files: ${packDiff.extra.join(", ")}`);
console.log(`npm pack: ${packed.entryCount} files, ${fmt(packed.size)} B packed, ${fmt(packed.unpackedSize)} B unpacked`);

// 5. THIRD_PARTY_LICENSES and the SBOM list exactly the npm packages in the bundle.
if (metafile) {
  const bundled = bundledPackages(metafile);
  if (!existsSync(LICENSES)) {
    fail("THIRD_PARTY_LICENSES is missing; run npm run build");
  } else {
    const d = diff(licensedIds(readFileSync(LICENSES, "utf8")), bundled.map((p) => p.id));
    if (d.missing.length > 0) fail(`THIRD_PARTY_LICENSES has no section for: ${d.missing.join(", ")}`);
    if (d.extra.length > 0) fail(`THIRD_PARTY_LICENSES lists packages that are not bundled: ${d.extra.join(", ")}`);
  }
  if (!existsSync(SBOM)) {
    fail("dist/sbom.cdx.json is missing; run npm run build");
  } else {
    const bom = JSON.parse(readFileSync(SBOM, "utf8"));
    if (bom.bomFormat !== "CycloneDX" || bom.specVersion !== "1.5") fail("dist/sbom.cdx.json is not a CycloneDX 1.5 document");
    const d = diff((bom.components ?? []).map((c) => c.purl), bundled.map((p) => purl(p.name, p.version)));
    if (d.missing.length > 0) fail(`dist/sbom.cdx.json has no component for: ${d.missing.join(", ")}`);
    if (d.extra.length > 0) fail(`dist/sbom.cdx.json lists packages that are not bundled: ${d.extra.join(", ")}`);
  }
  console.log(`licenses: ${bundled.length} bundled npm packages checked against THIRD_PARTY_LICENSES and dist/sbom.cdx.json`);
}

// 6. The READMEs pin this exact version in their client examples, so the README that ships with a version
//    recommends that version. Bump them together with package.json.
for (const file of [path.join(pkgDir, "README.md"), path.join(pkgDir, "..", "..", "README.md")]) {
  const name = path.relative(path.join(pkgDir, "..", ".."), file);
  const pins = [...readFileSync(file, "utf8").matchAll(/simple-hackathon-ops-mcp@(\d[\w.+-]*)/g)].map((m) => m[1].replace(/\.+$/, ""));
  if (pins.length === 0) fail(`${name} has no pinned npx -y ${pkg.name}@<version> example`);
  const other = [...new Set(pins.filter((v) => v !== pkg.version))];
  if (other.length > 0) fail(`${name} pins ${other.join(", ")}; package.json is ${pkg.version}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`package check failed: ${f}`);
  process.exit(1);
}
console.log("package check ok: no runtime dependencies, one bundle within budget, expected files, licenses complete");
