// dist/runtime.gs.js in an empty vm context (no Node globals) must score, rank, award and assign
// divisions exactly like the Node import, on fixtures built from both examples' event.json.
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { buildRuntime } from "../scripts/build-runtime.mjs";
import type { EventJson } from "../src/build/event-json.js";
import * as runtime from "../src/runtime/index.js";
import type { JudgeSheet, TeamForDivision, TeamMember, TeamRef, TeamVotes } from "../src/runtime/types.js";
import { buildExample, referenceCase } from "./examples.js";

/** mulberry32: deterministic numbers in [0, 1), so the fixtures are the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Team ids of a track's ranges ("01-10" → 01…10). */
function teamIds(ranges: readonly string[]): string[] {
  return ranges.flatMap((range) => {
    const [lo, hi = lo] = range.split("-").map((p) => Number(p.trim()));
    return Array.from({ length: hi! - lo! + 1 }, (_, i) => String(lo! + i).padStart(2, "0"));
  });
}

/** A track as event.json carries it; both sides convert it with trackDivisionSpec and prizesByTrack. */
type EventTrack = Parameters<typeof runtime.trackDivisionSpec>[0];

interface Fixture {
  name: string;
  scoring: EventJson["scoring"];
  teams: TeamRef[];
  sheets: JudgeSheet[];
  votes: TeamVotes | null;
  tracks: EventJson["tracks"];
  divisions: { track: EventTrack; defs: Record<string, runtime.DivisionDef>; team: TeamForDivision }[];
}

const leavesOf = (list: readonly runtime.Criterion[]): runtime.Criterion[] => list.flatMap((c) => (c.children?.length ? leavesOf(c.children) : [c]));

/**
 * Random sheets from four judges per team: 2-decimal scores, sometimes a blank leaf or a value
 * outside 0..max, sometimes a second sheet from the same judge. Team 02 copies team 01, so ties occur.
 */
function randomSheets(scoring: EventJson["scoring"], teams: readonly TeamRef[], next: () => number): JudgeSheet[] {
  const leaves = leavesOf(scoring.criteria);
  const sheets: JudgeSheet[] = [];
  for (const team of teams) {
    for (const judge of ["j1", "j2", "j3", "j4"]) {
      const scores = Object.fromEntries(leaves.map((c) => [c.key, next() < 0.08 ? null : Math.round(next() * (c.max! + 2) * 100) / 100 - 1]));
      sheets.push({ judge, team: team.id, scores });
      if (next() < 0.1) sheets.push({ judge, team: team.id, scores: { ...scores, [leaves[0]!.key]: leaves[0]!.max! } });
    }
  }
  const copied = sheets.filter((s) => s.team === "01").map((s) => ({ ...s, team: "02" }));
  return [...sheets.filter((s) => s.team !== "02"), ...copied];
}

function referenceFixtures(): Fixture[] {
  const { eventJson } = buildExample("reference");
  const next = random(2027);
  const teams = Object.entries(eventJson.tracks).flatMap(([track, t]) => teamIds(t.teams).map((id) => ({ id, track, division: null })));
  const votes = Object.fromEntries(teams.map((t) => [t.id, t.id === "02" ? 0 : Math.floor(next() * 40)]));
  votes["02"] = votes["01"]!;
  const golden = referenceCase(eventJson);
  const noDivisions = { track: eventJson.tracks.hackathon!, defs: {}, team: { members: [] } };
  const { scoring, tracks } = eventJson;
  return [
    { name: "reference, random sheets", scoring, teams, sheets: randomSheets(scoring, teams, next), votes, tracks, divisions: [noDivisions] },
    { name: "reference, design doc 3.4", scoring, ...golden, tracks, divisions: [] },
  ];
}

function companyFixture(): Fixture {
  const { eventJson } = buildExample("company");
  const next = random(5);
  const main = eventJson.tracks.main!;
  const defs = eventJson.divisions;
  const kinds = ["정직원", "계약직", "학생 인턴", "학생 인턴"];
  const divisionCases: Fixture["divisions"] = [];
  const teams = teamIds(main.teams).map((id): TeamRef => {
    const members: TeamMember[] = Array.from({ length: 2 + Math.floor(next() * 3) }, (_, i) => ({
      role: i === 0 ? "leader" : "member",
      person: { email: `member${i}@example.com`, answers: { "고용 형태": kinds[Math.floor(next() * kinds.length)]! } },
    }));
    const team = { members };
    divisionCases.push({ track: main, defs, team }, { track: { ...main, division_mode: "declared" }, defs, team: { ...team, declared: "intern" } });
    return { id, track: "main", division: runtime.resolveTeamDivision(runtime.trackDivisionSpec(main), defs, team).division };
  });
  return { name: "company", scoring: eventJson.scoring, teams, sheets: randomSheets(eventJson.scoring, teams, next), votes: null, tracks: eventJson.tracks, divisions: divisionCases };
}

const FIXTURES = [...referenceFixtures(), companyFixture()];

/** Through JSON, the way values cross into and out of the Apps Script server. */
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("runtime parity: dist/runtime.gs.js vs Node", () => {
  let ctx: vm.Context;
  beforeAll(async () => {
    ctx = vm.createContext({});
    vm.runInContext(await buildRuntime({ write: false }), ctx);
  });

  const inBundle = (expr: string, input: unknown): unknown => {
    ctx.input = JSON.stringify(input);
    return JSON.parse(vm.runInContext(`JSON.stringify((() => { const input = JSON.parse(globalThis.input); return ${expr}; })())`, ctx) as string);
  };

  it("has fixtures that reach the interesting cases", () => {
    const company = FIXTURES.find((f) => f.name === "company")!;
    expect(new Set(company.teams.map((t) => t.division))).toEqual(new Set(["intern", "staff"]));
    const scores = runtime.computeTeamScores(company.scoring, company.teams, company.sheets, company.votes);
    expect(scores.some((s) => s.judges < 4)).toBe(true);
    const ranked = runtime.rankTeams(scores, company.scoring.rankGroups);
    expect(ranked.some((t, i) => i > 0 && t.rank === ranked[i - 1]!.rank)).toBe(true);
  });

  for (const fixture of FIXTURES) {
    it(`scores, ranks and awards like Node: ${fixture.name}`, () => {
      const scores = runtime.computeTeamScores(fixture.scoring, fixture.teams, fixture.sheets, fixture.votes);
      const ranked = runtime.rankTeams(scores, fixture.scoring.rankGroups);
      const awards = runtime.assignPrizes(ranked, runtime.prizesByTrack(fixture.tracks));
      expect(awards.some((a) => a.teams.length > 0)).toBe(true);
      expect(inBundle("SHK.computeTeamScores(input.scoring, input.teams, input.sheets, input.votes)", fixture)).toEqual(json(scores));
      expect(inBundle("SHK.rankTeams(input.scores, input.rankGroups)", { scores, rankGroups: fixture.scoring.rankGroups })).toEqual(json(ranked));
      expect(inBundle("SHK.assignPrizes(input.ranked, SHK.prizesByTrack(input.tracks))", { ranked, tracks: fixture.tracks })).toEqual(json(awards));
    });

    if (fixture.divisions.length === 0) continue;
    it(`resolves divisions like Node: ${fixture.name}`, () => {
      const expected = fixture.divisions.map((c) => runtime.resolveTeamDivision(runtime.trackDivisionSpec(c.track), c.defs, c.team));
      expect(inBundle("input.map((c) => SHK.resolveTeamDivision(SHK.trackDivisionSpec(c.track), c.defs, c.team))", fixture.divisions)).toEqual(json(expected));
    });
  }
});
