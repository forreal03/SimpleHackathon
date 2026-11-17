import { describe, expect, it } from "vitest";
import { BASE_VARS, POPULAR_VARS, criterionMax, maxTotal, scoringVariables } from "../src/runtime/scoring.js";
import type { Criterion } from "../src/runtime/types.js";

const leaf = (key: string, max: number, weight = 1): Criterion => ({ key, name: key, weight, max });
const group = (key: string, children: Criterion[], weight = 1): Criterion => ({ key, name: key, weight, children });

/** The tree of design doc 3.1. */
const DOC_TREE = [leaf("idea", 25), group("impl", [leaf("done", 10), leaf("ux", 15)])];

describe("maxTotal and criterionMax", () => {
  it("gives 100 for four 25-point criteria without weights", () => {
    expect(maxTotal(["idea", "done", "ux", "arch"].map((k) => leaf(k, 25)))).toBe(100);
  });

  it("sums leaves through parents", () => {
    expect(maxTotal(DOC_TREE)).toBe(50);
    expect(criterionMax(DOC_TREE[1]!)).toBe(25);
    expect(criterionMax(DOC_TREE[0]!)).toBe(25);
  });

  it("applies weights at every level, a node's own weight only in its parent", () => {
    const g = group("g", [leaf("b", 20), leaf("c", 10, 3)], 0.5);
    expect(criterionMax(g)).toBe(50);
    expect(maxTotal([leaf("a", 10, 2), g])).toBe(45);
    const deep = group("a", [group("b", [leaf("c", 10, 2)], 3)]);
    expect(criterionMax(deep.children![0]!)).toBe(20);
    expect(maxTotal([deep])).toBe(60);
  });

  it("treats an empty children list as a leaf and a missing max as 0", () => {
    expect(criterionMax({ key: "x", name: "x", weight: 1, max: 7, children: [] })).toBe(7);
    expect(criterionMax({ key: "x", name: "x", weight: 1 })).toBe(0);
    expect(maxTotal([])).toBe(0);
  });
});

describe("scoringVariables", () => {
  it("lists judge values, then crit.* and critmax.* for every node, parents first", () => {
    expect(scoringVariables(DOC_TREE, false)).toEqual([
      "judge",
      "judges",
      "max_total",
      "crit.idea",
      "crit.impl",
      "crit.done",
      "crit.ux",
      "critmax.idea",
      "critmax.impl",
      "critmax.done",
      "critmax.ux",
    ]);
  });

  it("adds the popular-vote variables only when the add-on is on", () => {
    const on = scoringVariables(DOC_TREE, true);
    expect(on.slice(-POPULAR_VARS.length)).toEqual(["votes", "total_votes", "avg_votes", "max_votes", "team_count", "popular"]);
    expect(on).toHaveLength(11 + POPULAR_VARS.length);
    expect(scoringVariables([], false)).toEqual([...BASE_VARS]);
  });
});
