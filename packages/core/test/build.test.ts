import { describe, expect, it } from "vitest";
import { KIT_VERSION, buildEventJson, buildScoringConfig, configHash } from "../src/build/event-json.js";
import { merge } from "../src/config/merge.js";
import { parseResolved, type ResolvedConfig } from "../src/config/schema.js";
import { buildExample, type ExampleName } from "./examples.js";

const withChanges = (config: ResolvedConfig, over: unknown): ResolvedConfig => {
  const { config: changed, diagnostics } = parseResolved(merge(config, over));
  if (!changed) throw new Error(JSON.stringify(diagnostics));
  return changed;
};

describe("buildEventJson: the examples (design doc 8.3)", () => {
  for (const name of ["reference", "company"] as ExampleName[]) {
    it(`matches the snapshot of ${name}`, async () => {
      const { eventJson } = buildExample(name);
      await expect(`${JSON.stringify(eventJson, null, 2)}\n`).toMatchFileSnapshot(`./__snapshots__/${name}.event.json`);
    });
  }

  it("has exactly the public sections, staff-only values left out", () => {
    const { config, eventJson } = buildExample("reference");
    expect(Object.keys(config)).toEqual(expect.arrayContaining(["github", "roster", "repo", "reviewers", "submit"]));
    expect(Object.keys(eventJson)).toEqual(["schema", "kit", "config_hash", "event", "site", "schedule", "tracks", "divisions", "intake", "scoring", "modules", "addons", "privacy"]);
    const text = JSON.stringify(eventJson);
    for (const secretish of ["example-hackathon-org", "docs.google.com", "readme_required_sections", "expires_at", "team_max_gb"]) expect(text).not.toContain(secretish);
    expect(eventJson.kit).toEqual({ version: KIT_VERSION });
  });

  it("puts the runtime shapes of scoring and divisions in, formulas with their ASTs", () => {
    const { eventJson } = buildExample("company");
    expect(eventJson.divisions.intern).toEqual({ name: "학생 인턴", when: { field: "고용 형태", eq: "학생 인턴" }, teamRule: "all_members" });
    expect(eventJson.scoring).toMatchObject({ formula: null, judgeAggregate: { method: "trimmed_mean", trim: 1 }, rankGroups: ["track", "division"] });
    expect(eventJson.scoring.overrides).toEqual([
      {
        when: { division: "intern" },
        tieBreak: [
          { source: "crit.idea", ast: { k: "v", n: "crit.idea" } },
          { source: "judge", ast: { k: "v", n: "judge" } },
        ],
      },
    ]);
    expect(eventJson.scoring.criteria[1]).toEqual({
      key: "impl",
      name: "구현",
      weight: 1,
      children: [
        { key: "done", name: "완성도", weight: 1, max: 20 },
        { key: "quality", name: "코드 품질", weight: 1, max: 20 },
      ],
    });
  });

  it("keeps only enabled add-ons, with option defaults filled in", () => {
    const { config } = buildExample("reference");
    const changed = withChanges(config, { addons: { popular_vote: { votes_per_voter: null, self_vote: null }, notices: { enabled: false }, github_ops: { enabled: false } } });
    expect(buildEventJson(changed).addons).toEqual({ popular_vote: { votes_per_voter: 3, self_vote: false } });
  });

  it("hashes the normalized JSON: key order does not matter, values do", () => {
    const { config, eventJson } = buildExample("reference");
    const { config_hash, ...rest } = eventJson;
    expect(config_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(configHash(rest)).toBe(config_hash);
    expect(configHash({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(configHash({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(buildEventJson(withChanges(config, { site: { tagline: "다른 문구" } })).config_hash).not.toBe(config_hash);
  });

  it("builds only from an event config", () => {
    const { config } = buildExample("reference");
    expect(() => buildEventJson({ ...config, kind: "profile" })).toThrow("kind: event");
  });
});

describe("buildScoringConfig", () => {
  it("fills defaults, keeps override fields as written and switches an override to the weighted sum", () => {
    const { config } = buildExample("reference");
    const changed = withChanges(config, {
      scoring: {
        popular_normalize: { method: "capped_sqrt" },
        overrides: [{ when: { track: "assignment" }, formula: null, components: { judge: 0.9, popular: 0.1 }, judge_aggregate: { method: "median", trim: 3 } }],
      },
    });
    const scoring = buildScoringConfig(changed);
    expect(scoring.popularNormalize).toEqual({ method: "capped_sqrt", fullAtMultiple: 2 });
    expect(scoring.overrides).toEqual([{ when: { track: "assignment" }, formula: null, components: { judge: 0.9, popular: 0.1 }, judgeAggregate: { method: "median" } }]);
  });

  it("refuses a formula that does not compile", () => {
    const { config } = buildExample("reference");
    expect(() => buildScoringConfig(withChanges(config, { scoring: { tie_break: ["judge", "nope("] } }))).toThrow("scoring.tie_break[1]");
  });
});
