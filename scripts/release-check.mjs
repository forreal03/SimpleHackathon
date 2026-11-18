#!/usr/bin/env node
// `npm run release:check`: the checks of docs/SPEC.md 18.4 that every release must pass (REL-5), in one go.
//
//   npm run release:check                          before tagging a release
//   RELEASE_TAG=v0.2.0 npm run release:check       also checks that the tag is the package version
//
// Needs network access for npm audit. Exits 1 when a check fails. Checks whose code does not exist yet are
// listed as "아직 없음" with the milestone that adds them; they cannot block a release before they exist.
// Checks only a person can do (MCP Inspector and Claude Code smoke, the owner's approval) are listed too.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'packages/mcp/package.json'), 'utf8'));
const version = pkg.version;

const npm = process.env.npm_execpath && /npm-cli\.[cm]?js$/.test(process.env.npm_execpath)
  ? { cmd: process.execPath, args: [process.env.npm_execpath] }
  : { cmd: 'npm', args: [] };
const shell = process.platform === 'win32' && npm.cmd === 'npm';

const results = [];
const record = (item, name, status, detail = '') => results.push({ item, name, status, detail });

function run(label, cmd, args, cwd = root) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: shell && cmd === 'npm' });
  return r.status === 0;
}
const npmRun = (script) => run(`npm run ${script}`, npm.cmd, [...npm.args, 'run', script]);

function trackedFiles(...patterns) {
  return execFileSync('git', ['ls-files', '-z', '--', ...patterns], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

// 1. Tests, typecheck, build and the bundle smoke. The rest uses the build, so stop if this fails.
const steps = ['typecheck', 'test', 'build', 'smoke'];
const failedStep = steps.find((s) => !npmRun(s));
if (failedStep) {
  record(1, '테스트, 타입 검사, 빌드, smoke', 'fail', `npm run ${failedStep} 실패`);
  report();
}
record(1, '테스트, 타입 검사, 빌드, smoke', 'ok', 'npm run typecheck, test, build, smoke');
record(1, 'MCP Inspector, Claude Code로 띄워 보는 smoke', 'manual', '사람이 직접 확인합니다(SPEC 17의 M1 완료 조건).');
record(1, '서버가 알리는 버전 = package.json', 'ok', `${version} (smoke가 확인)`);

// 2. The core tests (test/build.test.ts) compare the two examples' event.json with these snapshots. Outside CI
//    vitest writes a missing snapshot and passes, so both must be committed and left as committed by step 1.
const snapshots = ['packages/core/test/__snapshots__/reference.event.json', 'packages/core/test/__snapshots__/company.event.json'];
const committed = new Set(trackedFiles(...snapshots));
const uncommitted = snapshots.filter((f) => !committed.has(f));
const changedSnapshots = execFileSync('git', ['status', '--porcelain', '--', ...snapshots], { cwd: root, encoding: 'utf8' }).trim();
record(2, '두 예제의 생성물 snapshot', uncommitted.length || changedSnapshots ? 'fail' : 'ok',
  uncommitted.length ? `커밋되지 않음: ${uncommitted.join(', ')}` : changedSnapshots ? `커밋과 다름: ${changedSnapshots}` : '1번의 core 테스트(build.test.ts)가 비교');

// 3. Tests that try to break each locked invariant (SPEC 15.1, 16) arrive with M2.
const invariantTests = trackedFiles('packages/*/test/*invariant*', 'packages/*/test/**/*invariant*');
record(3, 'locked invariants 테스트', invariantTests.length ? 'ok' : 'todo',
  invariantTests.length ? `${invariantTests.length}개 파일(1번에서 실행)` : 'M2에서 15.1의 규칙마다 공격 테스트를 더합니다.');

// 4a. Secret scan over every tracked file. A line can opt out with the marker "secret-scan: allow".
const SECRET_PATTERNS = [
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];
// A private key (PEM or PGP, the headers of the kit's V8 rule) counts only with key material: base64 right
// after the header on its line (a .env or JSON value), or a whole base64 line within the next five lines
// (PGP armor and old encrypted PEM put header lines and a blank line first). So a placeholder such as
// "-----BEGIN RSA PRIVATE KEY-----\n..." in an example is fine, and so is prose after a header.
const KEY_HEADER = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/;
const KEY_INLINE = /^(?:\\[rn]|\s)+[A-Za-z0-9+/]{40,}/;
const KEY_LINE = /^\s*["']?[A-Za-z0-9+/]{40,}={0,2}["']?,?\s*$/;
const secretHits = [];
for (const file of trackedFiles()) {
  const abs = path.join(root, file);
  if (!existsSync(abs) || statSync(abs).size > 5_000_000) continue;
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('secret-scan: allow')) return;
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) secretHits.push(`${file}:${i + 1} ${kind}`);
    const header = line.match(KEY_HEADER);
    if (header && (KEY_INLINE.test(line.slice(header.index + header[0].length)) || lines.slice(i + 1, i + 6).some((l) => KEY_LINE.test(l)))) {
      secretHits.push(`${file}:${i + 1} private key`);
    }
  });
}
record(4, 'secret scan', secretHits.length ? 'fail' : 'ok',
  secretHits.length ? secretHits.join('; ') : `추적 중인 파일 전부, 패턴 ${SECRET_PATTERNS.length + 1}종`);
