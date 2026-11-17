// Ranking with ties, tie_break order and prize assignment (design doc 3.5).
import type { PrizeAward, RankGroupKey, RankedTeam, TeamScore, TrackPrizes } from "./types.js";

/**
 * Ranks teams inside each rank group: teams with equal values for `rankGroups` are ranked together.
 * Order: `score` descending, then each `tieBreak` value in turn, descending (computeTeamScores has
 * already rounded both to precision). Teams equal on all of them share a rank (1, 2, 2, 4).
 *
 * Returns every team once, grouped by `group` and ordered by rank inside each group.
 */
export function rankTeams(scores: readonly TeamScore[], rankGroups: readonly RankGroupKey[]): RankedTeam[] {
  throw new Error("not implemented: rankTeams");
}

/**
 * Fills each rank group's prize table from the top. `prizes` is keyed by track id; a track's table is
 * either one list for all its groups or a map from division id to list. `{ place: 2, teams: 2 }`
 * gives place 2 to the next two teams. When a tie crosses a row's boundary, every tied team gets
 * that prize (`tieExpanded: true`) and the rows below keep their size. Rows nobody is left for stay
 * empty.
 *
 * Returns one PrizeAward per table row per group, groups in the order they appear in `ranked`.
 */
export function assignPrizes(ranked: readonly RankedTeam[], prizes: Readonly<Record<string, TrackPrizes>>): PrizeAward[] {
  throw new Error("not implemented: assignPrizes");
}
