// Reading YAML files and resolving `extends` (design doc 6.2).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Diagnostic } from "./check.js";
import type { ConfigLayer } from "./locked.js";
import { MergeError, merge } from "./merge.js";
import { ConfigFileSchema, HEADER_KEYS, KOREAN_ERRORS, parseResolved, schemaDiagnostics, type ResolvedConfig } from "./schema.js";

/** A file read while loading, with its raw text. */
export interface SourceFile {
  path: string;
  text: string;
}

export interface LoadOptions {
  /** Folder holding `profiles/` (and `events/`). Default: inferred from `<home>/events/<id>/event.yaml`. */
  home?: string;
}

export interface LoadResult {
  /** Null when loading failed; `diagnostics` says why. */
  config: ResolvedConfig | null;
  /** Every file read, the entry file first. */
  files: SourceFile[];
  /** V13 (extends) and schema problems. */
  diagnostics: Diagnostic[];
}

/** Deepest allowed parent: the entry file is depth 0. */
export const MAX_EXTENDS_DEPTH = 5;

/** Most files one load reads, counting a file again each time the chain reaches it (diamonds). */
export const MAX_EXTENDS_FILES = 50;

/** Bundled presets: src/config/presets, copied to dist/config/presets by the build. */
export const PRESETS_DIR = fileURLToPath(new URL("./presets/", import.meta.url));

/** Preset and profile names; also keeps references inside their folders. */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** How a file is named in messages: `preset:<name>` for bundled presets, relative when under the cwd. */
export function displayPath(file: string): string {
  if (path.dirname(file) === path.resolve(PRESETS_DIR)) return `preset:${path.basename(file, ".yaml")}`;
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
}

/**
 * Loads an event (or profile) file and merges its `extends` chain, parents first: each parent's
 * own chain is expanded in place, so the layers merge in the order a reader would apply them.
 */
export function loadConfig(file: string, options: LoadOptions = {}): LoadResult {
  const entry = path.resolve(file);
  const loader: Loader = { home: options.home ? path.resolve(options.home) : inferHome(entry), files: [], diagnostics: [], reads: 0 };
  const read = readLayers(loader, entry, [], null);
  if (!read) return { config: null, files: loader.files, diagnostics: loader.diagnostics };

  let merged: unknown = {};
  for (const layer of read.layers) {
    try {
      merged = merge(merged, layer.data);
    } catch (e) {
      if (!(e instanceof MergeError)) throw e;
      return { config: null, files: loader.files, diagnostics: [...loader.diagnostics, { id: "MERGE", severity: "error", path: e.path, message: `${displayPath(layer.file)}: ${e.message}` }] };
    }
  }
  const { config, diagnostics } = parseResolved({ schema: 2, kind: read.kind, ...(merged as object) });
  return { config, files: loader.files, diagnostics: [...loader.diagnostics, ...diagnostics] };
}

interface Loader {
  home: string | undefined;
  files: SourceFile[];
  diagnostics: Diagnostic[];
  /** Files read so far, see MAX_EXTENDS_FILES. */
  reads: number;
}

/** Where a reference points, and the preset major it asks for. */
interface Target {
  file: string;
  ref: string;
  major: number | null;
}

/** `<home>` when the file sits at `<home>/events/<id>/<file>`. */
function inferHome(file: string): string | undefined {
  const events = path.dirname(path.dirname(file));
  return path.basename(events) === "events" ? path.dirname(events) : undefined;
}

function v13(loader: Loader, file: string, message: string): null {
  loader.diagnostics.push({ id: "V13", severity: "error", path: displayPath(file), message });
  return null;
}

