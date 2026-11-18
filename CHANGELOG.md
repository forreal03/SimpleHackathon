# CHANGELOG

npm 패키지 [`simple-hackathon-ops-mcp`](https://www.npmjs.com/package/simple-hackathon-ops-mcp)의 버전별 변경 기록입니다. 버전마다 "설정 영향"을 적습니다(SPEC 18.4의 7번, REL-3). 값은 셋 가운데 하나입니다.

- **없음**: 기존 설정을 그대로 씁니다.
- **자동 변환**: 키트가 기존 설정을 새 형식으로 바꿔 줍니다.
- **수동 조치**: 운영진이 설정을 직접 고쳐야 합니다. 무엇을 고칠지 그 절에 적습니다.

## 0.2.0 (출판 전)

설정 영향: 없음

- npm 패키지가 런타임 의존성이 없는 파일 하나(`dist/index.js`)가 됩니다(M1, D1). `npx`가 처음 받는 양이 패키지 145개(7.30 MiB)에서 tarball 하나(약 417 KB)로 줄고 풀어 놓은 크기는 55.3 MiB에서 1.6 MB로 줄어듭니다.
- 번들에 들어간 라이브러리의 라이선스 전문(`THIRD_PARTY_LICENSES`)과 CycloneDX SBOM(`dist/sbom.cdx.json`)을 함께 냅니다.
- source map(`.js.map`, 0.1.0에는 29개)을 싣지 않습니다. 오류의 stack trace는 `dist/index.js`의 압축된 위치를 가리키고 함수 이름은 남습니다(SPEC 13.3).
- 도구 32개의 이름과 동작은 0.1.0과 같습니다.
- 서버가 알리는 버전을 `package.json`에서 읽습니다. 0.1.0까지는 코드에 적힌 숫자였습니다.
- 저장소 이름이 `SimpleHackathon`으로 바뀌어 패키지의 저장소·이슈 링크가 새 주소를 가리킵니다.

## 0.1.0 (2026-11-09)

설정 영향: 없음(첫 판)

- 처음 공개한 판입니다. 대회용 GitHub org를 운영하는 MCP 서버이고 도구는 32개입니다.
