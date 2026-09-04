# tailf-web

https://tailf.asyncsite.com 의 정적 랜딩입니다. 빌드 단계가 없고, Cloudflare Pages 가 `main` 을 그대로 냅니다.

## 스토어 링크 끼우는 법

1. **Google Play**: `app.js` 맨 위 `PLAY_URL` 에 `https://play.google.com/store/apps/details?id=...` 를 적습니다. 그 한 줄로 세 곳의 버튼과 상단 알약과 `/go/play/` 가 같이 바뀝니다. 빈 문자열이면 링크가 없는 상태로 섭니다.
2. **App Store**: 손댈 곳이 없습니다. `app.js` 가 열 때마다 iTunes lookup 으로 Apple 에게 물어보고, Apple 이 준 주소로만 이어집니다.
3. **스크립트를 끈 브라우저**: `go/appstore/index.html` 과 `go/play/index.html` 머리에 주석으로 접어 둔 `meta refresh` 한 줄의 주석을 풀고 같은 주소를 적습니다. 이 줄이 없어도 스크립트가 켜진 브라우저는 바로 갑니다.

## 설치 클릭률 읽는 법

설치 버튼은 상태와 무관하게 항상 `/go/appstore/` 나 `/go/play/` 로 갑니다. 그래서 **설치 클릭률 = (`/go/appstore/` + `/go/play/`) 페이지뷰 ÷ `/` 페이지뷰** 입니다. 계기는 Cloudflare Web Analytics 이고 `asyncsite.com` 존에 자동 설치돼 있습니다. 이 저장소에는 계측 스크립트가 없고, 넣지도 않습니다.

배포 채널은 개인 식별값 대신 아래 고정 경로를 씁니다. `_redirects`가 같은 첫 화면을 200
rewrite로 내주므로 주소와 `requestPath`는 유지되고, `app.js`는 설치 버튼도 같은 채널의
`/go/` 경로로 이어 줍니다. 임의 문자열은 채널로 인정하지 않습니다.

| 채널 | 배포 주소 |
|---|---|
| 뉴스레터 | `https://tailf.asyncsite.com/from/newsletter/` |
| 그릿 라운지 | `https://tailf.asyncsite.com/from/lounge/` |
| 기수 채널 | `https://tailf.asyncsite.com/from/cohort/` |
| 외부 커뮤니티 | `https://tailf.asyncsite.com/from/community/` |

채널별 방문과 설치 클릭은 `/from/{채널}/`, `/go/appstore/{채널}/`,
`/go/play/{채널}/` 페이지뷰로 집계합니다. 이름, 이메일, 조건, 기기 식별자는 붙이지 않습니다.

```graphql
query{viewer{accounts(filter:{accountTag:"<ACCOUNT_TAG>"}){rumPageloadEventsAdaptiveGroups(limit:100,filter:{datetime_geq:"<ISO8601>",requestHost:"tailf.asyncsite.com"},dimensions:[requestPath]){count dimensions{requestPath}}}}}
```

## 이 저장소가 쓰는 말

카피 규칙과 금지 목록의 정본은 앱 저장소의 `docs/copy/web-landing.md` 와 `docs/copy-lexicon.md` 입니다. 해요체로 통일하고, 습니다체는 정책 고지와 오류 고지에만 씁니다. 긴 줄표를 구분자로 쓰지 않습니다. 「준비 중」 「출시되면」 「심사가 끝나면」은 폐기된 표현이라 쓰지 않습니다.

두 스토어 버튼을 세우면서 새로 쓴 문장은 이것뿐입니다.

| 새 문장 | 어디에 |
|---|---|
| Google Play 에도 올라가요 | Play 버튼 (링크 없음 상태) |
| Google Play 에서 받기 | Play 버튼 (링크 있음 상태) |
| Google Play 는 아이폰 다음이에요. 올라가면 여기서 바로 받을 수 있어요. | 세 CTA 아래 보조문 |
| 받는 곳은 App Store 와 Google Play 예요 | 마지막 절 제목 |
| 아이폰이 먼저예요. Google Play 에도 올라가고, 그때 안드로이드에서도 받을 수 있어요. | FAQ 「아이폰만 되나요?」 |
| 아직 App Store 심사 중이에요 / 올라가면 이 주소가 바로 스토어로 이어져요. | `/go/appstore/` |
| Google Play 에도 올라가요 / 아이폰이 먼저예요. 올라가면 이 주소가 바로 스토어로 이어져요. | `/go/play/` |
| 아이폰이 먼저고 안드로이드가 뒤따릅니다. (이하 한 문단) | `/support/` 「지금은 어디서 받나요」 (그 페이지의 결대로 습니다체) |

상단 알약 둘은 문장 대신 스토어 이름만 답니다(`data-keep-label`). 390px 화면에서 마크 옆에 두 문장이 서지 않아서이고, 상태는 알약의 색과 `/go/` 화면이 말합니다.
