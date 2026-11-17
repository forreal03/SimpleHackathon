// Validation rules V1–V15 (design doc 7). V13 (extends) is reported while loading, V9 by the server.
import YAML from "yaml";
import { addonEnabled, findAddon, listAddons } from "../addons/registry.js";
import { compileScoring, toCriteria } from "../build/event-json.js";
import { compileFormula } from "../formula/parse.js";
import { matchesProblem } from "../runtime/eligibility.js";
import { maxTotal, overrideApplies, scoringVariables } from "../runtime/scoring.js";
import type { Cond } from "../runtime/types.js";
import { roundTo } from "../runtime/util.js";
import { displayPath, loadConfig, type LoadOptions, type SourceFile } from "./load.js";
import { checkLockedKeys, type ConfigLayer } from "./locked.js";
import { KOREAN_ERRORS, formatPath, type CriterionConfig, type ResolvedConfig } from "./schema.js";

export type Severity = "error" | "warning" | "info";

/** One finding. `path` is a dotted config path ("scoring.formula"); `message` is Korean. */
export interface Diagnostic {
  /** Rule id, e.g. "V4". */
  id: string;
  severity: Severity;
  path: string;
  message: string;
}

export interface CheckContext {
  /** Raw text of every file in the extends chain (V8 scans it for secrets, V12 for locked keys). */
  files: SourceFile[];
}

/** Runs every rule; any `error` means the config must not be built. */
export function checkConfig(resolved: ResolvedConfig, ctx: CheckContext): Diagnostic[] {
  return [
    ...checkSchedule(resolved),
    ...checkTeamRanges(resolved),
    ...checkCriteria(resolved),
    ...checkFormulas(resolved),
    ...checkPrizes(resolved),
    ...checkVoteWindows(resolved),
    ...checkPrivacy(resolved),
    ...checkSecrets(ctx.files),
    ...checkGithubIdentity(resolved),
    ...checkFields(resolved),
    ...checkLocked(resolved, ctx.files),
    ...checkAddons(resolved),
    ...checkReferences(resolved),
  ];
}

/** What checkFile found: the merged config (null when loading failed), the files read, and every diagnostic. */
export interface CheckedFile {
  config: ResolvedConfig | null;
  files: SourceFile[];
  diagnostics: Diagnostic[];
}

/** loadConfig, then checkConfig on what it merged: the load diagnostics come first. */
export function checkFile(file: string, options: LoadOptions = {}): CheckedFile {
  const loaded = loadConfig(file, options);
  if (!loaded.config) return loaded;
  return { ...loaded, diagnostics: [...loaded.diagnostics, ...checkConfig(loaded.config, { files: loaded.files })] };
}

const error = (id: string, path: string, message: string): Diagnostic => ({ id, severity: "error", path, message });
const warning = (id: string, path: string, message: string): Diagnostic => ({ id, severity: "warning", path, message });

// ── V1: times ────────────────────────────────────────────────────────────────────────────────

/** ISO date-time with seconds optional and a UTC offset (or Z). */
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface Stamp {
  path: string;
  value: string;
  time: number;
}

