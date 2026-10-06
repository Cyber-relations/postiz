/* All text remains in the HTML. Search runs here, without transmitting queries. */
(() => {
  const form = document.getElementById('faq-search');
  if (!form) return;
  const query = document.getElementById('faq-query');
  const rows = [...document.querySelectorAll('.faq-item')];
  const sections = [...document.querySelectorAll('.faq-section')];
  const categories = [...document.querySelectorAll('.faq-category')];
  const resultStatus = document.getElementById('faq-result-status');
  const resetButton = document.querySelector('.faq-reset');
  const empty = document.querySelector('.faq-empty');
  const results = document.getElementById('faq-list');
  const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const index = new Map(rows.map(row => [row, normalize(row.textContent + ' ' + row.dataset.keywords)]));
  let category = 'all';
  let openBeforeSearch = null;

  function render() {
    const terms = normalize(query.value).split(' ').filter(Boolean);
    if (terms.length && !openBeforeSearch) openBeforeSearch = new Map(rows.map(row => [row, row.open]));
    let count = 0;
    rows.forEach(row => {
      const match = (category === 'all' || row.dataset.category === category) && terms.every(term => index.get(row).includes(term));
      row.hidden = !match;
      if (terms.length) row.open = match;
      else if (openBeforeSearch) row.open = openBeforeSearch.get(row);
      if (match) count++;
    });
    if (!terms.length) openBeforeSearch = null;
    sections.forEach(section => {
      const count = [...section.querySelectorAll('.faq-item')].filter(row => !row.hidden).length;
      section.hidden = count === 0;
      section.querySelector('.faq-section-count').textContent = count + '件';
    });
    categories.forEach(link => {
      if (link.dataset.filter === category) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    const name = category === 'all' ? 'すべての質問' : categories.find(link => link.dataset.filter === category).querySelector('.faq-category-name').textContent;
    resultStatus.textContent = terms.length ? '「' + query.value.trim() + '」の検索結果 ' : name + ' ';
    const number = document.createElement('strong');
    number.textContent = count + '件';
    resultStatus.append(number);
    resetButton.hidden = category === 'all' && terms.length === 0;
    empty.hidden = count !== 0;
  }

  function setHash(id, push = true) {
    if (location.hash === '#' + id) return;
    history[push ? 'pushState' : 'replaceState'](null, '', '#' + id);
  }

  function goTo(target, focus = false) {
    target.scrollIntoView({block: 'start', behavior: 'auto'});
    if (focus) {
      const summary = target.matches('details') ? target.querySelector('summary') : target;
      if (!summary.matches('summary')) summary.setAttribute('tabindex', '-1');
      summary.focus({preventScroll: true});
    }
  }

  function reset(focusInput = false) {
    query.value = '';
    category = 'all';
    render();
    setHash('faq-list');
    if (focusInput) query.focus({preventScroll: true});
  }

  function followHash(focus = false) {
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    if (!target || !target.matches('.faq-item,.faq-section,.faq-results')) return;
    query.value = '';
    category = target.dataset.category || 'all';
    render();
    if (target.matches('.faq-item')) target.open = true;
    goTo(target, focus);
  }

  categories.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    query.value = '';
    category = link.dataset.filter;
    render();
    const id = category === 'all' ? 'faq-list' : 'faq-' + category;
    setHash(id);
    goTo(document.getElementById(id), true);
  }));
  query.addEventListener('input', () => {
    category = 'all';
    render();
    // A filtered search should not leave a stale category or question in the URL.
    history.replaceState(null, '', location.pathname + location.search);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    render();
    goTo(results, true);
  });
  resetButton.addEventListener('click', () => {reset();goTo(results, true);});
  document.querySelector('.faq-empty-reset').addEventListener('click', () => {reset();goTo(results, true);});
  window.addEventListener('hashchange', () => followHash());
  window.addEventListener('popstate', () => {
    if (location.hash) followHash();
    else {query.value = '';category = 'all';render();}
  });
  form.hidden = false;
  render();
  followHash();
})();
