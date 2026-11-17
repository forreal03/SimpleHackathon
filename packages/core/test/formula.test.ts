import { describe, expect, it } from "vitest";
import { compileFormula } from "../src/formula/parse.js";
import { evaluateAst, validateAst } from "../src/runtime/formula/evaluate.js";
import { scoringVariables } from "../src/runtime/scoring.js";
import { roundTo } from "../src/runtime/util.js";
import type { Ast, CompileError } from "../src/runtime/types.js";
import { REFERENCE_CRITERIA, REFERENCE_FORMULA } from "./helpers.js";

const WITH_VOTES = scoringVariables(REFERENCE_CRITERIA, true);
const WITHOUT_VOTES = scoringVariables(REFERENCE_CRITERIA, false);
const FUNCTION_LIST = "min, max, sum, avg, abs, sqrt, round, floor, ceil, clamp, if";

function compile(source: string, allowed: readonly string[]): Ast {
  const result = compileFormula(source, allowed);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.ast;
}

/** Compiles with exactly the given variables allowed, then evaluates. */
function run(source: string, vars: Record<string, number> = {}): number {
  return evaluateAst(compile(source, Object.keys(vars)), vars).value;
}

function errorsOf(source: string, allowed: readonly string[] = []): CompileError[] {
  const result = compileFormula(source, allowed);
  if (result.ok) throw new Error(`expected "${source}" to fail`);
  return result.errors;
}

const firstError = (source: string, allowed: readonly string[] = []) => errorsOf(source, allowed)[0]!.message;

const num = (v: number): Ast => ({ k: "n", v });
/** `depth` unary minus nodes around `leaf`, built without recursion. */
function nest(depth: number, leaf: Ast): Ast {
  let node = leaf;
  for (let i = 0; i < depth; i++) node = { k: "u", o: "-", a: node };
  return node;
}

describe("formula: precedence and associativity", () => {
  it("makes ^ right-associative and tighter than unary minus", () => {
    expect(run("2^3^2")).toBe(512);
    expect(compile("2^3^2", [])).toEqual({ k: "b", o: "^", a: num(2), b: { k: "b", o: "^", a: num(3), b: num(2) } });
    expect(run("-2^2")).toBe(-4);
    expect(compile("-2^2", [])).toEqual({ k: "u", o: "-", a: { k: "b", o: "^", a: num(2), b: num(2) } });
    expect(run("(-2)^2")).toBe(4);
    expect(run("2^-1")).toBe(0.5);
    expect(run("-2^-2")).toBe(-0.25);
    expect(run("2 * 3 ^ 2")).toBe(18);
  });

  it("orders arithmetic and keeps + - * / left-associative", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("64 / 4 / 2")).toBe(8);
    expect(run("- - 2")).toBe(2);
    expect(run("2 * -3")).toBe(-6);
    expect(compile(" 1 +\n2 * 3 ", [])).toEqual(compile("1+2*3", []));
  });

  it("puts comparison below arithmetic, then not, and, or", () => {
    expect(run("1 + 2 < 4")).toBe(1);
    expect(run("not 0 + 1")).toBe(0);
    expect(run("not 1 < 0")).toBe(1);
    expect(run("1 or 0 and 0")).toBe(1);
    expect(run("(1 or 0) and 0")).toBe(0);
    expect(run("not 0 and 0")).toBe(0);
    expect(run("not (0 and 0)")).toBe(1);
    expect(run("not not 3")).toBe(1);
    expect(run("(1 < 2) == 1")).toBe(1);
  });

  it("rejects what the grammar does not allow", () => {
    expect(firstError("1 < 2 < 3")).toContain("비교 연산자는 한 번에 하나만");
    expect(firstError("1 == 1 != 0")).toContain("비교 연산자는 한 번에 하나만");
    expect(firstError("1 + not 0")).toContain('"not"은 이 자리에 바로 쓸 수 없습니다');
    expect(firstError("-not 1")).toContain('"not"은 이 자리에 바로 쓸 수 없습니다');
  });

  it("builds the AST of design doc 2.4 for the reference formula", () => {
    const ast = compile(REFERENCE_FORMULA, WITH_VOTES);
    expect(ast).toMatchObject({
      k: "b",
      o: "+",
      a: { k: "b", o: "*", a: { k: "n", v: 0.85 }, b: { k: "v", n: "judge" } },
      b: { k: "b", o: "*", a: { k: "n", v: 15 }, b: { k: "c", f: "sqrt", a: [{ k: "c", f: "min" }] } },
    });
    expect(validateAst(JSON.parse(JSON.stringify(ast)), WITH_VOTES).ok).toBe(true);
  });
});

