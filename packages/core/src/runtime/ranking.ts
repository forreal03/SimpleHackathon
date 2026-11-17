// Ranking with ties, tie_break order and prize assignment (design doc 3.5).
import type { PrizeAward, PrizeSpec, RankGroupKey, RankedTeam, TeamRef, TeamScore, TrackPrizes } from "./types.js";
import { hasOwn } from "./util.js";

/**
 * The rank group of a team: its `rankGroups` values joined with "/", a null division left out.
 * `[track, division]` gives "hackathon/student", or "hackathon" for a team without a division.
 */
export function rankGroupKey(team: TeamRef, rankGroups: readonly RankGroupKey[]): string {
  const parts: string[] = [];
  for (const key of rankGroups) {
    if (key === "track") parts.push(team.track);
    else if (key === "division" && team.division) parts.push(team.division);
  }
  return parts.join("/");
}

/**
 * Ranks teams inside each rank group: teams with equal values for `rankGroups` are ranked together.
 * Order: `score` descending, then each `tieBreak` value in turn, descending (computeTeamScores has
 * already rounded both to precision). Teams equal on all of them share a rank (1, 2, 2, 4). A value
 * that is not a number ranks below every number.
 *
 * Returns every team once, grouped by `group` and ordered by rank inside each group.
 */
export function rankTeams(scores: readonly TeamScore[], rankGroups: readonly RankGroupKey[]): RankedTeam[] {
  const groups = new Map<string, TeamScore[]>();
  for (const score of scores) {
    const key = rankGroupKey(score, rankGroups);
    const list = groups.get(key);
    if (list) list.push(score);
    else groups.set(key, [score]);
  }
  const ranked: RankedTeam[] = [];
  groups.forEach((list, group) => {
    // Array.prototype.sort is stable (ES2019), so equal teams keep their input order.
    const sorted = list.slice().sort(compareScores);
    let rank = 0;
    sorted.forEach((team, i) => {
      if (i === 0 || compareScores(sorted[i - 1]!, team) !== 0) rank = i + 1;
      ranked.push({ ...team, group, rank });
    });
  });
  return ranked;
}

/** Negative when `a` ranks above `b`. */
function compareScores(a: TeamScore, b: TeamScore): number {
  const byScore = descending(a.score, b.score);
  if (byScore !== 0) return byScore;
  const n = Math.min(a.tieBreak.length, b.tieBreak.length);
  for (let i = 0; i < n; i++) {
    const byTieBreak = descending(a.tieBreak[i]!, b.tieBreak[i]!);
    if (byTieBreak !== 0) return byTieBreak;
  }
  return 0;
}

/**
 * Larger first. NaN, or anything else that is not a number (null after a trip through JSON), counts
 * as the lowest value, so the sort order stays consistent and the same on every engine.
 */
function descending(a: number, b: number): number {
  const x = typeof a === "number" && !Number.isNaN(a) ? a : -Infinity;
  const y = typeof b === "number" && !Number.isNaN(b) ? b : -Infinity;
  return x === y ? 0 : x > y ? -1 : 1;
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
  const groups = new Map<string, RankedTeam[]>();
  for (const team of ranked) {
    const list = groups.get(team.group);
    if (list) list.push(team);
    else groups.set(team.group, [team]);
  }
  const awards: PrizeAward[] = [];
  groups.forEach((list, group) => {
    const teams = list.slice().sort((a, b) => a.rank - b.rank);
    const first = teams[0]!;
    let next = 0;
    for (const row of prizeTable(prizes, first.track, first.division)) {
      const award: PrizeAward = { group, place: row.place, teams: [], tieExpanded: false };
      if (row.amount !== undefined) award.amount = row.amount;
      if (row.label !== undefined) award.label = row.label;
      const size = Math.floor(row.teams);
      if (size >= 1 && next < teams.length) {
        let end = Math.min(next + size, teams.length);
        while (end < teams.length && teams[end]!.rank === teams[end - 1]!.rank) end++;
        award.teams = teams.slice(next, end).map((t) => t.id);
        award.tieExpanded = end - next > size;
        next = end;
      }
      awards.push(award);
    }
  });
  return awards;
}

/** The `prizes` argument of assignPrizes from event.json's tracks: track id → that track's `prizes`. */
export function prizesByTrack(tracks: Readonly<Record<string, { prizes: TrackPrizes }>>): Record<string, TrackPrizes> {
  return Object.fromEntries(Object.entries(tracks).map(([id, track]) => [id, track.prizes]));
}

/** The table of a group: the track's list, or the entry for the group's division in a per-division map. */
function prizeTable(prizes: Readonly<Record<string, TrackPrizes>>, track: string, division: string | null): readonly PrizeSpec[] {
  const entry = hasOwn(prizes, track) ? prizes[track] : undefined;
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  const byDivision = entry as Readonly<Record<string, PrizeSpec[]>>;
  return division !== null && hasOwn(byDivision, division) ? byDivision[division] ?? [] : [];
}
