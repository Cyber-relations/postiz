/* The hero reuses the page font and Remotion PlayerRef; it does not load fonts. */
(() => {
  const host = document.getElementById('heroMovie');
  const button = document.getElementById('hero-motion-toggle');
  if (!host || !button) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let player = null;
  let userPaused = false;
  let explicitPlay = false;
  let visible = !('IntersectionObserver' in window);
  let fontsReady = !document.fonts;

  const sync = () => {
    const playing = Boolean(player && player.isPlaying());
    host.dataset.playing = String(playing);
    button.textContent = playing ? '一時停止' : '再生';
    button.setAttribute('aria-pressed', String(!playing));
    button.disabled = !player;
  };
  const reconcile = () => {
    if (!player) return;
    const shouldPlay = fontsReady && visible && !document.hidden && !userPaused &&
      (!preference.matches || explicitPlay);
    if (shouldPlay) player.play();
    else player.pause();
    sync();
  };
  const frame = (event) => { host.dataset.frame = String(event.detail.frame); };
  const events = { play: sync, pause: sync, timeupdate: frame, seeked: frame };

  window.initializeToybacoHeroPlayer = (next) => {
    if (player === next) return;
    if (player) Object.entries(events).forEach(([name, listener]) =>
      player.removeEventListener(name, listener));
    player = next;
    if (player) {
      Object.entries(events).forEach(([name, listener]) =>
        player.addEventListener(name, listener));
      host.dataset.frame = String(player.getCurrentFrame());
      reconcile();
    } else sync();
  };
  button.addEventListener('click', () => {
    if (!player) return;
    userPaused = player.isPlaying();
    explicitPlay = !userPaused;
    reconcile();
  });
  const motionChanged = () => {
    explicitPlay = false;
    if (preference.matches && player) {
      player.pause();
      player.seekTo(230);
    }
    reconcile();
  };
  if (preference.addEventListener) preference.addEventListener('change', motionChanged);
  else preference.addListener(motionChanged);
  document.addEventListener('visibilitychange', reconcile);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      reconcile();
    }, { threshold: 0.1 });
    observer.observe(host);
  }
  if (document.fonts) document.fonts.ready.then(() => {
    fontsReady = true;
    reconcile();
  });
  sync();
})();
