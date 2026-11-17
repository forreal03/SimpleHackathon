# Core engines 설계 (`packages/core`)

| | |
| --- | --- |
| 상태 | 구현용 설계 v1 (spec v0.5의 7장 일부를 구체화한 문서) |
| 작성일 | 2026-11-17 |
| 범위 | 설정 상속·병합·검증, 점수 계산(가중합 기본 + 선택 수식), 부문(division) 조건, add-on 목록, `event.json` 생성, CLI |

이 문서는 `packages/core`를 구현하는 사람(사람이든 에이전트든)이 따르는 계약서입니다. spec이 "무엇을, 왜"라면 이 문서는 "정확히 어떻게 동작하는가"입니다. 여기 적힌 동작과 다르게 구현해야 할 이유가 생기면, 코드보다 이 문서를 먼저 고칩니다.

---

## 0. 원칙

1. **판정 로직은 한 곳에만 있다.** 점수 계산, 순위, 상 배분, 부문 판정, 수식 평가는 Node(설정 검증·빌드·MCP 미리보기)와 Google Apps Script(서버 판정) 양쪽에서 똑같이 돌아야 합니다. 그래서 이 로직은 `src/runtime/`에 두고, 같은 TypeScript 소스를 esbuild로 Apps Script용 단일 파일(`dist/runtime.gs.js`)로도 만듭니다. 두 결과가 같은지 parity test로 확인합니다.
2. **`src/runtime/`에는 플랫폼 의존이 없다.** `node:*` 모듈, `process`, `Buffer`, `fs`, zod, yaml을 import하지 않습니다. Apps Script V8 runtime(ES2019 수준)에서 그대로 돌아야 합니다.
3. **설정은 데이터다.** 사용자가 쓴 수식이나 조건은 코드로 실행되지 않습니다. 수식은 빌드할 때 AST(JSON)로 바꾸고, 서버는 허용된 노드만 해석합니다. `eval`, `new Function`, 동적 property 접근을 쓰지 않습니다.
4. **사용자에게 보이는 오류 메시지는 한국어**로, 코드 식별자와 주석은 영어로 씁니다.
5. **새 runtime dependency는 `yaml`과 `zod`뿐**입니다(MCP 서버와 같은 major). 빌드용으로 `esbuild`를 devDependency로 둡니다.

---

## 1. 패키지 구조

```
packages/core/
├── package.json        name "@simple-hackathon/core", private: true (배포 이름 확정 전 publish 금지)
│                       type "module", engines node >=22.13, bin { "simple-hackathon": "dist/cli.js" }
│                       scripts: build (tsc + node scripts/build-runtime.mjs), typecheck, test (vitest run)
├── tsconfig.json       packages/mcp 와 같은 compilerOptions (strict, NodeNext, ES2023)
├── scripts/
│   └── build-runtime.mjs   esbuild: src/runtime/index.ts → dist/runtime.gs.js
│                           (format iife, globalName "SHK", target es2019, 주석 머리말에 kit 버전)
├── src/
│   ├── index.ts            Node용 공개 API (아래 모듈 re-export)
│   ├── runtime/            ← 플랫폼 의존 없음. Apps Script 번들 대상
│   │   ├── index.ts        번들에 들어갈 export 목록
│   │   ├── formula/ast.ts      AST 타입, 허용 연산자·함수 목록, 한도
│   │   ├── formula/evaluate.ts AST 검증(validateAst) + 해석기(evaluateAst)
│   │   ├── scoring.ts      기준 트리, 심사위원 집계, component, 최종 점수
│   │   ├── ranking.ts      순위(동점 처리), tie_break, 상 배분
│   │   └── eligibility.ts  조건 언어 평가, 팀 부문 판정
│   ├── formula/parse.ts    tokenizer + Pratt parser → AST, compileFormula(변수 허용 목록 검사)
│   ├── config/
│   │   ├── schema.ts       zod 스키마 (event / profile / preset)
│   │   ├── presets/        bundled preset YAML
│   │   ├── load.ts         YAML 읽기 + extends 해석
│   │   ├── merge.ts        병합 규칙
│   │   ├── locked.ts       locked key 목록
│   │   └── check.ts        검증 규칙 → diagnostics
│   ├── addons/registry.ts  add-on 목록과 의존 관계
│   ├── build/event-json.ts 공개용 event.json 생성
│   └── cli.ts              simple-hackathon check / build
└── test/                   vitest
examples/                   (저장소 루트) 가짜 데이터 예제 두 개 — 8장
```

