// Condition language, applicant eligibility and team divisions (design doc 4).
import type {
  Answer,
  Cond,
  CondFailure,
  CondOp,
  CondResult,
  DivisionDef,
  DivisionMode,
  DivisionResult,
  EligibilityResult,
  EligibilityRule,
  FieldCond,
  Person,
  TeamForDivision,
  TrackDivisionSpec,
} from "./types.js";
import { hasOwn } from "./util.js";

/** Operators of a field check, in the order design doc 4.1 lists them. */
export const COND_OPS: readonly CondOp[] = ["eq", "ne", "in", "nin", "gt", "gte", "lt", "lte", "matches", "exists", "domain_in"];

/** `matches` reads at most this many characters of the answer. */
export const MATCH_INPUT_LIMIT = 200;

/** Most ways a `matches` pattern may have to split one answer (see matchesProblem). */
const MATCH_WAYS_LIMIT = 1e7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^\s*-?\d+(?:\.\d+)?\s*$/;

/**
 * Evaluates a condition against one person (design doc 4.1). `email` and `email_domain` read the
 * verified email (the domain in lower case, and so is text compared with it); any other field reads
 * `person.answers`. No answer (absent, null, blank text, or an array with nothing but blank text)
 * fails every check except `ne`, `nin` and `exists: false`. On an array answer `eq`, `in`, the
 * comparisons, `matches` and `domain_in` pass when any element passes; `ne` and `nin` pass when
 * none matches. `eq`/`in` compare the text of the values, so the answer "3" equals 3.
 * Failures carry condition-side facts only (path, field, op), never anyone's answer.
 * A malformed condition, or a `matches` pattern matchesProblem refuses, throws instead of being
 * guessed at.
 */
export function evaluateCondition(cond: Cond, person: Person): CondResult {
  const failed: CondFailure[] = [];
  const ok = check(cond, person, "", failed);
  return { ok, failed: ok ? [] : failed };
}

/** Keys that say what kind of condition an object is; at most one may be present. */
const COND_KINDS = ["all", "any", "not", "field"];

function check(cond: Cond, person: Person, path: string, failed: CondFailure[]): boolean {
  if (typeof cond !== "object" || cond === null || Array.isArray(cond)) throw malformed(path);
  if (COND_KINDS.filter((k) => hasOwn(cond, k)).length > 1) throw malformed(path);
  if (hasOwn(cond, "all")) return checkGroup("all", (cond as { all: unknown }).all, person, path, failed);
  if (hasOwn(cond, "any")) return checkGroup("any", (cond as { any: unknown }).any, person, path, failed);
  if (hasOwn(cond, "not")) {
    const inner = (cond as { not: Cond }).not;
    if (!check(inner, person, join(path, "not"), [])) return true;
    failed.push({ path, field: null, op: "not" });
    return false;
  }
  if (hasOwn(cond, "field")) return checkField(cond as FieldCond, person, path, failed);
  if (Object.keys(cond).length === 0) return true;
  throw malformed(path);
}

/** `all` reports every failing child; `any` reports itself and then why each child failed. */
function checkGroup(op: "all" | "any", list: unknown, person: Person, path: string, failed: CondFailure[]): boolean {
  if (!Array.isArray(list)) throw malformed(path);
  if (op === "all") {
    let ok = true;
    list.forEach((child: Cond, i) => {
      if (!check(child, person, join(path, `all[${i}]`), failed)) ok = false;
    });
    return ok;
  }
  const reasons: CondFailure[] = [];
  for (let i = 0; i < list.length; i++) {
    if (check(list[i] as Cond, person, join(path, `any[${i}]`), reasons)) return true;
  }
  failed.push({ path, field: null, op: "any" }, ...reasons);
  return false;
}

function checkField(cond: FieldCond, person: Person, path: string, failed: CondFailure[]): boolean {
  const ops = COND_OPS.filter((op) => hasOwn(cond, op));
  if (typeof cond.field !== "string" || ops.length !== 1) throw malformed(path);
  const op = ops[0]!;
  const value = (cond as unknown as Record<CondOp, unknown>)[op];
  const expected = op === "matches" ? compiledPattern(value, path) : cond.field === "email_domain" ? lowerText(value) : value;
  const ok = testField(op, expected, answered(fieldValue(person, cond.field)));
  if (!ok) failed.push({ path, field: cond.field, op });
  return ok;
}

function fieldValue(person: Person, field: string): Answer | undefined {
  if (field === "email") return person.email;
  if (field === "email_domain") return domainOf(person.email);
  return hasOwn(person.answers, field) ? person.answers[field] : undefined;
}

