// Criteria tree, judge aggregation, components and the final score (design doc 3).
import { RESULT_WARNING, evaluateAst, validateAst } from "./formula/evaluate.js";
import { rankGroupKey } from "./ranking.js";
import type {
  CompiledFormula,
  Components,
  Criterion,
  JudgeAggregate,
  JudgeSheet,
  OverrideWhen,
  PopularNormalize,
  PopularValues,
  ScoringConfig,
  TeamRef,
  TeamScore,
  TeamVotes,
} from "./types.js";
import { hasOwn, roundTo } from "./util.js";

/** Formula variables that always exist (design doc 3.3). */
export const BASE_VARS = ["judge", "judges", "max_total"] as const;

/** Formula variables that exist only while the popular_vote add-on is on (design doc 3.3). */
export const POPULAR_VARS = ["votes", "total_votes", "avg_votes", "max_votes", "team_count", "popular"] as const;

/** Full marks of one criterion (`critmax.<key>`): its points with every leaf below it at `max`. */
export function criterionMax(criterion: Criterion): number {
  return isLeaf(criterion) ? criterion.max ?? 0 : maxTotal(criterion.children ?? []);
}

/**
 * Full marks of a judge's total (`max_total`): Σ weight × criterionMax over the given level, i.e.
 * the judge total with every leaf at `max`. Four 25-point leaves with weight 1 give 100.
 */
export function maxTotal(criteria: readonly Criterion[]): number {
  let total = 0;
  for (const c of criteria) total += c.weight * criterionMax(c);
  return total;
}

/**
 * Variables a scoring formula or tie_break may use: judge, judges, max_total, then crit.<key> and
 * critmax.<key> for every criterion in the tree (leaf or parent, parents before their children),
 * then the popular-vote variables when that add-on is on.
 */
export function scoringVariables(criteria: readonly Criterion[], popularEnabled: boolean): string[] {
  const keys = allNodes(criteria).map((c) => c.key);
  return [
    ...BASE_VARS,
    ...keys.map((k) => `crit.${k}`),
    ...keys.map((k) => `critmax.${k}`),
    ...(popularEnabled ? POPULAR_VARS : []),
  ];
}

/**
 * Computes each team's judge score J, per-criterion scores, popular-vote values and final score S
 * (design doc 3.2), with the `config.overrides` that match the team's track and division applied.
 *
 * - `sheets`: one per judge × team; when a judge has several for one team, the last one counts. A
 *   leaf's points are the entered value rounded to inputStep and kept within 0..max; a missing or
 *   non-numeric value is not entered. With requireComplete only judges who filled every leaf of
 *   the team count; without it every judge who entered at least one leaf counts, blanks as 0.
 * - `votes`: valid votes per team id. Pass it only when the popular_vote add-on is on; without it
 *   `popularVote` is null and the popular-vote variables do not exist. Totals come from the team's
 *   rank group (`config.rankGroups`).
 * - Formula and tie_break ASTs are re-checked with validateAst against scoringVariables before
 *   use; a formula that fails the check throws instead of being interpreted.
 *
 * Returns one TeamScore per entry of `teams`, in the same order.
 */
export function computeTeamScores(
  config: ScoringConfig,
  teams: readonly TeamRef[],
  sheets: readonly JudgeSheet[],
  votes?: TeamVotes | null,
): TeamScore[] {
  const groups = votes ? voteGroups(config, teams, votes) : null;
  const byTeam = latestSheets(sheets);
  return teams.map((team, i) => {
    const settings = settingsFor(config, team);
    const group = groups ? groups[i]! : null;
    const popular = group ? { ...group, popular: normalizeVotes(settings.popularNormalize, group) } : null;
    return scoreTeam(settings, team, byTeam.get(team.id) ?? [], popular);
  });
}

/** What one team is scored with: the base config with its matching overrides applied in order. */
type Settings = Omit<ScoringConfig, "overrides" | "rankGroups">;

function settingsFor(config: ScoringConfig, team: TeamRef): Settings {
  let settings: Settings = config;
  for (const { when, ...fields } of config.overrides) {
    if (overrideApplies(when, team.track, team.division)) settings = { ...settings, ...fields };
  }
  return settings;
}

/** Whether an override's `when` matches a team in `track` / `division` (null: none): every key given must match. */
export function overrideApplies(when: OverrideWhen, track: string | null, division: string | null): boolean {
  return (when.track === undefined || when.track === track) && (when.division === undefined || when.division === division);
}

/** A judge's counted sheet: the total and the points of every criterion node by key. */
interface JudgeResult {
  total: number;
  points: Map<string, number>;
}