---

## 2. 수식 언어 (formula)

### 2.1 언제 쓰는가

최종 점수 계산은 기본이 **가중합**입니다(3장). 조직이 `scoring.formula`에 식을 적으면 그 식으로 최종 점수를 계산합니다. `scoring.tie_break`의 항목도 같은 언어로 적습니다.

### 2.2 문법

우선순위가 낮은 것부터 적었습니다.

```
expr    := or
or      := and ( "or" and )*
and     := not ( "and" not )*
not     := "not" not | cmp
cmp     := add ( ( "<" | "<=" | ">" | ">=" | "==" | "!=" ) add )?
add     := mul ( ( "+" | "-" ) mul )*
mul     := unary ( ( "*" | "/" ) unary )*
unary   := "-" unary | pow
pow     := primary ( "^" unary )?            # 오른쪽 결합: 2^3^2 = 2^(3^2)
primary := NUMBER | NAME | NAME "(" args? ")" | "(" expr ")"
args    := expr ( "," expr )*
NAME    := [A-Za-z_][A-Za-z0-9_]* ( "." [A-Za-z_][A-Za-z0-9_]* )?
NUMBER  := [0-9]+ ( "." [0-9]+ )?
```

공백은 무시합니다. `and`, `or`, `not`은 예약어라 변수 이름으로 쓸 수 없습니다.

### 2.3 의미

- 모든 값은 64비트 실수입니다. 비교와 논리 연산의 결과는 1 또는 0입니다.
- `and`, `or`는 short-circuit이고 결과는 1/0입니다. 0이 아닌 값은 참입니다.
- **0으로 나누면 0**입니다. 표가 한 장도 없는 트랙에서 평균 득표가 0이 되는 경우를 오류 없이 처리하려는 규칙입니다.
- `^`의 결과나 최종 결과가 유한하지 않으면(Infinity, NaN) 0으로 바꾸고 경고를 남깁니다.
- 함수:

| 함수 | 인자 수 | 동작 |
| --- | --- | --- |
| `min`, `max`, `sum`, `avg` | 1개 이상 | 인자들의 최솟값·최댓값·합·평균 |
| `abs` | 1 | 절댓값 |
| `sqrt` | 1 | 제곱근. 음수면 0 |
| `round` | 1~2 | 자릿수(0~6, 기본 0)에서 반올림. 0.5는 0에서 먼 쪽으로 |
| `floor`, `ceil` | 1 | 내림·올림 |
| `clamp` | 3 | `clamp(x, lo, hi)` |
| `if` | 3 | `if(c, a, b)`: c가 참이면 a, 아니면 b. 고르지 않은 쪽은 계산하지 않음 |

- 한도: 식 길이 500자, 노드 200개, 깊이 32, 숫자 리터럴 절댓값 1e9. 넘으면 파싱 오류입니다.

### 2.4 AST(JSON)

빌드 결과(`event.json`)에는 수식 문자열과 함께 AST가 들어가고, 서버는 AST만 해석합니다.

```json
{"k":"n","v":0.85}                                   // 숫자
{"k":"v","n":"crit.idea"}                            // 변수
{"k":"u","o":"-","a":<AST>}                          // 단항: "-" | "not"
{"k":"b","o":"*","a":<AST>,"b":<AST>}                // 이항: + - * / ^ < <= > >= == != and or
{"k":"c","f":"sqrt","a":[<AST>, ...]}                // 함수 호출
```

