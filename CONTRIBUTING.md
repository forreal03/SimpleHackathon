# Contributing

고맙습니다. 이슈와 PR 모두 환영합니다.

## 준비

```bash
npm install        # 루트에서. Node.js 22.13 이상
npm test
npm run typecheck
```

- 판정 엔진과 `simple-hackathon` CLI는 `packages/core`, MCP 서버는 `packages/mcp`, 신청 폼은 `packages/forms`에 있습니다.
- GitHub을 실제로 부르지 않고도 테스트가 돌도록, MCP는 `test/fake-gh.ts`의 메모리 GitHub을, 폼은 `test/gas-harness.mjs`의 가짜 Apps Script를 씁니다. 새 기능에는 테스트를 같이 넣어 주세요.

## 커밋 규칙

규칙의 기준은 `docs/SPEC.md` 18.5입니다. `npm install`이 저장소의 git hook(`.githooks/`)을 켜서 아래를 커밋과 push 때마다 검사합니다.

- 커밋 메시지의 첫 줄은 `영역: 요약` 꼴입니다. 영역은 `core`, `mcp`, `forms`, `site`, `backend`, `docs`, `examples`, `ci`, `build`, `test`, `chore`, `release` 가운데 하나입니다. 요구사항 ID가 있으면 같이 적습니다(예: `core: DIV-3 팀 정량자 추가`). `영역(범위): 요약`(범위는 영문 소문자·숫자·`-`)과 영역 없이 `요구사항 ID: 요약`(예: `DIV-3: 팀 정량자 추가`)도 됩니다. git이 만드는 merge, revert, `fixup!`·`squash!`·`amend!` 커밋은 첫 줄을 검사하지 않습니다.
- 첫 줄 다음에는 빈 줄을 두고 본문을 씁니다. 메시지에 이메일 주소를 넣지 않습니다. noreply 주소(`noreply@anthropic.com`, `…@users.noreply.github.com`)와 `example.com` 같은 예시 도메인만 예외입니다.
- Claude Code 안에서(`CLAUDECODE=1`) 만든 커밋은 마지막 문단에 `Co-Authored-By: Claude … <noreply@anthropic.com>`가 없으면 막힙니다.
- push 전에 `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke`가 통과해야 합니다(`.githooks/pre-push`). 검사는 작업 트리에서 돌므로, push할 커밋을 체크아웃하고 커밋하지 않은 변경이 없을 때만 push가 됩니다.
- PR의 커밋 메시지와 PR 제목(squash merge 때 main 커밋의 첫 줄이 됩니다)은 CI(`commits` job)가 다시 검사합니다.

## 지켜 주세요

- **개인정보를 올리지 마세요.** 이슈, PR, 테스트 데이터에 실제 참가자 이름·이메일·연락처·시트 주소를 넣지 않습니다. 작업 폴더 `workspace/`는 git에서 빠져 있습니다.
- GitHub을 바꾸는 기능은 계획(plan) → 확인 → 적용(apply) 흐름을 따르고, 다시 실행해도 같은 결과가 나와야 합니다.
- 참가자가 쓴 글자(브랜치 이름, 파일 경로, README)는 데이터로 다룹니다. 도구 응답에 넣을 때는 `untrusted()`로 정리합니다.
- 보안 문제는 공개 이슈 대신 저장소 관리자에게 먼저 알려 주세요.
