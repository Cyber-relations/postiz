/* Billing display and reviewed application entry links. */
(() => {
  const buttons = [...document.querySelectorAll('[data-billing]')];
  const note = document.getElementById('billing-note');
  const labels = {free:'無料プランで試す',light:'Light',standard:'Standard',pro:'Pro'};
  buttons.forEach(button => button.addEventListener('click', () => {
    const cycle = button.dataset.billing;
    buttons.forEach(item => item.setAttribute('aria-pressed',String(item === button)));
    document.querySelectorAll('[data-month][data-year]').forEach(item => {
      item.textContent = cycle === 'year' ? item.dataset.year : item.dataset.month;
    });
    document.querySelectorAll('[data-annual]').forEach(item => item.hidden = cycle !== 'year');
    document.querySelectorAll('[data-price-plan]').forEach(item => {
      const plan = item.dataset.pricePlan;
      if(plan !== 'free'){const url=new URL(item.href);url.searchParams.set('cycle',cycle);item.href=url.href;}
    });
    note.textContent = cycle === 'year'
      ? '年払いは1年分の一括前払いです。月額換算と実際に支払う年総額を表示しています'
      : '表示は1ライセンスあたりの月額料金です';
  }));
})();