`validateAst(ast, allowedVars?)`는 runtime에도 들어 있어서, 서버가 해석하기 전에 노드 종류, 연산자, 함수 이름, 인자 수, 한도, 변수 이름을 다시 확인합니다. 허용 목록에 없는 것이 하나라도 있으면 해석하지 않습니다.

### 2.5 파싱 오류

`compileFormula(source, allowedVars)`는 `{ ok: true, ast }` 또는 `{ ok: false, errors: [{ pos, message }] }`를 돌려줍니다. 메시지 예시:

- `12번째 글자 근처: 알 수 없는 함수 "exp"입니다. 쓸 수 있는 함수: min, max, ...`
- `"votes"는 쓸 수 없는 변수입니다. 인기투표 add-on이 꺼져 있습니다.`
- `괄호가 닫히지 않았습니다.`

---

## 3. 점수 계산 (scoring)

### 3.1 설정

```yaml
scoring:
  criteria:                        # 트리. 리프(leaf)가 심사위원이 점수를 넣는 칸
    - { key: idea, name: "문제 정의 · 아이디어", max: 25 }     # weight 생략 = 1
    - key: impl
      name: 구현
      weight: 1
      children:
        - { key: done, name: 완성도, max: 10 }
        - { key: ux,   name: 사용자 경험, max: 15 }
  input_step: 0.01                 # 입력 단위 (0.01 = 소수 둘째 자리)
  judge_aggregate: { method: mean } # mean | median | trimmed_mean (trim: 1)
  require_complete: true           # 리프를 모두 채운 심사위원만 집계
  components: { judge: 1 }         # formula가 없을 때 최종 점수 = Σ weight × component
  popular_normalize: { method: share_of_max }   # share_of_max | capped_sqrt (full_at_multiple: 2)
  formula: null                    # 문자열이면 이 식이 최종 점수
  precision: 2                     # 최종 점수·tie_break 비교 자릿수
  tie_break: [judge]               # 식 목록. 앞에서부터 큰 쪽이 앞
  rank_groups: [track, division]   # 순위를 따로 매기는 묶음
  overrides:                       # 트랙·부문별 덮어쓰기 (뒤에 적은 것이 이김)
    - when: { track: assignment }
      criteria: [ ... ]
```

### 3.2 정의

**가중합이 기본입니다.** "가중치를 각 점수에 곱해서 더한다"를 모든 층에 그대로 적용합니다.

- 리프의 점수: 심사위원이 넣은 값 `x` (0 이상 `max` 이하, `input_step` 단위로 반올림).
- 부모의 점수: `points(parent) = Σ child.weight × points(child)`.
- 심사위원 한 명의 총점: `judge_total = Σ top.weight × points(top)` (최상위 항목들의 가중합).
- 기준의 만점: 같은 식에 모든 리프를 `max`로 넣은 값. `max_total`이라고 부르고 검사 결과(`event:check`)에 보여 줍니다. 예: 25점 문항 4개, weight 생략이면 `max_total = 100`.
- 집계에 넣을 심사위원: `require_complete`가 참이면 그 팀의 리프를 모두 채운 심사위원만.
- 팀의 심사 점수 `judge`(= J): 집계 대상 심사위원들의 `judge_total`을 `judge_aggregate`로 모은 값.
  - `mean`: 산술 평균.
  - `median`: 중앙값(짝수 개면 가운데 두 값의 평균).
  - `trimmed_mean`: 인원이 `2 × trim`보다 많을 때만 위·아래 `trim`명씩 빼고 평균. 아니면 평균.
- 집계 대상 심사위원이 없는 팀은 `judge = 0`, `judges = 0`이고 결과에 `unscored: true` 표시를 붙입니다.

**인기투표 값**(popular_vote add-on이 켜졌을 때만):

