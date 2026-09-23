// /alerts/confirm/ and /alerts/unsubscribe/. Both act only on a button press:
// mail scanners open links, and an open must not confirm or remove anything.
const $ = (id) => document.getElementById(id);
const step = document.querySelector('[data-step]').dataset.step;
const params = new URLSearchParams(location.search);
const id = params.get('id') || '';
const t = params.get('t') || '';
const go = $('step-go');

function next(text, href, label) {
  const p = $('step-next');
  p.textContent = text ? text + ' ' : '';
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    p.appendChild(a);
  }
  p.hidden = false;
}

function emitSignal(name, src) {
  const frame = document.createElement('iframe');
  frame.src = '/signal/' + name + '/' + (src && src !== 'direct' ? src + '/' : '');
  frame.title = '';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 8000);
}

if (!id || !t) {
  $('step-title').textContent = '링크가 온전하지 않아요.';
  $('step-body').textContent = '메일이나 메시지에 있는 링크를 다시 눌러 주세요.';
  go.hidden = true;
}

if (step === 'unsubscribe' && id && t) {
  next('', '/alerts/?id=' + encodeURIComponent(id) + '&t=' + encodeURIComponent(t), '조건 바꾸기 · 잠깐 쉬기');
}

go.addEventListener('click', async () => {
  go.disabled = true;
  $('form-msg').textContent = '처리하는 중이에요.';
  let data = null;
  try {
    const res = await fetch('/api/alerts/' + step, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, t }),
    });
    data = await res.json();
  } catch (e) {
    data = null;
  }
  go.disabled = false;
  if (!data || !data.ok) {
    $('form-msg').textContent = (data && data.error) || '잠시 문제가 생겼습니다. 조금 뒤에 다시 눌러 주세요.';
    $('form-msg').classList.add('err');
    return;
  }
  $('form-msg').textContent = '';
  go.hidden = true;
  if (step === 'confirm') {
    $('step-title').textContent = '받기 시작했어요';
    $('step-body').textContent = '지금부터 올라오는 공고 중 조건에 맞는 것이 있으면 한 시간에 한 번까지 모아서 보내요. 맞는 게 없는 시간에는 보내지 않아요.';
    next('조건 바꾸기와 그만 받기는 메일마다 있는 링크나', data.manage, '이 링크에서 할 수 있어요.');
    if (!data.already) emitSignal('alerts-confirmed', data.src);
  } else {
    $('step-title').textContent = '그만 받기로 했어요';
    $('step-body').textContent = '더 보내지 않아요. 받을 곳과 조건도 지웠어요.';
    next('다시 받고 싶어지면', '/alerts/', '여기서 새로 신청할 수 있어요.');
  }
});