describe("formula: semantics", () => {
  it("gives 1/0 for comparisons and logic, any non-zero being true", () => {
    expect([run("1 < 2"), run("2 <= 2"), run("3 > 4"), run("3 >= 4"), run("2 == 2"), run("2 != 2")]).toEqual([1, 1, 0, 0, 1, 0]);
    expect([run("2 and 3"), run("0 or 7"), run("0 or 0"), run("not 5"), run("not 0"), run("if(-1, 10, 20)")]).toEqual([1, 1, 0, 0, 1, 10]);
  });

  it("divides by zero to 0, quietly, also inside larger expressions", () => {
    expect(evaluateAst(compile("1 / 0", []), {})).toEqual({ value: 0, warnings: [] });
    expect(run("1 / 0 + 5")).toBe(5);
    expect(run("0 / 0 + 5")).toBe(5);
    expect(run("-5 / 0 - 1")).toBe(-1);
    // A track without a single vote: the average is 0, so the popular part is 0, not full marks.
    expect(run("15 * sqrt(min(1, votes / (2 * avg_votes)))", { votes: 4, avg_votes: 0 })).toBe(0);
  });

  it("evaluates only the chosen branch of if", () => {
    const pick = (cond: number) => evaluateAst(compile(`if(${cond}, 2, missing)`, ["missing"]), {});
    expect(pick(1).value).toBe(2);
    expect(() => pick(0)).toThrow('"missing"');
    const unchosen = evaluateAst(compile("if(1, 1, (-8) ^ 0.5)", []), {});
    expect(unchosen).toEqual({ value: 1, warnings: [] });
    const chosen = evaluateAst(compile("if(0, 1, (-8) ^ 0.5)", []), {});
    expect(chosen.value).toBe(0);
    expect(chosen.warnings).toHaveLength(1);
  });

  it("short-circuits and / or", () => {
    const ev = (source: string) => evaluateAst(compile(source, ["missing"]), {}).value;
    expect(ev("0 and missing")).toBe(0);
    expect(ev("1 or missing")).toBe(1);
    expect(() => ev("1 and missing")).toThrow('"missing"');
    expect(() => ev("0 or missing")).toThrow('"missing"');
  });

  it("replaces non-finite ^ results and final results by 0 with a warning", () => {
    expect(evaluateAst(compile("(-8) ^ 0.5", []), {})).toEqual({ value: 0, warnings: [expect.stringContaining("거듭제곱")] });
    expect(evaluateAst(compile("0 ^ -1 + 3", []), {})).toEqual({ value: 3, warnings: [expect.stringContaining("거듭제곱")] });
    expect(evaluateAst(compile("1000000000 ^ 20 * 1000000000 ^ 20", []), {})).toEqual({ value: 0, warnings: [expect.stringContaining("계산 결과")] });
    expect(evaluateAst(compile("2 ^ 0.5", []), {})).toEqual({ value: Math.SQRT2, warnings: [] });
    expect(Object.is(run("-0"), 0)).toBe(true);
  });

  it("throws on a variable missing from the values instead of guessing", () => {
    expect(() => evaluateAst({ k: "v", n: "judge" }, {})).toThrow('수식 변수 "judge"의 값이 없습니다.');
    expect(() => evaluateAst({ k: "v", n: "judge" }, { judge: "80" } as unknown as Record<string, number>)).toThrow("judge");
    // Only own properties are variables, never inherited ones.
    expect(() => evaluateAst({ k: "v", n: "judge" }, Object.create({ judge: 5 }) as Record<string, number>)).toThrow("judge");
  });
});

