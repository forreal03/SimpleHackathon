import { describe, expect, it } from "vitest";
import { buildEventJson } from "../src/build/event-json.js";
import { checkConfig, type Diagnostic } from "../src/config/check.js";
import type { SourceFile } from "../src/config/load.js";
import { merge } from "../src/config/merge.js";
import { parseResolved, type ResolvedConfig } from "../src/config/schema.js";

/** A small valid event: one track of five teams, one question, one criterion. */
const BASE = {
  schema: 2,
  kind: "event",
  event: { id: "test-2027", name: "Test" },
  tracks: { a: { name: "A", teams: ["01-05"], order: 1 } },
  intake: { fields: [{ key: "성함", type: "text", roster: "name" }] },
  scoring: { criteria: [{ key: "x", name: "X", max: 10 }] },
};

/** BASE with `over` merged on (null deletes), resolved; throws when the schema rejects it. */
function resolve(over: unknown = {}): ResolvedConfig {
  const { config, diagnostics } = parseResolved(merge(BASE, over));
  if (!config) throw new Error(JSON.stringify(diagnostics, null, 2));
  return config;
}

const run = (over: unknown = {}, files: SourceFile[] = []) => checkConfig(resolve(over), { files });
const problems = (over: unknown = {}, files: SourceFile[] = []) => run(over, files).filter((d) => d.severity !== "info");
const only = (id: string, list: Diagnostic[]) => list.filter((d) => d.id === id).map((d) => [d.severity, d.path, d.message]);

const POPULAR = { addons: { popular_vote: { enabled: true } } };

describe("checkConfig on a valid config", () => {
  it("finds no problems and reports max_total", () => {
    expect(run()).toEqual([{ id: "V3", severity: "info", path: "scoring.criteria", message: "심사 총점의 만점(max_total)은 10점입니다." }]);
  });
});

