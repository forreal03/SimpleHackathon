// zod schemas for config v2 files (design doc 6.1). A file in an extends chain is checked for its
// header only, because layers may be partial and hold merge directives; the merged result is
// checked in full by ResolvedConfigSchema, which also fills in the defaults.
import { z } from "zod";
import { COND_OPS } from "../runtime/eligibility.js";
import type { Cond } from "../runtime/types.js";
import type { Diagnostic } from "./check.js";

export const CONFIG_KINDS = ["event", "profile", "preset"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/** Keys that describe a file rather than the event; they are not merged into the config. */
export const HEADER_KEYS = ["schema", "kind", "extends", "version"] as const;

/** One YAML file as written: `schema: 2`, its kind, what it extends; other sections pass through. */
export const ConfigFileSchema = z
  .looseObject({
    schema: z.literal(2),
    kind: z.enum(CONFIG_KINDS),
    extends: z.union([z.string(), z.array(z.string())]).optional(),
    /** Major version of a preset; `preset:<name>@<major>` must name it. */
    version: z.number().int().min(1).optional(),
  })
  .superRefine((file, ctx) => {
    if (file.kind === "preset" && file.version === undefined) {
      ctx.addIssue({ code: "custom", path: ["version"], message: "preset 파일에는 major 버전(version)이 있어야 합니다." });
    }
  });
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// ── conditions (design doc 4.1) ──────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COND_KINDS = ["all", "any", "not", "field"];
const COND_SHAPES = "{}, { all: [...] }, { any: [...] }, { not: ... }, { field: ..., <연산자>: ... }";

interface CondIssue {
  path: (string | number)[];
  message: string;
}

const isScalar = (v: unknown) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** What is wrong with the value an operator got, or null. */
function opValueProblem(op: string, value: unknown): string | null {
  switch (op) {
    case "eq":
    case "ne":
      return isScalar(value) ? null : "문자열이나 숫자를 적어야 합니다.";
    case "in":
    case "nin":
      return Array.isArray(value) && value.every(isScalar) ? null : "문자열이나 숫자의 목록을 적어야 합니다.";
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && DATE_RE.test(value))
        ? null
        : "숫자나 YYYY-MM-DD 날짜를 적어야 합니다.";
    case "matches":
      return typeof value === "string" ? null : "정규식을 문자열로 적어야 합니다.";
    case "exists":
      return typeof value === "boolean" ? null : "true나 false를 적어야 합니다.";
    default:
      return Array.isArray(value) && value.every((d) => typeof d === "string") ? null : "도메인 목록을 적어야 합니다.";
  }
}

function condIssues(value: unknown, path: (string | number)[]): CondIssue[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [{ path, message: `조건은 ${COND_SHAPES} 중 하나로 적어야 합니다.` }];
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return [];
  const kinds = COND_KINDS.filter((k) => keys.includes(k));
  if (kinds.length !== 1) {
    const message = kinds.length === 0 ? `알 수 없는 조건입니다(${keys.join(", ")}). ${COND_SHAPES} 중 하나로 적어 주세요.` : `조건 하나에는 ${kinds.join(", ")} 중 하나만 쓸 수 있습니다.`;
    return [{ path, message }];
  }
  const kind = kinds[0]!;
  if (kind !== "field") {
    if (keys.length > 1) return [{ path, message: `${kind} 조건에는 다른 키를 함께 쓸 수 없습니다: ${keys.filter((k) => k !== kind).join(", ")}` }];
    if (kind === "not") return condIssues(obj.not, [...path, "not"]);
    const list = obj[kind];
    if (!Array.isArray(list)) return [{ path: [...path, kind], message: `${kind}에는 조건의 목록을 적어야 합니다.` }];
    return list.flatMap((c, i) => condIssues(c, [...path, kind, i]));
  }
  const issues: CondIssue[] = [];
  if (typeof obj.field !== "string" || obj.field === "") issues.push({ path: [...path, "field"], message: "field에는 질문 key를 적어야 합니다." });
  const unknown = keys.filter((k) => k !== "field" && !(COND_OPS as readonly string[]).includes(k));
  if (unknown.length > 0) issues.push({ path, message: `알 수 없는 연산자입니다: ${unknown.join(", ")}. 쓸 수 있는 연산자: ${COND_OPS.join(", ")}` });
  const ops = COND_OPS.filter((op) => keys.includes(op));
  if (ops.length !== 1 && unknown.length === 0) issues.push({ path, message: "field 조건에는 연산자를 정확히 하나 적어야 합니다." });
  for (const op of ops) {
    const problem = opValueProblem(op, obj[op]);
    if (problem) issues.push({ path: [...path, op], message: `${op}: ${problem}` });
  }
  return issues;
}

