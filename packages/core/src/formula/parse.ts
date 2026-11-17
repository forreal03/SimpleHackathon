// Formula source → AST (design doc 2.2, 2.5): a tokenizer and a Pratt parser. Node-side only; the
// server receives the AST and never parses source.
import type { Ast, BinaryOp, CompileError, CompileResult, FuncName } from "../runtime/types.js";
import {
  DEPTH_LIMIT_MESSAGE,
  FUNCTIONS,
  LIMITS,
  NODE_LIMIT_MESSAGE,
  NUMBER_LIMIT_MESSAGE,
  ROUND_DIGITS_MESSAGE,
  arityMessage,
  isFuncName,
  isReserved,
  isRoundDigits,
  unknownFunctionMessage,
} from "../runtime/formula/ast.js";
import { validateAst } from "../runtime/formula/evaluate.js";
import { POPULAR_VARS } from "../runtime/scoring.js";

/**
 * Parses a formula and checks every variable against `allowedVars` (see scoringVariables).
 * Problems carry a 0-based `pos`, and their Korean messages say where ("12번째 글자 근처: ...").
 * Syntax errors stop at the first one; unknown functions, argument counts and variables are all
 * reported.
 */
export function compileFormula(source: string, allowedVars: readonly string[]): CompileResult {
  if (source.length > LIMITS.length) {
    return { ok: false, errors: [{ pos: LIMITS.length, message: `식이 너무 깁니다. ${LIMITS.length}자까지 쓸 수 있습니다(지금 ${source.length}자).` }] };
  }
  if (source.trim() === "") return { ok: false, errors: [{ pos: 0, message: "식이 비어 있습니다." }] };

  const errors: CompileError[] = [];
  let ast: Ast | null = null;
  try {
    ast = new Parser(tokenize(source, errors), allowedVars, errors).parse();
  } catch (e) {
    if (!(e instanceof SyntaxFail)) throw e;
    errors.push(located(e.pos, e.message));
  }
  if (errors.length > 0 || !ast) return { ok: false, errors: errors.sort((a, b) => a.pos - b.pos) };

  // The runtime re-checks every AST; a parser result it would reject is a bug, never a valid formula.
  const check = validateAst(ast, allowedVars);
  if (!check.ok) return { ok: false, errors: check.errors.map((e) => ({ pos: 0, message: `${e.path}: ${e.message}` })) };
  return { ok: true, ast };
}

function located(pos: number, detail: string): CompileError {
  return { pos, message: `${pos + 1}번째 글자 근처: ${detail}` };
}

/** Thrown inside the parser for problems after which parsing cannot go on. */
class SyntaxFail extends Error {
  constructor(
    readonly pos: number,
    message: string,
  ) {
    super(message);
  }
}

// ── tokens ───────────────────────────────────────────────────────────────────────────────────

type TokenType = "num" | "name" | "keyword" | "op" | "(" | ")" | "," | "end";

interface Token {
  type: TokenType;
  text: string;
  pos: number;
  /** Numeric value of a "num" token. */
  value: number;
}

/** Longest first, so "<=" wins over "<". */
const OPERATORS = ["<=", ">=", "==", "!=", "+", "-", "*", "/", "^", "<", ">"];

/** What people often type from other languages. */
const CHAR_HINTS: Record<string, string> = {
  "=": "같은지 비교할 때는 ==를 씁니다.",
  "!": "부정은 not, 다른지 비교할 때는 !=를 씁니다.",
  "&": "그리고는 and를 씁니다.",
  "|": "또는은 or를 씁니다.",
};

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";
const isIdentStart = (ch: string | undefined) => ch !== undefined && /[A-Za-z_]/.test(ch);
const isIdentPart = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