describe("V1: times", () => {
  const SCHEDULE = {
    schedule: {
      recruit: { open: "2027-03-01T08:00:00+09:00", close: "2027-03-20T23:59:59+09:00" },
      sessions: [{ id: "kickoff", at: "2027-03-25T19:00:00+09:00", title: "kickoff" }],
      main: { start: "2027-04-03T19:00:00+09:00", end: "2027-04-04T15:00:00+09:00", submit_deadline: "2027-04-04T10:00:00+09:00" },
      score_until: "2027-04-04T14:25:00+09:00",
      results_at: "off",
    },
    tracks: {
      a: { vote: { from: "2027-04-04T12:00:00+09:00", until: "2027-04-04T12:15:00+09:00" } },
      b: { name: "B", teams: ["06-10"], order: 2, submit_deadline: "2027-04-04T00:00:00Z", vote: { from: "2027-04-04T05:15:00Z", until: "2027-04-04T05:20:00Z" } },
    },
  };

  it("passes an ordered schedule with offsets; a track may have its own deadline", () => {
    expect(problems(SCHEDULE)).toEqual([]);
  });

  it("needs an offset on every time", () => {
    expect(only("V1", run(merge(SCHEDULE, { schedule: { main: { end: "2027-04-04T15:00:00" } } })))).toEqual([
      ["error", "schedule.main.end", '시각은 "2027-04-04T10:00:00+09:00"처럼 날짜, 시각, UTC 오프셋을 함께 적어야 합니다: 2027-04-04T15:00:00'],
    ]);
    expect(only("V1", run(merge(SCHEDULE, { schedule: { results_at: "2027-04-05" } })))).toHaveLength(1);
  });

  it("orders recruit, sessions, start, deadlines, vote windows and score_until", () => {
    const cases: [unknown, string, string][] = [
      [{ schedule: { recruit: { open: "2027-03-21T00:00:00+09:00" } } }, "schedule.recruit.close", "늦어야 합니다"],
      [{ schedule: { sessions: [{ id: "k", at: "2027-03-10T00:00:00+09:00", title: "k" }] } }, "schedule.sessions[0].at", "앞설 수 없습니다"],
      [{ schedule: { sessions: [{ id: "k", at: "2027-04-03T20:00:00+09:00", title: "k" }] } }, "schedule.main.start", "앞설 수 없습니다"],
      [{ schedule: { main: { submit_deadline: "2027-04-03T19:00:00+09:00" } } }, "schedule.main.submit_deadline", "늦어야 합니다"],
      [{ tracks: { a: { vote: { from: "2027-04-04T09:59:00+09:00" } } } }, "tracks.a.vote.from", "앞설 수 없습니다"],
      [{ tracks: { a: { vote: { until: "2027-04-04T12:00:00+09:00" } } } }, "tracks.a.vote.until", "늦어야 합니다"],
      [{ tracks: { a: { vote: { until: "2027-04-04T14:30:00+09:00" } } } }, "schedule.score_until", "앞설 수 없습니다"],
      [{ tracks: { b: { submit_deadline: "2027-04-03T10:00:00Z" } } }, "tracks.b.submit_deadline", "늦어야 합니다"],
    ];
    for (const [over, path, words] of cases) {
      const found = only("V1", run(merge(SCHEDULE, over)));
      expect(found, path).toHaveLength(1);
      expect(found[0]![1]).toBe(path);
      expect(found[0]![2]).toContain(words);
    }
  });

  it("compares the deadline with score_until when a track has no vote window", () => {
    const found = only("V1", run(merge(SCHEDULE, { tracks: { a: { vote: null } }, schedule: { score_until: "2027-04-04T09:00:00+09:00" } })));
    expect(found.map(([, path]) => path)).toEqual(["schedule.score_until", "schedule.score_until"]);
  });

  it("keeps ordering across missing times, strictly when a strict link is skipped", () => {
    const at = (day: string) => `2027-04-${day}T10:00:00+09:00`;
    const cases: [unknown, string, string][] = [
      [{ schedule: { recruit: { open: "2027-05-01T10:00:00+09:00" }, main: { start: at("01") } } }, "schedule.main.start", "늦어야 합니다"],
      [{ schedule: { sessions: [{ id: "k", at: at("10"), title: "k" }], main: { submit_deadline: at("02") } } }, "schedule.main.submit_deadline", "늦어야 합니다"],
      [{ schedule: { main: { start: at("03") } }, tracks: { a: { vote: { from: at("01"), until: at("02") } } } }, "tracks.a.vote.from", "늦어야 합니다"],
      [{ schedule: { main: { start: at("03") }, score_until: at("02") } }, "schedule.score_until", "늦어야 합니다"],
      [{ schedule: { recruit: { close: at("05") }, main: { start: at("05") } } }, "", ""],
    ];
    for (const [over, path, words] of cases) {
      const found = only("V1", run(over));
      if (path === "") {
        expect(found, "close = start without sessions is allowed").toEqual([]);
        continue;
      }
      expect(found, path).toHaveLength(1);
      expect(found[0]![1]).toBe(path);
      expect(found[0]![2]).toContain(words);
    }
  });

  it("refuses days the month does not have instead of rolling them over", () => {
    expect(only("V1", run({ schedule: { main: { start: "2027-04-31T10:00:00+09:00", submit_deadline: "2027-02-29T10:00:00+09:00" } } }))).toEqual([
      ["error", "schedule.main.start", "없는 날짜나 시각입니다: 2027-04-31T10:00:00+09:00"],
      ["error", "schedule.main.submit_deadline", "없는 날짜나 시각입니다: 2027-02-29T10:00:00+09:00"],
    ]);
    expect(only("V1", run({ schedule: { main: { start: "2028-02-29T10:00:00+09:00" } } }))).toEqual([]);
  });
});