function scoreTeam(settings: Settings, team: TeamRef, sheets: readonly JudgeSheet[], popular: PopularValues | null): TeamScore {
  const { criteria } = settings;
  const counted: JudgeResult[] = [];
  for (const sheet of sheets) {
    const result = judgeResult(criteria, sheet, settings);
    if (result) counted.push(result);
  }
  const judge = aggregate(counted.map((r) => r.total), settings.judgeAggregate);
  const critEntries = allNodes(criteria).map((c): [string, number] => [c.key, aggregate(counted.map((r) => r.points.get(c.key) ?? 0), settings.judgeAggregate)]);

  const vars = formulaVars(criteria, judge, counted.length, critEntries, popular);
  const allowed = scoringVariables(criteria, popular !== null);
  const warnings: string[] = [];
  const evaluate = (f: CompiledFormula): number => {
    const check = validateAst(f.ast, allowed);
    if (!check.ok) {
      const detail = check.errors.map((e) => `${e.path}: ${e.message}`).join(" / ");
      throw new Error(`팀 ${team.id}의 점수 설정과 맞지 않는 수식이라 계산하지 않았습니다("${f.source}"). ${detail}`);
    }
    const result = evaluateAst(check.ast, vars);
    for (const w of result.warnings) if (warnings.indexOf(w) < 0) warnings.push(w);
    return result.value;
  };

  const rawScore = settings.formula ? evaluate(settings.formula) : weightedSum(settings.components, judge, popular, warnings);
  return {
    id: team.id,
    track: team.track,
    division: team.division,
    judge,
    judges: counted.length,
    unscored: counted.length === 0,
    crit: Object.fromEntries(critEntries),
    popularVote: popular,
    rawScore,
    score: roundTo(rawScore, settings.precision),
    tieBreak: settings.tieBreak.map((f) => roundTo(evaluate(f), settings.precision)),
    warnings,
  };
}

/** The sheets of each team, keeping only the last sheet per judge. */
function latestSheets(sheets: readonly JudgeSheet[]): Map<string, JudgeSheet[]> {
  const byTeam = new Map<string, Map<string, JudgeSheet>>();
  for (const sheet of sheets) {
    let judges = byTeam.get(sheet.team);
    if (!judges) byTeam.set(sheet.team, (judges = new Map()));
    judges.set(sheet.judge, sheet);
  }
  const result = new Map<string, JudgeSheet[]>();
  byTeam.forEach((judges, team) => result.set(team, Array.from(judges.values())));
  return result;
}

/** Points of one judge's sheet, or null when the judge does not count (see computeTeamScores). */
function judgeResult(criteria: readonly Criterion[], sheet: JudgeSheet, settings: Settings): JudgeResult | null {
  const points = new Map<string, number>();
  let entered = 0;
  let missing = 0;
  const visit = (c: Criterion): number => {
    let p = 0;
    if (isLeaf(c)) {
      const x = enteredValue(sheet, c, settings.inputStep);
      if (x === null) missing++;
      else {
        entered++;
        p = x;
      }
    } else {
      for (const child of c.children ?? []) p += child.weight * visit(child);
    }
    points.set(c.key, p);
    return p;
  };
  let total = 0;
  for (const c of criteria) total += c.weight * visit(c);
  if (settings.requireComplete ? missing > 0 : entered === 0) return null;
  return { total, points };
}

function enteredValue(sheet: JudgeSheet, leaf: Criterion, step: number): number | null {
  const raw = hasOwn(sheet.scores, leaf.key) ? sheet.scores[leaf.key] : null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(leaf.max ?? 0, Math.max(0, toStep(raw, step)));
}

/**
 * x rounded to a multiple of `step`, halves away from zero. The quotient is cleaned to 9 digits
 * first, so 21.555 with step 0.01 counts as 2155.5 steps and becomes 21.56.
 */
function toStep(x: number, step: number): number {
  if (!(step > 0)) return x;
  return roundTo(roundTo(roundTo(x / step, 9)) * step, stepDigits(step));
}

/** Decimal places of a step: 0.01 → 2, 0.5 → 1, 1 → 0, 1e-7 → 7. */
function stepDigits(step: number): number {
  const [mantissa = "", exponent = "0"] = String(step).split("e");
  const decimals = (mantissa.split(".")[1] ?? "").length - Number(exponent);
  return Math.min(Math.max(decimals, 0), 15);
}

