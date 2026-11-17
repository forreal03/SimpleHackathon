import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESETS_DIR, loadConfig } from "../src/config/load.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "shk-load-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Writes `text` at `rel` under the temp home and returns the absolute path. */
function put(rel: string, text: string): string {
  const file = path.join(home, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const EVENT_HEAD = "schema: 2\nkind: event\nevent: { id: test-2027, name: Test }\n";
const eventFile = (body: string, rel = "events/test-2027/event.yaml") => put(rel, `${EVENT_HEAD}${body}`);
const errors = (file: string, options?: Parameters<typeof loadConfig>[1]) => loadConfig(file, options).diagnostics.map((d) => [d.id, d.message]);

describe("loadConfig: extends", () => {
  it("expands parents in place, in order, before the file itself", () => {
    put("profiles/org.yaml", "schema: 2\nkind: profile\nextends: [preset:standard-2track@1, ./extra.yaml]\nscoring: { precision: 1 }\nevent: { timezone: Asia/Seoul }\n");
    put("profiles/extra.yaml", "schema: 2\nkind: profile\nscoring: { precision: 3, criteria: { remove: [ux] } }\n");
    const file = eventFile("extends: profile:org\nscoring: { criteria: { add: [ { key: demo, name: 시연, max: 25 } ] } }\n");
    const { config, files, diagnostics } = loadConfig(file);
    expect(diagnostics).toEqual([]);
    expect(config!.scoring.criteria.map((c) => c.key)).toEqual(["idea", "done", "arch", "demo"]);
    expect(config!.scoring.precision).toBe(1);
    expect(config!.event).toMatchObject({ id: "test-2027", timezone: "Asia/Seoul", locale: "ko" });
    expect(config!.tracks.hackathon).toMatchObject({ id: "H", name: "해커톤", order: 1, teams: [] });
    expect(files.map((f) => path.relative(home, f.path))).toEqual([
      "events/test-2027/event.yaml",
      "profiles/org.yaml",
      path.relative(home, path.join(PRESETS_DIR, "standard-2track.yaml")),
      "profiles/extra.yaml",
    ]);
    expect(files[0]!.text).toContain("profile:org");
  });

  it("strips the header keys of every layer and keeps the entry file's kind", () => {
    const file = eventFile("extends: preset:university-students@1\nintake: { fields: { add: [ { key: 성함, type: text, roster: name } ] } }\n");
    const { config } = loadConfig(file);
    expect(config).toMatchObject({ schema: 2, kind: "event" });
    expect(Object.keys(config!)).not.toContain("version");
    expect(Object.keys(config!)).not.toContain("extends");
    expect(config!.intake.fields.map((f) => f.key)).toEqual(["학번", "학년", "소속", "재학 상태", "성함"]);
    expect(config!.intake.eligibility).toHaveLength(1);
  });

  it("finds profiles from --home when the file is not under <home>/events/<id>/", () => {
    put("profiles/org.yaml", "schema: 2\nkind: profile\nsite: { title: 조직 }\n");
    const file = eventFile("extends: profile:org\n", "elsewhere/event.yaml");
    expect(errors(file)).toEqual([["V13", "profile:org를 찾을 home 폴더를 모릅니다. 이벤트 파일을 <home>/events/<id>/event.yaml에 두거나 --home을 주세요."]]);
    expect(loadConfig(file, { home }).config!.site.title).toBe("조직");
  });

  it("reports a cycle", () => {
    put("a.yaml", "schema: 2\nkind: profile\nextends: ./b.yaml\n");
    put("b.yaml", "schema: 2\nkind: profile\nextends: ./a.yaml\n");
    const file = eventFile("extends: ../../a.yaml\n");
    const result = loadConfig(file);
    expect(result.config).toBeNull();
    expect(result.diagnostics.map((d) => d.id)).toEqual(["V13"]);
    expect(result.diagnostics[0]!.message).toMatch(/^extends가 순환합니다: .*event\.yaml → .*a\.yaml → .*b\.yaml → .*a\.yaml$/);
  });

  it("allows five levels of parents and refuses a sixth", () => {
    for (let i = 1; i <= 6; i++) put(`p${i}.yaml`, `schema: 2\nkind: profile\n${i < 6 ? `extends: ./p${i + 1}.yaml\n` : ""}`);
    expect(loadConfig(eventFile("extends: ../../p2.yaml\n")).diagnostics).toEqual([]);
    const deep = loadConfig(eventFile("extends: ../../p1.yaml\n"));
    expect(deep.config).toBeNull();
    expect(deep.diagnostics[0]!.message).toMatch(/^extends가 5단계보다 깊습니다/);
  });

  it("refuses the same parent twice in one extends list, however it is written", () => {
    put("a.yaml", "schema: 2\nkind: profile\n");
    expect(errors(eventFile("extends: [../../a.yaml, ../test-2027/../../a.yaml]\n"))).toEqual([["V13", "extends에 같은 파일을 두 번 적었습니다: ../test-2027/../../a.yaml"]]);
  });

  it("stops after 50 file reads, so repeated parents cannot multiply the work", () => {
    const level = (name: string, next: string | null) => {
      for (let i = 1; i <= 4; i++) put(`${name}${i}.yaml`, `schema: 2\nkind: profile\n${next ? `extends: [${[1, 2, 3, 4].map((j) => `./${next}${j}.yaml`).join(", ")}]\n` : ""}`);
    };
    level("c", null);
    level("b", "c");
    level("a", "b");
    const result = loadConfig(eventFile(`extends: [${[1, 2, 3, 4].map((j) => `../../a${j}.yaml`).join(", ")}]\n`));
    expect(result.config).toBeNull();
    expect(result.diagnostics.map((d) => [d.id, d.message])).toEqual([["V13", "extends로 읽는 파일이 50개를 넘습니다. 같은 부모를 여러 경로로 거치지 않게 extends를 줄여 주세요."]]);
    expect(loadConfig(eventFile("extends: [../../b1.yaml, ../../b2.yaml]\n")).diagnostics).toEqual([]);
  });

  it("reports missing files, preset major mismatches and malformed references", () => {
    expect(errors(eventFile("extends: ./nope.yaml\n"))).toEqual([["V13", expect.stringMatching(/^파일을 찾을 수 없습니다: .*nope\.yaml \(.*event\.yaml의 extends: \.\/nope\.yaml\)$/)]]);
    expect(errors(eventFile("extends: profile:ghost\n"))).toEqual([["V13", expect.stringContaining("profiles/ghost.yaml")]]);
    expect(errors(eventFile("extends: preset:standard-2track@2\n"))).toEqual([["V13", "preset:standard-2track@2를 찾았지만 이 preset의 major 버전은 1입니다."]]);
    expect(errors(eventFile("extends: preset:no-such@1\n"))).toEqual([["V13", expect.stringContaining("파일을 찾을 수 없습니다: preset:no-such")]]);
    expect(errors(eventFile("extends: preset:standard-2track\n"))).toEqual([["V13", "preset 참조는 preset:<이름>@<major>로 적습니다: preset:standard-2track"]]);
    expect(errors(eventFile("extends: profile:../../etc\n"))).toEqual([["V13", "profile 이름은 영문 소문자, 숫자, -, _로 적습니다: profile:../../etc"]]);
    expect(errors(path.join(home, "missing.yaml"))).toEqual([["V13", expect.stringMatching(/^파일을 찾을 수 없습니다: .*missing\.yaml$/)]]);
  });
});

describe("loadConfig: problems in files", () => {
  it("reports YAML syntax errors", () => {
    const result = loadConfig(put("bad.yaml", "schema: 2\nkind: event\nevent: { id: x\n"));
    expect(result.config).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({ id: "YAML", severity: "error" });
    expect(result.diagnostics[0]!.message).toMatch(/^YAML 문법 오류입니다\./);
  });

  it("checks every file's header: schema 2, a kind, and a version for presets", () => {
    expect(errors(put("a.yaml", "schema: 1\nkind: event\n"))).toEqual([["SCHEMA", expect.stringMatching(/a\.yaml: 잘못된 입력: 값은 2 이어야 합니다$/)]]);
    expect(errors(put("b.yaml", "schema: 2\n"))).toEqual([["SCHEMA", expect.stringMatching(/b\.yaml: 값이 필요합니다\. event, profile, preset 중 하나를 적어 주세요\.$/)]]);
    expect(errors(put("c.yaml", "schema: 2\nkind: preset\n"))).toEqual([["SCHEMA", expect.stringMatching(/c\.yaml: preset 파일에는 major 버전\(version\)이 있어야 합니다\.$/)]]);
    expect(errors(put("d.yaml", ""))).toHaveLength(2);
  });

  it("checks the merged config in full, with config paths", () => {
    const result = loadConfig(eventFile("scorring: {}\ntracks: { a: { name: A, teams: [x] }, b/c: { name: B } }\nscoring: { precision: 9 }\n"));
    expect(result.config).toBeNull();
    expect(result.diagnostics.map((d) => [d.id, d.path])).toEqual([
      ["SCHEMA", "tracks.a.teams[0]"],
      ["SCHEMA", "tracks.b/c"],
      ["SCHEMA", "scoring.precision"],
      ["SCHEMA", ""],
    ]);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '팀 번호 범위는 "07"이나 "01-10"처럼 적습니다.',
      "id는 영문자로 시작하고 영문자, 숫자, _, -로 32자까지 적습니다.",
      expect.stringContaining("6"),
      '인식할 수 없는 키: "scorring"',
    ]);
  });

  it("requires event.id and event.name in an event file but not in a profile", () => {
    expect(errors(put("events/x/event.yaml", "schema: 2\nkind: event\n")).map(([id]) => id)).toEqual(["SCHEMA", "SCHEMA"]);
    expect(loadConfig(put("profile.yaml", "schema: 2\nkind: profile\nevent: { timezone: Asia/Seoul }\n")).config).toMatchObject({ kind: "profile" });
  });

  it("explains conditions that are not in the condition language", () => {
    const result = loadConfig(
      eventFile(
        "divisions:\n  s: { name: S, when: { all: [ { field: a, eq: 1, ne: 2 }, { field: b, gte: soon }, { size: 3 }, { field: c, like: x } ] } }\n",
      ),
    );
    expect(result.diagnostics.map((d) => [d.path, d.message])).toEqual([
      ["divisions.s.when.all[0]", "field 조건에는 연산자를 정확히 하나 적어야 합니다."],
      ["divisions.s.when.all[1].gte", "gte: 숫자나 YYYY-MM-DD 날짜를 적어야 합니다."],
      ["divisions.s.when.all[2]", expect.stringContaining("알 수 없는 조건입니다(size)")],
      ["divisions.s.when.all[3]", expect.stringContaining("알 수 없는 연산자입니다: like")],
    ]);
  });

  it("reports a misused merge directive with the file that used it", () => {
    const result = loadConfig(eventFile("extends: preset:standard-2track@1\nscoring: { criteria: { update: [ { key: nope, max: 1 } ] } }\n"));
    expect(result.config).toBeNull();
    expect(result.diagnostics).toEqual([
      { id: "MERGE", severity: "error", path: "scoring.criteria", message: expect.stringMatching(/event\.yaml: scoring\.criteria: update한 key "nope"가 위 층에 없습니다\.$/) },
    ]);
  });
});