describe("V2: team number ranges", () => {
  it("passes ranges that do not overlap", () => {
    expect(problems({ tracks: { b: { name: "B", teams: ["06-10", "12"] } } })).toEqual([]);
  });

  it("refuses ranges of different tracks that overlap, and backwards ranges", () => {
    expect(only("V2", run({ tracks: { b: { name: "B", teams: ["04-08"] }, c: { name: "C", teams: ["10-09"] } } }))).toEqual([
      ["error", "tracks.c.teams[0]", '팀 번호 범위 "10-09"는 작은 번호를 앞에 적어야 합니다.'],
      ["error", "tracks.b.teams[0]", '트랙 b의 팀 번호 "04-08"가 트랙 a의 "01-05"와 겹칩니다. 한 팀은 한 트랙에만 있어야 합니다.'],
    ]);
  });
});

describe("V3: criteria", () => {
  const tree = (criteria: unknown) => ({ scoring: { criteria } });

  it("reports max_total of weighted trees, also for overrides", () => {
    const over = {
      ...tree([{ key: "a", name: "A", max: 10, weight: 2 }, { key: "g", name: "G", weight: 0.5, children: [{ key: "b", name: "B", max: 20 }, { key: "c", name: "C", max: 10, weight: 3 }] }]),
    };
    expect(only("V3", run(merge(over, { scoring: { overrides: [{ when: {}, criteria: [{ key: "z", name: "Z", max: 7 }] }] } })))).toEqual([
      ["info", "scoring.criteria", "심사 총점의 만점(max_total)은 45점입니다."],
      ["info", "scoring.overrides[0].criteria", "심사 총점의 만점(max_total)은 7점입니다."],
    ]);
  });

  it("refuses duplicate keys anywhere in the tree, weights and max not above 0, leaves without max, and keys formulas cannot read", () => {
    const found = only(
      "V3",
      run(
        tree([
          { key: "a", name: "A", max: 0 },
          { key: "g", name: "G", weight: 0, children: [{ key: "a", name: "A2", max: 5 }, { key: "leaf", name: "L" }] },
          { key: "my-key", name: "M", max: 5 },
        ]),
      ),
    );
    expect(found.map(([severity, path]) => [severity, path])).toEqual([
      ["error", "scoring.criteria[0].max"],
      ["error", "scoring.criteria[1].weight"],
      ["error", "scoring.criteria[1].children[0].key"],
      ["error", "scoring.criteria[1].children[1].max"],
      ["error", "scoring.criteria[2].key"],
    ]);
    expect(found[2]![2]).toBe('기준 key "a"가 겹칩니다. key는 기준 트리 전체에서 하나여야 합니다.');
    expect(found[3]![2]).toBe('기준 "leaf"에는 만점(max)이 있어야 합니다.');
  });
});