/** The condition language, checked by hand so every problem gets a precise Korean message. */
export const CondSchema = z.custom<Cond>().superRefine((value, ctx) => {
  for (const issue of condIssues(value, [])) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});

// ── scoring (design doc 3.1) ─────────────────────────────────────────────────────────────────

/** A criterion as written in YAML; weight defaults to 1 when the runtime config is built. */
export interface CriterionConfig {
  key: string;
  name: string;
  weight?: number;
  max?: number;
  children?: CriterionConfig[];
}

const CriterionSchema: z.ZodType<CriterionConfig> = z.lazy(() =>
  z.strictObject({
    key: z.string().min(1),
    name: z.string().min(1),
    weight: z.number().optional(),
    max: z.number().optional(),
    children: z.array(CriterionSchema).optional(),
  }),
);

/** Fields a scoring override may replace; no defaults here, so an override holds only what it sets. */
const scoringFields = {
  criteria: z.array(CriterionSchema),
  input_step: z.number().positive(),
  judge_aggregate: z.strictObject({ method: z.enum(["mean", "median", "trimmed_mean"]), trim: z.number().int().min(1).optional() }),
  require_complete: z.boolean(),
  components: z.strictObject({ judge: z.number().min(0).optional(), popular: z.number().min(0).optional() }),
  popular_normalize: z.strictObject({ method: z.enum(["share_of_max", "capped_sqrt"]), full_at_multiple: z.number().positive().optional() }),
  formula: z.string().nullable(),
  precision: z.number().int().min(0).max(6),
  tie_break: z.array(z.string()),
};

const OverrideSchema = z
  .strictObject(scoringFields)
  .partial()
  .extend({ when: z.strictObject({ track: z.string().optional(), division: z.string().optional() }) });

const RankGroupsSchema = z
  .array(z.enum(["track", "division"]))
  .refine((groups) => groups.includes("track") && new Set(groups).size === groups.length, {
    message: "rank_groups에는 track이 꼭 있어야 하고 같은 값을 두 번 쓸 수 없습니다. 상금표가 트랙마다 있기 때문입니다.",
  });

const ScoringSchema = z.strictObject({
  criteria: scoringFields.criteria.default([]),
  input_step: scoringFields.input_step.default(0.01),
  judge_aggregate: scoringFields.judge_aggregate.default({ method: "mean" }),
  require_complete: scoringFields.require_complete.default(true),
  components: scoringFields.components.default({ judge: 1 }),
  popular_normalize: scoringFields.popular_normalize.default({ method: "share_of_max" }),
  formula: scoringFields.formula.default(null),
  precision: scoringFields.precision.default(2),
  tie_break: scoringFields.tie_break.default(["judge"]),
  rank_groups: RankGroupsSchema.default(["track", "division"]),
  overrides: z.array(OverrideSchema).default([]),
});

// ── the rest of the event (design doc 6.1) ───────────────────────────────────────────────────

/** Same rule as the MCP server's event ids. */
const EVENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
/** Track and division ids. They name rank groups ("hackathon/student"), so no "/". */
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const Id = z.string().regex(ID_RE, "id는 영문자로 시작하고 영문자, 숫자, _, -로 32자까지 적습니다.");

const PrizeSchema = z.strictObject({
  place: z.number().int().min(1),
  teams: z.number().int().min(1),
  amount: z.number().min(0).optional(),
  label: z.string().optional(),
});

