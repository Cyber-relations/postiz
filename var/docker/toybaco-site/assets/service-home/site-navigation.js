const navigation = document.getElementById('menu');
const navigationToggle = document.querySelector('.menu-toggle');
// Catch taps over page content, including embedded animation frames.
const navigationBackdrop = document.createElement('div');
navigationBackdrop.className = 'menu-backdrop';
navigationBackdrop.setAttribute('aria-hidden', 'true');
document.querySelector('.site-header').after(navigationBackdrop);
const navigationGroups = [...navigation.querySelectorAll('.nav-group')];
function closeNavigationGroups(except) {
  navigationGroups.forEach(group => { if (group !== except) group.open = false; });
}
navigationGroups.forEach(group => {
  group.addEventListener('toggle', () => {
    if (group.open) closeNavigationGroups(group);
  });
});
document.addEventListener('click', event => {
  if (!navigation.contains(event.target)) {
    closeNavigationGroups();
    if (!navigationToggle.contains(event.target)) {
      navigation.classList.remove('open');
      navigationToggle.setAttribute('aria-expanded', 'false');
    }
  }
});
navigation.addEventListener('click', event => {
  if (event.target.closest('a')) closeNavigationGroups();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openGroup = navigationGroups.find(group => group.open);
  if (openGroup) {
    closeNavigationGroups();
    openGroup.querySelector('summary').focus();
  } else if (navigation.classList.contains('open')) {
    navigation.classList.remove('open');
    const toggle = document.querySelector('.menu-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }
});
