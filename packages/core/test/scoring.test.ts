import { describe, expect, it } from "vitest";
import { rankTeams } from "../src/runtime/ranking.js";
import { computeTeamScores, overrideApplies } from "../src/runtime/scoring.js";
import { roundTo } from "../src/runtime/util.js";
import type { JudgeAggregate, ScoringConfig, TeamRef } from "../src/runtime/types.js";
import { REFERENCE_VOTES } from "./examples.js";
import {
  REFERENCE_CRITERIA,
  REFERENCE_FORMULA,
  formula,
  group,
  leaf,
  referenceSheets,
  scoringConfig,
  sheet,
  team,
} from "./helpers.js";

/** a (weight 2) + g (weight 0.5) = b + 3 × c: max_total = 2 × 10 + 0.5 × (20 + 3 × 10) = 45. */
const TREE = [leaf("a", 10, 2), group("g", [leaf("b", 20), leaf("c", 10, 3)], 0.5)];

const one = (config: ScoringConfig, scores: Record<string, number | null>[], votes?: Record<string, number>) =>
  computeTeamScores(config, [team("T1")], scores.map((s, i) => sheet(`j${i}`, "T1", s)), votes)[0]!;

describe("computeTeamScores: the criteria tree", () => {
  it("takes weighted sums at leaves, parents and the top level", () => {
    const s = one(scoringConfig({ criteria: TREE }), [{ a: 5, b: 10, c: 4 }]);
    expect(s.crit).toEqual({ a: 5, g: 22, b: 10, c: 4 });
    expect(s.judge).toBe(21);
    expect(s.score).toBe(21);
    expect(s).toMatchObject({ id: "T1", track: "t", division: null, judges: 1, unscored: false, popularVote: null, warnings: [] });
  });

  it("gives formulas judge, judges, max_total, crit.* and critmax.*", () => {
    const f = formula("judge / max_total * 100 + judges + critmax.g + crit.g / 100", TREE);
    const s = one(scoringConfig({ criteria: TREE, formula: f }), [{ a: 5, b: 10, c: 4 }]);
    expect(s.rawScore).toBeCloseTo((21 / 45) * 100 + 1 + 50 + 0.22, 10);
    expect(s.score).toBe(97.89);
  });

  it("rounds entries to input_step, halves away from zero, and keeps them within 0..max", () => {
    const c = scoringConfig({ criteria: [leaf("x", 25)] });
    expect(one(c, [{ x: 21.555 }]).judge).toBe(21.56);
    expect(one(c, [{ x: 30 }]).judge).toBe(25);
    expect(one(c, [{ x: -3 }]).judge).toBe(0);
    const half = { ...c, inputStep: 0.5 };
    expect(one(half, [{ x: 7.25 }]).judge).toBe(7.5);
    expect(one(half, [{ x: 7.2 }]).judge).toBe(7);
  });

  it("brings a huge entry down to max instead of letting it overflow, so the ranking holds", () => {
    const c = scoringConfig({ criteria: [leaf("x", 100)] });
    for (const huge of [1e297, 1e298, 1e300, Number.MAX_VALUE]) expect(one(c, [{ x: huge }]).judge, String(huge)).toBe(100);
    const scores = computeTeamScores(c, [team("a"), team("b"), team("c")], [sheet("j", "a", { x: 80 }), sheet("j", "b", { x: 1e300 }), sheet("j", "c", { x: 90 })]);
    expect(scores.map((s) => [s.id, s.judge, s.score])).toEqual([
      ["a", 80, 80],
      ["b", 100, 100],
      ["c", 90, 90],
    ]);
    expect(rankTeams(scores, c.rankGroups).map((t) => [t.id, t.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });
});

describe("computeTeamScores: which judges count", () => {
  const two = scoringConfig({ criteria: [leaf("x", 10), leaf("y", 10)] });

  it("require_complete counts only judges who filled every leaf", () => {
    const s = one(two, [{ x: 8, y: 6 }, { x: 10 }, { x: 10, y: null }]);
    expect(s).toMatchObject({ judge: 14, judges: 1, crit: { x: 8, y: 6 } });
  });

  it("without require_complete counts blanks as 0 and skips judges who entered nothing", () => {
    const s = one({ ...two, requireComplete: false }, [{ x: 8, y: 6 }, { x: 10 }, { x: null }, {}]);
    expect(s).toMatchObject({ judge: 12, judges: 2, crit: { x: 9, y: 3 } });
  });

  it("ignores values that are not numbers", () => {
    const s = one(two, [{ x: 8, y: Number.NaN }, { x: "9" as unknown as number, y: 1 }]);
    expect(s).toMatchObject({ judges: 0, unscored: true });
  });

  it("marks a team without counted judges unscored with judge = 0", () => {
    const s = computeTeamScores(two, [team("T1"), team("T2")], [sheet("j1", "T2", { x: 1, y: 1 })])[0]!;
    expect(s).toMatchObject({ judge: 0, judges: 0, unscored: true, crit: { x: 0, y: 0 }, rawScore: 0, score: 0 });
  });

  it("keeps only the last sheet of a judge for a team", () => {
    const s = computeTeamScores(two, [team("T1")], [sheet("j1", "T1", { x: 1, y: 1 }), sheet("j2", "T1", { x: 4, y: 4 }), sheet("j1", "T1", { x: 2, y: 2 })])[0]!;
    expect(s).toMatchObject({ judges: 2, judge: 6 });
  });
});

describe("computeTeamScores: judge_aggregate", () => {
  const totals = (aggregate: JudgeAggregate, values: number[]) =>
    computeTeamScores(scoringConfig({ criteria: REFERENCE_CRITERIA, judgeAggregate: aggregate }), [team("T1")], referenceSheets("T1", values))[0]!;

  it("mean", () => {
    expect(totals({ method: "mean" }, [60, 70, 80, 100]).judge).toBe(77.5);
  });

  it("median: the middle value, or the mean of the two middle values", () => {
    expect(totals({ method: "median" }, [100, 60, 80, 70]).judge).toBe(75);
    expect(totals({ method: "median" }, [100, 60, 80]).judge).toBe(80);
  });

  it("trimmed_mean drops trim judges from each end only when there are more than 2 × trim", () => {
    expect(totals({ method: "trimmed_mean", trim: 1 }, [100, 60, 80, 70]).judge).toBe(75);
    expect(totals({ method: "trimmed_mean" }, [100, 60, 80]).judge).toBe(80);
    expect(totals({ method: "trimmed_mean", trim: 1 }, [100, 60]).judge).toBe(80);
    expect(totals({ method: "trimmed_mean", trim: 2 }, [100, 60, 80, 70]).judge).toBe(77.5);
  });

  it("aggregates every crit.<key> with the same method", () => {
    const s = computeTeamScores(scoringConfig({ criteria: TREE, judgeAggregate: { method: "median" } }), [team("T1")], [
      sheet("j1", "T1", { a: 1, b: 0, c: 0 }),
      sheet("j2", "T1", { a: 9, b: 20, c: 10 }),
      sheet("j3", "T1", { a: 2, b: 4, c: 2 }),
    ])[0]!;
    expect(s.crit).toEqual({ a: 2, g: 10, b: 4, c: 2 });
    expect(s.judge).toBe(9);
  });
});

describe("computeTeamScores: popular vote", () => {
  const teams = [team("A"), team("B"), team("C")];

  it("share_of_max: 100 × votes / max_votes, 0 when nobody has a vote", () => {
    const c = scoringConfig({ components: { popular: 1 } });
    expect(computeTeamScores(c, teams, [], { A: 30, B: 15 }).map((s) => s.score)).toEqual([100, 50, 0]);
    expect(computeTeamScores(c, teams, [], {}).map((s) => s.score)).toEqual([0, 0, 0]);
  });

  it("capped_sqrt: 100 × sqrt(min(1, votes / (m × avg_votes))), 0 when the average is 0", () => {
    const c = scoringConfig({ components: { popular: 1 }, popularNormalize: { method: "capped_sqrt", fullAtMultiple: 1 } });
    expect(computeTeamScores(c, teams, [], { A: 11, B: 1 }).map((s) => s.score)).toEqual([100, 50, 0]);
    expect(computeTeamScores(c, teams, [], { A: 0 }).map((s) => s.score)).toEqual([0, 0, 0]);
  });

  it("totals votes per rank group and ignores votes that are not positive numbers", () => {
    const mixed: TeamRef[] = [team("A", "h"), team("B", "h"), team("C", "a"), team("D", "h", "student")];
    const scores = computeTeamScores(scoringConfig({ components: { popular: 1 } }), mixed, [], { A: 6, B: -2, C: 3, D: 1, X: 99 });
    expect(scores.map((s) => s.popularVote)).toEqual([
      { votes: 6, totalVotes: 6, avgVotes: 3, maxVotes: 6, teamCount: 2, popular: 100 },
      { votes: 0, totalVotes: 6, avgVotes: 3, maxVotes: 6, teamCount: 2, popular: 0 },
      { votes: 3, totalVotes: 3, avgVotes: 3, maxVotes: 3, teamCount: 1, popular: 100 },
      { votes: 1, totalVotes: 1, avgVotes: 1, maxVotes: 1, teamCount: 1, popular: 100 },
    ]);
  });

  it("never reads votes through the prototype chain", () => {
    const s = computeTeamScores(scoringConfig({ components: { popular: 1 } }), [team("constructor"), team("toString")], [], {});
    expect(s.map((x) => x.popularVote?.votes)).toEqual([0, 0]);
  });
});

describe("computeTeamScores: reference case (design doc 3.4)", () => {
  // 10-team track, 60 voters × 3 votes = 180 votes, 18 per team on average.
  const teams = REFERENCE_VOTES.map((_, i) => team(`T${i + 1}`, "hackathon"));
  const votes = Object.fromEntries(REFERENCE_VOTES.map((v, i) => [`T${i + 1}`, v]));
  const config = scoringConfig({ criteria: REFERENCE_CRITERIA, formula: formula(REFERENCE_FORMULA, REFERENCE_CRITERIA, true) });

  it("gives the popular part of the table", () => {
    const scores = computeTeamScores(config, teams, [], votes);
    expect(scores[0]!.popularVote).toMatchObject({ totalVotes: 180, teamCount: 10, avgVotes: 18, maxVotes: 80 });
    expect(scores.slice(0, 7).map((s) => s.score)).toEqual([15, 15, 12.99, 10.61, 7.5, 4.33, 0]);
  });

  it("gives S = 80.99 for judge 80 with 27 votes and S = 63.83 for judge 70 with 3 votes", () => {
    const sheets = [...referenceSheets("T3", [76, 84]), ...referenceSheets("T6", [70])];
    const scores = computeTeamScores(config, teams, sheets, votes);
    expect(scores[2]).toMatchObject({ judge: 80, judges: 2, score: 80.99 });
    expect(scores[5]).toMatchObject({ judge: 70, judges: 1, score: 63.83 });
    expect(scores[2]!.rawScore).toBeCloseTo(68 + 15 * Math.sqrt(0.75), 12);
  });

  it("is the same as the weighted sum 0.85 × judge + 0.15 × popular with capped_sqrt(2)", () => {
    const weighted = scoringConfig({
      criteria: REFERENCE_CRITERIA,
      components: { judge: 0.85, popular: 0.15 },
      popularNormalize: { method: "capped_sqrt", fullAtMultiple: 2 },
    });
    const sheets = [...referenceSheets("T3", [80]), ...referenceSheets("T6", [70])];
    const viaFormula = computeTeamScores(config, teams, sheets, votes).map((s) => s.score);
    expect(computeTeamScores(weighted, teams, sheets, votes).map((s) => s.score)).toEqual(viaFormula);
  });
});

describe("computeTeamScores: formulas, tie_break and overrides", () => {
  it("rounds S and every tie_break value to precision and keeps S unrounded too", () => {
    const c = scoringConfig({ formula: formula("crit.a / 3", [leaf("a", 10)]), tieBreak: [formula("judge / 7", [leaf("a", 10)])], precision: 3 });
    const s = one(c, [{ a: 10 }]);
    expect(s.rawScore).toBe(10 / 3);
    expect(s.score).toBe(3.333);
    expect(s.tieBreak).toEqual([1.429]);
  });

  it("reports a non-finite result as 0 with a warning", () => {
    const s = one(scoringConfig({ formula: formula("1000000000 ^ 40", []) }), [{ a: 1 }]);
    expect(s.score).toBe(0);
    expect(s.warnings).toEqual(["거듭제곱(^) 결과가 유한한 수가 아니어서 0으로 바꿨습니다."]);
    const weighted = one(scoringConfig({ criteria: [leaf("a", Number.MAX_VALUE)], components: { judge: 2 } }), [{ a: Number.MAX_VALUE }]);
    expect(weighted).toMatchObject({ rawScore: 0, score: 0, warnings: ["계산 결과가 유한한 수가 아니어서 0으로 바꿨습니다."] });
  });

  it("applies matching overrides in order, later ones winning; formula null means the weighted sum", () => {
    const base = [leaf("a", 10)];
    const other = [leaf("b", 50)];
    const c = scoringConfig({
      criteria: base,
      formula: formula("judge * 2", base),
      overrides: [
        { when: { track: "x" }, criteria: other, formula: formula("crit.b + 1", other) },
        { when: { track: "x", division: "d" }, formula: null, components: { judge: 3 } },
        { when: {}, precision: 0 },
      ],
    });
    const teams = [team("T1", "t"), team("T2", "x"), team("T3", "x", "d")];
    const sheets = [sheet("j", "T1", { a: 4.4 }), sheet("j", "T2", { b: 20.6 }), sheet("j", "T3", { b: 10.2 })];
    expect(computeTeamScores(c, teams, sheets).map((s) => [s.rawScore, s.score])).toEqual([
      [8.8, 9],
      [21.6, 22],
      [30.599999999999998, 31],
    ]);
  });

  it("matches an override when every key it gives matches", () => {
    expect(overrideApplies({}, "t", null)).toBe(true);
    expect(overrideApplies({ track: "t" }, "t", "d")).toBe(true);
    expect(overrideApplies({ track: "t", division: "d" }, "t", null)).toBe(false);
    expect(overrideApplies({ division: "d" }, "x", "d")).toBe(true);
    expect(overrideApplies({ track: "t" }, null, null)).toBe(false);
  });

  it("refuses a formula that uses variables the team's settings do not have", () => {
    const votesFormula = scoringConfig({ formula: formula("votes", [], true) });
    expect(() => computeTeamScores(votesFormula, [team("T1")], [])).toThrow("점수 설정과 맞지 않는 수식");
    const base = [leaf("a", 10)];
    const swapped = scoringConfig({ criteria: base, formula: formula("crit.a", base), overrides: [{ when: { track: "t" }, criteria: [leaf("b", 5)] }] });
    expect(() => computeTeamScores(swapped, [team("T1")], [])).toThrow('"crit.a"는 쓸 수 없는 변수입니다.');
  });

  it("refuses a popular component without votes", () => {
    expect(() => computeTeamScores(scoringConfig({ components: { judge: 1, popular: 0.5 } }), [team("T1")], [])).toThrow("popular_vote");
  });

  it("matches the reference rounding of S", () => {
    expect(roundTo(0.85 * 70 + 15 * Math.sqrt(3 / 36), 2)).toBe(63.83);
  });
});
