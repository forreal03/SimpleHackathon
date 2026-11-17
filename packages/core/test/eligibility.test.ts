import { describe, expect, it } from "vitest";
import { checkApplicantEligibility, evaluateCondition, matchesProblem, resolveTeamDivision, trackDivisionSpec } from "../src/runtime/eligibility.js";
import type { Answer, Cond, DivisionDef, Person, TeamMember } from "../src/runtime/types.js";

const person = (answers: Record<string, Answer> = {}, email = "kim@example.ac.kr"): Person => ({ email, answers });
const ok = (cond: Cond, p: Person) => evaluateCondition(cond, p).ok;

describe("evaluateCondition: operators", () => {
  const p = person({ 신분: "대학생", 학년: "3", 나이: 23, 생일: "2004-05-01", 학번: "20231234", 메모: "" });

  it("eq and ne compare the text of the values", () => {
    expect(ok({ field: "신분", eq: "대학생" }, p)).toBe(true);
    expect(ok({ field: "신분", eq: "대학원생" }, p)).toBe(false);
    expect(ok({ field: "학년", eq: 3 }, p)).toBe(true);
    expect(ok({ field: "신분", ne: "대학원생" }, p)).toBe(true);
    expect(ok({ field: "신분", ne: "대학생" }, p)).toBe(false);
  });

  it("in and nin check list membership", () => {
    expect(ok({ field: "신분", in: ["대학생", "대학원생"] }, p)).toBe(true);
    expect(ok({ field: "신분", in: ["직장인"] }, p)).toBe(false);
    expect(ok({ field: "신분", nin: ["직장인"] }, p)).toBe(true);
    expect(ok({ field: "신분", nin: ["대학생"] }, p)).toBe(false);
  });

  it("gt, gte, lt and lte compare numbers, numeric text and YYYY-MM-DD dates", () => {
    expect(ok({ field: "나이", gt: 22 }, p)).toBe(true);
    expect(ok({ field: "나이", gt: 23 }, p)).toBe(false);
    expect(ok({ field: "나이", gte: 23 }, p)).toBe(true);
    expect(ok({ field: "나이", lt: 23 }, p)).toBe(false);
    expect(ok({ field: "나이", lte: 23 }, p)).toBe(true);
    expect(ok({ field: "학년", gte: 2 }, p)).toBe(true);
    expect(ok({ field: "생일", lt: "2005-01-01" }, p)).toBe(true);
    expect(ok({ field: "생일", gte: "2004-05-02" }, p)).toBe(false);
    // Dates only compare with dates, numbers only with numbers.
    expect(ok({ field: "생일", gt: 2000 }, p)).toBe(false);
    expect(ok({ field: "나이", gt: "2000-01-01" }, p)).toBe(false);
    expect(ok({ field: "신분", gt: 0 }, p)).toBe(false);
  });

  it("matches tests a regular expression on the first 200 characters", () => {
    expect(ok({ field: "학번", matches: "^\\d{8}$" }, p)).toBe(true);
    expect(ok({ field: "학번", matches: "^\\d{6}$" }, p)).toBe(false);
    const long = person({ 소개: `${"a".repeat(200)}TAIL` });
    expect(ok({ field: "소개", matches: "TAIL" }, long)).toBe(false);
    expect(ok({ field: "소개", matches: "^a{200}$" }, long)).toBe(true);
  });

  it("exists is true for a non-empty answer", () => {
    expect(ok({ field: "신분", exists: true }, p)).toBe(true);
    expect(ok({ field: "메모", exists: true }, p)).toBe(false);
    expect(ok({ field: "없는 질문", exists: false }, p)).toBe(true);
    expect(ok({ field: "없는 질문", exists: true }, p)).toBe(false);
    expect(ok({ field: "목록", exists: true }, person({ 목록: [] }))).toBe(false);
  });

  it("domain_in reads the domain of an email, ignoring case", () => {
    expect(ok({ field: "email", domain_in: ["example.ac.kr", "gmail.com"] }, p)).toBe(true);
    expect(ok({ field: "email", domain_in: ["gmail.com"] }, p)).toBe(false);
    expect(ok({ field: "email", domain_in: ["example.com"] }, person({}, "Lee@Example.COM"))).toBe(true);
  });

  it("gives email and email_domain from the verified email, not from answers", () => {
    const spoofed = person({ email: "admin@example.com", email_domain: "example.com" }, "kim@gmail.com");
    expect(ok({ field: "email", eq: "kim@gmail.com" }, spoofed)).toBe(true);
    expect(ok({ field: "email_domain", eq: "gmail.com" }, spoofed)).toBe(true);
    expect(ok({ field: "email_domain", in: ["example.com"] }, spoofed)).toBe(false);
    expect(ok({ field: "email_domain", domain_in: ["GMAIL.com"] }, spoofed)).toBe(true);
  });

  it("fails every check on a missing answer except ne, nin and exists: false", () => {
    const empty = person();
    for (const cond of [{ eq: "x" }, { in: ["x"] }, { gt: 1 }, { lte: "2000-01-01" }, { matches: "" }, { domain_in: ["x"] }, { exists: true }]) {
      expect(ok({ field: "q", ...cond } as Cond, empty)).toBe(false);
    }
    expect(ok({ field: "q", ne: "x" }, empty)).toBe(true);
    expect(ok({ field: "q", nin: ["x"] }, empty)).toBe(true);
  });

  it("treats blank text, null and arrays of blank text as no answer for every operator", () => {
    const blanks: Answer[] = ["", "  ", null, [], ["", " "]];
    for (const blank of blanks) {
      const p = person({ q: blank });
      const label = JSON.stringify(blank);
      for (const cond of [{ eq: "" }, { eq: "  " }, { in: ["", "x"] }, { matches: "^[0-9]*$" }, { matches: "^\\s*$" }, { domain_in: [""] }, { gte: 0 }, { exists: true }]) {
        expect(ok({ field: "q", ...cond } as Cond, p), `${label} ${JSON.stringify(cond)}`).toBe(false);
      }
      for (const cond of [{ ne: "" }, { nin: [""] }, { exists: false }]) {
        expect(ok({ field: "q", ...cond } as Cond, p), `${label} ${JSON.stringify(cond)}`).toBe(true);
      }
    }
    const rules = [{ when: { field: "학번", matches: "^[0-9]{0,10}$" }, message: "학번을 적어 주세요" }];
    expect(checkApplicantEligibility(rules, person({ 학번: "" }))).toEqual({ ok: false, messages: ["학번을 적어 주세요"] });
  });

  it("compares text with email_domain in lower case, as it reads the domain", () => {
    const p = person({}, "kim@Example.ac.kr");
    expect(ok({ field: "email_domain", eq: "Example.AC.kr" }, p)).toBe(true);
    expect(ok({ field: "email_domain", in: ["gmail.com", "EXAMPLE.AC.KR"] }, p)).toBe(true);
    expect(ok({ field: "email_domain", ne: "EXAMPLE.ac.kr" }, p)).toBe(false);
    expect(ok({ field: "email_domain", nin: ["Example.ac.kr"] }, p)).toBe(false);
  });

  it("never reads answers through the prototype chain", () => {
    expect(ok({ field: "constructor", exists: true }, person())).toBe(false);
    expect(ok({ field: "toString", exists: true }, person())).toBe(false);
  });
});

