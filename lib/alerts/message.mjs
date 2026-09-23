// What one alert says, in each destination's own format.
//
// Every message names the conditions it answers, lists the postings as
// company · title · experience with a link to the tailf-web posting page, and
// ends with the manage link (change conditions, pause, stop). No tracking
// pixels and no per-person link parameters: the links are the plain /p/ pages.

import { SITE, esc, titleWithoutCompany, careerKo } from '../seo.mjs';
import { conditionsKo } from './match.mjs';

export const MAX_ITEMS = { email: 20, slack: 15, discord: 12 };

export function postingUrl(job) {
  return SITE + '/p/' + encodeURIComponent(String(job.id)) + '/';
}

export function manageUrl(id, token) {
  return SITE + '/alerts/?id=' + id + '&t=' + token;
}

export function unsubscribePageUrl(id, token) {
  return SITE + '/alerts/unsubscribe/?id=' + id + '&t=' + token;
}

export function oneClickUrl(id, token) {
  return SITE + '/api/alerts/unsubscribe?id=' + id + '&t=' + token;
}

export function confirmUrl(id, token) {
  return SITE + '/alerts/confirm/?id=' + id + '&t=' + token;
}

function item(match) {
  const job = match.job;
  return {
    company: String(job.company || '').trim(),
    title: titleWithoutCompany(job.title, job.company),
    career: careerKo(job),
    url: postingUrl(job),
    overlap: match.overlap || [],
  };
}

/** The line under a list that was cut to fit one message. */
export function restLine(rest) {
  return '외 ' + rest + '건이 더 있어요. 조건을 좁히면 한 번에 다 받을 수 있어요.';
}

function oneLine(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ---------- Slack ----------

// Slack mrkdwn needs only these three escaped; a title with <!channel> must
// not become a mention.
function slackEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackMessage({ matches, conditions, manage }) {
  const shown = matches.slice(0, MAX_ITEMS.slack).map(item);
  const rest = matches.length - shown.length;
  const head = '새 공고 ' + matches.length + '건 · ' + conditionsKo(conditions);
  const lines = shown.map((it) => {
    const label = slackEsc(oneLine((it.company ? it.company + ' · ' : '') + it.title, 90));
    const meta = [it.career, it.overlap.length ? it.overlap.join(', ') : ''].filter(Boolean).map((s) => slackEsc(oneLine(s, 60))).join(' · ');
    return '• <' + it.url + '|' + label + '>' + (meta ? '  ' + meta : '');
  });
  if (rest > 0) lines.push(slackEsc(restLine(rest)));
  const footer = '<' + manage + '|조건 바꾸기 · 그만 받기>';
  return {
    text: 'tailf ' + head,
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*tailf* ' + slackEsc(head) } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n').slice(0, 2900) } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: footer }] },
    ],
  };
}

export function slackStart({ conditions, manage }) {
  const text = 'tailf 새 공고 알림을 이 채널에 연결했어요. 조건은 ' + conditionsKo(conditions) +
    ' 이에요. 맞는 새 공고가 올라오면 한 시간에 한 번까지 모아서 보내요.';
  return {
    text,
    unfurl_links: false,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: slackEsc(text) } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: '<' + manage + '|조건 바꾸기 · 그만 받기>' }] },
    ],
  };
}

// ---------- Discord ----------

