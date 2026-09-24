/* Plan selection and billing display. Preview mode intercepts external actions. */
(() => {
  const data = JSON.parse(document.getElementById('lp-candidate-data').textContent);
  const params = new URLSearchParams(location.search);
  const setCycle = cycle => {
    document.querySelectorAll('[data-lp-cycle]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lpCycle === cycle)));
    document.querySelectorAll('[data-lp-month]').forEach(el => { el.textContent = cycle === 'year' ? el.dataset.lpYear : el.dataset.lpMonth; });
    document.querySelectorAll('[data-lp-plan-link]').forEach(link => {
      const url = new URL(link.href);
      if (link.dataset.lpPlanLink !== 'free') url.searchParams.set('cycle', cycle);
      link.href = url.origin === location.origin ? url.pathname + url.search + url.hash : url.href;
    });
  };
  document.querySelectorAll('[data-lp-cycle]').forEach(button => button.addEventListener('click', () => setCycle(button.dataset.lpCycle)));
  setCycle(params.get('cycle') === 'year' ? 'year' : 'month');
  const selected = data.plans.find(plan => plan.plan_id === params.get('plan'));
  const message = document.getElementById('contact-form')?.elements.message;
  if (message && selected && !message.value) {
    const cycle = selected.free ? '' : `（${params.get('cycle') === 'year' ? '年払い' : '月払い'}）`;
    message.value = `${selected.name}${cycle}の利用について相談したいです。`;
  }
  const selectedCopy = document.getElementById('lp-selected-plan');
  if (selectedCopy) selectedCopy.textContent = selected ? `${selected.name}を選択中。下の条件をご確認ください。` : '無料プランまたは有料プランを選び、金額と利用条件をご確認ください。';
  if (params.has('version') && params.get('version') !== data.version) {
    const notice = document.getElementById('lp-version-notice');
    if (notice) { notice.hidden = false; notice.textContent = 'リンク先の料金と現在の料金が異なります。表示中の料金と条件をご確認ください。'; }
  }
  const selector = document.getElementById('lp-selector');
  if (selector) {
    const update = () => {
      const values = [...selector.querySelectorAll('[data-limit]')];
      const output = document.getElementById('lp-result');
      if (values.some(input => !input.validity.valid || input.value === '')) { output.textContent = '各項目に0以上の整数を入力してください。'; return; }
      const automatic = document.getElementById('lp-auto-reply').checked;
      const eligible = data.plans.filter(plan => (!automatic || plan.automatic) && values.every(input => plan.limits[input.dataset.limit] >= Number(input.value)));
      const plan = eligible[0];
      output.replaceChildren();
      if (!plan) { output.textContent = '入力条件を通常枠で満たすプランはありません。AI追加パックや必要な接続数を料金表でご確認ください。'; return; }
      output.append(`通常枠で条件を満たす最小プラン：${plan.name}。1店舗・月払い ${new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(plan.amount)}（税別）。 `);
      const link = document.createElement('a'); link.href = `/signup/?plan=${plan.plan_id}&version=${data.version}${plan.plan_id === 'free' ? '' : '&cycle=month'}`; link.textContent = 'このプランで始める'; output.append(link);
    };
    selector.addEventListener('input', update); update();
  }
  document.body.dataset.lpReady = 'true';
  if (!data.preview) return;
  const dialog = document.getElementById('lp-preview-dialog');
  let previousFocus;
  const showPreview = () => { previousFocus = document.activeElement; if (!dialog.open) dialog.showModal(); };
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-preview-action], [data-open-chat]');
    const link = event.target.closest('a[href]');
    const external = link && new URL(link.href).origin !== location.origin;
    if (action || external) { event.preventDefault(); event.stopImmediatePropagation(); showPreview(); }
  }, true);
  document.addEventListener('submit', event => { event.preventDefault(); showPreview(); }, true);
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => previousFocus?.focus());
  window.openChat = showPreview;
})();