describe("evaluateCondition: multi answers", () => {
  const p = person({ 소속: ["동아리 A", "동아리 C"] });

  it("eq and in pass when any element matches, nin and ne when none does", () => {
    expect(ok({ field: "소속", eq: "동아리 C" }, p)).toBe(true);
    expect(ok({ field: "소속", in: ["동아리 B", "동아리 A"] }, p)).toBe(true);
    expect(ok({ field: "소속", in: ["동아리 B"] }, p)).toBe(false);
    expect(ok({ field: "소속", nin: ["동아리 B"] }, p)).toBe(true);
    expect(ok({ field: "소속", nin: ["동아리 B", "동아리 C"] }, p)).toBe(false);
    expect(ok({ field: "소속", ne: "동아리 A" }, p)).toBe(false);
    expect(ok({ field: "소속", matches: "C$" }, p)).toBe(true);
  });

  it("compares sizes and domains element by element, any one passing", () => {
    const scores = person({ 점수: ["3", "8"], 메일: ["a@gmail.com", "b@Example.ac.kr"] });
    expect(ok({ field: "점수", gt: 5 }, scores)).toBe(true);
    expect(ok({ field: "점수", gt: 8 }, scores)).toBe(false);
    expect(ok({ field: "점수", lte: 3 }, scores)).toBe(true);
    expect(ok({ field: "점수", lt: 3 }, scores)).toBe(false);
    expect(ok({ field: "메일", domain_in: ["example.ac.kr"] }, scores)).toBe(true);
    expect(ok({ field: "메일", domain_in: ["naver.com"] }, scores)).toBe(false);
  });

  it("leaves blank elements out, so an array of blanks is no answer", () => {
    const p = person({ 소속: ["", "동아리 A"], 빈: [] });
    expect(ok({ field: "소속", eq: "" }, p)).toBe(false);
    expect(ok({ field: "소속", eq: "동아리 A" }, p)).toBe(true);
    expect(ok({ field: "빈", exists: false }, p)).toBe(true);
  });
});

