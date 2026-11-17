// Condition language, applicant eligibility and team divisions (design doc 4).
import type {
  Cond,
  CondResult,
  DivisionDef,
  DivisionResult,
  EligibilityResult,
  EligibilityRule,
  Person,
  TeamForDivision,
  TrackDivisionSpec,
} from "./types.js";

/**
 * Evaluates a condition against one person (design doc 4.1). `email` and `email_domain` read the
 * verified email; any other field reads `person.answers`. Failures carry condition-side facts only
 * (path, field, op), never anyone's answer.
 */
export function evaluateCondition(cond: Cond, person: Person): CondResult {
  throw new Error("not implemented: evaluateCondition");
}

/**
 * Applies `intake.eligibility` (design doc 4.2): the applicant must pass every rule. `messages` holds
 * the messages of the rules that failed, in rule order.
 */
export function checkApplicantEligibility(rules: readonly EligibilityRule[], person: Person): EligibilityResult {
  throw new Error("not implemented: checkApplicantEligibility");
}

/**
 * Decides a team's division in one track (design doc 4.3). `divisions` maps division id to its
 * definition; `track.divisions` lists the ids open in the track. declared: checks the team's choice
 * with the division's teamRule and rejects with reasons. auto: the first division in track order the
 * team fits, or null with reasons. A track without divisions gives `{ division: null, ok: true }`.
 */
export function resolveTeamDivision(
  track: TrackDivisionSpec,
  divisions: Readonly<Record<string, DivisionDef>>,
  team: TeamForDivision,
): DivisionResult {
  throw new Error("not implemented: resolveTeamDivision");
}
