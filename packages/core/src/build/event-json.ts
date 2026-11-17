// Public event.json for the site and the server (design doc 8.1).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { addonEnabled, findAddon } from "../addons/registry.js";
import type { CriterionConfig, ResolvedConfig } from "../config/schema.js";
import { compileFormula } from "../formula/parse.js";
import { scoringVariables } from "../runtime/scoring.js";
import type { CompiledFormula, Criterion, DivisionDef, JudgeAggregate, PopularNormalize, ScoringConfig, ScoringOverride } from "../runtime/types.js";

/** Version of this kit (the core package), written into event.json and the runtime bundle banner. */
export const KIT_VERSION: string = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

type Resolved<K extends keyof ResolvedConfig> = ResolvedConfig[K];

/**
 * What the site and the server read. Sections keep their YAML shape, except the two the runtime
 * engines take as they are: `scoring` (computeTeamScores, rankTeams) and `divisions`
 * (resolveTeamDivision).
 */
export interface EventJson {
  schema: 2;
  kit: { version: string };
  /** First 16 hex chars of the sha256 of the normalized JSON (everything but this field). */
  config_hash: string;
  event: Resolved<"event">;
  site: Resolved<"site">;
  schedule: Resolved<"schedule">;
  tracks: Resolved<"tracks">;
  divisions: Record<string, DivisionDef>;
  intake: Resolved<"intake">;
  scoring: ScoringConfig;
  modules: Resolved<"modules">;
  /** Enabled add-ons only, with their options (defaults filled in). */
  addons: Record<string, Record<string, unknown>>;
  privacy: { retention_days?: number };
}

/** Builds the public JSON: drops roster, github, repo, reviewers, app_policy and other staff-only values. */
export function buildEventJson(resolved: ResolvedConfig): EventJson {
  if (resolved.kind !== "event" || !resolved.event.id) throw new Error("event.json은 kind: event이고 event.id가 있는 설정에서만 만듭니다.");
  const body: Omit<EventJson, "config_hash"> = {
    schema: 2,
    kit: { version: KIT_VERSION },
    event: resolved.event,
    site: resolved.site,
    schedule: resolved.schedule,
    tracks: resolved.tracks,
    divisions: Object.fromEntries(Object.entries(resolved.divisions).map(([id, d]) => [id, { name: d.name, when: d.when, teamRule: d.team_rule }])),
    intake: resolved.intake,
    scoring: buildScoringConfig(resolved),
    modules: resolved.modules,
    addons: enabledAddons(resolved),
    privacy: resolved.privacy.retention_days === undefined ? {} : { retention_days: resolved.privacy.retention_days },
  };
  const { schema, kit, ...sections } = structuredClone(body);
  return { schema, kit, config_hash: configHash(body), ...sections };
}

/** sha256 of the JSON with keys sorted at every level, first 16 hex chars. */
export function configHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortKeys(value))).digest("hex").slice(0, 16);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  const obj = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, sortKeys(obj[k])]),
  );
}

function enabledAddons(resolved: ResolvedConfig): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, entry] of Object.entries(resolved.addons)) {
    if (!addonEnabled(resolved, id)) continue;
    const def = findAddon(id);
    if (!def) throw new Error(`알 수 없는 add-on입니다: ${id}`);
    const { enabled: _enabled, ...options } = entry;
    out[id] = def.options.parse(options) as Record<string, unknown>;
  }
  return out;
}

/** YAML criteria → runtime criteria: weight defaults to 1, an empty children list makes a leaf. */
export function toCriteria(list: readonly CriterionConfig[]): Criterion[] {
  return list.map((c) => {
    const node: Criterion = { key: c.key, name: c.name, weight: c.weight ?? 1 };
    if (c.max !== undefined) node.max = c.max;
    if (c.children && c.children.length > 0) node.children = toCriteria(c.children);
    return node;
  });
}

