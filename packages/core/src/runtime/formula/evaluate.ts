// AST check and interpreter for the formula language (design doc 2.3–2.4). The server runs these
// on the AST from event.json, so every input is treated as untrusted data.
import type { Ast, AstCheck, AstIssue, BinaryNode, CallNode, Evaluation, FormulaVars } from "../types.js";
import { hasOwn, roundTo } from "../util.js";
import {
  DEPTH_LIMIT_MESSAGE,
  FUNCTIONS,
  LIMITS,
  NAME_RE,
  NODE_LIMIT_MESSAGE,
  NUMBER_LIMIT_MESSAGE,
  ROUND_DIGITS_MESSAGE,
  arityMessage,
  isBinaryOp,
  isFuncName,
  isReserved,
  isRoundDigits,
  isUnaryOp,
  unknownFunctionMessage,
} from "./ast.js";

const POW_WARNING = "거듭제곱(^) 결과가 유한한 수가 아니어서 0으로 바꿨습니다.";
/** Also used by the weighted-sum final score (scoring.ts). */
export const RESULT_WARNING = "계산 결과가 유한한 수가 아니어서 0으로 바꿨습니다.";

/**
 * Checks node kinds, operators, function names, argument counts, limits and variable names
 * (against `allowedVars` when given). Returns the input typed as an Ast only when nothing is wrong.
 */
export function validateAst(ast: unknown, allowedVars?: readonly string[]): AstCheck {
  const errors: AstIssue[] = [];
  let nodes = 0;
  let stopped = false;
  const fail = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  const visit = (node: unknown, path: string, depth: number): void => {
    if (stopped) return;
    nodes += 1;
    if (nodes > LIMITS.nodes || depth > LIMITS.depth) {
      stopped = true;
      return fail(path, nodes > LIMITS.nodes ? NODE_LIMIT_MESSAGE : DEPTH_LIMIT_MESSAGE);
    }
    if (typeof node !== "object" || node === null || Array.isArray(node)) return fail(path, `노드가 아닌 값입니다: ${show(node)}`);
    const n = node as Record<string, unknown>;
    switch (n.k) {
      case "n":
        return checkNumber(n.v, path);
      case "v":
        return checkVariable(n.n, path);
      case "u":
        if (!isUnaryOp(n.o)) fail(path, `알 수 없는 단항 연산자 ${show(n.o)}입니다.`);
        return visit(n.a, `${path}.a`, depth + 1);
      case "b":
        if (!isBinaryOp(n.o)) fail(path, `알 수 없는 이항 연산자 ${show(n.o)}입니다.`);
        visit(n.a, `${path}.a`, depth + 1);
        return visit(n.b, `${path}.b`, depth + 1);
      case "c":
        return checkCall(n.f, n.a, path, depth);
      default:
        return fail(path, `알 수 없는 노드 종류 ${show(n.k)}입니다.`);
    }
  };

  const checkNumber = (v: unknown, path: string): void => {
    if (typeof v !== "number" || !Number.isFinite(v)) fail(path, `숫자 노드의 값이 유한한 수가 아닙니다: ${show(v)}`);
    else if (Math.abs(v) > LIMITS.number) fail(path, NUMBER_LIMIT_MESSAGE);
  };

  const checkVariable = (name: unknown, path: string): void => {
    if (typeof name !== "string" || !NAME_RE.test(name) || isReserved(name)) fail(path, `올바르지 않은 변수 이름입니다: ${show(name)}`);
    else if (allowedVars && allowedVars.indexOf(name) < 0) fail(path, `${show(name)}는 쓸 수 없는 변수입니다.`);
  };

  const checkCall = (f: unknown, args: unknown, path: string, depth: number): void => {
    if (!isFuncName(f)) fail(path, unknownFunctionMessage(show(f)));
    if (!Array.isArray(args)) return fail(path, "함수의 인자 목록이 배열이 아닙니다.");
    if (isFuncName(f)) {
      const { min, max } = FUNCTIONS[f];
      if (args.length < min || args.length > max) fail(path, arityMessage(f, args.length));
      else if (f === "round" && args.length === 2 && !isRoundDigits(args[1])) fail(`${path}.a[1]`, ROUND_DIGITS_MESSAGE);
    }
    for (let i = 0; i < args.length && !stopped; i++) visit(args[i], `${path}.a[${i}]`, depth + 1);
  };

  visit(ast, "$", 1);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, ast: ast as Ast };
}