/** The layers of `file` in merge order, or null when anything in its chain is broken. */
function readLayers(loader: Loader, file: string, chain: readonly string[], target: Target | null): { kind: string; layers: ConfigLayer[] } | null {
  const from = chain.length > 0 ? ` (${displayPath(chain[chain.length - 1]!)}의 extends: ${target?.ref})` : "";
  if (chain.includes(file)) return v13(loader, file, `extends가 순환합니다: ${[...chain, file].map(displayPath).join(" → ")}`);
  if (chain.length > MAX_EXTENDS_DEPTH) return v13(loader, file, `extends가 ${MAX_EXTENDS_DEPTH}단계보다 깊습니다: ${[...chain, file].map(displayPath).join(" → ")}`);
  // Reported once; every read after the limit stops here, so the work stays bounded.
  if (++loader.reads > MAX_EXTENDS_FILES) {
    return loader.reads === MAX_EXTENDS_FILES + 1 ? v13(loader, file, `extends로 읽는 파일이 ${MAX_EXTENDS_FILES}개를 넘습니다. 같은 부모를 여러 경로로 거치지 않게 extends를 줄여 주세요.`) : null;
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return v13(loader, file, `파일을 찾을 수 없습니다: ${displayPath(file)}${from}`);
  }
  if (!loader.files.some((f) => f.path === file)) loader.files.push({ path: file, text });

  let data: unknown;
  try {
    data = YAML.parse(text);
  } catch (e) {
    loader.diagnostics.push({ id: "YAML", severity: "error", path: displayPath(file), message: `YAML 문법 오류입니다. ${(e as Error).message}` });
    return null;
  }
  const header = ConfigFileSchema.safeParse(data ?? {}, KOREAN_ERRORS);
  if (!header.success) {
    loader.diagnostics.push(...schemaDiagnostics(header.error.issues, [], displayPath(file)));
    return null;
  }
  if (target?.major != null && header.data.version !== target.major) {
    return v13(loader, file, `${target.ref}를 찾았지만 이 preset의 major 버전은 ${header.data.version}입니다.`);
  }

  const layers: ConfigLayer[] = [];
  let broken = false;
  const refs = header.data.extends === undefined ? [] : typeof header.data.extends === "string" ? [header.data.extends] : header.data.extends;
  const parents: string[] = [];
  for (const ref of refs) {
    const parent = resolveRef(loader, ref, file);
    const again = parent !== null && parents.includes(parent.file);
    if (again) v13(loader, file, `extends에 같은 파일을 두 번 적었습니다: ${ref}`);
    if (parent) parents.push(parent.file);
    const read = parent && !again && readLayers(loader, parent.file, [...chain, file], parent);
    if (read) layers.push(...read.layers);
    else broken = true;
  }
  if (broken) return null;
  const own = Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([k]) => !(HEADER_KEYS as readonly string[]).includes(k)));
  layers.push({ file, data: own });
  return { kind: header.data.kind, layers };
}

/** `preset:<name>@<major>`, `profile:<name>`, or a path relative to the referring file. */
function resolveRef(loader: Loader, ref: string, from: string): Target | null {
  if (ref.startsWith("preset:")) {
    const m = /^preset:([^@]+)@(\d+)$/.exec(ref);
    if (!m || !NAME_RE.test(m[1]!)) return v13(loader, from, `preset 참조는 preset:<이름>@<major>로 적습니다: ${ref}`);
    return { file: path.join(path.resolve(PRESETS_DIR), `${m[1]}.yaml`), ref, major: Number(m[2]) };
  }
  if (ref.startsWith("profile:")) {
    const name = ref.slice("profile:".length);
    if (!NAME_RE.test(name)) return v13(loader, from, `profile 이름은 영문 소문자, 숫자, -, _로 적습니다: ${ref}`);
    if (!loader.home) return v13(loader, from, `${ref}를 찾을 home 폴더를 모릅니다. 이벤트 파일을 <home>/events/<id>/event.yaml에 두거나 --home을 주세요.`);
    return { file: path.join(loader.home, "profiles", `${name}.yaml`), ref, major: null };
  }
  return { file: path.resolve(path.dirname(from), ref), ref, major: null };
}
