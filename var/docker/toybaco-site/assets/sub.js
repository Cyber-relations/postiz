/* トイバコ サブページ共通JS */
document.querySelectorAll('.maru').forEach(m => {
  m.addEventListener('click', () => {
    m.classList.remove('jump'); void m.offsetWidth; m.classList.add('jump');
  });
});

const io = new IntersectionObserver(es => {
  es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  });
}, { threshold: .16 });
document.querySelectorAll('.reveal, .compare2').forEach(el => io.observe(el));
document.querySelectorAll('.mk').forEach(el => {
  const mio = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) { setTimeout(() => el.classList.add('lit'), 350); mio.unobserve(el); } });
  }, { threshold: .6 });
  mio.observe(el);
});

const siteHeader = document.querySelector('header.site');
addEventListener('scroll', () => {
  siteHeader.classList.toggle('scrolled', scrollY > 8);
}, { passive:true });

const navToggle = document.getElementById('navToggle');
const siteMenu = document.getElementById('siteMenu');
if (navToggle && siteMenu) {
  let pendingMenuFocus = 0;
  const setMenuOpen = open => {
    cancelAnimationFrame(pendingMenuFocus);
    pendingMenuFocus = 0;
    siteMenu.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  };
  navToggle.setAttribute('aria-controls', siteMenu.id);
  navToggle.addEventListener('click', () => {
    const open = !siteMenu.classList.contains('open');
    setMenuOpen(open);
    if (open) {
      // Focus after the opening visibility change has been painted.
      pendingMenuFocus = requestAnimationFrame(() => {
        pendingMenuFocus = requestAnimationFrame(() => {
          pendingMenuFocus = 0;
          if (siteMenu.classList.contains('open')) siteMenu.querySelector('a[href]')?.focus();
        });
      });
    }
  });
  document.addEventListener('click', e => {
    if (siteMenu.classList.contains('open') && !e.target.closest('nav.menu') && !e.target.closest('.nav-toggle')) {
      setMenuOpen(false);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && siteMenu.classList.contains('open')) {
      e.preventDefault();
      setMenuOpen(false);
      navToggle.focus();
    }
  });
}

/* --- トイバコ相談チャット(Chatwoot 実ウィジェット) --- */
// toybaco_staging_site_v1: consultation preview sends no messages.
function openChat() {
  document.getElementById('toybaco-staging-chat-preview').showModal();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-open-chat]');
  if (!t) return;
  e.preventDefault();
  openChat(t.getAttribute('href'));
});
