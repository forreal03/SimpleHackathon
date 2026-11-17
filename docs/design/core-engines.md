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
│                           (format iife, globalName "SHK", target es2019, charset utf8,
│                            주석 머리말에 kit 버전, 모듈 주석의 경로는 패키지 기준)
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
  rank_groups: [track, division]   # 순위를 따로 매기는 묶음. track은 꼭 들어갑니다(상금표가 트랙마다 있음)
  overrides:                       # 트랙·부문별 덮어쓰기 (뒤에 적은 것이 이김)
    - when: { track: assignment }
      criteria: [ ... ]
```

### 3.2 정의

**가중합이 기본입니다.** "가중치를 각 점수에 곱해서 더한다"를 모든 층에 그대로 적용합니다.

- 리프의 점수: 심사위원이 넣은 값 `x` (0 이상 `max` 이하, `input_step` 단위로 반올림). 범위를 벗어난 값은 0이나 `max`로 맞추고, 숫자가 아닌 값은 넣지 않은 것으로 봅니다. 한 심사위원이 한 팀에 낸 점수표가 여럿이면 마지막 것만 셉니다.
- 부모의 점수: `points(parent) = Σ child.weight × points(child)`.
- 심사위원 한 명의 총점: `judge_total = Σ top.weight × points(top)` (최상위 항목들의 가중합).
- 기준의 만점: 같은 식에 모든 리프를 `max`로 넣은 값. `max_total`이라고 부르고 검사 결과(`event:check`)에 보여 줍니다. 예: 25점 문항 4개, weight 생략이면 `max_total = 100`.
- 집계에 넣을 심사위원: `require_complete`가 참이면 그 팀의 리프를 모두 채운 심사위원만. 거짓이면 리프를 하나 이상 채운 심사위원 모두이고, 빈 리프는 0점입니다.
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

- `formula`가 없으면: `S = Σ components[k] × value(k)`. `value(judge) = J`, `value(popular) = popular`. 이 값도 유한하지 않으면 식의 결과처럼(2.3) 0으로 바꾸고 경고를 남깁니다.
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
- 정렬: 반올림한 S 내림차순 → `tie_break`의 식을 차례로(각각 `precision` 자리로 반올림) 내림차순. 모두 같으면 같은 등수입니다(1, 2, 2, 4 방식). 수가 아닌 값(NaN, JSON을 거친 `null`)은 가장 낮은 값으로 봅니다. 그래야 정렬 순서가 어느 엔진에서나 같습니다.
- 상 배분: 그 묶음의 `prizes` 목록을 위에서부터 채웁니다. `{place: 2, teams: 2}`면 다음 순위 두 팀에게 2등을 줍니다. 경계에서 동점이 걸리면 **동점인 팀 모두** 그 상을 받습니다(그만큼 아래 상이 줄지 않고, 결과에 `tieExpanded: true`를 표시). 남은 상은 비워 둡니다.

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
- 여러 개를 고르는 답(`multi`)은 배열입니다. 배열에 `eq`/`in`을 쓰면 "하나라도 해당하면 참", `nin`은 "하나도 해당하지 않으면 참"입니다. `ne`도 `nin`처럼 하나도 같지 않아야 참이고, 크기 비교·`matches`·`domain_in`은 하나라도 맞으면 참입니다.
- 답이 없으면 모든 연산자에서 같은 규칙으로 `ne`, `nin`, `exists: false`만 참입니다. 답이 없다는 것은 key가 없거나 `null`, 빈 문자열이나 공백만 있는 문자열, 빈 배열인 경우입니다. 배열 안의 빈 문자열은 빼고 보므로 `["", " "]`도 답이 없는 것입니다. 시트의 빈 칸과 비워 낸 입력은 서버에 `""`로 오기 때문입니다.
- `eq`/`in`은 값의 글자를 비교하므로 답 "3"과 조건 값 3은 같습니다. `email_domain`은 소문자로 읽고, 견주는 조건 값(`eq`, `ne`, `in`, `nin`)도 소문자로 바꿔 비교합니다. 도메인은 대소문자를 가리지 않기 때문입니다.
- `matches`의 정규식은 JavaScript 정규식의 작은 부분만 씁니다. 신청자가 답 하나로 서버 판정을 오래 붙잡아 두지 못하게 하려는 제한입니다(역추적 폭발, ReDoS).
  - 그룹은 `(...)`, `(?:...)`, `(?=...)`, `(?!...)`만 씁니다. 이름 붙은 그룹, 뒤보기, `(?i:...)` 같은 수정자, 역참조(`\1`)는 쓸 수 없습니다.
  - `*`, `+`, `{n,}`가 붙은 그룹 안에는 다시 반복(`*`, `+`, `?`, `{n,m}`)이나 `|`를 두지 않습니다. `^([A-Za-z]+ ?)+$`, `^(\w+\s?)*$`, `(a|b)+`가 여기에 걸립니다.
  - 200자 답 하나를 나누는 방법의 수가 10^7을 넘지 않아야 합니다. 차례로 이어진 부분은 곱하고, `|`의 대안은 더하고, 반복은 가능한 횟수마다 셉니다. `^`로 시작하지 않으면 시작 위치 201곳을 더 곱합니다. 예: `^\s*\s*\s*x`는 201³ ≈ 8.1×10^6이라 되고, `\s*`를 하나 더 쓰면 안 됩니다.
  - 지키지 않은 정규식과 컴파일되지 않는 정규식은 V15 오류입니다. runtime(`matchesProblem`)도 같은 검사를 해서, 그런 조건은 판정하지 않고 예외를 냅니다. `not` 아래에서 조용히 모두를 통과시키지 않기 위해서입니다.
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
- `preset:<이름>@<major>`: core에 들어 있는 `src/config/presets/<이름>.yaml`(빌드하면 `dist/config/presets/`로 복사). preset 파일은 머리에 `version: <major>`를 적고, major가 다르면 오류입니다. `schema`, `kind`, `extends`, `version`은 파일을 설명하는 키라서 병합하지 않습니다.
- `profile:<이름>`: `<home>/profiles/<이름>.yaml`. `<home>`은 `events/`가 들어 있는 폴더(이벤트 파일이 `<home>/events/<id>/event.yaml`에 있다고 가정)이거나 CLI의 `--home`.
- 상대 경로: 이 파일이 있는 폴더 기준.
- 깊이 5 초과, 순환, 없는 파일은 오류(V13)입니다. 한 `extends` 목록에 같은 파일을 두 번 적은 것(쓴 모양이 달라도)과, 한 번 읽는 동안 파일을 50번 넘게 읽는 것도 오류입니다. 여러 부모가 같은 파일을 거치면 그 파일을 그만큼 다시 읽으므로, 이 상한이 없으면 작은 파일 몇 개로 읽기 횟수가 거듭제곱으로 늘어납니다.

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

`checkConfig(resolved, ctx)`는 `diagnostics: [{ id, severity: error | warning | info, path, message }]`를 돌려줍니다. 오류가 하나라도 있으면 빌드하지 않고, 오류 없이 통과한 설정은 빌드됩니다. 규칙 밖의 문제는 읽을 때(`loadConfig`) 보고하며 id가 `YAML`(문법), `SCHEMA`(모양·형식), `MERGE`(add/remove/update를 잘못 씀)입니다. V12는 `ctx.files`의 원문을 층마다 다시 읽어 검사하고, 파일 없이 메모리에서 만든 설정도 걸리도록 병합된 값을 한 번 더 봅니다. `checkFile(path, options)`는 `loadConfig`와 `checkConfig`를 이어 돌린 결과를 돌려주며, CLI와 테스트(그리고 MCP)가 같은 방식으로 씁니다.

| id | 규칙 |
| --- | --- |
| V1 | 시각이 있는 날짜이고(`2027-04-31`처럼 없는 날은 다음 달로 넘기지 않고 오류) UTC 오프셋이 있으며, 모집 열림 < 모집 닫힘 ≤ 사전 프로그램 ≤ 본 행사 시작 < 제출 마감 ≤ 트랙별 투표 창 ≤ 심사 마감 순서다. 중간 시각이 비어도 그 앞뒤 시각끼리 비교하고, 건너뛴 연결 중 하나라도 `<`이면 `<`로 비교한다. 투표 창이 없는 트랙은 그 단계만 뺀다. |
| V2 | 트랙의 팀 번호 범위(`"01-10"`, `"07"`)가 서로 겹치지 않는다. |
| V3 | 기준 key가 트리 전체에서 유일하고, `max > 0`, `weight > 0`, 리프에는 `max`가 있다. key는 수식에서 `crit.<key>`로 읽으므로 영문자·숫자·`_`로 적는다. `max_total`을 info로 보고한다. |
| V4 | `formula`와 `tie_break`가 컴파일되고, 쓰인 변수가 허용 목록(3.3)에 있다. 인기투표 변수는 `popular_vote`가 켜져 있을 때만 허용한다. 트랙 × 부문마다 그 자리에 적용되는 식을 그 자리의 변수로 검사하고, 어느 자리에도 닿지 않는 식(모든 자리에서 덮어쓰기에 가려진 기본 식, 맞는 자리가 없는 덮어쓰기의 식)도 빌드처럼 모든 기준 트리의 변수로 검사한다(`compileScoring`). event.json에는 그런 식도 들어가기 때문이다. |
| V5 | 순위 묶음마다 상금표의 팀 수 합이 그 묶음의 팀 수를 넘지 않는다(부문이 있으면 경고만). 부문별 상금표는 트랙에 부문이 있고 `rank_groups`에 `division`이 있을 때만 쓴다. |
| V6 | 트랙별 투표 창이 서로 겹치지 않고 `order` 순서다(`popular_vote`가 켜졌을 때). |
| V7 | `privacy.retention_days`가 0 이상이다. |
| V8 | 비밀로 보이는 문자열(`-----BEGIN ... PRIVATE KEY-----`와 `-----BEGIN PGP PRIVATE KEY BLOCK-----`, `ghp_`·`gho_`·`ghu_`·`ghs_`·`ghr_`·`github_pat_` 토큰, `AIza`로 시작하는 키, `GOCSPX-`로 시작하는 OAuth 클라이언트 보안 비밀, 따옴표를 쓰거나 안 쓴 `private_key` 키)이 설정 파일 원문에 있으면 오류. |
| V10 | `github_ops`가 켜졌는데 `intake.identity.github.required`가 거짓이면 경고. |
| V11 | 질문 key가 유일하고, `roster` 역할이 중복되지 않으며 `name` 역할이 하나 있다. |
| V12 | locked key 위반. |
| V13 | `extends` 해석 실패(없는 파일, 순환, 깊이, preset major 불일치, 한 목록에 같은 파일 두 번, 읽은 파일 50개 초과). |
| V14 | module·add-on 의존 관계가 맞고, 모르는 add-on이나 `planned` add-on을 켜지 않았다. |
| V15 | 트랙이 참조하는 부문(부문별 상금표의 key 포함)이 `divisions`에 있고 그 트랙에서 열리며, `scoring.overrides`의 `when`이 있는 트랙·부문을 가리키고(맞는 트랙 × 부문이 없으면 경고), 조건이 참조하는 `field`가 질문 key 또는 `email`/`email_domain`이며, `matches` 정규식이 컴파일되고 4.1의 제한을 지킨다. `email` 조건에 `eq`/`ne`/`in`/`nin`으로 메일 주소를 적으면 경고한다. 조건은 공개되는 event.json에 그대로 실리므로, 사전 등록자 같은 개인 메일 명단은 시트처럼 비공개인 곳에서 확인한다. |

---

## 8. 빌드 산출물과 CLI

### 8.1 `event.json`

`buildEventJson(resolved)`는 사이트와 서버가 읽는 **공개용** JSON을 만듭니다.

- 넣는 것: `schema`, `kit.version`, `event`, `site`, `schedule`, `tracks`(prizes 포함), `divisions`(이름과 조건, 팀 규칙), `intake`(화면에 그릴 질문, 자격 메시지, 동의 항목), `scoring`(기준 트리, components, 정규화 방식, 수식 문자열과 **AST**, `tie_break` AST, `precision`, `rank_groups`, `overrides`), `modules`, 켜진 `addons`와 공개 옵션, `privacy.retention_days`.
- 빼는 것: `roster`(시트 링크), `github`, `repo`, `reviewers`, `app_policy`, 그 밖에 운영진만 알면 되는 값.
- 모양: 섹션은 YAML에 적은 모양(snake_case) 그대로이고, runtime 엔진이 그대로 받는 두 섹션만 runtime 모양입니다. `scoring`은 `ScoringConfig`(camelCase, 기본값을 채우고 수식을 AST로 바꾼 것)라서 `computeTeamScores`·`rankTeams`에, `divisions`는 `{ name, when, teamRule }`이라서 `resolveTeamDivision`에 바로 넘깁니다. `tracks`는 YAML 모양이라 runtime의 작은 변환 함수를 거칩니다. `trackDivisionSpec(eventJson.tracks[id])`가 `resolveTeamDivision`의 `track` 인자를, `prizesByTrack(eventJson.tracks)`가 `assignPrizes`의 상금표 인자를 만듭니다. 변환도 runtime에 있어 parity test가 함께 확인합니다.
- `config_hash`: 정규화한 JSON(객체 key를 모든 깊이에서 정렬하고 `config_hash` 자신은 뺀 것)의 sha256 앞 16자. 서버가 캐시와 버전 확인에 씁니다.

### 8.2 CLI

```
simple-hackathon check <event.yaml> [--home <dir>]      진단 출력, 오류가 있으면 exit 1
simple-hackathon build <event.yaml> --out <dir> [--home <dir>]   event.json 쓰기
```

`build`는 검사를 통과한 뒤에도 event.json을 만들거나 쓰지 못하면(예: `kind: profile` 파일) 이유를 한국어로 출력하고 exit 1로 끝납니다. event.json을 다 만든 뒤에 폴더를 만들므로, 실패하면 아무것도 남지 않습니다.

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
| 부문 | 각 op, 배열 답, 빈 답(`""`, 공백, 빈 배열)이 모든 op에서 답 없음, `email_domain`, `matches` 제한과 그 예외, `all/any/not` 중첩, 팀 규칙 네 가지, `declared`/`auto`, 실패 이유에 남의 값이 없음 |
| 병합 | key 목록의 add/remove/update와 오류, `null` 삭제, `append`, 배열 교체, locked 위반, extends 순환·깊이·없는 파일·같은 부모 두 번·읽기 상한 |
| 검증 | V1~V15 각각의 통과·실패 사례, check를 통과한 설정은 build도 성공함 |
| 빌드 | 두 예제의 `event.json` snapshot, 비공개 키가 빠졌는지 |
| parity | `dist/runtime.gs.js`를 Node `vm`의 빈 context(Node 전역 없음)에서 실행해, Node import 결과와 같은 점수·순위·부문 판정이 나오는지 |