describe("V4: formulas", () => {
  it("passes formulas and tie_break over the allowed variables", () => {
    expect(problems({ ...POPULAR, scoring: { formula: "0.85 * judge + 15 * sqrt(min(1, votes / (2 * avg_votes)))", tie_break: ["judge", "crit.x"] } })).toEqual([]);
  });

  it("reports compile errors at the formula's path", () => {
    expect(only("V4", run({ scoring: { formula: "judge +", tie_break: ["judge", "exp(judge)", "crit.y"] } }))).toEqual([
      ["error", "scoring.formula", "8번째 글자 근처: 식이 끝나기 전에 값(숫자, 변수, 함수, 괄호)이 하나 더 와야 합니다."],
      ["error", "scoring.tie_break[1]", expect.stringContaining('알 수 없는 함수 "exp"입니다.')],
      ["error", "scoring.tie_break[2]", expect.stringContaining('"crit.y"는 쓸 수 없는 변수입니다.')],
    ]);
  });

  it("allows popular-vote variables and the popular component only with popular_vote on", () => {
    expect(only("V4", run({ scoring: { formula: "judge + votes" } }))).toEqual([["error", "scoring.formula", '9번째 글자 근처: "votes"는 쓸 수 없는 변수입니다. 인기투표 add-on이 꺼져 있습니다.']]);
    expect(only("V4", run({ scoring: { components: { judge: 0.85, popular: 0.15 } } }))).toEqual([
      ["error", "scoring.components.popular", "popular component는 인기투표 add-on(popular_vote)이 켜져 있을 때만 쓸 수 있습니다."],
    ]);
    expect(problems({ ...POPULAR, scoring: { components: { judge: 0.85, popular: 0.15 } } })).toEqual([]);
  });

  it("checks each track and division with the overrides that apply there", () => {
    const over = {
      divisions: { s: { name: "S" }, g: { name: "G" } },
      tracks: { a: { divisions: ["s", "g"] }, b: { name: "B", teams: ["06-10"] } },
      scoring: {
        formula: "crit.x",
        overrides: [{ when: { track: "a", division: "s" }, criteria: [{ key: "y", name: "Y", max: 5 }] }, { when: { track: "b" }, tie_break: ["crit.y"] }],
      },
    };
    expect(only("V4", run(over))).toEqual([
      ["error", "scoring.formula", '1번째 글자 근처: "crit.x"는 쓸 수 없는 변수입니다. 쓸 수 있는 변수: judge, judges, max_total, crit.y, critmax.y (트랙 a · 부문 s에 적용될 때)'],
      ["error", "scoring.overrides[1].tie_break[0]", expect.stringMatching(/"crit\.y"는 쓸 수 없는 변수입니다\..* \(트랙 b에 적용될 때\)$/)],
    ]);
  });

  it("also checks formulas no team reaches, the way build compiles them", () => {
    const shadowed = { scoring: { formula: "judge +", tie_break: ["crit.zzz"], overrides: [{ when: {}, formula: "judge", tie_break: ["judge"] }] } };
    expect(only("V4", run(shadowed))).toEqual([
      ["error", "scoring.formula", "8번째 글자 근처: 식이 끝나기 전에 값(숫자, 변수, 함수, 괄호)이 하나 더 와야 합니다."],
      ["error", "scoring.tie_break[0]", expect.stringContaining('"crit.zzz"는 쓸 수 없는 변수입니다.')],
    ]);
    const unmatched = { divisions: { s: { name: "S" } }, scoring: { overrides: [{ when: { track: "a", division: "s" }, formula: "judge +" }] } };
    expect(only("V4", run(unmatched))).toEqual([["error", "scoring.overrides[0].formula", expect.stringContaining("식이 끝나기 전에")]]);
  });

  it("passes exactly the configs that build", () => {
    const cases: [unknown, boolean][] = [
      [{ scoring: { formula: "judge +", overrides: [{ when: { track: "a" }, formula: "judge" }] } }, false],
      [{ divisions: { s: { name: "S" } }, scoring: { overrides: [{ when: { division: "s" }, tie_break: ["nope("] }] } }, false],
      [{ scoring: { overrides: [{ when: { track: "a" }, criteria: [{ key: "y", name: "Y", max: 5 }], formula: "crit.y" }] } }, true],
    ];
    for (const [over, builds] of cases) {
      const config = resolve(over);
      expect(checkConfig(config, { files: [] }).some((d) => d.severity === "error"), JSON.stringify(over)).toBe(!builds);
      if (builds) expect(() => buildEventJson(config)).not.toThrow();
      else expect(() => buildEventJson(config)).toThrow();
    }
  });
});