// Discord markdown: escape the characters that would break a [label](url)
// link or format text, and never let a title ping anyone.
function discordEsc(s) {
  return String(s).replace(/([\\*_~`|>\[\]()#-])/g, '\\$1').replace(/@/g, '@\u200b');
}

export function discordMessage({ matches, conditions, manage }) {
  const shown = matches.slice(0, MAX_ITEMS.discord).map(item);
  const rest = matches.length - shown.length;
  const lines = ['**tailf** 새 공고 ' + matches.length + '건 · ' + discordEsc(conditionsKo(conditions))];
  for (const it of shown) {
    const label = discordEsc(oneLine((it.company ? it.company + ' · ' : '') + it.title, 80));
    const meta = [it.career, it.overlap.length ? it.overlap.join(', ') : ''].filter(Boolean).map((s) => discordEsc(oneLine(s, 50))).join(' · ');
    lines.push('• [' + label + '](<' + it.url + '>)' + (meta ? ' ' + meta : ''));
  }
  if (rest > 0) lines.push(discordEsc(restLine(rest)));
  lines.push('[조건 바꾸기 · 그만 받기](<' + manage + '>)');
  let content = lines.join('\n');
  if (content.length > 1990) content = content.slice(0, 1990);
  // flags 4 = SUPPRESS_EMBEDS, so a list of links does not unfold into cards.
  return { content, allowed_mentions: { parse: [] }, flags: 4 };
}

export function discordStart({ conditions, manage }) {
  return {
    content: 'tailf 새 공고 알림을 이 채널에 연결했어요. 조건은 ' + discordEsc(conditionsKo(conditions)) +
      ' 이에요. 맞는 새 공고가 올라오면 한 시간에 한 번까지 모아서 보내요.\n[조건 바꾸기 · 그만 받기](<' + manage + '>)',
    allowed_mentions: { parse: [] },
    flags: 4,
  };
}

// ---------- Email ----------

function emailShell(inner, footer) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#F7FBF3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7FBF3;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E6EDE0;border-radius:16px;">
<tr><td style="padding:24px 22px;font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;color:#17240F;line-height:1.6;">
<p style="margin:0 0 14px;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:16px;color:#17240F;">tail<span style="color:#2E7D0F;">&nbsp;-f</span></p>
${inner}
</td></tr></table>
<p style="max-width:600px;margin:14px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;font-size:12.5px;line-height:1.6;color:#64725B;">${footer}</p>
</td></tr></table></body></html>`;
}

export function digestEmail({ matches, conditions, manage, unsubscribePage }) {
  const shown = matches.slice(0, MAX_ITEMS.email).map(item);
  const rest = matches.length - shown.length;
  const cond = conditionsKo(conditions);
  const subject = '새 공고 ' + matches.length + '건 · ' + oneLine(cond, 60);
  const rows = shown.map((it) => {
    const meta = [it.company, it.career, it.overlap.length ? '겹친 기술 ' + it.overlap.join(', ') : ''].filter(Boolean).map(esc).join(' · ');
    return `<tr><td style="padding:12px 0;border-top:1px solid #E6EDE0;"><a href="${esc(it.url)}" style="font-size:16px;font-weight:700;color:#17240F;text-decoration:none;">${esc(it.title)}</a><div style="margin-top:2px;font-size:13.5px;color:#5C6B51;">${meta}</div></td></tr>`;
  }).join('');
  const inner = `<h1 style="margin:0;font-size:20px;line-height:1.4;letter-spacing:-0.02em;">새로 올라온 공고 ${matches.length}건이 조건에 맞아요</h1>
<p style="margin:6px 0 10px;font-size:14px;color:#5C6B51;">${esc(cond)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
${rest > 0 ? `<p style="margin:10px 0 0;font-size:13.5px;color:#5C6B51;">${esc(restLine(rest))}</p>` : ''}`;
  const footer = `tailf 웹에서 이 주소로 새 공고 알림을 받기로 하셔서 보내드려요. 맞는 새 공고가 있을 때만, 한 시간에 한 번까지 보내요.<br><a href="${esc(manage)}" style="color:#2E7D0F;">조건 바꾸기</a> · <a href="${esc(unsubscribePage)}" style="color:#2E7D0F;">그만 받기</a>`;
  const text = [
    '새로 올라온 공고 ' + matches.length + '건이 조건에 맞아요',
    cond,
    '',
    ...shown.map((it) => (it.company ? it.company + ' · ' : '') + it.title + ' (' + it.career + ')\n' + it.url),
    rest > 0 ? '\n' + restLine(rest) : '',
    '',
    '조건 바꾸기: ' + manage,
    '그만 받기: ' + unsubscribePage,
  ].join('\n');
  return { subject, html: emailShell(inner, footer), text };
}

export function confirmEmail({ conditions, confirm }) {
  const cond = conditionsKo(conditions);
  const subject = 'tailf 새 공고 알림 받기를 확인해 주세요';
  const inner = `<h1 style="margin:0;font-size:20px;line-height:1.4;letter-spacing:-0.02em;">이 주소로 새 공고 알림을 받을까요?</h1>
<p style="margin:8px 0 0;font-size:15px;color:#5C6B51;">조건: ${esc(cond)}</p>
<p style="margin:8px 0 0;font-size:15px;color:#5C6B51;">아래 버튼을 누르면 그때부터 올라오는 공고 중 조건에 맞는 것만, 한 시간에 한 번까지 모아서 보내요.</p>
<p style="margin:20px 0 4px;"><a href="${esc(confirm)}" style="display:inline-block;padding:13px 22px;border-radius:14px;background:#58CC02;color:#17240F;font-weight:700;font-size:16px;text-decoration:none;">받기 확인</a></p>`;
  const footer = '직접 요청하지 않으셨다면 이 메일은 그냥 두셔도 돼요. 확인하지 않은 요청은 7일 뒤에 지워지고, 그 전까지 이 주소로 공고를 보내지 않아요.';
  const text = '이 주소로 tailf 새 공고 알림을 받을까요?\n조건: ' + cond + '\n\n받기 확인: ' + confirm + '\n\n' + footer;
  return { subject, html: emailShell(inner, footer), text };
}