function tokenize(src: string, errors: CompileError[]): Token[] {
  const tokens: Token[] = [];
  const push = (type: TokenType, start: number, end: number, value = 0) => tokens.push({ type, text: src.slice(start, end), pos: start, value });
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const start = i;
    if (/\s/.test(ch)) {
      i++;
    } else if (isDigit(ch)) {
      while (isDigit(src[i])) i++;
      if (src[i] === ".") {
        if (!isDigit(src[i + 1])) throw new SyntaxFail(i, "소수점 뒤에 숫자가 있어야 합니다.");
        i++;
        while (isDigit(src[i])) i++;
      }
      const value = Number(src.slice(start, i));
      if (value > LIMITS.number) errors.push(located(start, NUMBER_LIMIT_MESSAGE));
      push("num", start, i, value);
    } else if (isIdentStart(ch)) {
      while (isIdentPart(src[i])) i++;
      if (src[i] === ".") {
        if (!isIdentStart(src[i + 1])) throw new SyntaxFail(i, "점(.) 뒤에는 이름이 와야 합니다.");
        i++;
        while (isIdentPart(src[i])) i++;
        if (src[i] === ".") throw new SyntaxFail(i, "이름에는 점(.)을 한 번만 쓸 수 있습니다.");
      }
      push(isReserved(src.slice(start, i)) ? "keyword" : "name", start, i);
    } else if (ch === "(" || ch === ")" || ch === ",") {
      i++;
      push(ch, start, i);
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (!op) {
        const shown = String.fromCodePoint(src.codePointAt(i) ?? 0);
        throw new SyntaxFail(i, `쓸 수 없는 문자 "${shown}"입니다.${Object.hasOwn(CHAR_HINTS, ch) ? ` ${CHAR_HINTS[ch]}` : ""}`);
      }
      i += op.length;
      push("op", start, i);
    }
  }
  tokens.push({ type: "end", text: "", pos: src.length, value: 0 });
  return tokens;
}

// ── Pratt parser ─────────────────────────────────────────────────────────────────────────────

/** Binding powers, loosest first. `not` and unary `-` are prefix; their operands bind at NOT / UNARY. */
const BP = { or: 10, and: 20, not: 30, cmp: 40, add: 50, mul: 60, unary: 70, pow: 80 } as const;

interface Infix {
  op: BinaryOp;
  /** How strongly the operator binds to its left. */
  lbp: number;
  /** Binding power its right operand is parsed with: lbp for left-assoc, below it for right-assoc. */
  rbp: number;
}

function infixOf(tok: Token): Infix | null {
  if (tok.type === "keyword") {
    if (tok.text === "or") return { op: "or", lbp: BP.or, rbp: BP.or };
    if (tok.text === "and") return { op: "and", lbp: BP.and, rbp: BP.and };
    return null;
  }
  if (tok.type !== "op") return null;
  const op = tok.text as BinaryOp;
  switch (op) {
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "==":
    case "!=":
      return { op, lbp: BP.cmp, rbp: BP.cmp };
    case "+":
    case "-":
      return { op, lbp: BP.add, rbp: BP.add };
    case "*":
    case "/":
      return { op, lbp: BP.mul, rbp: BP.mul };
    case "^":
      // pow := primary ( "^" unary )?  — the right side is a unary, which makes ^ right-associative.
      return { op, lbp: BP.pow, rbp: BP.unary };
    default:
      return null;
  }
}

function childrenOf(node: Ast): Ast[] {
  switch (node.k) {
    case "u":
      return [node.a];
    case "b":
      return [node.a, node.b];
    case "c":
      return node.a;
    default:
      return [];
  }
}

class Parser {
  private at = 0;
  private nodeCount = 0;
  private readonly depthOf = new Map<Ast, number>();
  private readonly posOf = new Map<Ast, number>();

  constructor(
    private readonly tokens: Token[],
    private readonly allowedVars: readonly string[],
    private readonly errors: CompileError[],
  ) {}

  parse(): Ast {
    const ast = this.expr(0);
    const tok = this.peek();
    if (tok.type !== "end") this.failAfterValue(tok);
    return ast;
  }

  private peek(): Token {
    return this.tokens[this.at]!;
  }

  private next(): Token {
    const tok = this.tokens[this.at]!;
    if (tok.type !== "end") this.at++;
    return tok;
  }

  private expr(rbp: number): Ast {
    let left = this.prefix(rbp);
    for (;;) {
      const tok = this.peek();
      const infix = infixOf(tok);
      if (!infix || infix.lbp <= rbp) return left;
      this.next();
      const right = this.expr(infix.rbp);
      left = this.node({ k: "b", o: infix.op, a: left, b: right }, tok.pos);
      // cmp := add ( op add )? — comparisons do not chain.
      if (infix.lbp === BP.cmp && infixOf(this.peek())?.lbp === BP.cmp) {
        throw new SyntaxFail(this.peek().pos, "비교 연산자는 한 번에 하나만 쓸 수 있습니다. 괄호로 묶어 주세요.");
      }
    }
  }

