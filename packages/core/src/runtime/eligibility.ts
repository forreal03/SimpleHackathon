// Condition language, applicant eligibility and team divisions (design doc 4).
import type {
  Answer,
  Cond,
  CondFailure,
  CondOp,
  CondResult,
  DivisionDef,
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^\s*-?\d+(?:\.\d+)?\s*$/;

/**
 * Evaluates a condition against one person (design doc 4.1). `email` and `email_domain` read the
 * verified email (the domain in lower case); any other field reads `person.answers`. A missing
 * answer fails every check except `ne`, `nin` and `exists: false`. On an array answer `eq`, `in`,
 * the comparisons, `matches` and `domain_in` pass when any element passes; `ne` and `nin` pass when
 * none matches. `eq`/`in` compare the text of the values, so the answer "3" equals 3.
 * Failures carry condition-side facts only (path, field, op), never anyone's answer.
 * A malformed condition throws instead of being guessed at.
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
  const expected = (cond as unknown as Record<CondOp, unknown>)[op];
  const ok = testField(op, expected, fieldValue(person, cond.field));
  if (!ok) failed.push({ path, field: cond.field, op });
  return ok;
}

function fieldValue(person: Person, field: string): Answer | undefined {
  if (field === "email") return person.email;
  if (field === "email_domain") return domainOf(person.email);
  return hasOwn(person.answers, field) ? person.answers[field] : undefined;
}

function testField(op: CondOp, expected: unknown, actual: Answer | undefined): boolean {
  switch (op) {
    case "exists":
      return (expected === true) === present(actual);
    case "eq":
      return some(actual, (x) => same(x, expected));
    case "ne":
      return !some(actual, (x) => same(x, expected));
    case "in":
      return some(actual, (x) => inList(x, expected));
    case "nin":
      return !some(actual, (x) => inList(x, expected));
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return some(actual, (x) => compare(op, x, expected));
    case "matches": {
      const re = regex(expected);
      return re !== null && some(actual, (x) => re.test(String(x).slice(0, MATCH_INPUT_LIMIT)));
    }
    case "domain_in":
      return some(actual, (x) => {
        const domain = domainOf(String(x)) ?? String(x).toLowerCase();
        return Array.isArray(expected) && expected.some((d) => String(d).toLowerCase() === domain);
      });
  }
}

/** True when a scalar answer (or any element of an array answer) passes. A missing answer never does. */
function some(actual: Answer | undefined, test: (x: string | number) => boolean): boolean {
  if (actual === null || actual === undefined) return false;
  return Array.isArray(actual) ? actual.some(test) : test(actual);
}

function present(actual: Answer | undefined): boolean {
  if (actual === null || actual === undefined) return false;
  if (typeof actual === "string") return actual.trim() !== "";
  return Array.isArray(actual) ? actual.length > 0 : true;
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

function regex(pattern: unknown): RegExp | null {
  if (typeof pattern !== "string") return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** The lower-case part after the last "@", or null without one. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

function join(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

function malformed(path: string): Error {
  return new Error(`조건 형식이 올바르지 않습니다(${path === "" ? "맨 위" : path}). all, any, not, field 중 하나와 연산자 하나로 적어야 합니다.`);
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
