// What dist/runtime.gs.js exposes as the global `SHK` (and what Node gets from the package root).
// Everything reachable from here must run on Apps Script V8: no Node APIs, zod or yaml.
export type * from "./types.js";
export {
  BINARY_OPS,
  FUNCTIONS,
  FUNCTION_NAMES,
  LIMITS,
  RESERVED_WORDS,
  UNARY_OPS,
  type Arity,
} from "./formula/ast.js";
export { evaluateAst, validateAst } from "./formula/evaluate.js";
export { roundTo } from "./util.js";
export * from "./scoring.js";
export * from "./ranking.js";
export * from "./eligibility.js";
