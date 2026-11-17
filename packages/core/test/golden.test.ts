// The reference case end to end: examples/reference-2track through load, merge, check and build,
// then fake judge sheets and votes through the runtime with the scoring config event.json carries.
import { describe, expect, it } from "vitest";
import { assignPrizes, prizesByTrack, rankTeams } from "../src/runtime/ranking.js";
import { computeTeamScores } from "../src/runtime/scoring.js";
import { roundTo } from "../src/runtime/util.js";
import { REFERENCE_VOTES, buildExample, referenceCase } from "./examples.js";

const { config, diagnostics, eventJson } = buildExample("reference");
const { teams, sheets, votes } = referenceCase(eventJson);
const scores = computeTeamScores(eventJson.scoring, teams, sheets, votes);
const byId = (id: string) => scores.find((s) => s.id === id)!;

describe("reference case: config", () => {
  it("resolves preset → profile → event and checks without problems", () => {
    expect(diagnostics).toEqual([{ id: "V3", severity: "info", path: "scoring.criteria", message: "심사 총점의 만점(max_total)은 100점입니다." }]);
    expect(config.scoring.criteria.map((c) => [c.key, c.max, c.weight])).toEqual([
      ["idea", 25, undefined],
      ["done", 25, undefined],
      ["ux", 25, undefined],
      ["arch", 25, undefined],
    ]);
    expect(config.tracks.hackathon).toMatchObject({ id: "H", name: "해커톤", order: 1, teams: ["01-10"] });
    expect(config.intake.fields.map((f) => f.key)).toEqual(["성함", "연락처", "GitHub 아이디", "팀 보유 여부 및 팀원", "학번", "학년", "소속", "재학 상태", "희망 트랙"]);
    expect(eventJson.scoring.formula?.source).toBe("0.85 * judge + 15 * sqrt(min(1, votes / (2 * avg_votes)))");
    expect(eventJson.scoring.tieBreak.map((f) => f.source)).toEqual(["judge", "crit.arch"]);
  });
});

describe("reference case: scores (design doc 3.4)", () => {
  it("totals votes per track: 180 votes over 10 teams, 18 on average", () => {
    // popular is share_of_max (the default); the reference formula reads votes and avg_votes instead.
    expect(byId("01").popularVote).toEqual({ votes: 80, totalVotes: 180, avgVotes: 18, maxVotes: 80, teamCount: 10, popular: 100 });
    expect(byId("11").popularVote).toMatchObject({ totalVotes: 50, avgVotes: 5, teamCount: 10 });
  });

  it("gives the popular part of the table", () => {
    const popularPart = scores.slice(0, 10).map((s) => roundTo(s.rawScore - 0.85 * s.judge, 2));
    expect(REFERENCE_VOTES.slice(0, 7)).toEqual([80, 36, 27, 18, 9, 3, 0]);
    expect(popularPart.slice(0, 7)).toEqual([15, 15, 12.99, 10.61, 7.5, 4.33, 0]);
  });

  it("gives S = 80.99 for judge 80 with 27 votes and S = 63.83 for judge 70 with 3 votes", () => {
    expect(byId("03")).toMatchObject({ judge: 80, judges: 2, score: 80.99, tieBreak: [80, 20] });
    expect(byId("06")).toMatchObject({ judge: 70, judges: 1, score: 63.83, tieBreak: [70, 17.5] });
    expect(byId("01")).toMatchObject({ judge: 0, judges: 0, unscored: true, score: 15 });
  });

  it("ranks the track and gives every team tied at a prize boundary that prize", () => {
    const ranked = rankTeams(scores, eventJson.scoring.rankGroups);
    const hackathon = ranked.filter((t) => t.group === "hackathon");
    expect(hackathon.slice(0, 5).map((t) => [t.id, t.rank, t.score])).toEqual([
      ["03", 1, 80.99],
      ["06", 2, 63.83],
      ["01", 3, 15],
      ["02", 3, 15],
      ["04", 5, 10.61],
    ]);
    expect(assignPrizes(ranked, prizesByTrack(eventJson.tracks))).toEqual([
      { group: "hackathon", place: 1, amount: 500000, teams: ["03"], tieExpanded: false },
      { group: "hackathon", place: 2, amount: 300000, teams: ["06", "01", "02"], tieExpanded: true },
      { group: "assignment", place: 1, amount: 200000, teams: ["11", "12", "13", "14", "15", "16", "17", "18", "19", "20"], tieExpanded: true },
    ]);
  });
});
