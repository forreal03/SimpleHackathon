// Writes THIRD_PARTY_LICENSES and dist/sbom.cdx.json (CycloneDX 1.5) from build/metafile.json: every
// npm package that has code in dist/index.js, with its license. Run after scripts/bundle.mjs.
// scripts/check-package.mjs imports the helpers below to check both files against the metafile.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const METAFILE = path.join(pkgDir, "build", "metafile.json");
export const LICENSES = path.join(pkgDir, "THIRD_PARTY_LICENSES");
export const SBOM = path.join(pkgDir, "dist", "sbom.cdx.json");

// Each package's section in THIRD_PARTY_LICENSES starts with these three lines.
const RULE = "=".repeat(80);
const PACKAGE = "Package: ";
const LICENSE_LINE = "License: ";

// The licenses the bundle may contain, by SPDX id (https://spdx.org/licenses/), each with words that every
// copy of its text has. scripts/check-package.mjs fails on a section without them and on a license that is
// not here, so add one only after reading the package's license text. The SBOM gives these ids as
// license.id, which CycloneDX allows only for SPDX ids.
export const LICENSE_TEXTS = {
  MIT: [/Permission is hereby granted, free of charge/i],
  ISC: [/Permission to use, copy, modify, and(\/or)? distribute this software/i],
  "BSD-3-Clause": [/Redistribution and use in source and binary forms/i],
  "Apache-2.0": [/Apache License/i, /Version 2\.0/i],
};

/** The npm packages with code in dist/index.js, sorted by name, then version. */
export function bundledPackages(metafile) {
  const output = metafile.outputs["dist/index.js"];
  if (!output) throw new Error("the metafile has no dist/index.js output");
  const dirs = new Set();
  for (const file of Object.keys(output.inputs)) {
    // Paths are relative to packages/mcp and use "/". Files outside node_modules are this repository's
    // own code. A package can sit in another package's node_modules, so the last node_modules counts.
    const parts = file.split("/");
    const i = parts.lastIndexOf("node_modules");
    if (i < 0) continue;
    dirs.add(parts.slice(0, i + (parts[i + 1].startsWith("@") ? 3 : 2)).join("/"));
  }
  const byId = new Map();
  for (const dir of dirs) {
    const pkg = readPackage(path.resolve(pkgDir, dir));
    if (!byId.has(pkg.id)) byId.set(pkg.id, pkg);
  }
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...byId.values()].sort((a, b) => order(a.name, b.name) || a.version.localeCompare(b.version, "en", { numeric: true }));
}

/** The sections of THIRD_PARTY_LICENSES: package id (name@version), license, and the texts below them. */
export function licenseSections(text) {
  const lines = text.split("\n");
  const starts = lines.flatMap((line, i) => (line === RULE && lines[i + 1]?.startsWith(PACKAGE) ? [i] : []));
  return starts.map((start, k) => {
    const section = lines.slice(start, starts[k + 1] ?? lines.length);
    const body = section.findIndex((line) => /^----- .+ -----$/.test(line));
    return {
      id: section[1].slice(PACKAGE.length),
      license: section[2]?.startsWith(LICENSE_LINE) ? section[2].slice(LICENSE_LINE.length) : "",
      texts: body < 0 ? "" : section.slice(body).join("\n"),
    };
  });
}

/** What `texts` lacks to carry the terms of the SPDX expression `license`; undefined when nothing. */
export function licenseTextGap(license, texts) {
  const ids = license.replace(/[()]/g, " ").split(/\s+/).filter((t) => t && !/^(AND|OR|WITH)$/.test(t));
  if (ids.length === 0 || !ids.every((id) => Object.hasOwn(LICENSE_TEXTS, id))) {
    return `has the license "${license}", which LICENSE_TEXTS in scripts/third-party.mjs does not list; read the section, then add the SPDX id with words its text always has`;
  }
  const flat = texts.replace(/\s+/g, " ");
  const carries = (id) => LICENSE_TEXTS[id].every((words) => words.test(flat));
  // "A OR B" lets the user pick either, so one of the texts is enough; otherwise every license applies.
  const ok = /\sOR\s/.test(license) && !/\s(AND|WITH)\s/.test(license) ? ids.some(carries) : ids.every(carries);
  return ok ? undefined : `has no ${license} license text (the section lacks words every copy of it has)`;
}

