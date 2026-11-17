// Builders shared by the runtime tests.
import { compileFormula } from "../src/formula/parse.js";
import { scoringVariables } from "../src/runtime/scoring.js";
import type { CompiledFormula, Criterion, JudgeSheet, ScoringConfig, TeamRef } from "../src/runtime/types.js";

export const leaf = (key: string, max: number, weight = 1): Criterion => ({ key, name: key, weight, max });
export const group = (key: string, children: Criterion[], weight = 1): Criterion => ({ key, name: key, weight, children });

/** Four 25-point criteria, weight omitted: the reference case (design doc 3.4). */
export const REFERENCE_CRITERIA: Criterion[] = ["idea", "done", "ux", "arch"].map((k) => leaf(k, 25));
export const REFERENCE_FORMULA = "0.85 * judge + 15 * sqrt(min(1, votes / (2 * avg_votes)))";

/** Compiles `source` with the variables of `criteria`; throws on a compile error. */
export function formula(source: string, criteria: readonly Criterion[], popular = false): CompiledFormula {
  const result = compileFormula(source, scoringVariables(criteria, popular));
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return { source, ast: result.ast };
}

/** A weighted-sum config over one 10-point leaf; `over` replaces any field. */
export function scoringConfig(over: Partial<ScoringConfig> = {}): ScoringConfig {
  return {
    criteria: [leaf("a", 10)],
    inputStep: 0.01,
    judgeAggregate: { method: "mean" },
    requireComplete: true,
    components: { judge: 1 },
    popularNormalize: { method: "share_of_max" },
    formula: null,
    precision: 2,
    tieBreak: [],
    rankGroups: ["track", "division"],
    overrides: [],
    ...over,
  };
}

export const team = (id: string, track = "t", division: string | null = null): TeamRef => ({ id, track, division });

export const sheet = (judge: string, teamId: string, scores: Record<string, number | null>): JudgeSheet => ({ judge, team: teamId, scores });

/** Sheets from one judge per value giving each reference criterion value / 4, so the judge total is `value`. */
export function referenceSheets(teamId: string, totals: readonly number[]): JudgeSheet[] {
  return totals.map((total, i) => sheet(`j${i + 1}`, teamId, { idea: total / 4, done: total / 4, ux: total / 4, arch: total / 4 }));
}