describe("formula: functions", () => {
  it("computes min, max, sum, avg with one or more arguments", () => {
    expect(run("min(3, 1, 2)")).toBe(1);
    expect(run("max(3, 1, 2)")).toBe(3);
    expect(run("sum(1, 2, 3)")).toBe(6);
    expect(run("avg(1, 2, 3, 4)")).toBe(2.5);
    expect(run("min(5)")).toBe(5);
  });

  it("computes abs, sqrt (0 for negatives), floor, ceil, clamp", () => {
    expect(run("abs(-3)")).toBe(3);
    expect(run("sqrt(16)")).toBe(4);
    expect(evaluateAst(compile("sqrt(-4)", []), {})).toEqual({ value: 0, warnings: [] });
    expect(run("sqrt(-4) + 1")).toBe(1);
    expect(run("floor(-1.5)")).toBe(-2);
    expect(run("ceil(1.2)")).toBe(2);
    expect(Object.is(run("ceil(-0.5)"), 0)).toBe(true);
    expect([run("clamp(5, 0, 3)"), run("clamp(-1, 0, 3)"), run("clamp(2, 0, 3)")]).toEqual([3, 0, 2]);
  });

  it("rounds halves away from zero at 0-6 digits", () => {
    expect(run("round(2.5)")).toBe(3);
    expect(run("round(-2.5)")).toBe(-3);
    expect(run("round(1.005, 2)")).toBe(1.01);
    expect(run("round(2.675, 2)")).toBe(2.68);
    expect(run("round(1.45, 1)")).toBe(1.5);
    expect(run("round(-1.005, 2)")).toBe(-1.01);
    expect(run("round(1.23456789, 6)")).toBe(1.234568);
    expect(Object.is(run("round(-0.4)"), 0)).toBe(true);
  });

  it("checks argument counts", () => {
    expect(firstError("min()")).toBe('1번째 글자 근처: "min" 함수는 인자를 1개 이상 받습니다(지금 0개).');
    expect(firstError("abs(1, 2)")).toBe('1번째 글자 근처: "abs" 함수는 인자를 1개 받습니다(지금 2개).');
    expect(firstError("1 + clamp(1, 2)")).toBe('5번째 글자 근처: "clamp" 함수는 인자를 3개 받습니다(지금 2개).');
    expect(firstError("round(1, 2, 3)")).toBe('1번째 글자 근처: "round" 함수는 인자를 1~2개 받습니다(지금 3개).');
    expect(firstError("if(1, 2)")).toBe('1번째 글자 근처: "if" 함수는 인자를 3개 받습니다(지금 2개).');
  });

  it("wants round digits as an integer literal from 0 to 6", () => {
    for (const digits of ["7", "x", "2.5", "-1", "1 + 1"]) {
      expect(firstError(`round(1.5, ${digits})`, ["x"])).toContain('"round" 함수의 두 번째 인자(자릿수)는 0~6 사이의 정수');
    }
    expect(errorsOf("round(1.5, 7)")[0]!.pos).toBe(11);
  });
});

