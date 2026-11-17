# examples

설정 상속(preset → profile → event)을 보여 주는 예제 두 개입니다. 이름, 메일, 시트 주소는 모두 가짜입니다.

| 예제 | 구조 |
| --- | --- |
| [`reference-2track`](reference-2track) | reference case(ENDPoinT 2026)와 같은 구조. `preset:standard-2track` + `preset:university-students` → `profiles/example-univ.yaml` → `events/example-2027/event.yaml`. 두 트랙, 인기투표, 점수식 `0.85 * judge + 15 * sqrt(min(1, votes / (2 * avg_votes)))` |
| [`company-internal`](company-internal) | 사내 해커톤. `preset:single-track` + `preset:company-internal` → `profiles/example-corp.yaml` → `events/corp-hack-2027/event.yaml`. 트랙 하나, 부문 둘(학생 인턴 / 정직원, 자동 판정), GitHub·인기투표 없이 가중합 기본 점수 |

저장소 루트에서 빌드한 뒤 검사하고 `event.json`을 만듭니다.

```bash
npm run build
node packages/core/dist/cli.js check examples/reference-2track/events/example-2027/event.yaml
node packages/core/dist/cli.js build examples/reference-2track/events/example-2027/event.yaml --out /tmp/site
```

`profile:<이름>`은 이벤트 파일이 `<home>/events/<id>/event.yaml`에 있으면 `<home>/profiles/<이름>.yaml`에서 찾습니다. 다른 곳에 두었다면 `--home <home>`을 줍니다. 두 예제의 `event.json`은 [`packages/core/test/__snapshots__`](../packages/core/test/__snapshots__)에 있습니다.
