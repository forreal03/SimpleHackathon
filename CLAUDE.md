# SimpleHackathon-ops 작업 규칙

이 저장소에서 일하는 Claude Code가 먼저 읽는 instruction입니다. 설계의 기준은 `docs/SPEC.md`이고 여기에는 작업할 때마다 지켜야 하는 규칙을 모았습니다. 대부분 SPEC 18.5와 19.2에서 왔고 문서 문체의 자세한 규칙은 이 파일이 기준입니다(SPEC 19.2). 디렉터리별 `CLAUDE.md`는 M2부터 디렉터리를 만들거나 크게 바꿀 때 함께 씁니다(SPEC 19.2).

## 커밋

- 첫 줄은 `영역: 요약` 꼴입니다. 영역은 `core`, `mcp`, `forms`, `site`, `backend`, `docs`, `examples`, `ci`, `build`, `test`, `chore`, `release` 가운데 하나입니다. 요구사항 ID가 있으면 같이 적습니다(예: `core: DIV-3 팀 정량자 추가`, `mcp: ship as a single-file bundle (M1/D1)`). 검사는 `영역(범위): 요약`과 영역 없는 `요구사항 ID: 요약`도 통과시키고 git이 만드는 merge·revert·`fixup!` 커밋은 첫 줄을 보지 않습니다.
- 첫 줄 다음에는 빈 줄을 두고 본문에 무엇을 왜 바꿨는지 씁니다.
- Claude가 만든 커밋은 마지막 문단에 `Co-Authored-By: Claude ... <noreply@anthropic.com>`를 붙입니다.
- 커밋 작성자는 저장소에 설정된 git 사용자입니다. 소유자의 구현 작업에서는 소유자 계정입니다.
- 실제 이메일 주소, 참가자 이름, 시트·Drive ID 같은 개인정보와 조직 고유 정보는 커밋 메시지에도 파일에도 넣지 않습니다. 예시와 테스트에는 `example.com` 같은 가짜 주소를 씁니다. 커밋 메시지의 이메일은 noreply 주소와 예시 도메인만 검사를 통과합니다.
- 이 규칙은 `.githooks/commit-msg`(`scripts/check-commit-msg.mjs`)가 검사합니다. Claude Code 안에서(`CLAUDECODE=1`) 만든 커밋은 마지막 문단에 공동 작성 표시가 없으면 막힙니다.

## push

- 소유자의 구현 작업은 main에 바로 push합니다(SPEC 18.5, 소유자 결정). 다른 기여자는 PR을 엽니다.
- push 전에 로컬에서 `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke`가 모두 통과해야 합니다. 문서만 바꾼 커밋도 같습니다. `.githooks/pre-push`가 이 순서로 돌리고 하나라도 실패하면 push하지 않습니다. 검사는 작업 트리에서 돌므로, push할 커밋을 체크아웃하고 커밋하지 않은 변경이 없을 때만 push가 됩니다.
- CI가 실패하면 다음 작업보다 먼저 고칩니다.
- hook은 `npm install`이 켭니다. `scripts/install-hooks.mjs`가 이 clone의 git 폴더(`.git/shk-hooks/`)에 `commit-msg`와 `pre-push` wrapper만 만들고 `core.hooksPath`를 그곳으로 둡니다. 다른 이름의 hook은 실행되지 않습니다. clone을 옮기면 `npm install`을 다시 합니다. 기본 PATH에 Node 22.13 이상이 없으면 hook이 멈추므로, 먼저 PATH에 Node를 넣고 커밋하고 push합니다.

## 릴리스