/** The answer as a list without blank text; null when nothing is left, which counts as no answer. */
function answered(answer: Answer | undefined): (string | number)[] | null {
  const list: readonly unknown[] = Array.isArray(answer) ? answer : [answer];
  const kept = list.filter((x): x is string | number => x !== null && x !== undefined && !(typeof x === "string" && x.trim() === ""));
  return kept.length > 0 ? kept : null;
}

/** email_domain is read in lower case, so text compared with it is lowered too (Example.ac.kr). */
function lowerText(value: unknown): unknown {
  const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
  return Array.isArray(value) ? value.map(lower) : lower(value);
}

/** Without an answer only ne, nin and exists: false pass; otherwise any element passing is enough (see evaluateCondition). */
function testField(op: CondOp, expected: unknown, values: readonly (string | number)[] | null): boolean {
  if (values === null) return op === "ne" || op === "nin" || (op === "exists" && expected === false);
  switch (op) {
    case "exists":
      return expected === true;
    case "eq":
      return values.some((x) => same(x, expected));
    case "ne":
      return !values.some((x) => same(x, expected));
    case "in":
      return values.some((x) => inList(x, expected));
    case "nin":
      return !values.some((x) => inList(x, expected));
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return values.some((x) => compare(op, x, expected));
    case "matches": {
      const re = expected as RegExp;
      return values.some((x) => re.test(String(x).slice(0, MATCH_INPUT_LIMIT)));
    }
    case "domain_in":
      return values.some((x) => {
        const domain = domainOf(String(x)) ?? String(x).toLowerCase();
        return Array.isArray(expected) && expected.some((d) => String(d).toLowerCase() === domain);
      });
  }
}

function same(x: string | number, expected: unknown): boolean {
  return (typeof expected === "string" || typeof expected === "number") && String(x) === String(expected);
}

function inList(x: string | number, list: unknown): boolean {
  return Array.isArray(list) && list.some((v) => same(x, v));
}

/** Numbers with numbers (an answer may be numeric text), "YYYY-MM-DD" dates with dates. */
function compare(op: "gt" | "gte" | "lt" | "lte", x: string | number, expected: unknown): boolean {
  let a: number | string;
  let b: number | string;
  if (typeof expected === "number") {
    a = typeof x === "number" ? x : NUMBER_RE.test(x) ? Number(x) : NaN;
    b = expected;
    if (!Number.isFinite(a)) return false;
  } else if (typeof expected === "string" && DATE_RE.test(expected) && typeof x === "string" && DATE_RE.test(x)) {
    a = x;
    b = expected;
  } else {
    return false;
  }
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  return a <= b;
}

/** The RegExp of a `matches` condition. A pattern matchesProblem refuses throws, so it never quietly passes or fails. */
function compiledPattern(pattern: unknown, path: string): RegExp {
  const problem = matchesProblem(pattern);
  if (problem !== null) throw new Error(`조건의 정규식을 쓸 수 없습니다(${where(path)}). ${problem}`);
  return new RegExp(pattern as string);
}

/**
 * Why `pattern` cannot be a `matches` value, or null (design doc 4.1). It must compile and stay in
 * a small subset of JavaScript regular expressions, so that an applicant's answer cannot keep a
 * backtracking engine busy: groups are (...), (?:...), (?=...) or (?!...); no backreferences; a
 * group repeated by *, + or {n,} holds no repetition or |; and the ways the pattern can split one
 * answer of MATCH_INPUT_LIMIT characters stay within MATCH_WAYS_LIMIT. Ways multiply along a
 * sequence and add up over alternatives; a repetition counts each possible count (a term with w
 * ways repeated k times has w^k); a pattern that does not start with ^ also tries every start.
 */
export function matchesProblem(pattern: unknown): string | null {
  if (typeof pattern !== "string") return "정규식을 문자열로 적어야 합니다.";
  try {
    new RegExp(pattern);
  } catch (e) {
    // Engines differ on newer group syntax (Node 22 rejects (?i:...), Node 24 accepts it), so
    // report a group outside the subset the same way whether or not this engine compiles it.
    if (hasGroupOutsideSubset(pattern)) return GROUP_SUBSET;
    return `정규식을 읽을 수 없습니다: ${(e as Error).message}`;
  }
  return backtrackingProblem(pattern);
}

const GROUP_SUBSET = "그룹은 (...), (?:...), (?=...), (?!...)만 쓸 수 있습니다.";

/** True when a "(?" group other than (?:, (?= or (?! appears outside escapes and [...] classes. */
function hasGroupOutsideSubset(pattern: string): boolean {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") i++;
    else if (inClass) inClass = ch !== "]";
    else if (ch === "[") inClass = true;
    else if (ch === "(" && pattern[i + 1] === "?" && ":=!".indexOf(pattern[i + 2] ?? "") < 0) return true;
  }
  return false;
}

