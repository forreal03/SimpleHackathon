import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { buildRuntime } from "../scripts/build-runtime.mjs";
import { compileFormula } from "../src/formula/parse.js";
import { matchesProblem } from "../src/runtime/eligibility.js";
import { evaluateAst, validateAst } from "../src/runtime/formula/evaluate.js";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as { name: string; version: string };

/** Formulas with the values to evaluate them on: arithmetic, every function, laziness, warnings. */
const CASES: { source: string; vars: Record<string, number> }[] = [
  { source: "0.85 * judge + 15 * sqrt(min(1, votes / (2 * avg_votes)))", vars: { judge: 80, votes: 27, avg_votes: 18 } },
  { source: "0.85 * judge + 15 * sqrt(min(1, votes / (2 * avg_votes)))", vars: { judge: 70, votes: 3, avg_votes: 0 } },
  { source: "2^3^2 - -2^2 + 7 / 0", vars: {} },
  { source: "max(a, 1) + sum(a, 2, 3) + avg(a, 4) + abs(-a) + floor(a / 3) + ceil(a / 3) + clamp(a, 0, 5)", vars: { a: 7 } },
  { source: "round(2.675, 2) + round(-2.5) + sqrt(-1)", vars: {} },
  { source: "if(a > 1 and not b, 10, missing) + (b or a == 7)", vars: { a: 7, b: 0, missing: 0 } },
  { source: "if(a, (-8) ^ 0.5, 1)", vars: { a: 1 } },
  { source: "1000000000 ^ 20 * 1000000000 ^ 20", vars: {} },
];

describe("runtime bundle (dist/runtime.gs.js)", () => {
  let code = "";
  let ctx: vm.Context;
  beforeAll(async () => {
    code = await buildRuntime({ write: false });
    ctx = vm.createContext({});
    vm.runInContext(code, ctx);
  });

  /** Runs `expr` inside the bundle's context with `input` (JSON) available, and returns its JSON result. */
  const inBundle = (expr: string, input: unknown): unknown => {
    ctx.input = JSON.stringify(input);
    return JSON.parse(vm.runInContext(`JSON.stringify((() => { const input = JSON.parse(globalThis.input); return ${expr}; })())`, ctx));
  };

  it("starts with a banner naming the kit version", () => {
    expect(code.split("\n")[0]).toBe(`// ${pkg.name} runtime v${pkg.version}. Generated from src/runtime by scripts/build-runtime.mjs; do not edit.`);
  });

  it("keeps Korean messages readable and names modules relative to the package, wherever it is built", () => {
    expect(code).toContain("조건 형식이 올바르지 않습니다");
    expect(code).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    expect(code).toMatch(/^ *\/\/ src\/runtime\/eligibility\.ts$/m);
    expect(code).not.toContain(pkgDir);
  });

  it("defines SHK in a context without Node globals", () => {
    expect(vm.runInContext("[typeof process, typeof require, typeof Buffer, typeof module]", ctx)).toEqual(["undefined", "undefined", "undefined", "undefined"]);
    const api = vm.runInContext("Object.keys(SHK).sort()", ctx) as string[];
    expect(api).toEqual(
      expect.arrayContaining([
        "assignPrizes",
        "checkApplicantEligibility",
        "computeTeamScores",
        "evaluateAst",
        "evaluateCondition",
        "matchesProblem",
        "maxTotal",
        "overrideApplies",
        "prizesByTrack",
        "rankTeams",
        "resolveTeamDivision",
        "roundTo",
        "scoringVariables",
        "trackDivisionSpec",
        "validateAst",
      ]),
    );
    expect(api).not.toContain("NODE_KINDS");
  });

  it("refuses a dangerous matches pattern exactly like Node", () => {
    const cond = { field: "이름", matches: "^([A-Za-z]+ ?)+$" };
    const person = { email: "a@example.com", answers: { 이름: `${"A".repeat(28)}1` } };
    ctx.input = JSON.stringify({ cond, person });
    expect(() => vm.runInContext("SHK.evaluateCondition(JSON.parse(input).cond, JSON.parse(input).person)", ctx)).toThrow("조건의 정규식을 쓸 수 없습니다(맨 위).");
    expect(inBundle("SHK.matchesProblem(input)", "^(\\w+\\s?)*$")).toBe(matchesProblem("^(\\w+\\s?)*$"));
  });

  it("evaluates formula ASTs exactly like Node", () => {
    for (const { source, vars } of CASES) {
      const compiled = compileFormula(source, Object.keys(vars));
      expect(compiled.ok, source).toBe(true);
      if (!compiled.ok) continue;
      expect(inBundle("SHK.evaluateAst(input.ast, input.vars)", { ast: compiled.ast, vars })).toEqual(evaluateAst(compiled.ast, vars));
    }
  });

  it("rejects tampered ASTs exactly like Node", () => {
    const tampered = [{ k: "c", f: "constructor", a: [] }, { k: "b", o: "%", a: { k: "n", v: 1 }, b: { k: "n", v: 2 } }, { k: "v", n: "votes" }];
    for (const ast of tampered) {
      expect(inBundle("SHK.validateAst(input.ast, ['judge'])", { ast })).toEqual(validateAst(ast, ["judge"]));
    }
    expect(() => vm.runInContext("SHK.evaluateAst({ k: 'x' }, {})", ctx)).toThrow("수식 AST가 올바르지 않아 계산하지 않았습니다.");
  });
});

describe("runtime sources", () => {
  const dir = path.join(pkgDir, "src", "runtime");
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));

  it("import only each other: no Node, zod or yaml", () => {
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const [, spec = ""] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        const target = path.resolve(path.dirname(path.join(dir, file)), spec);
        expect(spec.startsWith(".") && target.startsWith(dir + path.sep), `${file} imports ${spec}`).toBe(true);
      }
    }
  });

  it("use no Node globals and nothing that runs strings as code", () => {
    for (const file of files) {
      const code = readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\b(?:process|Buffer|require|globalThis)\b/);
      expect(code, file).not.toMatch(/\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/);
    }
  });
});