const TrackSchema = z.strictObject({
  /** Short id for GitHub team and repo names (v1 `id`, e.g. "H"). */
  id: z.string().regex(/^[A-Za-z0-9]{1,8}$/, "트랙의 짧은 id는 영문자와 숫자로 8자까지 적습니다.").optional(),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  teams: z.array(z.string().regex(/^\d+(\s*-\s*\d+)?$/, '팀 번호 범위는 "07"이나 "01-10"처럼 적습니다.')).default([]),
  order: z.number().optional(),
  divisions: z.array(z.string()).default([]),
  division_mode: z.enum(["declared", "auto"]).default("declared"),
  vote: z.strictObject({ from: z.string(), until: z.string() }).optional(),
  prizes: z.union([z.array(PrizeSchema), z.record(z.string(), z.array(PrizeSchema))]).default([]),
  submit_deadline: z.string().optional(),
});

const DivisionSchema = z.strictObject({
  name: z.string().min(1),
  when: CondSchema.default({}),
  team_rule: z.enum(["all_members", "any_member", "leader", "majority"]).default("all_members"),
});

const FieldSchema = z
  .strictObject({
    key: z.string().min(1),
    label: z.string().optional(),
    type: z.enum(["text", "tel", "textarea", "single", "multi", "github", "number", "date"]),
    required: z.boolean().default(false),
    placeholder: z.string().optional(),
    max: z.number().int().min(1).optional(),
    options: z.array(z.string()).optional(),
    /** multi only: choices that clear the others (e.g. "없음"). */
    solo: z.array(z.string()).optional(),
    section: z.string().optional(),
    /** What the answer becomes in the roster. email and google_sub come from the ID token. */
    roster: z.enum(["name", "github_login", "team_hint"]).optional(),
  })
  .superRefine((f, ctx) => {
    const choice = f.type === "single" || f.type === "multi";
    if (choice && !f.options?.length) ctx.addIssue({ code: "custom", path: ["options"], message: `${f.type} 질문에는 보기(options)가 있어야 합니다.` });
    if (!choice && f.options) ctx.addIssue({ code: "custom", path: ["options"], message: "options는 single, multi 질문에만 씁니다." });
    if (f.solo && f.type !== "multi") ctx.addIssue({ code: "custom", path: ["solo"], message: "solo는 multi 질문에만 씁니다." });
  });

const IntakeSchema = z.strictObject({
  identity: z
    .strictObject({
      /** Locked to "required" (design doc 6.4); V12 reports other values. */
      google_login: z.string().default("required"),
      /** Locked to true. */
      one_per_account: z.boolean().default(true),
      /** Empty: every Google account. */
      email_domains: z.array(z.string()).default([]),
      github: z.strictObject({ required: z.boolean().default(false), verify: z.enum(["format", "exists"]).default("format") }).prefault({}),
    })
    .prefault({}),
  eligibility: z.array(z.strictObject({ when: CondSchema, message: z.string().min(1) })).default([]),
  fields: z.array(FieldSchema).default([]),
  consents: z.array(z.strictObject({ key: z.string().min(1), text: z.string().min(1), version: z.string().min(1) })).default([]),
});

const ScheduleSchema = z.strictObject({
  recruit: z.strictObject({ open: z.string().optional(), close: z.string().optional() }).optional(),
  sessions: z.array(z.strictObject({ id: z.string().min(1), at: z.string(), title: z.string().min(1), place: z.string().optional() })).default([]),
  main: z
    .strictObject({
      start: z.string().optional(),
      end: z.string().optional(),
      submit_deadline: z.string().optional(),
      grace_min: z.number().int().min(0).optional(),
    })
    .optional(),
  score_until: z.string().optional(),
  /** A time, or "off": results open when staff press the button. */
  results_at: z.string().optional(),
});

/** v1 sections the MCP server reads; kept as written until they move into core. */
const passthrough = z.looseObject({});