- `votes`: 그 팀의 유효 득표.
- `total_votes`: 같은 순위 묶음의 전체 득표, `team_count`: 그 묶음의 팀 수, `avg_votes = total_votes / team_count`, `max_votes`: 그 묶음의 최다 득표.
- `popular` (0~100으로 맞춘 값):
  - `share_of_max`: `100 × votes / max_votes` (최다 득표가 0이면 0).
  - `capped_sqrt`: `100 × sqrt(min(1, votes / (m × avg_votes)))`, `m = full_at_multiple` (평균이 0이면 0).

**최종 점수 S**:

- `formula`가 없으면: `S = Σ components[k] × value(k)`. `value(judge) = J`, `value(popular) = popular`.
- `formula`가 있으면: 그 식의 값.
- 순위와 화면 표시는 `precision` 자리로 반올림한 값으로 합니다. 반올림 전 값도 결과에 남깁니다.

### 3.3 수식에서 쓸 수 있는 변수

| 변수 | 뜻 |
| --- | --- |
| `judge` | 팀의 심사 점수 J (`max_total` 기준 점수) |
| `judges` | 집계에 들어간 심사위원 수 |
| `crit.<key>` | 기준 하나(리프 또는 부모)의 팀 점수. 심사위원별 `points(node)`를 `judge_aggregate`로 모은 값 |
| `critmax.<key>` | 그 기준의 만점 |
| `max_total` | 심사 총점의 만점 |
| `votes`, `total_votes`, `avg_votes`, `max_votes`, `team_count`, `popular` | 인기투표 add-on이 켜졌을 때만 |

### 3.4 reference case 재현

ENDPoinT 2026의 식은 이 언어로 이렇게 씁니다(문항 4개 × 25점, weight 생략).

```yaml
scoring:
  formula: "0.85 * judge + 15 * sqrt(min(1, votes / (2 * avg_votes)))"
  tie_break: [judge, crit.arch]
```

테스트에 반드시 넣을 값(10팀 트랙, 60명이 1인 3표, 전체 180표, 평균 18표):

| votes | 인기투표 부분 (`15 * sqrt(...)`) |
| --- | --- |
| 80 | 15.00 |
| 36 | 15.00 |
| 27 | 12.99 |
| 18 | 10.61 |
| 9 | 7.50 |
| 3 | 4.33 |
| 0 | 0.00 |

그리고 `judge = 80, votes = 27`이면 `S = 80.99`, `judge = 70, votes = 3`이면 `S = 63.83`.

### 3.5 순위와 상 배분

- `rank_groups`의 값(기본 `[track, division]`)이 같은 팀끼리 순위를 매깁니다. 부문이 없는 트랙은 트랙 단위입니다.
- 정렬: 반올림한 S 내림차순 → `tie_break`의 식을 차례로(각각 `precision` 자리로 반올림) 내림차순. 모두 같으면 같은 등수입니다(1, 2, 2, 4 방식).
- 상 배분: 그 묶음의 `prizes` 목록을 위에서부터 채웁니다. `{place: 2, teams: 2}`면 다음 순위 두 팀에게 2등을 줍니다. 경계에서 동점이 걸리면 **동점인 팀 모두** 그 상을 받습니다(그만큼 아래 상이 줄지 않고, 결과에 `tie_expanded: true`를 표시). 남은 상은 비워 둡니다.

---

## 4. 부문과 참가 조건 (eligibility)

### 4.1 조건 언어

조건은 YAML/JSON으로 적습니다.

```
Cond := {}                                  # 항상 참
      | { all: [Cond, ...] }
      | { any: [Cond, ...] }
      | { not: Cond }
      | { field: <이름>, <op>: <값> }        # op는 정확히 하나
```