/** pkg:npm/%40scope/name@version (the purl spec percent-encodes the @ of a scope). */
export function purl(name, version) {
  return `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
}

function readPackage(dir) {
  const json = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const license = licenseOf(json);
  if (!license || /^UNLICENSED$/i.test(license)) throw new Error(`${json.name}@${json.version} has no license in its package.json`);
  const entries = readdirSync(dir).sort();
  return {
    id: `${json.name}@${json.version}`,
    name: json.name,
    version: json.version,
    license,
    author: authorName(json.author),
    dir,
    licenseFiles: entries.filter((f) => /^(licen[cs]e|copying)([.-]|$)/i.test(f)),
    noticeFiles: entries.filter((f) => /^notice([.-]|$)/i.test(f)),
    readme: entries.find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f)),
  };
}

/** The SPDX expression in package.json, including the old `licenses: [{ type }]` form. */
function licenseOf(json) {
  const one = (l) => (typeof l === "string" ? l : l?.type);
  if (json.license) return one(json.license);
  const ids = Array.isArray(json.licenses) ? json.licenses.map(one).filter(Boolean) : [];
  return ids.length > 1 ? `(${ids.join(" OR ")})` : ids[0];
}

/** "Name <mail> (url)" or { name } -> "Name". */
function authorName(author) {
  const s = typeof author === "string" ? author : author?.name;
  return s?.replace(/<[^>]*>|\([^)]*\)/g, "").trim() || undefined;
}

// Markdown in a README's License section that is not license text: link reference definitions
// ("[rfc]: http://...") and lines of nothing but badge images.
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S/;
const IMAGE = String.raw`!\[[^\]]*\]\([^)]*\)`;
const BADGES = new RegExp(String.raw`^\s*((\[${IMAGE}\]\([^)]*\)|${IMAGE})\s*)+$`);

/** The "License" section of the README, for a package that ships no license file. */
function readmeLicense(pkg) {
  if (!pkg.readme) return undefined;
  const lines = readFileSync(path.join(pkg.dir, pkg.readme), "utf8").replace(/\r\n?/g, "\n").split("\n");
  const heading = (i) => {
    const atx = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (atx) return { level: atx[1].length, title: atx[2], next: i + 1 };
    const under = lines[i + 1] ?? "";
    if (lines[i].trim() && /^(=+|-+)\s*$/.test(under)) return { level: under[0] === "=" ? 1 : 2, title: lines[i].trim(), next: i + 2 };
    return undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const h = heading(i);
    if (!h || !/^licen[cs]e\b/i.test(h.title)) continue;
    let end = h.next;
    for (; end < lines.length; end++) {
      const next = heading(end);
      if (next && next.level <= h.level) break;
    }
    // Plain text, not Markdown: drop link definitions, badges and comments, and undo the HTML escapes
    // READMEs use around <mail> and the like.
    const entities = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
    const text = lines
      .slice(h.next, end)
      .filter((line) => !LINK_DEFINITION.test(line) && !BADGES.test(line))
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text.replace(/&(lt|gt|quot|#39|amp);/g, (m) => entities[m]) || undefined;
  }
  return undefined;
}

function licenseSection(pkg) {
  const read = (f) => readFileSync(path.join(pkg.dir, f), "utf8").replace(/\r\n?/g, "\n").trim();
  const head = [RULE, PACKAGE + pkg.id, LICENSE_LINE + pkg.license];
  const body = [];
  if (pkg.licenseFiles.length > 0) {
    for (const f of pkg.licenseFiles) body.push(`----- ${f} -----`, "", read(f), "");
  } else {
    head.push(`The package has no license file; the license above is the "license" field of its package.json.`);
    if (pkg.author) head.push(`Author (package.json): ${pkg.author}`);
    // Naming the license is not enough: the section has to carry its text.
    const fromReadme = readmeLicense(pkg);
    if (!fromReadme) {
      const where = pkg.readme ? `its ${pkg.readme} has no License section` : "it has no README";
      throw new Error(`${pkg.id} ships no license file and ${where}, so THIRD_PARTY_LICENSES cannot carry its license text`);
    }
    body.push(`----- License section of ${pkg.readme} -----`, "", fromReadme, "");
  }
  for (const f of pkg.noticeFiles) body.push(`----- ${f} -----`, "", read(f), "");
  return [...head, "", ...body].join("\n");
}

function licensesText(self, packages) {
  const width = Math.max(...packages.map((p) => p.id.length)) + 2;
  return [
    `Third-party software in ${self.name} ${self.version}`,
    "",
    `dist/index.js is one bundled file. Besides this package's own code (${self.license}, see LICENSE) it`,
    `contains code from the ${packages.length} npm packages below. Each section gives a package, its license`,
    "and the license text that package ships. Generated from the bundle's esbuild metafile by",
    "scripts/third-party.mjs at build time; do not edit.",
    "",
    ...packages.map((p) => `  ${p.id.padEnd(width)}${p.license}`),
    "",
    ...packages.map(licenseSection),
  ].join("\n");
}

function cdxLicenses(expr) {
  // license.id takes only SPDX ids; any other single name ("BSD", LicenseRef-...) goes in license.name.
  if (Object.hasOwn(LICENSE_TEXTS, expr)) return [{ license: { id: expr } }];
  if (/\s(OR|AND|WITH)\s/.test(expr)) return [{ expression: expr }];
  return [{ license: { name: expr } }];
}

function cdxComponent(type, name, version, license) {
  const [scope, bare] = name.startsWith("@") ? name.split("/") : [undefined, name];
  const ref = purl(name, version);
  return { type, "bom-ref": ref, ...(scope ? { group: scope } : {}), name: bare, version, purl: ref, licenses: cdxLicenses(license) };
}

/** A minimal CycloneDX 1.5 SBOM: this package, and one component per bundled npm package. */
function sbom(self, packages) {
  return {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: { component: cdxComponent("application", self.name, self.version, self.license) },
    components: packages.map((p) => cdxComponent("library", p.name, p.version, p.license)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(METAFILE)) throw new Error("build/metafile.json is missing; run scripts/bundle.mjs first");
  const self = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const packages = bundledPackages(JSON.parse(readFileSync(METAFILE, "utf8")));
  writeFileSync(LICENSES, licensesText(self, packages) + "\n");
  writeFileSync(SBOM, JSON.stringify(sbom(self, packages), null, 2) + "\n");
  console.log(`wrote THIRD_PARTY_LICENSES and dist/sbom.cdx.json (${packages.length} bundled npm packages)`);
}
