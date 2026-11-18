// Checks npm's security advisories against the packages inside dist/index.js (SPEC 13.3, REL-9).
// The published package has no dependencies, so the `npm audit` that users run cannot see a vulnerable
// library inside the bundle. This script runs `npm audit` for the repository and
//   - fails when a moderate, high or critical advisory affects a package the bundle contains,
//   - lists every other advisory (development tools such as the test runner, or low ones) as a warning.
// Needs network access to the npm registry and a build (build/metafile.json).
// Usage: npm run build && node scripts/audit-bundle.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METAFILE } from "./third-party.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const BLOCKING = new Set(["moderate", "high", "critical"]);

if (!existsSync(METAFILE)) {
  console.error("audit: build/metafile.json is missing; run npm run build first");
  process.exit(1);
}
const output = JSON.parse(readFileSync(METAFILE, "utf8")).outputs["dist/index.js"];
if (!output) {
  console.error("audit: build/metafile.json has no dist/index.js output; run npm run build");
  process.exit(1);
}

// Install folders of the bundled packages relative to the repository root ("node_modules/zod", ...), the
// same form npm audit uses in "nodes". A package can sit in another package's node_modules.
const bundledDirs = new Set();
for (const file of Object.keys(output.inputs)) {
  const parts = file.split("/");
  const i = parts.lastIndexOf("node_modules");
  if (i < 0) continue;
  const dir = path.resolve(pkgDir, parts.slice(0, i + (parts[i + 1].startsWith("@") ? 3 : 2)).join("/"));
  bundledDirs.add(path.relative(repoRoot, dir).split(path.sep).join("/"));
}

const npm = process.env.npm_execpath && /npm-cli\.[cm]?js$/.test(process.env.npm_execpath)
  ? { cmd: process.execPath, args: [process.env.npm_execpath] }
  : { cmd: "npm", args: [] };
// npm audit exits 1 when it finds advisories, so read its JSON whatever the exit code is.
// Every bundled library is a devDependency, which NODE_ENV=production or omit=dev would leave unaudited.
const run = spawnSync(npm.cmd, [...npm.args, "audit", "--json", "--include=dev", "--include=optional", "--include=peer", "--no-update-notifier"], {
  cwd: repoRoot,
  encoding: "utf8",
  shell: process.platform === "win32" && npm.cmd === "npm",
  maxBuffer: 64 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error(`audit: npm audit printed no JSON (exit ${run.status}).\n${run.stderr}`);
  process.exit(1);
}
if (report.error) {
  console.error(`audit: npm audit failed: ${report.message || report.error.summary || report.error.detail || JSON.stringify(report.error)}\n${run.stderr}`);
  process.exit(1);
}

const titles = (v) =>
  [...new Set((v.via ?? []).map((x) => (typeof x === "string" ? `via ${x}` : `${x.title} (${x.url})`)))].join("; ");
const vulns = Object.values(report.vulnerabilities ?? {});
const blocking = [];
for (const v of vulns) {
  const bundled = (v.nodes ?? []).some((n) => bundledDirs.has(n));
  if (bundled && BLOCKING.has(v.severity)) blocking.push(v);
  else console.warn(`audit warning: ${v.name} (${v.severity}, ${bundled ? "in the bundle" : "not in the bundle"}): ${titles(v)}`);
}
for (const v of blocking) console.error(`audit: bundled package ${v.name} has a ${v.severity} advisory: ${titles(v)}`);
const advisories = new Set(vulns.flatMap((v) => (v.via ?? []).filter((x) => typeof x !== "string").map((x) => x.url)));
console.log(
  `audit: ${advisories.size} advisories in ${vulns.length} packages, ${blocking.length} blocking (moderate or worse in one of the ${bundledDirs.size} bundled packages)`,
);
process.exit(blocking.length > 0 ? 1 : 0);