| op | 값 | 동작 |
| --- | --- | --- |
| `eq`, `ne` | 문자열·숫자 | 같다 / 다르다 |
| `in`, `nin` | 목록 | 목록 안에 있다 / 없다 |
| `gt`, `gte`, `lt`, `lte` | 숫자 또는 `YYYY-MM-DD` | 크기 비교(날짜는 날짜끼리) |
| `matches` | 정규식 문자열 | 정규식에 맞는다. 입력은 200자로 자른 뒤 비교 |
| `exists` | true/false | 값이 있다 / 없다 |
| `domain_in` | 도메인 목록 | 이메일의 도메인이 목록에 있다 |

- `field`는 신청서 질문의 `key`입니다. 특별한 이름 두 개: `email`(구글 토큰에서 온 확인된 이메일), `email_domain`.
- 여러 개를 고르는 답(`multi`)은 배열입니다. 배열에 `eq`/`in`을 쓰면 "하나라도 해당하면 참", `nin`은 "하나도 해당하지 않으면 참"입니다.
- `evaluateCondition(cond, person)`은 `{ ok, failed: [{ path, field, op }] }`를 돌려줍니다. 실패 이유에는 조건 쪽 정보만 담고, 다른 사람의 입력값은 담지 않습니다.

### 4.2 개인 단위 참가 자격

```yaml
intake:
  eligibility:
    - when: { field: 재학 상태, eq: 재학 }
      message: "휴학생은 신청할 수 없습니다"
```

신청자는 목록의 조건을 모두 만족해야 합니다. 만족하지 못하면 그 항목의 `message`로 거절합니다.

### 4.3 부문(division)

```yaml
divisions:
  student:
    name: 학생부
    when: { all: [ { field: 신분, in: [대학생, 대학원생] } ] }
    team_rule: all_members        # all_members | any_member | leader | majority
  general:
    name: 일반부
    when: {}
tracks:
  hackathon:
    divisions: [student, general] # 이 트랙에서 열리는 부문 (순서 = 표시·자동 판정 순서)
    division_mode: declared       # declared | auto
```

- `team_rule`: 팀이 그 부문에 들어갈 수 있는 조건.
  - `all_members`: 팀원 전원이 `when`을 만족.
  - `any_member`: 한 명 이상.
  - `leader`: 조장(역할 `leader`)이 만족.
  - `majority`: 과반이 만족.
- `division_mode`:
  - `declared`: 팀이 부문을 고르고 서버가 `team_rule`로 확인합니다. 만족하지 못하면 이유와 함께 거절합니다.
  - `auto`: 목록 순서대로 처음 만족하는 부문을 줍니다. 아무것도 만족하지 않으면 `null`과 이유를 돌려줍니다.
- `resolveTeamDivision(track, divisions, team)`이 `{ division, ok, reasons }`를 돌려줍니다.
- 부문은 순위 묶음(3.5), 상금표(`prizes`를 부문별로 적을 수 있음), 점수 설정 덮어쓰기(`scoring.overrides`의 `when.division`)에 쓰입니다.

---

## 5. Add-on 목록

### 5.1 module과 add-on

- **module**은 기본 구성 요소로, 기본값은 켜짐입니다: `apply`(신청·명단), `submit`(결과물 제출), `judge`(심사 점수·결과).
- **add-on**은 선택 기능으로, 기본값은 꺼짐입니다. 켜려면 `enabled: true`를 **명시**해야 합니다(조직이 "추가로 확정"하는 행위). MCP에서는 plan → confirm → apply로 켭니다.

```yaml
modules: { apply: true, submit: true, judge: true }
addons:
  popular_vote: { enabled: true, votes_per_voter: 3, self_vote: false }
```

### 5.2 목록 (v1)

