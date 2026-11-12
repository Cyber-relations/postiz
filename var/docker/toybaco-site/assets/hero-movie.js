/* Product demo composed from the site's existing, local tour. */
(() => {
  const host = document.getElementById('heroMovie');
  const frame = document.getElementById('hero-tour-frame');
  const button = document.getElementById('hero-motion-toggle');
  if (!host || !frame || !button) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const durations = [4600, 5400, 8000, 7600, 8800, 4200];
  const closing = document.createElement('div');
  const logo = document.querySelector('.site-header .logo img')?.cloneNode(true);
  const caption = document.createElement('p');
  caption.textContent = '無料プランから試せます';
  Object.assign(caption.style, {margin: '0', fontSize: 'clamp(14px, 2vw, 22px)', fontWeight: '700'});
  Object.assign(closing.style, {position: 'absolute', inset: '0', display: 'none',
    placeContent: 'center', gap: '16px', textAlign: 'center', background: 'inherit'});
  host.style.position = 'relative';
  if (logo) {
    Object.assign(logo.style, {width: '180px', maxWidth: '100%', height: 'auto', margin: '0 auto'});
    closing.append(logo);
  }
  closing.append(caption);
  closing.setAttribute('aria-hidden', 'true');
  host.append(closing);
  let scene = 1;
  let loaded = false;
  let visible = !('IntersectionObserver' in window);
  let userPaused = false;
  let explicitPlay = false;
  let playing = false;
  let timer = null;
  let remaining = durations[0];
  const send = (type, values) => frame.contentWindow?.postMessage({type, ...values}, location.origin);
  const renderScene = () => {
    const ending = scene === durations.length;
    frame.style.visibility = ending ? 'hidden' : 'visible';
    closing.style.display = ending ? 'grid' : 'none';
    closing.setAttribute('aria-hidden', String(!ending));
    send('tour-pause', {paused: ending || !playing});
    if (frame.contentDocument?.body) frame.contentDocument.body.dataset.heroScene = String(scene);
    if (!ending) send('tour-scene', {scene});
  };
  const sync = () => {
    host.dataset.playing = String(playing);
    host.dataset.scene = String(scene);
    button.textContent = playing ? '一時停止' : '再生';
    button.setAttribute('aria-pressed', String(!playing));
    button.disabled = !loaded;
  };
  const schedule = () => {
    timer = setTimeout(() => {
      timer = null;
      if (!playing) return;
      scene = scene % durations.length + 1;
      remaining = durations[scene - 1];
      renderScene();
      sync();
      schedule();
    }, remaining);
  };
  const reconcile = () => {
    const next = loaded && visible && !document.hidden && !userPaused && (!motion.matches || explicitPlay);
    if (next !== playing) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        remaining = durations[scene - 1];
      }
      playing = next;
      renderScene();
      if (playing) schedule();
    }
    sync();
  };
  const fit = () => {
    if (!loaded) return;
    const small = host.clientWidth < 440;
    const width = small ? 420 : 700;
    const height = 460;
    host.style.aspectRatio = `${width} / ${height}`;
    host.parentElement.style.aspectRatio = host.style.aspectRatio;
    const root = frame.contentDocument.documentElement;
    root.style.setProperty('--hero-width', width + 'px');
    root.style.setProperty('--hero-height', height + 'px');
    root.style.setProperty('--hero-scale', Math.min(host.clientWidth / width, host.clientHeight / height));
  };
  const ready = () => {
    if (loaded) return;
    loaded = true;
    const doc = frame.contentDocument;
    // Reuse the owned product photo already used by the site's posting preview.
    doc.querySelector('.pv-text').textContent = '【新商品】ネイビーのポーチが入荷しました。商品の詳細はプロフィールのリンクからご覧いただけます。';
    doc.querySelector('.pv-media span:last-child').textContent = 'pouch.jpg';
    for (const id of ['q1', 'q2', 'q3']) {
      const card = doc.getElementById(id);
      const label = [...card.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
      if (label) label.textContent = '【新商品】ネイビーのポーチ…';
    }
    const closeup = doc.createElement('link');
    closeup.rel = 'stylesheet';
    closeup.href = '/assets/service-redesign/assets/feature-demo.css';
    doc.head.append(closeup);
    const style = doc.createElement('style');
    style.textContent = `
      html{font-size:22px}
      #canvas{width:var(--hero-width);height:var(--hero-height);padding:0;transform:scale(var(--hero-scale))!important}
      .app,.app-wrap{height:var(--hero-height)!important}
      .app-body{grid-template-columns:220px minmax(0,1fr)!important}
      .post-panel{left:0}.msgs{padding:12px;gap:8px}.m{max-width:92%}
      .pp-head{padding-right:52px}
      .pv-thumb{background:url('/assets/service-redesign/assets/posting-sample-product.jpg') center/cover}
      .pv-thumb::after{content:none}
      .app-search{font-size:14px}.app-titlebar{padding:8px 12px}
      .pcal-comp{width:58%;top:43px}
      body[data-hero-scene="5"] #msgsMain > :nth-child(-n+4){display:none}
      @media(max-width:440px){
        .app-side{display:none!important}.app-body{grid-template-columns:1fr!important}
        body[data-hero-scene="1"] .app-side{display:block!important}
        body[data-hero-scene="1"] .app-main{display:none}
        .app-search{max-width:none}.ghost{display:none}.mmeta{font-size:12px}
        .chat-head{padding:8px 12px}.msgs{padding:8px 12px;gap:8px}
        .composer{margin:0 8px 8px}.composer .ctabs{padding-top:0}
        .composer .crow{padding:4px 8px}.composer .tools{display:none}
        .pp-cols{padding:8px;display:block}.pv-comp{padding:12px;gap:8px}
        .pv-queue{display:none}.pp-cols:has(#q1.shown) .pv-comp{display:none}
        .pp-cols:has(#q1.shown) .pv-queue{display:flex}
        .pv-text{font-size:.76rem}.pv-foot{margin-top:8px}
        .pv-note{font-size:12px}.qcard{min-height:48px}
        .pcal-comp{width:100%}.pv-head{padding:8px}.pv-top{gap:8px}
      }`;
    doc.head.append(style);
    fit();
    renderScene();
    reconcile();
  };
  frame.addEventListener('load', ready);
  if (frame.contentDocument?.readyState === 'complete' &&
      frame.contentDocument.URL === new URL(frame.getAttribute('src'), location.href).href) ready();
  button.addEventListener('click', () => {
    userPaused = playing;
    explicitPlay = !userPaused;
    reconcile();
  });
  motion.addEventListener('change', () => {
    explicitPlay = false;
    reconcile();
  });
  document.addEventListener('visibilitychange', reconcile);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      reconcile();
    }, {threshold: 0.1}).observe(host);
  }
  new ResizeObserver(fit).observe(host);
  sync();
})();