describe("evaluateCondition: matches patterns", () => {
  const p = person({ "영문 이름": `${"A".repeat(28)}1` });

  it("throws on a pattern that does not compile, also under not, instead of passing everyone", () => {
    expect(() => evaluateCondition({ not: { field: "영문 이름", matches: "[" } }, p)).toThrow("조건의 정규식을 쓸 수 없습니다(not). 정규식을 읽을 수 없습니다");
    expect(() => evaluateCondition({ field: "x", matches: 3 } as unknown as Cond, person())).toThrow("정규식을 문자열로 적어야 합니다.");
  });

  it("throws on a pattern a crafted answer could keep busy, before running it", () => {
    const started = Date.now();
    expect(() => evaluateCondition({ field: "영문 이름", matches: "^([A-Za-z]+ ?)+$" }, p)).toThrow("조건의 정규식을 쓸 수 없습니다(맨 위). 반복(*, +, {n,})이 붙은 그룹");
    expect(() => checkApplicantEligibility([{ when: { all: [{ field: "x", matches: "^(\\w+\\s?)*$" }] }, message: "m" }], p)).toThrow("(all[0])");
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe("matchesProblem", () => {
  it("accepts the patterns conditions usually need", () => {
    const fine = [
      "",
      "^\\d{8}$",
      "^[0-9]{0,10}$",
      "@example\\.ac\\.kr$",
      "^(19|20)\\d{2}$",
      "^(?:\\d{3}-){2}\\d{4}$",
      "^\\d+(\\.\\d+)?$",
      "^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$",
      "^(?!test)",
      "^김",
      "C$",
      "a{,5}[]\\]",
    ];
    for (const pattern of fine) expect(matchesProblem(pattern), pattern).toBeNull();
  });

  it("refuses patterns that do not compile, backreferences and groups outside the subset", () => {
    expect(matchesProblem("(")).toMatch(/^정규식을 읽을 수 없습니다: /);
    expect(matchesProblem(["a"])).toBe("정규식을 문자열로 적어야 합니다.");
    expect(matchesProblem("(a)\\1")).toBe("역참조(\\1 같은 것)는 쓸 수 없습니다.");
    for (const group of ["(?<name>a)", "(?<=a)b", "(?<!a)b", "(?i:a)"]) {
      expect(matchesProblem(group), group).toBe("그룹은 (...), (?:...), (?=...), (?!...)만 쓸 수 있습니다.");
    }
    expect(matchesProblem("[\\1(?<x>]")).toBeNull();
  });

  it("refuses repetition inside a repeated group, and alternatives repeated", () => {
    for (const nested of ["^(\\w+\\s?)*$", "^([A-Za-z]+ ?)+$", "(a*)*", "(a?){2,}", "^(a|b)+$", "(?:x(?:y|z))*"]) {
      expect(matchesProblem(nested), nested).toMatch(/^반복\(\*, \+, \{n,\}\)이 붙은 그룹 안에는/);
    }
  });

  it("refuses patterns with too many ways to split a 200-character answer", () => {
    for (const heavy of ["^\\s*\\s*\\s*\\s*x", ".*a.*a.*b", ".*.*.*.*!", `^${"a?".repeat(30)}${"a".repeat(30)}$`, "^(a|b){40}$", "^\\d{0,100}\\d{0,100}\\d{0,100}\\d{0,100}x"]) {
      expect(matchesProblem(heavy), heavy).toMatch(/^반복이 너무 많아/);
    }
    expect(matchesProblem("^\\s*\\s*\\s*x")).toBeNull();
  });
});

describe("evaluateCondition: all, any, not", () => {
  const p = person({ 신분: "대학생", 재학: "휴학" });

  it("treats {} as true, all of [] as true and any of [] as false", () => {
    expect(evaluateCondition({}, p)).toEqual({ ok: true, failed: [] });
    expect(ok({ all: [] }, p)).toBe(true);
    expect(evaluateCondition({ any: [] }, p)).toEqual({ ok: false, failed: [{ path: "", field: null, op: "any" }] });
  });

  it("reports every failing check of an all with its path", () => {
    const r = evaluateCondition({ all: [{ field: "신분", eq: "대학원생" }, { field: "신분", exists: true }, { field: "재학", eq: "재학" }] }, p);
    expect(r).toEqual({
      ok: false,
      failed: [
        { path: "all[0]", field: "신분", op: "eq" },
        { path: "all[2]", field: "재학", op: "eq" },
      ],
    });
  });

  it("reports a failing any as a whole, then why each option failed", () => {
    const r = evaluateCondition({ all: [{ any: [{ field: "신분", eq: "직장인" }, { not: { field: "재학", eq: "휴학" } }] }] }, p);
    expect(r).toEqual({
      ok: false,
      failed: [
        { path: "all[0]", field: null, op: "any" },
        { path: "all[0].any[0]", field: "신분", op: "eq" },
        { path: "all[0].any[1]", field: null, op: "not" },
      ],
    });
  });

  it("passes not when the inner condition fails, and nests freely", () => {
    expect(ok({ not: { field: "재학", eq: "재학" } }, p)).toBe(true);
    expect(ok({ not: { not: { field: "신분", eq: "대학생" } } }, p)).toBe(true);
    expect(ok({ any: [{ all: [{ field: "신분", eq: "대학생" }, { not: { field: "재학", eq: "휴학" } }] }, { field: "신분", eq: "대학원생" }] }, p)).toBe(false);
  });

  it("throws on a malformed condition instead of guessing", () => {
    expect(() => evaluateCondition({ field: "a", eq: 1, ne: 2 } as Cond, p)).toThrow("조건 형식이 올바르지 않습니다");
    expect(() => evaluateCondition({ field: "a" } as Cond, p)).toThrow("조건 형식이 올바르지 않습니다(맨 위)");
    expect(() => evaluateCondition({ all: [{ size: 3 }] } as unknown as Cond, p)).toThrow("(all[0])");
    expect(() => evaluateCondition({ all: [], any: [] } as unknown as Cond, p)).toThrow();
    expect(() => evaluateCondition({ any: {} } as unknown as Cond, p)).toThrow();
  });
});

describe("checkApplicantEligibility", () => {
  it("returns the messages of every failed rule in order", () => {
    const rules = [
      { when: { field: "재학 상태", eq: "재학" }, message: "휴학생은 신청할 수 없습니다" },
      { when: { field: "email", domain_in: ["example.ac.kr"] }, message: "학교 메일로 신청해 주세요" },
      { when: { field: "나이", gte: 19 }, message: "만 19세 이상만 신청할 수 있습니다" },
    ];
    expect(checkApplicantEligibility(rules, person({ "재학 상태": "휴학", 나이: 18 }, "kim@gmail.com"))).toEqual({
      ok: false,
      messages: ["휴학생은 신청할 수 없습니다", "학교 메일로 신청해 주세요", "만 19세 이상만 신청할 수 있습니다"],
    });
    expect(checkApplicantEligibility(rules, person({ "재학 상태": "재학", 나이: 20 }))).toEqual({ ok: true, messages: [] });
    expect(checkApplicantEligibility([], person())).toEqual({ ok: true, messages: [] });
  });
});

describe("resolveTeamDivision", () => {
  const STUDENT: Cond = { field: "신분", in: ["대학생", "대학원생"] };
  const def = (teamRule: DivisionDef["teamRule"], name = "학생부"): DivisionDef => ({ name, when: STUDENT, teamRule });
  const member = (신분: string, role: TeamMember["role"] = "member", email = `${신분}@example.com`): TeamMember => ({ role, person: person({ 신분 }, email) });
  const students = [member("대학생", "leader"), member("대학원생")];
  const mixed = [member("대학생", "leader"), member("직장인"), member("직장인")];
  const fits = (teamRule: DivisionDef["teamRule"], members: TeamMember[]) =>
    resolveTeamDivision({ divisions: ["student"], divisionMode: "declared" }, { student: def(teamRule) }, { declared: "student", members }).ok;

  it("gives a track without divisions no division", () => {
    expect(resolveTeamDivision({ divisions: [], divisionMode: "auto" }, {}, { members: mixed })).toEqual({ division: null, ok: true, reasons: [] });
  });

  it("all_members needs every member to qualify", () => {
    expect(fits("all_members", students)).toBe(true);
    expect(fits("all_members", [...students, member("직장인")])).toBe(false);
    expect(fits("all_members", [])).toBe(false);
  });

  it("any_member needs one member", () => {
    expect(fits("any_member", mixed)).toBe(true);
    expect(fits("any_member", [member("직장인")])).toBe(false);
  });

  it("leader needs the leader", () => {
    expect(fits("leader", mixed)).toBe(true);
    expect(fits("leader", [member("직장인", "leader"), member("대학생")])).toBe(false);
    const noLeader = resolveTeamDivision({ divisions: ["student"], divisionMode: "auto" }, { student: def("leader") }, { members: [member("대학생")] });
    expect(noLeader).toEqual({ division: null, ok: false, reasons: ["학생부: 조장이 없습니다."] });
  });

  it("majority needs more than half", () => {
    expect(fits("majority", [member("대학생"), member("대학생"), member("직장인")])).toBe(true);
    expect(fits("majority", [member("대학생"), member("직장인")])).toBe(false);
  });

  it("declared: accepts a fitting choice and rejects with reasons otherwise", () => {
    const track = { divisions: ["student", "general"], divisionMode: "declared" as const };
    const divisions = { student: def("all_members"), general: { name: "일반부", when: {}, teamRule: "all_members" as const } };
    expect(resolveTeamDivision(track, divisions, { declared: "student", members: students })).toEqual({ division: "student", ok: true, reasons: [] });
    expect(resolveTeamDivision(track, divisions, { declared: "general", members: mixed })).toEqual({ division: "general", ok: true, reasons: [] });
    expect(resolveTeamDivision(track, divisions, { declared: "student", members: mixed })).toEqual({
      division: null,
      ok: false,
      reasons: ['학생부: 팀원 모두가 조건을 만족해야 합니다(만족 1/3명). 맞지 않은 조건: "신분"(in)'],
    });
    expect(resolveTeamDivision(track, divisions, { members: mixed }).reasons).toEqual(["부문을 골라 주세요. 고를 수 있는 부문: 학생부, 일반부"]);
    expect(resolveTeamDivision(track, divisions, { declared: "senior", members: mixed }).reasons).toEqual([
      "고른 부문은 이 트랙에서 열리지 않습니다. 고를 수 있는 부문: 학생부, 일반부",
    ]);
  });

  it("auto: gives the first division in track order that fits, or null with every reason", () => {
    const track = { divisions: ["student", "general"], divisionMode: "auto" as const };
    const general: DivisionDef = { name: "일반부", when: { field: "신분", eq: "직장인" }, teamRule: "majority" };
    const divisions = { student: def("all_members"), general };
    expect(resolveTeamDivision(track, divisions, { members: students })).toEqual({ division: "student", ok: true, reasons: [] });
    expect(resolveTeamDivision(track, divisions, { members: mixed })).toEqual({ division: "general", ok: true, reasons: [] });
    const none = resolveTeamDivision(track, divisions, { members: [member("대학생", "leader"), member("직장인")] });
    expect(none).toEqual({
      division: null,
      ok: false,
      reasons: [
        '학생부: 팀원 모두가 조건을 만족해야 합니다(만족 1/2명). 맞지 않은 조건: "신분"(in)',
        '일반부: 팀원 과반이 조건을 만족해야 합니다(만족 1/2명). 맞지 않은 조건: "신분"(eq)',
      ],
    });
  });

  it("never puts a member's answers or email in the reasons", () => {
    const secretive = [member("비밀 신분 값", "leader", "secret.person@corp.example"), member("다른 비밀", "member", "other@corp.example")];
    const track = { divisions: ["student", "general"], divisionMode: "auto" as const };
    const divisions = { student: def("any_member"), general: { name: "일반부", when: { not: { field: "신분", matches: "비밀" } }, teamRule: "leader" as const } };
    const result = resolveTeamDivision(track, divisions, { members: secretive });
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    for (const value of ["비밀 신분 값", "다른 비밀", "secret.person", "other@", "corp.example"]) expect(text).not.toContain(value);
    expect(JSON.stringify(evaluateCondition(STUDENT, secretive[0]!.person))).not.toContain("비밀");
  });

  it("throws when a track opens a division that is not defined", () => {
    expect(() => resolveTeamDivision({ divisions: ["ghost"], divisionMode: "auto" }, {}, { members: students })).toThrow('"ghost"');
  });

  it("takes a track as event.json carries it through trackDivisionSpec", () => {
    const track = { name: "본선", teams: ["01-12"], divisions: ["student"], division_mode: "auto" as const };
    expect(trackDivisionSpec(track)).toEqual({ divisions: ["student"], divisionMode: "auto" });
    expect(resolveTeamDivision(trackDivisionSpec(track), { student: def("all_members") }, { members: students })).toEqual({ division: "student", ok: true, reasons: [] });
  });
});
