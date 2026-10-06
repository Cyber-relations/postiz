/* Display filters only: article content and destinations are static HTML. */
(() => {
  const filters = document.querySelector('.guide-filters');
  if (!filters) return;
  const buttons = [...filters.querySelectorAll('button')];
  const articles = [...document.querySelectorAll('.guide-card')];
  const status = document.getElementById('guide-count');
  buttons.forEach(button => button.addEventListener('click', () => {
    const tag = button.dataset.guideFilter;
    let count = 0;
    articles.forEach(article => {
      const match = tag === 'all' || article.dataset.guideTag === tag;
      article.hidden = !match;
      if (match) count++;
    });
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const label = button.childNodes[0].textContent.trim();
    status.textContent = tag === 'all' ? '全' + count + '記事' : label + ' ' + count + '記事';
  }));
  filters.hidden = false;
})();