describe("formula: limits", () => {
  it("allows 500 characters of source, not 501", () => {
    expect(compileFormula(`1${" ".repeat(499)}`, []).ok).toBe(true);
    expect(firstError(`1${" ".repeat(500)}`)).toBe("식이 너무 깁니다. 500자까지 쓸 수 있습니다(지금 501자).");
  });

  it("allows 200 nodes, not 201", () => {
    const sumOf = (n: number) => `sum(${Array.from({ length: n }, () => "1").join(",")})`;
    expect(run(sumOf(199))).toBe(199);
    expect(errorsOf(sumOf(200))).toEqual([{ pos: 0, message: "1번째 글자 근처: 식이 너무 복잡합니다. 노드는 200개까지 쓸 수 있습니다." }]);
  });

  it("allows depth 32, not 33", () => {
    const nested = (n: number) => `${"abs(".repeat(n)}1${")".repeat(n)}`;
    expect(run(nested(31))).toBe(1);
    expect(errorsOf(nested(32))).toEqual([{ pos: 0, message: "1번째 글자 근처: 식이 너무 깊게 중첩되어 있습니다. 32단계까지 쓸 수 있습니다." }]);
  });

  it("allows number literals up to 1e9 in absolute value", () => {
    expect(run("1000000000")).toBe(1e9);
    expect(run("-1000000000")).toBe(-1e9);
    expect(errorsOf("1 + 1000000001")).toEqual([{ pos: 4, message: "5번째 글자 근처: 숫자는 절댓값 1000000000 이하만 쓸 수 있습니다." }]);
    expect(firstError("1000000000.5")).toBe("1번째 글자 근처: 숫자는 절댓값 1000000000 이하만 쓸 수 있습니다.");
  });
});

describe("formula: names", () => {
  it("never resolves object built-ins as variables or functions", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(firstError(`${name} + 1`, WITH_VOTES)).toContain(`"${name}"는 쓸 수 없는 변수입니다.`);
      expect(firstError(`${name}(1)`, WITH_VOTES)).toContain(`알 수 없는 함수 "${name}"입니다.`);
      expect(() => evaluateAst({ k: "v", n: name }, {})).toThrow("값이 없습니다");
      expect(validateAst({ k: "c", f: name, a: [num(1)] }).ok).toBe(false);
    }
    expect(evaluateAst({ k: "v", n: "hasOwnProperty" }, { hasOwnProperty: 3 }).value).toBe(3);
  });

  it("reserves and, or, not", () => {
    expect(firstError("and + 1")).toContain("and, or, not은 예약어라 변수 이름으로 쓸 수 없습니다.");
    expect(firstError("1 + or")).toContain("예약어");
    expect(validateAst({ k: "v", n: "not" }).ok).toBe(false);
  });

  it("reads crit.<key> and critmax.<key> and rejects unknown keys", () => {
    expect(run("crit.arch / critmax.arch", { "crit.arch": 20, "critmax.arch": 25 })).toBe(0.8);
    expect(firstError("crit.nope", WITH_VOTES)).toContain('"crit.nope"는 쓸 수 없는 변수입니다.');
  });
});

