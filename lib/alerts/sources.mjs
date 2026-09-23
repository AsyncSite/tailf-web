// Where a web alert subscriber came from, as a fixed path segment:
// /alerts/from/{source}/ for the visit, /signal/alerts-subscribed/{source}/ and
// /signal/alerts-confirmed/{source}/ for the two steps after it. Web Analytics
// counts those paths; the subscription keeps the same word so confirmed
// subscribers can be counted per source without anything personal.
// Arbitrary strings are not sources (README 「설치 클릭률 읽는 법」).
export const ALERT_SOURCES = [
  'landing', 'posting', 'company', 'hub', 'seo',
  'newsletter', 'lounge', 'cohort', 'community', 'threads', 'youtube',
];