/** A time with an offset as milliseconds, or null. A day the month does not have (04-31) is refused, not rolled over. */
function timeOf(value: string): number | null {
  const m = STAMP_RE.exec(value);
  if (!m) return null;
  const [year, month, day] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (day > (month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1] ?? 31)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** One step of a schedule chain: its times, and whether it must come strictly after the step before. */
interface Step {
  at: (Stamp | undefined)[];
  strict: boolean;
}

const step = (strict: boolean, ...at: (Stamp | undefined)[]): Step => ({ at, strict });

/**
 * V1: every time exists and has an offset, and recruit open < recruit close ≤ sessions ≤ main start
 * < submit deadline ≤ the track's vote window ≤ score_until. A track's own submit_deadline replaces
 * the main one for that track. A missing time does not stop the comparisons through it: each time
 * is compared with the times of the nearest earlier step that has one, strictly when any link
 * between them is strict. A track without a vote window just skips it.
 */
function checkSchedule(c: ResolvedConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  const read = (path: string, value: string | undefined): Stamp | undefined => {
    if (value === undefined) return undefined;
    const time = timeOf(value);
    if (time === null) {
      const problem = STAMP_RE.test(value) ? "없는 날짜나 시각입니다" : '시각은 "2027-04-04T10:00:00+09:00"처럼 날짜, 시각, UTC 오프셋을 함께 적어야 합니다';
      out.push(error("V1", path, `${problem}: ${value}`));
      return undefined;
    }
    return { path, value, time };
  };
  const compared = new Set<string>();
  const order = (a: Stamp, b: Stamp, strict: boolean): void => {
    if (compared.has(`${a.path}>${b.path}`)) return;
    compared.add(`${a.path}>${b.path}`);
    if (strict ? a.time < b.time : a.time <= b.time) return;
    out.push(error("V1", b.path, `${b.path}(${b.value})는 ${a.path}(${a.value})보다 ${strict ? "늦어야 합니다" : "앞설 수 없습니다"}.`));
  };
  const chain = (steps: readonly Step[]): void => {
    let before: Stamp[] = [];
    let strict = false;
    for (const { at, strict: link } of steps) {
      strict = strict || link;
      const present = at.filter((x): x is Stamp => x !== undefined);
      if (present.length === 0) continue;
      for (const a of before) for (const b of present) order(a, b, strict);
      before = present;
      strict = false;
    }
  };

  const s = c.schedule;
  const open = read("schedule.recruit.open", s.recruit?.open);
  const close = read("schedule.recruit.close", s.recruit?.close);
  const sessions = s.sessions.map((x, i) => read(`schedule.sessions[${i}].at`, x.at));
  const start = read("schedule.main.start", s.main?.start);
  read("schedule.main.end", s.main?.end);
  const deadline = read("schedule.main.submit_deadline", s.main?.submit_deadline);
  const scoreUntil = read("schedule.score_until", s.score_until);
  if (s.results_at !== "off") read("schedule.results_at", s.results_at);

  const head = [step(false, open), step(true, close), step(false, ...sessions), step(false, start)];
  chain([...head, step(true, deadline), step(false, scoreUntil)]);
  for (const [id, t] of Object.entries(c.tracks)) {
    const own = read(`tracks.${id}.submit_deadline`, t.submit_deadline);
    const vote = t.vote ? [step(false, read(`tracks.${id}.vote.from`, t.vote.from)), step(true, read(`tracks.${id}.vote.until`, t.vote.until))] : [];
    chain([...head, step(true, own ?? deadline), ...vote, step(false, scoreUntil)]);
  }
  return out;
}

// ── V2, V5, V6: tracks ───────────────────────────────────────────────────────────────────────

/** "01-10" → [1, 10], "07" → [7, 7]. */
function parseRange(text: string): [number, number] {
  const [lo = NaN, hi = lo] = text.split("-").map((part) => Number(part.trim()));
  return [lo, hi];
}

/** Distinct team numbers of a track's ranges (ranges written backwards count for nothing). */
function teamCount(teams: readonly string[]): number {
  const ranges = teams.map(parseRange).filter(([lo, hi]) => lo <= hi).sort((a, b) => a[0] - b[0]);
  let count = 0;
  let covered = -Infinity;
  for (const [lo, hi] of ranges) {
    if (hi > covered) count += hi - Math.max(lo, covered + 1) + 1;
    covered = Math.max(covered, hi);
  }
  return count;
}

/** V2: team number ranges of different tracks do not overlap. */
function checkTeamRanges(c: ResolvedConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ranges: { track: string; path: string; text: string; lo: number; hi: number }[] = [];
  for (const [track, t] of Object.entries(c.tracks)) {
    t.teams.forEach((text, i) => {
      const [lo, hi] = parseRange(text);
      const path = `tracks.${track}.teams[${i}]`;
      if (lo > hi) out.push(error("V2", path, `팀 번호 범위 "${text}"는 작은 번호를 앞에 적어야 합니다.`));
      else ranges.push({ track, path, text, lo, hi });
    });
  }
  ranges.forEach((b, j) => {
    for (const a of ranges.slice(0, j)) {
      if (a.track !== b.track && a.lo <= b.hi && b.lo <= a.hi) {
        out.push(error("V2", b.path, `트랙 ${b.track}의 팀 번호 "${b.text}"가 트랙 ${a.track}의 "${a.text}"와 겹칩니다. 한 팀은 한 트랙에만 있어야 합니다.`));
      }
    }
  });
  return out;
}

/** V5: per rank group, the prize table gives no more prizes than the group has teams. */
function checkPrizes(c: ResolvedConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  const rankByDivision = c.scoring.rank_groups.includes("division");
  for (const [id, t] of Object.entries(c.tracks)) {
    const path = `tracks.${id}.prizes`;
    const byDivision = rankByDivision && t.divisions.length > 0;
    const table = t.prizes;
    if (!Array.isArray(table) && !byDivision) {
      out.push(error("V5", path, "부문별 상금표는 트랙에 부문이 있고 scoring.rank_groups에 division이 있을 때만 쓸 수 있습니다."));
      continue;
    }
    const teams = teamCount(t.teams);
    if (teams === 0) continue;
    const size = (rows: readonly { teams: number }[]) => rows.reduce((n, row) => n + row.teams, 0);
    const groups = byDivision ? t.divisions : [null];
    const prized = groups.reduce((n, d) => n + size(Array.isArray(table) ? table : d !== null && Object.hasOwn(table, d) ? table[d]! : []), 0);
    if (prized <= teams) continue;
    if (byDivision) {
      out.push(warning("V5", path, `트랙 ${id}의 부문별 상금표를 모두 합하면 ${prized}팀에게 상을 주는데, 이 트랙의 팀은 ${teams}팀입니다. 부문마다 팀이 몇인지 확인하세요.`));
    } else {
      out.push(error("V5", path, `트랙 ${id}의 상금표는 ${prized}팀에게 상을 주는데, 이 트랙의 팀은 ${teams}팀입니다.`));
    }
  }
  return out;
}

/** V6 (popular_vote on): vote windows do not overlap and open in track `order`. */
function checkVoteWindows(c: ResolvedConfig): Diagnostic[] {
  if (!addonEnabled(c, "popular_vote")) return [];
  const windows = Object.entries(c.tracks)
    .map(([id, t], index) => ({ id, index, order: t.order ?? Infinity, from: t.vote && timeOf(t.vote.from), until: t.vote && timeOf(t.vote.until) }))
    .filter((w): w is typeof w & { from: number; until: number } => typeof w.from === "number" && typeof w.until === "number")
    .sort((a, b) => a.order - b.order || a.index - b.index);
  const out: Diagnostic[] = [];
  windows.forEach((cur, i) => {
    const prev = windows[i - 1];
    if (!prev || cur.from >= prev.until) return;
    const overlap = prev.from < cur.until;
    out.push(
      error(
        "V6",
        `tracks.${cur.id}.vote`,
        overlap
          ? `트랙 ${cur.id}의 투표 창이 트랙 ${prev.id}의 투표 창과 겹칩니다.`
          : `트랙 ${cur.id}의 투표 창이 order가 앞선 트랙 ${prev.id}보다 먼저 열립니다. 투표 창은 order 순서대로 둡니다.`,
      ),
    );
  });
  return out;
}

// ── V3, V4: scoring ──────────────────────────────────────────────────────────────────────────

/** A criterion key is read in formulas as crit.<key>, so it must be a NAME part (design doc 2.2). */
const CRITERION_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** V3: unique keys, max > 0, weight > 0, every leaf has max; reports max_total as info. */
function checkCriteria(c: ResolvedConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  checkTree(c.scoring.criteria, "scoring.criteria", out);
  c.scoring.overrides.forEach((o, i) => {
    if (o.criteria) checkTree(o.criteria, `scoring.overrides[${i}].criteria`, out);
  });
  return out;
}

function checkTree(criteria: readonly CriterionConfig[], path: string, out: Diagnostic[]): void {
  const before = out.length;
  const seen = new Set<string>();
  const walk = (list: readonly CriterionConfig[], at: string): void => {
    list.forEach((node, i) => {
      const here = `${at}[${i}]`;
      if (!CRITERION_KEY_RE.test(node.key)) out.push(error("V3", `${here}.key`, `기준 key "${node.key}"는 영문자, 숫자, _로 적어야 합니다. 수식에서 crit.<key>로 읽습니다.`));
      if (seen.has(node.key)) out.push(error("V3", `${here}.key`, `기준 key "${node.key}"가 겹칩니다. key는 기준 트리 전체에서 하나여야 합니다.`));
      seen.add(node.key);
      if (node.weight !== undefined && !(node.weight > 0)) out.push(error("V3", `${here}.weight`, `기준 "${node.key}"의 weight는 0보다 커야 합니다.`));
      const leaf = !node.children || node.children.length === 0;
      if (leaf && node.max === undefined) out.push(error("V3", `${here}.max`, `기준 "${node.key}"에는 만점(max)이 있어야 합니다.`));
      if (node.max !== undefined && !(node.max > 0)) out.push(error("V3", `${here}.max`, `기준 "${node.key}"의 max는 0보다 커야 합니다.`));
      if (!leaf) walk(node.children!, `${here}.children`);
    });
  };
  walk(criteria, path);
  if (out.length === before) {
    out.push({ id: "V3", severity: "info", path, message: `심사 총점의 만점(max_total)은 ${roundTo(maxTotal(toCriteria(criteria)), 6)}점입니다.` });
  }
}

/** A scoring field as one team sees it, with the config path it came from. */
interface Sourced<T> {
  value: T;
  path: string;
}

/**
 * V4: the formula and tie_break compile with the variables the team has (design doc 3.3), for every
 * track × division a team can be in, so overrides are checked exactly where they apply. Popular-vote
 * variables, and a popular component, need the popular_vote add-on. Formulas no team reaches (one
 * shadowed by overrides everywhere, or one in an override that matches no track × division) still
 * go into event.json, so they are checked the way build compiles them (compileScoring).
 */
function checkFormulas(c: ResolvedConfig): Diagnostic[] {
  const popular = addonEnabled(c, "popular_vote");
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const checked = new Set<string>();
  const report = (path: string, message: string) => {
    if (seen.has(`${path}\n${message}`)) return;
    seen.add(`${path}\n${message}`);
    out.push(error("V4", path, message));
  };
  for (const place of teamPlaces(c)) {
    const s = scoringAt(c, place.track, place.division);
    const where = s.overridden ? ` (${place.label}에 적용될 때)` : "";
    const vars = scoringVariables(toCriteria(s.criteria.value), popular);
    const compile = (source: string, path: string) => {
      checked.add(path);
      const result = compileFormula(source, vars);
      if (!result.ok) for (const e of result.errors) report(path, `${e.message}${where}`);
    };
    if (s.formula.value !== null) compile(s.formula.value, s.formula.path);
    s.tieBreak.value.forEach((source, i) => compile(source, `${s.tieBreak.path}[${i}]`));
    if (!popular && s.formula.value === null && s.components.value.popular) {
      report(`${s.components.path}.popular`, `popular component는 인기투표 add-on(popular_vote)이 켜져 있을 때만 쓸 수 있습니다.${where}`);
    }
  }
  // A formula checked above with a team's variables also compiles with build's wider set.
  for (const e of compileScoring(c).errors) if (!checked.has(e.path)) report(e.path, e.message);
  return out;
}

interface TeamPlace {
  track: string | null;
  division: string | null;
  label: string;
}

/** Every track × division a team can have; one place without a track when there are no tracks. */
function teamPlaces(c: ResolvedConfig): TeamPlace[] {
  const tracks = Object.entries(c.tracks);
  if (tracks.length === 0) return [{ track: null, division: null, label: "" }];
  return tracks.flatMap(([id, t]): TeamPlace[] =>
    t.divisions.length === 0 ? [{ track: id, division: null, label: `트랙 ${id}` }] : t.divisions.map((d) => ({ track: id, division: d, label: `트랙 ${id} · 부문 ${d}` })),
  );
}

/** The scoring fields V4 needs, after the overrides that match a team in `track` / `division`. */
function scoringAt(c: ResolvedConfig, track: string | null, division: string | null) {
  const s = c.scoring;
  let criteria: Sourced<readonly CriterionConfig[]> = { value: s.criteria, path: "scoring.criteria" };
  let formula: Sourced<string | null> = { value: s.formula, path: "scoring.formula" };
  let tieBreak: Sourced<readonly string[]> = { value: s.tie_break, path: "scoring.tie_break" };
  let components: Sourced<{ judge?: number; popular?: number }> = { value: s.components, path: "scoring.components" };
  let overridden = false;
  s.overrides.forEach((o, i) => {
    if (!overrideApplies(o.when, track, division)) return;
    const at = `scoring.overrides[${i}]`;
    overridden = true;
    if (o.criteria !== undefined) criteria = { value: o.criteria, path: `${at}.criteria` };
    if (o.formula !== undefined) formula = { value: o.formula, path: `${at}.formula` };
    if (o.tie_break !== undefined) tieBreak = { value: o.tie_break, path: `${at}.tie_break` };
    if (o.components !== undefined) components = { value: o.components, path: `${at}.components` };
  });
  return { criteria, formula, tieBreak, components, overridden };
}

// ── V7, V8, V10, V11, V12 ────────────────────────────────────────────────────────────────────

function checkPrivacy(c: ResolvedConfig): Diagnostic[] {
  const days = c.privacy.retention_days;
  return days !== undefined && days < 0 ? [error("V7", "privacy.retention_days", "개인정보 보관 기간(retention_days)은 0일 이상이어야 합니다.")] : [];
}

const SECRETS: readonly { re: RegExp; what: string }[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/, what: "개인 키(PEM, PGP)" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, what: "GitHub 토큰(ghp_, gho_, ghu_, ghs_, ghr_)" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/, what: "GitHub 토큰(github_pat_)" },
  { re: /\bAIza[0-9A-Za-z_-]{20,}/, what: "Google API 키(AIza)" },
  { re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/, what: "Google OAuth 클라이언트 보안 비밀(GOCSPX-)" },
  { re: /["']private_key["']|\bprivate_key\s*:/, what: "서비스 계정 키(private_key)" },
];

/** V8: secret-looking strings anywhere in the raw files. The secret itself is never echoed. */
function checkSecrets(files: readonly SourceFile[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const file of files) {
    file.text.split(/\r?\n/).forEach((line, i) => {
      for (const { re, what } of SECRETS) {
        if (re.test(line)) {
          out.push(error("V8", `${displayPath(file.path)}:${i + 1}`, `비밀로 보이는 값(${what})이 있습니다. 키와 토큰은 설정 파일이 아니라 환경 변수나 스크립트 속성에 두세요.`));
        }
      }
    });
  }
  return out;
}

function checkGithubIdentity(c: ResolvedConfig): Diagnostic[] {
  if (!addonEnabled(c, "github_ops") || c.intake.identity.github.required) return [];
  return [warning("V10", "intake.identity.github.required", "github_ops가 켜져 있는데 신청할 때 GitHub 아이디를 필수로 받지 않습니다. repo에 초대할 계정을 찾지 못할 수 있습니다.")];
}

/** V11: question keys are unique, each roster role is taken by one question, and one takes `name`. */
function checkFields(c: ResolvedConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  const keys = new Map<string, number>();
  const roles = new Map<string, number>();
  c.intake.fields.forEach((f, i) => {
    const first = keys.get(f.key);
    if (first !== undefined) out.push(error("V11", `intake.fields[${i}].key`, `질문 key "${f.key}"가 intake.fields[${first}]와 겹칩니다. key는 시트의 열 이름이라 하나여야 합니다.`));
    else keys.set(f.key, i);
    if (!f.roster) return;
    const taken = roles.get(f.roster);
    if (taken !== undefined) out.push(error("V11", `intake.fields[${i}].roster`, `명단 역할 ${f.roster}를 intake.fields[${taken}]가 이미 맡고 있습니다.`));
    else roles.set(f.roster, i);
  });
  if (!roles.has("name")) out.push(error("V11", "intake.fields", "이름을 받는 질문이 없습니다. 질문 하나에 roster: name을 적어 주세요."));
  return out;
}

/**
 * V12: the layers parsed again from the raw files of the chain, then the merged config itself, so a
 * config built in memory (no files) is checked too. A key a file already broke is reported once.
 */
function checkLocked(c: ResolvedConfig, files: readonly SourceFile[]): Diagnostic[] {
  const fromFiles = checkLockedKeys(layersOf(files));
  const merged = checkLockedKeys([{ file: "병합된 설정", data: c }]).filter((d) => !fromFiles.some((f) => f.path === d.path));
  return [...fromFiles, ...merged];
}

function layersOf(files: readonly SourceFile[]): ConfigLayer[] {
  return files.flatMap((f) => {
    try {
      return [{ file: displayPath(f.path), data: YAML.parse(f.text) as unknown }];
    } catch {
      return [];
    }
  });
}

// ── V14, V15 ─────────────────────────────────────────────────────────────────────────────────

/** V14: known add-ons with valid options; enabled ones are available and have what they need. */
function checkAddons(c: ResolvedConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [id, entry] of Object.entries(c.addons)) {
    const path = `addons.${id}`;
    const def = findAddon(id);
    if (!def) {
      const known = listAddons().map((a) => a.id);
      out.push(error("V14", path, `알 수 없는 add-on입니다: ${id}. 있는 add-on: ${known.join(", ")}`));
      continue;
    }
    const { enabled, ...options } = entry;
    const parsed = def.options.safeParse(options, KOREAN_ERRORS);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) out.push(error("V14", formatPath([...path.split("."), ...issue.path]), `${def.name} 옵션: ${issue.message}`));
    }
    if (!enabled) continue;
    if (def.status === "planned") out.push(error("V14", path, `${def.name}(${id})는 아직 준비 중이라 켤 수 없습니다.`));
    for (const m of def.requires.modules) {
      if (!c.modules[m]) out.push(error("V14", path, `${def.name}(${id})를 켜려면 module ${m}이 켜져 있어야 합니다.`));
    }
    for (const section of def.requires.config) {
      if ((c as Record<string, unknown>)[section] === undefined) out.push(error("V14", path, `${def.name}(${id})를 켜려면 ${section} 설정이 있어야 합니다.`));
    }
  }
  return out;
}

