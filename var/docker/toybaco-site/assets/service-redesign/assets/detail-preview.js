/* Proposal controls for service-detail pages. Demo tabs have their own controllers. */
(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const menu = document.getElementById('menu');
  if (menuButton && menu) {
    // The mobile menu opens below its button but comes before it in the page, so opening it moves the focus to its first
    // item, and closing it returns a focus left inside (on items that are hidden now) to the button.
    const setMenu = open => {
      const wasOpen = menu.classList.contains('open');
      const focusInside = menu.contains(document.activeElement);
      menuButton.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('open', open);
      if (open) {
        const first = menu.querySelector('a, summary, button, [tabindex]:not([tabindex="-1"])');
        if (first) first.focus();
      } else if (wasOpen && focusInside) {
        menuButton.focus();
      }
    };
    menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
    // Escape closes the open menu and returns to the button. An open group inside it closes first (site-navigation.js).
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.classList.contains('open') || menu.querySelector('details[open]')) return;
      setMenu(false);
      menuButton.focus();
    });
  }
})();
