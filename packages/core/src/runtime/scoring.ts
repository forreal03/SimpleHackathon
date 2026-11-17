// Criteria tree, judge aggregation, components and the final score (design doc 3).
import type { Criterion, JudgeSheet, ScoringConfig, TeamRef, TeamScore, TeamVotes } from "./types.js";

/** Formula variables that always exist (design doc 3.3). */
export const BASE_VARS = ["judge", "judges", "max_total"] as const;

/** Formula variables that exist only while the popular_vote add-on is on (design doc 3.3). */
export const POPULAR_VARS = ["votes", "total_votes", "avg_votes", "max_votes", "team_count", "popular"] as const;

/** Full marks of one criterion (`critmax.<key>`): its points with every leaf below it at `max`. */
export function criterionMax(criterion: Criterion): number {
  return criterion.children && criterion.children.length > 0 ? maxTotal(criterion.children) : criterion.max ?? 0;
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
  const keys: string[] = [];
  const walk = (list: readonly Criterion[]): void => {
    for (const c of list) {
      keys.push(c.key);
      if (c.children) walk(c.children);
    }
  };
  walk(criteria);
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
 * - `sheets`: one per judge × team. A leaf's points are the entered value (0..max, rounded to
 *   inputStep); with requireComplete only judges who filled every leaf of the team count.
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
  throw new Error("not implemented: computeTeamScores");
}