record(4, 'brand scan, 대회 값 lint', 'todo', 'LEAN-7과 18.3의 검사는 사이트·백엔드 코드가 생기는 M2–M3에 더합니다.');
record(4, 'npm 번들 크기 예산, 런타임 의존성 0', 'ok', '1번의 smoke 안에서 check-package가 확인');
record(4, '코드줄 예산(13.4)', 'todo', 'core의 budget.test.ts는 M2에서 더합니다(계약서 12장의 v1: 수식 엔진 517/400, 부문 판정 336/200).');

// 4b. Security advisories for the packages inside the bundle (REL-9).
const audited = run('npm audit (번들에 든 패키지)', process.execPath, [path.join(root, 'packages/mcp/scripts/audit-bundle.mjs')]);
record(4, '번들에 든 패키지의 보안 권고', audited ? 'ok' : 'fail', audited ? 'moderate 이상 없음' : 'audit-bundle.mjs 출력 참고');

// 5. Relative links in the tracked Markdown files point at files that exist, and a #fragment at a heading
//    of the target (a folder means its README.md), with GitHub's heading ids.
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** [line number, text] of the lines outside fenced code blocks. A fence closes only with its own character, at least as long. */
function outsideFences(text) {
  const out = [];
  let open = null;
  text.split('\n').forEach((line, i) => {
    const f = line.match(FENCE);
    if (open) {
      if (f && f[1][0] === open[0] && f[1].length >= open.length && !f[2].trim()) open = null;
    } else if (f && !(f[1][0] === '`' && f[2].includes('`'))) open = f[1];
    else out.push([i, line]);
  });
  return out;
}
const headingIds = new Map();
function idsOf(file) {
  if (!headingIds.has(file)) {
    const ids = new Set();
    const seen = new Map();
    for (const [, line] of outsideFences(readFileSync(file, 'utf8'))) {
      for (const m of line.matchAll(/<a\s[^>]*\b(?:id|name)=["']([^"']+)["']/gi)) ids.add(m[1]);
      const h = line.match(/^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/);
      if (!h) continue;
      const text = h[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
      const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      ids.add(n ? `${base}-${n}` : base);
    }
    headingIds.set(file, ids);
  }
  return headingIds.get(file);
}
const brokenLinks = [];
for (const file of trackedFiles('*.md')) {
  const from = path.join(root, file);
  for (const [i, line] of outsideFences(readFileSync(from, 'utf8'))) {
    // Text inside a code span is not a link, so drop code spans first.
    const prose = line.replace(/(`+).*?\1/g, '');
    const targets = [
      ...[...prose.matchAll(/\]\((?:<([^>]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g)].map((m) => m[1] ?? m[2]),
      ...[...prose.matchAll(/^ {0,3}\[(?!\^)[^\]]+\]:\s*<?([^\s>]+)>?/g)].map((m) => m[1]), // reference definitions, not footnotes
    ];
    for (const target of targets) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // URLs, mailto:
      const [rawPath, fragment] = target.split('#');
      let rel, id;
      try {
        rel = decodeURIComponent(rawPath.split('?')[0]);
        id = fragment && decodeURIComponent(fragment);
      } catch {
        brokenLinks.push(`${file}:${i + 1} ${target} (잘못된 % 표기)`);
        continue;
      }
      const abs = !rel ? from : rel.startsWith('/') ? path.join(root, rel) : path.resolve(path.dirname(from), rel);
      if (!existsSync(abs)) {
        brokenLinks.push(`${file}:${i + 1} ${target}`);
        continue;
      }
      const md = statSync(abs).isDirectory() ? path.join(abs, 'README.md') : abs;
      if (id && md.endsWith('.md') && existsSync(md) && !idsOf(md).has(id)) {
        brokenLinks.push(`${file}:${i + 1} ${target} (제목 없음)`);
      }
    }
  }
}
record(5, '문서 링크', brokenLinks.length ? 'fail' : 'ok',
  brokenLinks.length ? brokenLinks.join('; ') : '추적 중인 Markdown의 상대 링크와 #제목이 모두 있음');

// 6. npm pack contents are checked by check-package in the smoke; the backend bundle arrives with M3.
record(6, 'npm pack --dry-run 내용', 'ok', '1번의 smoke 안에서 check-package가 확인');
record(6, '백엔드 번들 sha256 목록', 'todo', '범용 백엔드(BE-8)가 생기는 M3에 더합니다.');

// 7. CHANGELOG has a dated section for this version that says how existing settings are affected (REL-3),
//    and the READMEs no longer call this version unpublished (the release commit, CLAUDE.md 릴리스).
const changelog = existsSync(path.join(root, 'CHANGELOG.md')) ? readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8') : '';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const section = changelog.split(/^(?=## )/m).find((s) => new RegExp(`^## ${esc(version)}(?:\\s|$)`).test(s));
const impact = section?.match(/^설정 영향: (없음|자동 변환|수동 조치)/m)?.[1];
const dated = section !== undefined && new RegExp(`^## ${esc(version)} \\(\\d{4}-\\d{2}-\\d{2}\\)`).test(section);
record(7, 'CHANGELOG의 설정 영향과 날짜', impact && dated ? 'ok' : 'fail',
  !section ? `CHANGELOG.md에 "## ${version}" 절이 없음`
    : !impact ? `${version} 절에 "설정 영향: 없음|자동 변환|수동 조치" 줄이 없음`
    : !dated ? `"## ${version}" 머리에 출판 날짜(YYYY-MM-DD)가 없음`
    : `${version}: ${impact}`);
const unpublished = ['README.md', 'packages/mcp/README.md'].flatMap((f) =>
  readFileSync(path.join(root, f), 'utf8').split('\n').flatMap((line, i) =>
    line.includes(`${version}(아직 출판 전)`) || line.includes(`${version}부터 예정`) ? [`${f}:${i + 1}`] : []));
record(7, 'README의 출판 전 문구', unpublished.length ? 'fail' : 'ok',
  unpublished.length ? `${version}을 출판 전·예정으로 적은 줄: ${unpublished.join(', ')}` : `${version}을 출판 전으로 적은 줄 없음`);

// The tag that starts the release workflow must name this version.
if (process.env.RELEASE_TAG) {
  const ok = process.env.RELEASE_TAG === `v${version}`;
  record('+', '태그와 버전', ok ? 'ok' : 'fail', ok ? process.env.RELEASE_TAG : `태그 ${process.env.RELEASE_TAG}, package.json ${version}`);
}

// 8. Publishing waits for the owner (SPEC 18.5, REL-11).
record(8, '소유자 승인', 'manual', 'npm publish, 태그 push, GitHub Release는 소유자 승인 뒤에만(release workflow의 npm environment).');
report();

function report() {
  const mark = { ok: '통과', fail: '실패', todo: '아직 없음', manual: '사람이 확인' };
  console.log(`\nrelease:check — simple-hackathon-ops-mcp ${version} (SPEC 18.4)`);
  for (const r of results) console.log(`  ${String(r.item).padEnd(2)} [${mark[r.status]}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const failed = results.filter((r) => r.status === 'fail').length;
  console.log(failed ? `\n${failed}개 검사가 실패했습니다.` : '\n자동 검사는 모두 통과했습니다. "사람이 확인" 항목은 따로 확인해 주세요.');
  process.exit(failed ? 1 : 0);
}
