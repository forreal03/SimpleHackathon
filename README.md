# SimpleHackathon-ops

해커톤 운영 오픈소스 키트입니다. **참가 신청 폼**으로 신청을 받고, **MCP 서버**로 GitHub org를 운영합니다.
운영진은 Claude에게 말로 시키고, GitHub을 바꾸는 일은 항상 "계획 → 확인 → 적용" 순서로만 일어납니다.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](packages/mcp)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-server-7c5cff)](https://modelcontextprotocol.io)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-backend-4285F4?logo=google&logoColor=white)](packages/forms/apps-script)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-form-222222?logo=github&logoColor=white)](packages/forms/site)
[![npm](https://img.shields.io/badge/npm-simple--hackathon--ops--mcp-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/simple-hackathon-ops-mcp)

![SimpleHackathon-ops architecture and stack](docs/images/architecture.svg)

처음 쓴 대회는 [ENDPoinT 2026](https://2026endpoint.github.io)(서울과학기술대학교 컴퓨터공학과 해커톤)입니다.

## 들어 있는 것

| 폴더 | 무엇 | 스택 |
| --- | --- | --- |
| [`packages/forms`](packages/forms) | 참가 신청 페이지. ENDPoinT 사이트의 신청 화면을 디자인 그대로 옮겼습니다. GitHub 아이디까지 받고, 서버가 기간·입력을 검사해 구글 시트에 씁니다. [공개 데모](https://forreal03.github.io/SimpleHackathon-ops-mcp/)는 데모 모드라 신청 내용을 아무 데도 보내지 않습니다 | HTML·CSS·JS(빌드 없음), GitHub Pages, Google Apps Script, Google Sheets |
| [`packages/mcp`](packages/mcp) | MCP 서버 [`simple-hackathon-ops-mcp`](https://www.npmjs.com/package/simple-hackathon-ops-mcp). 팀·repo 생성, 조장 maintainer, 마감 잠금·풀기, 멘토·심사위원 읽기 권한, 앱 설치 요청 판정, 일정 토글. npm에는 다음 릴리스 0.2.0(아직 출판 전)부터 런타임 의존성 없는 파일 하나로 나갑니다. main에서 빌드한 서버는 이미 이 파일 하나입니다 | TypeScript, Node.js 22.13+, MCP SDK, zod, Octokit, node:sqlite, esbuild(단일 파일 번들) |
| [`packages/core`](packages/core) | 판정 엔진. 설정 상속·병합·검사(V1–V8, V10–V15), 점수(가중합 기본 + 선택 수식), 순위·상 배분, 부문 판정, `event.json` 생성과 `simple-hackathon check`/`build` CLI. 같은 소스를 Apps Script용 `runtime.gs.js`로도 빌드합니다. 설계는 [`docs/design/core-engines.md`](docs/design/core-engines.md) | TypeScript, zod, yaml, esbuild |
| [`examples`](examples) | 가짜 데이터 예제 두 개: 두 트랙 reference case(`reference-2track`)와 사내 해커톤(`company-internal`) | YAML |
| [`config`](config) | 대회 설정 양식, 앱 정책, 팀 README 양식, 환경 변수 목록 | YAML |
| [`docs`](docs) | 그림과 문서 | |

## 빠른 시작

1. **신청 받기**: [`packages/forms`](packages/forms#설치)대로 시트에 Apps Script를 붙이고, `site/`를 GitHub Pages에 올립니다. 질문·모집 기간은 `Config.gs`, 대회 이름·안내 글은 `site/config.js`에서 고칩니다.
2. **MCP 연결**: GitHub App을 만들어 대회 org에 설치하고, Claude Code나 Claude Desktop에 서버를 등록합니다.
   ```bash
   claude mcp add simple-hackathon-ops --scope user \
     -e HACKATHON_OPS_HOME=$HOME/hackathon-ops \
     -e GITHUB_APP_ID=123456 -e GITHUB_APP_PRIVATE_KEY_PATH=/path/to/key.pem \
     -- npx -y simple-hackathon-ops-mcp@0.1.0
   ```
   다음 릴리스 0.2.0(아직 출판 전)부터 서버는 런타임 의존성이 없는 파일 하나라서 `npx`가 tarball 하나만 받습니다. main에서 빌드한 서버는 이미 이 파일 하나입니다. 지금 npm에 있는 0.1.0은 그 전 방식의 빌드라 런타임 의존성 8개를 함께 설치합니다. 예시처럼 정확한 버전을 적어 고정하기를 권합니다([버전 고정](packages/mcp#1-nodejs-2213-이상)).
3. **운영**: "새 대회 만들어줘, 명단은 이 시트로" → "명단 확인해줘" → "팀 만들고 초대해줘" → "마감 잠가줘"처럼 말합니다. 바뀔 목록을 먼저 보여 주고, 확인한 뒤에만 적용합니다. 자세한 흐름은 [`packages/mcp`](packages/mcp#대회-흐름)에 있습니다.

## 지키는 것

- GitHub 변경은 계획을 먼저 보여 주고 확인 코드가 있어야 적용됩니다. 그사이 상황이 바뀌면 적용하지 않습니다.
- 참가자가 다른 팀 코드를 볼 수 없게 합니다. 멘토·심사위원은 읽기만, 마감 전에는 public 전환을 막습니다.
- 명단은 읽기만 하고, 도구 응답에 이메일을 내보내지 않습니다. 대회가 끝나면 로컬 기록의 개인정보를 지웁니다.
- 앱 승인과 2FA 강제처럼 GitHub이 API를 열어 두지 않은 일은 사람이 GitHub 화면에서 합니다. 도구는 판단 근거와 링크를 줍니다.

## 개발

```bash
npm install          # 저장소 루트에서 (npm workspaces)
npm test             # core 224개 + MCP 66개 + 폼 17개 테스트
npm run typecheck
npm run build
npm run smoke        # 빌드된 CLI로 예제를 검사·빌드하고, MCP 서버 번들을 실제 MCP 클라이언트로 띄워 확인
                     # (node_modules 없는 복사본으로도), npm 출판물(의존성 0, 크기, 파일 목록, 라이선스) 검사
```

```
.
├── packages/
│   ├── core/       판정 엔진과 simple-hackathon CLI (설정 검사·빌드, 점수·순위·부문)
│   ├── mcp/        MCP 서버 (npm: simple-hackathon-ops-mcp)
│   └── forms/      신청 페이지: site/ (GitHub Pages) + apps-script/ (Apps Script)
├── examples/       설정 예제 (profile + event, 값은 가짜)
├── config/         설정 양식 (event.example.yaml, app-policy.yaml, …)
├── docs/           사양·설계 문서와 그림 (SPEC.md, design/core-engines.md, images/)
└── workspace/      내 대회 설정과 기록 (git 제외)
```

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 보세요.

## License

[MIT](LICENSE)
