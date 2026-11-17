import { describe, expect, it } from "vitest";
import { checkLockedKeys, lockedKeys } from "../src/config/locked.js";
import { MergeError, listKeyAt, merge } from "../src/config/merge.js";

const criteria = (...keys: string[]) => keys.map((key) => ({ key, name: key, max: 25 }));
const keysOf = (list: unknown) => (list as { key: string }[]).map((c) => c.key);

describe("merge: values and maps", () => {
  it("replaces scalars and merges objects key by key", () => {
    expect(merge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 }, e: "x" })).toEqual({ a: 1, b: { c: 9, d: 3 }, e: "x" });
    expect(merge({ a: { b: 1 } }, { a: 5 })).toEqual({ a: 5 });
    expect(merge({ a: 5 }, { a: { b: 1 } })).toEqual({ a: { b: 1 } });
  });

  it("deletes a key whose new value is null, also inside new objects", () => {
    expect(merge({ tracks: { a: { name: "A" }, b: { name: "B" } } }, { tracks: { b: null } })).toEqual({ tracks: { a: { name: "A" } } });
    expect(merge({}, { scoring: { formula: null, precision: 1 } })).toEqual({ scoring: { precision: 1 } });
  });

  it("leaves both inputs untouched", () => {
    const base = { a: { b: [1, 2] }, list: [{ key: "x" }] };
    const over = { a: { c: 1 }, intake: { fields: { add: [{ key: "q" }] } } };
    const before = JSON.stringify([base, over]);
    const result = merge(base, over) as { a: { b: number[] } };
    result.a.b.push(3);
    expect(JSON.stringify([base, over])).toBe(before);
  });

  it("keeps a __proto__ key as plain data", () => {
    const over = JSON.parse('{"__proto__": {"polluted": true}, "a": {"__proto__": {"x": 1}}}');
    const result = merge({}, over) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("merge: arrays without keys", () => {
  it("replaces with an array and appends with { append }", () => {
    expect(merge({ intake: { identity: { email_domains: ["a.kr"] } } }, { intake: { identity: { email_domains: ["b.kr"] } } })).toEqual({
      intake: { identity: { email_domains: ["b.kr"] } },
    });
    expect(merge({ intake: { identity: { email_domains: ["a.kr"] } } }, { intake: { identity: { email_domains: { append: ["b.kr"] } } } })).toEqual({
      intake: { identity: { email_domains: ["a.kr", "b.kr"] } },
    });
    expect(merge({}, { intake: { eligibility: { append: [{ message: "m" }] } } })).toEqual({ intake: { eligibility: [{ message: "m" }] } });
  });

  it("treats scoring.overrides as a plain list", () => {
    const base = { scoring: { overrides: [{ when: { track: "a" }, precision: 1 }] } };
    expect(merge(base, { scoring: { overrides: { append: [{ when: {}, precision: 0 }] } } })).toEqual({
      scoring: { overrides: [{ when: { track: "a" }, precision: 1 }, { when: {}, precision: 0 }] },
    });
    // Inside a replaced list, null is data: an override's `formula: null` means "weighted sum".
    expect(merge(base, { scoring: { overrides: [{ when: {}, formula: null }] } })).toEqual({ scoring: { overrides: [{ when: {}, formula: null }] } });
  });
});

describe("merge: keyed lists", () => {
  const base = { scoring: { criteria: [...criteria("idea", "done", "ux"), { key: "impl", name: "impl", children: criteria("a", "b") }] } };

  it("knows which lists are keyed", () => {
    expect(listKeyAt(["scoring", "criteria"])).toBe("key");
    expect(listKeyAt(["scoring", "criteria", "[]", "children", "[]", "children"])).toBe("key");
    expect(listKeyAt(["intake", "fields"])).toBe("key");
    expect(listKeyAt(["intake", "consents"])).toBe("key");
    expect(listKeyAt(["schedule", "sessions"])).toBe("id");
    expect(listKeyAt(["scoring", "overrides"])).toBeNull();
    expect(listKeyAt(["scoring", "tie_break"])).toBeNull();
  });

  it("replaces the whole list with an array", () => {
    expect(keysOf((merge(base, { scoring: { criteria: criteria("only") } }) as typeof base).scoring.criteria)).toEqual(["only"]);
  });

  it("removes, then updates, then adds at the end", () => {
    const result = merge(base, {
      scoring: { criteria: { remove: ["ux"], update: [{ key: "idea", max: 30 }], add: criteria("demo") } },
    }) as typeof base;
    expect(keysOf(result.scoring.criteria)).toEqual(["idea", "done", "impl", "demo"]);
    expect(result.scoring.criteria[0]).toEqual({ key: "idea", name: "idea", max: 30 });
  });

  it("merges into children of criteria at any depth", () => {
    const result = merge(base, { scoring: { criteria: { update: [{ key: "impl", children: { remove: ["a"], add: criteria("c") } }] } } }) as {
      scoring: { criteria: { key: string; children?: unknown }[] };
    };
    expect(keysOf(result.scoring.criteria[3]!.children)).toEqual(["b", "c"]);
  });

  it("keys schedule.sessions by id and starts from an empty list", () => {
    const sessions = merge({ schedule: { sessions: [{ id: "kickoff", at: "t1" }] } }, { schedule: { sessions: { update: [{ id: "kickoff", at: "t2" }], add: [{ id: "demo", at: "t3" }] } } });
    expect(sessions).toEqual({ schedule: { sessions: [{ id: "kickoff", at: "t2" }, { id: "demo", at: "t3" }] } });
    expect(merge({}, { intake: { fields: { add: [{ key: "q" }] } } })).toEqual({ intake: { fields: [{ key: "q" }] } });
  });

  it("ignores removing a key that is not there", () => {
    expect(keysOf((merge(base, { scoring: { criteria: { remove: ["nope"] } } }) as typeof base).scoring.criteria)).toEqual(["idea", "done", "ux", "impl"]);
  });

  it("refuses an update of a missing key, an add of an existing key and unknown directives", () => {
    const cases: [unknown, string][] = [
      [{ update: [{ key: "nope", max: 1 }] }, 'update한 key "nope"가 위 층에 없습니다.'],
      [{ add: criteria("done") }, 'add한 key "done"가 이미 있습니다.'],
      [{ add: [{ name: "no key" }] }, "add의 항목마다 key가 있어야 합니다."],
      [{ append: criteria("x") }, "add, remove, update만 쓸 수 있습니다(append)."],
      [{ remove: "ux" }, "remove에는 목록을 적어야 합니다."],
      ["idea", "목록이나 { add, remove, update }를 적어야 합니다."],
    ];
    for (const [directive, message] of cases) {
      expect(() => merge(base, { scoring: { criteria: directive } }), message).toThrow(message);
    }
    expect(() => merge(base, { scoring: { criteria: { update: [{ key: "impl", children: { add: criteria("a") } }] } } })).toThrow(
      'scoring.criteria[].children: add한 key "a"가 이미 있습니다.',
    );
    expect(() => merge({ intake: { fields: { a: 1 } } }, { intake: { fields: { add: [] } } })).toThrow(MergeError);
  });
});

describe("locked keys", () => {
  it("lists the three keys of design doc 6.4 with their reasons", () => {
    expect(lockedKeys().map((k) => [k.path, k.value])).toEqual([
      ["intake.identity.google_login", "required"],
      ["intake.identity.one_per_account", true],
      ["reviewers.permission", "pull"],
    ]);
    expect(lockedKeys()[0]!.reason).toBe("본인 확인은 구글 서명 토큰으로만 합니다");
  });

  it("reports every layer that writes another value, and accepts the same value", () => {
    const found = checkLockedKeys([
      { file: "preset:standard-2track", data: { intake: { identity: { google_login: "required", one_per_account: true } } } },
      { file: "profiles/org.yaml", data: { intake: { identity: { google_login: "optional" } }, reviewers: { permission: "push" } } },
      { file: "events/x/event.yaml", data: { intake: { identity: { one_per_account: null } } } },
    ]);
    expect(found.map((d) => [d.id, d.severity, d.path])).toEqual([
      ["V12", "error", "intake.identity.google_login"],
      ["V12", "error", "reviewers.permission"],
      ["V12", "error", "intake.identity.one_per_account"],
    ]);
    expect(found[0]!.message).toContain("이유: 본인 확인은 구글 서명 토큰으로만 합니다");
    expect(found[0]!.message).toContain("profiles/org.yaml");
    expect(checkLockedKeys([{ file: "a", data: { reviewers: { permission: "pull" } } }, { file: "b", data: null }])).toEqual([]);
  });
});