/** The runtime ScoringConfig (see compileScoring). Throws when a formula does not compile. */
export function buildScoringConfig(resolved: ResolvedConfig): ScoringConfig {
  const { scoring, errors } = compileScoring(resolved);
  if (!scoring) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join(" / "));
  return scoring;
}

/** A formula of the scoring section that does not compile, at its config path ("scoring.overrides[1].formula"). */
export interface FormulaError {
  path: string;
  message: string;
}

/**
 * The runtime ScoringConfig (camelCase, defaults filled in, formulas compiled to ASTs), or every
 * compile error. Every formula and tie_break, the base ones and those of every override, compiles
 * against the variables of all criteria trees in the config, also when no team reaches it.
 * checkConfig (V4) reports these errors, so a config that passes check builds; V4 also checks each
 * formula with the exact variables of every track × division it applies to, and the runtime checks
 * again per team.
 */
export function compileScoring(resolved: ResolvedConfig): { scoring: ScoringConfig; errors: [] } | { scoring: null; errors: FormulaError[] } {
  const s = resolved.scoring;
  const trees = [s.criteria, ...s.overrides.map((o) => o.criteria ?? [])].flatMap(toCriteria);
  const allowed = scoringVariables(trees, addonEnabled(resolved, "popular_vote"));
  const errors: FormulaError[] = [];
  const compile = (source: string, path: string): CompiledFormula => {
    const result = compileFormula(source, allowed);
    if (result.ok) return { source, ast: result.ast };
    for (const e of result.errors) errors.push({ path, message: e.message });
    return { source, ast: { k: "n", v: 0 } };
  };
  const tieBreak = (list: readonly string[], path: string) => list.map((source, i) => compile(source, `${path}[${i}]`));

  const scoring: ScoringConfig = {
    criteria: toCriteria(s.criteria),
    inputStep: s.input_step,
    judgeAggregate: judgeAggregate(s.judge_aggregate),
    requireComplete: s.require_complete,
    components: { ...s.components },
    popularNormalize: popularNormalize(s.popular_normalize),
    formula: s.formula === null ? null : compile(s.formula, "scoring.formula"),
    precision: s.precision,
    tieBreak: tieBreak(s.tie_break, "scoring.tie_break"),
    rankGroups: [...s.rank_groups],
    overrides: s.overrides.map((o, i) => {
      const at = `scoring.overrides[${i}]`;
      const out: ScoringOverride = { when: { ...o.when } };
      if (o.criteria !== undefined) out.criteria = toCriteria(o.criteria);
      if (o.input_step !== undefined) out.inputStep = o.input_step;
      if (o.judge_aggregate !== undefined) out.judgeAggregate = judgeAggregate(o.judge_aggregate);
      if (o.require_complete !== undefined) out.requireComplete = o.require_complete;
      if (o.components !== undefined) out.components = { ...o.components };
      if (o.popular_normalize !== undefined) out.popularNormalize = popularNormalize(o.popular_normalize);
      if (o.formula !== undefined) out.formula = o.formula === null ? null : compile(o.formula, `${at}.formula`);
      if (o.precision !== undefined) out.precision = o.precision;
      if (o.tie_break !== undefined) out.tieBreak = tieBreak(o.tie_break, `${at}.tie_break`);
      return out;
    }),
  };
  return errors.length === 0 ? { scoring, errors: [] } : { scoring: null, errors };
}

function judgeAggregate(a: { method: JudgeAggregate["method"]; trim?: number }): JudgeAggregate {
  return a.method === "trimmed_mean" ? { method: a.method, trim: a.trim ?? 1 } : { method: a.method };
}

function popularNormalize(p: { method: PopularNormalize["method"]; full_at_multiple?: number }): PopularNormalize {
  return p.method === "capped_sqrt" ? { method: p.method, fullAtMultiple: p.full_at_multiple ?? 2 } : { method: p.method };
}
