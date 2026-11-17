import { describe, expect, it } from "vitest";
import { assignPrizes, prizesByTrack, rankGroupKey, rankTeams } from "../src/runtime/ranking.js";
import { computeTeamScores } from "../src/runtime/scoring.js";
import type { RankedTeam, TeamScore } from "../src/runtime/types.js";
import { formula, leaf, scoringConfig, sheet, team } from "./helpers.js";

/** A TeamScore with only what ranking reads filled in. */
function scored(id: string, score: number, tieBreak: number[] = [], track = "t", division: string | null = null): TeamScore {
  return { id, track, division, judge: 0, judges: 0, unscored: false, crit: {}, popularVote: null, rawScore: score, score, tieBreak, warnings: [] };
}

const ranks = (list: readonly RankedTeam[]) => list.map((t) => [t.id, t.rank]);

describe("rankGroupKey", () => {
  it("joins the rank-group values and leaves a null division out", () => {
    expect(rankGroupKey(team("A", "hackathon", "student"), ["track", "division"])).toBe("hackathon/student");
    expect(rankGroupKey(team("A", "hackathon"), ["track", "division"])).toBe("hackathon");
    expect(rankGroupKey(team("A", "hackathon", "student"), ["track"])).toBe("hackathon");
  });
});

describe("rankTeams", () => {
  it("gives equal teams the same rank and skips the next ones (1, 2, 2, 4)", () => {
    const ranked = rankTeams([scored("A", 70), scored("B", 90), scored("C", 80), scored("D", 80), scored("E", 10)], ["track"]);
    expect(ranks(ranked)).toEqual([
      ["B", 1],
      ["C", 2],
      ["D", 2],
      ["A", 4],
      ["E", 5],
    ]);
    expect(ranked[0]).toMatchObject({ group: "t", score: 90 });
  });

  it("breaks ties with tie_break values in order, larger first", () => {
    const ranked = rankTeams([scored("A", 80, [70, 1]), scored("B", 80, [75, 0]), scored("C", 80, [70, 3]), scored("D", 80, [70, 3])], ["track"]);
    expect(ranks(ranked)).toEqual([
      ["B", 1],
      ["C", 2],
      ["D", 2],
      ["A", 4],
    ]);
  });

  it("compares S after rounding to precision", () => {
    const criteria = [leaf("a", 100)];
    const c = scoringConfig({ criteria, formula: formula("crit.a", criteria), precision: 2, inputStep: 0.001 });
    const scores = computeTeamScores(c, [team("A"), team("B"), team("C")], [sheet("j", "A", { a: 80.994 }), sheet("j", "B", { a: 80.991 }), sheet("j", "C", { a: 80.995 })]);
    expect(scores.map((s) => s.score)).toEqual([80.99, 80.99, 81]);
    expect(ranks(rankTeams(scores, ["track"]))).toEqual([
      ["C", 1],
      ["A", 2],
      ["B", 2],
    ]);
  });

  it("puts a score or tie_break value that is not a number last, keeping the others in order", () => {
    const ranked = rankTeams([scored("A", 80), scored("N", Number.NaN), scored("C", 90), scored("D", 85, [Number.NaN]), scored("E", 85, [1]), scored("Z", null as unknown as number)], ["track"]);
    expect(ranks(ranked)).toEqual([
      ["C", 1],
      ["E", 2],
      ["D", 3],
      ["A", 4],
      ["N", 5],
      ["Z", 5],
    ]);
  });

  it("ranks each rank group separately, groups in order of first appearance", () => {
    const ranked = rankTeams(
      [scored("A", 1, [], "h", "student"), scored("B", 5, [], "a"), scored("C", 3, [], "h", "student"), scored("D", 9, [], "h", "general")],
      ["track", "division"],
    );
    expect(ranked.map((t) => [t.group, t.id, t.rank])).toEqual([
      ["h/student", "C", 1],
      ["h/student", "A", 2],
      ["a", "B", 1],
      ["h/general", "D", 1],
    ]);
  });
});

describe("assignPrizes", () => {
  const ranked = (list: [string, number][], track = "t", division: string | null = null) =>
    rankTeams(
      list.map(([id, s]) => scored(id, s, [], track, division)),
      ["track", "division"],
    );

  it("fills the table from the top and leaves rows nobody is left for empty", () => {
    const awards = assignPrizes(ranked([["A", 9], ["B", 8], ["C", 7], ["D", 6]]), {
      t: [
        { place: 1, teams: 1, amount: 500000 },
        { place: 2, teams: 2, amount: 300000, label: "우수상" },
        { place: 3, teams: 2 },
        { place: 4, teams: 1 },
      ],
    });
    expect(awards).toEqual([
      { group: "t", place: 1, amount: 500000, teams: ["A"], tieExpanded: false },
      { group: "t", place: 2, amount: 300000, label: "우수상", teams: ["B", "C"], tieExpanded: false },
      { group: "t", place: 3, teams: ["D"], tieExpanded: false },
      { group: "t", place: 4, teams: [], tieExpanded: false },
    ]);
  });

  it("gives a prize to every team tied at its boundary without shrinking the rows below", () => {
    const awards = assignPrizes(ranked([["A", 9], ["B", 8], ["C", 8], ["D", 8], ["E", 5], ["F", 4]]), {
      t: [
        { place: 1, teams: 2 },
        { place: 2, teams: 1 },
      ],
    });
    expect(awards).toEqual([
      { group: "t", place: 1, teams: ["A", "B", "C", "D"], tieExpanded: true },
      { group: "t", place: 2, teams: ["E"], tieExpanded: false },
    ]);
  });

  it("uses a per-division table for the group's division and nothing for tracks without prizes", () => {
    const list = [
      ...ranked([["S1", 3], ["S2", 2]], "h", "student"),
      ...ranked([["G1", 9]], "h", "general"),
      ...ranked([["X1", 9]], "other"),
    ];
    const awards = assignPrizes(list, { h: { student: [{ place: 1, teams: 1, label: "학생부 대상" }] } });
    expect(awards).toEqual([{ group: "h/student", place: 1, label: "학생부 대상", teams: ["S1"], tieExpanded: false }]);
  });

  it("takes event.json's tracks through prizesByTrack", () => {
    const tracks = { t: { name: "T", divisions: [], prizes: [{ place: 1, teams: 1 }] }, u: { name: "U", divisions: [], prizes: [] } };
    expect(prizesByTrack(tracks)).toEqual({ t: [{ place: 1, teams: 1 }], u: [] });
    expect(assignPrizes(ranked([["A", 9], ["B", 8]]), prizesByTrack(tracks))).toEqual([{ group: "t", place: 1, teams: ["A"], tieExpanded: false }]);
  });
});