/** Ways of one alternative being read, and of the alternatives before it in its group. */
interface Alternation {
  /** Ways of the finished alternatives, added up. */
  done: number;
  /** Ways of the current alternative's terms before the last one, multiplied. */
  before: number;
  /** Ways of the last term, which a quantifier after it may still change. */
  last: number;
}

/** matchesProblem for a pattern that compiles: scans it once, counting ways as described there. */
function backtrackingProblem(pattern: string): string | null {
  const open: Alternation[] = [{ done: 0, before: 1, last: 1 }];
  let cur = open[0]!;
  let topLevelOr = false;
  const term = (ways: number): void => {
    cur.before *= cur.last;
    cur.last = ways;
  };
  const total = (a: Alternation): number => a.done + a.before * a.last;
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i]!;
    const q = quantifierAt(pattern, i);
    if (q) {
      if (q.max === Infinity && cur.last > 1) {
        return "반복(*, +, {n,})이 붙은 그룹 안에는 다시 반복(*, +, ?, {n,m})이나 |를 쓸 수 없습니다. 답에 따라 판정이 아주 오래 걸릴 수 있으니 그룹을 풀어 쓰거나 [...]로 바꿔 주세요.";
      }
      cur.last = repeated(cur.last, q.min, q.max);
      i = q.end;
    } else if (ch === "\\") {
      if (/[1-9]/.test(pattern[i + 1] ?? "")) return "역참조(\\1 같은 것)는 쓸 수 없습니다.";
      term(1);
      i += 2;
    } else if (ch === "[") {
      i = classEnd(pattern, i);
      term(1);
    } else if (ch === "(") {
      const special = pattern[i + 1] === "?";
      const kind = pattern[i + 2];
      if (special && kind !== ":" && kind !== "=" && kind !== "!") return GROUP_SUBSET;
      open.push((cur = { done: 0, before: 1, last: 1 }));
      i += special ? 3 : 1;
    } else if (ch === ")") {
      const group = total(open.pop()!);
      cur = open[open.length - 1]!;
      term(group);
      i++;
    } else if (ch === "|") {
      cur.done = total(cur);
      cur.before = 1;
      cur.last = 1;
      if (open.length === 1) topLevelOr = true;
      i++;
    } else {
      term(1);
      i++;
    }
  }
  const starts = pattern[0] === "^" && !topLevelOr ? 1 : MATCH_INPUT_LIMIT + 1;
  if (total(cur) * starts <= MATCH_WAYS_LIMIT) return null;
  return "반복이 너무 많아 답에 따라 판정이 오래 걸릴 수 있습니다. *, +, ?, {n,m}을 줄이거나 ^로 시작 위치를 고정해 주세요.";
}

/** The quantifier at `i` (*, +, ?, {n}, {n,} or {n,m}, maybe lazy) with the index after it, or null. */
function quantifierAt(pattern: string, i: number): { min: number; max: number; end: number } | null {
  const ch = pattern[i];
  let q: { min: number; max: number; end: number } | null = null;
  if (ch === "*" || ch === "+") q = { min: ch === "*" ? 0 : 1, max: Infinity, end: i + 1 };
  else if (ch === "?") q = { min: 0, max: 1, end: i + 1 };
  else if (ch === "{") {
    // Anything else after "{" is a literal brace in a pattern without flags.
    const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
    if (m) q = { min: Number(m[1]), max: m[2] === undefined ? Number(m[1]) : m[3] === "" ? Infinity : Number(m[3]), end: i + m[0].length };
  }
  if (q && pattern[q.end] === "?") q.end++;
  return q;
}

/** Ways of a term with `ways` ways repeated min..max times; an answer allows at most MATCH_INPUT_LIMIT repeats. */
function repeated(ways: number, min: number, max: number): number {
  const hi = Math.min(max, MATCH_INPUT_LIMIT);
  const lo = Math.min(min, hi);
  if (ways === 1) return hi - lo + 1;
  let sum = 0;
  for (let k = lo; k <= hi && sum <= MATCH_WAYS_LIMIT; k++) sum += Math.pow(ways, k);
  return sum;
}

