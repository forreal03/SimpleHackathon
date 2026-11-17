#!/usr/bin/env node
// `simple-hackathon check <event.yaml> [--home <dir>]` and
// `simple-hackathon build <event.yaml> --out <dir> [--home <dir>]` (design doc 8.2).
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEventJson } from "./build/event-json.js";
import { checkConfig, type Diagnostic } from "./config/check.js";
import { displayPath, loadConfig } from "./config/load.js";

const USAGE = `사용법:
  simple-hackathon check <event.yaml> [--home <dir>]               설정을 검사합니다. 오류가 있으면 exit 1
  simple-hackathon build <event.yaml> --out <dir> [--home <dir>]   검사한 뒤 <dir>/event.json을 씁니다`;

const LABEL = { error: "ERROR", warning: "WARN ", info: "INFO " } as const;

interface Args {
  command: string;
  file: string;
  home?: string;
  out?: string;
}

/** Runs one CLI command and returns the process exit code (1 when check finds errors). */
export async function runCli(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    console.error(`${args}\n\n${USAGE}`);
    return 2;
  }
  const loaded = loadConfig(args.file, { home: args.home });
  const diagnostics = loaded.config ? [...loaded.diagnostics, ...checkConfig(loaded.config, { files: loaded.files })] : loaded.diagnostics;
  for (const d of diagnostics) console.log(`${LABEL[d.severity]} ${d.id.padEnd(6)} ${d.path}: ${d.message}`);
  const count = (s: Diagnostic["severity"]) => diagnostics.filter((d) => d.severity === s).length;
  console.log(`검사 결과: 오류 ${count("error")}개, 경고 ${count("warning")}개, 정보 ${count("info")}개`);

  if (!loaded.config || count("error") > 0) {
    if (args.command === "build") console.error("오류가 있어 event.json을 만들지 않았습니다.");
    return 1;
  }
  if (args.command === "check") return 0;

  const outFile = path.join(path.resolve(args.out!), "event.json");
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(buildEventJson(loaded.config), null, 2)}\n`);
  console.log(`event.json을 썼습니다: ${displayPath(outFile)}`);
  return 0;
}

/** The parsed arguments, or what is wrong with them. */
function parseArgs(argv: readonly string[]): Args | string {
  const [command, ...rest] = argv;
  if (command !== "check" && command !== "build") return command ? `모르는 명령입니다: ${command}` : "명령이 없습니다.";
  const files: string[] = [];
  const options: { home?: string; out?: string } = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg !== "--home" && arg !== "--out") {
      if (arg.startsWith("--")) return `모르는 옵션입니다: ${arg}`;
      files.push(arg);
      continue;
    }
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) return `${arg} 뒤에 폴더를 적어 주세요.`;
    options[arg === "--home" ? "home" : "out"] = value;
  }
  if (files.length !== 1) return "설정 파일(event.yaml)을 하나 적어 주세요.";
  if (command === "build" && !options.out) return "build에는 --out <dir>이 있어야 합니다.";
  return { command, file: files[0]!, ...options };
}

/** True when this file is the program (`node dist/cli.js`, or the bin link npm makes for it). */
function isMain(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await runCli(process.argv.slice(2));