describe("formula: error messages", () => {
  it("names an unknown function with its position and the functions available", () => {
    expect(errorsOf("0.85*judge+exp(1)", WITH_VOTES)).toEqual([
      { pos: 11, message: `12번째 글자 근처: 알 수 없는 함수 "exp"입니다. 쓸 수 있는 함수: ${FUNCTION_LIST}` },
    ]);
  });

  it("explains popular-vote variables while the add-on is off", () => {
    expect(errorsOf("0.85 * judge + votes", WITHOUT_VOTES)).toEqual([
      { pos: 15, message: '16번째 글자 근처: "votes"는 쓸 수 없는 변수입니다. 인기투표 add-on이 꺼져 있습니다.' },
    ]);
    expect(firstError("jduge + 1", WITHOUT_VOTES)).toBe(`1번째 글자 근처: "jduge"는 쓸 수 없는 변수입니다. 쓸 수 있는 변수: ${WITHOUT_VOTES.join(", ")}`);
  });

  it("points at the bracket that is never closed", () => {
    expect(errorsOf("sqrt(min(1, 2)")).toEqual([{ pos: 4, message: "5번째 글자 근처: 괄호가 닫히지 않았습니다." }]);
    expect(firstError("(1 + 2")).toBe("1번째 글자 근처: 괄호가 닫히지 않았습니다.");
  });

  it("reports every unknown name, in source order", () => {
    expect(errorsOf("exp(1) + votes + foo(2)", WITHOUT_VOTES).map((e) => e.pos)).toEqual([0, 9, 17]);
  });

  it("explains syntax slips", () => {
    expect(firstError("")).toBe("식이 비어 있습니다.");
    expect(firstError("   ")).toBe("식이 비어 있습니다.");
    expect(firstError("1 +")).toContain("식이 끝나기 전에 값(숫자, 변수, 함수, 괄호)이 하나 더 와야 합니다.");
    expect(firstError("1 + * 2")).toBe('5번째 글자 근처: "*" 앞에 값(숫자, 변수, 함수, 괄호)이 와야 합니다.');
    expect(firstError("1 2")).toBe('3번째 글자 근처: "2" 앞에 연산자(+, -, *, /, and, or 등)가 빠졌습니다.');
    expect(firstError("1)")).toContain("여는 괄호 없이 닫는 괄호가 나왔습니다.");
    expect(firstError("1, 2")).toContain("쉼표(,)는 함수 인자 사이에만 쓸 수 있습니다.");
    expect(firstError("min(1 2)")).toContain('"2" 앞에 쉼표(,)나 연산자가 빠졌습니다.');
    expect(firstError("min(1,)")).toContain('")" 앞에 값');
    expect(firstError("1 # 2")).toBe('3번째 글자 근처: 쓸 수 없는 문자 "#"입니다.');
    expect(firstError("judge = 1")).toContain("같은지 비교할 때는 ==를 씁니다.");
    expect(firstError("1.")).toContain("소수점 뒤에 숫자가 있어야 합니다.");
    expect(firstError("crit.")).toContain("점(.) 뒤에는 이름이 와야 합니다.");
    expect(firstError("a.b.c")).toContain("이름에는 점(.)을 한 번만 쓸 수 있습니다.");
  });
});

describe("formula: validateAst on tampered ASTs", () => {
  const rejects = (ast: unknown, text: string, allowed?: readonly string[]) => {
    const check = validateAst(ast, allowed);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.map((e) => e.message).join("\n")).toContain(text);
  };

  it("rejects unknown node kinds and operators", () => {
    rejects({ k: "x" }, '알 수 없는 노드 종류 "x"입니다.');
    rejects({ k: "b", o: "%", a: num(1), b: num(2) }, '알 수 없는 이항 연산자 "%"입니다.');
    rejects({ k: "u", o: "!", a: num(1) }, '알 수 없는 단항 연산자 "!"입니다.');
    for (const notNode of [null, 5, "x", [], undefined]) rejects(notNode, "노드가 아닌 값입니다");
    rejects({ k: "u", o: "-" }, "노드가 아닌 값입니다: undefined");
  });

  it("rejects bad calls", () => {
    rejects({ k: "c", f: "clamp", a: [num(1), num(2)] }, '"clamp" 함수는 인자를 3개 받습니다(지금 2개).');
    rejects({ k: "c", f: "min", a: [] }, '"min" 함수는 인자를 1개 이상 받습니다(지금 0개).');
    rejects({ k: "c", f: "exp", a: [num(1)] }, '알 수 없는 함수 "exp"입니다.');
    rejects({ k: "c", f: "sum", a: {} }, "함수의 인자 목록이 배열이 아닙니다.");
    rejects({ k: "c", f: "round", a: [num(1), { k: "v", n: "x" }] }, "두 번째 인자(자릿수)");
  });

  it("rejects bad numbers and names", () => {
    rejects({ k: "n", v: "5" }, "숫자 노드의 값이 유한한 수가 아닙니다");
    rejects({ k: "n", v: Number.NaN }, "숫자 노드의 값이 유한한 수가 아닙니다");
    rejects({ k: "n", v: 1e10 }, "숫자는 절댓값 1000000000 이하만");
    expect(validateAst({ k: "n", v: -5 }).ok).toBe(true);
    rejects({ k: "v", n: "a b" }, "올바르지 않은 변수 이름입니다");
    rejects({ k: "v", n: "a.b.c" }, "올바르지 않은 변수 이름입니다");
    rejects({ k: "v", n: "votes" }, '"votes"는 쓸 수 없는 변수입니다.', ["judge"]);
    expect(validateAst({ k: "v", n: "votes" }).ok).toBe(true);
  });

  it("stops at the depth and node limits", () => {
    expect(validateAst(nest(31, num(1))).ok).toBe(true);
    rejects(nest(32, num(1)), "32단계까지");
    rejects(nest(100000, num(1)), "32단계까지");
    expect(validateAst({ k: "c", f: "sum", a: Array.from({ length: 199 }, () => num(1)) }).ok).toBe(true);
    rejects({ k: "c", f: "sum", a: Array.from({ length: 300 }, () => num(1)) }, "노드는 200개까지");
  });

  it("says where the problem is", () => {
    const check = validateAst({ k: "b", o: "+", a: num(1), b: { k: "c", f: "max", a: [num(1), { k: "q" }] } });
    expect(check).toEqual({ ok: false, errors: [{ path: "$.b.a[1]", message: '알 수 없는 노드 종류 "q"입니다.' }] });
  });

  it("refuses to evaluate what it rejects", () => {
    expect(() => evaluateAst({ k: "c", f: "constructor", a: [] } as unknown as Ast, {})).toThrow("수식 AST가 올바르지 않아 계산하지 않았습니다.");
    expect(() => evaluateAst({ k: "n", v: "5" } as unknown as Ast, {})).toThrow("$: 숫자 노드의 값이 유한한 수가 아닙니다");
  });
});

