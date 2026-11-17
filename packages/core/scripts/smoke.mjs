// Runs the built CLI (dist/cli.js) on both examples and loads the built runtime bundle in an
// empty vm context, the way Apps Script sees it. Usage: npm run build && node scripts/smoke.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(pkg, "..", "..");
const cli = path.join(pkg, "dist", "cli.js");
const examples = [
  path.join(repo, "examples", "reference-2track", "events", "example-2027", "event.yaml"),
  path.join(repo, "examples", "company-internal", "events", "corp-hack-2027", "event.yaml"),
];
const out = mkdtempSync(path.join(tmpdir(), "shk-smoke-"));

try {
  for (const file of examples) {
    const name = path.basename(path.dirname(file));
    execFileSync(process.execPath, [cli, "check", file], { stdio: "pipe" });
    execFileSync(process.execPath, [cli, "build", file, "--out", path.join(out, name)], { stdio: "pipe" });
    const json = JSON.parse(readFileSync(path.join(out, name, "event.json"), "utf8"));
    console.log(`${name}: check ok, build ok (event.json ${json.event.id}, config_hash ${json.config_hash})`);
  }

  let refused = false;
  try {
    execFileSync(process.execPath, [cli, "check", path.join(out, "missing.yaml")], { stdio: "pipe" });
  } catch (e) {
    refused = e.status === 1;
  }
  if (!refused) throw new Error("check of a missing file should exit 1");
  console.log("missing file: exit 1");

  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(path.join(pkg, "dist", "runtime.gs.js"), "utf8"), ctx);
  const reference = JSON.parse(readFileSync(path.join(out, "example-2027", "event.json"), "utf8"));
  ctx.input = JSON.stringify(reference.scoring);
  const s = vm.runInContext(
    `(() => {
      const scoring = JSON.parse(input);
      const teams = [{ id: "a", track: "hackathon", division: null }, { id: "b", track: "hackathon", division: null }];
      const sheet = (team, v) => ({ judge: "j", team, scores: { idea: v, done: v, ux: v, arch: v } });
      return SHK.computeTeamScores(scoring, teams, [sheet("a", 20), sheet("b", 17.5)], { a: 27, b: 9 }).map((t) => t.score).join(",");
    })()`,
    ctx,
  );
  // J = 80 with 27 of 36 votes and J = 70 with 9: 0.85 × 80 + 15 × √0.75 and 0.85 × 70 + 15 × √0.25.
  if (s !== "80.99,67") throw new Error(`runtime bundle gave ${s}, expected 80.99,67`);
  console.log(`runtime.gs.js in an empty context: scores ${s}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
