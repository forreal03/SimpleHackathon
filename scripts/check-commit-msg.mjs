#!/usr/bin/env node
// Checks commit messages against the commit rules in docs/SPEC.md 18.5.
//
//   node scripts/check-commit-msg.mjs <message-file>          used by .githooks/commit-msg
//   node scripts/check-commit-msg.mjs --range <base>..<head>   used by CI for pull requests
//
// Rules:
//   1. The first line is "area: summary" (area from AREAS, optional "(scope)") or
//      "REQ-ID: summary" (for example "DIV-3: ..."). Requirement IDs may also follow the area.
//   2. A blank line separates the first line from the body.
//   3. No e-mail addresses, except no-reply and example addresses (git@github.com-style SSH remotes
//      and logo@2x.png-style image names only look like one).
//   4. Inside Claude Code (CLAUDECODE=1) the last paragraph has a Co-Authored-By: Claude trailer.
// Merge, revert, reapply, fixup!, squash! and amend! commits skip rules 1, 2 and 4 (not rule 3).

import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const AREAS = ['core', 'mcp', 'forms', 'site', 'backend', 'docs', 'examples', 'ci', 'build', 'test', 'chore', 'release'];

const SUBJECT = new RegExp(
  `^(?:(?:${AREAS.join('|')})(?:\\([a-z0-9][a-z0-9-]*\\))?|[A-Z]{2,6}-\\d+(?:, ?[A-Z]{2,6}-\\d+)*): \\S`,
);
const SKIP =
  /^(?:Merge (?:(?:remote-tracking )?branch(?:es)?|tags?|commits?|pull request) |Revert "|Reapply "|fixup! |squash! |amend! )/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL = [
  /^noreply@anthropic\.com$/i,
  /^noreply@github\.com$/i,
  /^support@github\.com$/i, // Dependabot's "Signed-off-by: dependabot[bot] <support@github.com>"
  /@users\.noreply\.github\.com$/i,
  /@(?:[a-z0-9-]+\.)*example\.[a-z.]+$/i, // example.com and the docs' example.ac.kr
  /\.(?:example|test|invalid)$/i,
  /^git@(?:github\.com|gitlab\.com|bitbucket\.org)$/i, // SSH remotes such as git@github.com:owner/repo.git
  /@\d+x\.(?:png|jpe?g|gif|webp|avif|svg)$/i, // image names such as logo@2x.png
];
const CO_AUTHOR = /^Co-Authored-By: Claude\b[^\n]*<noreply@anthropic\.com>$/im;

/**
 * Lines git keeps. Git drops comment lines and everything after the scissors line only when the message
 * went through an editor. With -m, -F or --no-edit (git then runs commit-msg with GIT_EDITOR=:), and in
 * messages read back with git log, lines starting with # are part of the message.
 */
function keptLines(text, { comments = true } = {}) {
  const lines = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (comments && raw.startsWith('# ------------------------ >8 ------------------------')) break;
    if (comments && raw.startsWith('#')) continue;
    lines.push(raw.replace(/\s+$/, ''));
  }
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Returns a list of problems in Korean; an empty list means the message follows the rules. */
export function checkMessage(text, { claude = false, comments = true } = {}) {
  const lines = keptLines(text, { comments });
  if (lines.length === 0) return ['커밋 메시지가 비어 있습니다.'];
  const subject = lines[0];
  const body = lines.join('\n');
  const problems = [];

  // The e-mail rule holds for every commit; merge, revert and fixup commits skip only the form rules.
  for (const match of body.matchAll(EMAIL)) {
    if (!ALLOWED_EMAIL.some((re) => re.test(match[0]))) {
      problems.push(`커밋 메시지에 이메일 주소를 넣지 않습니다(개인정보, SPEC 18.5): ${match[0]}`);
    }
  }
  if (SKIP.test(subject)) return problems;

  if (!SUBJECT.test(subject)) {
    problems.push(
      `첫 줄은 "영역: 요약"(예: "core: DIV-3 팀 정량자 추가")이나 "요구사항 ID: 요약" 꼴이어야 합니다. ` +
        `영역은 ${AREAS.join(', ')} 가운데 하나입니다. 지금 첫 줄: "${subject}"`,
    );
  }
  if (lines.length > 1 && lines[1] !== '') {
    problems.push('첫 줄 다음에는 빈 줄을 하나 두고 본문을 씁니다.');
  }
  // git and GitHub read trailers only from the last paragraph
  const lastParagraph = lines.slice(lines.lastIndexOf('') + 1).join('\n');
  if (claude && !CO_AUTHOR.test(lastParagraph)) {
    problems.push('Claude가 만든 커밋은 마지막 문단에 "Co-Authored-By: Claude ... <noreply@anthropic.com>" 줄을 붙입니다.');
  }
  return problems;
}

function messagesInRange(range) {
  const out = execFileSync('git', ['log', '--no-merges', '--format=%H%x1f%B%x1e', range], { encoding: 'utf8' });
  return out
    .split('\x1e')
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.includes('\x1f'))
    .map((chunk) => {
      const [sha, ...rest] = chunk.split('\x1f');
      return { sha: sha.trim(), text: rest.join('\x1f') };
    });
}

function main(argv) {
  if (argv[0] === '--range' && argv[1]) {
    let failed = 0;
    const commits = messagesInRange(argv[1]);
    for (const { sha, text } of commits) {
      const problems = checkMessage(text, { comments: false });
      if (problems.length) {
        failed += 1;
        console.error(`${sha.slice(0, 7)} ${keptLines(text, { comments: false })[0] ?? ''}`);
        for (const p of problems) console.error(`  - ${p}`);
      }
    }
    console.log(`커밋 ${commits.length}개 검사, 규칙을 어긴 커밋 ${failed}개 (SPEC 18.5)`);
    return failed ? 1 : 0;
  }
  if (argv.length === 1 && argv[0] && !argv[0].startsWith('--')) {
    const problems = checkMessage(readFileSync(argv[0], 'utf8'), {
      claude: process.env.CLAUDECODE === '1',
      comments: process.env.GIT_EDITOR !== ':',
    });
    if (problems.length) {
      console.error('커밋 메시지가 저장소의 커밋 규칙(docs/SPEC.md 18.5)과 맞지 않습니다.');
      for (const p of problems) console.error(`  - ${p}`);
      return 1;
    }
    return 0;
  }
  console.error('사용법: node scripts/check-commit-msg.mjs <메시지 파일> | --range <base>..<head>');
  return 2;
}

// Node gives the entry module its real path, so compare against the real path of argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
