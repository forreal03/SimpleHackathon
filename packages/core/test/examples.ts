// The two examples of design doc 8.3, loaded, checked and built the way the CLI does it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEventJson, type EventJson } from "../src/build/event-json.js";
import { checkFile, type Diagnostic } from "../src/config/check.js";
import type { ResolvedConfig } from "../src/config/schema.js";
import type { JudgeSheet, TeamRef, TeamVotes } from "../src/runtime/types.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const EXAMPLES = {
  reference: path.join(REPO, "examples", "reference-2track", "events", "example-2027", "event.yaml"),
  company: path.join(REPO, "examples", "company-internal", "events", "corp-hack-2027", "event.yaml"),
} as const;

export type ExampleName = keyof typeof EXAMPLES;

export interface BuiltExample {
  config: ResolvedConfig;
  diagnostics: Diagnostic[];
  eventJson: EventJson;
}

/** Votes of the reference case (design doc 3.4): 10 teams, 60 voters × 3 votes = 180, 18 per team. */
export const REFERENCE_VOTES = [80, 36, 27, 18, 9, 3, 0, 4, 2, 1];

/**
 * The reference case on the reference example: hackathon teams 01–10 with REFERENCE_VOTES, team 03
 * judged 76 and 84 (J = 80), team 06 judged 70 by one complete sheet and one with a blank leaf
 * (J = 70), the rest unjudged. Assignment teams 11–20 get 5 votes each, which must not change the
 * hackathon's totals.
 */
export function referenceCase(eventJson: EventJson): { teams: TeamRef[]; sheets: JudgeSheet[]; votes: TeamVotes } {
  const id = (n: number) => String(n).padStart(2, "0");
  const teams: TeamRef[] = [];
  for (let n = 1; n <= 20; n++) teams.push({ id: id(n), track: n <= 10 ? "hackathon" : "assignment", division: null });
  const votes = Object.fromEntries(teams.map((t, i) => [t.id, i < 10 ? REFERENCE_VOTES[i]! : 5]));
  const leaves = eventJson.scoring.criteria.map((c) => c.key);
  const sheet = (judge: string, team: string, total: number, blank?: string): JudgeSheet => ({
    judge,
    team,
    scores: Object.fromEntries(leaves.map((k) => [k, k === blank ? null : total / leaves.length])),
  });
  const sheets = [sheet("j1", "03", 76), sheet("j2", "03", 84), sheet("j1", "06", 70), sheet("j2", "06", 90, "ux")];
  return { teams, sheets, votes };
}

/** load + merge + check + build; throws when anything reports an error. */
export function buildExample(name: ExampleName): BuiltExample {
  const { config, diagnostics } = checkFile(EXAMPLES[name]);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (!config || errors.length > 0) throw new Error(`${name}: ${JSON.stringify(errors, null, 2)}`);
  return { config, diagnostics, eventJson: buildEventJson(config) };
}