- 출판 전에 `npm run release:check`가 통과해야 합니다(SPEC 18.4, REL-5). npm audit 때문에 네트워크가 필요합니다. "아직 없음"과 "사람이 확인" 항목은 출력에 따로 나옵니다.
- 출판 커밋에서 함께 바꿀 것은 `packages/mcp/package.json`의 version(`npm version X.Y.Z -w packages/mcp --no-git-tag-version`으로 바꾸면 `package-lock.json`도 함께 바뀝니다), 두 README의 `simple-hackathon-ops-mcp@버전`과 "아직 출판 전"·"예정" 문장(`packages/mcp/README.md`의 provenance 문장 포함), `CHANGELOG.md`의 그 버전 머리(날짜)와 "설정 영향"입니다. README의 고정 버전은 `check-package.mjs`가 package.json과 맞는지 봅니다.
- 출판은 `vX.Y.Z` 태그 push로 `.github/workflows/release.yml`이 합니다. 태그 push와 출판은 소유자 승인이 필요하고 workflow는 GitHub environment `npm`의 승인을 다시 기다립니다. 이 승인은 environment `npm`이 Required reviewers와 함께 이미 있을 때만 걸립니다. 없으면 GitHub가 보호 규칙 없는 `npm` environment를 새로 만들고 승인 없이 출판하므로, 첫 태그 push 전에 소유자가 만들어 두었는지 확인합니다(SPEC Q5).

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

## 문서 문체

한국어 문서는 [im-not-ai](https://github.com/epoko77-ai/im-not-ai)(Humanize KR)의 규칙에 맞춰 사람이 쓴 문장처럼 씁니다(SPEC 19.2). 소유자에게 하는 설명과 보고도 같은 문체로 합니다. 이 절의 규칙이 im-not-ai와 다르면 이 절을 따릅니다.

- 본문은 합니다체로 씁니다. 독자에게 부탁하는 "넣어 주세요", "알리세요" 같은 문장은 그대로 둡니다. 한 문장을 불릿 여러 줄로 쪼개지 않고 문단 안에서 이어 씁니다. 번호 목록은 다른 곳에서 번호로 가리키므로(`0.1 #8`, `6.1 #7`, `18.4의 7번`) 모양을 바꾸지 않습니다.
- 연결어미 `-고`, `-며`, `-지만`, `-면서`, `-아서`/`-어서`, `-자`, `-는데` 바로 뒤에는 쉼표를 찍지 않습니다.
- 문장 속 낱말을 굵게 강조하지 않습니다. 문단이나 항목 머리의 굵은 이름표와 첫 문장(`**한 문장으로.**`, `1. **시트와 스크립트**:`, `- **개인정보를 올리지 마세요.**`), 결정 표시(`**[D80]**`), 용어를 처음 정의하는 자리와 표기 범례의 굵은 글씨(`**추가 확정**`, `**P0**`)는 강조가 아니므로 남기고 새 글에도 같은 방식으로 씁니다.
- "다음과 같습니다", "중요한 것은 …입니다", "…하는 이유입니다" 같은 틀과 "가지고 있다" 같은 번역투, 습관처럼 붙는 "-고 있다"를 피합니다. API, MCP, hook, workflow처럼 영어로 굳은 기술 용어는 억지로 한국어로 옮기지 않습니다.
- 문장을 다듬는 일은 따로 하든 내용을 고치면서 하든 사실, 고유명사, 코드, 링크, ID, 숫자, 제목, 표 모양을 바꾸지 않습니다. 의무·허용·추측 표현("해야 합니다", "할 수 있습니다", "…로 보입니다"와 구현 계약서가 MUST·MAY로 정한 "반드시", "해도 됩니다")은 그 강도 그대로 둡니다. 의무를 단정으로, 허용을 추측으로, 추측을 단정으로 바꾸지 않습니다.
- 따옴표로 옮긴 말(소유자 지시, 예시 발화)은 손대지 않습니다. 코드와 테스트가 글자 그대로 쓰는 문구도 그대로 둡니다. `docs/design/core-engines.md`의 메시지 표(2.8, 2.10, 6.8, 8.7, 10.1부터 10.3까지), 7.7의 참가자용 문장, CLI 출력이 그런 예입니다. `scripts/release-check.mjs`가 찾는 문구(CHANGELOG의 `설정 영향: 없음` 꼴 줄, README의 `X.Y.Z(아직 출판 전)`과 `X.Y.Z부터 예정`)는 새로 쓸 때도 그 꼴을 지킵니다.
- 해라체로 쓴 규칙 문장(SPEC 6.4의 V 규칙, 15.1의 규칙 열)과 시험 목록(SPEC 16장), 명사형으로 끝나는 표 칸과 목록 항목, 작성일 칸의 갱신 이력(예: 기록함)은 고칠 때도 새로 쓸 때도 그 자리의 문체를 따릅니다.