export const ResolvedConfigSchema = z
  .strictObject({
    schema: z.literal(2),
    kind: z.enum(CONFIG_KINDS),
    event: z
      .strictObject({
        id: z.string().regex(EVENT_ID_RE, "event.id는 영문 소문자, 숫자, -로 적습니다(2~63자).").optional(),
        name: z.string().min(1).optional(),
        timezone: z.string().default("UTC"),
        locale: z.string().default("ko"),
        venue: z.string().optional(),
        organizers: z.array(z.string()).default([]),
      })
      .prefault({}),
    site: z
      .strictObject({
        title: z.string().optional(),
        tagline: z.string().optional(),
        logo: z.string().optional(),
        accent: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, 'accent는 "#3b6ef5"처럼 색 코드로 적습니다.').optional(),
        links: z.array(z.strictObject({ label: z.string().min(1), url: z.string().min(1) })).default([]),
        contact: z.strictObject({ email: z.string().optional(), url: z.string().optional() }).optional(),
      })
      .prefault({}),
    schedule: ScheduleSchema.prefault({}),
    tracks: z.record(Id, TrackSchema).default({}),
    divisions: z.record(Id, DivisionSchema).default({}),
    intake: IntakeSchema.prefault({}),
    scoring: ScoringSchema.prefault({}),
    modules: z.strictObject({ apply: z.boolean().default(true), submit: z.boolean().default(true), judge: z.boolean().default(true) }).prefault({}),
    /** Add-on id → `{ enabled, ...options }`. Ids and options are checked against the registry by V14. */
    addons: z.record(z.string(), z.looseObject({ enabled: z.boolean().default(false) })).default({}),
    submit: z
      .strictObject({
        team_max_gb: z.number().positive().optional(),
        kinds: z.record(z.string(), z.strictObject({ name: z.string().min(1), max_mb: z.number().positive(), ext: z.array(z.string()).min(1) })).default({}),
        repo_link: z.enum(["required", "optional", "off"]).optional(),
      })
      .optional(),
    privacy: z.strictObject({ retention_days: z.number().int().optional(), share_contact_on_team_accept: z.boolean().optional() }).prefault({}),
    github: z.looseObject({ org: z.string().min(1) }).optional(),
    roster: passthrough.optional(),
    repo: passthrough.optional(),
    reviewers: passthrough.optional(),
    teams: passthrough.optional(),
    app_policy: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.kind !== "event") return;
    if (!config.event.id) ctx.addIssue({ code: "custom", path: ["event", "id"], message: "event 파일에는 event.id가 있어야 합니다." });
    if (!config.event.name) ctx.addIssue({ code: "custom", path: ["event", "name"], message: "event 파일에는 event.name이 있어야 합니다." });
  });

/** An event config with every `extends` merged in and defaults applied; what check and build take. */
export type ResolvedConfig = z.output<typeof ResolvedConfigSchema>;

// ── diagnostics ──────────────────────────────────────────────────────────────────────────────

const koreanError = z.locales.ko().localeError;

/** Korean messages, with a plain one for a missing value. */
export const KOREAN_ERRORS: { error: z.core.$ZodErrorMap } = {
  error: (issue) => {
    if (issue.input !== undefined) return koreanError(issue);
    if (issue.code === "invalid_value") return `값이 필요합니다. ${issue.values.map(String).join(", ")} 중 하나를 적어 주세요.`;
    return issue.code === "invalid_type" ? "값이 필요합니다." : koreanError(issue);
  },
};

/** "scoring.criteria[0].max" from ["scoring", "criteria", 0, "max"]. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) out += typeof seg === "number" ? `[${seg}]` : out === "" ? String(seg) : `.${String(seg)}`;
  return out;
}

/** zod issues as SCHEMA diagnostics. A union is reported through its only branch of the right type. */
export function schemaDiagnostics(issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[] = [], file?: string): Diagnostic[] {
  return issues.flatMap((issue): Diagnostic[] => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union") {
      const fitting = issue.errors.filter((branch) => !branch.some((i) => i.code === "invalid_type" && i.path.length === 0));
      if (fitting.length === 1) return schemaDiagnostics(fitting[0]!, path, file);
    }
    const message = issue.code === "invalid_key" ? issue.issues.map((i) => i.message).join(" ") : issue.message;
    return [{ id: "SCHEMA", severity: "error", path: formatPath(path), message: file ? `${file}: ${message}` : message }];
  });
}

/** Validates merged config data; the config is null when anything is wrong. */
export function parseResolved(data: unknown): { config: ResolvedConfig | null; diagnostics: Diagnostic[] } {
  const parsed = ResolvedConfigSchema.safeParse(data, KOREAN_ERRORS);
  return parsed.success ? { config: parsed.data, diagnostics: [] } : { config: null, diagnostics: schemaDiagnostics(parsed.error.issues) };
}
