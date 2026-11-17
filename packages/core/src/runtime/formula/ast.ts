// Tables of the formula language (design doc 2.2–2.4): operators, functions with their arity, and
// limits. The node shapes themselves are in ../types.ts. Membership checks go through arrays, never
// through `key in object`, so names like "constructor" or "__proto__" never match.
import type { BinaryOp, FuncName, UnaryOp } from "../types.js";

export const UNARY_OPS: readonly UnaryOp[] = ["-", "not"];

export const BINARY_OPS: readonly BinaryOp[] = ["+", "-", "*", "/", "^", "<", "<=", ">", ">=", "==", "!=", "and", "or"];

/** Keywords; they cannot be variable or function names. */
export const RESERVED_WORDS: readonly string[] = ["and", "or", "not"];

/** How many arguments a function takes. `max` is Infinity for the variadic ones. */
export interface Arity {
  min: number;
  max: number;
}

/** Functions with their arity, in the order error messages list them. */
export const FUNCTIONS: Readonly<Record<FuncName, Arity>> = {
  min: { min: 1, max: Infinity },
  max: { min: 1, max: Infinity },
  sum: { min: 1, max: Infinity },
  avg: { min: 1, max: Infinity },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  clamp: { min: 3, max: 3 },
  if: { min: 3, max: 3 },
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as FuncName[];

export const LIMITS = {
  /** Characters of source. */
  length: 500,
  /** AST nodes. */
  nodes: 200,
  /** AST depth; a lone literal has depth 1. */
  depth: 32,
  /** Largest absolute value of a number literal. */
  number: 1e9,
  /** round(x, d): d must be an integer literal from 0 to this. */
  roundDigits: 6,
} as const;

/** NAME of design doc 2.2: an identifier with at most one ".part", e.g. `judge`, `crit.idea`. */
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export function isUnaryOp(value: unknown): value is UnaryOp {
  return typeof value === "string" && UNARY_OPS.indexOf(value as UnaryOp) >= 0;
}

export function isBinaryOp(value: unknown): value is BinaryOp {
  return typeof value === "string" && BINARY_OPS.indexOf(value as BinaryOp) >= 0;
}

export function isFuncName(value: unknown): value is FuncName {
  return typeof value === "string" && FUNCTION_NAMES.indexOf(value as FuncName) >= 0;
}

export function isReserved(name: string): boolean {
  return RESERVED_WORDS.indexOf(name) >= 0;
}

/** The second argument of round(): an integer number literal from 0 to LIMITS.roundDigits. */
export function isRoundDigits(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const { k, v } = node as { k?: unknown; v?: unknown };
  return k === "n" && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= LIMITS.roundDigits;
}

// Messages the parser and the AST validator share, so a problem reads the same from both.

/** `name` is shown as given, so callers quote it. */
export function unknownFunctionMessage(name: string): string {
  return `알 수 없는 함수 ${name}입니다. 쓸 수 있는 함수: ${FUNCTION_NAMES.join(", ")}`;
}

export function arityMessage(f: FuncName, got: number): string {
  const { min, max } = FUNCTIONS[f];
  const want = max === Infinity ? `${min}개 이상` : min === max ? `${min}개` : `${min}~${max}개`;
  return `"${f}" 함수는 인자를 ${want} 받습니다(지금 ${got}개).`;
}

export const ROUND_DIGITS_MESSAGE = `"round" 함수의 두 번째 인자(자릿수)는 0~${LIMITS.roundDigits} 사이의 정수로 적어야 합니다.`;

export const NUMBER_LIMIT_MESSAGE = `숫자는 절댓값 ${LIMITS.number} 이하만 쓸 수 있습니다.`;

export const NODE_LIMIT_MESSAGE = `식이 너무 복잡합니다. 노드는 ${LIMITS.nodes}개까지 쓸 수 있습니다.`;

export const DEPTH_LIMIT_MESSAGE = `식이 너무 깊게 중첩되어 있습니다. ${LIMITS.depth}단계까지 쓸 수 있습니다.`;