/** The index after the "]" that closes the class opened at `i`. In JavaScript "[]" and "[^]" close at once. */
function classEnd(pattern: string, i: number): number {
  let j = i + 1;
  if (pattern[j] === "^") j++;
  while (j < pattern.length && pattern[j] !== "]") j += pattern[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** The lower-case part after the last "@", or null without one. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

function join(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

function where(path: string): string {
  return path === "" ? "맨 위" : path;
}

function malformed(path: string): Error {
  return new Error(`조건 형식이 올바르지 않습니다(${where(path)}). all, any, not, field 중 하나와 연산자 하나로 적어야 합니다.`);
}

/**
 * Applies `intake.eligibility` (design doc 4.2): the applicant must pass every rule. `messages` holds
 * the messages of the rules that failed, in rule order.
 */
export function checkApplicantEligibility(rules: readonly EligibilityRule[], person: Person): EligibilityResult {
  const messages = rules.filter((rule) => !evaluateCondition(rule.when, person).ok).map((rule) => rule.message);
  return { ok: messages.length === 0, messages };
}

/**
 * Decides a team's division in one track (design doc 4.3). `divisions` maps division id to its
 * definition; `track.divisions` lists the ids open in the track. declared: checks the team's choice
 * with the division's teamRule and rejects with reasons. auto: the first division in track order the
 * team fits, or null with reasons. A track without divisions gives `{ division: null, ok: true }`.
 */
export function resolveTeamDivision(
  track: TrackDivisionSpec,
  divisions: Readonly<Record<string, DivisionDef>>,
  team: TeamForDivision,
): DivisionResult {
  const open = track.divisions;
  if (open.length === 0) return { division: null, ok: true, reasons: [] };
  const defs = open.map((id) => definition(divisions, id));
  const choices = `고를 수 있는 부문: ${defs.map((d) => d.name).join(", ")}`;

  if (track.divisionMode === "auto") {
    const reasons: string[] = [];
    for (let i = 0; i < open.length; i++) {
      const reason = misfit(defs[i]!, team);
      if (reason === null) return { division: open[i]!, ok: true, reasons: [] };
      reasons.push(reason);
    }
    return { division: null, ok: false, reasons };
  }
  if (track.divisionMode !== "declared") throw new Error(`알 수 없는 부문 판정 방식입니다: ${String(track.divisionMode)}`);

  const chosen = team.declared;
  if (chosen === null || chosen === undefined || chosen === "") return { division: null, ok: false, reasons: [`부문을 골라 주세요. ${choices}`] };
  const index = open.indexOf(chosen);
  if (index < 0) return { division: null, ok: false, reasons: [`고른 부문은 이 트랙에서 열리지 않습니다. ${choices}`] };
  const reason = misfit(defs[index]!, team);
  return reason === null ? { division: chosen, ok: true, reasons: [] } : { division: null, ok: false, reasons: [reason] };
}

/**
 * The `track` argument of resolveTeamDivision from a track as event.json carries it (YAML shape,
 * `division_mode`): `resolveTeamDivision(trackDivisionSpec(eventJson.tracks[id]), eventJson.divisions, team)`.
 */
export function trackDivisionSpec(track: { divisions: readonly string[]; division_mode: DivisionMode }): TrackDivisionSpec {
  return { divisions: track.divisions.slice(), divisionMode: track.division_mode };
}

function definition(divisions: Readonly<Record<string, DivisionDef>>, id: string): DivisionDef {
  const def = hasOwn(divisions, id) ? divisions[id] : undefined;
  if (!def) throw new Error(`트랙이 여는 부문 "${id}"의 정의가 divisions에 없습니다.`);
  return def;
}

/** Null when the team fits the division under its teamRule, otherwise why not (Korean). */
function misfit(def: DivisionDef, team: TeamForDivision): string | null {
  const results = team.members.map((m) => evaluateCondition(def.when, m.person));
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  let ok: boolean;
  let rule: string;
  let relevant = results;
  switch (def.teamRule) {
    case "all_members":
      ok = total > 0 && passed === total;
      rule = `팀원 모두가 조건을 만족해야 합니다(만족 ${passed}/${total}명)`;
      break;
    case "any_member":
      ok = passed > 0;
      rule = `팀원 중 한 명 이상이 조건을 만족해야 합니다(만족 ${passed}/${total}명)`;
      break;
    case "majority":
      ok = passed * 2 > total;
      rule = `팀원 과반이 조건을 만족해야 합니다(만족 ${passed}/${total}명)`;
      break;
    case "leader": {
      relevant = results.filter((_, i) => team.members[i]!.role === "leader");
      if (relevant.length === 0) return `${def.name}: 조장이 없습니다.`;
      ok = relevant.every((r) => r.ok);
      rule = "조장이 조건을 만족해야 합니다";
      break;
    }
    default:
      throw new Error(`알 수 없는 팀 규칙입니다: ${String(def.teamRule)}`);
  }
  if (ok) return null;
  const labels: string[] = [];
  for (const r of relevant) {
    for (const f of r.failed) {
      const label = f.field === null ? `${f.op} 조건` : `"${f.field}"(${f.op})`;
      if (labels.indexOf(label) < 0) labels.push(label);
    }
  }
  return `${def.name}: ${rule}.${labels.length > 0 ? ` 맞지 않은 조건: ${labels.join(", ")}` : ""}`;
}