  private prefix(rbp: number): Ast {
    const tok = this.next();
    switch (tok.type) {
      case "num":
        return this.node({ k: "n", v: tok.value }, tok.pos);
      case "name":
        return this.peek().type === "(" ? this.call(tok) : this.variable(tok);
      case "(": {
        const inner = this.expr(0);
        const close = this.peek();
        if (close.type === "end") throw new SyntaxFail(tok.pos, "괄호가 닫히지 않았습니다.");
        if (close.type !== ")") this.failAfterValue(close);
        this.next();
        return inner;
      }
      case "op":
        if (tok.text === "-") return this.node({ k: "u", o: "-", a: this.expr(BP.unary) }, tok.pos);
        break;
      case "keyword":
        if (tok.text === "not") {
          // not := "not" not | cmp — so `not` cannot stand right after +, *, <, - and the like.
          if (rbp > BP.not) throw new SyntaxFail(tok.pos, '"not"은 이 자리에 바로 쓸 수 없습니다. (not ...)처럼 괄호로 묶어 주세요.');
          return this.node({ k: "u", o: "not", a: this.expr(BP.not) }, tok.pos);
        }
        break;
      case "end":
        throw new SyntaxFail(tok.pos, "식이 끝나기 전에 값(숫자, 변수, 함수, 괄호)이 하나 더 와야 합니다.");
    }
    if (tok.type === "keyword") {
      throw new SyntaxFail(tok.pos, `"${tok.text}" 앞에 값이 와야 합니다. and, or, not은 예약어라 변수 이름으로 쓸 수 없습니다.`);
    }
    throw new SyntaxFail(tok.pos, `"${tok.text}" 앞에 값(숫자, 변수, 함수, 괄호)이 와야 합니다.`);
  }

  private call(name: Token): Ast {
    const open = this.next();
    const args: Ast[] = [];
    if (this.peek().type === ")") this.next();
    else {
      for (;;) {
        args.push(this.expr(0));
        const tok = this.next();
        if (tok.type === ")") break;
        if (tok.type === ",") continue;
        if (tok.type === "end") throw new SyntaxFail(open.pos, "괄호가 닫히지 않았습니다.");
        throw new SyntaxFail(tok.pos, `"${tok.text}" 앞에 쉼표(,)나 연산자가 빠졌습니다.`);
      }
    }
    this.checkCall(name, args);
    return this.node({ k: "c", f: name.text as FuncName, a: args }, name.pos);
  }

  private checkCall(name: Token, args: Ast[]): void {
    const f = name.text;
    if (!isFuncName(f)) {
      this.errors.push(located(name.pos, unknownFunctionMessage(`"${f}"`)));
      return;
    }
    const { min, max } = FUNCTIONS[f];
    if (args.length < min || args.length > max) this.errors.push(located(name.pos, arityMessage(f, args.length)));
    else if (f === "round" && args.length === 2 && !isRoundDigits(args[1])) {
      this.errors.push(located(this.posOf.get(args[1]!) ?? name.pos, ROUND_DIGITS_MESSAGE));
    }
  }

  private variable(tok: Token): Ast {
    if (this.allowedVars.indexOf(tok.text) < 0) this.errors.push(located(tok.pos, unknownVariableMessage(tok.text, this.allowedVars)));
    return this.node({ k: "v", n: tok.text }, tok.pos);
  }

  /** Something other than an operator right after a complete value. */
  private failAfterValue(tok: Token): never {
    if (tok.type === ")") throw new SyntaxFail(tok.pos, "여는 괄호 없이 닫는 괄호가 나왔습니다.");
    if (tok.type === ",") throw new SyntaxFail(tok.pos, "쉼표(,)는 함수 인자 사이에만 쓸 수 있습니다.");
    throw new SyntaxFail(tok.pos, `"${tok.text}" 앞에 연산자(+, -, *, /, and, or 등)가 빠졌습니다.`);
  }

  /** Registers a new node, enforcing the node and depth limits at the token that made it. */
  private node<T extends Ast>(node: T, pos: number): T {
    let depth = 1;
    for (const child of childrenOf(node)) depth = Math.max(depth, 1 + (this.depthOf.get(child) ?? 1));
    this.nodeCount += 1;
    if (this.nodeCount > LIMITS.nodes) throw new SyntaxFail(pos, NODE_LIMIT_MESSAGE);
    if (depth > LIMITS.depth) throw new SyntaxFail(pos, DEPTH_LIMIT_MESSAGE);
    this.depthOf.set(node, depth);
    this.posOf.set(node, pos);
    return node;
  }
}

function unknownVariableMessage(name: string, allowedVars: readonly string[]): string {
  const head = `"${name}"는 쓸 수 없는 변수입니다.`;
  if ((POPULAR_VARS as readonly string[]).includes(name)) return `${head} 인기투표 add-on이 꺼져 있습니다.`;
  return allowedVars.length > 0 ? `${head} 쓸 수 있는 변수: ${allowedVars.join(", ")}` : head;
}
