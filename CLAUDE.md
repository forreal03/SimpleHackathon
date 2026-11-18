# SimpleHackathon-ops 작업 규칙

이 저장소에서 일하는 Claude Code가 먼저 읽는 instruction입니다. 설계의 기준은 `docs/SPEC.md`이고, 여기에는 그중 작업할 때마다 지켜야 하는 규칙(SPEC 18.5)만 모았습니다. 디렉터리별 `CLAUDE.md`는 M2부터 디렉터리를 만들거나 크게 바꿀 때 함께 씁니다(SPEC 19.2).

## 커밋

- 첫 줄은 `영역: 요약` 꼴입니다. 영역은 `core`, `mcp`, `forms`, `site`, `backend`, `docs`, `examples`, `ci`, `build`, `test`, `chore`, `release` 가운데 하나입니다. 요구사항 ID가 있으면 같이 적습니다(예: `core: DIV-3 팀 정량자 추가`, `mcp: ship as a single-file bundle (M1/D1)`). 검사는 `영역(범위): 요약`과 영역 없는 `요구사항 ID: 요약`도 통과시키고, git이 만드는 merge·revert·`fixup!` 커밋은 첫 줄을 보지 않습니다.
- 첫 줄 다음에는 빈 줄을 두고, 본문에 무엇을 왜 바꿨는지 씁니다.
- Claude가 만든 커밋은 마지막 문단에 `Co-Authored-By: Claude ... <noreply@anthropic.com>`를 붙입니다.
- 커밋 작성자는 저장소에 설정된 git 사용자입니다. 소유자의 구현 작업에서는 소유자 계정입니다.
- 실제 이메일 주소, 참가자 이름, 시트·Drive ID 같은 개인정보와 조직 고유 정보는 커밋 메시지에도 파일에도 넣지 않습니다. 예시와 테스트에는 `example.com` 같은 가짜 주소를 쓰고, 커밋 메시지의 이메일은 noreply 주소와 예시 도메인만 검사를 통과합니다.
- 이 규칙은 `.githooks/commit-msg`(`scripts/check-commit-msg.mjs`)가 검사합니다. Claude Code 안에서(`CLAUDECODE=1`) 만든 커밋은 마지막 문단에 공동 작성 표시가 없으면 막힙니다.

## push

- 소유자의 구현 작업은 main에 바로 push합니다(SPEC 18.5, 소유자 결정). 다른 기여자는 PR을 엽니다.
- push 전에 로컬에서 `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke`가 모두 통과해야 합니다. 문서만 바꾼 커밋도 같습니다. `.githooks/pre-push`가 이 순서로 돌리고, 하나라도 실패하면 push하지 않습니다. 검사는 작업 트리에서 돌므로, push할 커밋을 체크아웃하고 커밋하지 않은 변경이 없을 때만 push가 됩니다.
- CI가 실패하면 다음 작업보다 먼저 고칩니다.
- hook은 `npm install`이 켭니다. `scripts/install-hooks.mjs`가 이 clone의 git 폴더(`.git/shk-hooks/`)에 `commit-msg`와 `pre-push` wrapper만 만들고 `core.hooksPath`를 그곳으로 둡니다. 다른 이름의 hook은 실행되지 않습니다. clone을 옮기면 `npm install`을 다시 합니다. 기본 PATH에 Node 22.13 이상이 없으면 hook이 멈추므로, 먼저 PATH에 Node를 넣고 커밋하고 push합니다.

## 소유자 승인이 필요한 일

아래는 소유자가 명시적으로 승인한 뒤에만 합니다(SPEC 18.5, REL-11). 승인은 그 행위 하나에만 유효합니다.

- npm publish, `npm deprecate`, npm trusted publishing 설정
- git 태그 push, GitHub Release 생성
- 저장소 이름 변경, 공개·비공개 설정 변경
- npm organization 생성, 패키지 소유자 변경
- main에 대한 force push, 이력 재작성
- Tier 0 템플릿 시트의 공개 링크 게시, MCP Registry 등록

## 문서

- spec이 바뀌면 `docs/SPEC.md`를 먼저 고치고 구현합니다. spec과 구현이 다르면 spec이 기준입니다.
- SPEC의 PDF나 따로 쓴 보고서는 만들지 않습니다(SPEC 19.2).
- 문서와 커밋에 쓰는 예시의 이름, 도메인, 금액, 날짜는 가짜로 씁니다.
- Markdown에서 범위는 `1\~10`이나 `1–10`으로 씁니다. 물결표 두 개가 한 문단에 있으면 GitHub에서 취소선이 됩니다.