describe("V5: prize tables", () => {
  it("passes tables that fit the teams", () => {
    expect(problems({ tracks: { a: { prizes: [{ place: 1, teams: 1 }, { place: 2, teams: 4 }] } } })).toEqual([]);
  });

  it("refuses more prizes than teams in a track without divisions", () => {
    expect(only("V5", run({ tracks: { a: { prizes: [{ place: 1, teams: 2 }, { place: 2, teams: 4 }] } } }))).toEqual([
      ["error", "tracks.a.prizes", "트랙 a의 상금표는 6팀에게 상을 주는데, 이 트랙의 팀은 5팀입니다."],
    ]);
  });

  it("only warns when divisions split the track", () => {
    const over = { divisions: { s: { name: "S" }, g: { name: "G" } }, tracks: { a: { divisions: ["s", "g"], prizes: [{ place: 1, teams: 3 }] } } };
    expect(only("V5", run(over))).toEqual([["warning", "tracks.a.prizes", expect.stringContaining("6팀에게 상을 주는데, 이 트랙의 팀은 5팀입니다.")]]);
    expect(problems(merge(over, { tracks: { a: { prizes: null } } }))).toEqual([]);
  });

  it("needs division ranking for a per-division table", () => {
    const over = { divisions: { s: { name: "S" } }, tracks: { a: { divisions: ["s"], prizes: { s: [{ place: 1, teams: 1 }] } } }, scoring: { rank_groups: ["track"] } };
    expect(only("V5", run(over))).toEqual([["error", "tracks.a.prizes", "부문별 상금표는 트랙에 부문이 있고 scoring.rank_groups에 division이 있을 때만 쓸 수 있습니다."]]);
  });
});

describe("V6: vote windows", () => {
  const windows = (a: [string, string], b: [string, string]) => ({
    tracks: { a: { vote: { from: a[0], until: a[1] } }, b: { name: "B", teams: ["06-10"], order: 2, vote: { from: b[0], until: b[1] } } },
  });
  const T = (hm: string) => `2027-04-04T${hm}:00+09:00`;

  it("passes windows one after another in order", () => {
    expect(problems({ ...POPULAR, ...windows([T("12:00"), T("12:15")], [T("12:15"), T("12:30")]) })).toEqual([]);
  });

  it("refuses overlapping windows and windows out of order", () => {
    expect(only("V6", run({ ...POPULAR, ...windows([T("12:00"), T("12:20")], [T("12:15"), T("12:30")]) }))).toEqual([
      ["error", "tracks.b.vote", "트랙 b의 투표 창이 트랙 a의 투표 창과 겹칩니다."],
    ]);
    expect(only("V6", run({ ...POPULAR, ...windows([T("13:00"), T("13:15")], [T("12:00"), T("12:15")]) }))).toEqual([
      ["error", "tracks.b.vote", "트랙 b의 투표 창이 order가 앞선 트랙 a보다 먼저 열립니다. 투표 창은 order 순서대로 둡니다."],
    ]);
  });

  it("is skipped while popular_vote is off", () => {
    expect(only("V6", run(windows([T("12:00"), T("12:20")], [T("12:15"), T("12:30")])))).toEqual([]);
  });
});

describe("V7: retention", () => {
  it("needs retention_days of 0 or more", () => {
    expect(problems({ privacy: { retention_days: 0 } })).toEqual([]);
    expect(only("V7", run({ privacy: { retention_days: -1 } }))).toEqual([["error", "privacy.retention_days", "개인정보 보관 기간(retention_days)은 0일 이상이어야 합니다."]]);
  });
});