| id | 이름 | 필요 조건 | 더하는 것 | 상태 |
| --- | --- | --- | --- | --- |
| `popular_vote` | 인기투표 | module `judge` | 투표 페이지, `투표` 탭, 점수 변수 `votes` 등 | available |
| `team_board` | 팀 모집 게시판·지원 | module `apply` | 게시판 페이지, `게시판`·`팀지원` 탭, 알림 메일 | available |
| `notices` | 공지 | 없음 | 공지 영역, `공지` 탭 | available |
| `public_status` | 공개 현황판 | module `submit` | 제출·투표 인원만 보이는 현황 | available |
| `award_show` | 시상 화면 | module `judge` | 발표용 전체 화면 | available |
| `slide_preview` | 발표 자료 보기용 PDF | module `submit` | PPT → PDF 변환, 나란히 보기 | available |
| `track_moves` | 행사 중 트랙 이동 | module `judge` | 팀의 트랙을 옮기는 운영진 기능 | available |
| `github_ops` | GitHub org 운영 | 설정 `github` | MCP의 팀·repo·잠금 도구 | available |
| `check_in` | 현장 체크인 | module `apply` | QR 체크인 | planned |
| `mentor_queue` | 멘토 질문 대기열 | 없음 | 질문 접수·배정 | planned |
| `judge_assignment` | 심사위원-팀 배정 | module `judge` | 심사위원별 담당 팀 | planned |

- `planned`인 add-on을 켜면 오류입니다. 모르는 id도 오류입니다.
- 각 add-on은 `options` 스키마(zod)를 가집니다. 옵션 기본값은 레지스트리에 있습니다.

---

## 6. 설정 v2: 구조, 상속, 병합

### 6.1 최상위 키

| 키 | 내용 |
| --- | --- |
| `schema` | `2` |
| `kind` | `event`, `profile`, `preset` |
| `extends` | 문자열 또는 문자열 목록: `preset:<이름>@<major>`, `profile:<이름>`, 또는 이 파일 기준 상대 경로 |
| `event` | `id`, `name`, `timezone`, `locale`, `venue`, `organizers` |
| `site` | `title`, `tagline`, `logo`, `accent`, `links`, `contact` |
| `schedule` | `recruit {open, close}`, `sessions [{id, at, title, place}]`, `main {start, end, submit_deadline, grace_min}`, `score_until`, `results_at` |
| `tracks` | 트랙 id → `{ id, name, aliases, teams, order, divisions, division_mode, vote {from, until}, prizes, submit_deadline }` |
| `divisions` | 부문 id → `{ name, when, team_rule }` |
| `intake` | `identity`, `eligibility`, `fields`, `consents` |
| `scoring` | 3장 |
| `modules`, `addons` | 5장 |
| `submit` | `team_max_gb`, `kinds`, `repo_link` |
| `privacy` | `retention_days`, `share_contact_on_team_accept` |
| `github`, `roster`, `repo`, `reviewers`, `teams`, `app_policy` | 기존 v1 모양 그대로 (MCP 통합 단계에서 core로 옮겨 한 곳에서 관리) |

`tracks.<id>.prizes`는 목록(모든 순위 묶음에 같은 표) 또는 부문 id → 목록인 map입니다. 상 항목은 `{ place, teams, amount?, label? }`입니다.

`intake`:

```yaml
intake:
  identity:
    google_login: required          # locked
    one_per_account: true           # locked
    email_domains: []               # 비우면 모든 구글 계정
    github: { required: true, verify: format }   # verify: format | exists
  eligibility: [ { when: Cond, message: "..." } ]
  fields:
    - { key: 성함, type: text, required: true, max: 50, roster: name, section: 기본 정보 }
    # type: text | tel | textarea | single | multi | github | number | date
    # 공통: key, label?, required, placeholder, max, options(single/multi), solo(multi), section, roster
    # roster: name | github_login | team_hint  (명단으로 넘어가는 역할. email, google_sub는 토큰에서 자동)
  consents:
    - { key: 개인정보, text: "...", version: v1 }
```

### 6.2 상속 해석

