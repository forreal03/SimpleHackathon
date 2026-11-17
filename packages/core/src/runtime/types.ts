// Types shared by the runtime engines (design doc docs/design/core-engines.md). Everything here is
// JSON-shaped data, so the same values travel through event.json to the Apps Script server.
// Runtime structures use camelCase; formula variables and condition operators keep the snake_case
// people write in YAML (`total_votes`, `domain_in`).

// ── formula ──────────────────────────────────────────────────────────────────────────────────

/** Prefix operators. */
export type UnaryOp = "-" | "not";

/** Infix operators. Comparisons and `and`/`or` give 1 or 0. */
export type BinaryOp = "+" | "-" | "*" | "/" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "and" | "or";

/** Functions of the formula language (design doc 2.3). */
export type FuncName = "min" | "max" | "sum" | "avg" | "abs" | "sqrt" | "round" | "floor" | "ceil" | "clamp" | "if";

/** Number literal: `{"k":"n","v":0.85}`. */
export interface NumNode {
  k: "n";
  v: number;
}

/** Variable: `{"k":"v","n":"crit.idea"}`. */
export interface VarNode {
  k: "v";
  n: string;
}

/** Prefix operation: `{"k":"u","o":"-","a":<Ast>}`. */
export interface UnaryNode {
  k: "u";
  o: UnaryOp;
  a: Ast;
}

/** Infix operation: `{"k":"b","o":"*","a":<Ast>,"b":<Ast>}`. */
export interface BinaryNode {
  k: "b";
  o: BinaryOp;
  a: Ast;
  b: Ast;
}

/** Function call: `{"k":"c","f":"sqrt","a":[<Ast>, ...]}`. */
export interface CallNode {
  k: "c";
  f: FuncName;
  a: Ast[];
}

/** Formula AST as event.json carries it (design doc 2.4). The server interprets only this, never source. */
export type Ast = NumNode | VarNode | UnaryNode | BinaryNode | CallNode;

/** A formula as people wrote it, with its AST. */
export interface CompiledFormula {
  source: string;
  ast: Ast;
}

/** Variable values for one evaluation, e.g. `{ judge: 80, "crit.idea": 21.5, votes: 27 }`. */
export type FormulaVars = Readonly<Record<string, number>>;

/** Result of evaluateAst. Non-finite values were replaced by 0 and reported in `warnings` (Korean). */
export interface Evaluation {
  value: number;
  warnings: string[];
}

/** A problem validateAst found. `path` points into the AST, e.g. `$.a[1].b`; `message` is Korean. */
export interface AstIssue {
  path: string;
  message: string;
}

/** validateAst result: the input typed as an Ast, or every problem found. */
export type AstCheck = { ok: true; ast: Ast } | { ok: false; errors: AstIssue[] };

/** A compile problem. `pos` is a 0-based index into the source; `message` (Korean) already says where. */
export interface CompileError {
  pos: number;
  message: string;
}

/** compileFormula result (design doc 2.5). */
export type CompileResult = { ok: true; ast: Ast } | { ok: false; errors: CompileError[] };

// ── scoring & ranking ────────────────────────────────────────────────────────────────────────

/** One node of the criteria tree. Leaves are the cells judges fill in. */
export interface Criterion {
  /** Unique across the whole tree; formulas read it as `crit.<key>` and `critmax.<key>`. */
  key: string;
  name: string;
  /** Multiplier in the parent's weighted sum (or in the judge total for a top-level node). Config default 1. */
  weight: number;
  /** Highest score a judge may enter. Required on a leaf; a parent's full marks come from its children. */
  max?: number;
  /** Sub-criteria. A criterion without children (or with an empty list) is a leaf. */
  children?: Criterion[];
}

export type JudgeAggregateMethod = "mean" | "median" | "trimmed_mean";

/** How judge totals become one team score J. */
export interface JudgeAggregate {
  method: JudgeAggregateMethod;
  /** trimmed_mean: judges dropped from each end, only when there are more than 2 × trim of them. */
  trim?: number;
}

export type PopularNormalizeMethod = "share_of_max" | "capped_sqrt";

/** How a team's votes become `popular` (0–100). */
export interface PopularNormalize {
  method: PopularNormalizeMethod;
  /** capped_sqrt: full marks at this multiple of the group's average votes (the reference case uses 2). */
  fullAtMultiple?: number;
}