/**
 * V15: tracks open defined divisions (and per-division prize tables name them), overrides name
 * defined tracks and divisions (and are warned about when they match no track × division),
 * conditions read question keys or email / email_domain, and every `matches` pattern passes
 * matchesProblem. Email addresses in a condition are warned about: event.json is public.
 */
function checkReferences(c: ResolvedConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [id, t] of Object.entries(c.tracks)) {
    t.divisions.forEach((d, i) => {
      if (!Object.hasOwn(c.divisions, d)) out.push(error("V15", `tracks.${id}.divisions[${i}]`, `트랙 ${id}가 여는 부문 "${d}"가 divisions에 없습니다.`));
    });
    if (Array.isArray(t.prizes)) continue;
    for (const d of Object.keys(t.prizes)) {
      if (!t.divisions.includes(d)) out.push(error("V15", `tracks.${id}.prizes.${d}`, `상금표의 부문 "${d}"는 트랙 ${id}에서 열리지 않습니다.`));
    }
  }
  const places = teamPlaces(c);
  c.scoring.overrides.forEach(({ when }, i) => {
    const at = `scoring.overrides[${i}].when`;
    const trackOk = when.track === undefined || Object.hasOwn(c.tracks, when.track);
    const divisionOk = when.division === undefined || Object.hasOwn(c.divisions, when.division);
    if (!trackOk) out.push(error("V15", `${at}.track`, `덮어쓰기가 가리키는 트랙 "${when.track}"이 tracks에 없습니다.`));
    if (!divisionOk) out.push(error("V15", `${at}.division`, `덮어쓰기가 가리키는 부문 "${when.division}"이 divisions에 없습니다.`));
    if (trackOk && divisionOk && !places.some((p) => overrideApplies(when, p.track, p.division))) {
      out.push(warning("V15", at, "이 덮어쓰기에 맞는 트랙 · 부문이 없어 어느 팀에도 쓰이지 않습니다. 부문이 그 트랙의 divisions에 있는지 확인하세요."));
    }
  });

  const fields = new Set(["email", "email_domain", ...c.intake.fields.map((f) => f.key)]);
  const walk = (cond: Cond, at: string): void => {
    if ("all" in cond) return cond.all.forEach((child, i) => walk(child, `${at}.all[${i}]`));
    if ("any" in cond) return cond.any.forEach((child, i) => walk(child, `${at}.any[${i}]`));
    if ("not" in cond) return walk(cond.not, `${at}.not`);
    if (!("field" in cond)) return;
    if (!fields.has(cond.field)) out.push(error("V15", `${at}.field`, `조건이 읽는 질문 "${cond.field}"가 intake.fields에 없습니다. 질문 key나 email, email_domain을 적어 주세요.`));
    if (cond.field === "email" && [cond.eq, cond.ne, cond.in, cond.nin].some((v) => v !== undefined)) {
      out.push(warning("V15", at, "조건에 적은 메일 주소는 공개되는 event.json에 그대로 실립니다. 사전 등록자처럼 개인 메일 명단은 조건 대신 시트 같은 비공개 명단으로 확인하세요."));
    }
    const problem = cond.matches === undefined ? null : matchesProblem(cond.matches);
    if (problem !== null) out.push(error("V15", `${at}.matches`, problem));
  };
  for (const [id, d] of Object.entries(c.divisions)) walk(d.when, `divisions.${id}.when`);
  c.intake.eligibility.forEach((rule, i) => walk(rule.when, `intake.eligibility[${i}].when`));
  return out;
}
