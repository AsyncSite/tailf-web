# tailf-web

https://tailf.asyncsite.com 의 정적 랜딩입니다. 빌드 단계가 없고, Cloudflare Pages 가 `main` 을 그대로 냅니다.

## 스토어 링크 끼우는 법

1. **Google Play**: `app.js` 맨 위 `PLAY_URL` 에 `https://play.google.com/store/apps/details?id=...` 를 적습니다. 그 한 줄로 세 곳의 버튼과 상단 알약과 `/go/play/` 가 같이 바뀝니다. 빈 문자열이면 링크가 없는 상태로 섭니다.
2. **App Store**: 손댈 곳이 없습니다. `app.js` 가 열 때마다 iTunes lookup 으로 Apple 에게 물어보고, Apple 이 준 주소로만 이어집니다.
3. **스크립트를 끈 브라우저**: `go/appstore/index.html` 과 `go/play/index.html` 머리에 주석으로 접어 둔 `meta refresh` 한 줄의 주석을 풀고 같은 주소를 적습니다. 이 줄이 없어도 스크립트가 켜진 브라우저는 바로 갑니다.

## 설치 클릭률 읽는 법

설치 버튼은 상태와 무관하게 항상 `/go/appstore/` 나 `/go/play/` 로 갑니다. 첫 기수 경로에만 TestFlight 공개 테스트 진입이 보이고 `/go/testflight/cohort/`를 거쳐 Apple의 고정 공개 링크로 갑니다. 그래서 **설치 의도 클릭률 = (`/go/appstore/` + `/go/play/` + `/go/testflight/`) 페이지뷰 ÷ 랜딩 페이지뷰** 입니다. 스토어 둘과 TestFlight 클릭은 보고에서 따로 보여 심사 안내 클릭을 베타 설치 의도로 바꾸지 않습니다. 계기는 Cloudflare Web Analytics 이고 `asyncsite.com` 존에 자동 설치돼 있습니다. 이 저장소에는 계측 스크립트가 없고, 넣지도 않습니다.

배포 채널은 개인 식별값 대신 아래 고정 경로를 씁니다. `_redirects`가 같은 첫 화면을 200
rewrite로 내주므로 주소와 `requestPath`는 유지되고, `app.js`는 설치 버튼도 같은 채널의
`/go/` 경로로 이어 줍니다. 임의 문자열은 채널로 인정하지 않습니다.

| 채널 | 배포 주소 |
|---|---|
| 뉴스레터 | `https://tailf.asyncsite.com/from/newsletter/` |
| 그릿 라운지 | `https://tailf.asyncsite.com/from/lounge/` |
| 기수 채널 | `https://tailf.asyncsite.com/from/cohort/` |
| 외부 커뮤니티 | `https://tailf.asyncsite.com/from/community/` |
| 스레드 답글 링크 | `https://tailf.asyncsite.com/go/appstore/threads/` |
| 유튜브 설명 링크 | `https://tailf.asyncsite.com/go/appstore/youtube/` |
| 검색 지면(공고·회사·직무·기술) | `https://tailf.asyncsite.com/go/appstore/seo/` |
| GeekNews Show GN | `https://tailf.asyncsite.com/from/geeknews/` |
| OKKY 피드백 게시판 | `https://tailf.asyncsite.com/from/okky/` |
| 디스콰이엇 프로덕트·메이커로그 | `https://tailf.asyncsite.com/from/disquiet/` |
| velog 제작기 글 | `https://tailf.asyncsite.com/from/velog/` |
| 개발자 디스코드 서버(홍보 채널이 있는 곳) | `https://tailf.asyncsite.com/from/discord/` |

