// Checks what npm would publish (SPEC 13.4, LEAN-8). `npm run smoke` runs it after `npm run build`, so CI
// fails when the package gets runtime dependencies, an oversized bundle, stray files or a gap in the
// licenses:
//   1. package.json has no dependencies field (nor optional, peer or bundled ones)
//   2. dist/index.js exists, starts with the hashbang and is within the size budget
//   3. the bundle loads nothing but Node built-ins, and node:sqlite only through import()
//   4. `npm pack --dry-run` lists exactly the expected files, and package.json's bin points at one of them
//   5. THIRD_PARTY_LICENSES and dist/sbom.cdx.json cover exactly the npm packages in the bundle's metafile,
//      and every section of THIRD_PARTY_LICENSES carries the text of its license
//   6. the READMEs pin this package's version wherever an example runs it
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { bundledPackages, LICENSE_TEXTS, licenseSections, licenseTextGap, LICENSES, METAFILE, purl, SBOM } from "./third-party.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(pkgDir, "dist", "index.js");
const HASHBANG = "#!/usr/bin/env node\n";

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
const startsWithHashbang = (file) => readFileSync(file).subarray(0, HASHBANG.length).toString("utf8") === HASHBANG;

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
  if (!startsWithHashbang(BUNDLE)) fail(`dist/index.js does not start with ${HASHBANG.trim()}`);
  if (bundle.length > MAX_BUNDLE_BYTES) fail(`dist/index.js is ${fmt(bundle.length)} B, over the ${fmt(MAX_BUNDLE_BYTES)} B budget`);
  if (metafile.outputs["dist/index.js"]?.bytes !== bundle.length) fail("build/metafile.json does not describe this dist/index.js; run npm run build");
  console.log(`bundle: dist/index.js ${fmt(bundle.length)} B (budget ${fmt(MAX_BUNDLE_BYTES)} B), gzip ${fmt(gzipSync(bundle).length)} B`);

  // 3. The bundle imports nothing but Node built-ins (and the optional requires above).
  const imports = metafile.outputs["dist/index.js"]?.imports ?? [];
  const outside = imports
    .filter((imp) => imp.external && !isBuiltin(imp.path) && !OPTIONAL_REQUIRES.has(imp.path))
    .map((imp) => `${imp.path} (${imp.kind})`);
  if (outside.length > 0) fail(`dist/index.js loads modules that are not in it: ${[...new Set(outside)].join(", ")}`);
  // node:sqlite stays an import() so that src/index.ts sets its ExperimentalWarning filter first; a static
  // import would load it before the filter. Only Node 22 prints the warning (24.15+ and 26 do not), so the
  // smoke test alone cannot catch this on every Node version, but the metafile can.
  const staticSqlite = imports.filter((imp) => imp.path === "node:sqlite" && imp.kind !== "dynamic-import");
  if (staticSqlite.length > 0) {
    fail(`dist/index.js loads node:sqlite as ${[...new Set(staticSqlite.map((imp) => imp.kind))].join(", ")}; it must stay a dynamic import()`);
  }
}

// 4. The tarball holds exactly the expected files. --ignore-scripts: the build has already run. A throwaway
//    --cache keeps npm from storing every packed tarball under ~/.npm.
const npm = process.env.npm_execpath && /npm-cli\.[cm]?js$/.test(process.env.npm_execpath)
  ? { cmd: process.execPath, args: [process.env.npm_execpath] }
  : { cmd: "npm", args: [] };