/** Values a weighted-sum final score can use: value(judge) = J, value(popular) = popular. */
export type ComponentKey = "judge" | "popular";

/** Weights of the final score when there is no formula: S = Σ components[k] × value(k). */
export type Components = Partial<Record<ComponentKey, number>>;

/** Teams with equal values for these keys are ranked (and their votes normalized) together. */
export type RankGroupKey = "track" | "division";

/**
 * Normalized scoring settings the runtime works with: defaults filled in, formulas compiled.
 * The build step derives it from the YAML `scoring` section (snake_case) and puts it in event.json
 * as is, so the server can pass event.json's `scoring` straight to computeTeamScores.
 */
export interface ScoringConfig {
  criteria: Criterion[];
  /** Input unit for judges, e.g. 0.01. Entered scores are rounded to it. */
  inputStep: number;
  judgeAggregate: JudgeAggregate;
  /** Count only judges who filled in every leaf for the team. */
  requireComplete: boolean;
  /** Used when there is no formula. */
  components: Components;
  popularNormalize: PopularNormalize;
  /** Final-score formula. Absent or null: the weighted sum of `components`. */
  formula?: CompiledFormula | null;
  /** Digits for the final score and tie-break comparisons (0–6). */
  precision: number;
  /** Tie-break formulas, compared in order, larger first. */
  tieBreak: CompiledFormula[];
  rankGroups: RankGroupKey[];
  /** Per track/division replacements, applied in order (later entries win). */
  overrides: ScoringOverride[];
}

/** Which teams an override applies to. Every key given must match; `{}` matches every team. */
export interface OverrideWhen {
  track?: string;
  division?: string;
}

/**
 * Replaces the listed fields for matching teams; fields not given keep the base value.
 * `formula: null` switches matching teams back to the weighted sum.
 */
export type ScoringOverride = { when: OverrideWhen } & Partial<Omit<ScoringConfig, "overrides" | "rankGroups">>;

/** One judge's scores for one team. */
export interface JudgeSheet {
  /** Judge id (stable within the event). */
  judge: string;
  /** Team id (TeamRef.id). */
  team: string;
  /** Leaf key → entered score. A leaf missing here, or null, has not been entered. */
  scores: Readonly<Record<string, number | null>>;
}

/** A team as scoring and ranking see it. */
export interface TeamRef {
  id: string;
  track: string;
  /** Division id; null when the team's track has no divisions. */
  division: string | null;
}

/** Valid votes per team id. A team missing here has 0 votes. */
export type TeamVotes = Readonly<Record<string, number>>;

/** Popular-vote values of one team; its rank group supplies the totals. */
export interface PopularValues {
  votes: number;
  totalVotes: number;
  /** totalVotes / teamCount (0 for an empty group). */
  avgVotes: number;
  maxVotes: number;
  teamCount: number;
  /** votes normalized to 0–100 with popularNormalize. */
  popular: number;
}

/** computeTeamScores output for one team. */
export interface TeamScore extends TeamRef {
  /** J: judge totals aggregated with judgeAggregate (max_total scale; 0 when unscored). */
  judge: number;
  /** Judges counted after requireComplete. */
  judges: number;
  /** No judge could be counted, so judge = 0 and judges = 0. */
  unscored: boolean;
  /** crit.<key> for every criterion (leaf or parent): per-judge points aggregated with judgeAggregate. */
  crit: Record<string, number>;
  /** Null when votes were not given (popular_vote off). */
  popularVote: PopularValues | null;
  /** Final score S before rounding. */
  rawScore: number;
  /** S rounded to precision; ranking and display use this. */
  score: number;
  /** tie_break values in config order, each rounded to precision. */
  tieBreak: number[];
  /** Formula warnings for this team (Korean). */
  warnings: string[];
}

/** rankTeams output for one team. */
export interface RankedTeam extends TeamScore {
  /** Rank-group key: the team's rankGroups values joined with "/", a null division left out ("hackathon/student"). */
  group: string;
  /** 1-based rank in its group; equal teams share a rank (1, 2, 2, 4). */
  rank: number;
}

