(() => {
  'use strict';
  const form = document.getElementById('contact-form');
  if (!form) return;
  const editing = document.getElementById('contact-editing');
  const review = document.getElementById('contact-review');
  const done = document.getElementById('contact-done');
  const error = document.getElementById('contact-error');
  const send = document.getElementById('contact-send');
  const back = document.getElementById('contact-back');
  const steps = document.querySelectorAll('[data-contact-step]');
  let payload;
  let busy = false;
  let uncertain = false;
  const endpoint = form.dataset.endpoint;
  document.getElementById('contact-confirm').disabled = false;
  const live = location.origin === 'https://staging.toybaco.jp' && /^https:\/\/[a-z0-9]+\.execute-api\.ap-northeast-1\.amazonaws\.com\/contact$/.test(endpoint);
  const topic = new URLSearchParams(location.search).get('topic');
  if ([...form.elements.topic.options].some(option => option.value === topic)) form.elements.topic.value = topic;

  const notify = (name, detail = {}) => form.dispatchEvent(new CustomEvent(name, { detail }));
  function step(number) {
    steps.forEach((item, index) => {
      if (index + 1 === number) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  }
  function showError(message, type = 'api', field = 'form') {
    notify('toybaco:error', { type, field });
    error.textContent = message;
    error.hidden = false;
    error.focus();
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    error.hidden = true;
    if (!form.reportValidity()) return;
    for (const key of ['name', 'email', 'message']) {
      if (!form.elements[key].value.trim()) {
        showError('必須項目を入力してください。', 'validation', key);
        form.elements[key].focus();
        return;
      }
    }
    const fields = new FormData(form);
    payload = Object.fromEntries(['name', 'company', 'email', 'topic', 'message', 'website'].map(key => [key, String(fields.get(key) || '').trim()]));
    payload.consent = fields.get('consent') === 'on';
    payload.request_id = crypto.randomUUID();
    document.querySelectorAll('[data-review]').forEach(item => {
      const key = item.dataset.review;
      item.textContent = key === 'topic' ? form.elements.topic.selectedOptions[0].textContent : payload[key] || '未記入';
    });
    editing.hidden = true;
    review.hidden = false;
    step(2);
    document.getElementById('contact-review-title').focus();
    notify('toybaco:review-shown');
  });
  back.addEventListener('click', () => {
    if (busy || uncertain) return;
    review.hidden = true;
    editing.hidden = false;
    error.hidden = true;
    step(1);
    form.elements.name.focus();
  });
  send.addEventListener('click', async () => {
    if (busy || !payload) return;
    if (!live) {
      showError('この確認用画面からは送信できません。入力内容は送信されていません。', 'system');
      return;
    }
    busy = true;
    send.disabled = true;
    back.disabled = true;
    send.textContent = uncertain ? '送信状況を確認中…' : '送信中…';
    error.hidden = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal, credentials: 'omit' });
      const data = await result.json();
      if (result.ok && data.code === 'sent' && data.receipt === payload.request_id) {
        notify('toybaco:accepted', { receipt: data.receipt, topic: payload.topic });
        review.hidden = true;
        done.hidden = false;
        document.getElementById('contact-receipt').textContent = data.receipt;
        document.getElementById('contact-reply-email').textContent = payload.email;
        form.reset();
        payload = null;
        step(3);
        document.getElementById('contact-done-title').focus();
        return;
      }
      if (data.code === 'delivery_pending' || data.code === 'request_changed') {
        uncertain = true;
        showError(`送信状況を確認できていません。下のボタンで状況を再確認できます。解消しない場合は、受付番号 ${payload.request_id} を添えてチャットでお知らせください。`);
      } else if (data.code === 'rate_limited' || result.status === 429) {
        showError('短時間の送信が続いています。しばらく時間をおいて、もう一度お試しください。お急ぎの場合はチャットをご利用ください。');
      } else if (data.code === 'invalid_fields' || data.code === 'invalid_request') {
        showError('入力内容を確認してください。メールアドレスの形式や文字数をご確認のうえ、再度お試しください。');
      } else if (data.code === 'send_failed' || data.code === 'temporarily_unavailable') {
        if (!uncertain) payload.request_id = crypto.randomUUID();
        showError('送信できませんでした。入力内容はそのまま残っています。時間をおいて再度お試しいただくか、チャットでご相談ください。');
      } else {
        throw new Error('unexpected_response');
      }
    } catch (_) {
      uncertain = true;
      showError('通信が途切れたため、送信結果を確認できませんでした。入力内容を保持しています。下のボタンで送信状況を確認してください。', 'network');
    } finally {
      clearTimeout(timer);
      busy = false;
      send.disabled = false;
      back.disabled = uncertain;
      send.textContent = uncertain ? '送信状況を確認する' : 'この内容で送信する';
    }
  });
  window.addEventListener('beforeunload', event => {
    if (busy || uncertain && payload) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
})();