describe("formula: reference case (design doc 3.4)", () => {
  const popularPart = compile("15 * sqrt(min(1, votes / (2 * avg_votes)))", WITH_VOTES);
  const reference = compile(REFERENCE_FORMULA, WITH_VOTES);

  it("gives the popular-vote part of the table (10 teams, 180 votes, average 18)", () => {
    const table: [number, number][] = [[80, 15], [36, 15], [27, 12.99], [18, 10.61], [9, 7.5], [3, 4.33], [0, 0]];
    for (const [votes, expected] of table) {
      expect(roundTo(evaluateAst(popularPart, { votes, avg_votes: 18 }).value, 2)).toBe(expected);
    }
  });

  it("gives S = 80.99 and S = 63.83", () => {
    expect(roundTo(evaluateAst(reference, { judge: 80, votes: 27, avg_votes: 18 }).value, 2)).toBe(80.99);
    expect(roundTo(evaluateAst(reference, { judge: 70, votes: 3, avg_votes: 18 }).value, 2)).toBe(63.83);
  });

  it("needs the popular_vote add-on for the reference formula, not for its tie_break", () => {
    expect(compileFormula(REFERENCE_FORMULA, WITHOUT_VOTES).ok).toBe(false);
    expect(errorsOf(REFERENCE_FORMULA, WITHOUT_VOTES).map((e) => e.pos)).toEqual([32, 45]);
    expect(run("crit.arch", { "crit.arch": 21.25 })).toBe(21.25);
    expect(compileFormula("judge", WITHOUT_VOTES).ok).toBe(true);
  });
});

describe("roundTo", () => {
  it("rounds through the decimal form and never returns -0", () => {
    expect(roundTo(80.99038105676658, 2)).toBe(80.99);
    expect(roundTo(0.5)).toBe(1);
    expect(roundTo(1e-7, 2)).toBe(0);
    expect(roundTo(1.5e21)).toBe(1.5e21);
    expect(roundTo(Infinity, 2)).toBe(Infinity);
    expect(Object.is(roundTo(-0.001, 2), 0)).toBe(true);
    expect(() => roundTo(1, 2.5)).toThrow("정수");
  });

  it("keeps values from 2^53 up as they are instead of overflowing to NaN", () => {
    expect(roundTo(1e303, 6)).toBe(1e303);
    expect(roundTo(1e302, 9)).toBe(1e302);
    expect(roundTo(-Number.MAX_VALUE, 2)).toBe(-Number.MAX_VALUE);
    expect(roundTo(2 ** 53 + 2, 2)).toBe(2 ** 53 + 2);
  });
});