/** One row of a prize table: `teams` teams receive `place`. */
export interface PrizeSpec {
  place: number;
  teams: number;
  amount?: number;
  label?: string;
}

/** `tracks.<id>.prizes`: one table for every rank group of the track, or one table per division id. */
export type TrackPrizes = PrizeSpec[] | Readonly<Record<string, PrizeSpec[]>>;

/** One PrizeSpec row of one rank group, filled in. */
export interface PrizeAward {
  group: string;
  place: number;
  amount?: number;
  label?: string;
  /** Winning team ids in rank order; empty when the prize stays unawarded. */
  teams: string[];
  /** A tie at the boundary gave this prize to more teams than the row's `teams`. */
  tieExpanded: boolean;
}

// ── eligibility ──────────────────────────────────────────────────────────────────────────────

export type CondScalar = string | number;

export type CondOp = "eq" | "ne" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "matches" | "exists" | "domain_in";

/** `{}`: always true. */
export type AlwaysCond = Record<string, never>;

export interface AllCond {
  all: Cond[];
}

export interface AnyCond {
  any: Cond[];
}

export interface NotCond {
  not: Cond;
}

/**
 * A check on one field, with exactly one operator (design doc 4.1). `field` is a question key, or
 * `email` / `email_domain` for the verified email. On a multi answer (an array) `eq`/`in` pass when
 * any element matches and `nin` passes when none does.
 */
export interface FieldCond {
  field: string;
  eq?: CondScalar;
  ne?: CondScalar;
  in?: CondScalar[];
  nin?: CondScalar[];
  /** Number, or "YYYY-MM-DD" compared with dates only (same for gte, lt, lte). */
  gt?: CondScalar;
  gte?: CondScalar;
  lt?: CondScalar;
  lte?: CondScalar;
  /** Regular expression; the input is cut to 200 characters first. */
  matches?: string;
  exists?: boolean;
  domain_in?: string[];
}

/** Condition language of design doc 4.1, written in YAML/JSON. */
export type Cond = AlwaysCond | AllCond | AnyCond | NotCond | FieldCond;

/** A form answer: multi answers are arrays, dates are "YYYY-MM-DD". */
export type Answer = string | number | string[] | null;

/** What conditions are evaluated against. */
export interface Person {
  /** Verified email from the Google ID token, never a form answer. Also gives `email_domain`. */
  email: string;
  /** Answers by question key. */
  answers: Readonly<Record<string, Answer>>;
}

/** Why a condition failed: condition-side facts only, never anyone's answer. */
export interface CondFailure {
  /** Location in the condition, e.g. "all[1]" or "any[0].not"; "" for the root. */
  path: string;
  /** The question key the failed check read; null for a group that failed as a whole. */
  field: string | null;
  /** The failed operator, or the group that failed as a whole. */
  op: CondOp | "all" | "any" | "not";
}

export interface CondResult {
  ok: boolean;
  failed: CondFailure[];
}

/** One `intake.eligibility` entry. */
export interface EligibilityRule {
  when: Cond;
  /** Shown to the applicant when `when` fails. */
  message: string;
}

export interface EligibilityResult {
  ok: boolean;
  /** Messages of the failed rules, in rule order. */
  messages: string[];
}

/** How a team qualifies for a division from its members. */
export type TeamRule = "all_members" | "any_member" | "leader" | "majority";

/** `divisions.<id>`. */
export interface DivisionDef {
  name: string;
  when: Cond;
  teamRule: TeamRule;
}

/** declared: the team picks and the server checks; auto: the first division in order that fits. */
export type DivisionMode = "declared" | "auto";

/** A track's division settings. */
export interface TrackDivisionSpec {
  /** Division ids open in this track; order is display and auto-assignment order. Empty: no divisions. */
  divisions: string[];
  divisionMode: DivisionMode;
}

export interface TeamMember {
  role: "leader" | "member";
  person: Person;
}

/** A team as division resolution sees it. */
export interface TeamForDivision {
  /** Division id the team chose (declared mode). */
  declared?: string | null;
  members: TeamMember[];
}

export interface DivisionResult {
  /** The team's division, or null when none fits (or the track has none). */
  division: string | null;
  ok: boolean;
  /** Why the team was rejected or got no division (Korean; never another member's answers). */
  reasons: string[];
}