- 순서: `extends`의 목록을 앞에서부터 차례로 병합하고, 마지막에 이 파일을 병합합니다. 각 부모도 자기 `extends`를 먼저 해석합니다.
- `preset:<이름>@<major>`: core에 들어 있는 `src/config/presets/<이름>.yaml`. major가 다르면 오류입니다.
- `profile:<이름>`: `<home>/profiles/<이름>.yaml`. `<home>`은 `events/`가 들어 있는 폴더(이벤트 파일이 `<home>/events/<id>/event.yaml`에 있다고 가정)이거나 CLI의 `--home`.
- 상대 경로: 이 파일이 있는 폴더 기준.
- 깊이 5 초과, 순환, 없는 파일은 오류(V13)입니다.

### 6.3 병합 규칙

`merge(base, over)`:

1. `over`의 값이 `null`이면 그 키를 지웁니다(map의 항목 삭제).
2. 둘 다 객체면 키마다 재귀로 병합합니다.
3. **key가 있는 목록**(`scoring.criteria`와 그 `children`, `intake.fields`, `intake.consents`, `schedule.sessions`(key는 `id`), `scoring.overrides`는 제외):
   - `over`가 배열이면 통째로 바꿉니다.
   - `over`가 `{ add?, remove?, update? }` 객체면: `remove`의 key를 지우고, `update`의 항목을 key가 같은 항목에 재귀 병합하고(없는 key면 오류), `add`의 항목을 뒤에 붙입니다(이미 있는 key면 오류).
4. 그 밖의 배열: `over`가 배열이면 교체, `{ append: [...] }`면 뒤에 붙입니다.
5. 그 밖의 값: 교체.

### 6.4 locked key

아래 값은 아래 층이 다른 값으로 바꿀 수 없습니다. 같은 값을 다시 쓰는 것은 괜찮습니다.

| 경로 | 값 |
| --- | --- |
| `intake.identity.google_login` | `required` |
| `intake.identity.one_per_account` | `true` |
| `reviewers.permission` | `pull` |

위반하면 V12 오류이고, 메시지에 이유를 함께 적습니다(예: "본인 확인은 구글 서명 토큰으로만 합니다").

---

## 7. 검증 규칙 (`check`)

`checkConfig(resolved, ctx)`는 `diagnostics: [{ id, severity: error | warning | info, path, message }]`를 돌려줍니다. 오류가 하나라도 있으면 빌드하지 않습니다.

| id | 규칙 |
| --- | --- |
| V1 | 시각에 UTC 오프셋이 있고, 모집 열림 < 모집 닫힘 ≤ 사전 프로그램 ≤ 본 행사 시작 < 제출 마감 ≤ 트랙별 투표 창 ≤ 심사 마감 순서다. |
| V2 | 트랙의 팀 번호 범위(`"01-10"`, `"07"`)가 서로 겹치지 않는다. |
| V3 | 기준 key가 트리 전체에서 유일하고, `max > 0`, `weight > 0`, 리프에는 `max`가 있다. `max_total`을 info로 보고한다. |
| V4 | `formula`와 `tie_break`가 컴파일되고, 쓰인 변수가 허용 목록(3.3)에 있다. 인기투표 변수는 `popular_vote`가 켜져 있을 때만 허용한다. |
| V5 | 순위 묶음마다 상금표의 팀 수 합이 그 묶음의 팀 수를 넘지 않는다(부문이 있으면 경고만). |
| V6 | 트랙별 투표 창이 서로 겹치지 않고 `order` 순서다(`popular_vote`가 켜졌을 때). |
| V7 | `privacy.retention_days`가 0 이상이다. |
| V8 | 비밀로 보이는 문자열(`-----BEGIN ... PRIVATE KEY-----`, `ghp_`, `github_pat_`, `AIza`로 시작하는 키, `"private_key"`)이 설정 파일 원문에 있으면 오류. |
| V10 | `github_ops`가 켜졌는데 `intake.identity.github.required`가 거짓이면 경고. |
| V11 | 질문 key가 유일하고, `roster` 역할이 중복되지 않으며 `name` 역할이 하나 있다. |
| V12 | locked key 위반. |
| V13 | `extends` 해석 실패(없는 파일, 순환, 깊이, preset major 불일치). |
| V14 | module·add-on 의존 관계가 맞고, 모르는 add-on이나 `planned` add-on을 켜지 않았다. |
| V15 | 트랙이 참조하는 부문이 `divisions`에 있고, 조건이 참조하는 `field`가 질문 key 또는 `email`/`email_domain`이며, `matches` 정규식이 컴파일된다. |