/** Judge totals (or one criterion's points) of the counted judges → one value (design doc 3.2). */
function aggregate(values: readonly number[], how: JudgeAggregate): number {
  if (values.length === 0) return 0;
  switch (how.method) {
    case "mean":
      return mean(values);
    case "median": {
      const sorted = ascending(values);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    case "trimmed_mean": {
      const trim = Math.max(0, Math.floor(how.trim ?? 1));
      return values.length > 2 * trim ? mean(ascending(values).slice(trim, values.length - trim)) : mean(values);
    }
    default:
      throw new Error(`알 수 없는 심사 점수 집계 방식입니다: ${String(how.method)}`);
  }
}

/** Valid votes, totals and the largest count of each team's rank group, in `teams` order. */
type VoteGroup = Omit<PopularValues, "popular">;

function voteGroups(config: ScoringConfig, teams: readonly TeamRef[], votes: TeamVotes): VoteGroup[] {
  const counts = teams.map((t) => voteCount(votes, t.id));
  const members = new Map<string, number[]>();
  teams.forEach((team, i) => {
    const key = rankGroupKey(team, config.rankGroups);
    const list = members.get(key);
    if (list) list.push(i);
    else members.set(key, [i]);
  });
  const result: VoteGroup[] = [];
  members.forEach((indices) => {
    const groupCounts = indices.map((i) => counts[i]!);
    const totalVotes = sum(groupCounts);
    const teamCount = indices.length;
    const maxVotes = Math.max(0, ...groupCounts);
    for (const i of indices) result[i] = { votes: counts[i]!, totalVotes, avgVotes: totalVotes / teamCount, maxVotes, teamCount };
  });
  return result;
}

function voteCount(votes: TeamVotes, team: string): number {
  const v = hasOwn(votes, team) ? votes[team] : 0;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** `popular` (0–100) from a team's votes (design doc 3.2). */
function normalizeVotes(how: PopularNormalize, v: VoteGroup): number {
  switch (how.method) {
    case "share_of_max":
      return v.maxVotes > 0 ? (100 * v.votes) / v.maxVotes : 0;
    case "capped_sqrt": {
      const full = (how.fullAtMultiple ?? 2) * v.avgVotes;
      return full > 0 ? 100 * Math.sqrt(Math.min(1, v.votes / full)) : 0;
    }
    default:
      throw new Error(`알 수 없는 인기투표 정규화 방식입니다: ${String(how.method)}`);
  }
}

/** S without a formula: Σ components[k] × value(k). Like a formula's result, a value that is not finite becomes 0 with a warning. */
function weightedSum(components: Components, judge: number, popular: PopularValues | null, warnings: string[]): number {
  let total = 0;
  if (components.judge) total += components.judge * judge;
  if (components.popular) {
    if (!popular) throw new Error("인기투표 표가 없어 popular component를 계산할 수 없습니다. popular_vote add-on을 켜고 표를 넘겨 주세요.");
    total += components.popular * popular.popular;
  }
  if (Number.isFinite(total)) return total;
  if (warnings.indexOf(RESULT_WARNING) < 0) warnings.push(RESULT_WARNING);
  return 0;
}

function formulaVars(
  criteria: readonly Criterion[],
  judge: number,
  judges: number,
  crit: readonly (readonly [string, number])[],
  popular: PopularValues | null,
): Record<string, number> {
  const entries: [string, number][] = [
    ["judge", judge],
    ["judges", judges],
    ["max_total", maxTotal(criteria)],
  ];
  for (const [key, value] of crit) entries.push([`crit.${key}`, value]);
  for (const c of allNodes(criteria)) entries.push([`critmax.${c.key}`, criterionMax(c)]);
  if (popular) {
    entries.push(
      ["votes", popular.votes],
      ["total_votes", popular.totalVotes],
      ["avg_votes", popular.avgVotes],
      ["max_votes", popular.maxVotes],
      ["team_count", popular.teamCount],
      ["popular", popular.popular],
    );
  }
  return Object.fromEntries(entries);
}

function isLeaf(c: Criterion): boolean {
  return !c.children || c.children.length === 0;
}

/** Every node of the tree, parents before their children. */
function allNodes(criteria: readonly Criterion[]): Criterion[] {
  const out: Criterion[] = [];
  const walk = (list: readonly Criterion[]): void => {
    for (const c of list) {
      out.push(c);
      if (c.children) walk(c.children);
    }
  };
  walk(criteria);
  return out;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function mean(values: readonly number[]): number {
  return sum(values) / values.length;
}

function ascending(values: readonly number[]): number[] {
  return values.slice().sort((a, b) => a - b);
}
