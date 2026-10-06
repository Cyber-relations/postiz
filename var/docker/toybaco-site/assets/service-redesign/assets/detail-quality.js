/* Progressive enhancement: diagrams remain visible without JS or motion. */
(() => {
  const narrow = matchMedia('(max-width: 760px)');
  document.querySelectorAll('.inquiry-cases, .posting-cases').forEach((group, groupIndex) => {
    const cards = Array.from(group.querySelectorAll('article'));
    const inquiry = group.classList.contains('inquiry-cases');
    const labels = inquiry
      ? [['会社', '複数サービス'], ['店舗', '接客の合間に'], ['管理本部', '相談を整理']]
      : [['会社', '動画で紹介'], ['店舗', '営業時間を案内'], ['会社・本部', '公開前に確認']];
    const controls = document.createElement('div');
    controls.className = 'detail-case-tabs';
    controls.setAttribute('role', 'tablist');
    controls.setAttribute('aria-label', inquiry ? '問い合わせ管理の利用例' : 'SNS投稿管理の利用例');
    controls.hidden = true;
    let selected = 0;
    const buttons = cards.map((card, index) => {
      const button = document.createElement('button');
      const label = document.createElement('b');
      const caption = document.createElement('small');
      const prefix = `case-${inquiry ? 'inquiry' : 'posting'}-${groupIndex}-${index}`;
      label.textContent = labels[index][0];
      caption.textContent = labels[index][1];
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.id = `${prefix}-tab`;
      card.id = `${prefix}-panel`;
      button.setAttribute('aria-controls', card.id);
      button.append(label, caption);
      button.addEventListener('click', () => select(index));
      button.addEventListener('keydown', event => {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1
          : (selected + (event.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length;
        select(next);
        buttons[next].focus();
      });
      controls.append(button);
      return button;
    });
    function select(index) {
      selected = index;
      buttons.forEach((button, position) => {
        button.setAttribute('aria-selected', String(position === selected));
        button.tabIndex = position === selected ? 0 : -1;
        cards[position].hidden = narrow.matches && position !== selected;
      });
    }
    function update() {
      controls.hidden = !narrow.matches;
      cards.forEach((card, index) => {
        if (narrow.matches) {
          card.setAttribute('role', 'tabpanel');
          card.setAttribute('aria-labelledby', buttons[index].id);
          card.tabIndex = 0;
        } else {
          card.removeAttribute('role');
          card.removeAttribute('aria-labelledby');
          card.removeAttribute('tabindex');
        }
      });
      select(selected);
    }
    group.before(controls);
    update();
    narrow.addEventListener('change', update);
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || !('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll('.detail-hero-art, .inbox-comparison, .posting-comparison, .together-illustration');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      if (reduced.matches || !entry.target.animate) continue;
      entry.target.animate(
        [{ transform: 'translateY(12px)', opacity: .7 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)' }
      );
    }
  }, { threshold: .12 });
  targets.forEach(target => observer.observe(target));
})();