describe("V8: secrets", () => {
  // Built at runtime so this public source file never holds a full token-shaped literal
  // (secret scanners and push protection would flag it).
  const SECRETS = [
    "-----BEGIN RSA " + "PRIVATE KEY-----",
    "token: " + "ghp" + "_" + "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "pat: " + "github" + "_pat_" + "11ABCDEFG0123456789_abcdefghijklmnop",
    "key: " + "AI" + "za" + "SyA-1234567890abcdefghijklmnopqrstu",
    '{ "private_key": "x" }',
    "private_key: x",
  ];

  it("refuses secret-looking strings in any file, with file and line, without echoing them", () => {
    const files = [
      { path: "/x/events/e/event.yaml", text: `schema: 2\n${SECRETS.slice(0, 3).join("\n")}\n` },
      { path: "/x/profiles/p.yaml", text: SECRETS.slice(3).join("\n") },
    ];
    const found = only("V8", run({}, files));
    expect(found.map(([, path]) => path)).toEqual(["/x/events/e/event.yaml:2", "/x/events/e/event.yaml:3", "/x/events/e/event.yaml:4", "/x/profiles/p.yaml:1", "/x/profiles/p.yaml:2", "/x/profiles/p.yaml:3"]);
    for (const [, , message] of found) {
      expect(message).toMatch(/^비밀로 보이는 값\(.+\)이 있습니다\./);
      for (const secret of ["aBcDeFg", "11ABCDEFG", "SyA-1234"]) expect(message).not.toContain(secret);
    }
  });

  it("also finds other GitHub tokens, Google OAuth client secrets, quoted private_key keys and PGP keys", () => {
    const lines = [
      "github: { org: x, token: gho_16C7e42F292c6912E7710c838347Ae178B4a }", // fake token for the V8 test; secret-scan: allow
      "app: ghs_16C7e42F292c6912E7710c838347Ae178B4a", // fake token for the V8 test; secret-scan: allow
      "user: ghu_16C7e42F292c6912E7710c838347Ae178B4a", // fake token for the V8 test; secret-scan: allow
      "refresh: ghr_16C7e42F292c6912E7710c838347Ae178B4a", // fake token for the V8 test; secret-scan: allow
      "oauth: { client_secret: GOCSPX-abcdefghijklmnopqrstuvwx12 }",
      `repo: { 'private_key': "abc" }`,
      "-----BEGIN PGP PRIVATE KEY BLOCK-----",
    ];
    const found = only("V8", run({}, [{ path: "/x/e.yaml", text: lines.join("\n") }]));
    expect(found.map(([, path]) => path)).toEqual(lines.map((_, i) => `/x/e.yaml:${i + 1}`));
    for (const [, , message] of found) expect(message).not.toContain("16C7e42F");
  });

  it("leaves ordinary text alone", () => {
    const text = "note: ghp_ and gho_ tokens never go here\nemail: AIza@example.com\nGOCSPX- is the prefix\nmy_private_key_count: 1\n-----BEGIN PUBLIC KEY-----\n";
    expect(only("V8", run({}, [{ path: "a.yaml", text }]))).toEqual([]);
  });
});

describe("V10: GitHub identity", () => {
  it("warns when github_ops is on but GitHub ids are optional", () => {
    const over = { github: { org: "o" }, addons: { github_ops: { enabled: true } } };
    expect(only("V10", run(over))).toEqual([["warning", "intake.identity.github.required", expect.stringContaining("GitHub 아이디를 필수로 받지 않습니다")]]);
    expect(problems(merge(over, { intake: { identity: { github: { required: true } } } }))).toEqual([]);
  });
});

describe("V11: questions", () => {
  it("refuses duplicate keys, duplicate roster roles and a missing name role", () => {
    const fields = [
      { key: "성함", type: "text", roster: "name" },
      { key: "성함", type: "text" },
      { key: "팀", type: "textarea", roster: "team_hint" },
      { key: "팀원", type: "textarea", roster: "team_hint" },
    ];
    expect(only("V11", run({ intake: { fields } }))).toEqual([
      ["error", "intake.fields[1].key", '질문 key "성함"가 intake.fields[0]와 겹칩니다. key는 시트의 열 이름이라 하나여야 합니다.'],
      ["error", "intake.fields[3].roster", "명단 역할 team_hint를 intake.fields[2]가 이미 맡고 있습니다."],
    ]);
    expect(only("V11", run({ intake: { fields: [{ key: "q", type: "text" }] } }))).toEqual([["error", "intake.fields", "이름을 받는 질문이 없습니다. 질문 하나에 roster: name을 적어 주세요."]]);
  });
});

