// Modules and add-ons with their dependencies (design doc 5).
import { z } from "zod";
import type { ResolvedConfig } from "../config/schema.js";

/** Built-in parts, on by default. */
export type ModuleId = "apply" | "submit" | "judge";

/** `planned` add-ons are listed but cannot be enabled yet. */
export type AddonStatus = "available" | "planned";

export interface AddonDef {
  id: string;
  /** Korean display name, e.g. "인기투표". */
  name: string;
  /** Modules that must be on, and top-level config sections that must exist (e.g. "github"). */
  requires: { modules: ModuleId[]; config: string[] };
  /** What turning it on adds (Korean, for check output and the MCP plan). */
  adds: string;
  status: AddonStatus;
  /** Option schema; parsing `{}` gives the defaults. */
  options: z.ZodType;
}

interface Extra {
  status?: AddonStatus;
  options?: z.ZodType;
  config?: string[];
}

function addon(id: string, name: string, modules: ModuleId[], adds: string, extra: Extra = {}): AddonDef {
  const { status = "available", options = z.strictObject({}), config = [] } = extra;
  return { id, name, requires: { modules, config }, adds, status, options };
}

const ADDONS: readonly AddonDef[] = [
  addon("popular_vote", "인기투표", ["judge"], "투표 페이지, 투표 탭, 점수 변수 votes 등", {
    options: z.strictObject({
      /** Votes each voter casts, at most one per team. */
      votes_per_voter: z.number().int().min(1).default(3),
      /** Whether people may vote for their own team. */
      self_vote: z.boolean().default(false),
    }),
  }),
  addon("team_board", "팀 모집 게시판·지원", ["apply"], "게시판 페이지, 게시판·팀지원 탭, 알림 메일"),
  addon("notices", "공지", [], "공지 영역, 공지 탭"),
  addon("public_status", "공개 현황판", ["submit"], "제출·투표 인원만 보이는 현황"),
  addon("award_show", "시상 화면", ["judge"], "발표용 전체 화면"),
  addon("slide_preview", "발표 자료 보기용 PDF", ["submit"], "PPT → PDF 변환, 나란히 보기"),
  addon("track_moves", "행사 중 트랙 이동", ["judge"], "팀의 트랙을 옮기는 운영진 기능"),
  addon("github_ops", "GitHub org 운영", [], "MCP의 팀·repo·잠금 도구", { config: ["github"] }),
  addon("check_in", "현장 체크인", ["apply"], "QR 체크인", { status: "planned" }),
  addon("mentor_queue", "멘토 질문 대기열", [], "질문 접수·배정", { status: "planned" }),
  addon("judge_assignment", "심사위원-팀 배정", ["judge"], "심사위원별 담당 팀", { status: "planned" }),
];

/** Every add-on of design doc 5.2, in table order. */
export function listAddons(): AddonDef[] {
  return ADDONS.slice();
}

/** The add-on with this id, or undefined for an unknown id. */
export function findAddon(id: string): AddonDef | undefined {
  return ADDONS.find((a) => a.id === id);
}

/** Whether an add-on is switched on: off unless `enabled: true` is written (design doc 5.1). */
export function addonEnabled(config: ResolvedConfig, id: string): boolean {
  return Object.hasOwn(config.addons, id) && config.addons[id]!.enabled;
}
