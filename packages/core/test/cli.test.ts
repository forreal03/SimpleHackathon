import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { EXAMPLES, buildExample, type ExampleName } from "./examples.js";

let out = "";
let lines: string[] = [];
beforeEach(() => {
  out = mkdtempSync(path.join(tmpdir(), "shk-cli-"));
  lines = [];
  const capture = (...args: unknown[]) => void lines.push(args.join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(out, { recursive: true, force: true });
});

describe("simple-hackathon CLI on the examples", () => {
  for (const name of ["reference", "company"] as ExampleName[]) {
    it(`check exits 0 for ${name}`, async () => {
      expect(await runCli(["check", EXAMPLES[name]])).toBe(0);
      expect(lines).toEqual([expect.stringMatching(/^INFO {2}V3 +scoring\.criteria: /), "검사 결과: 오류 0개, 경고 0개, 정보 1개"]);
    });

    it(`build writes event.json for ${name}`, async () => {
      const dir = path.join(out, "site");
      expect(await runCli(["build", EXAMPLES[name], "--out", dir])).toBe(0);
      const written = readFileSync(path.join(dir, "event.json"), "utf8");
      expect(JSON.parse(written)).toEqual(buildExample(name).eventJson);
      expect(written.endsWith("}\n")).toBe(true);
      expect(lines.at(-1)).toMatch(/^event\.json을 썼습니다: .*event\.json$/);
    });
  }
});

describe("simple-hackathon CLI errors", () => {
  it("exits 1 with the diagnostics when check finds an error, and build writes nothing", async () => {
    const home = path.join(out, "home");
    mkdirSync(path.join(home, "events", "bad"), { recursive: true });
    const file = path.join(home, "events", "bad", "event.yaml");
    writeFileSync(file, "schema: 2\nkind: event\nevent: { id: bad-1, name: Bad }\nprivacy: { retention_days: -1 }\n");
    expect(await runCli(["check", file])).toBe(1);
    expect(lines).toContain("ERROR V7     privacy.retention_days: 개인정보 보관 기간(retention_days)은 0일 이상이어야 합니다.");
    expect(await runCli(["build", file, "--out", path.join(out, "site")])).toBe(1);
    expect(lines.at(-1)).toBe("오류가 있어 event.json을 만들지 않았습니다.");
    expect(existsSync(path.join(out, "site"))).toBe(false);
  });

  it("exits 1 when the file cannot be loaded", async () => {
    expect(await runCli(["check", path.join(out, "missing.yaml")])).toBe(1);
    expect(lines[0]).toMatch(/^ERROR V13 +.*missing\.yaml: 파일을 찾을 수 없습니다/);
  });

  it("passes --home on to the loader", async () => {
    const reference = path.dirname(path.dirname(path.dirname(EXAMPLES.reference)));
    const moved = path.join(out, "event.yaml");
    writeFileSync(moved, readFileSync(EXAMPLES.reference));
    expect(await runCli(["check", moved])).toBe(1);
    expect(await runCli(["check", moved, "--home", reference])).toBe(0);
  });

  it("exits 2 with the usage for bad arguments", async () => {
    for (const argv of [[], ["lint", "x.yaml"], ["check"], ["check", "a.yaml", "b.yaml"], ["build", "a.yaml"], ["check", "a.yaml", "--home"], ["check", "a.yaml", "--fast"]]) {
      lines = [];
      expect(await runCli(argv), argv.join(" ")).toBe(2);
      expect(lines.join("\n")).toContain("사용법:");
    }
  });
});