describe("V12: locked keys", () => {
  it("refuses a layer that changes a locked key, read from the raw files", () => {
    const files = [
      { path: "/x/events/e/event.yaml", text: "schema: 2\nkind: event\nintake:\n  identity: { google_login: optional }\n" },
      { path: "/x/profiles/p.yaml", text: "schema: 2\nkind: profile\nintake: { identity: { google_login: required } }\nreviewers: { permission: push }\n" },
    ];
    expect(only("V12", run({}, files)).map(([severity, path]) => [severity, path])).toEqual([
      ["error", "intake.identity.google_login"],
      ["error", "reviewers.permission"],
    ]);
  });

  it("also checks the merged values, for a config built in memory, and reports a key once", () => {
    const changed = { intake: { identity: { google_login: "optional", one_per_account: false } }, reviewers: { permission: "admin" } };
    const found = only("V12", run(changed));
    expect(found.map(([, path]) => path)).toEqual(["intake.identity.google_login", "intake.identity.one_per_account", "reviewers.permission"]);
    expect(found[0]![2]).toContain('병합된 설정에서 "optional"로 바꾸려고 했습니다.');
    const file = { path: "/x/events/e/event.yaml", text: "schema: 2\nkind: event\nintake:\n  identity: { google_login: optional }\n" };
    expect(only("V12", run({ intake: { identity: { google_login: "optional" } } }, [file])).map(([, path, message]) => [path, message.includes("event.yaml")])).toEqual([
      ["intake.identity.google_login", true],
    ]);
  });
});

describe("V14: modules and add-ons", () => {
  it("passes available add-ons with what they need and valid options", () => {
    expect(problems({ github: { org: "o" }, intake: { identity: { github: { required: true } } }, addons: { popular_vote: { enabled: true, votes_per_voter: 2 }, github_ops: { enabled: true }, check_in: {} } })).toEqual([]);
  });

  it("refuses unknown add-ons, planned ones switched on, missing modules or config and bad options", () => {
    const found = only(
      "V14",
      run({ modules: { judge: false }, addons: { fancy: { enabled: true }, check_in: { enabled: true }, popular_vote: { enabled: true, votes_per_voter: 0 }, github_ops: { enabled: true } } }),
    );
    expect(found).toEqual([
      ["error", "addons.fancy", expect.stringMatching(/^알 수 없는 add-on입니다: fancy\. 있는 add-on: popular_vote, team_board, /)],
      ["error", "addons.check_in", "현장 체크인(check_in)는 아직 준비 중이라 켤 수 없습니다."],
      ["error", "addons.popular_vote.votes_per_voter", expect.stringMatching(/^인기투표 옵션: /)],
      ["error", "addons.popular_vote", "인기투표(popular_vote)를 켜려면 module judge이 켜져 있어야 합니다."],
      ["error", "addons.github_ops", "GitHub org 운영(github_ops)를 켜려면 github 설정이 있어야 합니다."],
    ]);
    expect(only("V14", run({ addons: { notices: { enabled: false, colour: "red" } } }))).toEqual([["error", "addons.notices", expect.stringContaining('공지 옵션: 인식할 수 없는 키: "colour"')]]);
  });
});