글이 회사 한 곳이나 공고 한 건을 다루면 채널 링크는 첫 화면 대신 그 지면으로 갑니다.
`/c/{companyId}/from/{채널}/`, `/p/{id}/from/{채널}/` 는 정본과 같은 지면이고 canonical 도
정본이며, 제목 아래 알림 두 문(앱, 웹 알림)과 모든 설치·알림 버튼이 같은 채널 경로
(`/go/appstore/{채널}/`, `/alerts/from/{채널}/`)로 이어집니다. 채널 이름은 `lib/seo.mjs`
`PAGE_SOURCES` 가 정본입니다. 제목 아래 알림 띠는 검색으로 온 정본 지면(`/c/{id}/`, `/p/{id}/`)에도 있고, 그쪽 문은 `/go/appstore/seo/` 와 `/alerts/from/company/`·`/alerts/from/posting/` 입니다. 앱의 건네기 링크(`/p/{id}`)는 제 모양을 유지합니다.

채널별 방문과 설치 클릭은 `/from/{채널}/`, `/go/appstore/{채널}/`,
`/go/play/{채널}/`, `/go/testflight/{채널}/` 페이지뷰로 집계합니다. 이름, 이메일, 조건, 기기 식별자는 붙이지 않습니다.

익명 백테스트는 첫 기술 선택 때 `/signal/backtest-started/{채널}/`, 두 기술 이상을
고르고 실제 집계가 끝났을 때 `/signal/backtest-completed/{채널}/`의 숨은 noindex 문서를
세션당 한 번 불러옵니다. Cloudflare Web Analytics에는 이 고정 경로만 남으며, 고른 기술과
조건은 보내지 않습니다. 시작률은 시작/방문, 완료율은 완료/시작으로 읽습니다.

`_headers`의 `Referrer-Policy: no-referrer`가 모든 페이지와 숨은 신호 문서에
적용됩니다. 유입 주소에 임의 쿼리가 붙어도 API, 신호, RUM 요청의
Referer로 전달되지 않게 하는 경계입니다. Cloudflare는 CDN과 보안과 웹 성능
집계를 맡으며, 봇 검사 상태용 `cf_clearance` 쿠키를 설정할 수 있습니다.
`/signal/*`에는 `X-Robots-Tag: noindex, nofollow`도 적용해 알려지지 않은
신호 하위 경로가 첫 화면 fallback으로 응답하더라도 검색 결과에 남지 않게 합니다.

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

## 검색 지면

공고 한 건, 회사, 직무, 기술마다 검색에 걸리는 지면이 있습니다. 모든 지면의 설치 버튼은 `/go/appstore/seo/` 와 `/go/play/seo/` 로 이어져 검색 유입이 따로 세어집니다.

| 주소 | 어디서 그리나 | 무엇 |
|---|---|---|
| `/p/{id}/` | `functions/p/[[path]].js` → `lib/posting-page.mjs` (엣지 캐시 5분, 아래) | 공고 한 건. `JobPosting` JSON-LD. 내려간 공고는 410 과 noindex, 마감일이 지난 공고는 noindex |
| `/p/{id}` | 같은 함수 | 앱의 「건네기」 링크. 건네받은 공고라고 말하고, canonical 은 `/p/{id}/` |
| `/c/{companyId}/` | `functions/c/[[path]].js` → `lib/company-page.mjs` (엣지 캐시 5분, 아래) | 회사 한 곳의 열린 개발 공고. 열린 공고가 없으면 noindex |
| `/c/`, `/r/…`, `/t/…` | `scripts/build-seo.mjs` (배포 직전 생성, 커밋하지 않음) | 회사 목록, 직무별, 기술별(공고 20건 이상) 목록 |
| `/sitemap.xml` | 같은 스크립트 | 사이트맵 인덱스. `sitemap-pages.xml` 만 커밋하고 `sitemap-jobs.xml` `sitemap-companies.xml` `sitemap-hubs.xml` 은 생성 |

배포 워크플로는 push 때와 3시간마다 돌고, 생성 직후 바뀐 주소만 IndexNow 로 알립니다. 로컬에서 보려면 `node scripts/build-seo.mjs` 를 돌리고, 테스트는 `node --test tests/*.mjs` 입니다.

### 공개 API 를 부르는 함수와 엣지 캐시

