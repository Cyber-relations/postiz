/* Proposal-only contact flow. No network, analytics, storage, chat, or delivery calls. */
(() => {
  'use strict';
  const form = document.getElementById('contact-form');
  const editing = document.getElementById('contact-editing');
  const review = document.getElementById('contact-review');
  const done = document.getElementById('contact-done');
  const error = document.getElementById('contact-error');
  const steps = [...document.querySelectorAll('[data-contact-step]')];
  const confirm = document.getElementById('contact-confirm');
  function showStep(number) {
    [editing, review, done].forEach((element, index) => element.hidden = index !== number - 1);
    steps.forEach((element, index) => {
      if (index === number - 1) element.setAttribute('aria-current', 'step');
      else element.removeAttribute('aria-current');
    });
  }
  confirm.disabled = false;
  const topic = new URLSearchParams(location.search).get('topic');
  if ([...form.elements.topic.options].some(option => option.value === topic)) form.elements.topic.value = topic;
  form.addEventListener('submit', event => {
    event.preventDefault();
    error.hidden = true;
    if (!form.reportValidity()) return;
    for (const key of ['name', 'email', 'message']) {
      if (!form.elements[key].value.trim()) {
        error.textContent = '必須項目を入力してください。';
        error.hidden = false;
        form.elements[key].focus();
        return;
      }
    }
    document.querySelectorAll('[data-review]').forEach(element => {
      const field = form.elements[element.dataset.review];
      element.textContent = field.name === 'topic' ? field.selectedOptions[0].textContent : field.value.trim() || '未記入';
    });
    showStep(2);
    document.getElementById('contact-review-title').focus();
  });
  document.getElementById('contact-back').addEventListener('click', () => {
    error.hidden = true;
    showStep(1);
    form.elements.name.focus();
  });
  document.getElementById('contact-send').addEventListener('click', () => {
    error.textContent = 'この確認用画面からは送信できません。入力内容は送信されていません。';
    error.hidden = false;
    error.focus();
  });
  // Design fixtures are entered by a review URL, without checking consent or submitting the form.
  const fixture = new URLSearchParams(location.search).get('preview');
  if (['review', 'done', 'error'].includes(fixture)) {
    const note = document.createElement('p');
    note.className = 'design-state-note';
    note.textContent = '送信は行わないデザイン確認用の表示です。表示内容はサンプルです。';
    document.querySelector('.inquiry-page').prepend(note);
    const sample = { name: '山田 太郎', company: '株式会社〇〇 / 〇〇店', email: 'name@example.com', topic: 'サービス・料金について', message: '会社での導入を検討しています。サービスの使い方と料金について相談したいです。' };
    document.querySelectorAll('[data-review]').forEach(element => element.textContent = sample[element.dataset.review]);
    if (fixture === 'review' || fixture === 'error') showStep(2);
    if (fixture === 'done') {
      showStep(3);
      document.getElementById('contact-reply-email').textContent = sample.email;
      document.getElementById('contact-receipt').textContent = '00000000-0000-4000-8000-000000000000';
    }
    if (fixture === 'error') {
      error.textContent = 'この確認用画面からは送信できません。入力内容は送信されていません。';
      error.hidden = false;
    }
  }
})();
