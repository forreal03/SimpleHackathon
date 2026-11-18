# Core engines 설계 v2 (`packages/core`)

| | |
| --- | --- |
| 상태 | **구현 계약서 v2**. SPEC v0.5에 맞춘 `packages/core`의 정확한 동작 계약입니다. v1(1차 구현, 커밋 `8600713`·`d737e54`와 리뷰 수정분)을 대체합니다. v1과 달라진 점은 14장에 모았습니다. |
| 작성일 | 2026-11-17 (2026-11-18 갱신: 검토 결과 반영, 결정 D99~D119 추가, 15.2에 처리 상태, 15.3의 남은 질문을 SPEC 19.4 Q13·Q14·Q15로 옮김) |
| 기준 | `docs/SPEC.md` v0.5: 5.6, 6장(V1~V24), 7장(7.1부터 7.6까지), 13.4, 14.2·14.7·14.8·14.9·14.11·14.12·14.13·14.16, 15.1, 16장, 부록 C·D |
| 다루는 것 | 수식 언어(파서, AST 검사, 해석기, 정적 검사·lint, 시뮬레이션), 변수, 점수(루브릭·기준 트리·단계·게이트·집계·정규화·진출·최종 점수), 가산점, 순위·동점·상 배분, 결과 스냅샷과 공개 결과, 조건 언어·신청 자격·신청서 질문·부문, 일정 판정(마감·투표 창·팀별 연장), 설정 v2(스키마·JSON Schema·상속·병합·정규화·locked key·preset), add-on 레지스트리, 검증 규칙 V1~V24, `_config`·`event.json` 생성, CLI(check, build, plan, export --dev), 예제, 테스트 |
| 다루지 않는 것 | 범용 백엔드(Apps Script), 참가자 사이트, MCP 도구의 구현. 다만 core가 그쪽에 넘기는 데이터는 여기서 정합니다: `_config`·`event.json`(11장), 원점수 행(4.3), 결과 스냅샷과 공개 결과(6.9, 6.10), 추가 확정 데이터(9.4), 부문 고정 기록(7.6), 참가자용 문장 틀(7.7). RES-10 내보내기(Devpost 호환 CSV, 원점수·판정 로그)는 MCP `export`가 원점수 행, 부문 고정 기록, 결과 스냅샷으로 만들고 그 열 정의는 core가 정하지 않습니다. |

**읽는 법.** 우선순위는 SPEC > 이 문서 > 코드입니다. 이 문서와 다르게 구현해야 할 이유가 생기면 코드보다 이 문서를 먼저 고칩니다. SPEC이 정하지 않아 이 문서가 정한 것은 본문에 **[D번호]** 로 표시하고 15.1에 모았습니다. SPEC과 맞지 않거나 모호한 곳은 15.2에 있고 행마다 처리 상태(SPEC에 반영함, 소유자 질문, M3 이후, 문제 아님)를 적었습니다. 소유자 확인이 필요한 것은 15.3에, 질문 본문은 SPEC 19.4에 있습니다. "반드시"는 MUST, "해도 됩니다"는 MAY입니다.

---

## 0. 원칙과 표기

### 0.1 원칙

1. **판정 로직의 원본은 하나입니다.** 점수, 순위, 상, 부문, 자격, 일정, 수식 해석은 `src/runtime/`에만 있습니다. 같은 소스에서 두 번들을 만듭니다(1.2). 점수·순위·상 배분은 MCP(Node)가 한 곳에서 계산합니다(SPEC 7.5). 부문 판정·자격·입력 검사·마감 판정은 백엔드가 권위 있게 하고 사이트는 미리보기만 합니다. 백엔드와 사이트가 판정에 쓰는 규칙(팀의 실효 루브릭 고르기, 트랙별 마감·투표 창, 시각 해석)도 rules 번들의 함수로 두어 다른 곳에서 다시 구현하지 않게 합니다.
2. **`src/runtime/`은 플랫폼에 묶이지 않은 ES2019입니다.** `node:*`, `process`, `Buffer`, `globalThis`, `require`, 동적 `import()`, zod, yaml을 쓰지 않습니다. 표준 라이브러리도 ES2019까지만 씁니다. `Object.hasOwn`, `Object.groupBy`, `Array.prototype.at`·`findLast`·`findLastIndex`·`toSorted`·`toReversed`·`toSpliced`·`with`, `String.prototype.replaceAll`·`matchAll`·`at`, `Promise.allSettled`·`any`, `BigInt`, `WeakRef`는 쓰지 않습니다(Apps Script의 ES 수준은 문서에 없음, SPEC 7.5·U15). 문법은 esbuild가 낮추지만 내장 함수는 낮추지 않기 때문입니다. `eval`, `new Function`, `with`, 동적 property 접근(0.1 #9)을 쓰지 않습니다. 시계(`Date.now`, `new Date()`), 난수(`Math.random`), `Intl`, `localeCompare`도 마찬가지입니다. 시각 문자열은 `isoToMs`(0.2)로만 해석합니다. 설정에서 온 문자열로 `RegExp`를 만들지 않습니다(키트 코드에 고정된 선형 정규식만 씁니다). 소스는 `runtime-guard.test.ts`(13.1), 번들은 ES2019 표면의 `vm` context(13.3)가 확인합니다.
3. **설정은 데이터입니다.** 수식은 AST로만 해석하고 조건은 정해진 연산자만 씁니다. 사용자가 적은 글자가 코드로 실행되는 경로는 없습니다.
4. **JSON 데이터 모양은 모두 snake_case입니다.** 설정 YAML, 정규형 설정(`NormalizedConfig`), `_config`, `event.json`, 결과와 스냅샷이 같은 키 이름을 씁니다. v1의 camelCase runtime 모양(`ScoringConfig`, `teamRule`)과 어댑터(`trackDivisionSpec`, `prizesByTrack`)는 없앱니다 **[D2]**. TypeScript의 함수·지역 변수 이름은 camelCase입니다.
5. **메시지는 한국어 평서문이고, 누가 읽는지에 따라 만드는 곳이 다릅니다** **[D84]**. 운영진이 읽는 것(검증 진단, 결과 경고, AST 검사, `EngineError`)은 core가 한국어 문장으로 만듭니다. 문구 틀은 `src/messages.ts`(Node)와 `src/runtime/messages.ts`(runtime, 데이터만)에 둡니다. 참가자와 심사위원이 사이트에서 읽는 것(부문 근거, 신청서 오류, 점수 입력 오류)은 runtime이 코드와 인자만 돌려주고, 사이트 i18n과 MCP가 core의 문장 틀 `src/i18n/rules.ko.json`·`rules.en.json`(7.7)으로 문장을 만듭니다. 언어별 사이트(SITE-12)에서 같은 판정을 같은 틀로 보여 주기 위해서입니다. 문장은 "~입니다/~합니다"로 쓰고, 무엇이 틀렸는지, 어디인지(설정 경로나 "N번째 글자 근처"), 어떻게 고치는지를 담습니다. 다른 사람의 입력값, 이메일, 비밀 값은 메시지에 넣지 않습니다. 코드 식별자와 주석은 영어입니다.
6. **결정적입니다.** 같은 입력이면 같은 출력(같은 JSON 바이트)입니다. 입력 배열의 순서가 달라도 결과는 같습니다. 원점수 행은 `seq`(4.3)로, 결정과 경고는 정해진 키(6.3, 6.8)로 정렬합니다. 합산 순서, 정렬 비교자, 반올림, 표준편차 정의를 이 문서가 고정합니다(4.11).
7. **새 의존성은 없습니다.** runtime 의존성은 `yaml`, `zod`(Node 쪽만)이고 빌드 도구는 `esbuild`입니다.
8. **실패 방식은 셋입니다.** 설정의 문제는 `check`가 `Diagnostic`으로 돌려줍니다. runtime이 계약과 다른 데이터(손으로 조작한 AST, 모양이 틀린 조건, 중복 팀 id, 겹친 `seq`)를 받으면 `EngineError`를 던집니다. 점수 입력 데이터의 문제(범위 밖 점수, 모르는 팀의 행)는 던지지 않고 결과 경고로 남깁니다.
9. **사용자·설정 문자열을 객체 키로 다루는 규칙은 runtime과 Node 모두에 적용합니다** **[D86]**. 그런 문자열로 객체를 읽을 때는 자기 속성 검사(`hasOwn` 헬퍼)만 쓰고 `in`이나 `!== undefined`로 확인하지 않습니다. 그런 문자열을 키로 쓰는 객체는 `Map`이나 `Object.create(null)`로 만들고 YAML·JSON에서 온 `__proto__` 키는 `defineProperty`로 둡니다. 출력 JSON에서 팀 id를 키로 하는 모양은 쓰지 않고 `{ team, … }[]` 배열로 냅니다. id와 key 자체도 0.2의 금지 이름을 쓸 수 없습니다.

### 0.2 표기

| 표기 | 뜻 |
| --- | --- |
| `Iso` | UTC 오프셋이나 `Z`가 붙은 ISO 8601 시각 문자열. 정규식 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z\|[+-]\d{2}:\d{2})$`이고 달력에 있는 날짜, 시는 00부터 23까지, 분·초는 00부터 59까지, 오프셋 ±23:59 이내여야 합니다(V1). 밀리초는 ECMA-262의 날짜 형식처럼 세 자리만 받습니다. 정규형(`_config`, `event.json`)은 모든 시각을 `YYYY-MM-DDTHH:mm:ss±HH:mm`으로 바꿉니다: 초를 채우고, `Z`는 `+00:00`으로, 밀리초는 0이 아닐 때만 `.sss`로 씁니다 **[D87]**. |
| `isoToMs(iso)` | `Iso`를 UTC epoch 밀리초로 바꾸는 runtime 함수. `Date`를 쓰지 않고 정수로 계산합니다(날짜는 days-from-civil 공식). 규칙을 어긴 문자열은 `E_INPUT`입니다. V1, 백엔드의 마감 판정, `trackWindows`가 모두 이 함수로 시각을 비교합니다(`test/vectors/time.json`) **[D87]**. |
| `Localized` | `string` 또는 `{ ko?: string, en?: string }`(키가 하나 이상, 값은 빈 문자열이 아님). 8.2 |
| `Lang` | `"ko" \| "en"` |
| `Ident` | 수식 이름 마디 규칙 `^[a-z_][a-z0-9_]*$`, 32자 이하, 예약어·금지 이름 아님(2.2) |
| `TrackId`, `DivisionId` | `^[A-Za-z][A-Za-z0-9_-]{0,31}$`(v1과 같음, `/` 금지)이고 아래 금지 이름이 아님 |
| 금지 이름 | 키가 되는 모든 id·key(트랙·부문·가산점·루브릭·단계·상·사다리 id, 질문·동의·증빙 key, add-on id, 맵 키인 `site.strings`의 i18n key와 `addons.upload.kinds`의 id)는 자기 형식 규칙에 더해 `__`로 시작하지 않고 `constructor`, `prototype`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`이 아니어야 합니다(SCHEMA). 표는 `runtime/util.ts`의 `FORBIDDEN_KEYS`입니다. 수식 이름의 금지 마디(2.2, D3)와는 다른 표입니다 **[D86]** |
| 팀·사람 id | 팀 id, 심사위원 id, 팀원 id(`TeamMember.id`), 운영자 id(`DecisionMeta.by`): `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`이고 금지 이름이 아님. runtime 입력에서 어기면 `E_INPUT`입니다. `@`와 `.`을 받지 않으므로 이메일은 id가 될 수 없습니다 **[D86]** |
| 코드줄 | 앞뒤 공백을 지운 뒤 비어 있지 않고 `//`, `/*`, `*`로 시작하지 않는 줄. 크기 예산(12장)은 코드줄로 잽니다. |
| pool | 순위를 매기는 팀 묶음(6.1). 키는 `*`, `<track>`, `<track>/<division>` 등 |
| 장소(place) | 한 팀에 적용되는 설정을 정하는 `{ track, division }` 쌍(`Place`) |
| 장소 목록 | 설정이 정상적으로 쓰이는 장소 전부입니다. 트랙 id 오름차순으로, 부문이 없는 트랙은 `(track, null)` 하나, 부문이 있는 트랙은 그 트랙 `divisions` 순서의 `(track, d)`들입니다. 부문이 있는 트랙의 `(track, null)`은 넣지 않습니다. 그 장소는 부문이 정해지지 않은 팀(D78)에만 생기고 그런 팀은 결과 공개를 막는 상태라 6.8의 별도 규칙으로 다룹니다. V4, 빌드(11.1), `loadConfigTab`(11.2), pool의 비교 설정(6.1)이 이 목록 하나를 씁니다. 4.2의 1차 형식 변환만 이 목록에 부문 트랙의 `(track, null)`을 더해 씁니다 **[D116]** |
| 위 층, 아래 층 | 위 층은 `extends`로 가리키는 부모(preset, profile)이고 아래 층은 그것을 `extends`하는 자식(event)입니다. 값은 아래 층이 위 층을 덮어씁니다(SPEC 5.6). 병합 순서로 말할 때는 "앞 층"(먼저 병합)과 "뒤 층"(나중에 병합)이라고 씁니다 |

---

## 1. 패키지 구조, 번들, 공개 API

### 1.1 폴더

```
packages/core/
├── package.json            name "@simple-hackathon/core", private, type module, engines node >=22.13
│                           bin { "simple-hackathon": "dist/cli.js" }
│                           scripts: build = tsc + build-runtime.mjs + copy-presets.mjs, typecheck, test, smoke
├── scripts/
│   ├── build-runtime.mjs   두 번들(1.2)을 만듭니다
│   ├── copy-presets.mjs    src/config/presets, src/i18n → dist/
│   └── smoke.mjs           빌드된 CLI와 번들 확인(13.8)
├── src/
│   ├── index.ts            Node 공개 API(1.3)
│   ├── messages.ts         Node 쪽 문구(검증 규칙, CLI, BuildError)
│   ├── describe.ts         describeDivision, describeFieldError, describeScoreEntry(7.7, MCP용 문장)
│   ├── estimate.ts         estimateJudges(4.1)
│   ├── i18n/               rules.ko.json, rules.en.json: 참가자용 문장 틀(데이터, 7.7)
│   ├── runtime/            ES2019, 플랫폼 의존 없음
│   │   ├── types.ts        모든 JSON 모양(타입만)
│   │   ├── messages.ts     운영진용 문구 틀(데이터만: 결과 경고, AST 검사, EngineError)
│   │   ├── util.ts         hasOwn, compareIds, roundHalfAway, mean, popSd, onStep, decimalsOf, fmt, isoToMs, FORBIDDEN_KEYS
│   │   ├── errors.ts       EngineError
│   │   ├── formula/ast.ts      연산자·함수·한도·수식 이름의 금지 마디 표(D3), sameAst(6.1)
│   │   ├── formula/validate.ts validateAst
│   │   ├── formula/evaluate.ts evaluate
│   │   ├── config-shape.ts readConfigShape(11.2)
│   │   ├── schedule.ts     trackWindows(8.3)
│   │   ├── variables.ts    variableSet(3장)
│   │   ├── conditions.ts   evaluateCondition(7.1~7.3)
│   │   ├── divisions.ts    teamRuleHolds, resolveDivision, freezeDivision, divisionNeedsReview(7.4~7.6)
│   │   ├── intake.ts       validateApplication, validateSubmission, checkFormat, checkApplicantEligibility(7.8~7.11)
│   │   ├── rubric.ts       maxTotal, criterionMax, effectiveWeights, stageSettings, judgeTotal, checkScoreEntry(4.1, 4.12)
│   │   ├── scoring.ts      scoreStage, computeBonuses: 행 정리, 채점표, 정규화, 집계, 게이트, 가산점, 진출(4장, 5장)
│   │   ├── final.ts        finalSettings, 최종 점수, pool 비교 설정, 득표 통계(4.9, 6.1, 3.4)
│   │   ├── ranking.ts      rankEntries, 동점 추적(6.2~6.3)
│   │   ├── prizes.ts       allocatePrizes(6.4~6.6)
│   │   ├── results.ts      computeResults(6.8), readConfigTab(11.2)
│   │   ├── selftest.ts     selfTest()(1.2)
│   │   ├── selftest-vectors.ts  selfTest의 고정 벡터(데이터만, 13.1 runtime-guard의 예외 파일)
│   │   ├── rules.ts        rules 번들 entry
│   │   └── index.ts        engine 번들 entry(runtime 전부)
│   ├── formula/            Node 전용
│   │   ├── parse.ts        토크나이저 + 재귀 하강 파서 → compileFormula
│   │   ├── diagnose.ts     이름 해석(unavailable 이유), 가까운 이름 조회, spans
│   │   ├── suggest.ts      suggestName(OSA 거리)
│   │   ├── lint.ts         범위 분석과 lint
│   │   ├── simulate.ts     simulateFormula
│   │   └── reference.ts    formulaReference()
│   ├── config/
│   │   ├── schema.ts       zod 스키마: layerSchema(층 파일), ResolvedConfig, configJsonSchema()(8.9)
│   │   ├── normalize.ts    층마다 이름 별명·최종 키 옮기기, 병합 뒤 축약형·상금표 변환(8.6)
│   │   ├── merge.ts, locked.ts
│   │   ├── load.ts         loadConfig, resolveLayers, loadPresetLayer, listPresets(8.4, 8.8)
│   │   ├── migrate.ts      migrateV010(11.6)
│   │   ├── check/          index.ts + schedule.ts(V1) tracks.ts(V2·V5·V6) scoring.ts(V3·V4·V17·V18·V20)
│   │   │                   privacy.ts(V7·V21) secrets.ts(V8·V23) intake.ts(V10·V11·V15·V16·V24)
│   │   │                   addons.ts(V14) prizes.ts(V19) images.ts(V22)
│   │   └── presets/        *.yaml(8.8)
│   ├── addons/registry.ts  9장
│   ├── build/
│   │   ├── compile.ts      normalizeShape, buildNormalizedConfig: ResolvedConfig → NormalizedConfig(11.1)
│   │   ├── projection.ts   buildConfigTab, buildEventJson, publicProjection, loadConfigTab, stageLockFingerprint, hashOf, canonical(11.2~11.4, 10.3)
│   │   ├── diff.ts         diffConfigs, planHash(11.5)
│   │   └── export-dev.ts   exportDevLayout(11.5)
│   ├── results/
│   │   ├── snapshot.ts     buildResultsSnapshot(6.9)
│   │   └── public.ts       publicResults(6.10)
│   └── cli.ts              11.5
└── test/                   13장
```

### 1.2 두 번들

| 번들 | entry | 전역 | 담는 것 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| `dist/rules.gs.js` | `src/runtime/rules.ts` | `SHK` | conditions, divisions, intake(`validateApplication`, `validateSubmission` 포함), rubric(`maxTotal`, `criterionMax`, `stageSettings`, `judgeTotal`, `checkScoreEntry`), `trackWindows`, `isoToMs`, `roundHalfAway`, `readConfigShape`, `selfTest` | 백엔드 `Rules.gs` |
| `dist/rules.min.js` | 같음 | `SHK` | 위와 같은 코드를 `minify: true`로 한 번 더 빌드한 사본 | 사이트 `kit/<버전>/rules.js` |
| `dist/engine.gs.js` | `src/runtime/index.ts` | `SHK_ENGINE` | runtime 전부(위 + 수식, 변수, 점수, 순위, 상, 결과) | parity 테스트(13.3), 다른 JS 호스트에서 쓸 때 |

- 모두 esbuild `format: "iife"`, `target: "es2019"`, `platform: "neutral"`, `charset: "utf8"`, `absWorkingDir: <package>`이고 첫 줄은 `// @simple-hackathon/core <rules|engine> v<버전>. Generated from src/runtime by scripts/build-runtime.mjs; do not edit.`입니다. `rules.gs.js`와 `engine.gs.js`는 minify하지 않습니다. 백엔드 편집기에서 사람이 읽을 수 있고, 배포된 코드를 sha256으로 키트 릴리스와 대조할 때(SPEC BE-8) 같은 파일이어야 하기 때문입니다.
- **사이트 사본** **[D115]**: 사이트의 홈은 "지금" 띠(SPEC 11.2)를 그리려고 첫 화면에서 `trackWindows`와 `isoToMs`를 부르므로 `rules.js`가 첫 화면 크기에 듭니다. 그래서 사이트에는 minify한 `dist/rules.min.js`를 싣고 `budget.test.ts`가 그 gzip 크기를 10,000 B 이하로 막습니다(12장). 이 파일은 SPEC 11.6의 "사이트 core JS 1,200줄, 45 KB"(사이트 자신의 코드)에는 넣지 않고 "첫 화면 100 KB, gzip 35 KB"에는 넣습니다. 사이트 예산 표에는 사이트를 만드는 M3에서 이 줄을 더합니다(15.2).
- 백엔드는 점수를 계산하지 않으므로 수식 엔진이 rules 번들에 들어가지 않습니다 **[D1]**. 대신 백엔드와 심사 화면이 쓰는 규칙(실효 루브릭 `stageSettings`, 트랙별 마감·투표 창 `trackWindows`, 시각 해석 `isoToMs`)과 `_config` 모양 확인(`readConfigShape`)은 rules 번들에 있습니다. engine 번들은 보험입니다. 이 번들로 runtime 전체가 빈 `vm` context(ES2019, Node 전역 없음)에서 Node와 같은 결과를 내는지 확인합니다.
- `selfTest(): { ok: boolean; failures: string[] }`는 번들 안에 고정된 작은 벡터(조건 6개, `roundHalfAway` 6개, `isoToMs` 2개, `judgeTotal` 2개, `stageSettings` 덮어쓰기 1개, `trackWindows` 1개, `validateApplication` 2개, `validateSubmission` 1개)를 돌립니다. 벡터는 데이터만 담은 `runtime/selftest-vectors.ts`에 두고 `selftest.ts`는 그것을 돌리는 코드만 둡니다. 벡터에는 ISO 시각 문자열이 들어가므로 runtime-guard의 시각 검사(13.1)가 이 파일 하나만 이름으로 예외로 두도록 이렇게 나눕니다. 백엔드가 배포 직후 부릅니다(SPEC 7.5, U15) **[D71]**.
- v1의 `dist/runtime.gs.js`는 없앱니다.

### 1.3 공개 API

**runtime**(Node에서는 `@simple-hackathon/core`에서, 번들에서는 전역에서):

| 함수 | 어디 | 장 |
| --- | --- | --- |
| `validateAst(ast: unknown, allowed?: VariableSet \| readonly string[]): AstCheck` | engine | 2.5 |
| `evaluate(ast: Ast, vars: FormulaVars): Evaluation` | engine | 2.6 |
| `roundHalfAway(x: number, digits: number): number` | 둘 다 | 2.7 |
| `isoToMs(iso: string): number` | 둘 다 | 0.2 |
| `variableSet(config: NormalizedConfig \| ShapeConfig, at: VariableAt): VariableSet` | engine | 3.2 |
| `evaluateCondition(cond: Cond, person: Person): CondResult` | 둘 다 | 7.1 |
| `checkApplicantEligibility(rules: EligibilityRule[], person: Person): EligibilityResult` | 둘 다 | 7.9 |
| `teamRuleHolds(rule: TeamRule, when: Cond, members: TeamMember[]): QuantifierResult` | 둘 다 | 7.4 |
| `resolveDivision(input: DivisionInput): DivisionResult` | 둘 다 | 7.5 |
| `freezeDivision(input: DivisionInput, as_of: DivisionAsOf, at: Iso, rule_revision: number): DivisionRecord` | 둘 다 | 7.6 |
| `divisionNeedsReview(record: DivisionRecord, input: DivisionInput): DivisionReview` | 둘 다 | 7.6 |
| `validateApplication(intake: PublicIntake, input: ApplicationInput): ApplicationCheck` | 둘 다 | 7.10 |
| `validateSubmission(submit: PublicSubmit, prizes: readonly PrizeRef[], input: SubmissionInput): SubmissionCheck` | 둘 다 | 7.11 |
| `checkFormat(preset: FormatPreset, text: string): boolean` | 둘 다 | 7.8 |
| `maxTotal(rubric: NRubric): number`, `criterionMax(node: NCriterion, rubric: NRubric): number`, `effectiveWeights(rubric: NRubric): EffectiveWeight[]` | 둘 다(effectiveWeights는 engine) | 4.1 |
| `stageSettings(scoring: StageSettingsInput, stage: string, place: Place): StageSettings` | 둘 다 | 4.12 |
| `judgeTotal(rubric: NRubric, values: Record<string, number \| null>): JudgeTotal` | 둘 다 | 4.12 |
| `checkScoreEntry(rubric: NRubric, criterion: string, value: unknown): ScoreEntryCheck` | 둘 다 | 4.12 |
| `trackWindows(source: ScheduleSource, track: string, team?: string \| null): TrackWindows` | 둘 다 | 8.3 |
| `readConfigShape(json: unknown): NormalizedConfig` | 둘 다 | 11.2 |
| `finalSettings(scoring: NScoring, place: Place): FinalSettings` | engine | 4.1 |
| `computeBonuses(config: NormalizedConfig, stage: string, team: TeamInput): BonusResult` | engine | 5 |
| `scoreStage(config: NormalizedConfig, stage: string, entrants: TeamInput[], input: StageInput): StageResult` | engine | 4.4 |
| `rankEntries(pool: string, entries: RankInput[], decisions: Decision[], tie_break_sources: string[]): RankOutcome` | engine | 6.2 |
| `allocatePrizes(config: NormalizedConfig, ctx: PrizeContext): PrizeAllocation` | engine | 6.6 |
| `computeResults(config: NormalizedConfig, input: ResultsInput): ResultsComputation` | engine | 6.8 |
| `readConfigTab(json: unknown): NormalizedConfig` | engine | 11.2 |
| `selfTest()` | 둘 다(engine 번들은 runtime 전부를 담으므로) | 1.2 |
| 표: `LIMITS`, `FUNCTIONS`, `RESERVED_WORDS`, `FORBIDDEN_KEYS`, `COND_OPS`, `TEAM_RULES`, `FORMAT_PRESETS` | 둘 다(수식 표는 engine) | |

**Node 전용**:

| 함수 | 장 |
| --- | --- |
| `compileFormula(source: string, vars: VariableSet): CompileResult` | 2.8 |
| `lintFormula(ast: Ast, ctx: LintContext): LintFinding[]` | 2.10 |
| `simulateFormula(formula: Formula, ctx: SimulationContext): SimulationResult[]` | 2.11 |
| `suggestName(name: string, candidates: readonly string[]): string \| null` | 2.9 |
| `formulaReference(): FormulaReference` | 2.12 |
| `loadConfig(file: string, options?: LoadOptions): LoadResult`, `resolveLayers(layers: RawLayer[]): LoadResult`, `loadPresetLayer(ref: string): { layer: RawLayer \| null; diagnostics: Diagnostic[] }` | 8.4 |
| `merge(base, over, path?)`, `listKeyAt(path)` | 8.5 |
| `normalizeLayer(data: unknown, base: unknown, file: string \| null): NormalizeResult`, `normalizeMerged(data: unknown): NormalizeResult` | 8.6 |
| `parseResolved(data: unknown): { config: ResolvedConfig \| null; diagnostics: Diagnostic[] }` | 8.1 |
| `migrateV010(text: string): { yaml: string \| null; diagnostics: Diagnostic[] }` | 11.6 |
| `configJsonSchema(): object` | 8.9 |
| `lockedKeys()`, `checkLockedKeys(layers)` | 8.7 |
| `listPresets(): PresetInfo[]` | 8.8 |
| `checkConfig(resolved: ResolvedConfig, ctx: CheckContext): Diagnostic[]`, `checkFile(file, options?): CheckedFile` | 10장 |
| `listAddons()`, `findAddon(id)`, `addonEnabled(config, id)`, `addonShipped(id, kit_version)`, `addonCatalog()`, `addonConfirmation(before, after, id)`, `addonChanges(before, after)` | 9장 |
| `normalizeShape(resolved): ShapeConfig`, `buildNormalizedConfig(resolved): NormalizedConfig`, `buildConfigTab(resolved, { revision })`, `buildEventJson(resolved, { revision })`, `publicProjection(config, revision?)`, `loadConfigTab(json)`, `hashOf(value)`, `canonical(value)`, `stageLockFingerprint(config, stage)` | 11장, V20 |
| `diffConfigs(before: NormalizedConfig \| null, after: NormalizedConfig): JsonPatchOp[]`, `planHash(plan: PlanFile): string`, `exportDevLayout(layers: RawLayer[]): { path: string; text: string }[]` | 11.5 |
| `buildResultsSnapshot(config, input, computation, meta: SnapshotMeta): ResultsSnapshot` | 6.9 |
| `publicResults(snapshot: ResultsSnapshot, options: PublicOptions): PublicResults` | 6.10 |
| `describeDivision(result, lang)`, `describeFieldError(error, field, lang)`, `describeScoreEntry(check, lang)` | 7.7 |
| `estimateJudges({ projects, per_project, minutes_per_project, total_minutes }): number`(모두 정수) | 4.1 |
| `runCli(argv: readonly string[]): Promise<number>` | 11.5 |

### 1.4 오류 모델

```ts
// runtime/errors.ts
export type EngineErrorCode =
  | "E_AST_INVALID"     // validateAst가 거절한 AST를 해석하려 함, 원문과 다른 AST(loadConfigTab)
  | "E_VAR_MISSING"     // 해석할 때 변수 값이 없거나 숫자가 아님(엔진 버그)
  | "E_COND_MALFORMED"  // 조건 모양이 틀림(모르는 op, matches 포함)
  | "E_COND_LIMIT"      // 조건 깊이·크기 한도 초과(7.1)
  | "E_CONFIG"          // 정규형 설정 안의 참조가 깨짐(없는 루브릭·단계), _config 모양이 틀림
  | "E_INPUT";          // 입력 모양이 틀림(팀 id 규칙·중복, 겹친 seq, 배열이 아님, 한도 초과)
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly detail: string[];        // 위치와 이유(한국어). 입력값은 담지 않음
}
```

`detail`은 위치(설정 경로나 입력 경로)와 이유 문장을 차례로 담습니다. 테스트가 이유를 문장 대신 코드로 확인해야 하면 이유 문장 앞에 코드를 한 항목으로 둡니다. 지금 그런 코드는 `F_SOURCE_MISMATCH` 하나입니다. `loadConfigTab`(11.2)이 식 원문을 다시 컴파일한 AST가 저장된 AST와 다를 때 `E_AST_INVALID`의 `detail`을 `[식 칸 경로, "F_SOURCE_MISMATCH", "식 원문을 다시 컴파일한 결과가 저장된 AST와 다릅니다."]`로 씁니다.

열리지 않은 부문을 가리키는 부문 덮어쓰기는 오류 코드로 던지지 않고 판정 결과(`OVERRIDE_NOT_OPEN`)로 돌려줍니다(7.5).

`Diagnostic`(Node, 10장)은 아래 모양입니다.

```ts
export type RuleId = `V${number}` | "YAML" | "SCHEMA" | "MERGE" | "DEPRECATED";
export interface Diagnostic {
  id: RuleId;                 // "V4"
  code?: string;              // 세부 코드: "F_UNKNOWN_NAME", "ZERO_DENOMINATOR", "PRESET_ENABLES_ADDON"
  severity: "error" | "warning" | "info";
  path: string;               // 사용자가 적은 설정 경로("scoring.formula"). V8 ①은 "<파일>:<줄>"
  message: string;            // 무엇이 틀렸는지(한국어)
  fix?: string;               // 고칠 방법(한국어). 오류에는 반드시 있음(10.2의 "고칠 방법" 열)
  source?: { file: string; line: number };  // 알 수 있으면(8.4)
}
```

---

## 2. 수식 언어

SPEC 7.3, 7.6 #1~4·#10. 수식은 최종 점수(`scoring.final.formula`, 축약형 `scoring.formula`), 동점 사다리(`tie_break`), 덮어쓰기(`final.overrides[].formula/tie_break`), 식 방식의 상(`prizes[].formula`)에 씁니다.

### 2.1 문법

```
formula := expr
expr    := or
or      := and ( "or" and )*
and     := not ( "and" not )*
not     := "not" not | cmp
cmp     := add ( CMP add )?              # a < b < c 는 오류(F_CMP_CHAIN)
CMP     := "<" | "<=" | ">" | ">=" | "==" | "!="
add     := mul ( ( "+" | "-" ) mul )*
mul     := unary ( ( "*" | "/" ) unary )*
unary   := "-" unary | pow               # "-" 바로 뒤가 괄호 없는 a^b면 오류(F_NEG_POW)
pow     := primary ( "^" EXP )?          # a^b 뒤에 "^"가 또 오면 오류(F_POW_CHAIN)
EXP     := 글자가 정확히 "0" | "1" | "2" | "3" | "4"인 NUMBER 토큰   # 아니면 F_EXPONENT
primary := NUMBER | NAME | FUNC "(" expr ( "," expr )* ")" | "(" expr ")"
FUNC    := min | max | sum | avg | abs | sqrt | round | floor | ceil | clamp | if
NAME    := IDENT ( "." IDENT ){0,2}
IDENT   := [a-z_][a-z0-9_]*              # 예약어·금지 이름이 아님(2.2)
NUMBER  := [0-9]+ ( "." [0-9]+ )?        # |값| ≤ 1e9
```

- 파서는 이 문법을 그대로 옮긴 재귀 하강 파서입니다. v1의 Pratt parser는 `^`의 결합 없음과 `-a^b` 규칙을 표현하기 어려워 바꿉니다.
- `NAME` 바로 뒤에 `(`가 오면 함수 호출이고 아니면 변수입니다. 함수 이름을 괄호 없이 쓰면(`sqrt + 1`) F_UNKNOWN_NAME이고 힌트는 "함수는 sqrt(...)처럼 괄호와 함께 씁니다"입니다.
- `-a^b` 규칙: `unary`가 `"-"`를 읽은 뒤 피연산자가 **괄호로 감싸지 않은 `pow`이면서 `^`가 있는 것**이면 F_NEG_POW입니다. `-(a^2)`, `(-a)^2`, `-a`는 허용하고 `-(a)^2`는 `(a)^2`가 괄호로 감싸지 않은 pow라서 오류입니다. `- -a^2`는 안쪽 `-`에서 오류가 납니다.
- `a^2^2`는 F_POW_CHAIN, `(a^2)^2`는 허용합니다. `a < b < c`, `a == b != c`는 F_CMP_CHAIN, `(a < b) < c`는 허용합니다.
- `not`은 `not` 자리에서만 씁니다. `1 + not 0`, `-not 1`, `1 < not 0`은 F_NOT_PLACEMENT, `1 and not 0`, `not not 1`, `(not 1) + 1`, `if(not x, 1, 2)`는 허용합니다.

| 식 | 결과 |
| --- | --- |
| `2^3` | 8 |
| `2^3^2` | F_POW_CHAIN |
| `(2^3)^2` | 64 |
| `-2^2` | F_NEG_POW |
| `-(2^2)`, `(-2)^2` | -4, 4 |
| `2^-1`, `2^0.5`, `2^x`, `2^(2)`, `2^5`, `2^02` | F_EXPONENT |
| `1 < 2 < 3` | F_CMP_CHAIN |
| `0.85 * judge + if(avg_votes > 0, 15 * sqrt(min(1, votes / (2 * avg_votes))), 0)` | 허용(부록 C) |

### 2.2 토큰

| 토큰 | 규칙 | 틀리면 |
| --- | --- | --- |
| 공백 | `" "`, `\t`, `\n`, `\r`만. 버립니다. | 다른 공백 문자(전각 공백 등)는 F_CHAR |
| NUMBER | `[0-9]+(\.[0-9]+)?`. 값은 `Number(글자)`. 바로 뒤에 `[A-Za-z_.]`가 오면 오류 | `1.` "소수점 뒤에 숫자", `.5` "0.5처럼", `1e5`·`0x1F`·`2x`·`1_000` "숫자 바로 뒤에 글자", `1.5.2` "소수점은 한 번": 모두 F_NUMBER. 절댓값이 1e9보다 크면 F_NUMBER_LIMIT |
| NAME | `[a-z_][a-z0-9_]*`를 `.`으로 이은 1~3마디, 전체 100자 이하 | 대문자: F_NAME_CASE(`[A-Za-z0-9_.]` 연속 구간을 보여 주고 소문자로 바꾼 이름이 허용 목록에 있으면 제안). 4마디 이상, 빈 마디(`crit.`, `a..b`), 101자 이상: F_NAME_SEGMENTS |
| KEYWORD | 한 마디짜리 NAME이 `and`, `or`, `not`이면 키워드 | 여러 마디 안의 예약어(`crit.and`): F_RESERVED |
| 금지 이름 | 어느 마디든 `__`로 시작하거나 `constructor`, `prototype`이면 거절 | F_FORBIDDEN_NAME(토크나이저에서) **[D3]** |
| OP | `<=`, `>=`, `==`, `!=`, `<`, `>`, `+`, `-`, `*`, `/`, `^`(긴 것 먼저) | |
| 문장 부호 | `(`, `)`, `,` | |
| 그 밖 | | F_CHAR. 힌트: `=` "같은지 비교는 ==", `!` "부정은 not, 다름은 !=", `&` "그리고는 and", `\|` "또는은 or", `%` "나머지 연산은 없습니다". 파서가 `*` 바로 뒤의 `*`를 만나면 F_EXPECTED_VALUE에 "거듭제곱은 ^로 적습니다" 힌트 |

함수 이름(`min` 등)은 예약어가 아닙니다. 변수 목록에 같은 이름이 없으므로 변수로 쓰면 F_UNKNOWN_NAME입니다.

### 2.3 한도와 검사 시점

| 한도 | 값 | 파서(Node) | validateAst(runtime) |
| --- | --- | --- | --- |
| 길이 | 500 UTF-16 code unit | 토큰을 자르기 전에 F_TOO_LONG | 없음(AST에는 원문이 없음) |
| 노드 | 200개 | 노드를 만들 때마다 세어 201번째에 F_NODE_LIMIT | 방문할 때 세어 201번째에 A_NODE_LIMIT, 즉시 멈춤 |
| 깊이 | 32 | ① 하위 식으로 내려가기 **전에** 중첩 수준(괄호, 함수 인자, 단항 `-`·`not`의 연쇄)을 1 올려 32를 넘으면 F_DEPTH_LIMIT ② 노드를 만들 때 AST 깊이(리터럴 하나가 1)를 계산해 32를 넘으면 F_DEPTH_LIMIT **[D4]** | 자식으로 내려가기 전에 깊이를 확인해 33이면 A_DEPTH_LIMIT, 즉시 멈춤. 호출 스택은 33단보다 깊어지지 않음 |
| 함수 인자 | 16개 | 17번째 인자를 읽기 전에 F_ARG_LIMIT | A_ARGS |
| 숫자 | `\|v\| ≤ 1e9`, 유한 | F_NUMBER_LIMIT | A_NUMBER |
| 이름 | 1~3마디, 100자 이하 | F_NAME_SEGMENTS | A_NAME |
| 지수 | 리터럴 0~4 | F_EXPONENT | A_EXPONENT |
| `round` 자릿수 | 정수 리터럴 0~6 | F_ROUND_DIGITS | A_ROUND_DIGITS |

`((((1))))`처럼 괄호만 겹쳐도 중첩 수준이 올라가므로 33겹은 F_DEPTH_LIMIT입니다. `1+1+…+1`(33항)은 AST 깊이가 33이라 F_DEPTH_LIMIT에 걸립니다. 긴 합은 `sum(...)`을 씁니다(v1과 같음). 단항 `-`·`not`의 연쇄와 함수 중첩(`abs(abs(…))`)은 연산자 하나마다 AST 깊이가 1씩 늘고 맨 안의 리터럴도 1을 차지하므로, 연산자 31개(AST 깊이 32)까지 통과하고 32개(AST 깊이 33)는 ②의 F_DEPTH_LIMIT입니다. 계열별 경계는 괄호 32/33겹, 합 32/33항, 단항 연쇄·함수 중첩 31/32개입니다.

### 2.4 AST

v1 모양을 그대로 씁니다.

```jsonc
{"k":"n","v":0.85}                      // 숫자. v는 유한, |v| ≤ 1e9
{"k":"v","n":"crit.idea"}               // 변수. n은 NAME(2.2)
{"k":"u","o":"-","a":<Ast>}             // 단항. o: "-" | "not"
{"k":"b","o":"*","a":<Ast>,"b":<Ast>}   // 이항. o: + - * / ^ < <= > >= == != and or
{"k":"c","f":"sqrt","a":[<Ast>, ...]}   // 함수. f: FUNC, a: 인자 1~16개
```

- `^` 노드의 `b`는 반드시 `{"k":"n","v":e}`이고 `e ∈ {0,1,2,3,4}`인 정수입니다.
- `round`의 두 번째 인자는 `{"k":"n","v":d}`, `d ∈ {0..6}` 정수입니다.
- 노드 객체는 자기 열거 가능 키가 정확히 위 목록과 같아야 합니다(`n`: `k,v`, `v`: `k,n`, `u`: `k,o,a`, `b`: `k,o,a,b`, `c`: `k,f,a`). 다른 키가 하나라도 있으면 A_KEYS입니다.
- 괄호는 노드를 만들지 않고, 상수 접기(constant folding)를 하지 않습니다. `-2`는 `{"k":"u","o":"-","a":{"k":"n","v":2}}`입니다.
- 컴파일된 식은 `Formula = { source: string; ast: Ast }`로 다닙니다. `_config`에는 둘 다, `event.json`에는 `source`만 들어갑니다(11.3) **[D63]**.

부록 C의 식(가드 포함)은 아래 AST가 됩니다.

```json
{"k":"b","o":"+",
 "a":{"k":"b","o":"*","a":{"k":"n","v":0.85},"b":{"k":"v","n":"judge"}},
 "b":{"k":"c","f":"if","a":[
   {"k":"b","o":">","a":{"k":"v","n":"avg_votes"},"b":{"k":"n","v":0}},
   {"k":"b","o":"*","a":{"k":"n","v":15},"b":{"k":"c","f":"sqrt","a":[
     {"k":"c","f":"min","a":[{"k":"n","v":1},
       {"k":"b","o":"/","a":{"k":"v","n":"votes"},
        "b":{"k":"b","o":"*","a":{"k":"n","v":2},"b":{"k":"v","n":"avg_votes"}}}]}]}},
   {"k":"n","v":0}]}}
```

### 2.5 `validateAst`

```ts
export type AstIssueCode =
  | "A_NOT_NODE" | "A_KEYS" | "A_KIND" | "A_NUMBER" | "A_NAME" | "A_VAR_NOT_ALLOWED"
  | "A_OP" | "A_EXPONENT" | "A_FUNC" | "A_ARGS" | "A_ARITY" | "A_ROUND_DIGITS"
  | "A_NODE_LIMIT" | "A_DEPTH_LIMIT";
export interface AstIssue { path: string; code: AstIssueCode; message: string }
export type AstCheck = { ok: true; ast: Ast } | { ok: false; errors: AstIssue[] };
export function validateAst(ast: unknown, allowed?: VariableSet | readonly string[]): AstCheck;
```

알고리즘(앞에서부터, 루트 경로 `$`, 자식은 `.a`, `.b`, `.a[i]`):

1. `visit(node, path, depth)`: 노드 수를 1 올리고 200을 넘으면 A_NODE_LIMIT를 남기고 전체를 멈춥니다. `depth > 32`면 A_DEPTH_LIMIT를 남기고 멈춥니다.
2. `node`가 `null`이 아닌 일반 객체(배열 아님)가 아니면 A_NOT_NODE.
3. `k`가 `n|v|u|b|c`가 아니면 A_KIND. 키 집합이 2.4와 다르면 A_KEYS.
4. `n`: `typeof v === "number"`, 유한, `|v| ≤ 1e9`가 아니면 A_NUMBER.
5. `v`: `n`이 문자열이고 `^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$`, 100자 이하, 마디가 예약어·금지 이름이 아니어야 합니다(아니면 A_NAME). `allowed`가 있으면 그 이름 목록 안에 있어야 합니다(아니면 A_VAR_NOT_ALLOWED). 목록 검사는 `indexOf`나 `Set.has`로만 하고 `in`을 쓰지 않습니다.
6. `u`: `o ∈ {"-","not"}`(아니면 A_OP), `visit(a)`.
7. `b`: `o`가 이항 연산자 표에 있어야 합니다(A_OP). `o === "^"`이면 `b`가 지수 노드여야 합니다(A_EXPONENT). `visit(a)`, `visit(b)`.
8. `c`: `f`가 함수 표에 있어야 하고(A_FUNC), `a`는 배열이어야 하며(A_ARGS), 길이가 16 이하(A_ARGS)이고 함수의 인자 수 범위 안(A_ARITY)이어야 합니다. `round`가 인자 2개면 두 번째가 자릿수 노드여야 합니다(A_ROUND_DIGITS). 인자를 차례로 `visit`.
9. 오류가 없으면 `{ ok: true, ast }`, 있으면 `{ ok: false, errors }`(방문 순서).

**불러올 때마다 다시 검사합니다.** `readConfigTab`(11.2)은 `_config`의 모든 수식 칸(`scoring.final.formula`, `final.tie_break[]`, `final.overrides[].formula/tie_break[]`, `prizes[].formula`)을 `allowed` 없이 검사하고 하나라도 거절되면 `EngineError("E_AST_INVALID")`를 던집니다. `computeResults`는 팀마다 해석하기 직전에 그 팀의 `variableSet`으로 다시 검사합니다. 시트를 손으로 고쳐도 허용 목록 밖의 AST는 해석되지 않습니다(SPEC 15.1). 장소 목록(0.2)의 팀이 이 검사에 걸리면 V4와 빌드를 거친 설정이 아니므로 `E_AST_INVALID`를 던집니다. 부문이 정해지지 않은 팀은 장소 목록 밖이라 V4가 그 장소를 검사하지 않았으므로, 걸려도 던지지 않고 6.8의 FORMULA_UNAVAILABLE로 다룹니다 **[D116]**.

### 2.6 의미와 `evaluate`

```ts
export type FormulaVars = Readonly<Record<string, number>>;
export type FormulaWarningCode = "DIV0" | "SQRT_NEG" | "NONFINITE";
export interface FormulaWarning { code: FormulaWarningCode; path: string }   // path: AST 경로
export interface Evaluation { value: number; warnings: FormulaWarning[] }
export function evaluate(ast: Ast, vars: FormulaVars): Evaluation;
```

`evaluate`는 먼저 `validateAst(ast)`(이름 목록 없이)를 돌리고 거절되면 `E_AST_INVALID`를 던집니다. 그다음 아래 규칙으로 해석합니다. **수치 오류(fault)** 는 그 연산의 결과를 0으로 하고 `{ code, path }`를 경고에 남긴 뒤 계속합니다. 같은 `(code, path)`는 한 번만 남기고 경고 순서는 처음 생긴 순서입니다 **[D6]**.

| 노드 | 규칙 |
| --- | --- |
| `n` | `v` |
| `v` | `hasOwn(vars, n) && typeof vars[n] === "number"`가 거짓이면 `E_VAR_MISSING`를 던집니다(엔진이 변수를 빠뜨린 버그). 값이 유한하지 않으면 fault NONFINITE. |
| `u -` | `-a` |
| `u not` | `a === 0 ? 1 : 0` |
| `b and` | `a === 0`이면 `b`를 계산하지 않고 0, 아니면 `b !== 0 ? 1 : 0` |
| `b or` | `a !== 0`이면 `b`를 계산하지 않고 1, 아니면 `b !== 0 ? 1 : 0` |
| `b + - *` | 왼쪽, 오른쪽 순서로 계산한 뒤 연산. 결과가 유한하지 않으면 fault NONFINITE |
| `b /` | 오른쪽이 `0`(또는 `-0`)이면 fault DIV0(왼쪽이 0이어도). 아니면 나누고 결과가 유한하지 않으면 fault NONFINITE |
| `b ^` | 지수 `e`에 대해 `r = 1`에서 시작해 `r = r * a`를 `e`번(왼쪽부터) 합니다. `0^0 = 1`. 결과가 유한하지 않으면 fault NONFINITE **[D5]** |
| `b < <= > >= == !=` | 1 또는 0. `==`는 `===`, `!=`는 `!==`(`-0 == 0`은 1) |
| `c if` | 조건을 계산해 0이 아니면 두 번째, 0이면 세 번째 인자만 계산 |
| `c min`, `c max` | 인자를 왼쪽부터 모두 계산. `m = x0`에서 시작해 `x < m`(max는 `x > m`)일 때만 바꿉니다 |
| `c sum`, `c avg` | 왼쪽부터 더합니다. `avg = sum / 개수`. 결과가 유한하지 않으면 fault NONFINITE |
| `c abs` | `Math.abs` |
| `c sqrt` | `x < 0`이면 fault SQRT_NEG, 아니면 `Math.sqrt(x)` |
| `c round` | `roundHalfAway(x, d)`(`d` 기본 0) |
| `c floor`, `c ceil` | `Math.floor`, `Math.ceil` |
| `c clamp` | `min(max(x, lo), hi)`. `lo > hi`면 결과는 `hi` **[D8]** |

- 모든 연산의 입력이 유한하므로 NaN은 생기지 않습니다.
- 최종 값이 `-0`이면 `0`을 돌려줍니다.
- `exp`, `log`, 실수 지수, 난수, 시각, 문자열, 사용자 함수는 없습니다. 사칙연산과 `Math.sqrt`는 ECMA-262가 정확한 반올림을 보장하므로 Node, Apps Script, 브라우저의 결과가 같습니다.

### 2.7 반올림 `roundHalfAway`

수식의 `round(x, d)`, 최종 점수와 tie_break의 `precision`, 진출 비교에 모두 이 함수를 씁니다. 값을 반올림할 때 언어 내장 반올림(`toFixed`, `Math.round` 단독)은 쓰지 않습니다(4.3 `onStep`의 `toFixed`는 반올림이 아니라 자릿수 확인이라 예외) **[D7]**.

```
roundHalfAway(x, d):          // d: 0..6 정수(아니면 EngineError E_INPUT)
  1. x가 유한하지 않으면 x를 그대로 돌려줍니다. x가 0(또는 -0)이면 0.
  2. a = |x|. a ≥ 1e15이면 x를 그대로 돌려줍니다.
  3. c = a.toPrecision(15)            // 부동소수 오차 정리: 3.4499999999999997 → "3.45000000000000"
  4. [m, e] = c를 "e"로 나눈 것(e가 없으면 0)
  5. s = Number(m + "e" + (e + d))    // 십진 문자열로 자릿수 이동(이진 곱셈 없음)
  6. r = Math.round(s)                // s ≥ 0이므로 0.5는 위로 = 0에서 먼 쪽
  7. [m2, e2] = String(r)을 "e"로 나눈 것; y = Number(m2 + "e" + (e2 − d))
  8. x < 0이면 (y === 0 ? 0 : −y), 아니면 y
```

| 입력 | 결과 | 확인하는 것 |
| --- | --- | --- |
| `round(1.005, 2)` | 1.01 | 이진 표현 오차 |
| `round(-2.5)` | -3 | 0에서 먼 쪽 |
| `round(2.675, 2)` | 2.68 | |
| `round(1.45, 1)` | 1.5 | |
| `round(-1.005, 2)` | -1.01 | |
| `round(0.03 * 7.5, 2)` | 0.23 | 계산값 0.22499999999999998을 정리(v1은 0.22) |
| `round(0.09 * 15, 1)` | 1.4 | 1.3499999999999999 정리(v1은 1.3) |
| `round(1.23456789, 6)` | 1.234568 | |
| `round(-0.4)` | 0 | `-0`을 돌려주지 않음 |
| `roundHalfAway(0.49999999999999994, 0)` | 1 | 15자리로 정리하면 0.5(의도한 동작) |
| `roundHalfAway(80.99038105676658, 2)` | 80.99 | 부록 D |
| `roundHalfAway(1.5e21, 0)` | 1.5e21 | 2단계 |

### 2.8 `compileFormula`

```ts
export interface CompileError {
  pos: number;                // 원문의 0부터 센 위치
  code: CompileErrorCode;
  message: string;            // "{pos+1}번째 글자 근처: …"로 시작(F_EMPTY, F_TOO_LONG 제외)
  suggestion?: string;        // 가까운 이름(2.9)
}
export type CompileResult =
  | { ok: true; ast: Ast; spans: Record<string, [number, number]> }   // AST 경로 → 원문 [시작, 끝)
  | { ok: false; errors: CompileError[] };
export function compileFormula(source: string, vars: VariableSet): CompileResult;
```

- 문법 오류(토큰, 괄호, 자리, 한도)는 첫 번째에서 멈춥니다. 이름·인자 수·add-on 같은 의미 오류는 모두 모읍니다. 오류는 `pos` 오름차순입니다(v1과 같음).
- 성공한 AST는 `validateAst(ast, vars)`를 다시 통과해야 합니다. 통과하지 못하면 파서 버그이므로 F_INTERNAL로 보고합니다.
- `spans`는 lint 메시지에 글자 위치를 붙이는 데만 쓰고 저장하지 않습니다.
- 파서(`formula/parse.ts`)는 문법과 한도만 봅니다. 이름 해석(3.2의 `unavailable` 이유), 가까운 이름 제안(2.9), `spans` 계산은 `formula/diagnose.ts`가 맡습니다(크기 예산, 12장).

| 코드 | 메시지(앞의 "N번째 글자 근처: " 생략) |
| --- | --- |
| F_EMPTY | 식이 비어 있습니다. |
| F_TOO_LONG | 식이 너무 깁니다. 500자까지 쓸 수 있습니다(지금 {n}자). |
| F_CHAR | 쓸 수 없는 문자 "{ch}"입니다. {hint} |
| F_NUMBER | 숫자 형식이 올바르지 않습니다. {detail} |
| F_NUMBER_LIMIT | 숫자는 절댓값 1000000000 이하만 쓸 수 있습니다. |
| F_NAME_CASE | 이름은 영문 소문자로 적습니다: "{run}". {"…"를 쓰려고 했나요?} |
| F_NAME_SEGMENTS | 이름은 점(.)으로 이은 세 마디까지, 100자까지 쓸 수 있고 점 앞뒤에는 이름이 와야 합니다: "{run}" |
| F_FORBIDDEN_NAME | 쓸 수 없는 이름 "{seg}"입니다. __로 시작하는 이름과 constructor, prototype은 쓸 수 없습니다. |
| F_RESERVED | "{word}" 앞에 값이 와야 합니다. and, or, not은 예약어라 이름으로 쓸 수 없습니다. |
| F_UNKNOWN_FUNCTION | 알 수 없는 함수 "{name}"입니다. 쓸 수 있는 함수: min, max, sum, avg, abs, sqrt, round, floor, ceil, clamp, if |
| F_UNKNOWN_NAME | "{name}"는 쓸 수 없는 변수입니다. "{제안}"을(를) 쓰려고 했나요? / 쓸 수 있는 변수: {처음 20개}{외 N개} |
| F_ADDON_OFF | "{name}"는 인기투표 add-on(popular_vote)이 켜져 있고 use: formula_input일 때만 쓸 수 있습니다. |
| F_ADDON_PLANNED | "{name}"는 준비 중인 add-on({addon})의 변수라 아직 쓸 수 없습니다. |
| F_STAGE_ORDER | "{name}"는 앞 단계의 값만 읽을 수 있습니다. {stage} 단계는 이 식보다 앞선 단계가 아닙니다. |
| F_UNAVAILABLE | "{name}"는 이 자리에서 쓸 수 없습니다. {reason} |
| F_ARITY | "{f}" 함수는 인자를 {1개 / 1개 이상 / 1~2개 / 3개} 받습니다(지금 {n}개). |
| F_ARG_LIMIT | 함수 인자는 16개까지 쓸 수 있습니다. |
| F_ROUND_DIGITS | "round" 함수의 두 번째 인자(자릿수)는 0~6 사이의 정수로 적어야 합니다. |
| F_EXPONENT | 거듭제곱(^)의 지수는 0, 1, 2, 3, 4 중 하나를 숫자로 바로 적어야 합니다. 제곱근은 sqrt(x)를 쓰세요. |
| F_POW_CHAIN | 거듭제곱(^)은 이어 쓸 수 없습니다. (a^2)^2처럼 괄호로 묶어 주세요. |
| F_NEG_POW | 괄호 없이 -a^b를 쓸 수 없습니다. -(a^b) 또는 (-a)^b로 적어 주세요. |
| F_CMP_CHAIN | 비교 연산자는 한 번에 하나만 쓸 수 있습니다. 괄호로 묶어 주세요. |
| F_NOT_PLACEMENT | "not"은 이 자리에 바로 쓸 수 없습니다. (not ...)처럼 괄호로 묶어 주세요. |
| F_PAREN | 괄호가 닫히지 않았습니다. / 여는 괄호 없이 닫는 괄호가 나왔습니다. |
| F_COMMA | 쉼표(,)는 함수 인자 사이에만 쓸 수 있습니다. / "{tok}" 앞에 쉼표(,)나 연산자가 빠졌습니다. |
| F_EXPECTED_VALUE | 식이 끝나기 전에 값(숫자, 변수, 함수, 괄호)이 하나 더 와야 합니다. / "{tok}" 앞에 값(숫자, 변수, 함수, 괄호)이 와야 합니다. |
| F_EXPECTED_OPERATOR | "{tok}" 앞에 연산자(+, -, *, /, and, or 등)가 빠졌습니다. |
| F_NODE_LIMIT | 식이 너무 복잡합니다. 노드는 200개까지 쓸 수 있습니다. |
| F_DEPTH_LIMIT | 식이 너무 깊게 중첩되어 있습니다. 32단계까지 쓸 수 있습니다. |
| F_INTERNAL | 수식을 해석하지 못했습니다(키트 버그). 이슈로 알려 주세요. |

`F_UNAVAILABLE`의 `{reason}`: "이 단계에는 가산점이 없습니다."(`bonus`, `<s>.bonus`), "게이트 기준은 점수 변수가 없습니다."(`crit.<게이트 key>`, `critmax.<게이트 key>`). `<s>.…`가 없는 단계를 가리키면 F_UNKNOWN_NAME이고 단계가 하나뿐인 설정이면 메시지에 "단계가 하나뿐이라 앞 단계 값이 없습니다."를 덧붙입니다.

### 2.9 가까운 이름 제안

`suggestName(name, candidates)`: 후보마다 OSA 거리(Damerau-Levenshtein의 인접 바꿈만 허용하는 판, UTF-16 단위)를 구해 가장 작은 것을 고릅니다. 같으면 후보 목록의 앞 순서가 이깁니다. 거리가 `max(1, ⌊name.length / 3⌋)` 이하일 때만 제안합니다 **[D9]**. 후보는 F_UNKNOWN_NAME이면 `vars.names`, F_UNKNOWN_FUNCTION이면 함수 이름, F_NAME_CASE이면 소문자로 바꾼 이름을 먼저 정확히 찾고 없으면 거리로 찾습니다. 예: `jduge → judge`(거리 1), `crit.aarch → crit.arch`, `sqr → sqrt`.

알려졌지만 쓸 수 없는 이름(3.2의 `unavailable`)은 제안보다 먼저 그 이유로 보고합니다.

### 2.10 lint (V4 경고)

`lintFormula(ast, ctx)`는 컴파일된 식에 아래 경고를 냅니다. 오류가 아니므로 계획을 막지 않고 "확인할 것"으로 붙습니다.

```ts
export type LintCode = "ZERO_DENOMINATOR" | "ALWAYS_DIV0" | "CONSTANT" | "NO_JUDGE_INPUT" | "RANGE" | "BONUS_UNUSED";
export interface LintContext {
  vars: VariableSet;          // 범위(domain) 포함
  role: "final" | "tie_break" | "prize";
  max_total: number;          // 그 장소의 최종 단계 max_total
  stage_has_bonus: boolean;
  spans?: Record<string, [number, number]>;
}
export interface LintFinding { code: LintCode; path: string; pos: number | null; message: string }
```

| 코드 | 대상 | 조건 | 메시지 |
| --- | --- | --- | --- |
| ZERO_DENOMINATOR | 모든 식 | `/`의 분모 범위가 0을 포함하고 `nz`가 아님 | 0이 될 수 있는 값으로 나눕니다. 0이면 그 부분이 0이 되고 DIV0 경고가 납니다. if({분모 원문} > 0, …, 0)처럼 가드를 두세요. |
| ALWAYS_DIV0 | 모든 식 | 분모 범위가 정확히 [0, 0] | 항상 0으로 나눕니다. |
| CONSTANT | final, prize | AST에 변수 노드가 없음 | 변수를 쓰지 않는 상수식입니다. 모든 팀의 점수가 같아집니다. |
| NO_JUDGE_INPUT | final, prize | `judge`, `crit.*`, `<s>.judge`, `<s>.crit.*`를 하나도 읽지 않음 | 심사 점수(judge, crit.*)를 하나도 쓰지 않는 식입니다. |
| RANGE | final | 결과 범위 `[lo, hi]`에서 `lo < 0` 또는 `hi > R`. `R = max(max_total, 100)` **[D10]** | 결과가 0~{R} 밖으로 나갈 수 있습니다(가능한 범위 {lo} ~ {hi}). |
| BONUS_UNUSED | final | `stage_has_bonus`인데 `bonus`를 읽지 않음 **[D11]** | 이 단계에 가산점이 있는데 식이 bonus를 쓰지 않습니다. 가산점을 더하려면 식에 + bonus를 넣으세요. |

**범위 분석.** 각 식에 `Range = { lo, hi, nz }`(닫힌 구간, ±∞ 허용, `nz`는 "0이 아님이 확실함")를 붙입니다. 변수의 범위는 3.5의 표를 따릅니다. `0 × ±∞ = 0`으로 셉니다. `lo > 0`이거나 `hi < 0`이면 언제나 `nz = true`로 둡니다. "양수 쪽"은 `lo ≥ 0`이고 `nz`인 범위입니다.

| 식 | 범위 |
| --- | --- |
| 숫자 `v` | `[v, v]`, `nz = v ≠ 0` |
| 변수 | `vars.domains[n]`(가드로 좁힌 것, 아래) |
| `-a` | `[-a.hi, -a.lo]`, `nz = a.nz` |
| `a + b` | `[a.lo+b.lo, a.hi+b.hi]`, `nz = lo > 0 ∨ hi < 0 ∨ (a.lo ≥ 0 ∧ b.lo ≥ 0 ∧ (a.nz ∨ b.nz))` |
| `a - b` | `a + (-b)` |
| `a * b` | 네 끝점 곱의 최소·최대, `nz = a.nz ∧ b.nz` |
| `a / b` | `b`가 0을 포함하고(`b.lo ≤ 0 ≤ b.hi`) `¬b.nz`면 ZERO_DENOMINATOR(`b`가 정확히 `[0, 0]`이면 ALWAYS_DIV0)를 남기고 결과는 `[-∞, ∞]`. `b`가 양수 쪽이면 `β = b.lo > 0 ? b.lo : 0⁺`로 두고 `a.lo ≥ 0`이면 `[a.lo / b.hi, a.hi / β]`, `a.hi ≤ 0`이면 `[a.lo / β, a.hi / b.hi]`, 그 밖은 `[a.lo / β, a.hi / β]`. `b`가 음수 쪽이면 `-(a / -b)`. 몫의 약속: 유한수 / ±∞ = 0, `x / 0⁺`는 `x > 0`이면 +∞, `x < 0`이면 −∞, `x = 0`이면 0, ±∞ / 유한 양수 = ±∞. `nz = a.nz` |
| `a ^ e` | `e = 0`: `[1,1]`, nz. `e` 홀수: `[lo^e, hi^e]`, `nz = a.nz`. `e` 짝수: 0이 구간 안이면 `[0, max(lo^e, hi^e)]` 아니면 `[min, max]`, `nz = a.nz` |
| 비교, `and`, `or`, `not` | `[0, 1]` |
| `min(…)`, `max(…)` | 끝점별 최소·최대. `min`의 `nz` = 모든 인자가 양수(lo ≥ 0 ∧ nz)거나 모두 음수, `max`의 `nz` = 한 인자라도 양수 |
| `sum`, `avg` | 합(평균은 합을 개수로 나눔). `nz`는 모든 인자 lo ≥ 0이고 하나가 nz |
| `abs(a)` | 0을 포함하면 `[0, max(-lo, hi)]`, 아니면 `[min(abs(lo), abs(hi)), max(abs(lo), abs(hi))]`, `nz = a.nz` |
| `sqrt(a)` | `[sqrt(max(lo, 0)), sqrt(max(hi, 0))]`, `nz = a.lo ≥ 0 ∧ a.nz` |
| `round`, `floor`, `ceil` | 끝점에 같은 함수, `nz`는 `ceil`에서 `a.lo ≥ 0 ∧ a.nz`일 때만 |
| `clamp(x, l, h)` | `min(max(x, l), h)`와 같게: `[min(max(x.lo, l.lo), h.lo), min(max(x.hi, l.hi), h.hi)]`, `nz = l.lo > 0 ∧ h.lo > 0` |
| `if(c, a, b)` | `a`는 `c`가 참일 때로 좁힌 환경에서, `b`는 거짓일 때로 좁힌 환경에서 구해 합집합. `nz = a.nz ∧ b.nz` |

**가드로 좁히기.** `if`의 조건을 `and`로 나눈 각 마디가 `V op N` 또는 `N op V`(V는 변수, N은 숫자나 `-숫자`) 꼴이면, 참 쪽에서 V를 이렇게 좁힙니다: `V > N` → `lo = max(lo, N)`, `N ≥ 0`이면 nz. `V >= N` → `lo = max(lo, N)`, `N > 0`이면 nz. `V < N` → `hi = min(hi, N)`, `N ≤ 0`이면 nz. `V <= N` → `hi = min(hi, N)`, `N < 0`이면 nz. `V != 0` → nz. `V == N` → `[N, N]`. 조건이 변수 하나(`if(x, …)`)면 nz. 조건이 비교 하나뿐이면 거짓 쪽에서 부정(`>`↔`<=`, `>=`↔`<`, `==`↔`!=`)으로 좁힙니다. `if`가 겹치면 좁힌 것이 쌓입니다.

결과: 부록 C의 가드 없는 식은 ZERO_DENOMINATOR, 가드가 있는 식은 경고가 없습니다(범위 `[0, 100]`). `judge / max_total * 100`은 경고가 없습니다(`max_total`은 상수, nz).

### 2.11 `simulateFormula`

SPEC 7.3 "시나리오"를 MCP가 부를 수 있는 순수 함수로 둡니다 **[D12]**.

```ts
export interface SimulationContext {
  config: NormalizedConfig;
  at: { track: string | null; division: string | null };  // 단계는 최종 단계
  judges?: number;        // 기본: 최종 단계 judges_per_project ?? 3
  team_count?: number;    // 기본 5 (2 이상)
  votes?: number;         // 기본 10 (0 이상)
}
export type Scenario = "zero_votes" | "single_team_group" | "zero_judges" | "all_max" | "all_zero";
export interface SimulationResult {
  scenario: Scenario;
  vars: Record<string, number>;   // 넣은 변수 값(variableSet 순서)
  value: number;                  // evaluate 결과
  score: number;                  // roundHalfAway(value, precision)
  warnings: FormulaWarning[];
  in_range: boolean;              // 0 ≤ value ≤ max(max_total, 100)
}
export function simulateFormula(formula: Formula, ctx: SimulationContext): SimulationResult[];  // 위 순서 고정
```

합성 값(J = judges, T = team_count, V = votes). "수준"은 모든 점수 리프를 같은 값으로 둔 심사위원 J명의 채점표입니다: `min`은 각 리프의 min, `mid`는 `(min+max)/2`, `max`는 max. 그 채점표로 `crit.*`, `judge`, `max_total`을 4장 규칙대로 계산합니다(심사위원끼리 같으므로 집계 방식과 무관). 앞 단계 변수도 같은 수준입니다.

| 시나리오 | 점수 수준 | judges | bonus | 득표(이 팀 / 같은 묶음의 다른 팀 각각) |
| --- | --- | --- | --- | --- |
| zero_votes | mid | J | 0 | 0 / 0, team_count = T |
| single_team_group | mid | J | 0 | V / 없음, team_count = 1 |
| zero_judges | judge = 0, `crit.*` = 0 | 0 | 0 | V / V, team_count = T |
| all_max | max | J | 그 단계 양수 가산점의 합 | 2V / V, team_count = T |
| all_zero | min | J | 그 단계 음수 가산점의 합(없으면 0) | 0 / V, team_count = T |

득표 통계는 3.4의 정의대로 계산하고 `popular`는 add-on의 `normalize`로 구합니다. 인기투표 변수가 없는 식이면 득표 열은 무시합니다. "지난 대회 원자료로 다시 계산"은 `computeResults`를 그 자료로 부르면 됩니다.

### 2.12 `formulaReference`

`hackathon://formula/reference`(SPEC 12.1)가 돌려줄 JSON입니다: `{ grammar: string(2.1 그대로), tokens, limits: LIMITS, functions: [{ name, arity: [min, max], description }], variables: [{ pattern, when, description }](3.1), warnings: [{ code, message }](코드는 2.6, 문구는 6.8의 DIV0·SQRT_NEG·NONFINITE 행), errors: [{ code, message }](2.8), lints: [{ code, message }](2.10), examples: [{ source, description }] }`. 예시에는 부록 C의 식(가드 포함), `judge / max_total * 100`, `0.3 * screening.judge / screening.max_total * 100 + 0.7 * judge / max_total * 100`을 넣습니다.

---

## 3. 변수

SPEC 7.3의 변수 표, V4, V17.

### 3.1 변수 표

`<s>`는 단계 id, `<key>`는 그 단계 루브릭의 점수 기준 key(게이트 제외, 부모 노드 포함)입니다. 식의 자리는 언제나 최종 단계입니다(4.9).

| 변수 | 있는 때 | 값 |
| --- | --- | --- |
| `judge` | 항상 | 최종 단계의 팀 심사 점수(정규화 뒤 집계, 4.7) |
| `judges` | 항상 | 집계에 들어간 심사위원 수 |
| `max_total` | 항상 | 그 장소의 최종 단계 루브릭 만점 |
| `crit.<key>`, `critmax.<key>` | 점수 노드마다 | 노드 점수의 집계, 노드 만점 |
| `bonus` | 최종 단계를 가리키는 가산점이 하나 이상 | 그 단계 가산점 합 |
| `<s>.judge`, `<s>.judges`, `<s>.max_total`, `<s>.crit.<key>`, `<s>.critmax.<key>` | `<s>`가 최종 단계보다 앞선 단계 | 그 단계의 값 **[D13]** |
| `<s>.bonus` | 위 + `<s>`를 가리키는 가산점이 있음 | 그 단계 가산점 합 |
| `votes`, `total_votes`, `avg_votes`, `max_votes`, `team_count`, `popular` | `addons.popular_vote.enabled`이고 `use: formula_input` | 득표와 그 순위 묶음의 통계(3.4) |
| `peer` | 없음(`peer_vote`는 planned) | 쓰면 F_ADDON_PLANNED |
| `ai.<key>` | 없음(`ai_score_input`은 planned) | 쓰면 F_ADDON_PLANNED |

v1의 `<s>.judge`, `<s>.crit.<key>`, `<s>.bonus`에 더해 `<s>.judges`, `<s>.max_total`, `<s>.critmax.<key>`를 둡니다. 앞 단계 점수를 공통 척도로 옮기려면(`screening.judge / screening.max_total * 100`) 만점이 필요하기 때문입니다.

### 3.2 `variableSet`

```ts
export interface VariableAt { stage: string; track: string | null; division: string | null }
export interface Domain { lo: number; hi: number; nz: boolean }
export type Unavailable =
  | { code: "F_ADDON_OFF" | "F_ADDON_PLANNED"; addon: string }
  | { code: "F_STAGE_ORDER"; stage: string }
  | { code: "F_UNAVAILABLE"; reason: string };
export interface VariableSet {
  names: readonly string[];                               // 쓸 수 있는 이름(순서 고정)
  domains: Readonly<Record<string, Domain>>;              // lint용(3.5)
  unavailable: Readonly<Record<string, Unavailable>>;     // 알려졌지만 여기서 못 쓰는 이름
  unavailable_prefixes: readonly { prefix: string; reason: Unavailable }[];  // "ai." 등
}
export function variableSet(config: NormalizedConfig | ShapeConfig, at: VariableAt): VariableSet;   // 수식 칸은 읽지 않음
```

이름 순서: `judge`, `judges`, `max_total`, (`bonus`), `crit.*`(루브릭 전위 순회, 부모가 먼저), `critmax.*`(같은 순서), 앞선 단계마다 단계 순서대로 `<s>.judge`, `<s>.judges`, `<s>.max_total`, (`<s>.bonus`), `<s>.crit.*`, `<s>.critmax.*`, 마지막으로 인기투표 변수 여섯 개(`votes`, `total_votes`, `avg_votes`, `max_votes`, `team_count`, `popular`).

각 단계의 루브릭은 그 장소에 맞는 단계 덮어쓰기를 `stageSettings`(4.12)로 적용한 **실효 루브릭**입니다. `unavailable`에는 다음을 넣습니다: 인기투표 변수 여섯 개(add-on이 꺼졌거나 `use: separate_prize`면 F_ADDON_OFF), `peer`(F_ADDON_PLANNED, `peer_vote`), `bonus`(가산점이 없으면 F_UNAVAILABLE), 가산점이 없는 앞 단계의 `<s>.bonus`(F_UNAVAILABLE, 이유는 2.8의 "이 단계에는 가산점이 없습니다."), 최종 단계와 그 뒤 단계(최종 단계가 마지막이므로 최종 단계 자신)의 `<s>.*` 이름(F_STAGE_ORDER), 게이트 key의 `crit.<key>`, `critmax.<key>`(F_UNAVAILABLE). `unavailable_prefixes`에는 `ai.`(F_ADDON_PLANNED, `ai_score_input`)를 넣습니다.

빌드와 check는 수식 칸에 원문만 담은 정규형(`normalizeShape`, 11.1)을 먼저 만들고 그것으로 `variableSet`을 구해 수식을 컴파일합니다(11.1, 10.1).

### 3.3 팀별 값

`computeResults`가 최종 단계의 팀마다 아래 값을 만들어 `evaluate`에 넘깁니다.

- `judge`, `judges`, `crit.*`, `max_total`, `critmax.*`, `bonus`: 그 팀의 최종 단계 결과(4.10)
- `<s>.*`: 그 팀의 `<s>` 단계 결과. 최종 단계에 온 팀은 앞 단계를 모두 거쳤으므로 늘 있습니다.
- 미채점 팀(점수 집계 대상 0명): `judge = 0`, `judges = 0`, `crit.* = 0`(min이 0보다 커도 0). 이런 팀도 식을 계산하므로(4.9), lint 범위(3.5)는 이 0을 포함합니다. 앞 단계를 채점 없이 결정(6.3의 advance)으로 진출한 팀의 `<s>.*`도 같습니다.
- 인기투표 변수: 3.4
- 상의 식(6.6)과 섞인 pool의 기본 tie_break(6.1)도 같은 값으로 계산합니다. 이 값은 `PrizeContext.vars`로 넘깁니다.

### 3.4 순위 묶음별 득표 통계

인기투표 변수는 팀의 **순위 묶음**(최종 단계의 `rank_groups` 값, 6.1) 안에서 계산합니다.

```
G = 같은 순위 묶음에 있는 최종 단계 참가 팀(게이트 탈락·미채점 팀 포함, exclude(all) 팀과 순위 묶음이 없는 팀 제외), id 순서
votes(t)    = 입력 votes[t]가 유한하고 0보다 크면 그 값, 아니면 0(음수·비정상이면 VOTES_INVALID 경고)
total_votes = Σ_{u∈G} votes(u)            (id 순서로 합산)
team_count  = |G|                          (순위 묶음이 있는 팀은 1 이상, 없는 팀은 0. 아래)
avg_votes   = total_votes / team_count
max_votes   = max(0, max_{u∈G} votes(u))
popular     = share_of_max: max_votes > 0 ? 100 × votes / max_votes : 0
              capped_sqrt:  m = full_at_multiple; avg_votes > 0 ? 100 × sqrt(min(1, votes / (m × avg_votes))) : 0
```

`popular`의 0 처리는 정의이므로 DIV0 경고를 내지 않습니다. `votes` 입력이 없는데(`null`) 식이 인기투표 변수를 쓰면 모든 값을 0으로 두고 결과를 막습니다(VOTES_MISSING, 6.8). 순위 묶음이 없는 팀(`rank_groups`에 division이 있는데 부문이 빠진 팀, 6.1)은 득표 변수가 모두 0입니다(`team_count`도 0). 혼자인 묶음의 통계(평균 득표 = 자기 득표)로 점수가 계산되지 않게 하려는 것입니다.

### 3.5 lint용 범위

| 변수 | 범위 |
| --- | --- |
| `judge`, `<s>.judge` | `[min(0, min_total), max_total]`. `min_total`은 모든 점수 리프가 min일 때의 총점(`scale_normalize`면 0). 채점된 팀은 정규화를 켜도 4.6이 `[min_total, max_total]`로 자르고 미채점 팀은 0이므로(3.3) 둘을 합친 범위입니다. 그래서 `min_total`이 0보다 커도 `judge`는 0이 될 수 있는 값(nz 아님)입니다 **[D10]** |
| `judges`, `<s>.judges` | `[0, ∞]` |
| `max_total`, `critmax.*`, `<s>.max_total`, `<s>.critmax.*` | 상수 `[c, c]`, `nz = c ≠ 0` |
| `crit.<key>`, `<s>.crit.<key>` | `[min(0, critmin), critmax]`(미채점 팀의 0 포함, `judge`와 같은 이유) |
| `bonus`, `<s>.bonus` | `[그 단계 음수 points 합, 양수 points 합]` |
| `votes`, `total_votes`, `avg_votes`, `max_votes` | `[0, ∞]` |
| `team_count` | `[0, ∞]`(순위 묶음이 없는 팀은 0, 3.4) |
| `popular` | `[0, 100]` |

예: 1~5점 리프 셋인 루브릭(`min_total` 3, `max_total` 15)에서 `(judge - 3) / 12 * 100`은 결과 범위가 `[-25, 100]`이라 RANGE이고 `crit.idea / judge`는 분모가 0일 수 있어 ZERO_DENOMINATOR입니다. 미채점 팀에서 실제로 음수와 DIV0가 나오기 때문입니다. `if(judge >= 3, (judge - 3) / 12 * 100, 0)`처럼 가드를 두면 범위가 `[0, 100]`이 되어 경고가 없습니다.

---

## 4. 점수

SPEC 7.2, JDG-1~14.

### 4.1 설정 모양(정규형)

```yaml
# 키와 기본값을 보이려는 모양 예시입니다(일부만 적어 그대로는 check를 통과하지 않음). 완전한 예는 8.8의 kr-contest.
scoring:
  locks: { rubric_on_stage_open: true }       # locked key(8.7)
  rubrics:                                    # 맵. key = 루브릭 id(Ident)
    screening:
      name: { ko: 서면 예선 }                 # Localized, 선택
      scale: { min: 1, max: 5, step: 1 }      # 리프 기본 척도. min 기본 0, max 선택, step 기본 0.01
      scale_normalize: false                  # true면 points(leaf) = (x − min) / (max − min) [D15]
      criteria:                               # key 목록(병합 key: key)
        - { key: fit, name: 주제 적합성, type: gate }
        - { key: idea, name: 창의성 }
        - { key: impact, name: 파급성, weight: 2 }
  stages:                                     # key 목록(병합 key: id), 순서 = 단계 순서
    - id: screening
      name: { ko: 서면 예선 }
      rubric: screening
      gate_rule: majority                     # all | majority | any. 그 단계가 쓰는 루브릭(기본 + 덮어쓰기) 중 하나라도 게이트가 있으면 기본 majority, 아니면 null [D21]
      judges_per_project: 3                   # 1..20, 선택
      assignment: { scope: track, exclude: [same_affiliation, mentor_of], mode: fixed }
      aggregate: { method: mean }             # mean | median | trimmed_mean(trim 기본 1)
      normalize: { method: none }             # none | zscore | minmax, min_entries 기본 5
      require_complete: true                  # 기본 true(v1과 같음, 4.4)
      advance: { top_n: 15, per: [track] }    # top_n | top_percent | min_score 중 하나, per 기본 [track]
      overrides:                              # 일반 목록. 뒤의 것이 이김
        - { when: { track: impl }, rubric: screening_impl }
  final:
    stage: final                              # 기본: 마지막 단계. 마지막 단계여야 함(V17) [D25]
    formula: null                             # 문자열이면 그 식, null이면 judge + bonus
    precision: 2                              # 0..6
    rank_groups: [track, division]            # [], [track], [track, division] [D28]
    tie_break: []                             # 식 목록. 기본 [] [D27]
    unresolved_tie: manual                    # manual | share
    overrides:                                # 일반 목록. 뒤의 것이 이김
      - { when: { division: intern }, tie_break: [crit.idea, judge] }
```

**기준(criterion)**

| 키 | 타입 | 기본 | 규칙 |
| --- | --- | --- | --- |
| `key` | Ident | 필수 | 루브릭 안에서 유일, 32자 이하(V3) |
| `name` | Localized | 필수 | |
| `description` | Localized | null | |
| `type` | `score` \| `gate` | `score` | `gate`는 최상위 리프만, `weight`·척도·`anchors`·`children` 없음 **[D14]** |
| `weight` | number | 1 | `0 < weight ≤ 1000` |
| `min`, `max`, `step` | number | 루브릭 `scale` | 리프만. `0 ≤ min < max ≤ 1e6`, `0 < step ≤ max − min`, 소수 6자리 이하 **[D16]** |
| `anchors` | `{ <숫자>: Localized }` | `{}` | 리프만. 키는 `[min, max]` 안의 step 위 값. 정규형은 값 오름차순 `[{ value, text }]` |
| `children` | 기준 목록 | `[]` | 있으면 부모. 부모에는 척도·`anchors`가 없음 |

**정의**(SPEC 7.2와 같은 순서):

```
points(leaf, x)   = scale_normalize ? (x − min) / (max − min) : x
points(parent)    = Σ_{c ∈ children, c.type = score} c.weight × points(c)       (설정 순서로 합산)
judge_total       = Σ_{t ∈ criteria, t.type = score} t.weight × points(t)
criterionMax(n)   = 모든 리프를 max로 둔 points(n)      → critmax.<key>
criterionMin(n)   = 모든 리프를 min으로 둔 points(n)
maxTotal(rubric)  = 모든 리프를 max로 둔 judge_total   → max_total
```

`effectiveWeights(rubric)`는 리프마다 `{ key, path: [최상위 key, …, key], weight: 경로 weight의 곱, max_points: weight × points(max), share: max_points / max_total × 100 }`을 돌려줍니다(`event_get`의 "리프별 실효 비중", V3 info). `share`는 `roundHalfAway(·, 1)`.

**덮어쓰기.** `stages[].overrides[]`는 `{ when: { track?, division? }, rubric?, aggregate?, require_complete? }`, `final.overrides[]`는 `{ when, formula?, tie_break?, precision? }`입니다 **[D26]**. 한 팀의 실효 설정은 기본값에서 시작해 `when`이 맞는 항목을 목록 순서대로 덮은 결과입니다. 항목에 적힌 키만 덮습니다. 단계 쪽 규칙의 원본은 rules 번들의 `stageSettings`(4.12), 최종 쪽은 engine의 `finalSettings(scoring, place): { formula, tie_break, precision, slot }`(`slot`은 적용된 식 칸 경로)이고 둘은 같은 규칙입니다. `when`에는 적은 키만 있고(정규형도 같음, 11.1) 적힌 키가 모두 맞아야 맞습니다. `{}`는 모든 팀에 맞습니다. `when.division`은 팀의 부문이 그 값일 때만 맞으므로 부문이 `null`인 팀에는 맞지 않습니다 **[D83]**. `formula: null`이면 기본 가중합으로 돌아갑니다. 정규화, 게이트 규칙, 진출, `judges_per_project`, `assignment`는 덮어쓸 수 없습니다.

**배정은 데이터만입니다.** `assignment`(`scope: track | division | all`, 기본 `track`; `exclude: [same_affiliation | mentor_of]`, 기본 `[]`; `mode: fixed | random_async`, 기본 `fixed`)는 검사하고 `_config`에 실을 뿐 core가 배정을 만들지 않습니다(MCP `judging_plan`). 필요한 심사위원 수는 `estimateJudges({ projects: P, per_project: n, minutes_per_project: t, total_minutes: T }) = ⌈P × n × t / T⌉`입니다(JDG-8) **[D119]**. 네 값은 모두 정수이고(`P ≥ 0`, `n ≥ 1`, `t ≥ 1`, `T ≥ 1`, `P × n × t + T − 1 ≤ 2^53 − 1`), 아니면 `E_INPUT`입니다. 올림은 정수로 `(P × n × t + T − 1)`을 `T`로 나눈 몫(내림)으로 계산합니다. 분을 소수로 받아 부동소수로 곱하면 `20 × 5 × 9.3 = 930.0000000000001`처럼 정수 바로 위로 올라가 한 명이 더 나오기 때문입니다. 30초 같은 단위가 필요하면 초로 바꿔 넘깁니다. 상한도 부동소수 때문에 곱 `P × n × t`가 아니라 `T − 1`을 더한 분자에 겁니다. 분자가 2^53 − 1을 넘으면 덧셈이 반올림되어 몫이 하나 틀릴 수 있습니다(예: `P × n × t = 2^53 − 1`, `T = 3`이면 정답보다 하나 작음). 그래서 검사도 덧셈 없이 `P × n × t ≤ 2^53 − 1 − (T − 1)`로 비교합니다.

### 4.2 단일 단계 축약형 → 정규형

SPEC 7.2: 단계가 하나뿐인 대회는 `scoring` 바로 아래에 적습니다. core 1차 구현의 점수 형식도 이 축약형으로 계속 유효합니다(SPEC 7.2 "그대로 유효"). v1 이름(`judge_aggregate`, `input_step`, `components`, `popular_normalize`)은 DEPRECATED 경고와 함께 받습니다 **[D53]**. 점수 밖의 1차 형식은 8.6 ①의 별명 표에 있는 키만 DEPRECATED 경고와 함께 받고(D54) 나머지는 받지 않습니다(14장).

**최종 키는 층마다 옮깁니다.** `formula`, `precision`, `tie_break`, `rank_groups`, `unresolved_tie`는 어느 형식에서나 `final.*`과 뜻이 같으므로, 병합하기 전에 층마다 `scoring.final.<키>`로 옮깁니다(8.4 ②, 8.6 ①). 같은 층에 `scoring.<키>`와 `scoring.final.<키>`가 함께 있으면 SCHEMA 오류입니다. 그래서 정규형 preset(`kr-contest@1`)을 extends하는 아래 층(profile, event)도 SPEC 6.2처럼 `scoring.tie_break`를 적을 수 있습니다.

**판정.** 병합이 끝난 원자료(defaults 전)의 `scoring`에 아래 **축약형 키**(루브릭·단계 키와 v1 키. 최종 키는 위처럼 따로 다룸)가 하나라도 있으면 축약형입니다: `criteria`, `scale`, `scale_normalize`, `input_step`, `gate_rule`, `judges_per_project`, `assignment`, `normalize`, `require_complete`, `aggregate`, `judge_aggregate`, `components`, `popular_normalize`, `overrides`. 이 키와 `rubrics`/`stages`가 함께 있으면 SCHEMA 오류입니다 **[D52]**: "scoring에 축약형 키({키들})와 단계형 키({키들})가 함께 있습니다." fix: "단계형을 쓰려면 위 층에서 온 축약형 키를 null로 지워 주세요(예: scoring.criteria: null)." `final`과 `locks`는 두 형식 모두 씁니다.

| 축약형 키 | 정규형 자리 | 비고 |
| --- | --- | --- |
| `criteria` | `rubrics.main.criteria` | |
| `scale` | `rubrics.main.scale` | |
| `scale_normalize` | `rubrics.main.scale_normalize` | |
| `input_step` (v1) | `rubrics.main.scale.step` | DEPRECATED 경고. 같은 층에 `scale.step`이 함께 있으면 SCHEMA 오류 |
| `gate_rule`, `judges_per_project`, `assignment`, `normalize`, `require_complete` | `stages[0].<같은 키>` | |
| `aggregate` | `stages[0].aggregate` | |
| `judge_aggregate` (v1) | `stages[0].aggregate` | DEPRECATED, 층마다 이름을 바꿈(8.6). 같은 층에 `aggregate`가 함께 있으면 SCHEMA 오류 |
| `formula`, `precision`, `tie_break`, `rank_groups`, `unresolved_tie` | `final.<같은 키>` | 층마다 옮김(위) |
| `components` (v1) | `final.formula` | DEPRECATED. 변환은 아래. `final.formula`와 함께 있으면 아래 규칙 |
| `popular_normalize` (v1) | `addons.popular_vote.normalize`, `full_at_multiple` | DEPRECATED. add-on 쪽에 이미 값이 있으면 그 값이 이기고 경고만 |
| `overrides` (v1) | `stages[0].overrides`, `final.overrides`, 추가 루브릭 | 아래 |

정규형은 `rubrics: { main: … }`, `stages: [{ id: "main", rubric: "main", … }]`, `final: { stage: "main", … }`입니다.

- **`components`에서 식 만들기**(v1 기본 `{ judge: 1 }`): 식이 있으면(`final.formula`) `components`는 쓰지 않고 DEPRECATED info "formula가 있어 components를 쓰지 않습니다"를 냅니다(v1과 같음). 식이 없으면 `components: { judge?, popular? }`에서 적지 않은 항을 0으로 보고 0인 항을 빼고 `judge`, `popular` 순서로 `"{a} * judge"`(a = 1이면 `"judge"`), `"{b} * popular"`를 `" + "`로 잇습니다. 모두 0이면 `"0"`, `judge: 1`만 남으면 식이 아니라 `formula: null`입니다. 수는 0 이상 1e9 이하이고 소수 9자리 안에 정확히 적을 수 있어야 합니다(`Number(x.toFixed(9)) === x`). 그렇게 쓸 수 없으면 SCHEMA 오류입니다. 식에 쓰는 글자는 `String(x)`(같은 수로 되돌아오는 가장 짧은 십진 표기)입니다. 지수 표기(`1e-7`)로 나오면 같은 수의 지수 없는 십진 표기(`0.0000001`)로 펼칩니다. `toFixed(9)`의 끝 0을 지운 글자는 쓰지 않습니다. 예를 들어 123456789.1은 `toFixed(9)`로 쓰면 `123456789.099999994`가 되어 식 원문과 `config_hash`가 달라집니다. 예: `{ judge: 0.85, popular: 0.15 }` → `"0.85 * judge + 0.15 * popular"`. `popular`는 `use: formula_input`이 있어야 하므로 없으면 V4 오류가 납니다.
- **v1 `overrides`** = `[{ when, criteria?, input_step?, judge_aggregate?, require_complete?, components?, popular_normalize?, formula?, precision?, tie_break? }]`. v1(`settingsFor`)은 맞는 항목을 목록 순서로 필드마다 누적해 덮었습니다. 항목을 하나씩 따로 옮기면 이 누적이 사라지므로, 장소마다 v1 결과를 먼저 계산한 뒤 옮깁니다 **[D98]**.
  1. 장소 목록: 트랙 id 오름차순으로, 트랙마다 `(track, null)` 다음에 그 트랙 `divisions` 순서의 `(track, d)`. 부문이 정해지지 않은 팀도 v1과 같은 설정을 받도록 0.2의 장소 목록에 부문 트랙의 `(track, null)`을 더합니다.
  2. 장소마다 v1 규칙으로 실효 v1 설정(기본 축약형 값에 맞는 항목의 적힌 필드를 차례로 덮은 것)을 구합니다. v1 항목은 `when`의 적힌 키가 모두 맞는 장소에 맞습니다(`track`이 없으면 모든 트랙, `division`이 없으면 그 트랙의 모든 장소, `division`이 있으면 그 부문 장소만).
  3. 루브릭: 실효 `(criteria, input_step)`이 기본과 다른 장소마다 그 쌍으로 루브릭을 만듭니다. 같은 쌍은 하나만 만들고 id는 장소 목록에서 처음 나온 순서로 `main_o1`, `main_o2`, …입니다(척도는 기본 루브릭 `scale`에 `step`만 바꿈).
  4. **비교 기준.** v2의 `when`은 적힌 키만 보므로(4.1), `{ when: { track } }` 항목은 그 트랙의 부문 장소에도 맞습니다. 그래서 장소마다 "그 장소가 이미 받는 값"(기준값)과 비교해 다른 키만 적습니다. `(track, null)` 장소의 기준값은 기본값이고 `(track, d)` 장소의 기준값은 기본값에 그 트랙의 `(track, null)` 항목(이 단계들이 만든 것, 없으면 빈 항목)을 덮은 값입니다. 다른 트랙의 항목은 이 장소에 맞지 않으므로 기준값에 들지 않습니다.
  5. 단계 덮어쓰기(`stages[0].overrides`): 실효 루브릭(3단계의 id 또는 `main`)·`aggregate`·`require_complete` 중 기준값과 다른 것이 있는 장소마다 한 항목을 만들고 기준값과 다른 키만 적습니다. `(track, null)` 장소는 `{ when: { track } }`, `(track, d)` 장소는 `{ when: { track, division: d } }`이고 장소 목록 순서로 둡니다(뒤가 이기므로 부문 장소가 이김).
  6. 최종 덮어쓰기(`final.overrides`): 실효 식(위의 `components` 규칙을 장소의 실효 `formula`·`components`에 적용한 것), `tie_break`, `precision` 중 기준값과 다른 것이 있는 장소마다 같은 방식으로 한 항목을 만듭니다. 기준값에 식이 있는데 장소의 실효 식이 가중합이면 `formula: null`입니다.
  7. `popular_normalize`가 덮어쓰기에 있으면 SCHEMA 오류입니다 **[D69]**: "덮어쓰기의 popular_normalize는 v2에서 쓸 수 없습니다." fix: "addons.popular_vote.normalize에 한 번만 적어 주세요."
  8. 생성한 항목의 진단 경로는 그 값을 마지막으로 정한 v1 항목(`scoring.overrides[i]`)으로 바꿉니다(아래 별명).

  예: 기본 `require_complete: true`에 v1 `overrides: [{ when: { track: hack }, require_complete: false }, { when: { track: hack, division: student }, require_complete: true }]`이면, v1에서 hack/student는 true이고 hack/general과 부문이 없는 hack 팀은 false입니다. 변환 결과는 `[{ when: { track: hack }, require_complete: false }, { when: { track: hack, division: student }, require_complete: true }]`이고 hack/general 항목은 생기지 않습니다(기준값 false와 같음). 4단계의 기준값 대신 기본값과 비교하면 hack/student의 값(true)이 기본값과 같아 항목이 생기지 않고 v2에서 hack/student가 false가 됩니다. 무작위 v1 overrides 5,000개로 확인하면 기본값과 비교하는 방식은 72개에서 어느 장소의 값이 v1과 달랐고 기준값과 비교하는 방식은 0개였습니다. 이 예는 `normalize.test.ts`의 고정 사례입니다(13.1).
- **경로 별명.** 진단 경로가 사용자가 적은 곳을 가리키도록 정규화는 `aliases: [정규형 접두어, 적은 접두어][]`를 돌려줍니다. 예: `scoring.rubrics.main.criteria` ↔ `scoring.criteria`, `scoring.stages[0].aggregate` ↔ `scoring.aggregate`(v1 이름으로 적었으면 `scoring.judge_aggregate`), `scoring.final.formula` ↔ `scoring.formula`, `scoring.final.overrides[k]` ↔ `scoring.overrides[i]`. 진단의 `path`는 가장 긴 접두어가 맞는 별명으로 바꿉니다.

### 4.3 입력: 원점수 행

백엔드가 시트에 저장하고 MCP가 core에 넘기는 모양입니다(SPEC 7.5 "단계, 팀, 심사위원, 기준, 값").

```ts
export interface RawScoreRow {
  stage: string;              // 단계 id
  team: string;               // 팀 id(0.2)
  judge: string;              // 심사위원 id(0.2, 이메일 아님)
  criterion: string;          // 리프 key, 또는 "@abstain"
  value: number | null;       // 점수. null은 "지움". "@abstain"이면 1 = 기권, 0·null = 기권 취소
  seq: number;                // 백엔드가 행을 쓸 때마다 1씩 올리는 0 이상 정수. 입력 안에서 유일
  epoch?: number;             // 행을 쓸 때 그 단계의 epoch(0 이상 정수, 10.1). 없으면 0 [D118]
}
export interface Assignment { stage: string; team: string; judge: string }
```

- **`seq`가 가장 큰 행이 이깁니다** **[D17]**. 시트 행 순서가 아니라 백엔드가 기록한 `seq`로 정하므로, 운영진이 시트 탭을 정렬해도 결과가 바뀌지 않습니다(JDG-12 "마지막 제출이 유효"). `seq`가 0 이상 정수가 아니거나 두 행의 `seq`가 같으면 `E_INPUT`입니다(MCP가 시트를 읽을 때 겹친 행을 보여 줌).
- **epoch** **[D90]**: 운영진이 단계 잠금을 "다시 채점"(`rescore`)으로 풀면 백엔드가 그 단계의 epoch를 1 올리고 그 뒤에 쓰는 행에 새 epoch를 적습니다. 결과 계산은 단계마다 현재 epoch(`ResultsInput.epochs`)보다 작은 행을 빼므로 다시 채점한 단계에서 옛 칸과 새 칸이 섞이지 않습니다. "유지"(`keep`)로 풀면 epoch는 그대로입니다.
- `@`로 시작하는 기준은 key 규칙(Ident)과 겹치지 않습니다. 쓰는 것은 `@abstain` 하나입니다. 팀 단위 "제출함" 표시는 백엔드·사이트의 일이고 core는 마지막 값을 채점표로 봅니다.
- **처리 순서**(통과하지 못한 행은 집계에서 빼고 6.8의 코드로 결과 경고를 남김):
  1. (computeResults가 한 번) `stage`가 단계 id가 아니면 ROW_UNKNOWN_STAGE, `team`이 입력 팀이 아니면 ROW_UNKNOWN_TEAM. 남은 행을 단계별로 나눠 `scoreStage`에 넘깁니다.
  2. (scoreStage) 행의 `epoch`(없으면 0)가 그 단계의 현재 epoch보다 작으면 ROW_STALE info로 뺍니다. 현재 epoch보다 크면 `E_INPUT`입니다.
  3. `(team, judge, criterion)`마다 `seq`가 가장 큰 행 하나만 남깁니다. 덮인 행은 경고 없이 버립니다.
  4. 남은 행만 아래 표로 검사합니다. 검사에 걸린 행은 그 칸을 빈칸으로 만들고(앞 행을 되살리지 않음) 경고를 하나 남깁니다. `value: null`인 행은 경고 없이 빈칸입니다. `-0`은 0으로 다룹니다.

| 순서 | 조건 | 경고 |
| --- | --- | --- |
| 1 | 팀이 그 단계의 참가 팀이 아님(앞 단계 탈락) | ROW_NOT_ENTRANT |
| 2 | `criterion`이 `@abstain`도, 그 팀 실효 루브릭(`stageSettings`)의 리프도 아님 | ROW_UNKNOWN_CRITERION |
| 3 | `assignments`가 주어졌고 `(stage, team, judge)`가 배정에 없음 | ROW_UNASSIGNED |
| 4 | `value`가 `null`이 아니고 유한한 숫자가 아님(JSON `1e309` = Infinity 포함) | SCORE_NOT_NUMBER |
| 5 | `@abstain`인데 값이 0, 1이 아님 / 게이트 리프인데 0, 1이 아님 / 점수 리프인데 `[min, max]` 밖 | SCORE_OUT_OF_RANGE |
| 6 | 점수 리프인데 step 위가 아님(`onStep`, 아래) | SCORE_OFF_STEP |

v1은 범위 밖 값을 0이나 max로 잘라 맞췄지만 v2는 백엔드가 저장할 때 거절하므로(SPEC 7.2 1단계) 시트를 손으로 고친 행만 여기 걸립니다. 잘라 맞추지 않고 뺍니다 **[D19]**.

`onStep(x, min, step)`: `D = max(decimalsOf(step), decimalsOf(min))`(0..6), `S = 10^D`. `Number(x.toFixed(D)) === x`이고 `(Math.round(x × S) − Math.round(min × S)) % Math.round(step × S) === 0`이면 참입니다. `|x| ≤ 1e6`이라 정수가 모두 2^53보다 작습니다. `decimalsOf(n)`은 `String(n)`의 소수점 뒤 자릿수입니다.

### 4.4 단계 계산 알고리즘

`scoreStage(config, stageId, entrants, input)`는 아래 순서로 계산합니다. `entrants`는 id 오름차순으로 정렬해서 씁니다.

```ts
export interface StageInput {
  rows: RawScoreRow[];                 // 이 단계의 행만(4.3 1단계를 거친 것)
  assignments?: Assignment[] | null;
  epoch?: number;                      // 이 단계의 현재 epoch, 기본 0
  decisions?: Decision[];              // 이 단계의 advance 결정(6.3 충돌 검사를 거친 것)
}
```

1. **행 정리**: 4.3의 2~4단계.
2. **채점표**: `(team, judge)`마다(그 팀에 남은 행이 있는 심사위원, 심사위원 id 오름차순). 실효 루브릭은 `stageSettings(config.scoring, stage, 팀의 장소)`입니다.
   - 최신 `@abstain` 값이 1이면 기권입니다. 점수 집계와 게이트 표에서 모두 빼고 `abstained`를 셉니다(ABSTAINED info).
   - `complete` = 실효 루브릭의 모든 리프(점수·게이트)가 채워짐.
   - **점수 집계 대상** **[D77]**: 기권이 아니고, `require_complete`면 `complete`인 심사위원, 아니면 점수 리프를 하나 이상 채운 심사위원입니다. 게이트 칸만 채운 심사위원은 점수 집계 대상이 아닙니다(빈 점수 리프가 min으로 평균을 끌어내리지 않게). 다만 실효 루브릭에 점수 리프가 없으면(게이트만 있는 서면 예선 등) `require_complete`와 관계없이 `complete`인 심사위원(모든 게이트를 채움)이 점수 집계 대상입니다. 이 규칙이 없으면 게이트만 있고 `require_complete: false`인 단계에서 집계 대상이 아무도 없어 게이트를 통과한 팀까지 모두 미채점(UNSCORED)이 되고 아무도 진출하지 못합니다.
   - 집계 대상의 빈 점수 리프는 `x = min`으로 계산합니다 **[D18]**(v1은 0).
   - 심사위원의 `total`(= judge_total)과 노드별 `points`를 4.1로 계산합니다.
   - **게이트 표**: 게이트 리프 `g`마다, 기권하지 않고 `g`를 채운 심사위원의 값입니다. 점수 집계 대상인지와 관계없습니다. 주제 부적합으로 보고 점수를 넣지 않은 심사위원의 0표도 셉니다.
3. **빠진 채점표**: `assignments`가 있으면 배정된 `(team, judge)` 중 점수 집계 대상이 아니고 기권도 아닌 것마다 MISSING_SHEET. 없으면 `judges_per_project`가 있고 집계 인원이 그보다 적을 때 FEWER_JUDGES.
4. **정규화**(4.6): 단계의 `normalize.method`가 `none`이 아니면 `total`을 `total'`로 바꿉니다.
5. **집계**(4.7): `judge = aggregate(total')`, `judge_raw = aggregate(total)`, `crit.<key> = aggregate(points[key])`. 점수 집계 대상이 없으면 `judge = judge_raw = 0`, `crit.* = 0`, `unscored = true`입니다.
6. **게이트와 상태**(4.5): 게이트를 판정하고 팀의 상태(GATE_FAILED, UNSCORED 등)를 정합니다. 상태가 UNSCORED면 UNSCORED 경고를 냅니다.
7. **가산점**(5장): `bonus = computeBonuses(...).total`.
8. **단계 점수**: `score_raw = judge + bonus`, `score = roundHalfAway(score_raw, P)`. `P`는 `scoring.final.precision`(덮어쓰기 전 기본값)입니다 **[D24]**. 단계별 식은 없습니다.
9. **진출**(4.8): 마지막 단계가 아니면 진출 여부를 정합니다.

### 4.5 게이트와 상태

게이트 리프 `g`마다 게이트 표(4.4 2단계)에서 1의 수 `yes`, 0의 수 `no`를 셉니다.

| gate_rule | 한 게이트의 통과 조건 |
| --- | --- |
| `all` | `yes ≥ 1`이고 `no = 0` |
| `majority` | `yes > no`. 짝수 인원의 동수(2:2)는 **탈락**이고 GATE_TIE 경고 **[D21]** |
| `any` | `yes ≥ 1` |

- **아무도 보지 않은 팀**(점수 집계 대상이 없고 모든 게이트에 표가 없음)은 게이트를 판정하지 않습니다. `gate`는 `{ judged: false, passed: false, yes: 0, no: 0, criteria: […] }`이고 GATE_NO_VOTES를 내지 않으며 상태는 UNSCORED입니다 **[D76]**.
- 그 밖의 팀은 게이트마다 판정합니다. 표가 없는 게이트(`yes = no = 0`)는 규칙과 관계없이 탈락이고 GATE_NO_VOTES 경고입니다.
- 게이트가 여러 개면 게이트마다 판정하고 모두 통과해야 통과입니다. 결과의 `yes`, `no`는 게이트별 값의 합이고 게이트별 값은 `criteria`에 있습니다 **[D22]**.
- **상태의 우선순위** **[D76]**: `EXCLUDED`(exclude(all) 결정, 단계 결과 없음) > `GATE_FAILED`(게이트를 판정해 탈락) > `UNSCORED`(점수 집계 대상 없음) > `DIVISION_MISSING`(6.1). 게이트에서 탈락하면 채점표가 없어도 GATE_FAILED입니다. 이 값이 마지막이 아닌 단계의 `advance_reason`과 최종 단계의 `excluded`가 됩니다(4.8, 4.9).
- 게이트 탈락 팀은 그 단계의 진출에서 빠지고 최종 단계면 순위와 모든 상에서 빠집니다. 운영진은 이유와 함께 봅니다.
- 루브릭에 게이트가 없으면 `gate: null`입니다.

부록 D의 서면 예선: 세 명 중 둘이 1, 하나가 0 → `yes 2 > no 1` → 통과.

### 4.6 정규화

SPEC 7.2 7단계. 정규화 단위는 **(단계, 실효 루브릭)** 입니다 **[D20]**. 덮어쓰기로 루브릭이 다른 팀끼리는 섞지 않습니다.

```
단위 U의 모든 집계 대상 총점 목록 P_U: 팀 id, 심사위원 id 순서
μ_U = mean(P_U), σ_U = popSd(P_U), lo_U = min(P_U), hi_U = max(P_U)
심사위원 j의 U 안 총점 T_j: 팀 id 순서. n_j = |T_j|, μ_j = mean(T_j), σ_j = popSd(T_j), lo_j, hi_j

zscore: n_j ≥ min_entries 이고 σ_j > 0 이면  t' = μ_U + ((t − μ_j) / σ_j) × σ_U
minmax: n_j ≥ min_entries 이고 hi_j > lo_j 이면 t' = lo_U + ((t − lo_j) / (hi_j − lo_j)) × (hi_U − lo_U)
그 밖(채점 수 부족, σ_j = 0, hi_j = lo_j): 평균 이동만  t' = t − μ_j + μ_U   (NORMALIZE_FALLBACK info, 심사위원마다 한 번)
마지막으로 t' = min(max(t', min_total_U), max_total_U)   (잘리면 NORMALIZE_CLAMPED info, (심사위원, 팀)마다)
```

- `min_entries`는 2 이상 정수, 기본 5입니다.
- **자르기** **[D82]**: `min_total_U`, `max_total_U`는 그 단위 루브릭의 최저·최고 총점(3.5)입니다. SPEC 7.2의 "원래 척도에 되돌립니다"를 지키고 lint의 `judge` 범위(3.5)가 runtime과 맞게 하려고 자릅니다. 엄한 심사위원의 최고점이 만점을 넘거나 평균 이동으로 음수가 나오는 경우가 여기 걸립니다.
- 단계의 모든 집계 대상 심사위원이 그 단계의 모든 참가 팀을 채점했으면 NORMALIZE_FULL_PANEL 경고("모든 심사위원이 모든 팀을 채점해 정규화의 효과가 거의 없습니다")를 단계마다 한 번 냅니다. 정규화는 그대로 합니다.
- `crit.*`는 정규화하지 않은 points의 집계입니다. `judge`와 각 `crit.<key>`는 심사위원 값을 따로 집계합니다(4.4 5단계). 그래서 정규화를 켜거나, 합과 순서를 바꿀 수 없는 `median`·`trimmed_mean`으로 집계하면 `judge`와 `Σ weight × crit`가 다를 수 있습니다. 예: company 예제의 기준(idea 30, impl(done 20, quality 20), demo 30)에서 심사위원 셋의 점수가 (30, 0, 0, 0), (0, 20, 10, 0), (5, 0, 0, 5)이면 총점은 30, 30, 10이고 `trimmed_mean`(trim 1)의 `judge`는 30이지만 `crit.idea` 5, `crit.impl` 0, `crit.demo` 0이라 합은 5입니다. `mean`이고 정규화가 없을 때만 늘 같습니다.
- 계산식의 연산 순서는 위에 적은 그대로입니다.

### 4.7 집계

```
mean(xs)          = (xs를 주어진 순서로 더한 합) / n
median(xs)        = 오름차순 정렬 뒤 n이 홀수면 가운데, 짝수면 (가운데 둘의 합) / 2
trimmed_mean(xs,k)= n > 2k 이면 오름차순 정렬 뒤 앞뒤 k개씩 뺀 나머지를 정렬 순서로 더해 평균, 아니면 mean(xs)
popSd(xs)         = sqrt( Σ (x − mean)² / n )   (두 번 지나가는 계산, 주어진 순서. n = 1이면 0)
```

- 심사위원 값은 심사위원 id 오름차순으로 넘깁니다. 정렬은 숫자 비교자 `(a, b) => a − b`이고 안정 정렬입니다.
- `trim`은 1 이상 정수, 기본 1입니다.
- 같은 방식으로 `judge`와 모든 `crit.<key>`를 집계합니다.

### 4.8 진출

`advance`는 `top_n`(정수 ≥ 1), `top_percent`(0 < p ≤ 100, 소수 둘째 자리까지), `min_score`(숫자) 중 **정확히 하나**와 `per`(`track`, `division`의 부분 목록, 기본 `[track]`)입니다.

1. 후보: 참가 팀 중 게이트를 통과했고(`gate`가 null이거나 passed) 채점된(`unscored = false`) 팀입니다. `per`에 `division`이 있으면 부문이 빠진 팀(6.1)도 후보가 아닙니다. 후보가 아닌 팀은 진출하지 않고 `advance_reason`은 4.5의 우선순위로 정한 상태(`GATE_FAILED`, `UNSCORED`, `DIVISION_MISSING`)입니다.
2. `per` 값으로 묶습니다(키 형식은 6.1의 pool 키와 같고 `[]`면 `*`).
3. 묶음 안에서 `score`(4.4 8단계, 반올림 값) 내림차순으로 경쟁 등수(1, 2, 2, 4)를 매깁니다. 진출 비교에는 tie_break를 쓰지 않습니다.
4. 규칙 **[D23]**:
   - `top_n: N` → 등수 ≤ N이면 진출. 경계에서 동점이면 **모두 진출**합니다.
   - `top_percent: p` → `N = max(1, ⌊round(p × 100) × n / 10000⌋)`(`n` = 묶음의 후보 수, 정수 계산) 뒤 `top_n`과 같습니다.
   - `min_score: m` → `score ≥ m`이면 진출.
   - 진출하지 못하면 `BELOW_CUTOFF`.
5. 결정(6.3)의 `{ kind: "advance", stage, team, advanced, reason }`이 있으면 그 값으로 바꾸고 `advance_reason: "DECISION"`입니다. advance 결정이 마지막 단계를 가리키거나 그 단계의 참가 팀이 아닌 팀을 가리키면 stale입니다(6.3).
6. 마지막이 아닌 단계에 `advance`가 없으면 후보가 모두 진출합니다(`RANK`).

다음 단계의 참가 팀은 진출한 팀입니다. 첫 단계의 참가 팀은 입력 팀 전부(exclude(all) 제외)입니다.

### 4.9 최종 점수

최종 단계(마지막 단계)의 참가 팀마다:

1. 실효 최종 설정 = `finalSettings(scoring, 팀의 장소)`(4.1).
2. 변수(3.3)를 만들고 식이 있으면 `validateAst(ast, variableSet(…))` 뒤 `evaluate`. 경고는 팀의 결과 경고(DIV0 등, 식 칸 경로 `slot`과 AST 경로 `path` 포함)가 됩니다. 식이 없으면 `score_raw = judge + bonus`. 부문이 정해지지 않은 팀의 식이 검사를 통과하지 못하면 6.8의 FORMULA_UNAVAILABLE 규칙을 따릅니다.
3. `score`와 `tie_break`는 그 팀 순위 묶음의 **비교 설정**(6.1)으로 만듭니다: `score = roundHalfAway(score_raw, P)`, `tie_break[i] = roundHalfAway(그 팀 변수로 계산한 식 i, P)`. 순위 묶음의 장소가 모두 같은 설정이면(보통의 경우) 비교 설정은 팀의 실효 precision·tie_break와 같습니다. 순위 묶음에 들지 않는 팀(부문이 빠진 팀)은 자기 장소의 실효 설정을 씁니다.
4. 상태는 4.5의 우선순위로 정합니다 **[D29]**. GATE_FAILED·UNSCORED·DIVISION_MISSING 팀도 점수는 계산해 보여 주지만 `rank: null`입니다. exclude(all) 팀은 단계 결과가 없으므로 `{ score_raw: 0, score: 0, tie_break: [], slot: null, votes: null, rank: null, excluded: "EXCLUDED" }`로만 싣습니다.
5. 상: UNSCORED 팀은 vote·manual 상만, DIVISION_MISSING 팀은 `<track>`·`*` pool의 상만 후보이고 GATE_FAILED·EXCLUDED 팀은 어떤 상도 받지 않습니다(6.1).

SPEC 7.2의 예시(배점형, 만점 100, 심사위원 A·B·C의 총점 77, 82, 77, `tie_break: [crit.tech, crit.product]`)는 `score = 78.67`(`judge = 236 / 3 = 78.666…`, 반올림하지 않은 값), `tie_break = [32.67, 19]`(`crit.tech = 98 / 3`, `crit.product = (20 + 19 + 18) / 3 = 19`)가 나와야 합니다. `judge`와 `crit.*`는 반올림하지 않은 집계이고 반올림은 `score`와 `tie_break`에만 있으므로(4.10), SPEC 7.2가 "소수 둘째 자리 반올림"으로 적은 78.67과 32.67은 각각 `score`와 `tie_break[0]`의 값입니다. SPEC이 말한 심사위원 A의 `product` 20은 심사위원 한 명의 노드 점수라 출력에 없고 `rubric.test.ts`의 points 계산 사례로 확인합니다.

### 4.10 출력

```ts
export interface StageTeamResult {
  team: string; track: string; division: string | null;
  rubric: string;                       // 실효 루브릭 id
  judge: number;                        // 정규화 뒤 집계(미채점 0)
  judge_raw: number;                    // 정규화 전 집계
  judges: number;                       // 점수 집계에 든 심사위원 수
  abstained: number;
  crit: Record<string, number>;         // 점수 노드 전부, 전위 순서
  critmax: Record<string, number>;
  max_total: number;
  bonus: number;
  bonuses: { id: string; points: number }[];   // 적용된 가산점, id 순서
  score_raw: number;                    // judge + bonus
  score: number;                        // roundHalfAway(score_raw, P)
  gate: { judged: boolean; passed: boolean; yes: number; no: number;
          criteria: { key: string; yes: number; no: number; passed: boolean }[] } | null;
  advanced: boolean | null;             // 마지막 단계는 null
  advance_reason: "RANK" | "MIN_SCORE" | "DECISION" | "GATE_FAILED" | "UNSCORED" | "DIVISION_MISSING" | "BELOW_CUTOFF" | null;
  unscored: boolean;
  warnings: ResultWarning[];            // 이 팀·이 단계의 경고(6.8 순서)
}
export interface StageResult {
  id: string;
  entrants: string[];                   // id 순서
  teams: StageTeamResult[];             // id 순서
  advanced: string[];                   // id 순서(마지막 단계는 [])
  warnings: ResultWarning[];            // 단계 단위 경고(NORMALIZE_FULL_PANEL 등)
}
```

### 4.11 결정성 규칙

- 합산 순서: 기준은 설정 순서(전위), 심사위원은 id 오름차순, 팀은 id 오름차순.
- id 비교는 `a < b ? -1 : a > b ? 1 : 0`(UTF-16 code unit 순서). `localeCompare`를 쓰지 않습니다.
- 표준편차는 모집단 정의, 반올림은 `roundHalfAway`.
- 객체를 순서의 근거로 쓰지 않습니다. 팀 id를 키로 한 객체를 순회하지 않고 정렬한 배열을 씁니다(`"7"` 같은 정수 모양 키는 객체 순서가 바뀌기 때문입니다).
- 입력 배열의 순서를 쓰지 않습니다. 원점수 행은 `seq`, 팀은 id, 결정은 6.3의 키, 경고는 6.8의 키로 정렬합니다.
- 결과 객체는 타입에 적힌 키 순서대로 만듭니다.

### 4.12 실효 루브릭과 입력 검사 helpers (rules 번들)

```ts
export interface Place { track: string; division: string | null }
export type StageCore = Pick<NStage, "id" | "rubric" | "aggregate" | "require_complete" | "overrides">;
export interface StageSettingsInput { rubrics: Record<string, NRubric>; stages: readonly StageCore[] }
export interface StageSettings { rubric_id: string; rubric: NRubric; aggregate: NStage["aggregate"]; require_complete: boolean }
export function stageSettings(scoring: StageSettingsInput, stage: string, place: Place): StageSettings;

export type ScoreEntryCode = "UNKNOWN_CRITERION" | "NOT_NUMBER" | "OUT_OF_RANGE" | "OFF_STEP" | "GATE_VALUE" | "ABSTAIN_VALUE";
export type ScoreEntryCheck =
  | { ok: true }
  | { ok: false; code: ScoreEntryCode; params: { key: string; min?: number; max?: number; step?: number } };
export function checkScoreEntry(rubric: NRubric, criterion: string, value: unknown): ScoreEntryCheck;

export interface JudgeTotal {
  total: number;               // 입력한 점수 리프만으로 계산(빈 칸은 min)
  max_total: number;
  filled: number; leaves: number; complete: boolean;
  gates: Record<string, 0 | 1 | null>;
}
export function judgeTotal(rubric: NRubric, values: Record<string, number | null>): JudgeTotal;
```

- **`stageSettings`**: 단계 덮어쓰기 규칙의 원본입니다. 단계 `stage`의 기본값(`rubric`, `aggregate`, `require_complete`)에서 시작해 `overrides`를 목록 순서로 보며 `when`에 적힌 키가 모두 맞는 항목에 적힌 키로 덮습니다(4.1, **[D83]**). 모르는 단계나 루브릭이면 `E_CONFIG`입니다. 입력은 `_config`의 `scoring`이나 `event.json`의 `scoring`(배정 규칙 없음) 어느 쪽이든 됩니다. `scoreStage`, `variableSet`, `stageLockFingerprint`, 백엔드의 점수 저장 검사, 심사 화면이 모두 이 함수로 팀의 실효 루브릭을 고릅니다.
- **`checkScoreEntry`**(검사 순서): `criterion`이 `@abstain`도 실효 루브릭의 리프도 아니면 UNKNOWN_CRITERION입니다. `value === null`이면 `{ ok: true }`(칸 지우기, 기권 취소)를 돌려줍니다. `@abstain`이면 0, 1만 ok이고 그 밖은 ABSTAIN_VALUE입니다. 리프일 때는 유한한 숫자가 아니면 NOT_NUMBER, 게이트 리프에 0·1이 아니면 GATE_VALUE, 범위 밖이면 OUT_OF_RANGE, step 위가 아니면 OFF_STEP입니다. `-0`은 0으로 봅니다. 4.3의 행 검사와 같은 규칙이라 백엔드가 받아들인 값은 집계에서 빠지지 않습니다.
- 백엔드는 `stageSettings`로 팀의 실효 루브릭을 고른 뒤 `checkScoreEntry`로 저장 전에 거절하고(문장은 `rules.<lang>.json`의 `score_entry.*`, 7.7) 심사 화면은 같은 루브릭으로 `judgeTotal`을 표시용으로만 보여 줍니다(SPEC 7.5).

---

## 5. 가산점

SPEC 7.1 "가산점", DIV-8.

```yaml
bonuses:                       # 맵. key = 가산점 id(Ident)
  foreign_member:
    name: { ko: 외국인 팀원 }     # Localized, 선택
    stage: screening             # 단계 id. 단계가 하나면 생략할 수 있고 그 단계(축약형이면 main)
    when: { field: foreign_national, eq: true }
    team_rule: any_member        # 7.4의 정량자, 기본 any_member
    points: 3                    # 0이 아닌 수, |points| ≤ 1e6. 음수는 감점
    explain: { ko: "외국인 팀원이 1명 이상이면 서류 심사에 3점을 더합니다." }
```

```ts
export interface BonusResult { total: number; applied: { id: string; points: number }[]; missing_members: boolean }
export function computeBonuses(config: NormalizedConfig, stage: string, team: TeamInput): BonusResult;
```

- 그 단계를 가리키는 가산점을 id 오름차순으로 봅니다. 트랙이 `unit: individual`이면 팀원 하나에게 `when`만, 아니면 `teamRuleHolds(team_rule, when, members)`(7.4)로 판정하고 맞으면 `points`를 한 번 더합니다(팀원 수만큼 더하지 않음). `total`은 id 순서의 합입니다.
- 팀원 정보가 없으면 가산점을 주지 않고 `missing_members: true`, MEMBERS_MISSING 경고입니다. 팀원 정보가 없는 경우는 `members`가 `null`·`undefined`·`[]`이거나, individual 트랙인데 팀원이 정확히 1명이 아닐 때입니다(빈 목록을 조용히 "가산점 없음"으로 처리하지 않음).
- 명단은 결과를 계산하는 시점에 MCP가 넘긴 것을 씁니다. 부문처럼 고정하지 않습니다.
- 공개 `event.json`에 이름, 단계, 점수, 설명, 조건이 실립니다(조건은 질문 key와 보기 값뿐이라 개인정보가 아닙니다).

---

## 6. 순위, 동점, 상

SPEC 7.4, RES-1~10.

### 6.1 pool과 순위 묶음

- **pool**은 순위를 매기는 팀 묶음입니다. 키는 `*`(전체), `<track>`, `<track>/<division>`입니다. 득표 순위 pool은 `vote:<pool>`이고 식형 상의 pool은 사다리에 든 상이면 `formula:ladder:<사다리 id>`, 사다리가 없는 상이면 `formula:prize:<상 id>`입니다. 사다리 id와 상 id는 같은 글자일 수 있으므로(사다리 `best_ai`와 사다리 없는 상 `best_ai`), 둘을 접두어로 나눠 한 키가 서로 다른 식의 순위를 함께 쓰지 않게 합니다.
- **순위 묶음**(`final.rank_groups`)은 결과 표의 등수와 득표 통계(3.4)에 쓰는 pool입니다. 값을 `rank_groups` 순서대로 `/`로 잇습니다. `[track, division]`이면 `hack/student` 또는(부문이 없는 트랙) `hack`, `[track]`이면 `hack`, `[]`이면 `*`입니다.
- **상은 자기 scope의 pool에서 순위를 다시 매깁니다** **[D28]**. `scope: { track: hack }`이고 `rank_groups: [track, division]`이면 그 상은 부문을 섞은 `hack` pool에서 순위를 냅니다.
- **pool 키마다 순위는 하나입니다** **[D75]**. `computeResults`는 pool 키마다 `rankEntries`를 한 번만 부르고 그 `RankOutcome`을 결과 표와 그 키의 모든 상이 함께 씁니다(같은 키의 pool은 순위와 결정을 함께 씀). 순위를 매기는 대상은 아래의 pool 구성원 전체(거르기 전)입니다. 상의 opt_in·eligible로 걸러진 팀은 등수를 그대로 둔 채 그 상의 후보에서만 빠집니다(6.6).
- **pool 구성원.** 키 `K`의 scope에 맞는 최종 단계 참가 팀 중 상태(4.5)가 `EXCLUDED`·`GATE_FAILED`가 아닌 팀입니다. 순위형 pool(`K`, `formula:…`)은 그중 채점된 팀(`UNSCORED` 아님)만 순위에 넣고 득표형 pool(`vote:K`)은 득표가 0보다 큰 팀을 넣습니다(심사위원이 빠뜨린 팀도 인기상은 받을 수 있음). exclude(prizes) 팀은 순위에는 들고 모든 상에서 `EXCLUDED`로 건너뜁니다. 결과 표의 순위 묶음도 같은 규칙이라, 결과 표에서는 `excluded`가 아닌 팀만 등수가 있습니다(게이트 탈락, 미채점, exclude(all), 부문이 빠진 팀은 `rank: null`).
- **pool의 비교 설정** **[D73]**: pool이 덮는 장소(0.2의 장소 목록 중 pool의 scope에 드는 것)의 실효 tie_break와 precision이 모두 같으면 그 설정을 씁니다. tie_break는 길이가 같고 차례로 AST가 구조적으로 같으면 같은 것으로 봅니다. 비교는 runtime의 `sameAst(a, b)`(`formula/ast.ts`)가 노드 종류, 연산자, 함수 이름, 숫자 값, 변수 이름, 자식을 차례로 견주어 합니다. 재귀 깊이는 AST 한도(32) 안입니다. `hashOf`(11.4)는 Node 전용이라 runtime에서 쓰지 않습니다. 하나라도 다르면 그 pool에서는 덮어쓰기 전의 `final.tie_break`와 `final.precision`을 쓰고 check는 V18 경고 TIE_BREAK_MIXED를 냅니다(V4는 이 pool의 모든 장소에서 기본 tie_break를 컴파일합니다). pool의 모든 팀(부문이 빠진 팀 포함)은 이 설정으로 `score`(그 팀 `score_raw`를 이 precision으로 반올림)와 `tie_break`(그 팀 변수로 이 식들을 계산해 반올림)를 만들어 `rankEntries`에 넣습니다. 그래서 한 pool 안의 비교는 언제나 같은 길이의 사전식 순서이고 입력 순서와 관계없이 같은 등수가 나옵니다. formula 상은 늘 덮어쓰기 전 `final.precision`으로 반올림하고 tie_break를 쓰지 않습니다. vote 상은 득표 그대로 비교합니다.
- **부문이 빠진 팀** **[D78]**: 부문이 있는 트랙에서 `division`이 null인 팀(입력에서 null이거나 DIVISION_INVALID로 null이 된 팀)은 blocking `DIVISION_MISSING`(막음)입니다. `rank_groups`에 `division`이 있으면 결과 표의 어느 순위 묶음에도 넣지 않고(`rank: null`, `excluded: "DIVISION_MISSING"`, 득표 변수는 모두 0), `advance.per`에 `division`이 있으면 진출 묶음에도 넣지 않습니다(4.8). `<track>`과 `*` pool의 상 후보로는 남습니다. 다만 그 팀의 장소 `(track, null)`은 장소 목록(0.2) 밖이라 V4가 검사하지 않았으므로, 그 팀의 변수로 실효 최종 식, pool의 비교 식, 상의 식 중 하나라도 `validateAst`를 통과하지 못하면(그 장소의 루브릭에 없는 기준을 읽는 등) 던지지 않고 그 팀을 모든 pool에서 빼며 FORMULA_UNAVAILABLE 경고를 남깁니다(6.8) **[D116]**. 이 팀은 이미 공개를 막고 있으므로 공개된 결과에는 영향이 없습니다. teams_plan으로 부문을 정하면 풀립니다. 혼자 든 가짜 순위 묶음에서 1등이 되거나 혼자인 묶음의 득표 통계(평균 득표 = 자기 득표)로 점수가 계산되는 일을 막으려는 것입니다.

### 6.2 순위 매기기

```ts
export interface RankInput { team: string; score: number; tie_break: number[] }
export interface RankedEntry extends RankInput { rank: number; decided: boolean }
export interface RankOutcome { pool: string; entries: RankedEntry[]; ties: TieTrace[]; stale: StaleDecision[] }
export function rankEntries(pool: string, entries: RankInput[], decisions: Decision[], tie_break_sources: string[]): RankOutcome;
```

1. 입력 검사: `team`이 유일하고 모든 항목의 `tie_break` 길이가 `tie_break_sources`의 길이와 같아야 합니다(아니면 `E_INPUT`). 6.1의 비교 설정이 이를 보장합니다.
2. 정렬: `score` 내림차순 → `tie_break[0]` 내림차순 → … → 같으면 team id 오름차순(표시 순서일 뿐 등수에 영향 없음) **[D30]**. 숫자가 아니거나 NaN이면 가장 낮은 값으로 봅니다(JSON을 거친 `null` 대비, v1과 같음).
3. 경쟁 등수(1, 2, 2, 4): 앞 팀과 `score`와 모든 `tie_break`가 같으면 같은 등수, 아니면 `i + 1`.
4. 결정 적용: 이 pool의 `tie_order` 결정(6.3의 충돌 검사를 거친 것)마다, 같은 등수 묶음의 팀 집합이 결정의 `teams` 집합과 **정확히 같으면** 그 순서로 다시 놓고 등수를 `r, r+1, …`로 매기고 `decided: true`입니다. 어떤 묶음과도 맞지 않는 결정은 `stale`(STALE_DECISION 경고)입니다.
5. 동점 추적(`ties`): 반올림한 `score`가 같은 팀이 둘 이상인 묶음마다 아래를 남깁니다.

```ts
export interface TieTrace {
  pool: string;
  teams: string[];                      // id 순서
  score: number;
  steps: { by: string; source: string; values: { team: string; value: number }[]; split: boolean }[];
          // by: "tie_break[0]" …, source: tie_break_sources[i], values: teams 순서, split: 이 단계에서 묶음이 갈렸는지
  outcome: "tie_break" | "decision" | "tied" | "unresolved" | "shared_award" | "shared";
}
```

`rankEntries`가 내는 `outcome`은 `tie_break`(사다리로 갈림), `decision`(tie_order로 갈림), `tied`(끝까지 같음) 셋입니다. `computeResults`는 배분(6.6) 뒤 `tied`를 `unresolved`(manual이고 상 경계에서 결정이 필요함), `shared_award`(share이고 상 경계에서 공동 수상), `shared`(같은 등수로 남았지만 상 경계가 아님) 중 하나로 바꿉니다.

### 6.3 동점 처리와 결정

끝까지 같은 등수가 남은 팀은 같은 등수로 표시합니다. 결정은 **상의 경계에 걸린 동점**에만 필요합니다 **[D31]**. 무작위(추첨)는 없습니다.

- `unresolved_tie: manual`(기본): 상 경계 동점은 `unresolved`에 올리고 그 상은 `pending_tie`, 결과는 공개할 수 없습니다(`publishable: false`). 운영진이 `results_plan`으로 `tie_order` 결정을 기록하면 풀립니다.
- `unresolved_tie: share`: 경계의 동점 팀이 모두 그 상을 받고 `shared: true`, 상에는 `tie_expanded: true`가 붙습니다. 뒤 상의 수는 줄지 않습니다(다음 상은 다음 팀부터, v1과 같음) **[D32]**.

**결정**(입력, `results_plan`이 기록, 스냅샷에 남음) **[D35]**:

```ts
export type Decision = DecisionMeta & (
  | { kind: "tie_order"; pool: string; teams: string[] }            // 동점 묶음 전체를 원하는 순서로
  | { kind: "manual_award"; prize: string; teams: string[] }        // method: manual 상의 수상 팀
  | { kind: "vacate"; prize: string }                               // 상을 비움(allow_vacant일 때만)
  | { kind: "advance"; stage: string; team: string; advanced: boolean }
  | { kind: "exclude"; team: string; scope: "prizes" | "all" }      // 수상 정정·실격(RES-8)
);
export interface DecisionMeta { id?: string; reason: string; by?: string; at?: Iso }
// reason 1~500자 필수. by는 운영자 내부 id(0.2)이고 이메일 모양이면 E_INPUT [D93]
export interface StaleDecision { decision: Decision; reason: StaleReason }
export type StaleReason =
  | "DECISION_CONFLICT"   // 같은 대상에 내용이 다른 결정이 있음(아래 대상 키와 충돌)
  | "UNKNOWN_TARGET"      // 모르는 상·팀·단계·pool을 가리킴
  | "VACATE_NOT_ALLOWED"  // allow_vacant: false인데 vacate
  | "NOT_MANUAL"          // method가 manual이 아닌 상의 manual_award
  | "MANUAL_INVALID"      // 6.6 7단계의 manual_award 검사에 걸림
  | "LAST_STAGE"          // 마지막 단계를 가리키는 advance
  | "NOT_ENTRANT"         // 그 단계의 참가 팀이 아닌 팀의 advance
  | "NO_MATCHING_TIE";    // 어떤 동점 묶음과도 팀 집합이 맞지 않는 tie_order(6.2)
```

- `exclude`의 `scope: "all"`은 첫 단계부터 참가 팀에서 빼고(`excluded: "EXCLUDED"`), `"prizes"`는 순위에는 두되 모든 상에서 건너뜁니다(`EXCLUDED`).
- **대상 키와 충돌** **[D74]**: 결정의 대상 키는 tie_order = pool + 정렬한 teams, manual_award·vacate = prize, advance = stage + team, exclude = team입니다. 같은 대상 키의 결정이 둘 이상일 때, 내용(kind와 값. meta는 빼고 tie_order는 teams의 순서까지)이 모두 같으면 하나로 보고 meta는 (reason, id) 순서로 가장 앞선 것을 남깁니다. 내용이 다르면 그 대상의 결정을 하나도 적용하지 않고 모두 `stale`(reason `DECISION_CONFLICT`)로 두며 blocking에 `{ code: "DECISION_CONFLICT" }`를 올립니다. 결정을 바꿀 때 results_plan은 이전 결정을 뺀 목록을 넘깁니다.
- **`E_INPUT`**: reason이 비었거나 500자를 넘음, kind를 모름, `by`·`at`이 0.2의 규칙을 어김, tie_order·manual_award의 `teams`가 비었거나 같은 id가 두 번 있음.
- **stale**: 모르는 상·팀·단계·pool을 가리킴, `allow_vacant: false`인데 `vacate`, `manual`이 아닌 상의 `manual_award`, 6.6의 manual_award 검사에 걸림, 마지막 단계를 가리키는 advance, 그 단계의 참가 팀이 아닌 팀의 advance, 어떤 동점 묶음과도 맞지 않는 tie_order(6.2). 사유마다 위 `StaleReason`의 코드 하나를 씁니다 **[D74]**. 한 결정이 여러 사유에 걸리면 위 목록에서 앞에 있는 코드입니다.
- **순서**: `decisions.applied`와 `stale`은 (kind: tie_order → manual_award → vacate → advance → exclude, 대상 키, reason) 순서로 정렬합니다. 입력 배열의 순서와 무관합니다.

### 6.4 상 엔티티

```yaml
prizes:                                  # key 목록(병합 key: id). 순서 = 배분 순서
  - id: hack_student_1                   # ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$, 금지 이름 아님(0.2)
    name: { ko: 해커톤 학생부 대상 }      # Localized, 선택
    scope: { track: hack, division: student }   # overall | sponsor | special | { track } | { track, division }
    place: 1                             # 표시용 등수, 기본 1
    count: 1                             # 받을 팀 수, 기본 1
    method: rank                         # rank | vote | manual | formula
    formula: null                        # method: formula일 때만, 필수
    ladder: null                         # 사다리 id(Ident). 기본은 아래 [D79]
    opt_in: false                        # true면 제출할 때 이 상(사다리)에 지원한 팀만
    requires_addon: null                 # add-on id. method: vote는 popular_vote가 암묵적으로 필요
    eligible: null                       # { when: Cond, team_rule: TeamRule } 자격 필터 [D38]
    amount: 500000                       # 수상 팀 하나당 표시용 금액(0 이상), 지급하지 않음(NG2) [D114]
```

| 키 | 정규형 | 규칙 |
| --- | --- | --- |
| `scope` | `"overall" \| "sponsor" \| "special" \| { track, division: string \| null }` | `overall`·`sponsor`·`special`의 pool은 `*`입니다. 셋의 차이는 사이트의 표시 묶음과 사다리 기본값뿐입니다 **[D33]** |
| `place` | 정수 ≥ 1 | 표시용. 배분은 `place`가 아니라 목록 순서로 합니다. 같은 사다리의 상이 목록 순서로 `place`가 줄어들면 V19 경고 |
| `count` | 정수 ≥ 1 | |
| `method` | | `rank`: pool의 최종 점수 순위. `vote`: `vote:<pool>`의 득표 순위. `manual`: 결정의 `manual_award`. `formula`: 이 상의 식으로 매긴 `formula:ladder:<사다리 id>` 또는 `formula:prize:<상 id>` 순위(6.1) |
| `amount` | `number \| null` | **수상 팀 하나당** 표시용 금액입니다 **[D114]**. `{ place: 2, teams: 2, amount: 300000 }`이면 두 팀이 각각 300,000입니다(한국 공모전 공고의 "우수상 2팀, 각 30만 원"과 같은 뜻). 공개 결과(6.10)는 상마다 이 값 하나와 수상 팀 목록을 싣고 사이트는 수상 팀마다 이 금액을 보여 줍니다. share 동점으로 수상 팀이 늘면(`tie_expanded`) 늘어난 팀도 같은 금액으로 보입니다. 상금 합계(결정 반영의 예산 대조, SPEC DEC-4)는 `Σ amount × count`(계획 기준)로 계산하고 결과 미리보기는 실제 수상 팀 수로 다시 셉니다 |
| `formula` | `Formula \| null` | 변수는 최종 식과 같음(3장) |
| `ladder` | `string \| null`(정규형은 기본값을 채움) | **사다리**: 같은 사다리의 상끼리 앞 상을 받은 팀을 뒤 상에서 건너뜁니다(1등과 2등이 같은 팀이 되지 않게, 6.6 4단계) **[D79]**. 기본값은 `method`가 rank·vote이고 scope가 `overall`·`{track}`·`{track, division}`이며 `opt_in`이 거짓이고 `eligible`이 없으면 `"<method>:<pool>"`, 그 밖(manual, formula, sponsor·special, opt_in, eligible)은 `null`(사다리 없음)입니다. 직접 적으면 그 id로 묶습니다(스폰서 한 곳의 1등·2등 등). 한 사다리의 상은 method, pool, opt_in, eligible, formula가 같아야 하고 manual 상은 사다리를 쓸 수 없습니다(V19) |
| `opt_in` | | opt_in 사다리는 사다리 단위로 지원합니다. 사다리의 상 하나에 지원한 팀은 그 사다리의 모든 상에 지원한 것으로 봅니다 |
| `eligible` | | 팀이 `teamRuleHolds(team_rule, when, members)`를 만족해야 이 상의 후보입니다. 팀원 정보가 없으면 후보가 아니고 MEMBERS_MISSING |

### 6.5 `prize_policy`

```yaml
prize_policy:
  max_per_team: 2          # 정수 ≥ 1 또는 null(제한 없음, 기본)
  exclusive: [[hack_1, popular]]   # 함께 받을 수 없는 상 id 묶음(각 2개 이상)
  allow_vacant: true       # 기본 true. false면 채우지 못한 상이 공개를 막음
```

### 6.6 배분 알고리즘

```ts
export interface PrizeContext {
  final: FinalTeamResult[];                       // 4.9
  vars: Record<string, FormulaVars>;              // 팀 id → 3.3의 변수 값(식 상 계산용)
  rankings: Record<string, RankOutcome>;          // pool 키 → 6.1에서 매긴 순위(결과 표와 공유)
  members: Record<string, TeamMember[] | null>;   // 팀 id → 팀원
  opt_ins: Record<string, string[]>;              // 팀 id → 지원한 상 id
  votes: Record<string, number> | null;
  decisions: Decision[];                          // 6.3의 충돌 검사를 거친 것
}
// 팀 id를 키로 한 입력은 hasOwn으로만 읽습니다(0.1 #9).
export type SkipReason = "EXCLUDED" | "UNSCORED" | "CONSUMED" | "EXCLUSIVE" | "MAX_PER_TEAM" | "NO_VOTES";
export interface PrizeResult {
  id: string; name: Localized | null; scope: NPrizeScope; place: number; count: number;
  method: "rank" | "vote" | "manual" | "formula"; amount: number | null;
  pool: string;                                   // 이 상이 쓴 순위의 키(rank·manual: "<pool>", vote: "vote:<pool>", formula: "formula:ladder:<사다리 id>" 또는 "formula:prize:<상 id>").
                                                  // unresolved.pool과 tie_order 결정의 pool도 이 키
  ladder: string | null;
  status: "awarded" | "partial" | "vacant" | "pending_tie" | "pending_upstream" | "pending_manual" | "pending_votes" | "disabled";
  blocked_by: string | null;                      // pending_upstream이면 원인이 된 상 id
  awards: { team: string; place: number; shared: boolean }[];
  tie_expanded: boolean;
  skipped: { team: string; reason: SkipReason }[];
  filtered: { not_opted_in: number; not_eligible: number };
}
export interface Unresolved { pool: string; prize: string; place: number; rank: number; teams: string[]; eligible: string[]; slots: number }
export interface PrizeAllocation {
  prizes: PrizeResult[]; unresolved: Unresolved[];
  rankings: RankOutcome[];                        // 이 함수가 새로 매긴 pool(formula:…)의 순위, 키 오름차순
  warnings: ResultWarning[]; stale: StaleDecision[];
}
export function allocatePrizes(config: NormalizedConfig, ctx: PrizeContext): PrizeAllocation;
```

상 목록 순서로 하나씩 채웁니다. `held[team]`은 지금까지 받은 상 id 목록이고 `U`는 수상 결과가 아직 정해지지 않은 팀의 집합입니다(처음에는 비어 있음).

1. **꺼짐과 비움**: `requires_addon`(또는 `vote`의 `popular_vote`)이 꺼져 있으면 `disabled`(V19가 막으므로 방어용). 이 상에 `vacate` 결정이 있으면(allow_vacant일 때만 유효) 바로 `vacant`이고 팀을 소비하지 않으므로 다음 상이 위에서부터 채웁니다.
2. **앞 상의 보류** **[D80]**: 앞선 상 중 보류(`pending_tie`, `pending_upstream`, `pending_manual`, `pending_votes`)인 상 `P`가 있고, (a) 이 상이 `P`와 같은 사다리이거나, (b) 이 상의 후보(3단계의 거르기 전 후보)가 `U`와 겹치면서 동시에 `max_per_team`이 null이 아니거나 이 상이 `P`와 같은 `exclusive` 묶음에 있으면, 이 상은 `pending_upstream`, `awards: []`, `blocked_by` = 그런 `P` 중 첫 번째입니다. 이 상의 후보를 `U`에 더하고 다음 상으로 갑니다. manual 상은 이 단계를 건너뜁니다. 결정이 기록되면 처음부터 다시 배분하므로, 미리보기는 결정 뒤에 바뀔 수상을 확정된 것처럼 보이지 않습니다. 영향이 없는 상(다른 사다리이고 상한·배타가 걸리지 않음)은 그대로 배분합니다.
3. **후보 순서**:
   - `rank`: `ctx.rankings[pool]`의 순서(6.1, 채점된 pool 팀). 미채점 팀은 id 순서로 `skipped`의 맨 앞에 `UNSCORED`.
   - `formula`: 채점된 pool 팀마다 이 상의 식을 `ctx.vars`로 계산해 덮어쓰기 전 `final.precision`으로 `roundHalfAway`한 값으로 `rankEntries(키, …)`(tie_break 없음). 키는 사다리가 있으면 `formula:ladder:<사다리 id>`, 없으면 `formula:prize:<상 id>`입니다(6.1). 같은 키의 순위가 이미 있으면(같은 사다리의 앞 상) 그 순위를 씁니다. 한 사다리의 상은 식이 같으므로(V19) 이렇게 다시 써도 같은 식의 순위입니다. 미채점 팀은 `UNSCORED`로 건너뜁니다.
   - `vote`: `votes`가 없으면 `pending_votes`(막음, VOTES_MISSING)이고 pool 팀을 `U`에 더합니다. 있으면 `ctx.rankings["vote:<pool>"]`(득표 내림차순, tie_break 없음)입니다. 득표 0인 팀은 후보가 아니고 `skipped`에 `NO_VOTES`로 남깁니다 **[D34]**.
   - `manual`: 7단계로 갑니다.
   - **거르기**(rank·vote·formula): `opt_in`이면 이 상(사다리면 그 사다리의 어느 상)에 지원하지 않은 팀, `eligible`이 있으면 만족하지 않는 팀을 후보에서 뺍니다. 등수는 그대로이고 `filtered`에 수만 셉니다 **[D75]**.
4. **건너뛰기**: `need = count`. 후보를 같은 등수 묶음 단위로 앞에서부터 봅니다. 묶음마다 아래 순서로 건너뛸 팀을 빼고 `skipped`에 남깁니다: `EXCLUDED`(exclude(prizes) 결정) → `CONSUMED`(같은 사다리의 앞선 상을 이미 받음) → `EXCLUSIVE`(`exclusive` 묶음의 다른 상을 받음) → `MAX_PER_TEAM`(`held` 수가 상한).
5. **경계**: 남은 묶음 `B`가 `|B| ≤ need − 받은 수`면 모두 수상합니다. 아니면 **경계 동점**입니다. `tie_order` 결정이 있었다면 6.2에서 이미 등수가 갈려 이런 묶음이 생기지 않습니다.
   - `unresolved_tie: share`면 `B` 전부 수상(`shared: true`, `tie_expanded: true`).
   - `manual`이면 `unresolved`에 `{ pool, prize, place, rank, teams, eligible: B, slots: need − 받은 수 }`를 올리고 `pending_tie`로 이 상을 멈추며(막음) `B`를 `U`에 더합니다. `teams`는 그 pool에서 같은 등수인 묶음 전체(걸러진 팀과 건너뛴 팀 포함, id 순서)이고 `eligible`은 그중 거르기와 건너뛰기를 통과한 팀입니다. `tie_order` 결정은 이 `teams`를 모두 적어야 합니다(6.2 4단계가 등수 묶음 전체와 비교하기 때문). 미리보기에서 누가 걸렸는지 보이도록 `awards`에는 경계 앞까지만 넣습니다. 경계 앞의 수상 팀에는 9단계(`held` 갱신)를 그대로 적용합니다. 이 팀들은 결정과 관계없이 이 상을 받으므로, 뒤 상의 `max_per_team`·`exclusive` 판정에 들어가야 미리보기가 상한을 넘겨 배분하지 않습니다 **[D80]**.
6. 후보가 다 떨어지면 멈춥니다.
7. **manual 상** **[D81]**: `manual_award` 결정이 없으면 `pending_manual`(막음)이고 pool 구성원(6.1)을 `U`에 더합니다. 결정이 있으면 검사합니다. `teams`가 `count` 이하이고, 모든 팀이 이 상의 pool에 있고, 상태가 GATE_FAILED·EXCLUDED가 아니고 exclude(prizes)도 아니며, `opt_in`이면 지원했고, `eligible`이 있으면 만족해야 합니다(빈 목록·중복은 6.3의 `E_INPUT`). 하나라도 어기면 결정 전체가 stale이고 상은 `pending_manual`입니다. 통과하면 그 팀들이 결정에 적힌 순서로 수상합니다(`place`는 상의 `place`). 수상이 `max_per_team`이나 `exclusive`를 어기면 적용하고 MANUAL_POLICY_CONFLICT 경고만 냅니다 **[D36]**. 미채점 팀도 받을 수 있습니다.
8. **결과 상태**: 받은 수가 0이면 `vacant`, `count`보다 적으면 `partial`, 아니면 `awarded`. `allow_vacant: false`인데 `vacant`·`partial`이면 PRIZE_UNFILLED(막음), `allow_vacant`면 PRIZE_VACANT info.
9. 수상 팀의 `held`에 이 상을 더합니다.

### 6.7 트랙 상금표 축약형

v1의 `tracks.<id>.prizes`는 `method: rank` 상의 축약형으로 계속 받습니다(SPEC 7.4). 병합 뒤 정규화(8.6)에서 바꿉니다 **[D37]**.

- 목록 `[{ place, teams, amount?, label? }]`: 트랙에 부문이 있고 `final.rank_groups`에 `division`이 있으면 트랙의 부문마다(트랙 `divisions` 순서) `{ id: "<track>_<division>_p<n>", scope: { track, division }, … }`, 아니면 `{ id: "<track>_p<n>", scope: { track } }`. `n`은 그 표의 1부터 센 행 번호입니다.
- 맵 `{ <division>: [ … ] }`: 부문마다 `{ id: "<track>_<division>_p<n>", scope: { track, division } }`.
- 행 → 상: `place → place`, `teams → count`, `amount → amount`, `label → name`, `method: rank`. 사다리는 기본값(`rank:<pool>`)이라 한 표의 1등·2등은 같은 사다리입니다.
- 순서: 축약형에서 나온 상(트랙 순서 → 표 순서)이 먼저, 그다음 `prizes`의 상입니다. 트랙 순서는 8.3의 정의(`order` 오름차순, `order`가 같거나 없으면 id 순서이고 `order`가 없는 트랙은 뒤)입니다 **[D118]**. 둘을 함께 쓰면 V19 경고("트랙 상금표의 상이 먼저 배분됩니다").
- 맵 형식은 `rank_groups`에 `division`이 있을 때만 쓸 수 있습니다(V5, v1과 같음).

### 6.8 `computeResults`

```ts
export interface TeamInput {
  id: string;                        // 0.2의 팀 id 규칙, 입력 안에서 유일(아니면 E_INPUT)
  track: string;
  division: string | null;           // 고정된 부문(7.6의 DivisionRecord.division)
  members?: TeamMember[] | null;     // 가산점·상 자격에 필요. 50명 이하(아니면 E_INPUT)
  opt_ins?: string[];                // 제출할 때 지원한 상 id
}
export interface ResultsInput {
  teams: TeamInput[];
  rows: RawScoreRow[];
  assignments?: Assignment[] | null;
  votes?: Record<string, number> | null;   // popular_vote의 유효 득표(백엔드가 변조 검증을 마친 수)
  decisions?: Decision[];
  epochs?: Record<string, number>;         // 단계 id → 현재 epoch(4.3), 없는 단계는 0
}
export interface FinalTeamResult {
  team: string; track: string; division: string | null;
  group: string | null;              // 순위 묶음 키(부문이 빠져 묶음이 없으면 null)
  score_raw: number; score: number; tie_break: number[];   // score·tie_break는 순위 묶음의 비교 설정(6.1)으로
  slot: string | null;               // 적용된 식 칸 경로("scoring.final.formula", "scoring.final.overrides[0].formula") 또는 null(finalSettings의 slot과 같은 이름) [D118]
  votes: { votes: number; total_votes: number; avg_votes: number; max_votes: number; team_count: number; popular: number } | null;
  rank: number | null;               // 순위 묶음 안의 등수
  excluded: null | "EXCLUDED" | "GATE_FAILED" | "UNSCORED" | "DIVISION_MISSING";
  warnings: ResultWarning[];
}
export interface ResultsComputation {
  stages: StageResult[];
  final: { teams: FinalTeamResult[]; groups: { key: string; teams: string[] }[] };   // groups: 키 오름차순, teams: 등수 순
  rankings: RankOutcome[];           // 결과 표와 상이 쓴 모든 pool, 키 오름차순
  prizes: PrizeResult[];
  ties: TieTrace[];                  // pool 키, 등수 순서
  unresolved: Unresolved[];
  decisions: { applied: Decision[]; stale: StaleDecision[] };   // 6.3의 순서
  warnings: ResultWarning[];         // 모든 경고(아래 순서)
  blocking: { code: "UNRESOLVED_TIE" | "MANUAL_PRIZE_PENDING" | "PRIZE_UNFILLED" | "VOTES_MISSING" | "DECISION_CONFLICT" | "DIVISION_MISSING";
              prize?: string; pool?: string; team?: string; message: string }[];
  publishable: boolean;              // blocking이 비었을 때만 true
}
export function computeResults(config: NormalizedConfig, input: ResultsInput): ResultsComputation;
```

막는 문제의 코드는 상과 결정의 상태에서 이렇게 나옵니다. `UNRESOLVED_TIE`는 `unresolved` 항목마다(상은 `pending_tie`), `MANUAL_PRIZE_PENDING`은 `pending_manual`인 상마다, `PRIZE_UNFILLED`는 `allow_vacant: false`인데 `vacant`·`partial`인 상마다, `VOTES_MISSING`은 `pending_votes`인 상이 있거나 식이 인기투표 변수를 쓰는데 `votes`가 없을 때 한 번, `DECISION_CONFLICT`는 충돌한 대상마다(6.3), `DIVISION_MISSING`은 부문이 빠진 팀마다(6.1)입니다. `pending_upstream`인 상은 원인이 된 상(`blocked_by`)이 이미 막고 있으므로 따로 올리지 않습니다 **[D68]**.

순서: ① 입력 검사(`E_INPUT`: 팀 id 규칙·중복, `TeamMember.id` 규칙과 팀원 50명 이하, `seq` 정수와 중복, `epoch`가 있으면 0 이상 정수, 결정의 모양(6.3)) ② 트랙이 없는 팀은 TEAM_UNKNOWN_TRACK으로 빼고 트랙에서 열리지 않는 부문은 DIVISION_INVALID로 `null` ③ 원점수 행의 1단계 검사(4.3)와 단계별 나누기 ④ 결정의 충돌 검사(6.3) ⑤ exclude(all) 제외(그 팀의 원점수 행은 경고 없이 뺌) ⑥ 단계를 차례로 `scoreStage` ⑦ 최종 점수(4.9)와 득표 통계(3.4) ⑧ pool 키마다 `rankEntries`(6.1) ⑨ `allocatePrizes` ⑩ 동점 추적의 outcome 확정, 막는 문제, 공개 가능 여부, 경고 정렬.

**출력 순서** **[D74]**: `warnings`와 팀·단계별 `warnings`는 (출처: 입력 → 행 → 단계 → 팀 → 최종 → 상 → 결정, 단계는 설정 순서, team id, judge id, criterion, 상은 목록 순서, code, path) 순서로 정렬합니다. 출처는 아래 표에 있습니다. `decisions.applied`·`stale`은 6.3의 순서입니다. 그래서 출력은 입력 배열의 순서와 무관합니다(13.5).

**결과 경고**(코드 목록은 이 문서가 정함 **[D68]**):

```ts
export interface ResultWarning {
  code: ResultWarningCode; severity: "warning" | "info";
  origin: "input" | "row" | "stage" | "team" | "final" | "prize" | "decision";
  stage?: string; team?: string; judge?: string; criterion?: string; prize?: string; pool?: string;
  slot?: string; path?: string;      // 수식 경고: 식 칸 경로와 AST 경로
  message: string;
}
```

| 코드 | 심각도 | 출처 | 메시지(예) |
| --- | --- | --- | --- |
| TEAM_UNKNOWN_TRACK / DIVISION_INVALID / DIVISION_MISSING | warning | input | 팀 {team}의 트랙 "{t}"가 설정에 없어 결과에서 뺐습니다. / 팀 {team}의 부문 "{d}"가 트랙에서 열리지 않아 부문 없음으로 봤습니다. / 팀 {team}의 부문이 정해지지 않았습니다. 부문을 정하기 전에는 결과를 공개할 수 없습니다. |
| VOTES_INVALID | warning | input | 팀 {team}의 득표가 올바른 수가 아니라 0으로 봤습니다. |
| ROW_UNKNOWN_STAGE / ROW_UNKNOWN_TEAM / ROW_NOT_ENTRANT / ROW_UNKNOWN_CRITERION / ROW_UNASSIGNED | warning | row | 원점수 행을 집계에서 뺐습니다: {이유}. |
| ROW_STALE | info | row | {stage} 단계를 다시 채점하기 전의 원점수 행 {n}개를 집계에서 뺐습니다. |
| SCORE_NOT_NUMBER / SCORE_OUT_OF_RANGE / SCORE_OFF_STEP | warning | row | 심사위원 {judge}의 팀 {team} "{criterion}" 점수가 {범위·단위} 밖이라 집계에서 뺐습니다. |
| NORMALIZE_FALLBACK | info | stage | 심사위원 {judge}는 채점 수가 {n}개(기준 {min_entries}개)이거나 점수가 모두 같아 평균만 맞췄습니다. |
| NORMALIZE_CLAMPED | info | stage | 심사위원 {judge}의 팀 {team} 총점이 정규화 뒤 척도 밖이라 {경계}로 맞췄습니다. |
| NORMALIZE_FULL_PANEL | warning | stage | {stage} 단계는 모든 심사위원이 모든 팀을 채점해 정규화의 효과가 거의 없습니다. |
| UNSCORED | warning | team | {stage} 단계에서 팀 {team}을 집계할 채점표가 없습니다. 최종 단계면 순위와 순위형·식형 상에서 빠집니다. |
| FORMULA_UNAVAILABLE | warning | team | 팀 {team}은 부문이 정해지지 않아 {slot} 식을 계산할 수 없어 순위와 상 후보에서 뺐습니다. 부문을 정하면 다시 계산합니다. |
| MISSING_SHEET | warning | team | 심사위원 {judge}가 {stage} 단계에서 팀 {team}을 채점하지 않았거나 빈칸이 있습니다. |
| ABSTAINED | info | team | 심사위원 {judge}가 팀 {team} 채점을 기권했습니다. |
| FEWER_JUDGES | warning | team | 팀 {team}은 심사위원 {n}명 기준인데 {m}명만 집계되었습니다. |
| GATE_TIE | warning | team | 팀 {team}의 게이트 "{key}"가 {yes}:{no} 동수라 탈락으로 봤습니다. |
| GATE_NO_VOTES | warning | team | 팀 {team}의 게이트 "{key}"에 표가 없어 탈락으로 봤습니다. |
| MEMBERS_MISSING | warning | team(가산점) / prize(상 자격) | 팀 {team}의 팀원 정보가 없어 가산점·상 자격을 판정하지 않았습니다. |
| DIV0 / SQRT_NEG / NONFINITE | warning | final | 팀 07의 scoring.final.formula에서 0으로 나누는 계산이 있어 0으로 처리했습니다($.b.a[1]). / 음수의 제곱근을 계산하려 해 0으로 처리했습니다. / 값이 너무 커지거나 정의되지 않아 0으로 처리했습니다. |
| PRIZE_VACANT | info | prize | 상 {prize}이(가) {n}자리 비었습니다. |
| MANUAL_POLICY_CONFLICT | warning | prize | 수동 지정 상 {prize}이(가) 상 정책({정책})과 맞지 않지만 기록대로 적용했습니다. |
| STALE_DECISION | warning | decision | 기록된 결정을 적용하지 못했습니다: {이유}. 결과가 바뀌었다면 다시 결정해 주세요. / 같은 대상에 서로 다른 결정이 있어 어느 것도 적용하지 않았습니다. |

경고에는 팀·심사위원의 내부 id만 쓰고 이름이나 이메일은 쓰지 않습니다. `modules.judge: false`이면 모든 팀이 미채점이므로 UNSCORED를 내지 않습니다(8.10). FORMULA_UNAVAILABLE은 부문이 있는 트랙에서 부문이 정해지지 않은 팀의 변수로 실효 최종 식, pool의 비교 식, 상의 식 중 하나라도 `validateAst`를 통과하지 못할 때 내고 그 팀은 모든 pool에서 빠집니다(6.1, D116).

### 6.9 결과 스냅샷 (RES-6)

`buildResultsSnapshot`(Node)이 `computeResults`의 결과에 해시와 메타데이터를 붙여 `_results`에 저장할 확정 스냅샷을 만듭니다. 시각은 호출자가 넘깁니다(core는 시계를 읽지 않음).

```ts
export interface SnapshotMeta {
  kit_version: string;
  revision: number;                  // 계산에 쓴 _config의 revision(NormalizedConfig에는 없음)
  public_hash: string;               // 그 revision event.json의 public_hash
  computed_at: Iso | null;
  confirmed_by: string | null;       // 확정한 운영자 내부 id(0.2). 이메일 모양이면 E_INPUT
  confirmed_at: Iso | null;
}
export function buildResultsSnapshot(config: NormalizedConfig, input: ResultsInput, computation: ResultsComputation, meta: SnapshotMeta): ResultsSnapshot;
export interface ResultsSnapshot {
  kind: "results"; schema: 1;
  kit: { version: string };
  event_id: string;
  config: { revision: number; hash: string; public_hash: string };   // hash = hashOf(config) = _config의 config_hash
  rubrics: Record<string, { hash: string; max_total: number }>;      // hashOf(정규형 루브릭)
  formulas: { slot: string; source: string; ast_hash: string }[];    // 쓰인 모든 식 칸(최종, tie_break, 덮어쓰기, 상)
  inputs: { rows: number; rows_hash: string; votes_hash: string | null; decisions_hash: string; teams_hash: string;
            epochs: Record<string, number> };
  computed_at: Iso | null;
  confirmed: { by: string | null; at: Iso | null };                  // 사람이 확정한 기록
  stages: StageResult[];                                             // 팀별 내역: judge, judges, crit, critmax, bonus, gate, advanced, 경고
  final: ResultsComputation["final"];
  rankings: RankOutcome[];
  prizes: PrizeResult[];
  ties: TieTrace[];
  unresolved: Unresolved[];
  decisions: ResultsComputation["decisions"];                        // 수동 결정 기록
  warnings: ResultWarning[];
  blocking: ResultsComputation["blocking"];
  publishable: boolean;
}
```

- `config.kind`가 `event`가 아니거나 `event.id`가 null이면 `E_CONFIG`입니다.
- `rows_hash`는 `seq` 순서로 정렬한 행 배열, `teams_hash`는 `members`를 뺀 팀 배열(id 순서, 개인정보를 해시에도 넣지 않음), `decisions_hash`는 6.3 순서로 정렬한 결정, `votes_hash`는 `votes`의 `hashOf`입니다(11.4). 그래서 입력 배열을 섞어도 해시가 같습니다.
- 스냅샷에는 팀원 답, 이메일, 심사위원별 원점수가 없습니다. 원점수는 시트에 있고 같은 입력으로 다시 계산하면 같은 스냅샷이 나옵니다(`computed_at`, `confirmed` 제외).
- 스냅샷은 비공개입니다. 결정의 `reason`·`by`, 심사위원 id, 경고, 입력 해시가 들어 있으므로 공개 경로에는 6.10의 공개 결과만 나갑니다.

### 6.10 공개 결과 (RES-7, RES-9)

백엔드가 공개 시각 뒤 내주는 결과(BE-10)와 MCP가 Pages에 보관하는 `results.json`(RES-7)은 같은 공개 투영입니다. core가 그 모양을 정합니다 **[D93]**.

```ts
export type PublicLevel = "winners" | "ranks" | "scores";
export interface PublicOptions { level: PublicLevel; names?: Record<string, string> }   // names: 팀 id → 공개할 팀 이름(MCP가 명단에서 넘김)
export interface PublicResults {
  kind: "public_results"; schema: 1;
  event_id: string;
  config: { revision: number; public_hash: string };
  level: PublicLevel;
  prizes: { id: string; name: Localized | null; scope: NPrizeScope; place: number; count: number; amount: number | null;
            status: "awarded" | "partial" | "vacant";
            awards: { team: string; name: string | null; place: number; shared: boolean }[] }[];   // disabled 상은 뺌
  groups: { key: string; entries: { team: string; name: string | null; rank: number; score?: number }[] }[];
          // winners: [], ranks: 순위 묶음마다 등수가 있는 팀(등수 순), scores: + 반올림한 최종 점수
}
export function publicResults(snapshot: ResultsSnapshot, options: PublicOptions): PublicResults;
```

- Node 전용이고 결정적입니다. 허용 목록에 있는 칸만 담습니다. `decisions`(reason·by 포함), `warnings`, `blocking`, `inputs`, `stages`, `ties`, `unresolved`, `confirmed`, 심사위원 id, `config_hash`는 어떤 level에도 없습니다.
- `E_INPUT`: `snapshot.publishable`이 거짓, `names`의 키가 팀 id 규칙(0.2)을 어기거나 값이 1~100자가 아님, 결과 JSON(맵 키 포함)에 V8의 비밀 패턴이나 V23의 이메일 모양이 있음(값은 되풀이하지 않음).
- `_results` 탭에는 `{ kind: "results_tab", snapshot: ResultsSnapshot, public: PublicResults }`을 씁니다. 백엔드는 공개 시각 뒤 `public`만 내주고 MCP의 `results.json`도 같은 `public`입니다. 어느 level을 공개할지는 15.3 #2(SPEC 19.4 Q14)에서 정합니다(RES-9의 "트랙·부문별 순위와 상"을 상의 등수로 읽으면 `winners`로, 상을 받지 못한 팀까지 포함한 전체 등수로 읽으면 `ranks` 이상으로 보입니다).

---

## 7. 조건, 신청 자격, 부문

SPEC 7.1, 7.6의 #5·#6·#7, APP-1~9, DIV-1부터 DIV-10까지.

### 7.1 조건 언어

```
Cond := {}                                   # 항상 참
      | { all: [Cond, ...] }                 # 빈 목록은 참
      | { any: [Cond, ...] }                 # 빈 목록은 거짓
      | { not: Cond }
      | { field: <이름>, <op>: <값> }         # op는 정확히 하나
```

| op | 값 | 동작 |
| --- | --- | --- |
| `eq`, `ne` | 문자열·숫자·boolean **[D40]** | 글자로 비교(`String(답) === String(값)`). 답 "3"과 값 3은 같음 |
| `in`, `nin` | 문자열·숫자·boolean 목록(1~200개) | 목록 안에 있다 / 없다 |
| `gt`, `gte`, `lt`, `lte` | 숫자 또는 `YYYY-MM-DD` | 숫자는 숫자끼리(답이 `^\s*-?\d+(\.\d+)?\s*$` 꼴이면 숫자로), 날짜는 날짜끼리. 종류가 다르면 거짓 |
| `exists` | `true` / `false` | 답이 있다 / 없다 |
| `domain_in` | 도메인 목록(1~200개) | 값에 `@`가 있으면 마지막 `@` 뒤, 없으면 값 전체를 소문자로 보고 목록의 항목 `d`(소문자)와 `값 === d` 또는 `값이 "." + d로 끝남`이면 참(라벨 경계 접미사) **[D39]** |

- **정규식은 없습니다.** `matches`는 v0.5에서 뺐습니다. 스키마는 `matches`를 받아 두고(정확한 안내를 위해) V24가 오류로 보고합니다. runtime은 `matches`를 모르는 op로 보고 `E_COND_MALFORMED`를 던집니다. v1의 `matchesProblem`과 정규식 분석기는 없앱니다.
- 여러 답(`multi`, 배열): `eq`, `in`, 크기 비교, `domain_in`은 원소 하나라도 맞으면 참, `ne`, `nin`은 하나도 맞지 않아야 참(v1과 같음).
- **한도** **[D41]**: 중첩 깊이(`all`/`any`/`not`) 16, 노드 100개, 목록 200개, 문자열 값 200자. 스키마가 SCHEMA 오류로, runtime이 재귀하기 전에 `E_COND_LIMIT`로 막습니다.
- 결과:

```ts
export interface CondFailure { path: string; field: string | null; op: CondOp | "all" | "any" | "not" }
export interface CondResult { ok: boolean; failed: CondFailure[] }   // ok면 failed는 []
export function evaluateCondition(cond: Cond, person: Person): CondResult;
```

`all`은 실패한 자식을 모두, `any`는 자기 자신(`op: "any"`)과 각 자식의 실패를, `not`은 자기 자신을 남깁니다(v1과 같음). `failed`에는 조건 쪽 정보(경로, field, op)만 담고 답은 담지 않습니다.

**확장(DIV-10).** op와 정량자의 레지스트리는 `COND_OPS`(conditions.ts)와 `TEAM_RULES`(divisions.ts) 표 하나뿐입니다. 새 항목은 키트 코드로만 더하고 설정이나 add-on이 runtime에 op를 등록하는 경로는 없습니다. 새 항목을 더하는 변경에는 `types.ts`의 유니온, zod 스키마, V15·V16, 7.7의 문장 틀(두 언어), `conditions.json`·`divisions.json` 벡터를 함께 넣습니다.

### 7.2 특별 field

```ts
export interface Person {
  email: string;                         // Google ID 토큰의 확인된 이메일(입력칸 아님)
  hosted_domain?: string | null;         // ID 토큰의 hd(Workspace 계정만)
  answers: Readonly<Record<string, Answer>>;
  verified?: Readonly<Record<string, boolean>>;   // 운영진이 확인한 증빙 key → true
}
export type Answer = string | number | boolean | string[] | null;
```

| field | 값 |
| --- | --- |
| `email` | `person.email` 그대로 |
| `email_domain` | `email`의 마지막 `@` 뒤를 소문자로. 견주는 조건 값(`eq`, `ne`, `in`, `nin`)도 소문자로 바꿔 비교(v1과 같음) |
| `hosted_domain` | `hosted_domain`을 소문자로. 없으면 답 없음. 견주는 값도 소문자로 |
| `verified.<key>` | `verified[key] === true`면 `true`, 아니면 답 없음 |
| 그 밖 | `answers[field]`(자기 속성만, `hasOwn`) |

`email` 조건에 메일 주소를 적으면 공개 `event.json`에 실리므로 V23 오류입니다.

### 7.3 답이 없을 때

키가 없음, `null`, 빈 문자열, 공백만 있는 문자열, 빈 배열, 공백 문자열만 든 배열은 **답 없음**입니다. 배열 안의 공백 문자열은 빼고 봅니다. 답이 없으면 모든 op에서 `ne`, `nin`, `exists: false`만 참입니다(v1과 같음). `false`(boolean 답)는 답이 있는 것입니다.

### 7.4 팀 정량자

```ts
export type TeamRule =
  | "all_members" | "any_member" | "no_member" | "majority" | "leader"
  | { at_least: number } | { at_most: number } | { ratio: number }
  | { pick: { by: string; order: "max" | "min"; kind?: "rank" | "number" | "date"; rank?: string[] } };
          // kind·rank는 빌드가 채움(아래)
export interface TeamMember { id: string; role: "leader" | "member"; person: Person }   // id: 팀원 내부 id(0.2, 이메일 아님)
export interface QuantifierResult {
  ok: boolean;
  rule: string;                 // "all_members", "at_least", "pick" …
  passed: number;               // when을 만족한 사람 수(pick은 기준 팀원 중)
  total: number;                // 판정에 든 사람 수(pick은 기준 팀원 수)
  need: number | null;          // 필요한 수(아래)
  failed: CondFailure[];        // 판정에 든 사람들의 실패 사실을 합친 것(중복 제거, 처음 순서)
}
export function teamRuleHolds(rule: TeamRule, when: Cond, members: TeamMember[]): QuantifierResult;
```

`n` = 팀원 수, `p` = `when`을 만족한 팀원 수. **팀원이 없으면(n = 0) 어떤 규칙도 거짓**입니다 **[D42]**. 팀원이 50명을 넘거나 `TeamMember.id`가 0.2를 어기면 `E_INPUT`입니다 **[D85]**.

| 규칙 | 참 조건 | need |
| --- | --- | --- |
| `all_members` | `p = n` | n |
| `any_member` | `p ≥ 1` | 1 |
| `no_member` | `p = 0` | 0 |
| `{ at_least: k }` (정수 k ≥ 1) | `p ≥ k` | k |
| `{ at_most: k }` (정수 k ≥ 0) | `p ≤ k` | k |
| `{ ratio: x }` (0 < x ≤ 1, 소수 6자리 이하) | `p × 1000000 ≥ R × n`, `R = round(x × 1000000)`(정수 비교) **[D43]** | `⌈R × n / 1000000⌉` |
| `majority` | `p × 2 > n`(과반 초과) | `⌊n / 2⌋ + 1` |
| `leader` | 역할이 `leader`인 팀원이 1명 이상이고 모두 만족 | 조장 수 |
| `{ pick: { by, order } }` | 아래 | 기준 팀원 수 |

**pick** **[D44]**: `by`는 `single`, `number`, `date` 질문의 key여야 합니다(V16). 빌드가 `kind`를 정합니다: `single`이면 `kind: "rank"`, `rank` = 보기 값 목록(뒤에 있을수록 큼), `number`면 `"number"`, `date`면 `"date"`.

1. 팀원마다 `by` 값을 읽습니다. `rank`는 보기 목록의 위치(목록에 없으면 값 없음), `number`는 숫자(숫자 모양 글자 포함), `date`는 `YYYY-MM-DD` 글자. 값이 없는 사람은 비교에서 뺍니다.
2. 값이 있는 사람이 없으면 거짓(`total: 0`).
3. `order: max`면 가장 큰 값, `min`이면 가장 작은 값을 가진 사람 **모두**가 기준 팀원입니다.
4. 기준 팀원이 모두 `when`을 만족해야 참입니다.

`unit: individual` 트랙은 정량자를 쓰지 않고 본인(팀원 하나)에게 `when`만 적용합니다(`rule: "individual"`, `total: 1`). `unit: organization`은 `team`과 같이 정량자를 적용합니다 **[D45]**. individual 트랙의 팀원이 정확히 1명이 아니면 `resolveDivision`은 `E_INPUT`이고 `computeBonuses`와 상의 `eligible`은 MEMBERS_MISSING으로 다룹니다(5장, 6.4).

### 7.5 부문 판정

```yaml
divisions:                               # 맵. key = DivisionId
  student:
    name: { ko: 학생부, en: Student }
    when: { field: status, in: [student_univ, student_grad] }
    team_rule: all_members               # 기본 all_members
    explain: { ko: "팀원 전원이 학생이면 학생부입니다." }   # 선택. 없으면 사이트가 규칙에서 문장을 만듦(7.7)
    extra_fields: []                     # 부문별 추가 질문(DIV-9, P2). key 목록
tracks:
  hack:
    divisions: [student, general]        # 위에서부터
    division_mode: auto                  # auto | declared. 기본 auto [D46]
    division_as_of: team_lock            # application | team_lock | submission. 기본 team_lock
```

```ts
export interface DivisionInput {
  track: NTrack;                         // 정규형 트랙
  divisions: Record<string, NDivision>;
  members: TeamMember[];
  declared?: string | null;              // declared 모드에서 팀이 고른 부문
  override?: { division: string; reason: string } | null;   // 운영진 덮어쓰기. reason 1~500자(아니면 E_INPUT)
}
export interface DivisionReason {        // 사람 문장은 담지 않음(7.7)
  division: string; ok: boolean;
  rule: string;                          // "all_members", "at_least", "pick", "individual" …
  k: number | null;                      // at_least·at_most의 k
  ratio_ppm: number | null;              // ratio의 R = round(x × 1000000)
  pick: { by: string; order: "max" | "min" } | null;
  passed: number; total: number; need: number | null;
  failed: CondFailure[];
}
export type DivisionProblem = "NO_MATCH" | "NOT_DECLARED" | "DECLARED_NOT_OPEN" | "DECLARED_NOT_MET" | "OVERRIDE_NOT_OPEN";
export interface DivisionResult {
  division: string | null;
  ok: boolean;                           // false면 팀 잠금을 막음
  source: "auto" | "declared" | "override" | "none";
  reasons: DivisionReason[];
  problem: DivisionProblem | null;       // ok가 거짓일 때만
}
export function resolveDivision(input: DivisionInput): DivisionResult;
```

1. 트랙에 부문이 없으면 `{ division: null, ok: true, source: "none", reasons: [], problem: null }`.
2. `override`가 있으면 그것이 이깁니다. `override.division`이 트랙에서 열린 부문이면 `{ division: override.division, ok: true, source: "override" }`이고 `reasons`에는 계산된 판정을 그대로 담아 운영진이 비교할 수 있게 합니다. 열린 부문이 아니면(설정이 바뀌어 닫힌 부문 등) 던지지 않고 `{ division: null, ok: false, source: "override", problem: "OVERRIDE_NOT_OPEN" }`을 돌려줍니다 **[D96]**. 정상 운영 중에도 생길 수 있는 데이터 때문에 백엔드 요청 전체가 실패하지 않게 하려는 것입니다. teams_plan은 이 결과로 덮어쓰기를 거절합니다. 덮어쓰기 사유는 결과와 공개 근거에 넣지 않습니다 **[D47]**(사유에 개인정보가 있을 수 있음, 사유는 `_log`와 고정 기록에만).
3. `auto`: 트랙 순서대로 판정해 처음 맞는 부문. 없으면 `{ division: null, ok: false, problem: "NO_MATCH" }`와 부문별 근거.
4. `declared`: 고르지 않았으면 `NOT_DECLARED`, 트랙에서 열리지 않는 부문이면 `DECLARED_NOT_OPEN`, 맞지 않으면 그 부문의 근거와 함께 `DECLARED_NOT_MET`(모두 `ok: false`).

판정 한 번에는 `unit`에 따라 `when`(individual: 팀원 하나) 또는 `teamRuleHolds`(team, organization)를 씁니다. individual인데 팀원이 정확히 1명이 아니면 `E_INPUT`입니다.

### 7.6 판정 시점과 고정 기록

`division_as_of` 전에는 팀 구성이 바뀔 때마다 다시 판정하고, 그 시점에 고정합니다. 언제 고정할지는 백엔드가 정합니다: `application`은 신청(개인 트랙)이나 팀 생성 때, `team_lock`은 `schedule.team_lock` 시각이나 운영진의 팀 잠금 때, `submission`은 첫 최종 제출 때입니다.

```ts
export type DivisionAsOf = "application" | "team_lock" | "submission";
export interface DivisionRecord {
  division: string | null;
  ok: boolean;                     // 고정할 때 맞는 부문이 있었는지
  reasons: DivisionReason[];
  members: string[];               // 고정할 때의 팀원 id(오름차순)
  as_of: DivisionAsOf;
  at: Iso;                         // 고정한 시각(백엔드가 넘김)
  rule_revision: number;           // 판정에 쓴 _config revision
  source: "auto" | "declared" | "override" | "none";
  override_reason: string | null;  // 공개하지 않음
}
export function freezeDivision(input: DivisionInput, as_of: DivisionAsOf, at: Iso, rule_revision: number): DivisionRecord;
export interface DivisionReview {
  review: boolean;                 // reasons가 하나라도 있으면 참
  reasons: ("MEMBERS_CHANGED" | "DIVISION_CHANGED" | "NOT_ELIGIBLE" | "OVERRIDE_NOT_OPEN")[];
}
export function divisionNeedsReview(record: DivisionRecord, input: DivisionInput): DivisionReview;
```

- `freezeDivision`은 `resolveDivision(input)`을 계산해 기록을 만듭니다. `override_reason = input.override?.reason ?? null`입니다. 판정이 `ok: false`여도 고정합니다(`division: null`, `ok: false`). `schedule.team_lock` 시각에 맞는 부문이 없던 팀이 기록에 남고 확인 항목으로 올라갑니다(V16이 미리 경고).
- **고정 뒤 덮어쓰기**: 같은 `as_of`로 `freezeDivision`(덮어쓰기를 넣은 input)을 불러 새 기록(`source: "override"`, `at` = 덮어쓴 시각)을 만들고 이전 기록을 대체합니다. 부문의 우선순위는 최신 고정 기록 > (고정 전) 덮어쓰기 > 재판정입니다 **[D96]**.
- **`divisionNeedsReview`**: 아래 사실을 모읍니다. `MEMBERS_CHANGED` = 지금 `input.members`의 id 집합이 기록과 다름(source와 관계없음). `DIVISION_CHANGED` = source가 auto·declared이고 다시 계산한 `division`이 기록과 다름. `NOT_ELIGIBLE` = source가 auto·declared이고 기록이나 지금 판정의 `ok`가 거짓. `OVERRIDE_NOT_OPEN` = source가 override인데 그 부문이 이제 트랙에서 열리지 않음. `review`가 참이면 운영진 확인 항목으로 올립니다(DIV-5). 판정 결과가 같게 나온 구성 변경과 덮어쓴 팀의 구성 변경도 `MEMBERS_CHANGED`로 오릅니다.
- 결과 계산(6.8)은 `TeamInput.division`으로 고정 기록의 부문을 받습니다.

### 7.7 근거와 설명

- 근거는 인원만 셉니다: "학생부 · 팀원 4명 중 4명 충족". 실패한 조건은 질문 key와 op로만 말합니다("맞지 않은 조건: "status"(in)"). 다른 사람의 답, 이메일, 부문 덮어쓰기 사유는 근거에 없습니다(SPEC 15.1).
- **runtime은 참가자용 문장을 만들지 않습니다** **[D84]**. `DivisionReason`, `DivisionProblem`, `FieldError`(7.10), `ScoreEntryCheck`(4.12)는 코드와 인자만 담습니다. 문장 틀은 core가 데이터로 배포하는 `src/i18n/rules.ko.json`·`rules.en.json`에 있습니다(사이트에는 `kit/<버전>/i18n/rules.<lang>.json`). 사이트 i18n과 Node의 `describeDivision(result, lang)`, `describeFieldError(error, field, lang)`, `describeScoreEntry(check, lang)`(MCP용)가 같은 틀로 문장을 만듭니다. 두 파일은 키가 같아야 합니다(13.1 `i18n.test.ts`).
- 숫자 넣기: `{pct}`는 `String(ratio_ppm / 10000)`입니다(0.07 → 7, 0.29 → 29, 0.333333 → 33.3333). 부동소수 곱셈 `x × 100`(0.07 → 7.000000000000001)을 쓰지 않습니다.
- 틀(ko):

| 키 | 문장 |
| --- | --- |
| `division.all_members` | {부문}: 팀원 {total}명 중 {passed}명 충족 · 팀원 전원이 조건을 만족해야 합니다 |
| `division.any_member` | … · 한 명 이상이 조건을 만족해야 합니다 |
| `division.no_member` | … · 조건을 만족하는 팀원이 없어야 합니다 |
| `division.at_least` | … · {k}명 이상이 조건을 만족해야 합니다 |
| `division.at_most` | … · {k}명 이하만 조건을 만족해야 합니다 |
| `division.ratio` | … · 팀원의 {pct}% 이상이 조건을 만족해야 합니다 |
| `division.majority` | … · 팀원의 과반이 조건을 만족해야 합니다 |
| `division.leader` | {부문}: 조장이 조건을 {만족합니다 / 만족하지 않습니다} / 조장이 없습니다 |
| `division.pick` | {부문}: 기준 팀원({by} {최댓값/최솟값}) {total}명 중 {passed}명 충족 · 기준 팀원이 모두 만족해야 합니다 / 기준 값({by})이 있는 팀원이 없습니다 |
| `division.individual` | {부문}: 조건을 {만족합니다 / 만족하지 않습니다} |
| `division.empty` | {부문}: 팀원이 없습니다 |
| `division.problem.NO_MATCH` | 맞는 부문이 없습니다. 팀 구성을 확인해 주세요. |
| `division.problem.NOT_DECLARED` | 부문을 골라 주세요. 고를 수 있는 부문: {부문들} |
| `division.problem.DECLARED_NOT_OPEN` | 고른 부문은 이 트랙에서 열리지 않습니다. 고를 수 있는 부문: {부문들} |
| `division.problem.DECLARED_NOT_MET` | 고른 부문({부문})의 조건을 만족하지 않습니다. |
| `division.problem.OVERRIDE_NOT_OPEN` | 운영진이 정한 부문이 이 트랙에서 열리지 않습니다. 운영진에게 문의해 주세요. |

`{부문}`은 부문 `name`을 요청 언어로 고른 값입니다(8.2). 사이트는 펼치면 부문의 `explain`을 보여 주고 `explain`이 없으면 위 문장을 씁니다. 신청서·제출 입력 오류와 점수 입력 오류의 틀(`field.*`, `score_entry.*`)은 7.10·7.11과 4.12의 코드마다 하나씩 있습니다.

### 7.8 신청서 질문 (`intake.fields`)

```yaml
intake:
  fields:                                 # key 목록(병합 key: key)
    - key: student_id
      type: text                          # text | textarea | tel | single | multi | number | date | boolean | github | url
      label: { ko: 학번, en: Student ID } # 필수
      help: null                          # Localized
      placeholder: null                   # Localized
      section: { ko: 학적 }               # Localized, 화면 묶음
      required: true                      # 기본 false
      format: digits                      # text만: digits | alnum | email | url | github_login
      min_length: 8                       # 텍스트 종류만
      max_length: 8
      show_if: { field: status, in: [student_univ, student_grad] }   # 앞선 질문 조건
      roster: null                        # name | github_login | team_hint
```

| 키 | 적용 | 규칙 |
| --- | --- | --- |
| `key` | 모두 | `^[\p{L}_][\p{L}\p{N}_ ]{0,39}$`이고 공백으로 끝나지 않음. `email`, `email_domain`, `hosted_domain`이 아니고 `verified`로 시작하지 않으며 `.`이 없고 금지 이름(0.2)이 아님(V11) **[D49]**. 층마다 정규화할 때(8.6 ①) NFC로 바꾸고, 같은 답 묶음 안의 두 key를 NFKC로 바꾼 뒤 소문자로 만든 값이 같으면(전각 `ａ`와 `a` 등) V11 오류입니다 **[D102]**. 답 묶음은 둘입니다: 신청(`intake.fields`와 모든 부문의 `extra_fields`, 7.9)과 제출(`submit.fields`, 7.11) |
| `options` | single, multi | 1개 이상. 항목은 문자열이나 `{ value, label }`. 정규형은 `[{ value, label }]`(문자열 `s`는 `{ value: s, label: s }`). 값은 유일, 1~100자 |
| `solo` | multi | 고르면 다른 보기를 지우는 값(options의 부분) |
| `format` | text | 프리셋(아래). 다른 형식에 적으면 V11 오류 |
| `min_length`, `max_length` | text, textarea, tel, url, github | 코드 포인트 수. 기본 최댓값: text 200, textarea 4000, tel 20, url 2048, github 39. 기본값보다 크게 적을 수 없음 |
| `min`, `max`, `step` | number(숫자, 절댓값 1e9 이하, 소수 6자리 이하. `step`은 0.000001 이상), date(`YYYY-MM-DD`, step 없음) | `step`은 4.3의 `onStep`입니다. 소수 6자리 제한은 루브릭 척도(D16)와 같고 V11이 봅니다 **[D49]**. `onStep`의 `decimalsOf`는 `String(n)`을 읽으므로 `1e-7`처럼 지수 표기가 되는 값에서는 자릿수가 0으로 나와 모든 답이 STEP이 되고 소수 7자리 이상이면 정수 계산이 2^53을 넘을 수 있기 때문입니다 |
| `show_if` | 모두 | 앞에 있는 질문 key와 `email_domain`, `hosted_domain`만 읽을 수 있음(순환 방지, `verified.*` 금지) **[D50]** |
| `roster` | | 명단으로 넘어가는 역할. 역할마다 질문 하나(V11). kind event에는 `name`이 꼭 있어야 함 |
| v1 `max` | text 종류 | `max_length`의 deprecated alias(DEPRECATED 경고, 층마다 옮김, 8.6) |

**format 프리셋**(정규식 없이 글자를 하나씩 확인합니다):

| 프리셋 | 규칙 |
| --- | --- |
| `digits` | 1자 이상, 모두 ASCII `0`~`9` |
| `alnum` | 1자 이상, 모두 ASCII 영문자나 숫자 |
| `email` | `@`가 정확히 하나. 앞부분은 1자부터 64자까지의 `[A-Za-z0-9._%+-]`, `.`으로 시작·끝나지 않고 `..` 없음. 뒷부분은 라벨(1~63자 `[A-Za-z0-9-]`, `-`로 시작·끝나지 않음)을 `.`로 이은 것, 라벨 2개 이상, 마지막 라벨은 2자 이상 영문자. 전체 254자 이하 |
| `url` | `https://` 또는 `http://`(소문자)로 시작. 그 뒤 호스트(위의 라벨 규칙, 선택적 `:포트` 1~5자리), 그다음은 비어 있거나 `/`, `?`, `#`로 시작하는 출력 가능한 ASCII(공백 없음). 2048자 이하 |
| `github_login` | 1~39자, `[A-Za-z0-9-]`, `-`로 시작·끝나지 않고 `--` 없음 |

`github` 형식은 `github_login` 규칙을, `url` 형식은 `url` 규칙을 늘 적용합니다. `tel`은 `[0-9 +()-]`만 쓰고 숫자가 7개 이상입니다.

### 7.9 신청 자격, 본인 확인, 동의, 증빙

```yaml
intake:
  identity:
    google_login: required        # locked
    one_per_account: true         # locked
    email_domains: [example.ac.kr]   # 비면 모든 계정. 라벨 경계 접미사 일치(7.1 domain_in과 같음)
    hosted_domains: []            # 비면 제한 없음. ID 토큰 hd와 대소문자 무시 정확히 일치
    github: { required: true, verify: format }   # verify: format | exists
  eligibility:                    # 일반 목록
    - when: { field: enrollment, eq: enrolled }
      message: { ko: 휴학생은 신청할 수 없습니다. }
  consents:                       # key 목록
    - { key: rules, text: { ko: 대회 규정을 확인했습니다 }, version: v1, required: true }   # required 기본 true [D118]
  proofs:                         # key 목록(APP-6)
    - { key: enrollment_cert, label: { ko: 재학증명서 }, help: null, kind: link, required: false }
  capacity: null                  # 받을 신청 수(사람)의 상한. 정수 ≥ 1 또는 null(제한 없음, 기본) [D113]
```

- `checkApplicantEligibility(rules, person)`: 모든 규칙을 만족해야 하고 실패한 규칙의 `message`를 규칙 순서로 돌려줍니다: `{ ok, messages: Localized[], failed: number[] }`. 문장은 설정이 준 것이라 7.7의 틀을 쓰지 않습니다.
- **built-in 동의** **[D48]**: 정규형 `intake.consents` 맨 앞에 core가 둘을 늘 넣습니다. ① `privacy`(문구는 `privacy` 블록으로 사이트가 그림, `version` = `"p1:" + hashOf({ purpose, items, retention, refusal, contact, consignment, share_contact_on_team_accept })`) ② `age_14_plus`("만 14세 이상입니다", 문구는 키트 i18n, `version: "1"`). privacy 동의의 version은 위 일곱 칸만으로 만들므로, 키트가 정규형 `privacy`에 칸을 더해도 값이 바뀌지 않아 이미 동의한 참가자가 다시 동의할 필요가 없습니다. 칸을 바꿀 때만 `p2:`로 올립니다. `guardian_consent`는 planned라 켤 수 없으므로 만 14세 미만은 이 동의로 늘 막힙니다(SPEC 15.1, APP-8). 설정의 동의 key는 이 둘과 겹칠 수 없습니다(V11).
- `identity.github.required`가 참이면 `type: github`, `required: true`인 질문이 있어야 합니다(V11). `verify: exists`는 MCP `participants_plan`이 확인하고 core는 형식만 봅니다.
- 증빙 key는 `^[a-z][a-z0-9_]{0,31}$`이고 금지 이름이 아닙니다. 증빙은 링크로 받고 운영진이 확인하면 백엔드가 `verified.<key> = true`를 둡니다. 조건의 `verified.<key>`는 `proofs`에 있는 key여야 합니다(V15). 수집하는 증빙 key는 `privacy.items`에도 있어야 합니다(V7).
- **개인 자격 덮어쓰기** **[D111]**: 운영진은 `participants_plan`으로 한 사람의 자격 판정을 덮어쓸 수 있습니다(SPEC 12.1, 사유 필수). 백엔드는 그 기록을 시트에 두고 그 사람의 신청을 검사할 때마다(처음 신청과 APP-7의 수정 모두) `ApplicationInput.eligibility_override`로 넘깁니다(7.10). 덮어쓰기는 `intake.eligibility`의 규칙 전체에 걸리고 운영진이 지울 때까지 답을 고쳐도 유지됩니다. 본인 확인(도메인), 필수·형식 검사, 동의는 덮지 않습니다. 덮어쓰기 사유는 결과에 넣지 않습니다(D47과 같은 이유, 사유는 `_log`에만).
- `capacity`(APP-9) **[D113]**: 신청 수가 이 값에 닿으면 백엔드가 신청을 닫습니다. `rsvp_waitlist`가 켜져 있으면 닫지 않고 그 뒤의 신청을 대기자로 받습니다. 사이트는 `event.json`의 이 값으로 정원을 보여 줍니다. 세는 기준(접수 전체인지, 취소를 빼는지)은 백엔드(M3)가 정하고 core는 값의 모양만 검사합니다. `rsvp_waitlist.capacity`(9.3)는 참석 확정 인원의 상한이라 다른 값입니다. 결정 반영의 "팀 수와 정원" 대조(SPEC DEC-4)는 이 값(사람)과 트랙의 `teams` 범위(팀)를 씁니다.
- **부문별 추가 질문** **[D112]**: `divisions.<id>.extra_fields`(DIV-9)는 신청서에서 묻습니다. 빌드는 트랙이 여는 부문 중 추가 질문이 있는 부문마다 `{ division, when, fields }`를 정규형 `intake.division_fields`에 부문 id 순서로 넣습니다(`when`은 그 부문의 개인 조건). 신청서는 앞선 답으로 그 `when`이 참인 사람에게만 그 부문의 질문을 보여 주고 `validateApplication`도 같은 규칙으로 검사합니다(7.10). 예를 들어 학생부(`status in [student_univ, student_grad]`)의 추가 질문 "학교 이름"은 status에 대학생이나 대학원생을 고른 사람에게만 나옵니다. 팀 정량자는 팀이 정해진 뒤에야 판정되므로, 개인 조건만으로 묻는 사람을 정합니다. 그 결과 팀이 나중에 다른 부문이 되어도 이미 받은 답은 남습니다(그 key는 `privacy.items`에 있어야 함, V7). 부문 판정 조건(`divisions.*.when`)은 추가 질문의 key를 읽을 수 없습니다(V15 오류). 그 부문에 들어가야 묻는 질문을 그 부문의 판정이 읽으면 순환이 되고 묻지 않은 사람에게는 늘 "답 없음"이 되기 때문입니다. 자격·가산점·상 자격 조건은 읽을 수 있습니다.

### 7.10 `validateApplication`

```ts
export type PublicIntake = EventJson["intake"];   // NIntake는 이 모양의 상위 타입(identity에 locked 키가 더 있음)
export interface ApplicationInput {
  identity: { email: string; hosted_domain: string | null };   // 백엔드가 확인한 ID 토큰 값
  answers: Record<string, unknown>;
  accepted: Record<string, string>;      // 동의 key → 동의한 version
  proofs?: Record<string, string>;       // 증빙 key → 링크
  eligibility_override?: { reason: string } | null;   // 운영진의 개인 자격 덮어쓰기(7.9). reason 1~500자(아니면 E_INPUT) [D111]
}
export interface FieldError { key: string; code: FieldErrorCode; params: Record<string, string | number> }   // 문장은 7.7
export type FieldErrorCode =
  | "IDENTITY_DOMAIN" | "IDENTITY_HOSTED_DOMAIN" | "REQUIRED" | "TYPE" | "FORMAT" | "LENGTH"
  | "RANGE" | "STEP" | "OPTION" | "SOLO" | "CONSENT" | "PROOF"
  | "HOST" | "OPT_IN" | "OPT_IN_LIMIT";                                  // 셋은 제출 검사(7.11)
export interface ApplicationCheck {
  ok: boolean;
  values: Record<string, Answer>;        // 정리한 답(보이는 질문만, 설정 순서. 부문 추가 질문은 그 뒤). Object.create(null)
  dropped: number;                       // 설정에 없거나 숨겨진 질문의 답 수(버림, PRIV-2)
  errors: FieldError[];
  eligibility: { ok: boolean; overridden: boolean; messages: Localized[]; failed: number[] };   // ok·failed는 계산한 그대로
}
export function validateApplication(intake: PublicIntake, input: ApplicationInput): ApplicationCheck;
```

사이트는 `event.json`의 `intake`를 그대로 넘기고 백엔드는 `_config`의 `intake`를 넘깁니다(같은 함수, 같은 결과).

0. **입력 상한** **[D85]**: `answers`·`accepted`·`proofs`가 일반 객체가 아니거나, `answers`의 자기 키가 (질문 수 + 20)개를 넘거나, `accepted`·`proofs`의 키가 (동의·증빙 수 + 20)개를 넘으면 `E_INPUT`입니다. 질문 수에는 부문 추가 질문도 셉니다. `identity.email`이 254자, `hosted_domain`이 253자를 넘으면 IDENTITY_DOMAIN·IDENTITY_HOSTED_DOMAIN입니다. 아래 형식별 검사도 값이 클 때 글자를 훑기 전에 먼저 끊습니다. 백엔드에서 참가자 입력을 직접 받는 함수라서 큰 입력이 실행 시간을 쓰지 않게 하려고 이 상한을 둡니다.
1. 본인 확인: `email_domains`가 있으면 이메일 도메인이 맞아야 하고(IDENTITY_DOMAIN) `hosted_domains`가 있으면 hd가 맞아야 합니다(IDENTITY_HOSTED_DOMAIN).
2. 질문을 설정 순서로: `show_if`를 지금까지 정리한 답으로 판정해 거짓이면 답을 버립니다. 보이면 아래 순서로 검사해 첫 오류 하나를 남깁니다. 오류가 있어도 다음 질문을 계속 봅니다 **[D85]**.
   1. 답이 없으면(키 없음, `null`) 필수 검사(REQUIRED)만 하고 끝냅니다.
   2. 값의 타입(TYPE, 아래 표).
   3. 텍스트 종류는 **정리하기 전의 원래 값**으로 UTF-16 길이 상한(그 형식의 기본 최댓값(7.8)의 2배)을 봅니다(LENGTH). 상한을 넘으면 글자를 훑거나 줄바꿈을 정리하지 않고 끝냅니다. 정리를 먼저 하면 `\r`이 많은 10^7자 답에서 줄바꿈 정리에만 수백 ms가 들기 때문입니다(13.4). 그래서 공백 401개 뒤에 `x`를 붙인 text 답(402자, 상한 400)은 정리하면 한 글자지만 LENGTH입니다.
   4. 정리(아래 표). 정리한 값이 답 없음(7.3)이면 필수 검사(REQUIRED)만 하고 끝냅니다.
   5. 길이(LENGTH: 코드 포인트 수, `min_length`·`max_length`) → 형식(FORMAT: 제어 문자, format 프리셋) → 범위·단위(RANGE·STEP) → 보기(OPTION·SOLO).
3. 부문 추가 질문(7.9): `intake.division_fields`의 항목마다 그 `when`을 지금까지 정리한 답(신청 질문 전부와 앞 항목의 답)으로 판정해 참이면 그 `fields`를 2단계와 같은 규칙으로 검사합니다. 거짓이면 그 항목의 답을 버립니다.
4. 설정에 없는 키의 답은 버리고 수만 셉니다.
5. 필수 동의(built-in 포함)는 `accepted[key] === version`이어야 합니다(CONSENT). 증빙 링크는 필수 여부와 관계없이 `url` 프리셋을 통과해야 하고(PROOF) 필수 증빙은 링크가 있어야 합니다(PROOF).
6. 정리한 답으로 `checkApplicantEligibility`. 결과의 `eligibility.ok`와 `failed`는 계산한 그대로 두고 `eligibility_override`가 있으면 `overridden: true`입니다(사유는 넣지 않음) **[D111]**.
7. `ok` = 오류가 없고, 자격이 맞거나(`eligibility.ok`) 덮어쓴 경우(`overridden`).

| 형식 | 받는 값과 정리 | 오류 |
| --- | --- | --- |
| text, textarea, tel, url, github | 문자열. 앞뒤 공백을 지웁니다. textarea는 `\r\n`·`\r`을 `\n`으로 바꿉니다 | 문자열이 아니면 TYPE. 정리하기 전의 UTF-16 길이가 그 형식의 기본 최댓값(7.8)의 2배를 넘으면 정리와 글자 세기 전에 LENGTH(2단계 3). 제어 문자(U+0000–U+001F, U+007F. textarea는 `\n`, `\t` 제외)가 있으면 FORMAT. 길이는 정리한 값의 코드 포인트 수 |
| number | 유한한 number, 또는 `^-?\d{1,10}(\.\d{1,6})?$` 문자열(폼 입력)을 `Number`로 | 그 밖(JSON `1e309` = Infinity 포함)이거나 절댓값이 1e9를 넘으면 TYPE |
| boolean | `true`, `false`만 | 그 밖은 TYPE(`"true"` 문자열도 TYPE) |
| single | 문자열 | 문자열이 아니면 TYPE. 보기의 `value`와 정확히 같지 않으면 OPTION |
| multi | 문자열 배열. 보기 순서로 정렬합니다. 빈 배열은 답 없음 | 배열이 아니거나 원소가 문자열이 아니면 TYPE. 원소 수가 보기 수를 넘거나, 같은 원소가 두 번 있거나, 보기에 없는 값이면 OPTION. `solo` 값과 다른 값을 함께 고르면 SOLO |
| date | `^\d{4}-\d{2}-\d{2}$` 문자열 | 아니거나 달력에 없는 날짜(윤년은 4로 나누어지고 100으로 나누어지지 않거나 400으로 나누어지는 해. `Date`를 쓰지 않음)면 FORMAT |

`min`·`max`는 number는 숫자로, date는 글자로(같은 형식이라 사전순이 날짜순) 비교하고(RANGE) number의 `step`은 `onStep`입니다(STEP).

문장 틀(`rules.ko.json`의 `field.*`) 예: REQUIRED "{label}을(를) 적어 주세요.", FORMAT(digits) "{label}은(는) 숫자만 적을 수 있습니다.", LENGTH "{label}은(는) {min}~{max}자로 적어 주세요.", IDENTITY_DOMAIN "허용된 메일 계정({도메인들})으로 로그인해 주세요." `{label}`은 질문 `label`을 요청 언어로 고른 값입니다. 수식 주입 방지(`=`로 시작하는 값)는 저장할 때 백엔드가 합니다(BE-11).

### 7.11 `validateSubmission`

제출 입력(SUB-1·SUB-3·SUB-5, PRIV-2)도 신청서처럼 rules 번들의 함수 하나로 판정합니다 **[D107]**. 백엔드가 권위 있게 검사하고 사이트는 같은 함수로 미리보기를 합니다(0.1 #1). 제출 질문의 필수·형식 검사, 링크의 허용 호스트, 상 지원(opt-in)의 상한, 설정 밖 답 버리기를 백엔드와 사이트가 따로 구현하지 않게 하려는 것입니다.

```ts
export type PublicSubmit = EventJson["submit"];   // { preset, repo_link, allowed_hosts, max_opt_ins, fields }
export type PrizeRef = Pick<NPrize, "id" | "opt_in" | "ladder">;   // event.json·_config의 prizes 그대로
export interface SubmissionInput {
  answers: Record<string, unknown>;      // submit.fields의 답
  opt_ins: string[];                     // 지원한 상 id
}
export interface SubmissionCheck {
  ok: boolean;
  values: Record<string, Answer>;        // 정리한 답(보이는 질문만, 설정 순서). Object.create(null)
  opt_ins: string[];                     // 정리한 지원 목록(상 목록 순서, 중복 없음)
  dropped: number;                       // 설정에 없거나 숨겨진 질문의 답 수(버림, PRIV-2)
  errors: FieldError[];                  // 코드는 7.10의 FieldErrorCode
}
export function validateSubmission(submit: PublicSubmit, prizes: readonly PrizeRef[], input: SubmissionInput): SubmissionCheck;
```

0. **입력 상한**: `answers`가 일반 객체가 아니거나 자기 키가 (질문 수 + 20)개를 넘으면, 또는 `opt_ins`가 문자열 배열이 아니거나 (상 수 + 20)개를 넘으면 `E_INPUT`입니다(7.10의 0단계와 같은 이유).
1. `submit.fields`를 설정 순서로 7.10의 2단계와 같은 규칙(정리 표, 검사 순서)으로 검사합니다. 제출 질문의 `show_if`는 앞선 제출 질문만 읽습니다(V11). `repo`의 필수 여부는 빌드가 `repo_link`로 정했으므로(8.3) 여기서 따로 보지 않습니다.
2. **허용 호스트**: `allowed_hosts`가 비어 있지 않으면 `url` 형식 답마다 호스트(소문자)가 목록의 항목 `h`와 같거나 `"." + h`로 끝나야 합니다(라벨 경계 접미사, 7.1의 `domain_in`과 같음). 아니면 HOST(`params: { hosts }`, 허용 목록만 담고 답은 담지 않음)입니다.
3. 설정에 없는 키의 답은 버리고 수만 셉니다.
4. **상 지원**: `opt_ins`의 id마다 `opt_in: true`인 상이어야 하고(아니면 OPT_IN, key `opt_ins`, `params: { prize }`) 같은 id가 두 번 있으면 한 번으로 봅니다. 지원한 상을 사다리로 묶어(`ladder`가 있으면 그 사다리, 없으면 상 하나) 그 수가 `max_opt_ins`보다 크면 OPT_IN_LIMIT(`params: { max }`)입니다. 사다리의 상 하나에 지원한 팀은 그 사다리의 모든 상에 지원한 것으로 봅니다(6.4). `values`와 같이 정리한 `opt_ins`를 돌려주고 백엔드는 이 값을 저장해 결과 계산의 `TeamInput.opt_ins`(6.8)로 넘깁니다.
5. `ok` = 오류가 없음.

문장 틀 예: HOST "{label}에는 허용된 주소({hosts})만 적을 수 있습니다.", OPT_IN "지원할 수 없는 상입니다.", OPT_IN_LIMIT "상은 {max}개까지 지원할 수 있습니다."

**커밋 SHA**(SUB-3): 기본 제출 양식(8.3의 `basic`)의 `repo_sha` 질문으로 받습니다. 백엔드는 GitHub 토큰이 없어(SPEC 9장) 비공개 저장소의 커밋을 읽을 수 없으므로, 제출하는 팀이 적은 값을 저장하고 `github_ops`가 마감에 동결할 때 만든 태그의 커밋과 MCP가 대조합니다(SPEC GH-4). 대조는 태그 쪽에서 하므로 `repo_sha`는 `alnum`, 7~40자로 형식만 보고 16진수인지는 보지 않습니다.

---

## 8. 설정 v2

SPEC 6장, 5.6, CFG-1~9.

### 8.1 최상위 키

| 키 | 모양 | 병합 | 공개(`event.json`) |
| --- | --- | --- | --- |
| `schema` | `2` | 머리(병합 안 함) | 별도 |
| `kind` | `event \| profile \| preset` | 머리 | |
| `extends` | 문자열 또는 목록 | 머리 | |
| `version` | 정수 ≥ 1(preset만, 필수) | 머리 | |
| `recommended_addons` | add-on id 목록 | 일반 목록 | 아니오 |
| `org` | 8.3 | 객체 | 예 |
| `event` | 8.3 | 객체 | 예 |
| `site` | 8.3 | 객체 | 예 |
| `schedule` | 8.3 | 객체(`sessions`·`extensions`는 key 목록) | 예(`extensions` 제외) |
| `tracks` | 맵 → 트랙 | 맵 | 예 |
| `divisions` | 맵 → 부문(7.5) | 맵 | 예 |
| `bonuses` | 맵 → 가산점(5장) | 맵 | 예 |
| `intake` | 7.8~7.9 | 객체 | 예 |
| `scoring` | 4장 | 객체 | 예(공개 보기, 11.3) |
| `prizes` | 상 목록(6.4) | key 목록(`id`) | 예 |
| `prize_policy` | 6.5 | 객체 | 예 |
| `modules` | `{ apply, submit, judge }` boolean, 기본 모두 true. 끄면 달라지는 것은 8.10 | 객체 | 예 |
| `addons` | 맵 → `{ enabled, …options }`(9장) | 맵 | 켠 것의 공개 옵션만 |
| `submit` | 8.3 | 객체 | 예 |
| `privacy` | 8.3 | 객체 | 예 |
| `teams` | `{ one_per_person: true, formation: self \| organizer \| hybrid }`(기본 self). MCP 0.1.0의 `teams.size`는 SCHEMA: "teams.size는 MCP 0.1.0 형식입니다." fix: "트랙마다 team_size: { min, max }로 적어 주세요." | 객체 | `formation`만 |
| `github`, `repo`, `reviewers`, `app_policy` | 0.1.0 MCP의 섹션을 이름 그대로 둔 것입니다. core는 안쪽을 검사하지 않고 통과시킵니다: `github`은 `org`(1자 이상 문자열)가 있는 객체, `repo`·`reviewers`는 객체, `app_policy`는 문자열인지만 봅니다. `reviewers.permission`은 locked key(V12)이고 비밀을 담는 키 이름은 V8 ③이 봅니다. 안쪽의 모양은 이 값을 쓰는 MCP(`github_ops`, `apps_review`)가 자기 스키마로 검사합니다 **[D109]** | 객체 | 아니오 |
| `roster` | 없음. 0.1.0의 명단 출처 설정(시트·CSV 위치와 열 이름)이고 v2에서는 명단을 백엔드 시트 하나로 받으므로(SPEC BE-3, 12.4) 폐지했습니다. 적으면 SCHEMA: "roster는 MCP 0.1.0의 명단 출처 설정입니다. v2에서는 명단을 대회 시트 하나로 받습니다." fix: "roster를 지워 주세요. 0.1.0 설정은 simple-hackathon migrate로 옮길 수 있습니다(11.6)." **[D109]** | | |

모르는 최상위 키는 SCHEMA 오류입니다. 설정의 모든 수는 유한합니다(YAML `.inf`·`-.inf`·`.nan`은 SCHEMA). `ResolvedConfig`는 병합·정규화 뒤 zod가 기본값을 채운 모양이고(수식은 문자열), `NormalizedConfig`는 그것을 컴파일한 모양입니다(11.1). 사람이 쓰는 층 파일 하나의 스키마는 8.9에 있습니다.

### 8.2 `Localized`

`string | { ko?: string, en?: string }`. 객체는 키가 하나 이상입니다. 값은 1~2000자이고 긴 글 칸(`site.about`, `site.rules`, `site.code_of_conduct`, `site.faq[].a`, `privacy.purpose`, `privacy.consignment`)은 20,000자까지입니다. 사이트는 요청 언어 → `site.languages[0]` → `ko` → `en` 순서로 고릅니다. Localized인 곳: 이름·설명·메시지·라벨·문구 전부(`event.name`, `event.venue`, `event.organizers[]`, `org.name/contact`, `site.title/tagline/about/rules/code_of_conduct`, `site.links[].label`, `site.faq`, `tracks.*.name/description`, `divisions.*.name/explain`, `bonuses.*.name/explain`, `intake.fields[].label/help/placeholder/section`, 보기 `label`, `eligibility[].message`, `consents[].text`, `proofs[].label/help`, 기준 `name/description`, `anchors` 값, 루브릭·단계·상 `name`, `privacy.purpose/refusal/contact/consignment`, `schedule.sessions[].title/place`). id, key, 수식, 경로, 링크는 Localized가 아닙니다.

### 8.3 섹션별 모양

```yaml
org:
  name: { ko: 예시대학교 컴퓨터공학과 }      # Localized
  contact: { ko: "운영진 메일 hackathon@example.ac.kr" }   # 공개 문의처(V23 예외)
  logo: null                                # 이미지 칸(아래)
  url: null                                 # 링크 칸(아래)

event:
  id: example-2027                          # ^[a-z0-9][a-z0-9-]{1,62}$, kind event에 필수
  name: { ko: Example Hackathon 2027 }      # kind event에 필수
  timezone: Asia/Seoul                      # IANA 이름. 없으면 UTC로 보고 V1 info [D56]
  venue: { ko: 예시관 101호 }
  online: false
  organizers: [{ ko: 예시대학교 컴퓨터공학과 }]

site:
  title: null                               # 없으면 event.name
  tagline: null
  about: null
  rules: null                               # 대회 규칙(Localized, /rules/) [D89]
  code_of_conduct: null                     # 행동강령(Localized, /rules/)
  policy_links: { terms: null, privacy: null, code_of_conduct: null }   # 주최 측 정책 링크(SITE-16)
  theme: { accent: "#3b6ef5", logo: assets/logo.svg, hero: null, font: web }   # accent: #rgb·#rrggbb. font: web | system(기본 web) [D105]
  languages: [ko]                           # ko·en의 부분 목록, 첫 값이 기본
  sections:                                 # key 목록(병합 key: id). 순서 = 홈 순서
    - { id: hero, visible: true, coming_soon: false }
    # id: hero | now | about | tracks | schedule | prizes | judging | faq | sponsors | contact
    # 적지 않으면 SPEC 11.2의 홈 순서(위 id 순서) 전부, visible: true, coming_soon: false
  links: [{ label: { ko: 질문 게시판 }, url: "https://forms.example.com/q" }]
  faq: [{ q: { ko: … }, a: { ko: … } }]
  sponsors: [{ name: { ko: 예시 후원사 }, logo: null, url: null }]
  strings: {}                               # i18n key → Localized(문구 덮어쓰기, 개발자 모드)
  google_client_id: null                    # 공개 값. ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$

schedule:
  recruit: { open: Iso, close: Iso }
  team_lock: Iso
  sessions: [{ id: kickoff, at: Iso, title: Localized, place: Localized, online: false }]
  main: { start: Iso, end: Iso, submit_deadline: Iso, grace_min: 5 }   # grace_min 0..120, 기본 0
  extensions: [{ team: "13", until: Iso }]  # 팀별 제출 마감 연장. key 목록(병합 key: team), 비공개 [D88]
  score_until: Iso
  results_at: Iso | "off"

tracks:
  hack:
    name: { ko: 해커톤 }
    short_id: H                             # ^[A-Za-z0-9]{1,8}$, GitHub 이름용(v1 id의 새 이름)
    description: null
    aliases: []                             # 시트·회의록에서 이 트랙을 가리키는 다른 이름(0.1.0과 같음). MCP가 명단과 결정을 읽을 때 씀 [D118]
    unit: team                              # individual | team | organization, 기본 team
    team_size: { min: 1, max: 10 }          # 기본 {1, 10} [D57]. 1 ≤ min ≤ max ≤ 50 [D85]. individual은 {1, 1}로 고정
    teams: ["01-10"]                        # 팀 번호 범위(V2)
    order: 1                                # 정수, 선택. 트랙 순서(아래)
    divisions: [student, general]
    division_mode: auto
    division_as_of: team_lock
    vote: null                              # { from, until } 이 트랙의 투표 창(popular_vote.window를 덮음) [D55]
    submit_deadline: null                   # 이 트랙의 마감(main.submit_deadline을 덮음)
    prizes: []                              # v1 축약형(6.7). 정규화 뒤에는 없음

submit:
  preset: basic                             # basic | kr_contest | mlh
  repo_link: optional                       # required | optional | off
  allowed_hosts: []                         # 링크 질문이 허용하는 호스트(비면 제한 없음, 라벨 경계 접미사)
  max_opt_ins: null                         # 팀이 지원할 수 있는 opt-in 상의 수 상한(사다리는 하나로 셈) [D66]
  extra_fields: []                          # 프리셋 뒤에 붙일 질문(7.8 모양, key 목록)

privacy:
  purpose: { ko: "참가 신청 확인, 팀 편성, 심사와 시상 연락" }
  items: [name, email, phone, github]       # 고지할 수집 항목. 수집하는 key를 모두 담아야 함(V7), 그 밖의 문자열은 설명용 [D67]
  retention: { days_after_event: 30, winners_days: 365 }   # 0 이상 정수
  refusal: { ko: "동의하지 않으면 참가 신청을 할 수 없습니다." }
  contact: { ko: "운영진 메일 hackathon@example.ac.kr" }   # 공개 문의처(V23 예외)
  consignment: null                         # 처리 위탁·국외 이전 고지. 없으면 키트 기본 문구
  share_contact_on_team_accept: false       # PRIV-6
```

**글꼴** **[D105]**: `site.theme.font`는 `web`(기본, 기본 테마의 웹 글꼴 Gothic A1을 Google Fonts에서 불러오고 실패하면 시스템 글꼴) 또는 `system`(웹 글꼴을 불러오지 않고 시스템 글꼴만)입니다(SPEC 11.5, SITE-11, 19.4 Q2의 소유자 결정). 무엇을 불러오는지 이름에서 보이도록 값 이름을 `default`가 아니라 `web`으로 두었습니다. 정규형과 `event.json`의 `site.theme`에 늘 들어가고(11.1, 11.3), 사이트가 이 값으로 글꼴 요청을 넣거나 뺍니다. SPEC 11.5·SITE-11은 조직이 설정할 수 있는 테마 값을 강조색, 로고, 대표 이미지, 섹션 순서·표시, 글꼴 다섯 가지로 정합니다. 섹션 순서·표시는 `site.sections`(위)에 두므로, core의 `site.theme`은 나머지 넷(`accent`, `logo`, `hero`, `font`)만 받습니다. SPEC 4.2의 개발자 모드 "테마 토큰"은 core 설정 키로 두지 않습니다(15.2).

**트랙 순서** **[D118]**: 사이트와 상 배분(6.7)은 트랙을 `order` 오름차순으로 보여 주고 처리합니다. `order`가 같으면 id 순서를 따르고 `order`가 없는 트랙은 그 뒤에 id 순서로 옵니다. 4.2의 1차 형식 변환처럼 결정적이기만 하면 되는 곳은 id 순서를 씁니다. `aliases`는 문자열 목록인지만 검사합니다.

**링크와 이미지 값** **[D89]**: 사이트가 `href`·`src`로 그대로 쓰는 칸은 스키마가 scheme까지 확인합니다(SCHEMA). 회의록 같은 외부 문서에서 뽑은 결정으로 사이트 문구와 링크(`site.links` 등, SPEC 10.4)를 바꿀 수 있으므로, 외부 문서가 공개 사이트에 스크립트 링크를 심는 경로를 막으려는 것입니다(SPEC 10.5, 15.1).

- 링크 칸(`site.links[].url`, `site.sponsors[].url`, `site.policy_links.*`, `org.url`): 7.8의 `url` 프리셋(소문자 `https://` 또는 `http://`, 호스트 규칙, 공백·제어 문자 없음)을 통과해야 합니다.
- 이미지 칸의 목록은 `IMAGE_KEYS` 표 하나이고 이 scheme 규칙, 8.4의 `assets` 기록, V22가 모두 이 표를 씁니다. 사이트(M3)가 이미지 칸(예: 공유 미리보기 이미지)을 더하면 이 표에 더합니다 **[D103]**.
- 이미지 칸(`site.theme.logo`, `site.theme.hero`, `org.logo`, `site.sponsors[].logo`): `:`가 없고 `/`·`\`로 시작하지 않는 상대 경로, `url` 프리셋을 통과하는 `https://` 주소, `data:image/(png|jpeg|webp|gif|avif);base64,` 중 하나입니다. `data:image/svg+xml`, `javascript:`(대소문자 무관), `vbscript:`, 앞에 공백·제어 문자가 붙은 값, `//`로 시작하는 주소는 SCHEMA입니다. 로컬 파일과 `data:` 값의 크기는 V22가 재고 `https://` 이미지는 core가 네트워크를 쓰지 않아 크기를 잴 수 없으므로 V22가 경고합니다(10.3).

**제출 프리셋**(정규형 `submit.fields`는 프리셋 질문 + `extra_fields`) **[D66]**:

| 프리셋 | 질문(key: 형식, 필수 여부) |
| --- | --- |
| `basic` | `title`: text 80자 필수, `tagline`: text 140자 필수, `description`: textarea 4000자 필수, `repo`: url(`repo_link`가 required면 필수, off면 없음), `repo_sha`: text alnum 7~40자(도움말 "제출할 커밋의 SHA", `repo`와 같은 필수 여부, off면 없음) **[D107]**, `demo`: url, `video`: url(도움말 "공개 링크(YouTube·Vimeo)"), `ai_use`: single(`none`, `assist`, `core`) 필수, `ai_note`: textarea 1000자(`show_if: { field: ai_use, ne: none }`) |
| `kr_contest` | `basic` + `report`: url 필수(결과보고서), `slides`: url 필수(발표 자료), `demo_video`: url 필수(시연 영상) |
| `mlh` | `basic` + `built_with`: text 200자 필수 |

상 지원(opt-in)은 질문이 아니라 `opt_in: true`인 상 목록에서 고르고 `max_opt_ins`가 상한입니다. 제출 입력은 7.11의 `validateSubmission`이 검사합니다.

**일정 판정 `trackWindows`** **[D88]**: 마감과 창(BE-9)은 백엔드가 서버 시각으로 판정합니다. 그 실효 규칙(D55, 팀별 연장)은 rules 번들의 함수 하나로 둡니다. 행사 중 마감 연장도 설정 변경이므로(SPEC 6.1 #7, SUB-2) `schedule.extensions`에 적고 사유는 설정 대신 계획과 `_log`에 남깁니다(설정에 개인정보를 두지 않음, SPEC 6.1 #3). github_ops의 팀별 동결 연장도 같은 값을 씁니다.

```ts
export interface TrackWindows {
  recruit: { open: Iso | null; close: Iso | null };
  team_lock: Iso | null;
  submit_deadline: Iso | null;            // 트랙 submit_deadline ?? main.submit_deadline. team이 있고 연장이 있으면 그 until
  grace_min: number;
  accept_until_ms: number | null;         // isoToMs(submit_deadline) + grace_min × 60000
  vote: { from: Iso; until: Iso } | null; // popular_vote가 켜졌을 때만: 트랙 vote ?? popular_vote.window
  score_until: Iso | null;
  results_at: Iso | "off" | null;
}
export function trackWindows(source: ScheduleSource, track: string, team?: string | null): TrackWindows;
```

`ScheduleSource`는 `_config`의 config나 `event.json`(연장 없음)의 `{ schedule, tracks, addons }`입니다. popular_vote가 켜졌는지는 `addons.popular_vote`가 있고 `enabled`가 `false`가 아닌 것으로 봅니다(`event.json`에는 켠 add-on만 있음). 모르는 트랙이면 `E_CONFIG`입니다. 연장이 원래 마감보다 이르면 V1이 막습니다.

### 8.4 상속(`extends`)

v1 규칙을 바탕으로 합니다(V13).

- 목록을 앞에서부터 병합하고 마지막에 이 파일을 병합합니다. 각 부모는 자기 `extends`를 먼저 풉니다.
- `preset:<이름>@<major>`: `src/config/presets/<이름>.yaml`(빌드하면 `dist/config/presets/`). 파일의 `version`과 major가 다르면 V13. planned preset(`mlh`)은 "mlh preset은 아직 준비 중입니다" V13. 키트 preset은 `extends`를 쓰지 않습니다(테스트로 확인).
- `profile:<이름>`: `<home>/profiles/<이름>.yaml`. `<home>`은 `<home>/events/<id>/event.yaml`에서 추정하거나 `--home`.
- 상대 경로는 이 파일의 폴더 기준.
- 깊이 5 초과, 순환, 없는 파일, 한 목록에 같은 파일 두 번, 읽은 파일 50개 초과는 V13 오류.
- **MCP 0.1.0 형식**: `schema`가 없고 최상위에 `event_id`가 있는 파일은 v2로 읽지 않습니다. 모르는 키 수십 개가 SCHEMA 오류로 쏟아지지 않도록 SCHEMA(code `V010_FORMAT`) 하나만 냅니다: "MCP 0.1.0 형식의 event.yaml입니다. v2 형식으로 옮겨야 합니다." fix: "simple-hackathon migrate <파일> --from 0.1.0 --out <폴더>로 바꾸거나(11.6) v2 형식으로 다시 적어 주세요."

```ts
export interface RawLayer {
  file: string | null;          // 없으면 메모리 층(비개발자 모드)
  kind: ConfigKind;
  name: string | null;          // profile 이름(profile:<name>, export --dev가 씀). 파일 층은 파일 이름에서, 메모리 층은 MCP가 넘김
  ref: string | null;           // 이 층을 가리키는 참조: "preset:kr-contest@1", "profile:example-univ". 진입 파일과 이름 없는 메모리 층은 null
  extends: string[];            // 이 층이 적은 extends를 참조 형식으로 정리한 것(파일 경로는 그 파일 층의 ref가 있으면 ref로). 없으면 []
  data: unknown;                // 머리 키를 뺀 원자료
}
export interface AssetRef { path: string; value: string; file: string | null }      // V22: 이미지 값과 그 값을 쓴 층의 파일
export interface LoadResult {
  config: ResolvedConfig | null;
  files: SourceFile[];          // 읽은 파일 원문(진입 파일 먼저)
  layers: RawLayer[];           // 병합 순서
  assets: AssetRef[];           // 마지막으로 쓴 층 기준
  aliases: [string, string][];  // 4.2, 8.6
  diagnostics: Diagnostic[];    // YAML, SCHEMA, MERGE, V13, DEPRECATED
}
export function loadConfig(file: string, options?: { home?: string }): LoadResult;
export function resolveLayers(layers: RawLayer[]): LoadResult;   // 파일 없이(비개발자 모드의 메모리 설정). preset 층도 넘김
export function loadPresetLayer(ref: string): { layer: RawLayer | null; diagnostics: Diagnostic[] };
        // "preset:<이름>@<n>" → 키트 preset 층. 없는 이름·버전, planned preset은 layer null과 V13
```

순서: ① 층 읽기(V13, YAML, 머리 스키마, 0.1.0 형식 확인). 이때 층마다 `ref`와 `extends`를 채웁니다 ② 층을 차례로 병합합니다. 각 층은 병합 직전에 8.6 ①로 정규화하고(그때까지 병합한 결과를 참고), 정규화한 층에서 이미지 칸(`IMAGE_KEYS`, 8.3)의 값과 그 층의 파일을 `assets`에 기록한 뒤 병합합니다(MERGE). 정규화한 뒤에 기록하므로 옛 이름(`site.logo`)으로 적은 로컬 로고도 V22와 `export --dev`의 복사에 들어가고 "마지막으로 쓴 층"도 옛 이름과 새 이름을 섞어 쓴 층들 사이에서 바르게 정해집니다 ③ 병합 뒤 정규화(8.6 ②) ④ `parseResolved`(SCHEMA, 기본값) ⑤ 결과. 진단의 `source.line`은 경로를 층의 YAML 문서에서 찾아(뒤 층부터) 알 수 있을 때만 채웁니다. 비개발자 모드의 MCP는 `loadPresetLayer`로 preset 층을 얻어 메모리 층과 함께 `resolveLayers`에 넘깁니다.

### 8.5 병합 규칙과 key 목록

`merge(base, over, path)`(v1과 같은 규칙):

1. `over`가 `null`이면 그 키를 지웁니다(맵의 항목 삭제 포함). locked key에 `null`을 쓰면 V12입니다.
2. 둘 다 객체면 키마다 재귀합니다. 맵(트랙, 부문, 가산점, add-on, 루브릭, `site.strings`)도 이 규칙이라 항목은 `null`로 지웁니다.
3. **key 목록**이면: `over`가 배열이면 통째로 바꾸고 `{ add?, remove?, update? }`면 `remove` → `update`(없는 key면 MERGE 오류) → `add`(이미 있는 key면 MERGE 오류) 순서로 합칩니다.
4. 그 밖의 배열: `over`가 배열이면 교체, `{ append: [...] }`면 뒤에 붙입니다.
5. 그 밖의 값: 교체. YAML 키 `__proto__`는 자기 속성으로 둡니다(`defineProperty`).

`listKeyAt(path)`(path의 `[]`는 key 목록 항목, `*`는 아무 맵 키):

| 경로 | 항목 key |
| --- | --- |
| `scoring.criteria`(+ `[].children`, 깊이 제한 없음) | `key` |
| `scoring.rubrics.*.criteria`(+ `[].children`) | `key` |
| `scoring.stages` | `id` |
| `prizes` | `id` |
| `intake.fields`, `intake.consents`, `intake.proofs` | `key` |
| `submit.extra_fields`, `divisions.*.extra_fields` | `key` |
| `schedule.sessions` | `id` |
| `schedule.extensions` | `team` |
| `site.sections` | `id` |

나머지 목록(`intake.eligibility`, `tie_break`, `rank_groups`, `stages[].overrides`, `final.overrides`, v1 `scoring.overrides`, `prize_policy.exclusive`, `privacy.items`, `site.links`, `site.faq`, `site.sponsors`, `recommended_addons`, `tracks.*.divisions`, `tracks.*.teams`, 도메인 목록 등)은 일반 목록입니다. SPEC 5.6도 2026-11-18부터 맵(이름이 같은 항목끼리 속성 단위로 합치고 `null`로 지움)과 key 목록(통째로 바꾸거나 `add`·`remove`·`update`)을 나눠 적습니다(15.2).

### 8.6 정규화

정규화는 두 번 합니다. 이름만 바뀐 키는 **층마다(병합 전)**, 다른 키와 엮인 변환은 **병합 뒤 한 번** 합니다. 옛 이름과 새 이름을 다른 층에 적어도 병합이 같은 키로 합치고 아래 층(event)의 `null` 지우기가 위 층(profile)에 옛 이름으로 적은 값에도 걸리게 하려고 이렇게 나눕니다(SPEC 5.6 "profile은 그대로 두고 event만 새로 쓰면 됩니다").

**① 층마다** — `normalizeLayer(data, base, file)`: deprecated alias **[D54]**(DEPRECATED 경고)와 축약형 최종 키(4.2)를 그 층 안에서 옮기고 옛 키는 지웁니다. 1차 구현은 배포된 적이 없어(14장) REL-3의 "배포된 키를 없앨 때 한 minor 버전 경고"가 걸리지 않습니다. 다만 저장소의 예제와 문서가 이 이름을 썼으므로 0.3.x 동안 별명으로 받고 그다음 minor 버전에서 지울 수 있습니다. 질문 key와 그 key를 가리키는 문자열(조건의 `field`, `pick.by`, `show_if`의 field, `privacy.items`)은 이 단계에서 NFC로 바꿉니다 **[D102]**. 같은 "학번"도 파일 이름 등에서 복사한 글자(NFD)와 키보드로 친 글자(NFC)가 다른 key가 되기 때문입니다. runtime은 `_config`·`event.json`에 실린 key를 그대로 쓰므로 정규화하지 않습니다. 같은 층에 옛 키와 새 키가 함께 있을 때만 SCHEMA 오류("{옛 경로}와 {새 경로} 중 하나만 적어 주세요")입니다. 배열 안과 key 목록의 `add`·`update` 항목 안까지 보고 `update` 항목에 `type`이 없으면 `base`(그때까지 병합한 결과)에서 같은 key의 type을 찾습니다. 별명은 층의 파일과 함께 기록합니다(진단 경로).

| 옛 경로 | 새 경로 | 비고 |
| --- | --- | --- |
| `site.accent`, `site.logo` | `site.theme.accent`, `site.theme.logo` | |
| `site.contact { email?, url? }` | `org.contact`(문자열 `"{email} {url}"`) | 공개 문의처로 옮김 |
| `event.locale` | `site.languages: [locale]` | |
| `privacy.retention_days` | `privacy.retention.days_after_event` | |
| `submit.team_max_gb`, `submit.kinds` | `addons.upload.team_max_gb`, `addons.upload.kinds` | add-on을 켜지는 않음 |
| `intake.fields[].max`, `submit.extra_fields[].max`, `divisions.*.extra_fields[].max`(텍스트 종류) | `max_length` | number 질문의 `max`는 그대로 |
| `tracks.<id>.id` | `tracks.<id>.short_id` | |
| `scoring.judge_aggregate` | `scoring.aggregate` | 4.2 |
| `scoring.input_step` | `scoring.scale.step` | 4.2 |
| `scoring.formula`, `precision`, `tie_break`, `rank_groups`, `unresolved_tie` | `scoring.final.<같은 키>` | 축약형 최종 키(4.2). 경고 없음 |
| `addons.team_board` | `addons.team_finder` | `enabled` 그대로 |
| `addons.check_in` | `addons.checkin` | |
| `addons.notices`, `addons.judge_assignment` | 없음(core 기능) | 지우고 경고 |
| `addons.slide_preview`, `track_moves`, `mentor_queue` | 없음(폐지) | 꺼져 있으면 지우고 경고, 켜져 있으면 V14 오류 |

**② 병합 뒤 한 번** — `normalizeMerged(data)`:

1. **점수 축약형 → 정규형**(4.2): 축약형 판정(D52), `components`(다른 층의 식과 엮여 있어 병합 뒤), `popular_normalize`, v1 `overrides`.
2. **트랙 상금표 → 상**(6.7).

두 함수의 결과는 `{ data, aliases, diagnostics }`입니다. `matches` 조건과 정규식은 바꾸지 않고 V24로 보고합니다.

### 8.7 locked key

아래 층(위 층을 extends하는 층)이 다른 값으로 바꿀 수 없습니다. 같은 값을 다시 쓰는 것은 괜찮고 `null`(지우기)은 바꾸려는 것으로 봅니다. V12는 `ctx.layers`(없으면 `files`를 다시 읽은 것)를 층마다 보고, 파일 없이 만든 설정도 걸리도록 병합된 값을 한 번 더 봅니다. 한 키는 한 번만 보고합니다(v1과 같음).

| 경로 | 값 | 이유(V12 메시지) |
| --- | --- | --- |
| `intake.identity.google_login` | `"required"` | 본인 확인은 Google이 서명한 토큰으로만 합니다 |
| `intake.identity.one_per_account` | `true` | Google 계정 하나로 한 번만 신청해야 명단의 한 줄이 한 사람입니다 |
| `teams.one_per_person` | `true` | 한 사람은 한 팀에만 속합니다(1인 1팀) |
| `reviewers.permission` | `"pull"` | 멘토와 심사위원은 읽기 권한만 받습니다 |
| `scoring.locks.rubric_on_stage_open` | `true` | 심사 단계가 열리면 그 단계의 점수 계산 규칙(루브릭, 가중치, 척도, 식 등, 10.3)이 잠깁니다 |

메시지: "{경로}는 잠긴 값이라 {값}으로만 둘 수 있습니다(이유: {이유}). {파일}에서 {적은 값}으로 바꾸려고 했습니다." fix: "이 줄을 지우거나 {값}으로 적어 주세요."

### 8.8 preset

모든 preset은 `kind: preset`, `version: 1`이고 내용은 v2 형식(ASCII 질문 key와 Localized `label`)입니다 **[D51]**. 1차 구현의 preset(한국어 key)도 version 1이었지만 core는 배포된 적이 없어(14장) 내용을 바꿔도 깨지는 사용자가 없고 SPEC 6.2의 `extends: [preset:standard-2track@1, preset:university-students@1]`가 그대로 풀립니다. preset은 `recommended_addons`와 add-on 옵션 기본값을 둘 수 있지만 `enabled: true`는 쓸 수 없습니다(V14).

| preset | 담는 것 |
| --- | --- |
| `standard-2track@1` | 트랙 `hack`(short_id H, 해커톤, team, order 1), `impl`(short_id I, 구현과제, team, order 2). 트랙 id는 SPEC 6.2의 event가 적는 `tracks.hack`·`tracks.impl`과 같아서 맵 병합으로 두 트랙이 됩니다. 질문 `name`(text 50, roster name), `phone`(tel), `github`(github, roster github_login), `team_hint`(textarea 500, roster team_hint), 모두 필수. `identity.github: { required: true, verify: format }`. 축약형 기준 `idea`, `done`, `ux`, `arch` 각 25점. `recommended_addons: [popular_vote, github_ops]` |
| `single-track@1` | 트랙 `main`(본선, team). 질문 `name`(필수, roster name), `phone`(필수), `team_hint`(선택, roster team_hint). 축약형 기준 `idea` 30, `impl`(`done` 20, `quality` 20), `demo` 30 |
| `university-students@1` | 질문 추가(`add`): `student_id`(text, digits, 20자), `grade`(single: g1 1학년, g2 2학년, g3 3학년, g4plus 4학년 이상), `affiliation`(text 50자), `enrollment`(single: enrolled 재학, on_leave 휴학), 모두 필수, section 학적. 자격(`append`): `enrollment eq enrolled`, "휴학생은 신청할 수 없습니다." 증빙(`add`): `enrollment_cert`(재학증명서, 선택). `recommended_addons: [team_finder]` |
| `company-internal@1` | 질문 추가: `employee_id`(text, alnum, 20자), `department`(text 50자), 필수, section 소속. `privacy.retention.days_after_event: 14` |
| `open-public@1` | 질문 추가: `age_band`(single: under14 만 14세 미만, 14to18 만 14~18세, 19plus 만 19세 이상, 필수), `country`(text 60자, 필수). 자격: `age_band ne under14`, "만 14세 미만은 이번 대회에 참가할 수 없습니다." `submit.max_opt_ins: 3`. `recommended_addons: [team_finder, popular_vote, mail]` |
| `kr-contest@1` | `submit.preset: kr_contest`. 질문 추가 `status`(single: student_univ 대학생, student_grad 대학원생, worker 직장인, other 기타, 필수). 부문 `student`(`status in [student_univ, student_grad]`, all_members, explain), `general`(`when: {}`, all_members). 점수 정규형(아래, `scoring.criteria: null`로 앞 preset의 축약형을 지움) **[D70]**. `privacy.retention: { days_after_event: 30, winners_days: 365 }`, `privacy.refusal` 기본 문구 |
| `mlh` | planned. 파일이 없고 V13가 안내 |

preset은 질문을 더하지만 `privacy.items`는 profile이 적습니다. preset이 더한 질문 key가 items에 빠지면 V7이 알립니다.

`kr-contest@1`은 트랙 preset 뒤에 둡니다(`extends: [preset:single-track@1, preset:kr-contest@1]`). 앞에 두면 뒤 preset의 축약형 기준이 다시 들어와 4.2의 섞임 오류가 납니다. 점수:

```yaml
scoring:
  criteria: null
  rubrics:
    screening:
      name: { ko: 서면 예선 }
      scale: { min: 1, max: 5, step: 1 }
      criteria:
        - { key: fit, name: { ko: 주제 적합성 }, type: gate }
        - { key: idea, name: { ko: 창의성 } }
        - { key: feasibility, name: { ko: 실현 가능성 } }
        - { key: impact, name: { ko: 파급성 }, weight: 2 }
    final:
      name: { ko: 본선 }
      scale: { min: 0, step: 0.5 }
      criteria:
        - { key: tech, name: { ko: 기술 구현 }, max: 40 }
        - key: product
          name: { ko: 사용 사례·혁신 }
          children:
            - { key: problem, name: { ko: 문제 정의 }, max: 10 }
            - { key: novelty, name: { ko: 새로움 }, max: 15 }
        - { key: pres, name: { ko: 발표·문서화 }, max: 35 }
  stages:
    - { id: screening, rubric: screening, gate_rule: majority, judges_per_project: 3, advance: { top_n: 10, per: [track] } }
    - { id: final, rubric: final, judges_per_project: 3 }
  final: { stage: final, precision: 2, rank_groups: [track, division], tie_break: [crit.tech, crit.product], unresolved_tie: manual }
```

`listPresets()`는 `[{ name, version, status: "stable" | "planned", summary }]`를 돌려줍니다(MCP `event_init_plan`이 씀).

### 8.9 JSON Schema (CFG-1)

CFG-1(P0)은 설정 v2 스키마를 zod로 정의하고 JSON Schema(2020-12)로 resource `hackathon://schema/event`(SPEC 12.1)에 공개하라고 합니다 **[D92]**.

- `config/schema.ts`는 층 파일 하나의 스키마 `layerSchema`를 transform 없이 정의합니다. 대상은 kind event·profile이고 사람이 쓰는 모양을 그대로 받습니다: 머리 키(`schema`, `kind`, `extends`), 병합 지시(`null` 지우기, key 목록의 `{ add, remove, update }`, 일반 목록의 `{ append }`), 축약형 키, deprecated 키(`deprecated: true` 주석)입니다. 기본값 채우기와 축약형 변환은 하지 않습니다.
- `configJsonSchema()`는 `z.toJSONSchema(layerSchema, { target: "draft-2020-12" })`에 `$id: "hackathon://schema/event"`를 붙여 돌려줍니다. `addons.<id>`에는 9.3의 옵션 스키마(와 `enabled`)를 add-on마다 끼웁니다. 출력은 결정적이고 `test/__snapshots__/event.schema.json`과 같아야 합니다.
- `ResolvedConfig`(병합·정규화 뒤 기본값을 채운 모양)의 zod 스키마는 따로 있고 JSON Schema로 내보내지 않습니다.
- 두 예제와 SPEC 예시 fixture(13.2)의 층 파일은 모두 `layerSchema`를 통과해야 합니다(`build.test.ts`).

### 8.10 module 끄기

SPEC 1.6 #2와 2.4는 기능을 module과 add-on으로 켜고 끈다고 하지만 module을 끄면 무엇이 달라지는지는 정하지 않았습니다 **[D108]**. module은 신청(`apply`), 제출(`submit`), 심사(`judge`) 흐름 하나를 키트로 처리할지를 정하는 플래그입니다. 끈 흐름의 화면과 요청은 백엔드와 사이트가 열지 않고(M3) core는 아래만큼 검사와 계산을 바꿉니다. 이 표에 없는 검사와 계산은 그대로입니다.

| 끈 module | core에서 달라지는 것 | 이유 |
| --- | --- | --- |
| `apply` | V11의 "kind event에 `name` 역할이 없음"을 건너뜁니다. 질문을 적었다면 질문 규칙, 개인정보 고지(V7)는 그대로 봅니다. | 명단을 운영진이 `participants_plan`으로 넣는 대회는 신청서가 없어도 됩니다. 명단에 개인정보가 있으므로 고지 검사는 남깁니다. |
| `submit` | 정규형 `submit.fields`는 `[]`이고 `opt_in: true`인 상은 V19 오류입니다("제출을 받지 않아 상에 지원할 수 없습니다"). `schedule.main.submit_deadline`은 적었으면 V1이 순서만 봅니다. | 지원할 길이 없는 opt-in 상은 늘 비게 됩니다. |
| `judge` | V3의 "루브릭에 기준이 없음"과 V17의 "마지막 단계의 실효 루브릭에 점수 기준이 없음"을 건너뜁니다. `rank`·`formula` 상은 V19 오류입니다("심사를 하지 않아 순위를 매길 점수가 없습니다"). popular_vote는 `modules [judge]`를 요구하므로(9.2) 켤 수 없습니다(V14). 그래서 `vote` 상도 V19가 막습니다. `computeResults`는 그대로 돌지만 모든 팀이 미채점이므로 UNSCORED 경고를 내지 않으며 `manual` 상만 배분됩니다. | 심사 없이 운영진이 지정하는 상만 주는 대회(아이디어 등록 행사 등)를 막지 않으려는 것입니다. |

module 끄기는 add-on과 달리 추가 확정 절차가 없고(SPEC 2.4) `event_plan`의 일반 변경으로 보입니다.

---

## 9. add-on 레지스트리

SPEC 2.4, 7.6 #11, ADD-1~6.

### 9.1 `AddonDef`

```ts
export type AddonStatus = "stable" | "beta" | "planned";
export type ModuleId = "apply" | "submit" | "judge";
export interface AddonDef {
  id: string;
  name: string;                         // 한국어 이름
  summary: string;                      // 한 줄 설명
  status: AddonStatus;
  since: string | null;                 // adds의 화면·시트 탭·도구가 모두 들어간 첫 키트 버전. 아직이면 null [D99]
  requires: { modules: ModuleId[]; addons: string[]; config: string[] };
  adds: {
    pages: string[];                    // 사이트 경로나 화면 설명
    sheet_tabs: string[];               // 시트 탭 이름
    tools: string[];                    // MCP 도구
    scopes: { apps_script: string[]; github_app: string[] };   // 늘어나는 권한
    quota_note: string;                 // 쿼터 영향(한국어)
    result_use: string | null;          // 결과에 쓰이는 방식(한국어)
    variables: string[];                // 식 변수(조건이 맞을 때)
  };
  disable_note: string;                 // 끄면 어떻게 되는지(ADD-4)
  options: z.ZodType;                   // strict, {}를 넣으면 기본값
  public_options: string[];             // event.json에 싣는 옵션 키
}
```

상태는 SPEC 2.4 표 그대로입니다("stable 목표"는 `stable`) **[D65]**. `planned`는 켤 수 없고(V14 오류) `beta`는 켤 수 있지만 V14 info로 알립니다.

**지금 버전에서 쓸 수 있는지** **[D99]**: 상태는 SPEC 2.4의 목표 상태이고 지금 키트 버전에 그 add-on이 들어 있는지는 `since`로 따로 봅니다. `addonShipped(id, kit_version)`은 `since`가 null이 아니고 `kit_version`이 `since` 이상(major·minor·patch를 숫자로 비교)일 때 참이며 키트 버전은 core 패키지 버전입니다(SPEC 18.2, 한 패키지 한 버전). core `check`는 설정 언어(옵션, 식 변수, 상)만 보므로 V14를 since와 관계없이 SPEC대로 적용합니다. 이 때문에 예제와 골든 테스트는 add-on 모듈이 나오기 전에도 돌아갑니다. MCP는 shipped가 아닌 add-on을 켜는 `event_plan`을 오류("{이름}({id})은(는) 키트 {since}부터 쓸 수 있습니다." / "{이름}({id})은(는) 이 키트 버전에 아직 들어 있지 않습니다.")로 거절하고 그런 add-on이 켜진 `_config`를 `backend_plan`이 배포하지 않습니다(SPEC 2.4의 "상태 칸의 뜻"). since는 그 add-on의 모듈을 넣는 릴리스에서 채우고 `release:check`는 since가 그 릴리스 이하인 add-on마다 `adds`의 화면·시트 탭·도구가 번들에 있는지 확인합니다. 지금 9.2의 add-on은 모두 `since: null`입니다.

### 9.2 목록

공통 `disable_note`: "끄면 데이터는 시트에 남기고 화면과 도구만 숨깁니다. 데이터 파기는 privacy_plan으로 합니다."

| id | 이름 | 상태 | requires | pages / sheet_tabs / tools | 권한(Apps Script / GitHub App) | result_use |
| --- | --- | --- | --- | --- | --- | --- |
| `popular_vote` | 인기투표 | stable | modules [judge] | `/vote/` / `votes` / `vote_plan` | 없음 / 없음 | 기본은 별도 상(method: vote). use: formula_input이면 식 변수 |
| `team_finder` | 팀원 모집 게시판 | stable | modules [apply] | `/board/` / `board`, `board_requests` / `board_plan` | 없음 | 없음 |
| `upload` | 파일 업로드 | stable | modules [submit] | `/me/` 제출 칸 / `uploads` / `uploads_plan` | `https://www.googleapis.com/auth/drive.file` | 없음 |
| `mail` | 메일 알림 | stable | 없음 | 없음 / `mail_log` / (`notice_plan`이 메일을 보냄) | `https://www.googleapis.com/auth/script.send_mail` | 없음 |
| `award_show` | 시상 화면 | stable | modules [judge] | `/award/` / 없음 / 없음 | 없음 | 확정 결과만 보여 줌 |
| `public_status` | 공개 현황판 | stable | modules [submit] | 홈 "현황" 띠, 정적 `status.json` / 없음 / 없음 | 없음 | 없음 |
| `github_ops` | GitHub org 운영 | stable | config [github] | 없음 / 없음 / `repos_plan` | 없음 / Administration·Members·Contents 쓰기 | 없음 |
| `integrity_check` | 커밋 이력 점검 | stable | addons [github_ops] | 없음 / 없음 / `repo_activity` | 없음 / Contents·Metadata 읽기 | 없음 |
| `apps_review` | GitHub 앱 설치 요청 심사 | stable | addons [github_ops] | 없음 / 없음 / `apps_review_plan` | 없음 / Organization administration 읽기 | 없음 |
| `rsvp_waitlist` | 참석 확정·대기자 | beta | modules [apply] | `/me/` 버튼 / `rsvp` / `rsvp_plan` | 없음 | 없음 |
| `checkin` | QR 체크인 | beta | modules [apply] | `/checkin/` / `checkins` / `checkin_plan` | 없음 | 없음 |
| `gallery` | 작품 갤러리 | beta | modules [submit] | `/gallery/` / 없음 / 없음 | 없음 | 없음 |
| `ranked_judging` | 순위형 심사 | planned | modules [judge] | | | |
| `peer_vote` | 팀 상호 투표 | planned | modules [judge] | | | 식 변수 `peer` |
| `ai_score_input` | AI 평가 입력 | planned | modules [judge] | 없음 / `ai_scores` / `ai_scores_plan` | | 식 변수 `ai.<key>` |
| `certificates` | 인증서 | planned | 없음 | | | |
| `guardian_consent` | 법정대리인 동의 | planned | modules [apply] | | | 만 14세 미만 참가 |
| `expo_tables` | 엑스포 테이블 배정 | planned | modules [judge] | | | |

`quota_note`: popular_vote "투표 기간에 투표자 한 명당 쓰기 요청 1번", team_finder "글·요청마다 쓰기 1번", upload "브라우저가 Drive로 직접 올리므로 Apps Script 실행 시간은 작음", mail "계정의 하루 메일 수신자 한도(일반 100명, Workspace 1,500명)", github_ops "GitHub API 쓰기 직렬 큐(쓰기 사이 1초)", 나머지 "작음". 공지(notices)는 core 기능이고 심사위원 배정은 core 기능(MCP `judging_plan`)이며 `slide_preview`, `track_moves`, `mentor_queue`는 없앴습니다(8.6).

### 9.3 옵션 스키마와 기본값

| add-on | 옵션(기본값) | 공개 옵션 |
| --- | --- | --- |
| `popular_vote` | `voters: participants \| finalists \| domain`(participants), `voter_domains: string[]`([], domain이면 1개 이상), `votes_per_voter: 1..20`(3), `self_vote: boolean`(false), `window: { from: Iso, until: Iso } \| null`(null), `use: separate_prize \| formula_input`(separate_prize), `normalize: share_of_max \| capped_sqrt`(share_of_max), `full_at_multiple: number > 0`(2) | 전부(`voter_domains` 제외) |
| `team_finder` | `close_at: Iso \| null`(null = `schedule.team_lock`) | 전부 |
| `upload` | `team_max_gb: number > 0`(1), `kinds: { <id>: { name: Localized, max_mb: number > 0, ext: string[] (1개 이상) } }`({}), `late_minutes: 0..1440`(0) | 전부 |
| `mail` | `events: (application_received \| team_accepted \| deadline_reminder)[]`(셋 다) | 없음 |
| `award_show` | `reveal: one_by_one \| all`(one_by_one) | 전부 |
| `public_status` | `show: (submissions \| votes)[]`([submissions]) | 전부 |
| `github_ops` | `write_delay_ms: 정수 1000..60000`(1000. GitHub 쓰기 사이 간격, SPEC 15.3·GH-8), `templates: { <track id>: "owner/repo" }`({}. 트랙별 template repo, key는 tracks에 있어야 함(V14)) **[D100]** | 없음 |
| `integrity_check` | `big_first_commit_lines: 정수 ≥ 1`(5000), `prep: { from: Iso \| null } \| null`(null. 준비 기간. null이면 시작 전 커밋을 모두 표시, `from: null`이면 시작 전 커밋을 모두 허용, 시각이면 그때부터 허용), `late_push: { enabled: boolean, tracks: { <track id>: boolean } }`({ enabled: true, tracks: {} }. 마감 뒤 push 점검과 트랙별 덮어쓰기, key는 tracks에 있어야 함(V14)) **[D100]** | 없음 |
| `apps_review` | `{}` | 없음 |
| `rsvp_waitlist` | `confirm_by: Iso \| null`(null), `capacity: 정수 ≥ 1 \| null`(null) | 전부 |
| `checkin` | `{}` | 없음 |
| `gallery` | `include: all \| winners`(all) | 전부 |
| planned 전부 | `{}`(키를 적으면 V14 오류) | |

옵션은 add-on이 꺼져 있어도 검사합니다(V14). 정규형 `addons`에는 적힌 add-on마다 `enabled`와 기본값을 채운 옵션이 들어갑니다.

### 9.4 추가 확정 데이터 (ADD-1, ADD-3)

```ts
export interface AddonCatalogEntry {             // hackathon://addons/catalog
  id: string; name: string; summary: string; status: AddonStatus;
  shipped: boolean; since: string | null;        // D99. 지금 키트 버전 기준
  requires: AddonDef["requires"]; adds: AddonDef["adds"]; disable_note: string;
  options_schema: object;                        // z.toJSONSchema(options)
  defaults: Record<string, unknown>;
}
export interface AddonConfirmation {              // event_plan의 확정 섹션 한 개
  id: string; name: string; status: AddonStatus;
  shipped: boolean; since: string | null;        // D99. 지금 키트 버전 기준
  action: "enable" | "disable" | "options";
  adds: AddonDef["adds"];                        // action이 enable일 때 보여 줄 것
  options: { key: string; value: unknown; default: unknown; changed: boolean }[];
  new_scopes: string[];                          // 켜기 전 설정에 없던 Apps Script 권한
  removed_scopes: string[];                      // disable일 때 매니페스트에서 빠질 Apps Script 권한(ADD-5)
  reauthorization_required: boolean;             // new_scopes가 있으면 true(ADD-5)
  backend_redeploy_required: boolean;            // Apps Script 권한 집합이 바뀌면 true(backend_plan으로 이어짐)
  new_github_permissions: string[];              // 켜기 전 설정에 없던 adds.scopes.github_app(SET-4)
  github_approval_required: boolean;             // new_github_permissions가 있으면 true(GitHub에서 승인)
  disable_note: string;
  result_use: string | null;
  high_impact: true;                             // 계획의 높은 영향 섹션(SPEC 12.2)
}
export type AddonState = Pick<NormalizedConfig, "addons" | "modules">;   // ResolvedConfig도 이 모양을 만족함
export function addonCatalog(): AddonCatalogEntry[];
export function addonConfirmation(before: AddonState | null, after: AddonState, id: string): AddonConfirmation | null;
export function addonChanges(before: AddonState | null, after: AddonState): AddonConfirmation[];   // id 순서
```

두 함수는 `addons`와 `modules`만 읽습니다. 그래서 `plan`(11.5)처럼 기준 설정이 `loadConfigTab`이 돌려준 `NormalizedConfig`이고 새 설정이 `ResolvedConfig`인 경우에도 그대로 부릅니다.

`addonChanges`는 켜짐·꺼짐·옵션 변경이 있는 add-on마다 하나씩 만듭니다. 권한 차이는 켜진 add-on 전체의 권한 집합(Apps Script, GitHub App 각각)을 before·after로 비교해 구하므로, 다른 켜진 add-on에 이미 있는 권한은 새 권한으로 세지 않습니다. `variables`는 popular_vote에서 `use: formula_input`일 때만 `votes, total_votes, avg_votes, max_votes, team_count, popular`입니다.

### 9.5 API

`listAddons(): AddonDef[]`(표 순서), `findAddon(id)`(별명은 찾지 않음), `addonEnabled(config, id)`(`enabled: true`를 적었을 때만 참).

---

## 10. 검증 규칙 (`check`)

### 10.1 `checkConfig`와 context

```ts
export interface CheckContext {
  files: SourceFile[];          // V8 ①, V12(원문)
  layers?: RawLayer[];          // V8 ②, V12, V14(preset 층) — 없으면 files를 다시 읽음
  assets?: AssetRef[];          // V22 — 없으면 V22를 건너뜀
  locks?: { stages: Record<string, {
    fingerprint: string;        // "fp1:…"(10.3)
    locked_at: Iso;
    revision: number;           // 잠글 때의 _config revision
    config?: NormalizedConfig | null;   // 그 revision의 정규형(CFG-9 이력). 지문 버전이 다를 때만 씀
  }> };                         // V20 — 백엔드의 단계 잠금 기록
  unlocks?: { stage: string; reason: string; scores: "keep" | "rescore"; at: Iso }[];   // V20 — 잠금 해제 절차를 밟았고 아직 닫히지 않은 단계(아래)
  revision?: number;            // V23이 만들 공개 투영의 revision(기본 0)
  aliases?: [string, string][]; // 4.2·6.7·8.6의 경로 별명. checkFile은 loadConfig 결과에서 채우고, resolveLayers를 쓴 MCP는 그 결과의 aliases를 넘김
}
export function checkConfig(resolved: ResolvedConfig, ctx: CheckContext): Diagnostic[];
export function checkFile(file: string, options?: { home?: string } & Omit<CheckContext, "files" | "layers" | "assets">): CheckedFile;
export interface CheckedFile { config: ResolvedConfig | null; files: SourceFile[]; diagnostics: Diagnostic[] }
```

- 진단 순서: 불러오기 진단(발생 순서) → V1, V2, V3, V4, V5, V6, V7, V8, V10, V11, V12, V14, V15, V16, V17, V18, V19, V20, V21, V22, V23, V24. 규칙 안에서는 설정 순서입니다.
- 오류가 하나라도 있으면 빌드·계획을 만들지 않습니다. check를 통과한 설정은 반드시 빌드됩니다(테스트로 확인).
- 경로는 4.2·6.7·8.6의 별명(`ctx.aliases`)으로 사용자가 적은 곳을 가리킵니다. checkConfig가 진단의 `path`를 가장 긴 접두어가 맞는 별명으로 바꾸고 `source`도 그 경로로 찾습니다(8.4).
- `kind`가 profile·preset이면 "있어야 한다"는 규칙(V3의 빈 루브릭, V7의 항목 존재와 수집 key, V11의 name 역할, event 필수 키)을 건너뛰고 값 규칙만 봅니다. `scoring`에 축약형 키도 단계형 키도 없으면 `criteria: []`인 축약형으로 봅니다. 꺼진 module이 바꾸는 규칙은 8.10입니다.
- **check가 쓰는 정규형** **[D117]**: V4, V18, V20과 V5·V19의 일부는 `NormalizedConfig`의 모양(실효 루브릭, 장소, 상의 pool)이 필요합니다. checkConfig는 `normalizeShape(resolved)`(11.1의 1단계, 수식 칸은 원문만)를 한 번 만들어 이 규칙들에 넘기고 수식은 V4가 컴파일합니다. `normalizeShape`는 schema를 통과한 설정에서 던지지 않습니다(없는 루브릭·단계·트랙을 가리키는 참조도 그대로 둠). 그 대신 V17의 루브릭·단계 참조 오류나 V15의 트랙·부문 참조 오류가 하나라도 있으면, 참조를 풀어야 하는 V4, V18, V20을 돌리지 않고 info 하나(code `CHECK_SKIPPED`, "참조 오류가 있어 식 검사(V4)와 그 뒤 검사를 건너뛰었습니다. 위 오류를 고친 뒤 다시 검사해 주세요.")를 냅니다. `stageSettings`가 모르는 루브릭에서 `E_CONFIG`를 던지므로(4.12), 이 규칙이 없으면 흔한 오타 하나로 check가 진단 대신 예외로 끝납니다(0.1 #8). V4에 오류가 있으면 V20을 돌리지 않습니다(지문에 식 AST가 필요하고 V4 오류가 이미 계획을 막음).
- `locks`와 `unlocks`는 MCP가 백엔드의 잠금 기록과 judging_plan의 해제 기록에서 넘깁니다. `rescore`로 푼 단계는 백엔드가 그 단계의 epoch를 1 올립니다(4.3) **[D90]**.
- **잠금 해제는 한 번 쓰는 허가입니다** **[D90]**: `keep`이든 `rescore`든, 해제한 뒤 그 단계의 지문이 바뀐 revision이 처음 적용되면 백엔드가 잠금 기록의 지문과 revision을 그 revision의 `stage_fingerprints` 값으로 바꾸고 해제 기록을 닫습니다. 단계는 열린 채로(잠긴 채로) 남습니다. 그래서 그다음 변경은 다시 잠금 해제를 거쳐야 합니다. 해제 기록이 계속 남아 그 뒤의 모든 변경이 통과하는 일도, 해제하고 바꾼 뒤에도 옛 지문과 비교해 V20 오류가 계속 나는 일도 생기지 않습니다. `ctx.unlocks`에는 닫히지 않은 해제 기록만 넘깁니다. 지문이 바뀌지 않는 계획(문구 변경 등)은 해제 기록을 닫지 않습니다.
- V9(운영진 목록과 솔트)는 백엔드 health 점검으로 옮겼습니다(BE-7). 번호는 비워 둡니다.

### 10.2 V1~V24

오류에는 "고칠 방법"(`fix`)이 반드시 있습니다(1.4, CFG-4). 경고·정보의 고칠 방법은 있으면 붙입니다. `{…}`는 진단을 만들 때 채우는 값이고 사용자가 자기 설정에 적은 값은 보여 주되 비밀 모양의 값은 되풀이하지 않습니다.

| ID | 조건 | 심각도 | 경로 | 메시지 | 고칠 방법 |
| --- | --- | --- | --- | --- | --- |
| V1 | 모든 시각(`schedule.*`, 세션, 연장, 트랙 `vote`·`submit_deadline`, add-on 옵션의 시각 `popular_vote.window`, `team_finder.close_at`, `rsvp_waitlist.confirm_by`, `integrity_check.prep.from`)이 `Iso`이고 달력에 있는 날짜·시각 | error | 그 키 | {경로}의 시각 "{값}"은 형식이 올바르지 않습니다. / 없는 날짜나 시각입니다: {값} | "2027-04-04T10:00:00+09:00"처럼 날짜, 시각, UTC 오프셋을 함께 적어 주세요. |
| V1 | 트랙마다(트랙이 없으면 한 번) 사슬 `recruit.open < recruit.close ≤ team_lock ≤ main.start < 마감_t ≤ vote_t.from < vote_t.until ≤ score_until ≤ results_at`. `마감_t` = 트랙 `submit_deadline` ?? `main.submit_deadline`, `vote_t` = 트랙 `vote` ?? popular_vote `window`. 빈 시각은 건너뛰고 앞뒤를 비교하며 건너뛴 연결에 `<`가 하나라도 있으면 `<`. `results_at: off`는 뺌. 세션은 사슬에 넣지 않음(형식만). 비교는 `isoToMs` | error | 뒤 시각 | {b}({b값})는 {a}({a값})보다 늦어야 합니다. / {b}({b값})는 {a}({a값})보다 앞설 수 없습니다. | 두 시각의 순서를 바로잡아 주세요. 순서: 모집 열림 < 모집 닫힘 ≤ 팀 잠금 ≤ 본 행사 시작 < 제출 마감 ≤ 투표 창 ≤ 심사 마감 ≤ 결과 공개 |
| V1 | `addons.integrity_check.prep.from`이 `schedule.main.start`보다 늦거나 같음 **[D100]** | error | `addons.integrity_check.prep.from` | 준비 기간 시작({from})은 본 행사 시작({start})보다 앞서야 합니다. | prep.from을 main.start보다 앞으로 옮겨 주세요. |
| V1 | `schedule.extensions[i]`: `team`이 팀 id 규칙(0.2)을 따르고 한 번만 나오며 `until`이 그 팀 트랙의 `마감_t`보다 늦고 `score_until` 이하. 팀 번호가 어느 트랙의 `teams` 범위에도 없으면 모든 트랙 마감 중 가장 이른 것과 비교 **[D88]** | error | `schedule.extensions[i].until` | 팀 {team}의 연장 마감({until})이 원래 마감({마감})보다 늦지 않습니다. / 팀 {team}의 연장 마감이 심사 마감(score_until)보다 늦습니다. | 원래 마감보다 늦고 score_until보다 이르거나 같은 시각을 적어 주세요. |
| V1 | `event.timezone`이 Node `Intl`이 아는 IANA 이름 | error | `event.timezone` | event.timezone "{값}"은 IANA 시간대 이름이 아닙니다. | Asia/Seoul처럼 IANA 시간대 이름을 적어 주세요. |
| V1 | kind event인데 `event.timezone`이 없음 | info | `event.timezone` | 대회 시간대가 없어 UTC로 표시합니다. | event.timezone에 Asia/Seoul처럼 적어 주세요. |
| V2 | 트랙의 팀 번호 범위가 거꾸로이거나 다른 트랙과 겹침(v1과 같음) | error | `tracks.<id>.teams[i]` | 팀 번호 범위 "{text}"는 작은 번호를 앞에 적어야 합니다. / 트랙 {b}의 팀 번호 "{text}"가 트랙 {a}의 "{text_a}"와 겹칩니다. | 한 팀은 한 트랙에만 있도록 범위를 나눠 주세요. |
| V3 | 기준 key가 Ident·32자 이하·예약어/금지 이름 아님 | error | `…criteria[i].key` | 기준 key "{key}"는 쓸 수 없습니다. | 영문 소문자나 _로 시작해 영문 소문자, 숫자, _로 32자까지 적어 주세요. and·or·not, constructor·prototype, __로 시작하는 이름은 쓸 수 없습니다. 수식에서 crit.{key}로 읽습니다. |
| V3 | key가 루브릭 안에서 겹침 | error | 같음 | 기준 key "{key}"가 루브릭 {r} 안에서 겹칩니다. | 다른 key로 바꿔 주세요. |
| V3 | weight가 `(0, 1000]` 밖이거나 소수 6자리 초과 | error | `.weight` | 기준 "{key}"의 weight가 범위 밖입니다. | 0보다 크고 1000 이하인 수(소수 6자리까지)를 적어 주세요. |
| V3 | 점수 리프에 max가 없음(리프·루브릭 scale 모두) | error | `.max` | 기준 "{key}"에 만점(max)이 없습니다. | 기준이나 루브릭의 scale에 max를 적어 주세요. |
| V3 | `0 ≤ min < max ≤ 1e6`, `0 < step ≤ max − min`, 소수 6자리 이하가 아님 | error | 해당 키 | 기준 "{key}"의 척도가 올바르지 않습니다: {이유}. | 0 ≤ min < max ≤ 1000000, 0 < step ≤ max − min, 소수 6자리 이하로 적어 주세요. |
| V3 | `(max − min)`이 step의 배수가 아님 | warning | `.step` | 기준 "{key}"는 {min}부터 {step}씩 올리면 만점 {max}에 닿지 않습니다. | max − min이 step의 배수가 되게 해 주세요. |
| V3 | 게이트가 최상위 리프가 아니거나 weight·척도·anchors·children이 있음 | error | `.type` | 게이트 기준 "{key}"는 맨 위 단계의 리프여야 하고 점수 속성을 적을 수 없습니다. | 게이트를 맨 위로 옮기고 weight, 척도, anchors, children을 지워 주세요. |
| V3 | anchors 키가 숫자가 아니거나 `[min, max]`·step 밖 | error | `.anchors.<k>` | 점수 기준표의 {k}점은 이 기준의 척도 밖입니다. | [min, max] 안에서 step 단위의 값만 적어 주세요. |
| V3 | 루브릭에 기준이 없음(`modules.judge: false`면 건너뜀, 8.10) | error | `scoring.rubrics.<r>` | 루브릭 {r}에 기준이 없습니다. | criteria에 기준을 하나 이상 적어 주세요. |
| V3 | 척도가 둘 이상 섞였고 리프 경로 weight 곱의 합이 100(±1e-9)이고 `scale_normalize`가 꺼짐 | warning | `scoring.rubrics.<r>` | 루브릭 {r}은 척도가 섞여 있고 가중치 합이 100입니다. | 가중치를 비율로 쓰려면 scale_normalize: true를 켜 주세요. |
| V3 | 오류 없는 루브릭마다 | info | `scoring.rubrics.<r>`(축약형 `scoring.criteria`) | 루브릭 {r}: 만점(max_total) {n}점. 리프별 실효 비중: {key} {share}%, … | |
| V4 | 식 칸(최종, tie_break, 덮어쓰기, 상)을 그 식이 적용되는 장소(0.2의 장소 목록 중)마다 `compileFormula(source, variableSet(장소))`로 컴파일. 기본 `final.tie_break`는 비교 설정이 섞인 pool(6.1)의 모든 장소에도 적용되는 것으로 봄. 실패하면 오류(F_STAGE_ORDER는 V17로 보고). 어느 장소에도 닿지 않는 식은 모든 장소 변수의 합집합으로 컴파일. 부문이 있는 트랙의 `(track, null)`은 목록에 없으므로 보지 않음(D116) | error | 식 칸 경로 | 2.8의 메시지 + 덮어쓰기면 " ({트랙 a · 부문 s}에 적용될 때)" | 메시지가 가리킨 글자 근처를 고쳐 주세요. 가까운 이름이 있으면 suggestion을 함께 보여 줍니다(2.9). |
| V4 | lint(2.10) | warning | 같음 | 2.10의 메시지 | 2.10의 메시지에 고칠 방법이 들어 있습니다. |
| V5 | 순위형 상의 같은 사다리에서 `count` 합 > pool의 팀 수. 팀 수는 트랙 `teams` 범위로만 알 수 있고 모르면 건너뜀. 부문 pool이면 트랙 팀 수와 비교해 경고 | error / warning | `prizes[i]` 또는 `tracks.<id>.prizes` | {pool}의 순위형 상은 {n}팀에게 상을 주는데 이 범위의 팀은 {m}팀입니다. | count를 줄이거나 트랙의 teams 범위를 확인해 주세요. |
| V5 | `prize_policy.max_per_team`이 있고 `*`와 트랙 pool(`<track>`)마다 그 pool 안을 scope로 하는 모든 상의 `count` 합이 그 pool의 팀 수 × `max_per_team`보다 큼. 방식과 사다리는 가리지 않고 득표 상과 식형 상도 순위 키(`vote:`·`formula:`)가 아니라 scope의 pool로 셈. 그래서 `*`에는 모든 상이, `<track>`에는 그 트랙과 그 트랙의 부문을 scope로 하는 상이 듦. `*`의 팀 수는 모든 트랙 팀 수의 합이고 트랙이 하나뿐이면 두 pool의 팀이 같으므로 `*`만 봄. 팀 수는 위와 같이 트랙 `teams` 범위로만 알 수 있고 모르면 건너뜀 **[D110]** | warning | `prizes[i]`(그 pool의 마지막 상) | {pool}의 상은 모두 {n}개인데 팀 {m}팀이 {k}개씩만 받을 수 있어 {r}개는 채울 수 없습니다(r = n − m × k). | 상 수를 줄이거나 max_per_team을 늘려 주세요. 채우지 못한 상은 결과를 계산할 때 빈 상(PRIZE_VACANT·PRIZE_UNFILLED)이 됩니다. |
| V5 | 맵 형식 상금표인데 트랙에 부문이 없거나 `rank_groups`에 division이 없음 | error | `tracks.<id>.prizes` | 부문별 상금표는 트랙에 부문이 있고 rank_groups에 division이 있을 때만 쓸 수 있습니다. | 목록 형식으로 바꾸거나, 트랙에 divisions와 final.rank_groups에 division을 적어 주세요. |
| V6 | popular_vote가 켜졌을 때: `tracks.<id>.vote`를 적은 트랙들의 창끼리, 그리고 그 창과 공통 창(`addons.popular_vote.window`, 이 창을 쓰는 트랙이 하나라도 있을 때)이 겹침. 공통 창을 함께 쓰는 트랙끼리는 비교하지 않음 **[D55]** | error | `tracks.<id>.vote` 또는 `addons.popular_vote.window` | 트랙 {b}의 투표 창이 {트랙 a의 투표 창 / 공통 투표 창}과 겹칩니다. | 투표 창이 겹치지 않게 시각을 옮겨 주세요. 여러 트랙이 같은 창을 쓰려면 트랙의 vote를 지우고 공통 window를 쓰면 됩니다. |
| V6 | 자기 창이 있는 트랙들의 창이 트랙 `order` 순서로 열리지 않음 | warning | `tracks.<id>.vote` | 트랙 {b}의 투표 창이 order가 앞선 트랙 {a}보다 먼저 열립니다. | 투표 창을 트랙 order 순서로 두면 참가자 화면이 덜 헷갈립니다. |
| V6 | popular_vote가 켜졌는데 어느 트랙에도 투표 창이 없음 | warning | `addons.popular_vote.window` | 투표 창이 없습니다. | vote_plan으로 열거나 window를 적어 주세요. |
| V7 | kind event인데 `privacy.purpose`, `items`(1개 이상), `retention.days_after_event`, `refusal`, `contact` 중 빠진 것 | error | `privacy.<key>` | 개인정보 고지에 {항목}이(가) 없습니다. | privacy.{key}를 적어 주세요. 개인정보 보호법이 목적·항목·보유기간·거부 시 불이익·문의처의 고지를 요구합니다. |
| V7 | kind event인데 수집하는 key(`intake.fields[].key`, `intake.proofs[].key`, `divisions.*.extra_fields[].key`, 로그인으로 받는 `email`)가 `privacy.items`에 없음 **[D67]** | error | `privacy.items` | 질문 "{key}"로 받는 값이 개인정보 고지 항목(privacy.items)에 없습니다. 고지하지 않은 항목은 받을 수 없습니다(PRIV-2). | privacy.items에 "{key}"를 더하거나 질문을 지워 주세요. |
| V7 | `days_after_event`, `winners_days`가 0 이상 정수가 아님 | error | `privacy.retention.<key>` | 보유기간은 0일 이상의 정수여야 합니다. | 일 수를 0 이상의 정수로 적어 주세요. |
| V8 | ① 설정 원문의 줄에 비밀 모양: `-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----`, `\bgh[pousr]_[A-Za-z0-9]{20,}`, `\bgithub_pat_[A-Za-z0-9_]{20,}`, `\bAIza[0-9A-Za-z_-]{20,}`, `\bGOCSPX-[A-Za-z0-9_-]{20,}`, `["']private_key["']\|\bprivate_key\s*:`, `\bxox[abprs]-[A-Za-z0-9-]{10,}`(Slack), `\bAKIA[0-9A-Z]{16}\b`(AWS), `\b1//0[A-Za-z0-9_-]{20,}`(Google refresh token) **[D72]** | error | `<파일>:<줄>` | 비밀로 보이는 값({종류})이 있습니다. | 키와 토큰은 설정 파일이 아니라 키체인이나 스크립트 속성에 두세요. 이미 공유된 값이면 바로 폐기해 주세요. |
| V8 | ② `file: null`인 층(메모리 설정)의 data와 병합된 설정의 모든 문자열 값과 맵 키에 ①의 패턴. 파일이 있는 층에서 ①이 이미 보고한 값은 건너뜀 **[D95]** | error | 설정 경로 | 같음 | 같음 |
| V8 | ③ 느슨한 섹션(`github`, `repo`, `reviewers`, 8.1)과 add-on 옵션에서 키 이름이 `token`, `secret`, `password`, `private_key`, `api_key`, `operator_key`, `salt`이거나 `_token`·`_secret`·`_key`로 끝남(값과 관계없이) **[D95]** | error | 설정 경로 | {경로}는 비밀을 담는 키 이름({이름})입니다. | 비밀은 설정에 두지 않습니다. 이 키를 지우고 값은 키체인이나 스크립트 속성에 두세요. |
| V10 | github_ops가 켜졌는데 `intake.identity.github.required`가 거짓 | warning | `intake.identity.github.required` | github_ops가 켜져 있는데 신청할 때 GitHub 아이디를 필수로 받지 않습니다. repo에 초대할 계정을 찾지 못할 수 있습니다. | intake.identity.github.required: true로 두세요. |
| V11 | 질문 key 규칙(7.8, 금지 이름 포함) | error | `intake.fields[i].key` | 질문 key "{key}"는 쓸 수 없습니다. | 문자·숫자·_·공백으로 40자까지 적고, email·email_domain·hosted_domain, verified로 시작하는 이름, 점(.), 0.2의 금지 이름은 피해 주세요. |
| V11 | 질문 key가 같은 답 묶음(7.8: 신청은 `intake.fields`와 모든 부문의 `extra_fields`, 제출은 `submit.fields`) 안에서 겹침 | error | `intake.fields[i].key` 등 | 질문 key "{key}"가 {다른 질문의 경로}와 겹칩니다. key는 시트의 열 이름이라 하나여야 합니다. | 다른 key로 바꿔 주세요. |
| V11 | 같은 답 묶음의 두 질문 key가 NFKC로 바꾸고 소문자로 만들면 같음 **[D102]** | error | `intake.fields[i].key` 등 | 질문 key "{key}"가 {다른 질문의 경로}의 key와 같은 글자로 보입니다. | 눈으로 구별되는 다른 key로 바꿔 주세요. |
| V11 | 보기 값 유일·비지 않음, `solo` ⊆ options, 형식별 속성(7.8 표), `max_length` 상한, number 질문의 `min`·`max`·`step`이 소수 6자리 이하이고 `step` ≥ 0.000001 | error | 해당 키 | 질문 "{key}"의 {속성}이 올바르지 않습니다: {이유}. | 7.8의 표대로 {형식} 질문에 맞는 속성만 적어 주세요. |
| V11 | 명단 역할이 겹침 / kind event에 `name` 역할이 없음(`modules.apply: false`면 이 둘째 검사를 건너뜀, 8.10) | error | `intake.fields[i].roster` / `intake.fields` | 명단 역할 {role}을(를) 둘 이상의 질문이 씁니다. / 이름을 받는 질문이 없습니다. | 역할마다 질문 하나에만 roster를 적고, 질문 하나에 roster: name을 적어 주세요. |
| V11 | `show_if`가 뒤에 있는 질문이나 `verified.*`를 읽음. 부문 추가 질문은 `intake.fields`와 앞선 부문 항목의 질문도 앞에 있는 것으로 봄(7.10 3단계). 제출 질문(`submit.extra_fields`)은 앞선 제출 질문만 읽을 수 있고 `email_domain`·`hosted_domain`도 쓸 수 없음(7.11) | error | `….show_if` | 질문 "{key}"의 show_if가 뒤에 있는 질문(또는 verified.*, 제출 질문이 읽을 수 없는 이름)을 읽습니다. | 앞에 있는 질문이나 email_domain, hosted_domain만 읽게 고쳐 주세요. 제출 질문은 앞선 제출 질문만 읽습니다. |
| V11 | github 필수인데 `type: github`, `required: true`인 질문이 없음 | error | `intake.identity.github.required` | GitHub 아이디를 필수로 받는데 github 형식의 필수 질문이 없습니다. | type: github, required: true인 질문을 하나 더해 주세요. |
| V11 | 동의·증빙 key가 겹치거나 built-in 이름(`privacy`, `age_14_plus`)·금지 이름 | error | `intake.consents[i].key` / `intake.proofs[i].key` | 동의 key "{key}"는 겹치거나 core가 넣는 동의와 같습니다. | 다른 key로 바꿔 주세요. |
| V11 | `submit.extra_fields`와 `divisions.*.extra_fields`에도 위의 질문 규칙 | error | 해당 경로 | 위와 같음 | 위와 같음 |
| V12 | locked key(8.7) | error | locked 경로 | 8.7의 메시지 | 8.7의 fix |
| V13 | extends 대상 파일·profile이 없음 | error | 파일 | {파일}이 가리키는 {ref}를 찾을 수 없습니다. | 경로나 이름을 확인해 주세요. profile:<이름>은 home 폴더(--home)의 profiles/<이름>.yaml에서 찾습니다. |
| V13 | 순환, 깊이 5 초과, 한 목록에 같은 파일 두 번, 읽은 파일 50개 초과 | error | 파일 | extends가 순환합니다: {사슬} / extends가 5단계를 넘습니다. / 같은 파일을 두 번 extends합니다: {파일} / 읽은 설정 파일이 50개를 넘습니다. | 상속 사슬을 줄이거나 중복을 지워 주세요. |
| V13 | 없는 preset 이름·버전 / planned preset | error | 파일 | preset:{이름}@{n}이 없습니다(있는 판: {판들}). / {이름} preset은 아직 준비 중입니다. | 있는 판(예: preset:{이름}@1)을 적어 주세요. / 다른 preset으로 시작하고 필요한 질문을 직접 더해 주세요. |
| V14 | 모르는 add-on id | error | `addons.<id>` | 알 수 없는 add-on입니다: {id}. | 있는 add-on({목록}) 중 하나를 적어 주세요. |
| V14 | 없앤 add-on을 켬 | error | `addons.<id>` | {id}는 v0.5에서 없앤 add-on입니다({대신}). | 이 항목을 지워 주세요. {대신} |
| V14 | 옵션이 스키마에 맞지 않음(꺼져 있어도) | error | `addons.<id>.<옵션>` | {이름} 옵션: {zod 메시지} | 9.3의 옵션 표대로 적어 주세요. |
| V14 | planned를 켬 | error | `addons.<id>` | {이름}({id})는 아직 준비 중이라 켤 수 없습니다. | enabled를 지워 주세요. |
| V14 | beta를 켬 | info | `addons.<id>` | {이름}은(는) beta라 동작이 바뀔 수 있습니다. | |
| V14 | requires의 module·add-on·설정 섹션이 없음 | error | `addons.<id>` | {이름}({id})를 켜려면 {module judge / add-on github_ops / github 설정}이 있어야 합니다. | 필요한 것을 먼저 켜거나 적어 주세요. |
| V14 | preset 층(`layers`의 kind preset)이 `addons.<id>.enabled: true`를 씀 | error | `addons.<id>.enabled` (code PRESET_ENABLES_ADDON) | preset({파일})은 add-on을 켤 수 없습니다. | 추천은 recommended_addons에 적고, 켜는 것은 운영진의 추가 확정으로만 합니다. |
| V14 | `recommended_addons`에 모르는 id | warning | `recommended_addons[i]` | 추천 목록의 add-on {id}를 알 수 없습니다. | 있는 add-on id로 고쳐 주세요. |
| V15 | 트랙이 여는 부문이 `divisions`에 없음 | error | `tracks.<id>.divisions[i]` | 트랙 {id}가 여는 부문 "{d}"가 divisions에 없습니다. | divisions에 {d}를 정의하거나 트랙의 목록에서 지워 주세요. |
| V15 | 조건(부문, 자격, 가산점, 상 자격, show_if)의 field가 질문 key, `email`, `email_domain`, `hosted_domain`, `verified.<증빙 key>`가 아님. 부문 추가 질문(`divisions.*.extra_fields`)의 key는 자격·가산점·상 자격 조건과 부문 추가 질문의 show_if는 읽을 수 있지만 부문 판정 조건(`divisions.*.when`)은 읽을 수 없음 **[D112]** | error | `….when….field` | 조건이 읽는 질문 "{field}"가 없습니다. / 부문 판정 조건은 부문 추가 질문 "{field}"를 읽을 수 없습니다. 그 질문은 부문 조건을 만족한 사람에게만 묻기 때문입니다. | 질문 key나 email, email_domain, hosted_domain, verified.<증빙 key>를 적어 주세요. / 부문 판정에 필요한 값은 intake.fields의 질문으로 받아 주세요. |
| V15 | 덮어쓰기(`stages[].overrides`, `final.overrides`)의 `when`이 없는 트랙·부문을 가리킴 | error | `….when` | 덮어쓰기가 가리키는 {트랙 / 부문} "{v}"가 없습니다. | 있는 트랙·부문 id를 적어 주세요. |
| V15 | 덮어쓰기의 `when`에 맞는 장소가 없음(그 트랙이 그 부문을 열지 않음 등) | warning | `….when` | 덮어쓰기 {경로}에 맞는 장소(트랙·부문)가 없어 쓰이지 않습니다. | when을 확인해 주세요. 부문은 그 트랙이 여는 것이어야 합니다. |
| V16 | 정량자 모양과 값(at_least 정수 ≥ 1, at_most 정수 ≥ 0, ratio (0,1] 소수 6자리, pick.by가 single·number·date 질문, order max\|min) | error | `….team_rule` | 팀 정량자가 올바르지 않습니다: {이유}. | 7.4의 표대로 적어 주세요. |
| V16 | `at_least: k`에서 k > 트랙 `team_size.max` | warning | `….team_rule` | 팀원이 최대 {max}명이라 {k}명 이상은 만족할 수 없습니다. | k를 줄이거나 team_size.max를 늘려 주세요. |
| V16 | `division_as_of: team_lock`인데 `schedule.team_lock`이 없음 | info | `tracks.<id>.division_as_of` | 팀 잠금 시각이 없어 운영진이 팀을 잠글 때 부문을 고정합니다. | |
| V16 | 트랙의 마지막 부문이 늘 참이 아님. 늘 참 = `when`이 `{}`나 `{ all: [] }`이고 team_rule이 all_members, any_member, majority, ratio, `at_least: k`(k ≤ team_size.min), `at_most: k`(k ≥ team_size.max) 중 하나(team_size.min ≥ 1이라 빈 팀은 없다고 봄). `leader`, `pick`, `no_member`는 늘 참으로 보지 않음(조장이 없는 팀, 기준 값이 있는 팀원이 없는 팀). individual은 `when`만 봄 | warning | `tracks.<id>.divisions` | 어느 부문에도 들어가지 못하는 팀이 생길 수 있습니다. | 마지막 부문을 when: {}, team_rule: all_members로 두면 모든 팀이 들어갑니다. |
| V16 | `unit: individual`인데 team_size가 {1,1}이 아님 | error | `tracks.<id>.team_size` | 개인 단위 트랙의 팀 인원은 1명입니다. | team_size를 지우거나 { min: 1, max: 1 }로 적어 주세요. |
| V17 | 단계 id가 Ident가 아니거나 변수 이름(`judge`, `judges`, `max_total`, `crit`, `critmax`, `bonus`, `votes`, `total_votes`, `avg_votes`, `max_votes`, `team_count`, `popular`, `peer`, `ai`)이거나 겹침 | error | `scoring.stages[i].id` | 단계 id "{id}"는 쓸 수 없습니다. / 단계 id "{id}"가 겹칩니다. | 영문 소문자나 _로 시작해 소문자·숫자·_로 32자까지 적고, 변수 이름({목록})과 다른 id로 바꿔 주세요. 식에서는 {id}.judge로 읽습니다. |
| V17 | 단계·덮어쓰기의 `rubric`이 없음 | error | `….rubric` | 단계 {s}가 가리키는 루브릭 "{r}"이 없습니다. | scoring.rubrics의 id({목록}) 중 하나를 적어 주세요. |
| V17 | `final.stage`가 마지막 단계가 아님 | error | `scoring.final.stage` | final.stage "{s}"는 마지막 단계가 아닙니다. | final.stage를 지우거나(기본: 마지막 단계) 마지막 단계 id({id})를 적어 주세요. |
| V17 | 마지막 단계에 `advance`가 있음 / `advance`에 `top_n`·`top_percent`·`min_score` 중 정확히 하나가 있지 않음 / 값 범위(top_n 정수 ≥ 1, top_percent (0, 100] 소수 둘째 자리) 밖 | error | `….advance` | 마지막 단계에는 진출 규칙을 둘 수 없습니다. / 진출 규칙은 top_n, top_percent, min_score 중 하나만 적어 주세요. / {키} 값이 범위 밖입니다. | 마지막 단계의 advance를 지우거나, 규칙을 하나만 남기고 범위 안의 값을 적어 주세요. |
| V17 | 마지막 단계의 실효 루브릭에 점수 기준이 없음(`modules.judge: false`면 건너뜀, 8.10) | error | `scoring.stages[i].rubric`(덮어쓰기면 그 덮어쓰기의 `rubric`) | 최종 단계의 루브릭 {r}에 점수 기준이 없습니다. | 점수 기준(type: score)을 하나 이상 두세요. |
| V17 | 그 단계가 쓰는 루브릭(기본 + 덮어쓰기, D21) 어디에도 게이트가 없는데 `gate_rule`을 적음 / 게이트만 있는 단계에 `advance`(점수가 모두 0) / `min_score` > 도달 가능한 최댓값(max_total + 양수 가산점) | warning | `….gate_rule` / `….advance` | 단계 {s}가 쓰는 루브릭에 게이트가 없어 gate_rule을 쓰지 않습니다. / 단계 {s}는 게이트만 있어 점수가 모두 0이라 진출 순위를 정할 수 없습니다. / min_score {m}은 도달할 수 있는 최고점 {max}보다 큽니다. | gate_rule을 지워 주세요. / advance를 지우거나 점수 기준을 더해 주세요. / min_score를 낮춰 주세요. |
| V17 | `bonuses.*.stage`가 없는 단계 | error | `bonuses.<id>.stage` | 가산점 {id}가 가리키는 단계 "{s}"가 없습니다. | scoring.stages의 id({목록}) 중 하나를 적어 주세요. |
| V17 | 식이 같은 단계나 뒤 단계의 변수를 씀(F_STAGE_ORDER) | error | 식 칸 | 2.8의 F_STAGE_ORDER | 앞 단계의 값만 쓰도록 식을 고쳐 주세요. |
| V18 | pool이 둘 이상의 장소를 묶는 순위형·식형 상(overall·sponsor·special·트랙 상이 부문을 섞는 경우 포함)에서, 장소들의 최종 max_total이 다르고 적용되는 식이 없거나 식 AST에 `max_total` 변수가 없음 | warning | `prizes[i]` | {pool}의 상은 만점이 다른 점수({값들})를 그대로 비교합니다. | 식에 judge / max_total * 100 같은 공통 척도를 두세요. |
| V18 | 결과 표의 순위 묶음이나 순위형 상의 pool이 덮는 장소들의 실효 tie_break·precision이 다름(code TIE_BREAK_MIXED) **[D73]** | warning | `prizes[i]` 또는 `scoring.final.rank_groups` | {pool}에는 tie_break·precision이 다른 장소가 섞여 있어, 이 pool에서는 기본 final.tie_break와 precision으로 비교합니다. | 장소별 tie_break·precision 덮어쓰기를 지우거나, 상의 scope를 덮어쓰기가 같은 장소로 좁혀 주세요. |
| V19 | 상 id가 겹침(축약형에서 생긴 id 포함) | error | `prizes[i].id` | 상 id "{id}"가 겹칩니다. | 다른 id로 바꿔 주세요. 트랙 상금표의 상은 <트랙 id>_p<번호> 꼴의 id를 씁니다. |
| V19 | scope의 트랙이 없음 / 부문이 그 트랙에서 열리지 않음 | error | `prizes[i].scope` | 상 {id}의 트랙 "{t}"가 없습니다. / 부문 "{d}"는 트랙 {t}에서 열리지 않습니다. | tracks의 id({목록}) 중 하나를 적어 주세요. / 트랙 {t}의 divisions({목록}) 중 하나를 적거나 division을 지워 주세요. |
| V19 | `requires_addon`이 모르는 add-on이거나 꺼짐(vote는 popular_vote) | error | `prizes[i].requires_addon` | 상 {id}에 필요한 add-on {a}이(가) 꺼져 있거나 없습니다. | add-on을 추가 확정으로 켜거나 상을 지워 주세요. |
| V19 | `modules.submit: false`인데 `opt_in: true`인 상 / `modules.judge: false`인데 `method`가 `rank`·`formula`인 상(8.10) **[D108]** | error | `prizes[i]` | 제출을 받지 않아 상 {id}에 지원할 수 없습니다. / 심사를 하지 않아 상 {id}의 순위를 매길 점수가 없습니다. | module을 켜거나, 상을 opt_in 없이 두거나 method: manual로 바꿔 주세요. |
| V19 | `method: formula`인데 `formula`가 없음 / 다른 method인데 `formula`가 있음 | error | `prizes[i].formula` | method: formula 상에 formula가 없습니다. / method가 formula가 아닌 상에는 formula를 적을 수 없습니다. | formula를 적거나 method를 바꿔 주세요. / formula를 지워 주세요. |
| V19 | `exclusive` 묶음이 서로 다른, 있는 상 id 2개 이상이 아님 | error | `prize_policy.exclusive[i]` | exclusive 묶음에는 서로 다른, 있는 상 id가 2개 이상 있어야 합니다: {문제}. | 상 id를 확인하고 2개 이상 적어 주세요. |
| V19 | 한 사다리의 상들의 method·pool·opt_in·eligible·formula가 다름 / manual 상에 `ladder` **[D79]** | error | `prizes[i].ladder` | 사다리 {l}의 상들은 method, pool, opt_in, eligible, formula가 같아야 합니다. / manual 상은 사다리를 쓸 수 없습니다. | 같은 성격의 상만 한 사다리로 묶거나 ladder를 지워 주세요. |
| V19 | 같은 사다리에서 `place`가 목록 순서로 줄어듦 | warning | `prizes[i].place` | 사다리 {l}에서 {id}의 place({p})가 앞 상보다 작습니다. | 배분은 목록 순서로 하므로 높은 등수의 상을 앞에 두세요. |
| V19 | 상금표 축약형과 `prizes`를 함께 씀 | warning | `tracks.<id>.prizes` | 트랙 상금표의 상이 prizes보다 먼저 배분됩니다. | 한 가지 형식만 쓰거나 순서를 확인해 주세요. |
| V20 | `ctx.locks`의 단계마다 `stageLockFingerprint(지금 설정, 단계)`가 기록과 다르고 `ctx.unlocks`에 그 단계가 없음(단계가 없어진 경우 포함). 지문 버전이 다르면 10.3. `ctx.locks`가 없으면 건너뜀 | error | `scoring.stages[i]`(축약형 `scoring.criteria`) | 단계 {s}가 열려 기준이 잠겨 있습니다. | 점수 계산 규칙(루브릭·가중치·척도·집계·정규화·게이트·진출·가산점·식·동점 규칙·자릿수)을 바꾸려면 judging_plan으로 사유와 기존 점수 처리(유지·다시 채점)를 정해 잠금을 먼저 풀어 주세요. |
| V20 | `ctx.unlocks`의 항목에 `reason`(1~500자)이나 `scores`가 없음 **[D90]** | error | `scoring.stages[i]` | 단계 {s}의 잠금 해제 기록에 사유나 점수 처리 방식이 없습니다. | judging_plan에서 사유와 scores(keep 또는 rescore)를 정해 주세요. |
| V20 | 기록의 지문 버전이 지금과 다르고 `ctx.locks.stages[s].config`가 없어 비교하지 못함(code FINGERPRINT_VERSION) | warning | `scoring.stages[i]` | 단계 {s}의 잠금 지문이 다른 키트 버전({v})에서 만들어져 비교하지 못했습니다. | 잠글 때의 revision 설정을 넘기면 비교합니다. 그 전에는 기준이 바뀌지 않았는지 직접 확인해 주세요. |
| V21 | 주민등록번호 질문(10.3) | error | `intake.fields[i]` 등 | 10.3 | 10.3 |
| V21 | 다른 고유식별정보 질문(10.3) | warning | 같음 | 10.3 | 10.3 |
| V22 | 로컬 이미지와 `data:` 이미지(10.3) | error / warning | 이미지 키 | 10.3 | 10.3 |
| V23 | 공개 투영의 비밀·이메일(10.3) | error | `event.json:<JSON 경로>` | 10.3 | 10.3 |
| V24 | 조건에 `matches`가 있음(어디든) | error | `….matches` | 정규식 조건(matches)은 v0.5에서 없앴습니다. | 형식 검사는 질문의 format(digits, alnum, email, url, github_login)과 min_length·max_length로 하세요. 예: { field: student_id, matches: '^\d{8}$' } → 질문 student_id에 format: digits, min_length: 8, max_length: 8 |
| V24 | 질문에 `pattern`이나 `regex` 키가 있음 | error | `intake.fields[i].pattern` | 질문의 정규식(pattern)은 쓸 수 없습니다. | format 프리셋과 길이 제한을 쓰세요. |

### 10.3 V21, V22, V23, V20 상세

**V21: 주민등록번호** **[D59]**. 질문(`intake.fields`, `submit.extra_fields`, `divisions.*.extra_fields`, `intake.proofs`)마다 `key`, `label`·`help`·`placeholder`·`section`의 모든 언어 값, 보기 라벨을 모아 **정리 문자열**을 만듭니다: 소문자로 바꾸고 공백, `-`, `_`, `·`, `.`, `/`를 지웁니다.

- 오류: 정리 문자열이 `주민등록`, `주민번호`, `주민앞자리`, `주민뒷자리`, `residentregistration`, `jumin` 중 하나를 포함하거나, `key`를 `[^a-z0-9]`로 나눈 낱말 중 `rrn`이 있거나, 원래 문자열(공백 정리 전)에 마스크 `[0-9#*xX○]{6}-[0-9#*xX○]{7}` 또는 `-[1-4][#*xX○]{6}`가 있음. 메시지: "주민등록번호를 받는 것으로 보이는 질문입니다({어디}). 법령 근거 없이 주민등록번호를 받을 수 없습니다(개인정보 보호법 제24조의2)." fix: "질문을 지우고, 나이가 필요하면 연령대(age_band)를, 본인 확인은 Google 로그인을 쓰세요."
- 경고: `외국인등록`, `여권번호`, `운전면허번호`, `passport`를 포함. "고유식별정보를 받는 것으로 보이는 질문입니다. 별도 동의와 법적 근거가 필요합니다(개인정보 보호법 제24조)." fix: "꼭 필요한지 확인하고, 필요하면 근거와 별도 동의를 마련해 주세요."

**V22: 사이트 이미지** **[D58]**. 값의 형식(scheme)은 8.3의 이미지 칸 규칙(SCHEMA)이 먼저 봅니다. `ctx.assets`의 값마다(키는 `IMAGE_KEYS`: `site.theme.logo`, `site.theme.hero`, `org.logo`, `site.sponsors[i].logo`):

- `https://`로 시작하면 크기를 재지 않고 경고(code `REMOTE_IMAGE`)를 냅니다: "{경로}의 원격 이미지는 크기를 확인하지 못했습니다. 첫 화면이 느려지지 않게 300 KB 이하인지 확인해 주세요." fix: "이미지를 사이트 저장소에 올려 상대 경로로 쓰면 check가 크기를 잽니다." core가 네트워크를 쓰지 않기 때문이고(0.1 #2), SPEC V22가 이미지마다 크기 한도를 걸므로 조용히 건너뛰지 않습니다. 게시할 때 원격 이미지의 크기를 재서 막는 일은 사이트를 게시하는 MCP(M3)가 할 수 있습니다(15.2) **[D103]**. `data:`는 base64를 디코딩한 크기로 아래 한도를 적용합니다. 그 밖은 로컬 경로로 보고 그 값을 쓴 층 파일의 폴더 기준으로 풉니다(`file`이 없으면 건너뜀).
- 확장자가 `.png .jpg .jpeg .webp .gif .svg .avif`가 아니면 오류 "이미지 파일이 아닙니다: {경로}" fix "png, jpg, webp, gif, svg, avif 파일을 쓰세요."
- 파일이 없으면 오류 "이미지 파일을 찾을 수 없습니다: {경로}" fix "경로는 그 값을 적은 설정 파일의 폴더 기준입니다."
- 크기 > 1,000,000 B면 오류 "이미지가 1 MB를 넘습니다({n} KB). 첫 화면이 느려집니다." fix "300 KB 이하로 줄여 주세요.", > 300,000 B면 경고 "300 KB 이하를 권합니다". 단위는 10진입니다(1 MB = 1,000,000 B, 1 KB = 1,000 B). SPEC V22·11.5의 "MB·KB"를 엄격한 쪽(2진 단위보다 1 MB 한도는 약 4.6%, 300 KB 한도는 약 2.3% 작음)으로 읽고 사이트 첫 화면 예산(SPEC 11.6)도 바이트로 잽니다 **[D103]**.

**V23: 공개 투영** **[D60]**. `publicProjection(buildNormalizedConfig(resolved))`(11.3)을 만들 수 있을 때만(다른 오류로 빌드가 안 되면 건너뜀) 모든 문자열 값과 맵 키(`site.strings`의 i18n key, `addons.upload.kinds`의 id 등)를 훑습니다.

- 비밀: V8의 패턴.
- 이메일 모양: `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+`(선형 정규식).
- 예외 경로: `org.contact`, `privacy.contact`(문자열이면 그 값, 객체면 언어별 값)만입니다.
- 걸리면 오류 하나씩, 경로는 `event.json:<JSON 경로>`. 메시지: "공개 파일(event.json)에 {비밀/이메일} 모양 문자열이 있습니다({경로})." fix: "공개 문의처는 org.contact나 privacy.contact에만 적어 주세요." 값은 되풀이하지 않습니다. `email` 조건에 메일 주소를 적은 것(v1 V15 경고)도 여기서 오류가 됩니다.

**V20 지문** **[D61]**: `stageLockFingerprint(config, s)` = `"fp1:" + hashOf({ rubrics, stage, bonuses, final })`. 지문에 넣는 칸은 아래 목록뿐입니다. 정규형의 다른 키와 키트가 나중에 더하는 키는 지문 버전을 올릴 때만 넣습니다. 그래서 키트를 올려도 같은 설정의 지문은 바뀌지 않습니다.

- `rubrics`: 그 단계가 쓰는 루브릭(기본 + 덮어쓰기, 등장 순서)마다 `{ id, scale_normalize, criteria }`. 기준은 `{ key, type, weight, scale, children }`만(이름·설명·anchors 문구 제외)
- `stage`: `{ gate_rule, aggregate, normalize, require_complete, advance, overrides }`. overrides 항목은 `{ when, rubric, aggregate, require_complete }` 중 적힌 것. 마지막 단계의 `advance`는 `null`
- `bonuses`: 그 단계 가산점의 `{ id, when, team_rule, points }`(id 순서)
- `final`: 그 단계가 최종 단계면 `{ formula, tie_break, precision, rank_groups, unresolved_tie, overrides, prize_formulas, popular }`(식은 AST, 원문 제외), 아니면 `null`. `prize_formulas`는 `method: formula`인 상마다 `{ id, formula }`(상 목록 순서)입니다. `popular`는 popular_vote가 켜져 있고 `use: formula_input`이면 `{ normalize, full_at_multiple }`, 아니면 `null`입니다 **[D101]**

**잠금 범위** **[D101]**: 지문은 SPEC 7.2·15.1·V20이 적은 것(루브릭, 가중치, 척도, 식)보다 넓게, 그 단계의 점수와 순위를 계산하는 규칙을 모두 담습니다. 집계 방식, 정규화, 게이트 규칙, 완료 조건, 진출 규칙, 가산점, 최종 식, 동점 규칙, 자릿수, 순위 묶음, 끝까지 남은 동점의 처리, 식형 상의 식, 식이 읽는 `popular`의 정의입니다. 채점이 시작된 뒤 이것을 바꾸면 루브릭을 바꾼 것처럼 결과가 달라지므로 SPEC V20의 이유("심사 중에 기준이 바뀌면 공정하지 않습니다")가 그대로 걸립니다. 예를 들어 서면 예선 점수를 본 뒤 `mean`을 `trimmed_mean`으로 바꾸면 10위와 11위가 뒤바뀔 수 있고 운영진이 특정 팀에 유리한 방식을 고른 것처럼 보일 수 있습니다. `rank_groups`는 득표 통계의 범위(3.4)를, popular_vote의 `normalize`·`full_at_multiple`은 `popular` 값을 바꾸므로 넣습니다. 이름, 설명, anchors 문구, `judges_per_project`, `assignment`, 식형 상의 식 밖의 상 칸(scope, count, place, ladder, opt_in, eligible, amount)과 `prize_policy`는 점수가 아니라 배정과 시상의 규칙이라 넣지 않습니다. 바꾸려면 judging_plan으로 잠금을 풉니다(사유와 `scores`). judging_plan은 원점수가 그대로 쓰이는 변경(집계, 정규화, 진출, 가산점, 식, 동점 규칙, 자릿수, 순위 묶음, 동점 처리)에는 `keep`을, 기준·척도·가중치 변경에는 `rescore`를 권합니다. `fp1`은 아직 배포 전이라(14장) 칸을 더해도 버전을 올리지 않습니다.

빌드가 단계마다 이 값을 미리 계산해 `_config.stage_fingerprints`(11.2)에 넣고 백엔드는 단계가 열릴 때 그 revision의 값과 revision을 잠금 기록에 복사합니다(Apps Script에서 해시를 다시 계산하지 않음). V20은 기록의 지문 버전(`fp1`)이 지금 알고리즘과 같으면 문자열로 비교합니다. 다르면 `ctx.locks.stages[s].config`(그 revision의 정규형)가 있을 때 지금 알고리즘으로 두 지문을 다시 만들어 비교하고, 없으면 FINGERPRINT_VERSION 경고를 냅니다(막지 않음). 키트를 업그레이드해도 열린 단계의 모든 계획이 막히지 않게 하려는 것입니다.

---

## 11. 생성물과 CLI

SPEC 6.3, 5.3, CFG-5·6, MODE-2·3.

### 11.1 `NormalizedConfig`

`buildNormalizedConfig(resolved)`는 `ResolvedConfig`를 아래처럼 바꿉니다. 실패하면(식이 컴파일되지 않음) `BuildError`를 던집니다(`class BuildError extends Error { readonly issues: { path: string; message: string }[] }`, Node). check를 통과한 설정은 실패하지 않습니다.

1. `normalizeShape(resolved): ShapeConfig`로 수식 칸에 원문만 담은 정규형을 만듭니다 **[D117]**: 기준의 척도·weight 해석(4.1), anchors 배열, 보기 `{ value, label }`, built-in 동의(7.9), `privacy.version`, `submit.fields`(8.3, `modules.submit: false`면 `[]`), `intake.division_fields`(7.9), `pick`의 `kind`·`rank`(7.4), 상 `scope` 정규화(`{ track }` → `{ track, division: null }`), 상의 `ladder` 기본값(6.4)과 `source`(설정 경로), 시각의 정규형(0.2), 선택 값의 `null` 채우기(빠진 선택 키는 언제나 `null`, 목록은 `[]`, 맵은 `{}`). `ShapeConfig`는 `NormalizedConfig`에서 모든 `Formula`를 `{ source: string; ast: null }`로 바꾼 타입입니다. 이 함수는 schema를 통과한 설정에서 던지지 않고, 없는 루브릭·단계·트랙을 가리키는 참조도 그대로 둡니다. check(10.1)도 이 함수를 씁니다.
2. 수식 칸마다 `compileFormula(source, variableSet(정규형, 장소))`(V4와 같은 장소 규칙, 0.2의 장소 목록)로 `{ source, ast }`를 채웁니다.

```ts
export interface NormalizedConfig {
  schema: 2;
  kind: "event" | "profile" | "preset";
  org: { name: Localized | null; contact: Localized | null; logo: string | null; url: string | null };
  event: { id: string | null; name: Localized | null; timezone: string; venue: Localized | null; online: boolean; organizers: Localized[] };
  site: { title: Localized | null; tagline: Localized | null; about: Localized | null;
          rules: Localized | null; code_of_conduct: Localized | null;
          policy_links: { terms: string | null; privacy: string | null; code_of_conduct: string | null };
          theme: { accent: string | null; logo: string | null; hero: string | null; font: "web" | "system" };   // font 기본 "web" [D105]
          languages: Lang[]; sections: { id: SectionId; visible: boolean; coming_soon: boolean }[];
          links: { label: Localized; url: string }[]; faq: { q: Localized; a: Localized }[];
          sponsors: { name: Localized; logo: string | null; url: string | null }[];
          strings: Record<string, Localized>; google_client_id: string | null };
  schedule: { recruit: { open: Iso | null; close: Iso | null }; team_lock: Iso | null;
              sessions: { id: string; at: Iso; title: Localized; place: Localized | null; online: boolean }[];
              main: { start: Iso | null; end: Iso | null; submit_deadline: Iso | null; grace_min: number };
              extensions: { team: string; until: Iso }[];
              score_until: Iso | null; results_at: Iso | "off" | null };
  tracks: Record<string, NTrack>;
  divisions: Record<string, NDivision>;
  bonuses: Record<string, NBonus>;
  intake: NIntake;
  scoring: NScoring;
  prizes: NPrize[];
  prize_policy: { max_per_team: number | null; exclusive: string[][]; allow_vacant: boolean };
  modules: { apply: boolean; submit: boolean; judge: boolean };
  addons: Record<string, { enabled: boolean } & Record<string, unknown>>;
  recommended_addons: string[];
  submit: { preset: "basic" | "kr_contest" | "mlh"; repo_link: "required" | "optional" | "off";
            allowed_hosts: string[]; max_opt_ins: number | null; fields: NField[] };
  privacy: { purpose: Localized | null; items: string[];
             retention: { days_after_event: number | null; winners_days: number | null };
             refusal: Localized | null; contact: Localized | null; consignment: Localized | null;
             share_contact_on_team_accept: boolean; version: string };   // version: "p1:…"(7.9)
  teams: { one_per_person: true; formation: "self" | "organizer" | "hybrid" };
  github: ({ org: string } & Record<string, unknown>) | null;      // 안쪽은 검사하지 않음(8.1) [D109]
  repo: Record<string, unknown> | null; reviewers: { permission: "pull" } & Record<string, unknown>;
  app_policy: string | null;
}
export interface NTrack { name: Localized; short_id: string | null; description: Localized | null; aliases: string[];
  unit: "individual" | "team" | "organization"; team_size: { min: number; max: number }; teams: string[];
  order: number | null; divisions: string[]; division_mode: "auto" | "declared";
  division_as_of: DivisionAsOf; vote: { from: Iso; until: Iso } | null; submit_deadline: Iso | null }
export interface NDivision { name: Localized; when: Cond; team_rule: TeamRule; explain: Localized | null; extra_fields: NField[] }
export interface NBonus { name: Localized | null; stage: string; when: Cond; team_rule: TeamRule; points: number; explain: Localized | null }
export interface NIntake { identity: { google_login: "required"; one_per_account: true; email_domains: string[];
    hosted_domains: string[]; github: { required: boolean; verify: "format" | "exists" } };
  fields: NField[]; eligibility: { when: Cond; message: Localized }[];
  division_fields: { division: string; when: Cond; fields: NField[] }[];   // 7.9, 부문 id 순서 [D112]
  consents: { key: string; text: Localized | null; version: string; required: boolean; builtin: "privacy" | "age_14_plus" | null }[];   // required 기본 true
  proofs: { key: string; label: Localized; help: Localized | null; kind: "link"; required: boolean }[];
  capacity: number | null }                                                // 7.9 [D113]
export interface NField { key: string; type: FieldType; label: Localized; help: Localized | null; placeholder: Localized | null;
  section: Localized | null; required: boolean; options: { value: string; label: Localized }[]; solo: string[];
  format: FormatPreset | null; min_length: number | null; max_length: number | null;
  min: number | string | null; max: number | string | null; step: number | null;
  show_if: Cond | null; roster: "name" | "github_login" | "team_hint" | null }
export interface NScoring { locks: { rubric_on_stage_open: true }; rubrics: Record<string, NRubric>; stages: NStage[]; final: NFinal }
export interface NRubric { name: Localized | null; scale: { min: number; max: number | null; step: number }; scale_normalize: boolean; criteria: NCriterion[] }
export interface NCriterion { key: string; name: Localized; description: Localized | null; type: "score" | "gate"; weight: number;
  scale: { min: number; max: number; step: number } | null;      // 점수 리프만
  anchors: { value: number; text: Localized }[]; children: NCriterion[] }
export type When = { track?: string; division?: string };        // 적은 키만(null 채우기의 예외) [D83]
export interface NStage { id: string; name: Localized | null; rubric: string; gate_rule: "all" | "majority" | "any" | null;
  judges_per_project: number | null;
  assignment: { scope: "track" | "division" | "all"; exclude: ("same_affiliation" | "mentor_of")[]; mode: "fixed" | "random_async" } | null;
  aggregate: { method: "mean" | "median" | "trimmed_mean"; trim: number };
  normalize: { method: "none" | "zscore" | "minmax"; min_entries: number };
  require_complete: boolean;
  advance: { top_n: number | null; top_percent: number | null; min_score: number | null; per: ("track" | "division")[] } | null;
  overrides: { when: When; rubric?: string; aggregate?: NStage["aggregate"]; require_complete?: boolean }[] }
export interface NFinal { stage: string; formula: Formula | null; precision: number; rank_groups: ("track" | "division")[];
  tie_break: Formula[]; unresolved_tie: "manual" | "share";
  overrides: { when: When; formula?: Formula | null; tie_break?: Formula[]; precision?: number }[] }
export interface NPrize { id: string; name: Localized | null; scope: NPrizeScope; place: number; count: number;
  method: "rank" | "vote" | "manual" | "formula"; formula: Formula | null; ladder: string | null; opt_in: boolean;
  requires_addon: string | null; eligible: { when: Cond; team_rule: TeamRule } | null; amount: number | null; source: string }
export type NPrizeScope = "overall" | "sponsor" | "special" | { track: string; division: string | null };
```

덮어쓰기 항목(`stages[].overrides`, `final.overrides`)과 그 `when`에서만 "적지 않음"과 "`null`"을 구별합니다. 그래서 이 항목들은 적은 키만 둡니다(`formula: null`은 가중합으로 되돌리기). 정규형 `when`에 키가 없으면 그 조건이 없다는 뜻이고 부문 `null`과 헷갈리지 않습니다 **[D83]**.

### 11.2 `_config`

시트의 보호된 `_config` 탭에 들어갈 JSON입니다(셀 크기 한도에 맞춰 나눠 쓰는 것은 백엔드의 일).

```ts
export interface ConfigTab {
  kind: "config"; schema: 2;
  kit: { version: string };
  revision: number;           // 1부터 증가(plan_apply가 정함). CLI 기본 0 = 반영 전
  config_hash: string;        // hashOf(config). 이 탭에만 둠(11.4)
  public_hash: string;        // 같은 revision event.json의 public_hash
  stage_fingerprints: Record<string, string>;   // 단계 id → "fp1:…"(V20, 10.3)
  config: NormalizedConfig;   // 전체(비밀은 V8로 없음), 수식은 { source, ast }
}
export function buildConfigTab(resolved: ResolvedConfig, options: { revision: number }): ConfigTab;
export function readConfigShape(json: unknown): NormalizedConfig;   // runtime(두 번들): 모양만
export function readConfigTab(json: unknown): NormalizedConfig;     // runtime(engine): 모양 + 모든 AST 재검사
export function loadConfigTab(json: unknown): NormalizedConfig;     // Node: + 식 원문 재컴파일 대조, config_hash 대조
```

- **`buildConfigTab`** 은 만든 JSON 전체(문자열 값과 맵 키)를 V8의 패턴으로 한 번 더 훑고 걸리면 `BuildError`를 던집니다(값은 되풀이하지 않음) **[D95]**. check를 건너뛴 경로가 있어도 비밀이 `_config`에 실리지 않게 하기 위해서입니다.
- **`readConfigShape`**(rules): `kind`, `schema`, `kit`, `revision`, `config_hash`, `public_hash`, `stage_fingerprints`, `config` 최상위 키의 존재와 타입, `config`의 섹션별 JSON 타입(객체·배열·문자열·수), id·key 규칙(0.2)을 확인합니다. AST는 보지 않습니다. 틀리면 `EngineError(E_CONFIG)`입니다. 백엔드는 `_config`를 읽어 캐시에 넣기 전에 이 함수를 씁니다.
- **`readConfigTab`**(engine): `readConfigShape`에 더해 모든 수식 칸(`scoring.final.formula`, `final.tie_break[]`, `final.overrides[].formula/tie_break[]`, `prizes[].formula`)을 `validateAst`로 다시 검사하고 하나라도 거절되면 `EngineError(E_AST_INVALID)`입니다.
- **`loadConfigTab`**(Node) **[D94]**: `readConfigTab`에 더해 모든 식 칸을 V4와 같은 장소(0.2의 장소 목록)마다 `compileFormula(source, variableSet(장소))`로 다시 컴파일합니다. 그 AST의 canonical JSON이 저장된 AST와 다르면 `E_AST_INVALID`(detail은 1.4의 F_SOURCE_MISMATCH 모양)이고 `config_hash`가 `hashOf(config)`와 다르면 `E_CONFIG`입니다. 원문은 그대로 두고 AST만 허용 목록 안의 다른 식으로 바꿔 넣으면, 미리보기와 스냅샷은 사람이 읽는 원문을 보여 주면서 다른 식으로 계산하게 됩니다. MCP가 `_config`로 결과를 계산하거나 계획의 기준(`plan --base`)을 읽을 때는 이 함수만 씁니다.

### 11.3 `event.json`

사이트 저장소 → Pages에 올리는 공개 투영입니다.

```ts
type N = NormalizedConfig;
type SourceOnly = { source: string };
export interface EventJson {
  kind: "event"; schema: 2;
  kit: { version: string };
  revision: number;
  public_hash: string;        // 이 파일에서 public_hash만 뺀 것의 hashOf
  org: N["org"]; event: N["event"]; site: N["site"]; schedule: Omit<N["schedule"], "extensions">;
  tracks: N["tracks"]; divisions: N["divisions"]; bonuses: N["bonuses"];
  intake: { identity: Omit<NIntake["identity"], "google_login" | "one_per_account">;
            fields: NField[]; eligibility: NIntake["eligibility"]; division_fields: NIntake["division_fields"];
            consents: NIntake["consents"]; proofs: NIntake["proofs"]; capacity: NIntake["capacity"] };
  scoring: {
    locks: NScoring["locks"];
    rubrics: NScoring["rubrics"];                     // 그대로(심사 기준표)
    stages: Omit<NStage, "assignment">[];             // 배정 규칙만 뺌
    final: { stage: string; precision: number; rank_groups: NFinal["rank_groups"]; unresolved_tie: NFinal["unresolved_tie"];
             formula: SourceOnly | null; tie_break: SourceOnly[];
             overrides: { when: When; formula?: SourceOnly | null; tie_break?: SourceOnly[]; precision?: number }[] };
  };
  prizes: (Omit<NPrize, "formula" | "source"> & { formula: SourceOnly | null })[];
  prize_policy: N["prize_policy"]; modules: N["modules"]; submit: N["submit"]; privacy: N["privacy"];
  addons: Record<string, Record<string, unknown>>;    // 켠 add-on의 public_options만(enabled 키 없음)
  teams: { formation: N["teams"]["formation"] };
}
export function buildEventJson(resolved: ResolvedConfig, options: { revision: number }): EventJson;
export function publicProjection(config: NormalizedConfig, revision?: number): EventJson;
```

- 빼는 것: `github`, `repo`, `reviewers`, `app_policy`, `recommended_addons`, `schedule.extensions`(팀별 연장), 꺼진 add-on과 비공개 옵션(`voter_domains`, `github_ops.templates` 등), 수식 AST, 상의 `source`, 배정 규칙, `teams.one_per_person`(상수), `config_hash`(11.4).
- 사이트의 rules 번들은 `event.json`의 `divisions`, `tracks`, `intake`, `scoring`, `schedule`, `submit`, `prizes`를 그대로 받습니다(`stageSettings`, `trackWindows`, `validateApplication`, `validateSubmission`. 어댑터 없음).
- V23이 이 투영을 훑습니다(check 때).
- **`buildEventJson`의 재검사** **[D95]**: `buildEventJson`은 만든 결과 전체(문자열 값과 맵 키)를 V8의 비밀 패턴과 V23의 이메일 모양으로 한 번 더 훑고(예외는 `org.contact`, `privacy.contact`) 걸리면 `BuildError`를 던집니다(값은 되풀이하지 않음). 비공개 `_config`(11.2의 buildConfigTab)보다 공개 파일의 방어가 약하지 않게 하려는 것입니다. event.json을 쓰는 모든 경로(CLI `build`, MCP의 `plan_apply`)는 이 함수를 거칩니다. `publicProjection`은 V23이 경로별 진단을 만들 때 쓰므로 던지지 않습니다.

### 11.4 hash와 revision

- `hashOf(value) = sha256(canonical(value))`의 16진 앞 16자입니다. `canonical`은 객체를 다시 만들지 않고 직접 쓰는 직렬화입니다 **[D97]**: 객체는 자기 열거 키를 UTF-16 순서로 정렬해 `{"키":값,…}`, 배열은 순서대로, 문자열과 수는 `JSON.stringify`(−0은 0), `true`·`false`·`null`, 값이 `undefined`인 키는 뺍니다. 공백은 없습니다. 정수 모양 키(`site.strings`의 `"1"`, `upload.kinds`의 `"10"`)도 같은 정렬 규칙을 따릅니다. `JSON.stringify`에 정렬한 객체를 넘기면 정수 모양 키가 숫자 순으로 앞에 오므로 그렇게 구현하지 않습니다.
- `config_hash = hashOf(NormalizedConfig)`. revision은 넣지 않습니다. `_config`에만 둡니다 **[D62]**. 공개 칸이 모두 `event.json`에 있으므로, `event.json`에 이 값을 두면 누구나 비공개 칸(GitHub org 이름, `voter_domains`, 배정 방식 등)을 오프라인에서 추측해 맞는지 확인할 수 있고 비공개 설정이 바뀌었다는 신호도 공개됩니다.
- `public_hash`는 `event.json` 내용 자체의 해시라 Pages 캐시와 변조 확인에 씁니다. `_config`에도 같은 revision의 값을 둡니다.
- `doctor`(CFG-6)는 원본에서 다시 만든 `config_hash`와 `_config.config_hash`, `_config.public_hash`와 `event.json`의 `public_hash`, 세 곳의 revision을 비교합니다.
- `revision`은 core가 정하지 않고 받습니다.

### 11.5 CLI

```
simple-hackathon check <file> [--home <dir>] [--json]
simple-hackathon build <file> --site <dir> [--config <file>] [--home <dir>] [--revision <n>]
simple-hackathon plan <file> --base <_config.json> [--out <plan.json>] [--home <dir>]
simple-hackathon export --dev <file> --out <dir> [--home <dir>]
simple-hackathon migrate <file> --from 0.1.0 --out <dir>
```

- **`check`**: 진단을 한 줄씩 `{ERROR|WARN |INFO } {id 10칸} {path}: {message}`로 찍고 `fix`가 있으면 다음 줄에 `           고칠 방법: {fix}`. 끝에 "검사 결과: 오류 {n}개, 경고 {n}개, 정보 {n}개". `--json`이면 `{ "diagnostics": [...], "summary": { "errors", "warnings", "infos" } }` 하나만 찍습니다.
- **`build`** **[D91]**: check를 통과하면 `--site <dir>`에는 `event.json`만 쓰고 `_config.json`은 `--config <file>`을 준 때만 씁니다. `--config`의 경로(파일이 아직 없으면 부모 폴더의 realpath)가 `--site` 폴더(realpath) 안이면 인자 오류(exit 2): "비공개 설정(_config.json)은 사이트 폴더에 쓸 수 없습니다." 사이트 폴더를 그대로 Pages에 올리는 CI가 비공개 설정을 공개하지 않게 하려는 것입니다(SPEC 6.3). 두 파일은 메모리에서 모두 만든 뒤 폴더를 만들고 임시 이름으로 쓴 다음 이름을 바꿉니다. 하나라도 실패하면 둘 다 남기지 않습니다. `--revision` 기본 0. 1차 구현의 `--out`은 받지 않고 "--out은 --site(event.json)와 --config(_config.json)로 바뀌었습니다" 인자 오류입니다(1차 구현은 배포된 적이 없음, 14장).
- **`plan`**(CFG-5, MODE-3) **[D91]**: `--base`의 `_config.json`을 `loadConfigTab`으로 읽고 `<file>`을 check한 뒤 오류가 없으면 아래 계획을 씁니다(`--out`이 없으면 stdout). 오류가 있으면 진단만 찍고 exit 1입니다. 비개발자 모드의 MCP `event_plan`도 같은 `diffConfigs`를 씁니다.

```ts
export interface PlanFile {
  kind: "plan"; schema: 1;
  base: { revision: number; config_hash: string };
  target: { revision: number; config_hash: string; public_hash: string };   // revision = base.revision + 1
  patch: JsonPatchOp[];                                       // diffConfigs(base, target)
  sources: { path: string; file: string; line: number }[];    // patch의 경로마다 알 수 있는 원문 위치(8.4)
  addon_changes: AddonConfirmation[];                         // 9.4
  diagnostics: Diagnostic[];                                  // 경고·정보(규칙 ID 포함)
}
export type JsonPatchOp = { op: "add" | "remove" | "replace"; path: string; value?: unknown };
export function diffConfigs(before: NormalizedConfig | null, after: NormalizedConfig): JsonPatchOp[];
```

  `diffConfigs`는 RFC 6902 연산을 결정적으로 만듭니다. 비교 전에 모든 `Formula`를 원문 문자열로 바꿉니다(AST는 원문에서 나오므로). 객체는 키를 UTF-16 순서로 보며 없어진 키는 `remove`, 새 키는 `add`, 값이 다르면 아래로 내려갑니다. 배열은 길이가 같으면 index마다 내려가고 다르면 배열 전체를 `replace`합니다(index가 밀리는 연산이 없음). 연산은 경로 순서이고 `path`는 RFC 6901(`~0`, `~1` escape)입니다. `before`가 null이면 루트 `replace` 하나입니다. 계획을 승인해 적용하는 `apply`(MODE-4, P2)는 M2 범위 밖이고 core는 아래 모양만 정합니다 **[D104]**.

```ts
export interface PlanApproval {
  kind: "plan_approval"; schema: 1;
  plan_hash: string;                                   // planHash(plan)
  base: { revision: number; config_hash: string };     // 계획의 base와 같아야 함
  approved_by: string;                                 // 승인자 GitHub login(0.2의 id 규칙에 맞음, 이메일 아님)
  via: "github_environment";
  run: string;                                         // 승인된 GitHub Actions run 주소
}
export function planHash(plan: PlanFile): string;     // hashOf(plan)
```

  - 적용에는 운영자 키(백엔드 HMAC, SPEC BE-5)와 GitHub App 키가 필요하므로, core CLI가 아니라 같은 npm 패키지(SPEC 18.1)의 MCP 쪽 명령 `simple-hackathon apply <plan.json>`이 `plan_apply`와 같은 엔진(기준 revision 확인, 체크포인트, SPEC 12.2)으로 적용합니다.
  - 사람 승인은 GitHub Actions environment의 required reviewers로 강제합니다(SPEC 19.4 Q5의 릴리스 승인과 같은 방식). 운영자 키는 그 environment의 secret으로만 두기 때문에 사람이 승인하기 전에는 적용 job이 키를 받지 못합니다. 승인 전에 도는 job이 계획의 쉬운 말 요약과 `plan_hash`를 run 요약에 쓰고 적용 job은 같은 `plan_hash`인지 확인합니다.
  - `apply`는 그 run의 environment 승인 기록(GitHub API의 workflow run review history)에서 `PlanApproval`을 만들어 `_log`에 남깁니다. 승인 기록이 없거나, `plan_hash`가 승인 전 job의 값과 다르거나, 계획의 `base`가 지금 `_config`의 revision·config_hash와 다르면 아무것도 바꾸지 않고 거절합니다. 운영자 키로 서명한 승인 파일은 CI가 스스로 만들 수 있어 사람 승인의 증거가 아니므로 쓰지 않습니다.
- **`export --dev`**(MODE-2) **[D91]**: `<file>`과 그 extends 사슬의 profile·event 층(preset 제외)을 `<dir>/profiles/<이름>.yaml`, `<dir>/events/<event.id>/event.yaml`로 씁니다. 각 층의 `extends`는 그 층의 `RawLayer.extends`(8.4)를 `profile:<이름>`·`preset:<이름>@<n>` 참조로 다시 적고 층의 상대 경로 이미지(8.4의 assets)는 그 층의 새 위치 기준으로 같은 상대 경로에 복사합니다. 이미 있는 파일은 덮어쓰지 않고 exit 1입니다. Node의 `exportDevLayout(layers)`가 같은 일을 메모리에서 하고(`{ path, text }[]`, 경로 순서) MCP는 비개발자 모드의 메모리 층을 이 함수로 내보냅니다(`RawLayer.name`이 profile 이름, `RawLayer.extends`는 MCP가 채움). 병합 순서만으로는 profile이 원래 어떤 preset을 직접 extends했는지 다시 만들 수 없어서 층마다 적은 `extends`를 그대로 씁니다 **[D91]**.
- 종료 코드: 0 성공(경고 허용), 1 오류·빌드 실패·파일 없음·덮어쓰기 거절, 2 인자 오류(사용법 출력).
- MCP 0.1.0 `event.yaml`의 변환(CFG-8)은 11.6입니다. `loadConfig`는 그 형식을 알아보고 변환을 안내합니다(8.4).

### 11.6 0.1.0 설정 변환 (CFG-8)

`migrateV010(text: string): { yaml: string | null; diagnostics: Diagnostic[] }`(Node)는 MCP 0.1.0 `event.yaml` 원문(8.4의 V010_FORMAT 파일)을 v2 event 층 하나(`schema: 2`, `kind: event`, `extends` 없음)로 바꿉니다 **[D100]**. CLI `simple-hackathon migrate <file> --from 0.1.0 --out <dir>`는 결과를 `<dir>/events/<event.id>/event.yaml`에 쓰고(이미 있으면 덮어쓰지 않고 exit 1) 진단을 check와 같은 형식으로 찍습니다. MCP는 같은 함수로 비개발자 모드의 메모리 층을 만듭니다. 0.1.0에는 대회 이름, 신청서, 개인정보 고지, 심사 기준이 없어 결과가 바로 check를 통과하지 않을 수 있고 채워야 할 키는 info(code `MIGRATE_TODO`)로 알려 줍니다. 0.1.0 스키마로 읽을 수 없는 파일은 `yaml: null`과 SCHEMA 진단입니다.

| 0.1.0 | v2 | 비고 |
| --- | --- | --- |
| `event_id` | `event.id` | `event.name`은 MIGRATE_TODO |
| `timezone` | `event.timezone` | 원문에 있을 때만 |
| `write_delay_ms` | `addons.github_ops.write_delay_ms` | 1000보다 작으면 1000으로 올리고 경고(SPEC 15.3 "쓰기 사이에 1초 이상") |
| `github`, `repo`, `reviewers`, `app_policy` | 같은 경로 | 그대로(8.1의 0.1.0 MCP 섹션) |
| `roster` | 옮기지 않음 | info "v2에서는 명단을 대회 시트 하나로 받습니다(BE-3). roster는 옮기지 않았습니다." `roster`는 v2에서 폐지(8.1, D109) |
| `teams.size: [a, b]` | 트랙마다 `team_size: { min: a, max: b }` | |
| `tracks.<key>` | `tracks.<id>` | `<key>`가 TrackId(0.2)면 그대로, 아니면 0.1.0 `id`를 소문자로 바꾼 값(TrackId가 아니면 앞에 `track_`)을 id로 하고 `<key>`를 `name`과 `aliases`에 넣음. id가 겹치면 SCHEMA |
| `tracks.<key>.id` | `tracks.<id>.short_id` | |
| `tracks.<key>.aliases`, `tracks.<key>.teams` | 같은 키 | |
| `tracks.<key>.template` | `addons.github_ops.templates.<id>` | 비공개 org 저장소 이름이 event.json에 실리지 않게(SPEC 6.3) |
| `tracks.<key>.freeze_at` | `tracks.<id>.submit_deadline` | |
| `tracks.<key>.freeze_enabled` | `addons.integrity_check.late_push.tracks.<id>` | 0.1.0에서 이 값을 끄면 그 트랙의 마감을 없는 것으로 보아 늦은 push 점검과 함께 마감 전 공개 전환 막기도 꺼졌음(잠금은 늘 가능). v2에서 마감 전 공개 전환 막기는 끌 수 없는 규칙이라(SPEC 15.1, GH-6) 늦은 push 점검만 옮기고 값이 `false`면 info "v2에서는 마감 전 공개 전환 막기를 끌 수 없어, 마감 전에는 저장소를 공개로 바꿀 수 없습니다."를 냄 |
| `schedule.start_at` | `schedule.main.start` | |
| `schedule.freeze_at` | `schedule.main.submit_deadline` | |
| `schedule.freeze_enabled` | `addons.integrity_check.late_push.enabled` | 위 행과 같음. 값이 `false`면 같은 info를 냄 |
| `schedule.prep_enabled`, `prep_from` | `addons.integrity_check.prep` | 꺼져 있으면 `null`, 켜져 있으면 `{ from: prep_from ?? null }` |

- 0.1.0은 GitHub 기능을 늘 켜 두었으므로 `addons.github_ops`와 `addons.integrity_check`에 `enabled: true`를 적고 원문에 `app_policy`가 있으면 `addons.apps_review`도 켭니다. 켜는 것은 그 층을 처음 반영하는 계획의 확정 섹션(9.4)에서 운영진이 승인합니다(ADD-3). 다만 MCP는 `since`가 null인 add-on을 켜는 계획을 거절하고(D99) 지금 이 add-on들은 모두 `since: null`입니다(9.1). 그대로면 0.1.0 사용자가 변환한 설정의 첫 계획이 거절되므로, `migrate`를 내는 릴리스(0.3.0) 전에 둘 중 하나를 정합니다. 하나는 그 릴리스에서 이 add-on들의 `since`를 채우는 것입니다. 그러려면 그 릴리스에 이 add-on들이 더하는 도구가 들어 있어야 합니다(`release:check`). SPEC GH-1(P0)이 0.1.0의 GitHub 기능을 유지하라고 하므로 이쪽이 SPEC에 맞습니다. 다른 하나는 `since`를 채우기 전까지 `migrate`가 이 add-on들을 켜지 않고, 켜야 할 add-on을 info로 알리는 것입니다.
- 시각은 0.2의 정규형으로 씁니다. 원문의 주석은 옮기지 않습니다.

---

## 12. 크기 예산

SPEC 13.4. 코드줄(0.2)로 재고 `test/budget.test.ts`가 CI에서 막습니다 **[D64]**. 메시지 틀(`messages.ts`)과 타입 선언(`types.ts`), selfTest 벡터(`selftest-vectors.ts`), 문장 틀(`src/i18n/*.json`)은 데이터라 예산에서 뺍니다. 대신 `budget.test.ts`는 데이터 파일이 예산을 피해 가는 통로가 되지 않도록 `messages.ts`, `types.ts`, `selftest-vectors.ts`에 함수 선언, 화살표 함수, `if`·`switch`·삼항 연산자가 없는지 검사합니다(`fmt()`는 `util.ts`). SPEC의 "수식 엔진 400 코드줄"은 파서·AST·검사·해석기만 세고 검증 보조 도구는 450 코드줄로 따로 잽니다(SPEC 13.4, 2026-11-18에 SPEC에 반영).

| 묶음 | 파일 | 예산 | 지금(v1) | 맞추는 방법 |
| --- | --- | --- | --- | --- |
| 수식 엔진(SPEC 400줄) | `formula/parse.ts`, `runtime/formula/ast.ts`, `validate.ts`, `evaluate.ts` | **400**(구현 목표 ≤ 370) | 517(parse 276 + ast 59 + evaluate 182) | Pratt 파서를 문법을 그대로 옮긴 재귀 하강(약 220)으로, 이름 해석·unavailable 이유·가까운 이름 조회·spans를 `formula/diagnose.ts`로, 메시지와 `show()` 같은 문구 함수를 `messages.ts`(데이터)와 `util.ts`로, 인자 수 표와 이름 검사를 `ast.ts` 하나로 합쳐 validate 약 50, evaluate 약 60, ast 약 40 |
| 부문 판정 runtime(SPEC 200줄) | `runtime/conditions.ts`, `runtime/divisions.ts` | **200**(구현 목표 ≤ 180) | 336(eligibility.ts: 머리 22, 조건 114, 정규식 분석 109, 부문 91. 정량자 4개뿐) | 정규식 분석기와 `matchesProblem`·`compiledPattern`·`hasGroupOutsideSubset` 삭제, `trackDivisionSpec` 삭제, 조건 모양·한도 검사를 한 guard로, 근거 문장 만들기를 runtime 밖(7.7)으로, `checkApplicantEligibility`를 `intake.ts`로 |
| 수식 보조 도구 | `formula/diagnose.ts`, `suggest.ts`, `lint.ts`, `simulate.ts`, `reference.ts` | 450 | 없음 | |
| 신청서·제출 검사 | `runtime/intake.ts` | 180 | 없음 | 형식 프리셋은 글자 루프, 형식별 정리 표(7.10), 부문 추가 질문, `checkApplicantEligibility`, `validateSubmission`(7.11, 질문 검사는 신청서와 같은 함수를 씀) 포함 |
| rules 번들 전체 | rules entry가 닿는 runtime 파일(messages·types·selftest-vectors 제외) | 650 | | 백엔드 `Rules.gs`는 이 예산으로 재고 SPEC의 "Apps Script core 1,000코드줄"(손으로 쓴 백엔드)에 넣지 않습니다(SPEC 13.4) **[D1]**. 부문 200 + 신청서·제출 180 + 루브릭·`stageSettings` 약 70 + `trackWindows` 약 25 + util·`isoToMs` 약 70 + `readConfigShape` 약 40 + `selfTest`·entry 약 40 = 약 625 |
| 사이트 사본 | `dist/rules.min.js` | gzip 10,000 B | | 사이트 첫 화면(SPEC 11.6의 gzip 35 KB)에 들어가므로 바이트로도 잽니다(1.2) **[D115]** |
| 점수·순위·상·결과 | `scoring.ts`, `final.ts`, `ranking.ts`, `prizes.ts`, `results.ts`, `variables.ts`, `rubric.ts` | 900(참고) | 352 | MCP 쪽만 쓰므로 SPEC 예산은 없음 |

---

## 13. 테스트

SPEC 16장. 테스트는 vitest(SPEC 13.3의 의존성 단계 D3에서 `node:test`로 옮겨도 같은 파일 구조)이고 공유 벡터는 `test/vectors/*.json`입니다.

### 13.1 단위

| 파일 | 꼭 있어야 하는 것 |
| --- | --- |
| `formula-parse.test.ts` | 2.1의 수용·거절 표 전부, 우선순위 표(`1 + 2 * 3`, `10 - 4 - 3`, `not 0 + 1`, `1 or 0 and 0`, `2 * -3`), 2.2 토큰 오류마다 하나, 2.3 한도 경계(500/501자, 200/201노드, 깊이: 괄호만 겹친 것 32/33겹, 왼쪽으로 깊은 합 32/33항, 단항 `-`·`not` 연쇄와 함수 중첩 31/32개(AST 깊이 32/33), 16/17인자, 1e9/1000000001), 2.8 오류 코드마다 메시지와 `pos`, 오류 모으기 순서, 이름 제안(2.9) |
| `formula-eval.test.ts` | 2.6 표의 노드마다, 지연 평가(`if`, `and`, `or`에서 고르지 않은 쪽의 빠진 변수는 던지지 않음), DIV0·SQRT_NEG·NONFINITE의 값과 `(code, path)`, 경고 중복 제거, `-0` 정규화, `0^0 = 1`, `clamp`의 `lo > hi`, 빠진 변수는 `E_VAR_MISSING`, 자기 속성만 읽음 |
| `round.test.ts` | 2.7 표 전부(`test/vectors/round.json`) |
| `formula-ast.test.ts` | validateAst 코드마다 조작된 AST(13.4), 경로 형식, 즉시 멈춤 |
| `formula-lint.test.ts` | 2.10 코드마다 통과·경고 사례, 부록 C의 가드 있는 식은 경고 없음·가드 없는 식은 ZERO_DENOMINATOR, `judge / max_total * 100`은 경고 없음, 범위 규칙 표의 각 행, 3.5의 미채점 0을 포함한 범위(1~5점 리프 셋에서 `(judge - 3) / 12 * 100`은 RANGE, `crit.idea / judge`는 ZERO_DENOMINATOR, `if(judge >= 3, …, 0)`은 경고 없음, `votes / team_count`는 ZERO_DENOMINATOR) |
| `formula-sim.test.ts` | 2.11 시나리오 다섯 개의 변수 값과 결과(부록 C 식: zero_votes → 0.85 × mid judge, zero_judges → 득표 부분만) |
| `variables.test.ts` | 3.2 이름 순서, 덮어쓰기 장소별 루브릭(`stageSettings`), `unavailable`의 각 이유(가산점이 없는 앞 단계의 `<s>.bonus`는 F_UNAVAILABLE), 게이트 key 제외, `ShapeConfig`로도 같은 결과, 3.4 통계(묶음별, 음수 득표 0, 부문이 빠진 팀은 `team_count`까지 모두 0) |
| `rubric.test.ts` | maxTotal·criterionMax·effectiveWeights(가중치형·배점형·트리·scale_normalize), 노드 points(SPEC 7.2 예시의 심사위원 A: `product` = 8 + 12 = 20), judgeTotal, checkScoreEntry 코드마다(`null` 지우기, `@abstain` 0·1·null과 ABSTAIN_VALUE), `onStep` 경계(7.25/0.5, 21.555/0.01, 0.3/0.1), `stageSettings`(덮어쓰기 장소별, 뒤가 이김, `when`은 적은 키만, 부문 `null` 팀에는 `division` 조건이 맞지 않음, 모르는 단계 E_CONFIG, event.json의 scoring으로도 같은 값) |
| `schedule.test.ts` | `trackWindows`(트랙 마감 ?? 공통 마감, 공통 창·트랙 창, add-on이 꺼지면 vote null, 팀 연장, 유예 분, event.json 입력), `isoToMs`(`test/vectors/time.json`: 오프셋·`Z`·밀리초·윤년·잘못된 문자열 E_INPUT) |
| `scoring.test.ts` | 4.3 행 처리: `seq` 순서(배열 순서와 무관), 겹친 `seq`는 E_INPUT, `epoch`가 작은 행은 ROW_STALE·큰 행은 E_INPUT, 덮인 행은 경고 없음, 검사에 걸린 마지막 행이 앞 행을 되살리지 않음, 검사 6가지, `null` 지우기, 기권과 `@abstain` 값; require_complete 참·거짓(빈 리프 = min), 게이트 칸만 채운 심사위원(점수 집계에 안 듦, 게이트 표에는 듦), 게이트만 있는 루브릭 + `require_complete: false`(모든 게이트를 채운 심사위원이 집계 대상이라 통과 팀이 진출함, D77); 4.5 게이트 규칙 표와 2:2·표 없는 게이트, 덮어쓴 루브릭에만 게이트가 있는 단계의 gate_rule 기본값 majority(D21), 아무도 보지 않은 팀(UNSCORED, GATE_NO_VOTES 없음), 게이트 탈락 + 채점표 없음(GATE_FAILED); 4.6 정규화(zscore·minmax·fallback·σ=0·FULL_PANEL·자르기와 NORMALIZE_CLAMPED); 4.7 집계(mean·median 짝수·trimmed_mean n ≤ 2k); 4.8 진출(top_n 경계 동점, top_percent 내림·최소 1, min_score, per, 부문이 빠진 팀, 결정, 진출 규칙 없음); SPEC 7.2 예시(`score` 78.67, `tie_break` [32.67, 19], `judge` 236/3과 `crit.tech` 98/3은 반올림하지 않은 값, 4.9); 4.6 끝의 company 예제 trimmed_mean 사례(`judge` 30, `crit` 합 5) |
| `bonus.test.ts` | 단계별, 정량자, individual, 음수, 팀원 없음(`null`·`[]`), individual인데 팀원이 2명 |
| `ranking.test.ts` | 1-2-2-4, tie_break 순서, precision 경계(80.994/80.991/80.995), 비숫자 마지막, 같은 등수의 id 순서, tie_break 길이가 다르면 E_INPUT, tie_order 결정 적용과 stale(사유 코드 `NO_MATCHING_TIE`), 동점 추적의 `values` 배열과 outcome(tie_break·decision·tied → unresolved·shared_award·shared), 비교 설정이 섞인 pool(기본 tie_break·precision으로 비교), `sameAst`(같은 식을 다른 덮어쓰기에 적으면 섞이지 않은 pool, 숫자 하나만 다르면 섞인 pool) |
| `prizes.test.ts` | 6.6의 단계마다: 사다리 기본값(`rank:<pool>`, sponsor·special·opt_in·eligible은 사다리 없음)과 직접 적은 사다리, 스폰서 상끼리 소비하지 않음, opt_in 사다리 단위 지원, 건너뛰기 이유 순서, max_per_team, exclusive, opt_in·eligible 거르기가 등수를 바꾸지 않음, share와 manual(결정 전 pending_tie, 결정 뒤 수상), pending_tie 상의 경계 앞 수상 팀이 `held`에 들어가 뒤 상의 max_per_team에 걸림(D80), `unresolved.teams`에 걸러진 팀 포함, 식형 상의 pool 키(사다리 `best_ai`와 사다리 없는 상 `best_ai`가 서로 다른 순위를 씀), pending_upstream(같은 사다리, max_per_team, exclusive, 영향 없는 상은 그대로), vacate, allow_vacant 거짓의 PRIZE_UNFILLED, vote(득표 0 제외, 동률), formula 상(덮어쓰기 전 precision), manual 상의 검사(빈 목록, count 초과, pool 밖, 게이트 탈락, 미지원 opt_in → stale)와 정책 충돌 경고, 미채점 팀 건너뛰기, 축약형 변환(6.7) |
| `results.test.ts` | computeResults의 단계 사슬(서면 예선 → 본선, 부록 D 게이트 예시), exclude(all/prizes)와 exclude(all) 팀의 모양, 상태 우선순위(4.5), 부문이 빠진 팀(DIVISION_MISSING 막음, 결과 표 제외, `<track>` 상 후보, 부문마다 루브릭을 덮어써 그 팀의 장소에 없는 기준을 읽는 tie_break이면 던지지 않고 FORMULA_UNAVAILABLE로 pool에서 빠짐), 결정의 충돌(DECISION_CONFLICT)과 같은 결정 두 번, stale 사유 코드마다 하나, 막는 문제 코드와 상 상태의 대응(6.8), publishable, VOTES_MISSING, `modules.judge: false`(UNSCORED 경고 없음, manual 상만), `epoch`가 없는 행은 0, 경고와 결정의 정렬 순서 |
| `conditions.test.ts` | op마다, 특별 field 넷, 답 없음 규칙(모든 op × 공백 값), 여러 답, email_domain·hosted_domain 소문자, domain_in 라벨 경계(`cs.example.ac.kr` 참, `badexample.ac.kr` 거짓), boolean eq, 한도(E_COND_LIMIT), `matches`는 E_COND_MALFORMED, 실패 경로 |
| `divisions.test.ts` | 7.4 표의 정량자마다(빈 팀, ratio 0.3 × 10, at_most 0, pick 동률·값 없음·아무도 없음·single 보기 순서), unit individual(팀원 수가 1이 아니면 E_INPUT)·organization, 팀원 51명 E_INPUT, auto·declared와 DivisionProblem, override 우선, 닫힌 부문의 override는 OVERRIDE_NOT_OPEN(던지지 않음), 사유가 비면 E_INPUT, 근거 구조(`k`, `ratio_ppm`, `pick`), **결과에 남의 답·이메일·덮어쓰기 사유가 없음**, freezeDivision(ok 거짓도 고정, members, override_reason), divisionNeedsReview 사실마다(구성만 바뀐 경우, 덮어쓴 팀의 구성 변경 포함) |
| `intake.test.ts` | 7.10 형식별 정리 표의 행마다(폼 문자열 숫자, `"true"`는 TYPE, multi 중복·원소 수·순서, 달력에 없는 날짜, 제어 문자, textarea 줄바꿈), 검사 순서(필수 → 타입 → 정리 전 길이 상한 → 정리 → 필수 → 길이 → 형식), 정리 전 길이 상한(공백 401개 + `x`는 LENGTH), 입력 상한(13.4), format 프리셋 경계, show_if 숨김과 답 버림, 설정 밖 답 버림(dropped), built-in 동의(privacy version, age_14_plus), `required`를 적지 않은 동의는 필수, 본인 확인 도메인, 증빙(선택 증빙의 잘못된 링크도 PROOF), 개인 자격 덮어쓰기(`overridden`, ok, 계산한 failed는 그대로, 사유는 결과에 없음, reason이 비면 E_INPUT), 부문 추가 질문(`when`이 참인 사람만 검사, 거짓이면 답 버림, 앞선 답으로 판정), event.json의 intake로도 같은 결과 |
| `submit.test.ts` | 7.11의 단계마다: 제출 질문 검사(신청서와 같은 정리·순서), `repo_link`에 따른 `repo`·`repo_sha` 필수 여부, `allowed_hosts`(라벨 경계, 대소문자, `badexample.com` 거절), opt_in이 아닌 상·모르는 상은 OPT_IN, 같은 id 두 번은 한 번, 사다리를 하나로 세는 OPT_IN_LIMIT, 설정 밖 답 버림, 입력 상한, event.json의 submit·prizes로도 같은 결과(`test/vectors/submit.json`) |
| `i18n.test.ts` | `rules.ko.json`과 `rules.en.json`의 키 집합이 같음, 모든 rule·DivisionProblem·FieldErrorCode·ScoreEntryCode에 틀이 있음, `describe*`의 문장, `{pct}` 넣기(0.07 → 7, 0.29 → 29, 0.333333 → 33.3333) |
| `merge.test.ts` | v1 사례 + 8.5의 새 key 목록(`schedule.extensions`), 맵의 null 삭제 |
| `load.test.ts` | v1 사례(preset 내용은 v2) + `assets`·`layers`·`aliases`, 층마다 `ref`·`extends`, 옛 이름 `site.logo`로 적은 로컬 로고도 `assets`에 기록(정규화 뒤 기록), `resolveLayers`, `loadPresetLayer`(없는 이름·버전, planned), MCP 0.1.0 파일은 V010_FORMAT 하나, 키트 preset에 extends 없음, 최상위 `roster`는 SCHEMA(D109) |
| `normalize.test.ts` | 층마다 정규화: 옛 키를 쓴 profile + 새 키를 쓴 event가 오류 없이 합쳐짐, event의 `null`이 profile의 옛 키 값도 지움, update 항목의 `max`(type은 앞 층에서), 같은 층의 옛·새 키는 SCHEMA, 정규형 preset을 extends하는 아래 층의 `scoring.tie_break`; 4.2 축약형 변환 표의 행마다, 섞임 오류, components → 식(수 표기, 모두 0, judge 빠짐), v1 overrides의 장소별 변환(누적 덮기, 식과 components, `formula: null`, 4.2 끝의 고정 사례: 부문 장소는 트랙 항목을 덮은 기준값과 비교)과 "무작위 v1 overrides 목록에서 모든 장소의 v1 `settingsFor`와 v2 실효 설정(리프·step·aggregate·require_complete·식의 값)이 같음" property 테스트, components 수의 표기(`123456789.1`, `0.0000001`); 8.6 alias 표의 행마다 DEPRECATED, NFD로 적은 한국어 질문 key와 NFC로 적은 조건 field가 같은 key로 이어짐(D102), 6.7 상금표 변환(목록·맵·부문 펼치기·id·순서, 트랙 순서는 `order`) |
| `locked.test.ts` | 다섯 키와 이유, 층별 보고, null도 위반, 메모리 설정 |
| `schema.test.ts` | `configJsonSchema()`가 `test/__snapshots__/event.schema.json`과 같음, `$id`, add-on 옵션 스키마, deprecated 표시, `site.theme.font`(web·system, 다른 값은 SCHEMA), 두 예제와 SPEC fixture의 층 파일이 `layerSchema`를 통과, 스키마에서 이미지 칸으로 표시한 경로가 `IMAGE_KEYS`와 같음(D103) |
| `check-v*.test.ts` | V1~V24 각각 통과 사례 하나 이상, 실패 사례마다 심각도·경로·메시지·고칠 방법(오류는 fix가 비지 않음), "check 통과 → build 성공"(check 테스트의 통과 사례 전부와 두 예제). V6은 "공통 창 하나, 트랙 둘 → 진단 없음", V7은 "items에 없는 질문 key → 오류", V8은 "file: null인 층의 github 토큰 → 오류"와 "느슨한 섹션의 operator_key → 오류", V16은 늘 참 판정의 각 규칙. 이번 판에 더한 것: V5의 max_per_team 경고(트랙 하나에 3팀, 1·2·3등 + 인기상 + 특별상, max_per_team 1 → pool `*`의 상 5개 중 2개는 채울 수 없다는 경고), V11의 NFKC 겹침과 number 질문의 소수 7자리, V15의 부문 조건이 추가 질문을 읽음, V17의 덮어쓴 루브릭에만 게이트가 있는 gate_rule(경고 없음), V19의 module 끄기, V22의 원격 이미지(REMOTE_IMAGE), 8.10의 module별 건너뜀, 참조 오류가 있으면 V4·V18·V20 대신 CHECK_SKIPPED info 하나(예외로 끝나지 않음), `ctx.aliases`로 바꾼 경로 |
| `addons.test.ts` | 목록·상태·requires, 옵션 기본값(github_ops의 `write_delay_ms`·`templates`, integrity_check의 `prep`·`late_push`), catalog의 JSON Schema, confirmation(`new_scopes`, `removed_scopes`, `reauthorization_required`, `backend_redeploy_required`, `new_github_permissions`, `github_approval_required`. github_ops·integrity_check 켜기와 끄기), changes(기준이 `NormalizedConfig`이고 새 설정이 `ResolvedConfig`여도 같은 결과), `addonShipped`(since가 null, 같은 버전, 낮은 버전), catalog·confirmation의 shipped·since(D99) |
| `build.test.ts` | NormalizedConfig 기본값(`site.theme.font: web`, `intake.capacity: null`, `intake.division_fields`, 동의 `required: true`), `_config`·`event.json`의 키 집합(`site.theme`은 `accent`·`logo`·`hero`·`font`), 공개에서 빠지는 것(`config_hash`, `schedule.extensions`, `github_ops.templates` 포함), hash 규칙(키 순서 무관, revision 무관, 정수 모양 키의 정렬), public_hash, 시각의 정규형, `stageLockFingerprint`·privacy version이 "정규형에 관계없는 키를 더해도 같음", `stageLockFingerprint`는 advance·aggregate·normalize·tie_break·rank_groups·unresolved_tie·식형 상의 식·popular_vote의 normalize(formula_input일 때)를 바꾸면 달라지고 이름·anchors 문구·상의 count·judges_per_project를 바꾸면 같음(D101), buildConfigTab의 V8 재검사, buildEventJson의 비밀·이메일 재검사(BuildError, `org.contact`·`privacy.contact`는 예외), `normalizeShape`가 참조 오류에서 던지지 않음, readConfigShape·readConfigTab의 거절, loadConfigTab의 F_SOURCE_MISMATCH와 config_hash 대조 |
| `public.test.ts` | publicResults의 level마다 모양, 허용 목록 밖 칸이 없음(reason·by·judge·warnings·inputs), publishable 거짓은 E_INPUT, names 규칙, 결과에 이메일 모양이 있으면 E_INPUT |
| `cli.test.ts` | check 출력·`--json`·fix 줄, build의 `--site`(event.json 하나만)와 `--config`, `--config`가 `--site` 안이면 exit 2, `--out`은 인자 오류, `--revision`, 실패 시 아무것도 남지 않음, plan(patch 모양과 경로 순서, base 읽기 실패), export --dev(폴더 구조, 층의 `extends` 다시 쓰기, 덮어쓰기 거절), migrate(출력 위치, 덮어쓰기 거절), 종료 코드 |
| `migrate.test.ts` | 11.6 표의 행마다, `write_delay_ms` < 1000 → 1000과 경고, TrackId가 아닌 트랙 key, template이 event.json에 없음, `roster`는 옮기지 않고 info, 결과가 `layerSchema`를 통과, MIGRATE_TODO 목록, apps_review는 app_policy가 있을 때만, 0.1.0 스키마로 못 읽는 파일 |
| `runtime-guard.test.ts` | **[D106]** 두 검사를 따로 합니다. 대상은 `src/runtime/**/*.ts` 전부와 번들 결과물(`rules.gs.js`, `engine.gs.js`)입니다. ① 코드 토큰: 주석과 문자열·template 리터럴의 내용을 빼고 `eval(`, `Function(`, `with (`, `Date.now`, `new Date(`, `Math.random`, `Intl.`, `localeCompare`, `RegExp(`, 0.1 #2의 ES2020 이후 API가 없음. ② 대회 값(SPEC 13.4, LEAN-7): 주석만 빼고 문자열·template 리터럴 **안까지** 보고 `YYYY-MM-DDT` 꼴 시각 문자열, `googleapis.com`·`google.com` 밖의 `http(s)://` 주소, 한글 음절이 없음. 대회 값은 리터럴 안에만 나오므로, 리터럴을 빼면 이 검사가 아무것도 잡지 못하기 때문입니다. ②의 예외는 이름으로 정한 데이터 파일 둘뿐입니다: `runtime/messages.ts`(한글만 허용), `runtime/selftest-vectors.ts`(시각 문자열만 허용). 번들에서는 이 두 파일의 문자열 값과 글자까지 같은 리터럴만 같은 예외를 받습니다(테스트가 두 파일을 import해 문자열 집합을 만듦). ③ 심은 리터럴: runtime 파일 하나의 사본(메모리)에 `"2027-04-04T10:00:00+09:00"`, `"https://example.com"`, `"학생"`을 넣으면 ②가 실패하고 주석에 `Date.now`를 적은 사본은 ①이 통과함 |
| `spec-examples.test.ts` | 13.2의 SPEC 예시 fixture와 기대 진단 |
| `v1-compat.test.ts` | 14.2의 v1 기준 벡터 |
| `budget.test.ts` | 12장의 예산, messages.ts·types.ts·selftest-vectors.ts에 코드가 없음, `dist/rules.min.js`의 gzip 크기 10,000 B 이하(D115) |

### 13.2 골든 (JDG-9, 부록 C·D)

- **ENDPoinT 식**: 부록 C의 가드 있는 식 `0.85 * judge + if(avg_votes > 0, 15 * sqrt(min(1, votes / (2 * avg_votes))), 0)`, 10팀·60명×3표·180표·평균 18에서 득표 80/36/27/18/9/3/0의 인기투표 부분이 15.00/15.00/**12.99**/10.61/7.50/4.33/0.00, `judge 80 + 27표` → **80.99**, `judge 70 + 3표` → **63.83**. 모든 팀의 평균 득표가 0인 묶음에서 득표 부분 0이고 DIV0 경고가 없음(가드), 가드 없는 식은 같은 값에 팀마다 DIV0 경고.
- **예제 끝까지**(`test/golden.test.ts`): `examples/reference-2track`을 불러 검사(정보 진단만), 빌드, 아래 고정 입력으로 `computeResults`.

| 팀 | 득표 | 심사위원 총점(각 리프 = 총점/4) | judge | S |
| --- | --- | --- | --- | --- |
| 01 | 80 | 60, 60 | 60 | 66.00 |
| 02 | 36 | 60, 60 | 60 | 66.00 |
| 03 | 27 | 76, 84 | 80 | **80.99** |
| 04 | 18 | 76 | 76 | 75.21 |
| 05 | 9 | 50 | 50 | 50.00 |
| 06 | 3 | 70, 90(ux 빈칸 → 빠짐) | 70 | **63.83** |
| 07 | 0 | 40 | 40 | 34.00 |
| 08 | 4 | 30 | 30 | 30.50 |
| 09 | 2 | 20 | 20 | 20.54 |
| 10 | 1 | 10 | 10 | 11.00 |
| 11~20(impl) | 각 5 | 각 1명, 90·85·…·45 | | 평균 득표 5(해커톤 통계와 섞이지 않음) |

  해커톤 상(축약형: 1등 1팀, 2등 2팀): 1등 `03`. 2등은 `04` 다음 자리를 두고 `01`·`02`가 끝까지 동점(judge·crit.arch 같음)이므로, 예제 기본(`unresolved_tie: manual`)이면 `pending_tie`, `unresolved = [{ pool: "hack", prize: "hack_p2", place: 2, rank: 3, teams: ["01","02"], eligible: ["01","02"], slots: 1 }]`, `publishable: false`. `tie_order [02, 01]` 결정을 넣으면 2등 `[04, 02]`. 테스트에서 `unresolved_tie: share`로 바꾸면 2등 `[04, 01, 02]`, `tie_expanded: true`.
- **부록 D 게이트**: 1~5점, impact 가중치 2, 게이트 majority, 심사위원 A(4,3,5)·B(3,4,4)·C(5,3,4), 게이트 1·1·0 → `max_total 20`, 총점 17·15·16, `judge 16.00`, `gate { judged: true, passed: true, yes: 2, no: 1 }`. 이 팀이 트랙 상위 15팀이면 본선 진출, 본선 식에서 `screening.judge = 16`.
- **SPEC 예시**(`test/spec-examples.test.ts`, `test/fixtures/spec/`): SPEC의 YAML을 fixture로 두고 기대 진단을 고정합니다. SPEC이 고쳐지면(15.2) 기대값을 함께 고칩니다.
  - `spec-6.2/`: 6.2의 profile과 event를 그대로(로고는 1 KB 미만 가짜 SVG). 기대: 오류 0개(2026-11-18에 SPEC 6.2의 `privacy.items`를 받는 key 전부로 고쳤으므로 V7 오류가 없음), V6 진단 없음(공통 창 하나, 트랙 둘), 트랙은 정확히 `hack`·`impl` 둘, V3 info 하나.
  - `spec-7.2/`: 6.2의 profile을 extends하는 6.2 event에서 `scoring`을 7.2의 블록으로 바꾼 것(위 층 preset의 축약형을 지우는 `criteria: null`만 더함. D52의 섞임 오류 때문이고 15.2에 적음). 기대: 오류 0개.
  - `spec-c/`: 같은 profile을 extends하는 층에 부록 C의 `scoring`과 `addons.popular_vote`를 적은 것. 기대: 오류 0개, V4 lint 없음(가드).
- **두 예제의 생성물 snapshot**: `test/__snapshots__/{reference,company}.{event,config}.json`과 `event.schema.json`.

### 13.3 공유 test vector와 parity

`test/vectors/`에 JSON 벡터를 둡니다: `round.json`, `time.json`(`Iso` → epoch ms), `formula.json`(`{ source, vars, value, warnings }`, 컴파일한 AST를 함께 저장), `ast-invalid.json`, `conditions.json`, `divisions.json`, `intake.json`, `submit.json`(`validateSubmission`), `rubric.json`(덮어쓰기 장소별 `stageSettings` 포함), `schedule.json`(`trackWindows`), `scoring.json`(작은 정규형 설정 + 입력 + 기대 결과), `prizes.json`. `test/parity.test.ts`는 벡터마다 ① Node import ② 빈 `vm` context의 `dist/engine.gs.js` ③ rules 벡터는 빈 `vm` context의 `dist/rules.gs.js`에서 돌린 뒤 값을 JSON으로 거친 결과가 기대값과 서로 같은지 봅니다. ②③은 ES2020 이후 내장 함수(0.1 #2의 목록)를 `delete`한 **ES2019 표면**의 context에서도 한 번 더 돌립니다. Node와 같은 V8의 빈 context에는 그 함수들이 남아 있어 runtime이 써도 parity가 통과하기 때문입니다. 번들은 `buildRuntime({ write: false })`로 메모리에서 만듭니다. 이 함수는 세 파일(`rules.gs.js`, `rules.min.js`, `engine.gs.js`, 1.2)을 이름과 함께 돌려줍니다. rules 벡터는 `rules.min.js`로도 한 번 돌립니다(사이트 사본이 같은 결과를 내는지). 예제 두 개의 `_config`에서 만든 무작위 입력(mulberry32 시드 고정, v1의 방식)도 똑같이 비교합니다. 브라우저 번들 parity는 사이트 패키지(M3)에서 같은 벡터(특히 `time.json`)로 합니다.

### 13.4 보안 코퍼스

- 수식 원문: `constructor`, `__proto__`, `prototype`, `crit.__proto__`, `a.constructor`, `__definegetter__`, `toString`(대문자 → F_NAME_CASE), 키릴 문자 `сrit`, 전각 `１`, NUL 문자, `1e999`, `0x10`, `.5`, `1_000`, `${x}`, `eval(1)`, `Function(1)`, `this`, `a[0]`, 따옴표, 백틱, 길이 10^6의 입력(길이 검사가 먼저라 즉시 거절: 10 ms 안), 괄호 400겹.
- 조작된 AST: 모르는 `k`·`o`·`f`, `f`가 `constructor`·`hasOwnProperty`, 키가 더 있는 노드, `v`가 문자열·NaN·1e10, `^`의 `b`가 변수·5·2.5, 17인자 `sum`, 깊이 100,000(재귀 없이 만든 것), 노드 10,000개, `n`이 4마디·대문자. **원문과 다른 유효 AST**(source는 `0.85 * judge + …`인데 ast는 `crit.arch * 4`): readConfigTab은 통과하고 loadConfigTab은 F_SOURCE_MISMATCH.
- 조건: `matches`(E_COND_MALFORMED), `field: "__proto__"`·`"constructor"`(답을 prototype에서 읽지 않음), 깊이 100,000의 `not`(E_COND_LIMIT, 재귀 전), 길이 10^5 목록.
- **금지 이름**: 설정의 트랙·부문·상·루브릭·단계·가산점·사다리 id, 질문·동의·증빙 key, add-on id, `site.strings`·`upload.kinds`의 키에 `__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, `hasOwnProperty`를 넣으면 SCHEMA, 입력의 팀 id·심사위원 id·팀원 id·`by`에 같은 이름과 이메일을 넣으면 E_INPUT. `divisions: [toString]`인 트랙은 V15.
- **링크와 이미지**: 링크·이미지 칸마다 `javascript:alert(1)`, `JaVaScRiPt:`, 앞에 공백·탭·NUL이 붙은 `javascript:`, `data:text/html,…`, `data:image/svg+xml;base64,…`, `//evil.example/x.png`, `vbscript:` → SCHEMA.
- **비밀**: `resolveLayers`로 만든 층의 `github.token: "ghp_…"` → V8 ②, `repo.operator_key: <무작위 40자>` → V8 ③(키 이름), `site.strings`의 키와 `upload.kinds` id에 이메일·`ghp_` 토큰 → V23, buildConfigTab이 비밀 모양을 만나면 BuildError, check를 건너뛰고 부른 buildEventJson이 `site.about`의 이메일이나 `ghp_` 토큰을 만나면 BuildError(D95).
- **큰 수와 비정상 수**: 설정의 수 칸마다(weight, max, points, amount, count, precision) YAML `.inf`·`-.inf`·`.nan` → SCHEMA. `RawScoreRow.value`에 JSON `1e309`·`-1e309` → SCORE_NOT_NUMBER, `-0` → 0, 득표 `1e309`·음수 → VOTES_INVALID, number 답 `1e309` → TYPE.
- **신청서 입력 상한**: 10^7자 답이 10 ms 안에 LENGTH, 원소 10^5개 multi 답 → OPTION, 키 10^4개 answers → E_INPUT, 255자 이메일 → IDENTITY_DOMAIN.
- locked invariants 연결(SPEC 16): preset의 `enabled: true`는 V14, 식의 `constructor`는 F_FORBIDDEN_NAME, `_config` AST 조작은 readConfigTab·loadConfigTab이 거절, 주민등록번호 질문은 V21, 만 14세 확인 동의가 늘 있음, 부문 근거에 남의 값이 없음, 공개 투영과 공개 결과에 이메일이 없음(V23, 6.10), 사이트 폴더에 `_config.json`을 쓸 수 없음(11.5).

### 13.5 metamorphic

- 입력 행·팀·배정·결정의 배열 순서를 섞어도 결과 JSON이 같음(행의 승패는 `seq`로 정하므로 같은 키의 행 순서도 섞음).
- 같은 결정을 두 번 넣어도 같음. 충돌하는 두 결정은 순서와 관계없이 DECISION_CONFLICT.
- 장소마다 tie_break·precision이 다른 팀이 섞인 pool(6.1)에서 팀 입력의 모든 순열이 같은 등수와 같은 수상을 냄(길이가 다른 tie_break를 짧은 쪽까지만 비교하면 "같음"이 추이적이지 않아 순열마다 결과가 달라지므로, 6.1의 비교 설정이 이를 막는지 확인).
- 팀 id를 순서를 지키는 다른 id로 바꾸면 결과가 같은 대응.
- 식 `judge`(가산점 없음)와 식 없음이 같은 점수, 식 `judge + bonus`와 식 없음(가산점 있음)이 같은 점수.
- 축약형 설정과 손으로 쓴 같은 뜻의 정규형(`rubrics.main`, `stages[main]`, `final`)의 NormalizedConfig가 별명과 `source` 경로 외에 같고 `computeResults`도 같음.
- 트랙 상금표와 이를 6.7대로 펼쳐 손으로 쓴 `prizes[]`의 PrizeResult가 id·source 외에 같음.
- zscore: 한 심사위원의 총점을 `a·t + b`(a > 0)로 바꾸면 모든 심사위원의 z가 같고 그 단위(4.6) 안의 정규화 총점이 모두 하나의 양의 아핀 변환으로 바뀜(1e-9 안). 그래서 가산점과 식이 없고 pool에 정규화 단위가 하나면 `judge`의 순서도 같음. 가산점이나 식이 있으면 팀 순위는 바뀔 수 있으므로 비교하지 않음(목표 μ·σ가 함께 움직여 `judge + bonus`와 식의 다른 항과 교환되지 않음. 예: 리프 하나(0~100), min_entries 2, J1 {A 10, B 50, C 90}, J2 {A 50, B 52, C 54}, A에 가산점 +5이면 J1을 0.1t + 45로 바꿀 때 순위가 C > B > A에서 C > A > B로 바뀜). 모든 심사위원을 같은 `a, b`로 바꾸면 정규화 뒤 총점이 같은 아핀 변환(1e-9 안). 모든 심사위원의 채점 수가 `min_entries` 이상이고 σj > 0이며 자르기(4.6)가 일어나지 않는 입력에서만.
- 같은 채점표를 더 큰 `seq`로 한 번 더 넣어도 결과가 같음.
- min이 0인 배점형 루브릭에 `scale_normalize`를 켜고 리프마다 `weight`를 그 리프의 `max`로 두면(비례 상수 1) `judge`와 순위가 배점형과 같음(1e-9 안). 비례 상수가 1이 아니면 총점의 크기가 바뀌어 `precision` 반올림에서 동점이 새로 생길 수 있으므로(예: 리프 넷(0~25), A [20, 20, 20, 20.01], B [20, 20, 20, 20.02]를 weight 1로 두면 3.2004와 3.2008이 precision 2에서 둘 다 3.2) 반올림 전 `judge`의 순서만 비교함.

### 13.6 fuzz (개발 전용, CI 밖)

무작위 식(문법 생성기, 시드 고정)을 컴파일해 validateAst 통과 → evaluate가 던지지 않고 유한한 값을 내는지, 무작위 문자열은 컴파일 오류로만 끝나는지.

### 13.7 예제 snapshot 갱신

14.3의 예제로 다시 만들고 PR에서 diff를 사람이 봅니다. snapshot을 고칠 때는 `vitest -u`가 아니라 테스트가 쓰는 `toMatchFileSnapshot`의 파일을 함께 커밋합니다.

### 13.8 smoke (`scripts/smoke.mjs`)

빌드된 CLI로 두 예제를 check하고 `build --site <임시 폴더> --config <다른 임시 폴더>/_config.json`으로 빌드해 `--site` 폴더에는 `event.json` 말고 아무 파일도 없는지, `--config`를 `--site` 안으로 주면 exit 2인지, 없는 파일은 exit 1인지 봅니다. 빈 `vm`에 `dist/rules.gs.js`를 넣어 `SHK.selfTest().ok`, `dist/engine.gs.js`를 넣어 reference `_config`로 같은 트랙의 두 팀(judge 80·득표 27, judge 70·득표 9: 합 36, 평균 18)을 계산해 점수가 `80.99,67`인지 봅니다.

---

## 14. v1 → v2 이전

**v1은 배포된 적이 없습니다.** `packages/core`는 `private`이고 npm의 0.1.0(2026-11-09, 커밋 `12b7ee5`)은 core가 생기기 전의 MCP 서버만 담았습니다. 그래서 1차 구현의 설정 형식은 지원 대상이 아닙니다. 예외는 셋입니다. SPEC이 약속한 점수 축약형(SPEC 7.2, v1 이름 포함)과 트랙 상금표(SPEC 7.4)는 4.2와 6.7로 계속 받고 8.6 ①의 별명 표에 있는 1차 키(사이트·이벤트·개인정보·제출·질문·트랙·add-on 이름)는 저장소의 예제와 문서가 썼던 이름이라 DEPRECATED 경고와 함께 0.3.x 동안 받습니다(D54). 이 셋은 SPEC REL-3(배포된 키를 없앨 때의 규칙)에 근거한 것이 아닙니다. 그 밖의 1차 키는 모르는 키로 SCHEMA 오류입니다. 저장소의 두 예제는 14.3처럼 손으로 옮깁니다. SPEC 18.2·REL-2의 자동 변환 의무는 배포된 형식에 걸리므로, 변환 대상은 0.1.0 MCP의 `event.yaml`(CFG-8, 11.6)입니다.

### 14.1 동작과 모양의 변경

| 영역 | v1 | v2 | 근거 |
| --- | --- | --- | --- |
| `^` | 오른쪽 결합, 실수 지수(`2^0.5`, `2^-1`, `2^3^2 = 512`) | 정수 리터럴 0~4, 결합 없음, 반복 곱셈 | SPEC 7.6 #1 |
| `-2^2` | `-(2^2) = -4` | F_NEG_POW 오류 | #2 |
| 0 나누기 | 조용히 0 | 0 + DIV0 경고 | #3 |
| 음수 제곱근 | 조용히 0 | 0 + SQRT_NEG | 7.3 |
| 유한하지 않은 값 | `^`와 최종 결과만, 한국어 문자열 경고 | 모든 연산, `{ code, path }` 경고 | 7.3 |
| 이름 | `[A-Za-z_]…`, 2마디 | `[a-z_]…`, 3마디, 100자, 금지 이름 | #4 |
| 인자 수 | 노드 한도뿐 | 16개 | 7.3 |
| `round` | `String(x)`로 자릿수 이동 | `toPrecision(15)` 정리 뒤 이동(`round(0.03 * 7.5, 2)` 0.22 → 0.23) | 7.3 |
| 해석 함수 | `evaluateAst`, `roundTo` | `evaluate`, `roundHalfAway` | |
| 파서 | Pratt | 재귀 하강 | 12장 |
| 조건 `matches` | 정규식 부분집합 + 분석기 | 없음(V24, runtime 거절) | #5 |
| 특별 field | email, email_domain | + hosted_domain, `verified.<key>` | #7 |
| `domain_in` | 정확히 일치 | 라벨 경계 접미사 일치 | D39 |
| `eq` 값 | 문자열·숫자 | + boolean | D40 |
| 정량자 | all_members, any_member, leader, majority | + no_member, at_least, at_most, ratio, pick; 빈 팀은 모두 거짓 | #6 |
| 부문 결과 | `{ division, ok, reasons: string[] }` | `{ division, ok, source, reasons: DivisionReason[], problem }`(문장 없이 코드와 인자, 7.7), override, 고정 기록(팀원 id 포함) | #6, D84, D96 |
| `division_mode` 기본 | declared | auto | D46 |
| `trackDivisionSpec`, `prizesByTrack`, camelCase runtime 모양 | 있음 | 없음(snake_case 하나) | D2 |
| 점수 설정 | 평평한 `ScoringConfig` + overrides | rubrics·stages·final(축약형은 4.2로 변환, v1 overrides는 장소별로) | #8, D98 |
| 점수 입력 | `JudgeSheet { judge, team, scores }` | `RawScoreRow { stage, team, judge, criterion, value, seq, epoch }` + `@abstain` | 7.5, D17, D90 |
| 마지막 값 | 배열 순서 | `seq` | D17 |
| 범위 밖·단위 밖 점수 | 잘라 맞추기·단위로 반올림 | 집계에서 빼고 경고 | D19 |
| 빈 리프(require_complete 거짓) | 0 | min, 게이트 칸만 채운 심사위원은 점수 집계에서 뺌 | D18, D77 |
| `components`, `popular_normalize` | 점수 설정 | 식과 popular_vote 옵션(축약형 변환) | 4.2 |
| tie_break 기본 | `[judge]` | `[]` | D27 |
| rank_groups | track 필수 | `[]`, `[track]`, `[track, division]` | D28 |
| 같은 등수의 순서 | 입력 순서 | team id 순서 | D30 |
| 미채점 팀 | judge 0으로 순위·상 | 순위·순위형 상에서 빠짐 | D29 |
| 상 | `tracks.<id>.prizes {place, teams}`, 경계 동점은 늘 확장 | 상 엔티티 + policy + 사다리, 동점은 unresolved_tie(기본 manual) | #9, D79 |
| 출력 | `TeamScore`, `RankedTeam`, `PrizeAward` | `StageResult`, `FinalTeamResult`, `PrizeResult`, `ResultsComputation`, 스냅샷, 공개 결과 | 6장 |
| 합산 순서 | 입력 순서 | 4.11 고정 | #10 |
| add-on | available/planned, team_board·notices·slide_preview·track_moves·check_in·mentor_queue·judge_assignment | stable/beta/planned, 9.2 목록, 별명·폐지 처리(8.6) | #11 |
| preset의 add-on 켜기 | 막지 않음 | V14 오류 | #12 |
| privacy | `retention_days`(V7은 0 이상만) | 목적·항목·보유기간·거부·문의처, 수집 key ⊆ items(V7 전체) | #13, D67 |
| 검증 규칙 | V1~V15 | V1~V24(V9 없음), 고칠 방법 열, DEPRECATED | #13 |
| V1 사슬 | 사전 프로그램 포함, 결과 공개 없음 | team_lock·results_at·팀별 연장 포함, 세션 제외 | 6.4, D88 |
| V6 | 트랙 order와 다른 순서도 오류 | 겹침만 오류(공통 창은 비교하지 않음), 순서는 경고 | D55 |
| V15 email 경고 | 경고 | V23 오류 | 6.3 |
| locked key | 3개 | 5개 | 15.1 |
| 질문 | `max` = 길이, 형식 없음 | `max_length`, `format`, `show_if`, `boolean`·`url`, Localized label(필수) | APP-1 |
| site | `title, tagline, logo, accent, links, contact` | `theme`(accent·logo·hero·font), `languages`, `sections`, `rules`, `code_of_conduct`, `policy_links`, `org.contact`, 링크·이미지 scheme 검사 | 6.2, D89, D105 |
| `roster` 섹션 | 그대로 통과(passthrough) | 폐지(SCHEMA 오류, 0.1.0 변환은 옮기지 않음) | SPEC BE-3, D109 |
| event | `locale`, organizers 문자열 | `site.languages`, Localized organizers, `online` | 6.2 |
| submit | `team_max_gb`, `kinds`, `repo_link` | `preset`, `repo_link`, `allowed_hosts`, `max_opt_ins`, `extra_fields`(업로드는 add-on), 검사 함수 `validateSubmission` | SUB-1, D107 |
| 생성물 | `event.json` 하나(혼합 모양, AST 포함) | `_config`(전체·AST·config_hash) + `event.json`(공개·원문만·public_hash) | 6.3, D62 |
| hash | `JSON.stringify`로 직렬화 | 직접 쓰는 canonical(정수 모양 키도 사전순) | D97 |
| 번들 | `dist/runtime.gs.js`(SHK) | `dist/rules.gs.js`(SHK) + `dist/engine.gs.js`(SHK_ENGINE) | D1 |
| CLI | check, `build --out`(event.json) | check `--json`, `build --site`(event.json만) + `--config`(_config.json), plan, export --dev | 11.5, D91 |
| preset | `@1`, 한국어 질문 key, 트랙 `hackathon`·`assignment` | 그대로 `@1`(배포된 적 없음), ASCII key + label, 트랙 `hack`·`impl`(SPEC 6.2), open-public·kr-contest 추가 | D51 |

### 14.2 바꿔야 하는 테스트

**다시 쓰기 전에 기준을 남깁니다.** 지금 코드(ba43c98)로 `test/vectors/v1-baseline.json`을 만듭니다. 파서, 점수 입력, 상 배분을 모두 새로 쓰므로, 호환하기로 한 부분(축약형, 트랙 상금표, 집계·반올림·순위)의 회귀를 골든 값 넷(12.99, 80.99, 63.83, 78.67)만으로는 잡지 못하기 때문입니다.

- **입력은 전용 생성기로 만듭니다.** parity.test의 무작위 fixture(mulberry32 시드 2027, 5)는 일부러 빈칸과 범위 밖 값을 만들고 생성기의 `−1` 때문에 0.07000000000000006 같은 step 밖 값도 생깁니다(reference 시드 2027에서 범위 밖이나 step 밖 값이 없는 팀은 20팀 중 1팀, company 시드 5는 12팀 중 0팀). 골든 입력은 두 팀만 채점합니다. 그래서 둘 다 아래 호환 부분집합을 거의 만족하지 못하고 비교가 대부분 "14.1의 차이"로 끝납니다. 대신 `scripts/v1-baseline.mjs`(개발 전용, 시드 고정)가 부분집합 안의 입력만 만듭니다: 모든 리프 값이 `[0, max]` 안의 정수, 모든 팀을 모든 배정 심사위원이 모든 리프까지 채점, tie_break를 명시, `unresolved_tie: share`, 반올림 전 값이 반올림 자릿수의 경계(…5)에서 1e-9 안에 들면 그 입력을 버림.
- **설정은 두 쪽을 함께 저장합니다.** 두 예제의 점수 설정을 쓰되, v1이 해석한 점수 설정(`ScoringConfig`, 트랙 id는 v1 이름 `hackathon`·`assignment`)과 손으로 쓴 같은 뜻의 v2 정규형(트랙 id `hack`·`impl`, company는 v1의 기본 tie_break `[judge]`를 명시)을 벡터 파일에 함께 둡니다. 트랙 id의 대응표도 같이 적습니다.
- **비교.** 새 `v1-compat.test.ts`는 같은 입력을 원점수 행(`seq`는 v1 배열 순서)으로 바꿔 v2 정규형으로 `computeResults`를 돌리고 judge·crit·score·tie_break·rank·수상 팀이 v1 출력과 같은지 확인합니다. 그 밖의 차이는 기대값 옆에 14.1의 행을 적습니다.

지금 13개 파일, 224개 테스트가 모두 통과합니다. v2에서:

| 파일(테스트 수) | 바꿀 것 |
| --- | --- |
| `formula.test.ts`(39) | 나눠서 다시 씀(13.1). `2^3^2`, `-2^2`, `2^-1`, `-2^-2`, `(-8) ^ 0.5`, `2 ^ 0.5`, `1000000000 ^ 20`, 0 나누기 조용함, `sqrt(-4)` 경고 없음, `a.b.c` 오류 메시지, 대문자 이름(`toString`, `hasOwnProperty`), 부록 C 식(가드), `roundTo` 이름을 바꿈 |
| `scoring.test.ts`(27) | 원점수 행 입력과 정규형 설정으로 다시 씀. 잘라 맞추기·단위 반올림 테스트는 행 제외 경고로, components·popular_normalize·overrides 테스트는 축약형 변환·덮어쓰기로 |
| `scoring-vars.test.ts`(6) | `scoringVariables` → `variableSet` |
| `ranking.test.ts`(10) | `rankTeams`·`assignPrizes` → `rankEntries`·`allocatePrizes`, 같은 등수 id 순서, 경계 동점은 unresolved_tie, 사다리 |
| `eligibility.test.ts`(36) | `conditions`·`divisions`로 나눔. `matches`와 `matchesProblem` 테스트 삭제(V24·E_COND_MALFORMED로), domain_in 접미사, 새 field·정량자, 결과 모양(문장 대신 코드) |
| `check.test.ts`(39) | 규칙별 파일로. BASE 설정에 privacy 블록(수집 key를 모두 담은 items)·질문 label 추가, V1(세션 빠짐, team_lock·results_at·연장), V3(소문자 key), V4(메시지·lint·use formula_input), V5(상 엔티티), V6(순서는 경고), V7, V8(메모리 층·키 이름), V12(5개), V14(id 목록·preset), V15(matches → V24, email → V23), V16~V24 추가 |
| `merge.test.ts`(15) | key 목록 표 추가(`schedule.extensions`), locked key 5개 |
| `load.test.ts`(14) | preset 내용(ASCII key, 트랙 hack·impl)과 질문 key, `layers`·`assets`·`aliases`, 층마다 정규화, 0.1.0 형식, `event.locale` 기대값 삭제 |
| `build.test.ts`(9) | 두 생성물, 키 집합, runtime 모양 테스트 삭제, hash(canonical, config_hash는 `_config`에만) |
| `golden.test.ts`(5) | 13.2 고정 입력(모든 해커톤 팀 채점)과 새 상 결과(01·02 동점, pool `hack`) |
| `parity.test.ts`(6) | 벡터 기반 + 두 번들 + ES2019 표면 context |
| `runtime-bundle.test.ts`(8) | 두 번들 배너·API 목록·`matches` 테스트 삭제. 소스 검사는 `runtime-guard.test.ts`로 옮김(한국어 문자열 검사 포함) |
| `cli.test.ts`(10) | 출력 형식(fix 줄), `--site`·`--config`, `--revision`, `--json`, plan, export --dev |
| `helpers.ts`, `examples.ts` | `scoringConfig` 삭제, 정규형 설정 빌더, 행 빌더(`seq` 자동), 13.2 고정 입력 |

### 14.3 예제와 snapshot

두 예제를 v2 형식으로 고치고 snapshot(`reference.event.json`, `company.event.json`)을 다시 만들며 `reference.config.json`, `company.config.json`, `event.schema.json`을 더합니다. 두 예제 모두 check 결과가 V3 info(루브릭 main의 만점과 실효 비중) 하나뿐이어야 합니다(timezone과 team_lock을 적었으므로 V1·V16 info 없음, 수집 key를 모두 고지했으므로 V7 없음).

`examples/reference-2track/profiles/example-univ.yaml`:

```yaml
schema: 2
kind: profile
extends: [preset:standard-2track@1, preset:university-students@1]
org:
  name: { ko: 예시대학교 컴퓨터공학과 }
  contact: { ko: "운영진 메일 hackathon@example.ac.kr" }
event:
  timezone: Asia/Seoul
  organizers: [{ ko: 예시대학교 컴퓨터공학과 }, { ko: 예시 개발 동아리 연합 }]
site:
  theme: { accent: "#3b6ef5", logo: assets/logo.svg }   # 1 KB 미만의 가짜 SVG를 profiles/assets/에 둠(V22)
intake:
  identity:
    email_domains: [example.ac.kr, gmail.com]
privacy:
  purpose: { ko: "참가 신청 확인, 팀 편성, 심사와 시상 연락" }
  # preset 두 개가 받는 질문 key와 증빙, 로그인 이메일을 모두 적습니다(V7).
  items: [name, email, phone, github, team_hint, student_id, grade, affiliation, enrollment, enrollment_cert]
  retention: { days_after_event: 30, winners_days: 365 }
  refusal: { ko: "동의하지 않으면 참가 신청을 할 수 없습니다." }
  contact: { ko: "운영진 메일 hackathon@example.ac.kr" }
```

`examples/reference-2track/events/example-2027/event.yaml`:

```yaml
schema: 2
kind: event
extends: profile:example-univ
event: { id: example-2027, name: { ko: Example Hackathon 2027 }, venue: { ko: 예시관 101호 } }
site:
  title: { ko: Example Hackathon 2027 }
  tagline: { ko: 하루 동안 만들고 발표하는 학과 해커톤 }
schedule:
  recruit: { open: "2027-03-01T08:00:00+09:00", close: "2027-03-20T23:59:59+09:00" }
  team_lock: "2027-03-24T23:59:59+09:00"
  sessions:
    - { id: kickoff, at: "2027-03-25T19:00:00+09:00", title: { ko: "1차 · 팀 발표와 교육" }, place: { ko: 예시관 101호 } }
    - { id: mentoring, at: "2027-04-01T19:00:00+09:00", title: { ko: "2차 · 연사와 멘토링" } }
  main: { start: "2027-04-03T19:00:00+09:00", end: "2027-04-04T15:00:00+09:00", submit_deadline: "2027-04-04T10:00:00+09:00", grace_min: 5 }
  score_until: "2027-04-04T14:25:00+09:00"
  results_at: "2027-04-04T14:40:00+09:00"
tracks:
  hack:
    teams: ["01-10"]
    vote: { from: "2027-04-04T12:12:00+09:00", until: "2027-04-04T12:27:00+09:00" }
    prizes:
      - { place: 1, teams: 1, amount: 500000 }
      - { place: 2, teams: 2, amount: 300000 }
  impl:
    teams: ["11-20"]
    submit_deadline: "2027-04-04T09:00:00+09:00"
    vote: { from: "2027-04-04T14:15:00+09:00", until: "2027-04-04T14:25:00+09:00" }
    prizes:
      - { place: 1, teams: 1, amount: 200000 }
intake:
  fields:
    add:
      - { key: preferred_track, type: single, label: { ko: 희망 트랙 }, required: true, section: { ko: 참가 정보 },
          options: [{ value: hack, label: { ko: 해커톤 } }, { value: impl, label: { ko: 구현과제 } }] }
  consents:
    - { key: rules, text: { ko: "중복 제출 금지 등 대회 규정을 확인했습니다" }, version: v1 }
privacy:
  items: { append: [preferred_track] }   # 이번 대회에서 더한 질문도 고지합니다(V7)
addons:
  popular_vote: { enabled: true, votes_per_voter: 3, self_vote: false, use: formula_input }
  github_ops: { enabled: true }
  upload:
    enabled: true
    team_max_gb: 6
    kinds:
      slides: { name: { ko: 발표 자료 }, max_mb: 300, ext: [pdf, pptx, key, mp4, zip] }
      program: { name: { ko: 프로그램 }, max_mb: 1024, ext: [zip, 7z, apk, exe, jar] }
# 심사 85 : 인기투표 15. 투표가 없는 트랙의 0 분모를 가드합니다(부록 C).
scoring:
  formula: "0.85 * judge + if(avg_votes > 0, 15 * sqrt(min(1, votes / (2 * avg_votes))), 0)"
  tie_break: [judge, crit.arch]
submit: { preset: basic, repo_link: required }
# 아래는 운영진만 쓰는 값이라 event.json에 들어가지 않습니다.
github: { org: example-hackathon-org, team_name: "team{team_no}", team_no_pad: 2 }
repo: { visibility: private, readme_required_sections: [서비스 링크, 기술 스택] }
reviewers: { expires_at: "2027-04-30T23:59:59+09:00" }
```

`examples/company-internal/profiles/example-corp.yaml`:

```yaml
schema: 2
kind: profile
extends: [preset:single-track@1, preset:company-internal@1]
org:
  name: { ko: 예시주식회사 개발문화팀 }
  contact: { ko: "개발문화팀 hack@example.com" }
event:
  timezone: Asia/Seoul
  organizers: [{ ko: 예시주식회사 개발문화팀 }]
site:
  theme: { accent: "#0f766e" }
intake:
  identity:
    email_domains: [example.com]
    hosted_domains: [example.com]
  fields:
    add:
      - { key: employment, type: single, label: { ko: 고용 형태 }, required: true, section: { ko: 소속 },
          options: [{ value: regular, label: { ko: 정직원 } }, { value: contract, label: { ko: 계약직 } }, { value: intern, label: { ko: 학생 인턴 } }] }
privacy:
  purpose: { ko: "사내 해커톤 신청 확인, 팀 편성, 심사와 시상" }
  items: [name, email, phone, team_hint, employee_id, department, employment]
  refusal: { ko: "동의하지 않으면 신청할 수 없습니다." }
  contact: { ko: "개발문화팀 hack@example.com" }
```

`examples/company-internal/events/corp-hack-2027/event.yaml`:

```yaml
schema: 2
kind: event
extends: profile:example-corp
event: { id: corp-hack-2027, name: { ko: 사내 해커톤 2027 }, venue: { ko: 본사 3층 라운지 } }
schedule:
  recruit: { open: "2027-05-03T09:00:00+09:00", close: "2027-05-14T18:00:00+09:00" }
  team_lock: "2027-05-18T18:00:00+09:00"
  main: { start: "2027-05-20T10:00:00+09:00", end: "2027-05-21T18:00:00+09:00", submit_deadline: "2027-05-21T13:00:00+09:00" }
  score_until: "2027-05-21T17:00:00+09:00"
  results_at: "off"
# 팀원이 모두 학생 인턴이면 인턴 부문, 아니면 정직원 부문(auto: 위에서부터 처음 맞는 부문).
divisions:
  intern:
    name: { ko: 학생 인턴 }
    when: { field: employment, eq: intern }
    team_rule: all_members
    explain: { ko: "팀원 전원이 학생 인턴이면 인턴 부문입니다." }
  staff:
    name: { ko: 정직원 }
    when: {}
    explain: { ko: "인턴만으로 된 팀이 아니면 정직원 부문입니다." }
tracks:
  main:
    teams: ["01-12"]
    divisions: [intern, staff]
    prizes:
      intern: [{ place: 1, teams: 1, label: { ko: 인턴상 } }]
      staff: [{ place: 1, teams: 1, label: { ko: 대상 } }, { place: 2, teams: 1, label: { ko: 최우수상 } }]
# 식이 없으니 최종 점수는 judge + bonus(가산점 없음)입니다.
# 심사위원이 셋 이상이면 가장 높은 점수와 가장 낮은 점수를 하나씩 빼고 평균합니다.
scoring:
  aggregate: { method: trimmed_mean, trim: 1 }
  overrides:
    - when: { division: intern }
      tie_break: [crit.idea, judge]
```

company 예제의 parity fixture는 `employment` 값을 보기 셋에서 무작위로 골라 부문을 판정합니다(v1의 방식). 이 예제의 상은 모두 부문 pool이라 비교 설정이 섞이지 않습니다(intern은 덮어쓴 tie_break, staff는 기본 `[]`). `examples/README.md`의 설명(식, 부문, 검사 명령)도 v2에 맞게 고치고 빌드 명령은 `build <event.yaml> --site /tmp/site --config /tmp/example-config.json`으로 바꿉니다(사이트 폴더 밖에 `_config.json`).

---

## 15. 결정 기록, SPEC 문제, 열린 질문

### 15.1 결정 (SPEC이 정하지 않아 이 문서가 정한 것)

| # | 결정 | 장 |
| --- | --- | --- |
| D1 | rules 번들(백엔드·사이트)과 engine 번들(parity) 두 개. rules 번들에 실효 루브릭(`stageSettings`), 일정(`trackWindows`), 시각(`isoToMs`), `_config` 모양 확인(`readConfigShape`)을 둠. Rules.gs는 자기 예산으로 재고 Apps Script core 1,000줄에 넣지 않음 | 1.2, 12 |
| D2 | 모든 JSON 모양은 snake_case 하나, v1 camelCase runtime 모양·어댑터 폐지 | 0.1 |
| D3 | 금지 이름 = `__`로 시작하는 마디, constructor, prototype. 이름 100자 | 2.2 |
| D4 | 깊이 한도는 AST 깊이와 파서 중첩(괄호 포함) 모두 32 | 2.3 |
| D5 | `^`는 `r = 1`부터 왼쪽으로 e번 곱함, `0^0 = 1` | 2.6 |
| D6 | 수치 fault는 연산마다, 경고는 `(code, AST path)`로 중복 제거, 유한하지 않은 변수는 NONFINITE, 빠진 변수는 E_VAR_MISSING | 2.6 |
| D7 | roundHalfAway: `toPrecision(15)` 정리 → 십진 이동 → `Math.round`, 절댓값 1e15 이상은 그대로, `-0` → 0 | 2.7 |
| D8 | `clamp(x, lo, hi) = min(max(x, lo), hi)` | 2.6 |
| D9 | 이름 제안은 OSA 거리, 문턱 `max(1, ⌊len/3⌋)`, 동률은 목록 순서 | 2.9 |
| D10 | lint 범위 분석 규칙(구간 + nz), RANGE 상한 `max(max_total, 100)`. `judge`·`crit.*`(앞 단계 포함)의 범위는 미채점 팀의 0을 포함하고 `team_count`는 0부터 | 2.10, 3.5 |
| D11 | 추가 lint BONUS_UNUSED, ALWAYS_DIV0 | 2.10 |
| D12 | 시뮬레이션 합성 값(J, T = 5, V = 10, 수준 min·mid·max) | 2.11 |
| D13 | 단계 변수에 `<s>.judges`, `<s>.max_total`, `<s>.critmax.<key>` 추가 | 3.1 |
| D14 | 게이트는 최상위 리프만, `crit` 변수 없음 | 4.1 |
| D15 | `scale_normalize`는 루브릭 속성(축약형은 `scoring.scale_normalize`) | 4.1 |
| D16 | 척도 기본 min 0, step 0.01; `0 ≤ min < max ≤ 1e6`; weight `(0, 1000]`; 소수 6자리 | 4.1 |
| D17 | 원점수 행은 `seq`가 가장 큰 행이 이김(배열·시트 순서와 무관, 겹친 seq는 E_INPUT), `value: null`은 지움, 기권은 `criterion: "@abstain"`, 마지막 행을 남긴 뒤에 검사 | 4.3 |
| D18 | require_complete 거짓이면 빈 점수 리프는 min | 4.4 |
| D19 | 범위 밖·단위 밖 행은 잘라 맞추지 않고 빼고 경고 | 4.3 |
| D20 | 정규화 단위는 (단계, 실효 루브릭), 목표 μ·σ는 그 단위 전체(모집단), minmax 정의, fallback은 평균 이동 | 4.6 |
| D21 | majority 게이트는 `yes > no`, 동수는 탈락 + GATE_TIE, 판정한 팀의 표 없는 게이트는 탈락 + GATE_NO_VOTES. `gate_rule`의 기본 majority와 V17의 "게이트 없는 gate_rule" 경고는 그 단계가 쓰는 루브릭(기본 + 덮어쓰기) 전체를 봄 | 4.5, 4.1, 10.2 |
| D22 | 여러 게이트는 기준마다 판정해 모두 통과, `yes`·`no`는 합 | 4.5 |
| D23 | 진출 경계 동점은 모두 진출, top_percent는 내림·최소 1, 후보는 게이트 통과·채점된 팀, 규칙이 없으면 후보 전부 | 4.8 |
| D24 | 단계 점수는 `judge + bonus` 고정(단계 식 없음), 비교 자릿수는 `final.precision` | 4.4 |
| D25 | `final.stage`는 마지막 단계 | 4.1 |
| D26 | 덮어쓰기 유지: 단계(루브릭·집계·완료 조건), 최종(식·tie_break·자릿수), 뒤가 이김, 단계 쪽 원본은 `stageSettings` | 4.1, 4.12 |
| D27 | tie_break 기본 `[]` | 4.1 |
| D28 | rank_groups는 `[]`, `[track]`, `[track, division]`; 결과 표·득표 통계용이고 상은 자기 scope pool에서 순위를 다시 매김 | 6.1 |
| D29 | 최종 단계 미채점 팀은 순위·순위형 상에서 빠짐 | 4.9 |
| D30 | 같은 등수의 출력은 team id 순서 | 6.2 |
| D31 | manual 동점 결정은 상 경계에서만 필요, `tie_order`는 pool의 동점 묶음 전체, 묶음이 바뀌면 stale | 6.3 |
| D32 | share는 뒤 상의 수를 줄이지 않음 | 6.3 |
| D33 | `place`는 표시용, 같은 사다리의 상은 목록 순서로 팀을 소비, sponsor·special의 pool은 전체이고 기본으로 사다리를 이루지 않음 | 6.4 |
| D34 | vote 상은 득표 0인 팀을 후보로 보지 않음 | 6.6 |
| D35 | 결정 종류 다섯(tie_order, manual_award, vacate, advance, exclude), reason 필수 | 6.3 |
| D36 | 수동 상은 max_per_team·exclusive 위반만 적용하고 경고, 그 밖의 위반은 D81 | 6.6 |
| D37 | 트랙 상금표 변환의 id(`<track>[_<division>]_p<n>`), 부문 펼치기, 축약형 상이 먼저 | 6.7 |
| D38 | 상 자격 필터 `eligible { when, team_rule }` | 6.4 |
| D39 | `domain_in`·`email_domains`는 라벨 경계 접미사 일치, `hosted_domains`는 정확히 일치 | 7.1, 7.9 |
| D40 | eq·ne·in·nin이 boolean 값을 받음(글자로 비교) | 7.1 |
| D41 | 조건 한도: 깊이 16, 노드 100, 목록 200, 문자열 200자 | 7.1 |
| D42 | 빈 팀은 어떤 정량자로도 참이 아님 | 7.4 |
| D43 | ratio는 백만분율 정수 비교 | 7.4 |
| D44 | pick.by는 single(보기 순서)·number·date, 동률 전원 충족, 값 없는 사람 제외, 아무도 없으면 실패 | 7.4 |
| D45 | `unit: organization`은 team처럼 정량자 적용 | 7.4 |
| D46 | `division_mode` 기본 auto | 7.5 |
| D47 | 덮어쓰기 사유는 판정 결과와 공개 근거에 넣지 않음 | 7.5 |
| D48 | built-in 동의 `privacy`(version = `p1:` + privacy 일곱 칸의 해시)와 `age_14_plus`를 늘 넣음 | 7.9 |
| D49 | 질문 key 규칙(문자·숫자·_·공백 40자, 특별 이름·verified·점·금지 이름 금지), format 프리셋 정의, 형식별 기본 max_length, number 질문의 min·max·step은 소수 6자리 이하(step ≥ 0.000001) | 7.8 |
| D50 | show_if는 앞선 질문과 email_domain·hosted_domain만 | 7.8 |
| D51 | preset은 `@1` 그대로(배포된 적 없음), 내용은 ASCII key + Localized label, standard-2track의 트랙은 SPEC 6.2와 같은 `hack`·`impl` | 8.8 |
| D52 | 축약형 판정·변환은 병합 뒤 한 번, 축약형 루브릭·단계 키가 단계형과 섞이면 SCHEMA 오류(최종 키는 층마다 `final.*`로 옮기므로 섞여도 됨) | 4.2 |
| D53 | v1 축약형 키(judge_aggregate, input_step, components, popular_normalize)는 받되 DEPRECATED | 4.2 |
| D54 | deprecated alias 표(site.accent/logo/contact, event.locale, retention_days, submit.team_max_gb/kinds, fields[].max, `tracks.<id>.id`, scoring.judge_aggregate·input_step, add-on 이름)는 층마다 병합 전에 옮김. 1차 구현은 배포되지 않아 SPEC REL-3이 걸리지 않지만 저장소의 예제와 문서가 쓴 이름이라 DEPRECATED 경고와 함께 0.3.x 동안 받음. 표 밖의 1차 키는 SCHEMA | 8.6, 14 |
| D55 | 투표 창은 `addons.popular_vote.window`(공통) + `tracks.<id>.vote`(트랙별 덮어쓰기). V6은 공통 창을 함께 쓰는 트랙끼리 비교하지 않고 order와 다른 순서는 경고 | 8.3, 10.2 |
| D56 | `event.timezone`이 없으면 UTC + V1 info | 8.3 |
| D57 | `team_size` 기본 `{1, 10}`, individual은 `{1, 1}` 고정 | 8.3 |
| D58 | V22: 로컬 이미지 키 목록, 값을 쓴 층 기준 상대 경로, 10진 단위, `data:`는 디코딩한 크기 | 10.3 |
| D59 | V21 판별 규칙(키워드·마스크), 다른 고유식별정보는 경고 | 10.3 |
| D60 | V23은 event.json 전체(문자열 값과 맵 키), 예외는 org.contact·privacy.contact | 10.3 |
| D61 | V20 지문은 `fp1:` 버전을 붙인 구조 해시, 넣는 칸은 문서가 나열한 것뿐(범위는 D101), 빌드가 `_config.stage_fingerprints`에 미리 계산하고 백엔드는 단계를 열 때 복사만 함, 버전이 다르면 잠글 때의 설정으로 다시 비교하거나 경고 | 10.3, 11.2 |
| D62 | `config_hash`는 정규형 전체 해시(revision 제외)이고 `_config`에만 둠, `event.json`은 `public_hash`만, CLI revision 기본 0 | 11.4 |
| D63 | event.json에는 수식 원문만, AST는 `_config`에만 | 2.4, 11.3 |
| D64 | 크기 예산은 코드줄, 메시지·타입·문장 틀은 예산 밖이되 코드가 없어야 함, 보조 도구·신청서 검사 예산 | 12 |
| D65 | add-on 상태는 SPEC 2.4 그대로, beta는 켤 수 있고 info | 9.1 |
| D66 | 제출 프리셋 질문 정의, `submit.max_opt_ins`(사다리는 하나로 셈), `allowed_hosts`, `extra_fields` | 8.3 |
| D67 | `privacy.items`는 수집하는 key(질문·증빙·부문 추가 질문·로그인 email)를 모두 담아야 하고(V7) 그 밖의 문자열은 설명용 | 8.3, 10.2 |
| D68 | 결과 경고·막는 문제 코드 목록, 막는 문제 코드와 상·결정 상태의 대응(pending_upstream은 따로 올리지 않음) | 6.8 |
| D69 | v1 덮어쓰기의 popular_normalize는 오류 | 4.2 |
| D70 | kr-contest preset은 정규형 점수와 `scoring.criteria: null` | 8.8 |
| D71 | rules 번들의 `selfTest()` | 1.2 |
| D72 | V8에 Slack, AWS, Google refresh token 패턴 추가 | 10.2 |
| D73 | pool의 비교 설정: 덮는 장소(장소 목록 중)의 tie_break·precision이 모두 같으면 그것, 다르면 기본 final.tie_break·precision(TIE_BREAK_MIXED). tie_break가 같은지는 runtime의 `sameAst`로 봄(`hashOf`는 Node 전용). formula 상은 늘 기본 precision | 6.1 |
| D74 | 결정의 대상 키와 충돌 규칙(같은 내용은 하나, 다른 내용은 모두 stale + DECISION_CONFLICT 막음), stale 사유 코드 표(`StaleReason`), 결정·경고의 출력 정렬 | 6.3, 6.8 |
| D75 | pool 키마다 순위는 하나(결과 표와 상이 공유), opt_in·eligible은 순위를 매긴 뒤 상의 후보에서만 거름 | 6.1, 6.6 |
| D76 | 상태 우선순위 EXCLUDED > GATE_FAILED > UNSCORED > DIVISION_MISSING, 아무도 보지 않은 팀은 게이트를 판정하지 않고 UNSCORED | 4.5 |
| D77 | 점수 집계 대상은 점수 리프를 채운 심사위원(require_complete면 모든 리프), 게이트 표는 그 게이트를 채운 심사위원으로 따로. 점수 리프가 없는 루브릭은 require_complete와 관계없이 모든 게이트를 채운 심사위원이 집계 대상 | 4.4 |
| D78 | 부문이 빠진 팀은 막음(DIVISION_MISSING), 부문을 쓰는 순위·진출 묶음에서 빼고 `<track>`·`*` 상 후보로만 둠 | 6.1 |
| D79 | 상 사다리(`ladder`): 기본은 rank·vote이고 opt_in·eligible이 없는 overall·트랙·부문 상만 `<method>:<pool>`, 직접 적어 묶을 수 있음, opt_in 사다리는 사다리 단위 지원 | 6.4 |
| D80 | 보류된 상의 뒤 상은 같은 사다리이거나 결과가 정해지지 않은 팀이 후보이고 상한·배타가 걸리면 `pending_upstream`. pending_tie 상의 경계 앞 수상 팀은 `held`에 더함 | 6.6 |
| D81 | manual_award 검사(count 이하, pool 안, 게이트 탈락·제외 아님, opt_in·eligible 충족). 어기면 결정 전체가 stale | 6.6 |
| D82 | 정규화 결과를 루브릭의 최저·최고 총점으로 자름(NORMALIZE_CLAMPED) | 4.6 |
| D83 | 덮어쓰기의 `when`은 적은 키만 두고 `division` 조건은 부문이 null인 팀에 맞지 않음 | 4.1, 11.1 |
| D84 | 참가자·심사위원용 결과는 코드와 인자만, 문장은 core의 `rules.<lang>.json` 틀로 사이트 i18n과 MCP가 만듦 | 0.1, 7.7 |
| D85 | 신청서 입력 상한과 형식별 정리 표, 검사 순서(필수 → 타입 → 정리 전 길이 상한 → 정리 → 필수 → 길이 → 형식), team_size.max·팀원 수 50 이하 | 7.10, 7.4, 8.3 |
| D86 | 키가 되는 id·key의 금지 이름(prototype 이름), 팀·사람 id 규칙, 객체 키 다루기(hasOwn, Map, 배열 출력) | 0.1, 0.2 |
| D87 | `Iso`는 밀리초 세 자리까지, 정규형은 `YYYY-MM-DDTHH:mm:ss±HH:mm`, 시각 비교는 `isoToMs` | 0.2 |
| D88 | 팀별 제출 마감 연장 `schedule.extensions`(비공개, 사유는 `_log`), 실효 마감·창은 `trackWindows` | 8.3, 10.2 |
| D89 | `site.rules`, `site.code_of_conduct`, `site.policy_links`, 링크·이미지 칸의 scheme 규칙 | 8.3 |
| D90 | 잠금 해제 기록의 `scores: keep \| rescore`, rescore는 단계 epoch를 올리고 옛 행을 집계에서 뺌. 해제는 한 번 쓰는 허가라 그 단계의 지문이 바뀐 revision이 처음 적용되면 잠금 기록을 그 지문으로 바꾸고 해제 기록을 닫음 | 4.3, 10.1 |
| D91 | CLI `build --site`(event.json만)와 `--config`(사이트 폴더 밖), `plan`(JSON Patch), `export --dev`(층마다 `RawLayer.ref`·`extends`로 extends를 다시 씀) | 11.5, 8.4 |
| D92 | 층 파일 스키마 `layerSchema`와 `configJsonSchema()`(`hackathon://schema/event`) | 8.9 |
| D93 | 공개 결과 `PublicResults`(winners·ranks·scores, 허용 목록), `_results`에 스냅샷과 함께 저장, 운영자 id 규칙 | 6.10, 6.3 |
| D94 | `loadConfigTab`: 식 원문을 다시 컴파일해 AST와 대조, config_hash 대조 | 11.2 |
| D95 | V8은 메모리 층·병합된 값·느슨한 섹션의 키 이름도 보고 buildConfigTab이 결과를 다시 훑음(비밀). buildEventJson도 결과를 다시 훑음(비밀과 이메일, 공개 문의처 제외) | 10.2, 11.2, 11.3 |
| D96 | 부문 기록: `freezeDivision(input, …)`, 기록에 ok·팀원 id, 닫힌 부문의 덮어쓰기는 던지지 않음, 확인 사유 넷, 최신 기록이 이김 | 7.5, 7.6 |
| D97 | canonical은 객체를 다시 만들지 않는 직접 직렬화(정수 모양 키도 사전순) | 11.4 |
| D98 | v1 overrides는 장소마다 v1 누적 결과를 계산한 뒤 루브릭과 덮어쓰기로 옮김. 부문 장소는 기본값이 아니라 그 트랙 항목을 덮은 기준값과 비교 | 4.2 |
| D99 | add-on 레지스트리에 `since`(그 add-on이 더하는 화면·시트 탭·도구가 모두 들어간 첫 키트 버전, 아직이면 `null`)를 둠. 상태(D65)와 V14는 SPEC 2.4 그대로이고 core `check`는 since를 보지 않음. `addonCatalog`·`addonConfirmation`이 `shipped`·`since`를 싣고, shipped가 아닌 add-on을 켜는 계획과 그런 `_config`의 배포는 MCP `event_plan`·`backend_plan`이 오류로 거절 | 9.1, 9.4 |
| D100 | 0.1.0 `event.yaml` 변환(CFG-8)은 core Node 함수 `migrateV010`과 CLI `simple-hackathon migrate <file> --from 0.1.0 --out <dir>`. v2에 자리가 없던 키: `write_delay_ms`·`tracks.*.template` → `addons.github_ops.write_delay_ms`·`templates`, `schedule.freeze_enabled`·`tracks.*.freeze_enabled`(늦은 push 점검 on/off) → `addons.integrity_check.late_push`, `schedule.prep_enabled`·`prep_from` → `addons.integrity_check.prep`, `schedule.start_at`·`freeze_at`·`tracks.*.freeze_at` → `schedule.main.start`·`main.submit_deadline`·`tracks.*.submit_deadline`. `roster`는 옮기지 않음(D109). github_ops·integrity_check는 enabled: true로 적고(apps_review는 원문에 app_policy가 있을 때만) 첫 계획의 확정 섹션에서 승인 | 11.6, 9.3 |
| D101 | V20 잠금 범위 = 그 단계의 점수·순위를 계산하는 규칙 전부. D61 지문에 마지막이 아닌 단계의 `advance`, 최종 단계의 `rank_groups`·`unresolved_tie`, `method: formula` 상의 식, `use: formula_input`일 때 popular_vote의 `normalize`·`full_at_multiple`을 더함. 이름·설명·anchors 문구, 심사 배정(`judges_per_project`, `assignment`), 식형 상의 식 밖의 상 칸과 `prize_policy`는 넣지 않음. 해제는 사유 + `keep`/`rescore`이고 원점수를 그대로 쓰는 변경에는 judging_plan이 `keep`을 권함. fp1은 배포 전이라 버전을 올리지 않음 | 10.3 |
| D102 | 질문 key를 ASCII로 제한하지 않음(D49 유지: 시트 열 이름이 key라 운영진이 읽는 이름을 쓸 수 있게). Node가 층마다 질문 key(7.8 모양을 쓰는 모든 목록)와 그 key를 가리키는 문자열(조건 `field`, `pick.by`, `show_if`의 field, `privacy.items`)을 NFC로 바꿈. 같은 답 묶음에서 NFKC로 바꾼 뒤 소문자로 같아지는 두 질문 key는 V11 오류. preset key는 ASCII(D51) | 7.8, 8.6, 10.2 |
| D103 | V22 단위는 10진으로 고정(1 MB = 1,000,000 B 초과 오류, 300 KB = 300,000 B 초과 경고, 메시지의 KB도 1,000 B). 이미지 칸은 `IMAGE_KEYS` 표 하나에서 정하고 scheme 검사(8.3)·`assets` 기록(8.4)·V22가 함께 씀. 사이트(M3)가 이미지 칸을 더하면 이 표에 더하고 schema.test가 스키마의 이미지 칸과 표가 같은지 확인. `https://` 이미지는 크기를 재지 않고 V22 경고(REMOTE_IMAGE) | 8.3, 10.3, 13.1 |
| D104 | 계획 적용 `apply`(MODE-4, P2)는 M2 범위 밖. 적용은 운영자 키(백엔드 HMAC)·GitHub App 키를 쓰므로 같은 npm 패키지의 MCP 쪽 명령 `simple-hackathon apply <plan.json>`이 `plan_apply`와 같은 엔진으로 함. core는 `planHash`와 `PlanApproval` 모양만 둠. 사람 승인은 GitHub Actions environment의 required reviewers로 강제함(운영자 키는 그 environment의 secret). apply는 run의 승인 기록·`plan_hash`·`base`(revision, config_hash)를 확인해 `_log`에 남기며 하나라도 없거나 다르면 거절 | 11.5 |
| D105 | `site.theme.font: web \| system`(기본 web = 기본 테마의 웹 글꼴). core의 `site.theme`은 SPEC SITE-11의 닫힌 목록 가운데 강조색, 로고, 대표 이미지, 글꼴만 받고(섹션 순서·표시는 `site.sections`) SPEC 4.2의 "테마 토큰"은 core 설정 키로 두지 않음 | 8.3, 11.1 |
| D106 | runtime-guard는 코드 토큰 검사(주석·리터럴 제외)와 대회 값 검사(리터럴 안까지)를 나눔. 대회 값 검사의 예외는 이름으로 정한 데이터 파일 `runtime/messages.ts`(한글)와 `runtime/selftest-vectors.ts`(시각) 둘뿐이고 번들에서는 두 파일의 문자열과 같은 리터럴만 예외. selfTest 벡터는 `selftest-vectors.ts`로 옮김 | 13.1, 1.2 |
| D107 | rules 번들의 `validateSubmission(submit, prizes, input)`: 제출 질문은 신청서와 같은 정리·검사, `allowed_hosts`는 라벨 경계 접미사(HOST), opt-in은 `opt_in: true`인 상만(OPT_IN)이고 사다리를 하나로 세어 `max_opt_ins` 이하(OPT_IN_LIMIT), 설정 밖 답은 버림. 커밋 SHA는 basic 양식의 `repo_sha`(alnum 7~40자, repo와 같은 필수 여부)로 받고 마감 태그와는 MCP가 대조 | 7.11, 8.3 |
| D108 | module을 끈 효과: apply는 V11의 name 역할 검사를 건너뜀, submit은 `submit.fields`가 []이고 opt_in 상은 V19 오류, judge는 V3의 빈 루브릭·V17의 점수 기준 검사를 건너뛰고 rank·formula 상은 V19 오류이며 computeResults는 UNSCORED 경고 없이 manual 상만 배분 | 8.10 |
| D109 | 최상위 `roster`(0.1.0의 명단 출처)는 폐지하고 SCHEMA로 안내. `github`·`repo`·`reviewers`·`app_policy`는 core가 안쪽을 검사하지 않고 통과(github의 org, 객체·문자열인지만, reviewers.permission은 locked), 안쪽은 쓰는 MCP가 검사 | 8.1, 11.1 |
| D110 | V5에 `max_per_team`이 있을 때 "`*`와 트랙 pool마다, 그 안을 scope로 하는 모든 상(방식·사다리 무관)의 count 합 > 팀 수 × max_per_team" 경고를 더함. 사다리별 오류는 그대로 | 10.2 |
| D111 | 개인 자격 덮어쓰기: `ApplicationInput.eligibility_override { reason }`, 자격 규칙 전체에 걸리고 운영진이 지울 때까지 유지, 결과는 `eligibility.overridden: true`이고 계산한 ok·failed는 그대로, 사유는 결과에 넣지 않음 | 7.9, 7.10 |
| D112 | 부문 추가 질문(`divisions.*.extra_fields`)은 신청서에서 그 부문의 개인 조건 `when`이 참인 사람에게 묻고(`intake.division_fields`), 같은 규칙으로 `validateApplication`이 검사. key는 신청 질문과 같은 답 묶음에서 유일, 부문 판정 조건은 추가 질문을 읽을 수 없음(V15) | 7.9, 7.10, 10.2 |
| D113 | `intake.capacity`(받을 신청 수, 사람 단위, 기본 null). 차면 백엔드가 신청을 닫고, rsvp_waitlist가 켜져 있으면 대기자로 받음. 공개 값 | 7.9 |
| D114 | 상의 `amount`는 수상 팀 하나당 금액. 상금 합계는 `Σ amount × count`(계획 기준) | 6.4 |
| D115 | 사이트에는 minify한 `dist/rules.min.js`를 싣고 gzip 10,000 B 이하로 막음. 사이트 core JS 줄 수 예산에는 넣지 않고 첫 화면 크기 예산에는 넣음 | 1.2, 12 |
| D116 | 장소 목록(부문 트랙은 여는 부문마다, 부문 없는 트랙은 `(track, null)`)을 V4·빌드·loadConfigTab·pool 비교 설정이 함께 씀. 부문이 정해지지 않은 팀의 식이 그 팀의 변수로 검사를 통과하지 못하면 던지지 않고 FORMULA_UNAVAILABLE로 pool에서 뺌 | 0.2, 6.1, 6.8 |
| D117 | check는 `normalizeShape`(수식 칸은 원문만, 참조 오류에서 던지지 않음)를 한 번 만들어 씀. V17·V15의 참조 오류가 있으면 V4·V18·V20 대신 CHECK_SKIPPED info, V4 오류가 있으면 V20을 건너뜀 | 10.1, 11.1 |
| D118 | 정의 정리: `intake.consents[].required` 기본 true, 트랙 순서는 `order` 오름차순(같으면·없으면 id 순서, order 없는 트랙은 뒤), `tracks.*.aliases`는 시트·회의록에서 트랙을 가리키는 다른 이름(core는 문자열 목록인지만 봄), `RawScoreRow.epoch`는 선택(없으면 0), 식 칸 경로의 이름은 `slot` 하나 | 7.9, 8.3, 4.3, 6.8 |
| D119 | `estimateJudges`는 정수 입력(분)만 받고 정수로 올림 | 4.1 |

### 15.2 SPEC과 맞지 않거나 모호한 곳

마지막 칸은 이 문서의 처리와 처리 상태입니다. 상태는 넷 중 하나입니다. **SPEC 반영(2026-11-18)** 은 그날 SPEC을 이 문서의 처리대로 고쳤다는 뜻입니다. **소유자 질문 SPEC 19.4 Qn** 은 소유자의 답을 기다리는 상태이며 그때까지는 이 문서의 처리를 기준으로 합니다. **M3 이후** 는 SPEC 문구를 맞추거나 남은 부분을 정하는 일을 그 기능을 만드는 M3 이후의 마일스톤으로 미뤘다는 뜻입니다. 이 문서의 처리는 SPEC이 정한 것을 바꾸지 않고 더하거나 좁혀 읽은 것입니다. **문제 아님** 은 다시 보니 SPEC과 충돌하지 않는 경우이며 이유를 함께 적었습니다.

| SPEC | 문제 | 이 문서의 처리와 상태 |
| --- | --- | --- |
| 7.3 lint, 6.4 V18 | V18이 권하는 공통 척도식 `judge / max_total * 100`은 max_total < 100이면 늘 "0~max_total 밖" 경고에 걸립니다. | RANGE 상한을 `max(max_total, 100)`으로(D10). **SPEC 반영(2026-11-18)**: 7.3의 경고 문장 |
| 7.2 3단계, 7.6 #8 | `scale_normalize`는 이름만 있고 어느 블록(final, 단계, 루브릭)에 두는지 없습니다. 리프 점수 정의를 바꾸므로 심사 화면의 총점 표시에도 필요하고 final에 두면 같은 루브릭을 쓰는 단계끼리 만점이 달라집니다. | 루브릭 속성(D15). **SPEC 반영(2026-11-18)**: 7.2 정의 3단계 |
| 7.2 7단계 | zscore의 "μ + z × σ"의 μ·σ가 정의되지 않았고 minmax는 이름만 있습니다. 되돌린 값이 척도 밖으로 나갈 때도 없습니다. | D20, 자르기(D82). **SPEC 반영(2026-11-18)**: 7.2 정의 7단계 |
| 7.2 2단계 | `majority`의 짝수 동수, 게이트가 여러 개일 때, 게이트만 채운 심사위원이 없습니다. | D21, D22, D77. **SPEC 반영(2026-11-18)**: 7.2 정의 2단계 |
| 7.2 잠금, JDG-6 | "다시 채점"을 고른 뒤 옛 점수를 어떻게 빼는지 데이터 계약이 없습니다. | epoch(D90). **SPEC 반영(2026-11-18)**: 7.2 잠금 문단에 유지·다시 채점의 효과 |
| 7.4 "끝까지 동점이 남으면" | 모든 동점에 결정이 필요한지 상 경계만인지 모호합니다. | 상 경계만(D31). **SPEC 반영(2026-11-18)**: 7.4 동점의 `manual` |
| 7.4 scope | `sponsor`, `special`의 의미(pool)가 없고 전체 pool의 상끼리 "위에서부터 채우기"를 그대로 하면 서로 다른 스폰서 상이 팀을 소비합니다. | 전체 pool, 기본은 사다리 없음(D33, D79). **SPEC 반영(2026-11-18)**: 7.4 상 문단과 사다리 문단(기본값 자체는 SPEC 19.4 Q15의 ⑤에서 소유자가 함께 확인) |
| 7.4 rank_groups | 상의 scope와 rank_groups의 관계, 장소마다 tie_break가 다른 팀이 한 묶음에 들 때의 비교가 없습니다. | D28, D73. **SPEC 반영(2026-11-18)**: 7.4 순위 |
| 13.4 | "Apps Script core 1,000코드줄"에 core의 runtime 번들(5.5의 `Rules.gs`)이 드는지 모호합니다. | 넣지 않고 자기 예산(D1). **SPEC 반영(2026-11-18)**: 13.4 표에 `Rules.gs` 650 코드줄 |
| 13.4 | "수식 엔진 400줄"에 메시지 표와 lint·시뮬레이션(7.3 "검증과 시뮬레이션")이 드는지 모호합니다. | parser·AST·validate·evaluate만 400, 보조 도구는 450(D64). **SPEC 반영(2026-11-18)**: 13.4 표 |
| 15.1 "만 14세 미만 … 검증: V21, 연령 검사" | V21은 주민등록번호 규칙이고 연령 검사를 보장하는 설정 장치가 없습니다(6.2 예시의 자격 규칙은 운영진이 빼먹을 수 있음). | built-in 동의 `age_14_plus`(D48). **SPEC 반영(2026-11-18)**: 15.1 표 |
| 6.4 V1 | 사슬이 단일 일정이라 "서면 예선 → 본선"(2.1 한국형, 7.2)의 예선 제출 마감(본선 시작보다 앞섬)을 표현할 수 없습니다. | 단계 일정은 설정에 두지 않고 운영진의 단계 열기·닫기로(15.3 #1). **소유자 질문 SPEC 19.4 Q13** |
| 6.1 #7, SUB-2, BE-9 | 마감 연장을 설정 변경으로 한다고 했지만 팀별 연장의 설정 키가 없습니다. | `schedule.extensions`(D88). **SPEC 반영(2026-11-18)**: 6.1 #7 |
| 5.6 | "이름 있는 묶음(트랙, 부문, 심사 기준, 질문)은 key 단위로 합칩니다. add, remove, update를 쓸 수 있습니다."라고 하지만 트랙·부문은 맵이라 `null`로 지우고 add/remove/update는 key 목록(기준, 질문 등)에만 씁니다. 병합 규칙의 위치도 "core-engines.md 6장"이라고 적었지만 v2에서는 8.5입니다. | 8.5에 명시. **SPEC 반영(2026-11-18)**: 5.6 요약(맵과 key 목록의 두 방식, 8.5 참조) |
| 5.6 "값은 아래 층이 위 층을 덮어씁니다", 7.2 | 축약형 기준이 있는 위 층(preset)을 extends하는 아래 층에 단계형 `scoring`을 적으면 D52가 SCHEMA 오류를 냅니다. 6.2의 profile을 extends하는 event에 7.2의 블록을 그대로 적으려면 `scoring.criteria: null`을 더해야 합니다(13.2의 spec-7.2 fixture). | D52 그대로. 섞임 오류의 fix가 지우는 방법(`scoring.criteria: null`)을 알려 줍니다. **문제 아님**: 5.6은 같은 키의 값을 덮는 규칙이고 두 형식을 한 `scoring`에 섞을 수 없다는 것은 다른 규칙입니다. 7.2의 블록은 위 층 없이 쓰는 예시입니다 |
| 6.4 V3 | "영문 소문자·숫자·_"는 숫자로 시작하는 key를 허용하지만 7.3 IDENT는 숫자로 시작할 수 없습니다. | IDENT 규칙(V3). **SPEC 반영(2026-11-18)**: 6.4 V3 |
| 7.3 변수 표 | 앞 단계 값을 공통 척도로 옮길 `<stage>.max_total`이 없습니다. | D13. **SPEC 반영(2026-11-18)**: 7.3 변수 표 |
| 6.2 예시와 V6 | 예시는 `addons.popular_vote.window` 하나, V6은 "트랙별 투표 창"입니다. 트랙마다 실효 창을 만들어 비교하면 예시가 겹침 오류가 됩니다. | 공통 창을 함께 쓰는 트랙끼리는 비교하지 않음(D55). **SPEC 반영(2026-11-18)**: 6.4 V6 |
| 6.2 예시의 `privacy.items` | `grade_rank`(질문이 아님)가 있고 받는 `phone`, `team_hint`, `student_id`, `grade`, `affiliation`, `enrollment`, `age_band`, 증빙 `enrollment_cert`가 없습니다. PRIV-2("수집 항목은 privacy.items에 있는 것뿐")를 V7이 확인하므로 이 예시는 V7 오류가 8개 났습니다. | **SPEC 반영(2026-11-18)**: 6.2 예시의 items를 받는 key 전부로 고침. 그래서 `spec-examples.test.ts`의 spec-6.2 기대를 V7 오류 0개로 바꿈(13.2) |
| 6.2 예시의 `intake.eligibility` | event의 `eligibility`는 일반 목록이라 preset(university-students)의 "재학생만" 규칙을 통째로 바꿉니다. 둘 다 두려면 `{ append: [...] }`를 써야 합니다. | 병합 규칙 그대로(8.5). **SPEC 반영(2026-11-18)**: 6.2 예시에 주석으로 의도와 `append`를 밝힘(preset에 "재학생만" 규칙을 기본으로 둘지는 SPEC 19.4 Q15의 ⑨에서 따로 물음) |
| 6.2 예시의 자격 `{ field: age_band, ne: under14 }` | `ne`는 답이 없어도 참이라(7.1) 질문이 필수가 아니면 막지 못합니다. | **문제 아님**: 예시의 `age_band` 질문은 `required: true`라 답 없이 신청할 수 없고(7.10의 REQUIRED) built-in 동의 `age_14_plus`(D48)가 한 번 더 막습니다 |
| 2.1 "스폰서 상 선택 상한" | opt-in 상한의 설정 키가 없습니다(`max_per_team`은 수상 수 상한). | `submit.max_opt_ins`(D66), 검사는 `validateSubmission`(D107). **SPEC 반영(2026-11-18)**: 7.4 지원 상한 문단 |
| 11.2 `/rules/`, SITE-16 | 규칙·행동강령 문구와 주최 측 정책 링크를 둘 설정 키가 6장에 없습니다. | `site.rules`, `site.code_of_conduct`, `site.policy_links`(D89). **SPEC 반영(2026-11-18)**: 11.2 `/rules/` 행 |
| 12.1 `hackathon://schema/event`, CFG-1 | 공개할 스키마가 사람이 쓰는 층 파일의 것인지 해석된 설정의 것인지 없습니다. | 층 파일 스키마(D92). **SPEC 반영(2026-11-18)**: 12.1 resource 설명 |
| 5.2, BE-10, RES-6 | 백엔드가 공개 시각 뒤 `_results`를 내준다고 했는데 `_results`(확정 스냅샷)에는 결정 사유, 심사위원 id 같은 비공개 값이 있습니다. | `_results`에 공개 투영을 함께 저장하고 그것만 내줌(D93). **SPEC 반영(2026-11-18)**: BE-10과 5.2의 데이터 흐름(어느 칸까지 공개할지는 SPEC 19.4 Q14에서 따로 물음) |
| 14.7 APP-1·APP-2 | `github` 질문 형식과 `intake.identity.github`의 관계가 없습니다. | required면 github 질문 필수(V11). **SPEC 반영(2026-11-18)**: APP-2 |
| 6.3 | `event.json`에 수식 AST가 들어가는지 정하지 않았습니다(v1은 넣음). | 원문만(D63). **SPEC 반영(2026-11-18)**: 6.3 표의 event.json 행 |
| 7.2 | `require_complete`, `aggregate.trim`, 척도 step의 기본값이 없습니다. | true, 1, 0.01(v1 값, D16). **SPEC 반영(2026-11-18)**: 7.2 기본값 문단 |
| 1.6, 6.1 | 대회 시간대의 기본값이 없습니다. | UTC + info(D56). **SPEC 반영(2026-11-18)**: 6.1 #4 |
| 2.4 add-on 상태 | "stable 목표"인데 V14는 planned만 막아 백엔드·사이트 모듈이 아직 없는 add-on도 core는 켜게 둡니다. | SPEC 그대로(D65), 지금 버전에서 쓸 수 있는지는 `since`(D99). **SPEC 반영(2026-11-18)**: 2.4의 "상태 칸의 뜻" |
| 18.2, REL-2, CFG-8 | 0.1.0(MCP)의 `event.yaml` 키 중 v2에 자리가 없는 것(`write_delay_ms`, `tracks.*.template`, `tracks.*.freeze_enabled`, `schedule.freeze_enabled`, `schedule.prep_enabled`·`prep_from`)이 있습니다. | 11.6의 표(D100). **SPEC 반영(2026-11-18)**: CFG-8에 변환을 함께 내는 릴리스(0.3.0, REL-2)를 적고 17장의 M2 행에 0.1.0 설정 변환을 넣었습니다. 자리가 없던 키를 어디로 옮길지는 이 문서가 정합니다 |
| 7.5, 16 | Apps Script 번들의 parity를 요구하지만 점수는 MCP에서만 계산합니다. | parity 전용 engine 번들(D1). **문제 아님**: 점수 엔진도 같은 runtime 소스에서 ES2019로 빌드하므로, 빈 `vm` context의 engine 번들로 확인하면 SPEC 16의 parity가 성립합니다 |
| JDG-8 | `random_async` 배정이 있지만 배정은 데이터로만 다룹니다. | 데이터만 + `estimateJudges`(4.1, D119). **M3 이후**: 배정은 MCP `judging_plan`(M4)이 만듭니다 |
| 7.2 잠금, 15.1 "심사 단계가 열리면 기준이 잠긴다", 6.4 V20, JDG-6 | 잠금 대상이 루브릭·가중치·척도·식뿐이라, 채점이 시작된 뒤 집계 방식·정규화·진출 규칙·순위 묶음·동점 처리를 바꿔 결과를 바꿀 수 있습니다. 1차 지문은 식형 상의 식도 빠뜨렸습니다. | 점수·순위 계산 규칙을 모두 잠금(D61, D101). **M3 이후**: 백엔드의 단계 잠금을 만들 때 SPEC 7.2·15.1·V20·JDG-6의 "루브릭, 가중치, 척도, 식"을 이 범위로 넓힙니다 |
| 11.5 테마, SITE-11, 4.2, 1.5 | 소유자 결정(19.2)으로 `site.theme.font: system`이 생겼는데, 4.2는 개발자 모드에 "테마 토큰"을 두고 SITE-11은 설정할 수 있는 것을 닫힌 목록으로 정해 서로 다릅니다. 1.5와 4.2의 꾸미기 목록에는 글꼴이 없었습니다(2026-11-18에 SPEC에 더함). | core는 SITE-11의 닫힌 목록을 따르고 `site.theme.font`를 둠(D105). SPEC 1.5·4.2·11.5·SITE-11의 문구는 2026-11-18에 이 처리대로 맞춤(SITE-11·11.5에 개발자 모드의 문구 덮어쓰기 `site.strings`도 적음). **M3 이후**: 개발자 모드의 테마 토큰을 둘지는 사이트(M3)를 설계할 때 정합니다 |
| 1.6 #2, 2.4 "module로 켜고 끌 수는 있지만" | module을 켜고 끈다고만 하고 끄면 검사·생성물·계산이 어떻게 달라지는지 없습니다. | core에서 달라지는 것은 8.10(D108). **M3 이후**: 백엔드와 사이트가 끈 흐름의 화면과 요청을 닫는 방식 |
| 6.4 V5 | "상의 수가 그 범위의 팀 수를 넘지 않는다"를 그대로 읽으면, 한 팀이 상을 여러 개 받을 수 있는 v2 상 모델(`max_per_team` 기본 제한 없음)에서 잘못된 오류가 납니다. | 같은 사다리의 count 합은 오류, `max_per_team`이 있으면 전체 상 수 경고(D110). **문제 아님**: SPEC의 이유("팀이 5개인데 상을 7개 줄 수는 없습니다")는 같은 사다리 안이거나 팀당 상한이 있을 때만 성립하므로, 그 두 경우를 검사하면 SPEC의 뜻과 같습니다 |
| 6.4 V22, 11.5 | 원격(`https://`) 이미지를 허용하지만 core는 네트워크를 쓰지 않아 크기를 잴 수 없습니다. 1차 계약은 이런 이미지를 경고 없이 건너뛰었습니다. | 원격 이미지는 경고(REMOTE_IMAGE, D103). **M3 이후**: 게시할 때 MCP가 원격 이미지의 크기를 재서 막을지는 사이트 게시(M3)에서 정합니다 |
| 11.6, 13.4 | 사이트가 읽는 `kit/<버전>/rules.js`가 사이트 크기 예산(11.6)의 어느 줄에 드는지 없습니다. | minify한 사본, gzip 10,000 B, 첫 화면 예산에 넣음(D115). **M3 이후**: 11.6 표에 이 줄을 더합니다 |
| 7.4 상의 `amount`, DEC-4 | "표시용 금액"이 수상 팀 하나당인지 상 전체인지 없어서 상금 합계와 예산의 대조(DEC-4)가 달라집니다. | 수상 팀 하나당(D114). M2의 `decisions_plan`이 하는 상금 합계 대조(DEC-4)도 이 뜻으로 계산합니다. **M3 이후**: SPEC 7.4에는 결과 화면을 만드는 M4에서 "수상 팀 하나당"을 적습니다 |

### 15.3 열린 질문

소유자가 정해야 하는 질문만 남겼습니다. 질문의 배경, 선택지, 권장안은 SPEC 19.4에 있고 이 절에는 답에 따라 이 문서의 어디가 바뀌는지 적습니다. 2026-11-17판의 기술 질문은 결정으로 옮겼습니다: 지금 키트 버전에서 쓸 수 있는 add-on(`since`, D99), 0.1.0 설정 변환(D100), V20 잠금 범위(D101), 질문 key의 유니코드(D102), V22의 단위와 이미지 칸(D103), 계획 적용 `apply`(D104).

1. **서면 예선의 일정과 제출(SPEC 19.4 Q13).** 지금은 일정을 한 줄(V1 사슬)로 두고 단계는 운영진이 judging_plan으로 열고 닫습니다(15.2의 6.4 V1 행). 답에 따라 바뀔 곳: 8.3의 `schedule`과 `scoring.stages[]`(단계별 심사 기간이나 제출 회차), V1 사슬, `trackWindows`(8.3), 제출 양식과 `validateSubmission`(7.11).
2. **공개 결과의 범위(SPEC 19.4 Q14).** 모양은 6.10에 정했습니다. 답에 따라 바뀔 곳: 기본 `PublicLevel`과 운영진이 고르는 설정 키(예: `results.public_level`, 8.1·11.1), results_plan이 확정할 때 보여 줄 안내.
3. **기본값 확인(SPEC 19.4 Q15).** `division_mode: auto`(D46), 미채점 팀의 상 제외(D29), `unresolved_tie: manual`이 상 경계 동점에서 공개를 막는 것(D31), tie_break 기본 `[]`(D27), 스폰서·특별·opt-in 상의 사다리 기본값(D79, D33), 진출 경계 동점(D23), share 뒤 상의 수(D32), 공개를 막는 문제의 목록(D68, D78), university-students preset의 "재학생만" 기본 규칙(8.8). 답에 따라 그 결정과 해당 절을 고칩니다.