공개 API 를 읽는 함수는 셋이고, 모두 `lib/edge-routes.mjs` 에서 `lib/edge-cache.mjs` 뒤에 섭니다. 데이터센터마다 Cache API 에 한 벌을 두고, 신선 기간 안에는 API 를 부르지 않으며, 지나면 낡은 벌을 바로 내주고 뒤에서 한 번만 다시 만듭니다(stale-while-revalidate). 다시 만들다 실패하면 낡은 벌을 계속 씁니다. 응답의 `X-Tailf-Edge`(HIT, STALE, MISS)와 `Age` 로 어느 쪽이 답했는지 봅니다.

| 주소 | 신선 | 낡은 벌 유지 | 원천 호출(한 벌 만들 때) |
|---|---|---|---|
| `/api/landing` | 10분 | 24시간 | 14회(첫 화면 공고 수 1, 백테스트 13페이지) |
| `/p/{id}`, `/p/{id}/` | 5분 | 1시간 | 1~2회 |
| `/c/{companyId}/` | 5분 | 1시간 | 1~3회 |

첫 화면은 `/api/landing` 한 번만 읽습니다. 백테스트 행은 예전에 브라우저가 13페이지를 걸어 만들던 것과 같은 규칙(`lib/landing-data.mjs`)으로 만들고, 기술 선택과 30일 창 계산은 그대로 `app.js` 에 있습니다. `/c/`, `/r/`, `/t/` 는 배포 때 만든 정적 파일이라 API 를 부르지 않습니다.


## 앱 없이 받기 (웹 알림)

`/alerts/` 에서 직무와 경력(필수), 근무지와 기술과 안 볼 회사(선택)를 고르고 받을 곳 하나(이메일, Slack 웹훅, Discord 웹훅)를 넣으면, 맞는 새 공고를 한 시간에 한 번까지 모아서 보냅니다. 맞는 게 없으면 보내지 않습니다.

| 조각 | 어디 |
|---|---|
| 신청 화면, 관리 화면(`?id&t`), 확인, 그만 받기 | `alerts/` (정적) |
| 신청·확인·관리 API | `functions/api/alerts/[[path]].js` → `lib/alerts/api.mjs` |
| 매칭 | `lib/alerts/match.mjs`. 앱 `matcher.dart` 의 직무·경력·근무지 규칙을 옮겼고, 웹은 공고가 고른 직무를 직접 가리켜야 보냅니다. 기술은 순서만 정합니다 |
| 발송 | `workers/alert-sender` (Cloudflare Worker, 매시 17분 cron) → `lib/alerts/sender.mjs` |
| 저장 | Workers KV `tailf-web-alerts` (binding `ALERTS`), Pages 와 Worker 가 같이 씁니다 |
| 메일 | Amazon SES `alerts@asyncsite.com`, 발송 전용 IAM 사용자 `tailf-web-alerts-mailer` |

- 새 공고는 공고 번호로 가립니다. 신청(이메일은 확인)한 순간의 최신 번호가 출발점이고, 한 번 보낸 번호는 다시 보내지 않습니다. 보내기 전에 기록을 먼저 쓰므로 중간에 죽어도 두 번 가지는 않습니다.
- 웹훅이 404·410 을 두 번 답하거나 어떤 실패든 다섯 번 이어지면 멈춥니다. 멈춘 신청은 30일 뒤 지웁니다.
- 이메일은 확인 링크를 눌러야 시작하고, 확인하지 않은 신청은 7일 뒤 KV 에서 사라집니다. 모든 메일에 RFC 8058 한 번 누르기 해지 헤더가 있습니다.
- 비밀값(`ALERTS_SECRET`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`)은 Pages 프로젝트와 Worker 양쪽에 같은 값으로 Cloudflare 에만 있습니다.
- 유입은 `/alerts/from/{source}/` 방문, `/signal/alerts-subscribed/{source}/` 신청, `/signal/alerts-confirmed/{source}/` 확인 페이지뷰로 셉니다. 경로 이름은 `lib/alerts/sources.mjs` 가 정본이고 `_redirects` 가 같은 목록을 가집니다. 마지막 발송 요약은 KV `state:last-run` 에 있습니다.