/**
 * Interprets an AST with the given variable values (design doc 2.3). The AST is validated first and
 * a variable missing from `vars` is an error: both throw instead of computing a value. Division by
 * zero gives 0; a non-finite `^` result or final result becomes 0 with a warning. Never returns -0.
 */
export function evaluateAst(ast: Ast, vars: FormulaVars): Evaluation {
  const check = validateAst(ast);
  if (!check.ok) {
    const detail = check.errors.map((e) => `${e.path}: ${e.message}`).join(" / ");
    throw new Error(`수식 AST가 올바르지 않아 계산하지 않았습니다. ${detail}`);
  }
  const warnings: string[] = [];
  const finiteOrZero = (value: number, warning: string): number => {
    if (Number.isFinite(value)) return value;
    if (warnings.indexOf(warning) < 0) warnings.push(warning);
    return 0;
  };

  const evalNode = (node: Ast): number => {
    switch (node.k) {
      case "n":
        return node.v;
      case "v":
        return variable(vars, node.n);
      case "u": {
        const a = evalNode(node.a);
        return node.o === "-" ? -a : truthy(a) ? 0 : 1;
      }
      case "b":
        return evalBinary(node);
      case "c":
        return evalCall(node);
    }
  };

  const evalBinary = (node: BinaryNode): number => {
    const a = evalNode(node.a);
    if (node.o === "and") return truthy(a) && truthy(evalNode(node.b)) ? 1 : 0;
    if (node.o === "or") return truthy(a) || truthy(evalNode(node.b)) ? 1 : 0;
    const b = evalNode(node.b);
    switch (node.o) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? 0 : a / b;
      case "^":
        return finiteOrZero(Math.pow(a, b), POW_WARNING);
      case "<":
        return a < b ? 1 : 0;
      case "<=":
        return a <= b ? 1 : 0;
      case ">":
        return a > b ? 1 : 0;
      case ">=":
        return a >= b ? 1 : 0;
      case "==":
        return a === b ? 1 : 0;
      case "!=":
        return a !== b ? 1 : 0;
    }
  };

  const evalCall = (node: CallNode): number => {
    const args = node.a;
    // Only the chosen branch is evaluated.
    if (node.f === "if") return truthy(evalNode(args[0]!)) ? evalNode(args[1]!) : evalNode(args[2]!);
    const values = args.map(evalNode);
    const [x = 0, y = 0, z = 0] = values;
    switch (node.f) {
      case "min":
        return Math.min(...values);
      case "max":
        return Math.max(...values);
      case "sum":
        return sum(values);
      case "avg":
        return sum(values) / values.length;
      case "abs":
        return Math.abs(x);
      case "sqrt":
        return x < 0 ? 0 : Math.sqrt(x);
      case "round":
        return roundTo(x, y);
      case "floor":
        return Math.floor(x);
      case "ceil":
        return Math.ceil(x);
      case "clamp":
        return Math.min(Math.max(x, y), z);
    }
  };

  const value = finiteOrZero(evalNode(ast), RESULT_WARNING);
  return { value: value === 0 ? 0 : value, warnings };
}

/** Any value other than 0 is true (design doc 2.3). */
function truthy(x: number): boolean {
  return x !== 0;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function variable(vars: FormulaVars, name: string): number {
  const value = hasOwn(vars, name) ? vars[name] : undefined;
  if (typeof value !== "number") throw new Error(`수식 변수 "${name}"의 값이 없습니다.`);
  return value;
}

/** Short, inert description of an untrusted value for messages. */
function show(value: unknown): string {
  if (typeof value === "string") return value.length > 40 ? `${JSON.stringify(value.slice(0, 40))}…` : JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return String(value);
  return Array.isArray(value) ? "배열" : typeof value === "object" ? "객체" : typeof value;
}