const shell = process.platform === "win32" && npm.cmd === "npm";
const cache = mkdtempSync(path.join(tmpdir(), "hackathon-ops-npm-cache-"));
let packOutput;
try {
  packOutput = JSON.parse(
    execFileSync(npm.cmd, [...npm.args, "pack", "--dry-run", "--json", "--ignore-scripts", "--no-update-notifier", "--cache", shell ? `"${cache}"` : cache], {
      cwd: pkgDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell,
    }),
  );
} finally {
  rmSync(cache, { recursive: true, force: true });
}
// npm 10 and 11 print [{ ...package }], npm 12 { "<name>": { ...package } }.
const packed = Array.isArray(packOutput) ? packOutput[0] : packOutput?.[pkg.name];
if (!Array.isArray(packed?.files)) {
  fail(`npm pack --dry-run --json printed neither [{ files }] nor { "${pkg.name}": { files } }; this script needs updating`);
} else {
  const files = packed.files.map((f) => f.path).sort();
  const packDiff = diff(files, PACKED_FILES);
  if (packDiff.missing.length > 0) fail(`npm pack is missing: ${packDiff.missing.join(", ")}`);
  if (packDiff.extra.length > 0) fail(`npm pack has unexpected files: ${packDiff.extra.join(", ")}`);
  console.log(`npm pack: ${packed.entryCount} files, ${fmt(packed.size)} B packed, ${fmt(packed.unpackedSize)} B unpacked`);

  // npx runs the bin: each target must be in the tarball and start with the hashbang.
  const bins = typeof pkg.bin === "string" ? { [pkg.name.replace(/^@[^/]+\//, "")]: pkg.bin } : (pkg.bin ?? {});
  if (Object.keys(bins).length === 0) fail("package.json has no bin, so npx has nothing to run");
  for (const [command, target] of Object.entries(bins)) {
    const file = path.posix.normalize(String(target).replace(/\\/g, "/"));
    if (!files.includes(file)) fail(`package.json bin ${command} is ${target}, which npm pack does not include`);
    else if (!startsWithHashbang(path.join(pkgDir, file))) fail(`package.json bin ${command} (${target}) does not start with ${HASHBANG.trim()}`);
  }
}

// 5. THIRD_PARTY_LICENSES and the SBOM list exactly the npm packages in the bundle, and each section of
//    THIRD_PARTY_LICENSES carries the license's text, not only its name.
if (metafile) {
  const bundled = bundledPackages(metafile);
  if (!existsSync(LICENSES)) {
    fail("THIRD_PARTY_LICENSES is missing; run npm run build");
  } else {
    const sections = licenseSections(readFileSync(LICENSES, "utf8"));
    const d = diff(sections.map((s) => s.id), bundled.map((p) => p.id));
    if (d.missing.length > 0) fail(`THIRD_PARTY_LICENSES has no section for: ${d.missing.join(", ")}`);
    if (d.extra.length > 0) fail(`THIRD_PARTY_LICENSES lists packages that are not bundled: ${d.extra.join(", ")}`);
    for (const s of sections) {
      const gap = licenseTextGap(s.license, s.texts);
      if (gap) fail(`THIRD_PARTY_LICENSES: ${s.id} ${gap}`);
    }
  }
  if (!existsSync(SBOM)) {
    fail("dist/sbom.cdx.json is missing; run npm run build");
  } else {
    const bom = JSON.parse(readFileSync(SBOM, "utf8"));
    if (bom.bomFormat !== "CycloneDX" || bom.specVersion !== "1.5") fail("dist/sbom.cdx.json is not a CycloneDX 1.5 document");
    const d = diff((bom.components ?? []).map((c) => c.purl), bundled.map((p) => purl(p.name, p.version)));
    if (d.missing.length > 0) fail(`dist/sbom.cdx.json has no component for: ${d.missing.join(", ")}`);
    if (d.extra.length > 0) fail(`dist/sbom.cdx.json lists packages that are not bundled: ${d.extra.join(", ")}`);
    // CycloneDX takes license.id only from the SPDX list; LICENSE_TEXTS holds the SPDX ids the kit knows.
    const ids = [bom.metadata?.component, ...(bom.components ?? [])].flatMap((c) => (c?.licenses ?? []).map((l) => l.license?.id));
    const unknown = [...new Set(ids.filter((id) => id !== undefined && !Object.hasOwn(LICENSE_TEXTS, id)))];
    if (unknown.length > 0) fail(`dist/sbom.cdx.json has license ids that LICENSE_TEXTS does not list: ${unknown.join(", ")}`);
  }
  console.log(`licenses: ${bundled.length} bundled npm packages checked against THIRD_PARTY_LICENSES and dist/sbom.cdx.json`);
}

// 6. Wherever a README example runs the package (after `npx` and its flags, or in an `args` list) it pins
//    this exact version, and no other version, range or tag such as @latest appears anywhere, so the README
//    that ships with a version recommends that version. Bump them together with package.json.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SPEC = `(?<![\\w-])${esc(pkg.name)}(?![\\w-])(?:@([\\w.+^~<>=*|-]*))?`;
const RUNS = new RegExp(`(?:\\bnpx\\s+(?:--?[\\w-]+\\s+)*|\\bargs["']?\\s*[:=]\\s*\\[[^\\]]*?)${SPEC}`, "g");
const ANY = new RegExp(SPEC, "g");
const pinned = (m) => m[1]?.replace(/\.+$/, ""); // a sentence can end right after the version
for (const file of [path.join(pkgDir, "README.md"), path.join(pkgDir, "..", "..", "README.md")]) {
  const name = path.relative(path.join(pkgDir, "..", ".."), file);
  const text = readFileSync(file, "utf8");
  const runs = [...text.matchAll(RUNS)];
  if (runs.length === 0) fail(`${name} has no npx -y ${pkg.name}@${pkg.version} example`);
  const bare = runs.filter((m) => m[1] === undefined).length;
  if (bare > 0) fail(`${name} runs ${pkg.name} without a version in ${bare} example(s); write ${pkg.name}@${pkg.version}`);
  const other = [...new Set([...text.matchAll(ANY)].filter((m) => m[1] !== undefined).map(pinned).filter((v) => v !== pkg.version))];
  if (other.length > 0) fail(`${name} pins ${other.map((v) => `@${v}`).join(", ")}; package.json is ${pkg.version}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`package check failed: ${f}`);
  process.exit(1);
}
console.log("package check ok: no runtime dependencies, one bundle within budget, expected files, licenses complete");
