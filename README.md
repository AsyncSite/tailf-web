# tailf-web

https://tailf.asyncsite.com 의 정적 랜딩입니다. 빌드 단계가 없고, Cloudflare Pages 가 `main` 을 그대로 냅니다.

## 스토어 링크 끼우는 법

1. **Google Play**: `app.js` 맨 위 `PLAY_URL` 에 `https://play.google.com/store/apps/details?id=...` 를 적습니다. 그 한 줄로 세 곳의 버튼과 상단 알약과 `/go/play/` 가 같이 바뀝니다. 빈 문자열이면 링크가 없는 상태로 섭니다.
2. **App Store**: 손댈 곳이 없습니다. `app.js` 가 열 때마다 iTunes lookup 으로 Apple 에게 물어보고, Apple 이 준 주소로만 이어집니다.
3. **스크립트를 끈 브라우저**: `go/appstore/index.html` 과 `go/play/index.html` 머리에 주석으로 접어 둔 `meta refresh` 한 줄의 주석을 풀고 같은 주소를 적습니다. 이 줄이 없어도 스크립트가 켜진 브라우저는 바로 갑니다.

## 설치 클릭률 읽는 법

설치 버튼은 상태와 무관하게 항상 `/go/appstore/` 나 `/go/play/` 로 갑니다. 그래서 **설치 클릭률 = (`/go/appstore/` + `/go/play/`) 페이지뷰 ÷ `/` 페이지뷰** 입니다. 계기는 Cloudflare Web Analytics 이고 `asyncsite.com` 존에 자동 설치돼 있습니다. 이 저장소에는 계측 스크립트가 없고, 넣지도 않습니다.

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

## 설치 전에 세어 보기 절의 「N번」 (T-503, 2026-09-04)

「지난 30일이었다면 N번 왔을 거예요」의 N 은 알림 수입니다. 겹친 공고(기술이 두 개 이상 겹친 것)가 올라온 날의 수(`postedAt` 날짜 distinct)이고, 앱 `lib/src/watch/backtest.dart` 의 `ringDays` 와 같은 정의입니다(앱은 T-048). 알림은 하루 한 번 묶어 오므로 30일에 30 을 넘지 않습니다. 겹친 공고 수는 사라지지 않고 그 아래 근거 줄에 섭니다. 이 절의 수는 기술만으로 센 값이라 경력과 지역을 좁히는 앱의 수보다 클 수 있고, 그것을 한 줄로 말합니다.

| 새 문장 | 어디에 |
|---|---|
| 겹친 공고 {M}건이 {N}일에 걸쳐 올라왔어요. 하루 한 번 묶어서 와요. | 큰 수 바로 아래 근거 줄 (`#try-days`, N > 0 일 때만) |
| 기술만으로 센 값이에요. 경력이랑 지역은 앱에서 좁혀요. | 숫자판 마지막 줄 (`#try-note`, 기술을 둘 이상 골라 셈이 선 뒤) |

정본은 앱 저장소 `docs/copy/web-landing.md` G절과 `docs/copy/deck.md` 3절입니다.