describe("V15: references", () => {
  it("passes defined divisions, question fields, email fields and valid patterns", () => {
    const over = {
      divisions: { s: { name: "S", when: { all: [{ field: "성함", matches: "^김" }, { field: "email_domain", eq: "example.ac.kr" }, { not: { field: "email", exists: false } }] } } },
      tracks: { a: { divisions: ["s"], prizes: { s: [{ place: 1, teams: 1 }] } } },
      intake: { eligibility: [{ when: { field: "성함", exists: true }, message: "이름을 적어 주세요" }] },
      scoring: { overrides: [{ when: { track: "a", division: "s" }, precision: 1 }] },
    };
    expect(problems(over)).toEqual([]);
  });

  it("refuses undefined divisions and tracks, unknown fields and patterns that do not compile", () => {
    const over = {
      divisions: { s: { name: "S", when: { any: [{ field: "학번", matches: "(" }, { not: { field: "성함", matches: "[" } }] } } },
      tracks: { a: { divisions: ["s", "ghost"], prizes: { s: [], other: [] } } },
      intake: { eligibility: [{ when: { field: "재학", eq: "재학" }, message: "m" }] },
      scoring: { overrides: [{ when: { track: "b", division: "x" }, precision: 1 }] },
    };
    expect(only("V15", run(over)).map(([, path, message]) => [path, message.split(":")[0]])).toEqual([
      ["tracks.a.divisions[1]", '트랙 a가 여는 부문 "ghost"가 divisions에 없습니다.'],
      ["tracks.a.prizes.other", '상금표의 부문 "other"는 트랙 a에서 열리지 않습니다.'],
      ["scoring.overrides[0].when.track", '덮어쓰기가 가리키는 트랙 "b"이 tracks에 없습니다.'],
      ["scoring.overrides[0].when.division", '덮어쓰기가 가리키는 부문 "x"이 divisions에 없습니다.'],
      ["divisions.s.when.any[0].field", '조건이 읽는 질문 "학번"가 intake.fields에 없습니다. 질문 key나 email, email_domain을 적어 주세요.'],
      ["divisions.s.when.any[0].matches", "정규식을 읽을 수 없습니다"],
      ["divisions.s.when.any[1].not.matches", "정규식을 읽을 수 없습니다"],
      ["intake.eligibility[0].when.field", '조건이 읽는 질문 "재학"가 intake.fields에 없습니다. 질문 key나 email, email_domain을 적어 주세요.'],
    ]);
  });

  it("refuses patterns a crafted answer could keep busy, and syntax outside the subset", () => {
    const rule = (matches: string) => ({ when: { field: "성함", matches }, message: "m" });
    const over = { intake: { eligibility: [rule("^(\\w+\\s?)*$"), rule("^([A-Za-z]+ ?)+$"), rule(".*a.*a.*b"), rule("(?i:kim)"), rule("^[A-Za-z ]{1,50}$")] } };
    expect(only("V15", run(over))).toEqual([
      ["error", "intake.eligibility[0].when.matches", expect.stringMatching(/^반복\(\*, \+, \{n,\}\)이 붙은 그룹 안에는/)],
      ["error", "intake.eligibility[1].when.matches", expect.stringMatching(/^반복\(\*, \+, \{n,\}\)이 붙은 그룹 안에는/)],
      ["error", "intake.eligibility[2].when.matches", expect.stringMatching(/^반복이 너무 많아/)],
      ["error", "intake.eligibility[3].when.matches", "그룹은 (...), (?:...), (?=...), (?!...)만 쓸 수 있습니다."],
    ]);
  });

  it("warns about an override that matches no track × division", () => {
    const over = { divisions: { s: { name: "S" }, g: { name: "G" } }, tracks: { a: { divisions: ["g"] } }, scoring: { overrides: [{ when: { division: "s" }, precision: 1 }, { when: { track: "a", division: "g" }, precision: 0 }] } };
    expect(only("V15", run(over))).toEqual([["warning", "scoring.overrides[0].when", expect.stringContaining("어느 팀에도 쓰이지 않습니다")]]);
  });

  it("warns that email addresses in a condition become public", () => {
    const over = { intake: { eligibility: [{ when: { any: [{ field: "email", in: ["a@x.com", "b@y.com"] }, { field: "email", matches: "@example\\.com$" }] }, message: "m" }] } };
    expect(only("V15", run(over))).toEqual([["warning", "intake.eligibility[0].when.any[0]", expect.stringContaining("공개되는 event.json에 그대로 실립니다")]]);
  });
});
