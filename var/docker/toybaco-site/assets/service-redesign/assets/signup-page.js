/* Proposal-only plan selection. Real entry URLs are preserved for implementation. */
(() => {
  let cycle = 'month';
  const labels = { free: '無料プランで試す', light: 'Lightで始める', standard: 'Standardで始める', pro: 'Proで始める' };
  const amounts = { light: 9800, standard: 19800, pro: 29800 };
  const setCycle = value => {
    cycle = value;
    document.querySelectorAll('[data-signup-cycle]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.signupCycle === cycle)));
    document.querySelectorAll('[data-month][data-year]').forEach(item => { item.textContent = item.dataset[cycle]; });
    document.querySelectorAll('[data-signup-annual]').forEach(item => { item.hidden = cycle !== 'year'; });
    document.getElementById('signup-billing-note').textContent = cycle === 'year'
      ? '年払いは1年分の一括前払いです。月額換算と年総額を表示しています'
      : '1ライセンスあたりの月額料金です';
    document.querySelectorAll('[data-signup-entry]:not([data-signup-entry="free"])').forEach(item => {
      const url = new URL(item.dataset.entryUrl);
      url.searchParams.set('cycle', cycle);
      item.dataset.entryUrl = url.href; item.href = url.href;
    });
  };
  document.querySelectorAll('[data-signup-cycle]').forEach(button => button.addEventListener('click', () => setCycle(button.dataset.signupCycle)));
  const params = new URLSearchParams(location.search);
  const selectedPlan = params.get('plan');
  if (Object.hasOwn(amounts, selectedPlan)) {
    setCycle(params.get('cycle') === 'year' ? 'year' : 'month');
    const chosen = document.getElementById(`plan-${selectedPlan}`);
    chosen.classList.add('signup-selected');
    const heading = chosen.querySelector('h3');
    const selected = document.createElement('p');
    selected.className = 'signup-selection-note';
    selected.setAttribute('role', 'status');
    selected.textContent = `${heading.textContent}が選択されています。支払周期と金額を確認してお申し込みください。`;
    document.querySelector('.signup-paid-grid').before(selected);
    if (!location.hash) document.getElementById('paid-plans').scrollIntoView();
  }
})();
