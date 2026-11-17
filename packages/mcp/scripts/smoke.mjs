// Starts the built server over stdio, lists its tools and runs the offline ones against a temp folder.
// Then does the same with a copy of the package (dist/, config/, package.json, licenses) in a temp folder
// with no node_modules on the way up, which shows the bundle needs nothing else at runtime.
// Usage: npm run build && node scripts/smoke.mjs
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The 0.1.0 tool surface (SPEC 12.4). Change it together with the tools.
const EXPECTED_TOOLS = 32;
const EXPECTED_TOOL_NAMES = [
  "event_init", "org_check", "org_settings_plan", "org_settings_apply", "schedule_get", "schedule_set",
  "roster_source_set", "roster_sources", "roster_sync", "github_handles_check", "teams_list", "teams_plan",
  "teams_apply", "team_move_member", "repos_plan", "repos_apply", "repos_freeze", "repos_visibility_plan",
  "repos_visibility_apply", "repos_activity", "reviewer_set", "reviewer_remove", "reviewers_list",
  "reviewers_plan", "reviewers_apply", "apps_list", "app_review", "app_decide", "apps_drift",
  "app_requests_ingest", "audit_query", "event_close",
];
if (new Set(EXPECTED_TOOL_NAMES).size !== EXPECTED_TOOLS) throw new Error("EXPECTED_TOOL_NAMES does not hold EXPECTED_TOOLS names");
// The isolated copy gets what npm publishes (scripts/check-package.mjs has the full list) and nothing else.
const PACKAGE_FILES = ["dist", "config", "package.json", "README.md", "LICENSE", "THIRD_PARTY_LICENSES"];

/** Runs the offline checks against `entry` started in `cwd`; returns the result lines and tool names. */
async function smoke(entry, { cwd, env = process.env, print = () => {} }) {
  const home = mkdtempSync(path.join(tmpdir(), "hackathon-ops-smoke-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd,
    env: { ...env, HACKATHON_OPS_HOME: home, GITHUB_TOKEN: "", GITHUB_APP_ID: "" },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  const client = new Client({ name: "smoke", version: "0.0.0" });
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: !!res.isError, text: res.content[0]?.text ?? "" };
  };
  const lines = [];
  const log = (line) => {
    lines.push(line);
    print(line);
  };
  const expect = (ok, what) => {
    if (!ok) throw new Error(`smoke (${entry}): ${what}\nserver stderr:\n${stderr}`);
  };

  try {
    await client.connect(transport).catch((err) => expect(false, `server did not start (${err.message})`));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    log(`tools (${tools.length}): ${names.join(", ")}`);
    expect(tools.length === EXPECTED_TOOLS, `expected ${EXPECTED_TOOLS} tools, got ${tools.length}`);
    const missing = EXPECTED_TOOL_NAMES.filter((n) => !names.includes(n));
    const unexpected = names.filter((n) => !EXPECTED_TOOL_NAMES.includes(n));
    expect(missing.length + unexpected.length === 0, `tool names changed: missing ${missing.join(", ") || "none"}; unexpected ${unexpected.join(", ") || "none"}`);
    const noSchema = tools.filter((t) => t.inputSchema?.type !== "object").map((t) => t.name);
    expect(noSchema.length === 0, `tools without an object inputSchema: ${noSchema.join(", ")}`);

    const init = await call("event_init", { event_id: "smoke-test", org: "some-org" });
    log(`event_init: ${init.isError ? "ERROR " + init.text : `${JSON.parse(init.text).status}, valid=${JSON.parse(init.text).valid}`}`);
    expect(!init.isError && JSON.parse(init.text).status === "created", "event_init did not create the event");

    // Fill the placeholder sheet link the way an operator would.
    const yamlFile = path.join(home, "events", "smoke-test", "event.yaml");
    writeFileSync(yamlFile, readFileSync(yamlFile, "utf8").replace("<id>", "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"));

    const again = await call("event_init", { event_id: "smoke-test", org: "some-org" });
    log(`event_init again: ${again.isError ? "ERROR " + again.text : `${JSON.parse(again.text).status}, valid=${JSON.parse(again.text).valid}`}`);
    expect(!again.isError && JSON.parse(again.text).valid === true, "event_init again did not find a valid event.yaml");

    const audit = await call("audit_query", { event: "smoke-test" });
    log(`audit_query: ${audit.isError ? "ERROR " + audit.text : `${JSON.parse(audit.text).length} rows`}`);
    expect(!audit.isError && JSON.parse(audit.text).length === 0, "audit_query failed or returned rows for a new event");

    const badId = await call("audit_query", { event: "../etc" });
    log(`path traversal refused: ${badId.isError}`);
    expect(badId.isError, "audit_query accepted ../etc");

    const noCreds = await call("org_check", { event: "smoke-test" });
    log(`org_check without credentials: ${noCreds.isError ? noCreds.text.split("\n")[0] : "unexpectedly ok"}`);
    expect(noCreds.isError, "org_check ran without credentials");
    // Node 22 prints this warning when node:sqlite loads (Node 24.15+ and 26 do not). src/index.ts hides it by
    // loading node:sqlite only after its filter is set, so a bundle that hoisted the import would print it
    // here on Node 22. scripts/check-package.mjs checks the import itself on every Node version.
    expect(!stderr.includes("SQLite is an experimental feature"), "node:sqlite's ExperimentalWarning reached stderr");
    return { lines, tools: tools.map((t) => t.name) };
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
}

/** A copy of the package in a fresh temp folder. Node looks for packages in every parent's node_modules. */
function isolatedCopy() {
  // It also looks in $HOME/.node_modules and $HOME/.node_libraries (the isolated run gets HOME set to the
  // copy) and in <prefix>/lib/node next to the Node binary, which no environment variable moves.
  const prefixLib = path.resolve(process.execPath, process.platform === "win32" ? ".." : "../..", "lib", "node");
  if (existsSync(prefixLib)) throw new Error(`${prefixLib} exists and Node loads packages from it, so no copy of the package is isolated`);
  const dir = mkdtempSync(path.join(tmpdir(), "hackathon-ops-isolated-"));
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, "node_modules"))) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`${d} has a node_modules folder, so a copy under ${tmpdir()} is not isolated; set TMPDIR elsewhere`);
    }
    if (path.dirname(d) === d) break;
  }
  try {
    for (const f of PACKAGE_FILES) cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not copy the package (${err.message}); run npm run build first`);
  }
  return dir;
}

const repo = await smoke(path.join(root, "dist", "index.js"), { cwd: root, print: (line) => console.log(line) });

const copy = isolatedCopy();
try {
  // No module search paths or preloads from this environment either: no NODE_PATH or NODE_OPTIONS, and a
  // home folder without .node_modules or .node_libraries.
  const { NODE_PATH, NODE_OPTIONS, ...env } = process.env;
  const isolated = await smoke(path.join(copy, "dist", "index.js"), { cwd: copy, env: { ...env, HOME: copy, USERPROFILE: copy } });
  if (isolated.lines.join("\n") !== repo.lines.join("\n")) {
    throw new Error(`the isolated copy behaved differently:\n${isolated.lines.join("\n")}`);
  }
  console.log(`isolated copy (no node_modules, only ${PACKAGE_FILES.join(", ")}): same ${isolated.tools.length} tools, same results`);
} finally {
  rmSync(copy, { recursive: true, force: true });
}