---

## 8. 빌드 산출물과 CLI

### 8.1 `event.json`

`buildEventJson(resolved)`는 사이트와 서버가 읽는 **공개용** JSON을 만듭니다.

- 넣는 것: `schema`, `kit.version`, `event`, `site`, `schedule`, `tracks`(prizes 포함), `divisions`(이름과 조건), `intake`(화면에 그릴 질문, 자격 메시지, 동의 항목), `scoring`(기준 트리, components, 정규화 방식, 수식 문자열과 **AST**, `tie_break` AST, `precision`, `rank_groups`, `overrides`), `modules`, 켜진 `addons`와 공개 옵션, `privacy.retention_days`.
- 빼는 것: `roster`(시트 링크), `github`, `repo`, `reviewers`, `app_policy`, 그 밖에 운영진만 알면 되는 값.
- `config_hash`: 정규화한 JSON의 sha256 앞 16자. 서버가 캐시와 버전 확인에 씁니다.

### 8.2 CLI

```
simple-hackathon check <event.yaml> [--home <dir>]      진단 출력, 오류가 있으면 exit 1
simple-hackathon build <event.yaml> --out <dir> [--home <dir>]   event.json 쓰기
```

### 8.3 예제

저장소 루트의 `examples/`에 가짜 데이터 예제 두 개를 둡니다. 둘 다 `check`가 오류 없이 통과하고 `build` 결과가 snapshot과 같아야 합니다.

- `examples/reference-2track/`: reference case 구조. `profiles/example-univ.yaml`(preset `standard-2track` + `university-students` 상속) + `events/example-2027/event.yaml`(두 트랙, `popular_vote` 켬, 3.4의 수식).
- `examples/company-internal/`: S6. `profiles/example-corp.yaml`(preset `single-track` + `company-internal`) + `events/corp-hack-2027/event.yaml`(단일 트랙, 부문 둘: `학생 인턴`/`정직원` 예시, GitHub·인기투표 없음, 가중합 기본).

---

## 9. 테스트 요구

| 영역 | 꼭 있어야 하는 테스트 |
| --- | --- |
| 수식 | 우선순위·결합(`2^3^2`, `-2^2`), 함수 인자 수, 0 나누기 = 0, `if`의 지연 평가, 한도 초과, `constructor`·`__proto__`·`toString` 같은 이름이 변수·함수로 통하지 않음, 알 수 없는 함수·변수 오류 메시지, AST 검증이 조작된 AST(모르는 `k`, 모르는 `o`, 인자 수 위반)를 거절 |
| 점수 | 가중합(리프·부모·최상위), `max_total`, `require_complete`, mean·median·trimmed_mean, `share_of_max`·`capped_sqrt`, 3.4의 표와 S 두 값(reference case golden) |
| 순위 | 동점(1, 2, 2, 4), tie_break 순서, `precision` 반올림 경계, 상 배분과 동점 확장 |
| 부문 | 각 op, 배열 답, `email_domain`, `all/any/not` 중첩, 팀 규칙 네 가지, `declared`/`auto`, 실패 이유에 남의 값이 없음 |
| 병합 | key 목록의 add/remove/update와 오류, `null` 삭제, `append`, 배열 교체, locked 위반, extends 순환·깊이·없는 파일 |
| 검증 | V1~V15 각각의 통과·실패 사례 |
| 빌드 | 두 예제의 `event.json` snapshot, 비공개 키가 빠졌는지 |
| parity | `dist/runtime.gs.js`를 Node `vm`의 빈 context(Node 전역 없음)에서 실행해, Node import 결과와 같은 점수·순위·부문 판정이 나오는지 |
