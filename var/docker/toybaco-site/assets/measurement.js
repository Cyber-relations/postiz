/* Staging measurement only. Production remains inactive pending separate approval. */
(() => {
  'use strict';
  if (window.toybacoMeasurement) return;
  const staging = location.origin === 'https://staging.toybaco.jp';
  const local = location.origin === 'http://127.0.0.1:8786';
  if (!staging && !local) return;
  const choiceKey = 'toybaco.measurement.staging.choice';
  let choice = 'unset';
  try { choice = sessionStorage.getItem(choiceKey) || 'unset'; } catch (_) { /* Fail closed. */ }
  let active = choice === 'accepted';
  const knownPaths = new Set(["/", "/404.html", "/ai/", "/compare/", "/contact/", "/enterprise/", "/faq/", "/features/", "/guide/", "/guide/after-hours-reply/", "/guide/ai-reception-cost/", "/guide/auto-auto-reply/", "/guide/auto-inbox/", "/guide/auto-sns/", "/guide/beauty-auto-reply/", "/guide/beauty-inbox/", "/guide/beauty-sns/", "/guide/bridal-photo-auto-reply/", "/guide/bridal-photo-inbox/", "/guide/bridal-photo-sns/", "/guide/clinic-auto-reply/", "/guide/clinic-inbox/", "/guide/clinic-sns/", "/guide/estate-auto-reply/", "/guide/estate-inbox/", "/guide/estate-sns/", "/guide/food-auto-reply/", "/guide/food-inbox/", "/guide/food-sns/", "/guide/google-map-post/", "/guide/hotel-auto-reply/", "/guide/hotel-inbox/", "/guide/hotel-sns/", "/guide/inbox-unify/", "/guide/instagram-dm-pc/", "/guide/instagram-schedule/", "/guide/line-multi-user/", "/guide/multi-store-sns/", "/guide/no-missed-reply/", "/guide/pet-auto-reply/", "/guide/pet-inbox/", "/guide/pet-sns/", "/guide/pro-auto-reply/", "/guide/pro-inbox/", "/guide/pro-sns/", "/guide/reform-auto-reply/", "/guide/reform-inbox/", "/guide/reform-sns/", "/guide/retail-ec-auto-reply/", "/guide/retail-ec-inbox/", "/guide/retail-ec-sns/", "/guide/school-auto-reply/", "/guide/school-inbox/", "/guide/school-sns/", "/guide/sns-bulk-post/", "/guide/what-is-ai-agent/", "/guide/what-is-approval-flow/", "/guide/what-is-gbp/", "/guide/what-is-scheduled-post/", "/guide/what-is-team-inbox/", "/guide/what-is-unified-inbox/", "/industries/", "/industries/auto/", "/industries/beauty/", "/industries/bridal-photo/", "/industries/clinic/", "/industries/estate/", "/industries/food/", "/industries/hotel/", "/industries/pet/", "/industries/pro/", "/industries/reform/", "/industries/retail-ec/", "/industries/school/", "/news/", "/partners/", "/posting/", "/pricing/", "/privacy/", "/security/", "/signup/", "/start/", "/terms/", "/tokushoho/", "/welcome/"]);
  const rawPath = location.pathname.replace(/index\.html$/, '');
  const path = knownPaths.has(rawPath) ? rawPath : '/404.html';
  const contentType = /^\/(guide|news)\//.test(path) ? 'journal'
    : path.startsWith('/contact/') ? 'contact'
    : path.startsWith('/partners/') ? 'partner'
    : /^\/(privacy|terms|tokushoho)\//.test(path) || path === '/404.html' ? 'corporate' : 'service';
  const context = Object.freeze({ site_name: 'toybaco', service_name: 'toybaco',
    page_language: document.documentElement.lang || 'ja', content_type: contentType });
  const safeReferrer = (() => {
    try { const url = new URL(document.referrer); return url.origin === location.origin && knownPaths.has(url.pathname.replace(/index\.html$/, '')) ? url.origin + url.pathname : ''; }
    catch (_) { return ''; }
  })();
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ ...context, page_location: location.origin + path,
    page_referrer: safeReferrer, page_title: '[staging] ' + path,
    measurement_test_mode: 'staging', test_run: 'toybaco_staging_20260918' });
  const schema = {
    contact_click: ['link_position', 'link_text', 'link_url'],
    contact_form_start: ['form_id', 'form_type'],
    contact_form_confirm: ['form_id', 'form_type'],
    contact_form_submit: ['form_id', 'form_type', 'inquiry_type'],
    form_error: ['form_id', 'form_type', 'error_type', 'error_field'],
    signup_click: ['link_position'], plan_select: ['plan_id', 'billing_cycle', 'link_position'],
    checkout_click: ['plan_id', 'billing_cycle'], billing_cycle_change: ['billing_cycle'],
    industry_select: ['industry_id'], demo_interaction: ['demo_action'],
    faq_open: ['question_id'], pricing_calculator_use: ['staff_count_band'],
    partner_click: ['link_position', 'inquiry_origin'], login_click: ['link_position'],
    pricing_view: ['pricing_location']
  };
  const codes = {
    link_position: ['header', 'footer', 'main_cta', 'pricing', 'article', 'work', 'other'],
    form_id: ['toybaco_contact'], form_type: ['contact'],
    inquiry_type: ['service', 'custom', 'setup', 'billing', 'support', 'other'],
    error_type: ['validation', 'api', 'network', 'system'],
    error_field: ['name', 'company', 'email', 'topic', 'message', 'consent', 'form'],
    plan_id: ['light', 'standard', 'pro'], billing_cycle: ['month', 'year'],
    demo_action: ['pack_preview_change'], inquiry_origin: ['partners'],
    staff_count_band: ['2_3', '4_5', '6_10', '11_20', '21_30'],
    pricing_location: ['home_pricing', 'pricing_page']
  };
  const valid = (key, value) => {
    if (typeof value !== 'string' || value.length > 200) return false;
    if (codes[key]) return codes[key].includes(value);
    if (key === 'question_id') return /^[a-z0-9_]+_faq_[0-9]{2}$/.test(value);
    if (key === 'industry_id') return ['beauty', 'food', 'estate', 'retail-ec', 'clinic', 'school', 'auto', 'reform', 'hotel', 'bridal-photo', 'pet', 'pro'].includes(value);
    if (key === 'link_text') return ["お問い合わせ", "お問い合わせフォーム", "チャットからどうぞ", "チャットでご相談ください", "チャットで伝える", "チャットで相談", "チャットで相談する", "チャットで質問する", "フォームで相談", "フォームで相談する"].includes(value);
    if (key === 'link_url') return value === '' || value === location.origin + '/contact/';
    return false;
  };
  const keys = [...new Set(Object.values(schema).flat())];
  const emit = (event, values = {}, completion) => {
    if (!active || !Object.hasOwn(schema, event) || !schema[event].every(k => Object.hasOwn(values, k) && valid(k, values[k]))) return false;
    window.dataLayer.push({ ...Object.fromEntries(keys.map(k => [k, null])), ...context,
      ...Object.fromEntries(schema[event].map(k => [k, values[k]])), event,
      eventCallback: completion, eventTimeout: completion ? 1200 : undefined });
    return true;
  };
  const setChoice = next => {
    active = false;
    try { sessionStorage.setItem(choiceKey, next); } catch (_) { return false; }
    if (next !== 'accepted') {
      window['ga-disable-G-YR5P1YSG3G'] = true;
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.trim().split('=')[0];
        if (!/^tb_staging(?:_|$)/.test(name)) continue;
        for (const domain of ['', '; Domain=staging.toybaco.jp', '; Domain=.staging.toybaco.jp'])
          document.cookie = name + '=; Max-Age=0; Path=/' + domain + '; SameSite=Lax';
      }
    }
    location.reload();
    return true;
  };
  window.toybacoMeasurement = Object.freeze({ context, emit, setChoice, get active() { return active; } });
  const position = el => el.closest('header, nav.menu') ? 'header'
    : el.closest('footer') ? 'footer' : el.closest('#pricing, .plans2, #staffCalc') ? 'pricing'
    : path.startsWith('/guide/') ? 'article' : el.closest('.acts, .contact-options, #cta') ? 'main_cta' : 'other';
  document.addEventListener('click', e => {
    const el = e.target.closest('a[href^="mailto:"]');
    if (!active || !e.isTrusted || !el || el.matches('[data-open-chat]')) return;
    window.dataLayer.push({ ...Object.fromEntries(keys.map(k => [k, null])), ...context, link_position: position(el) });
  }, true);
  if (active && staging) {
    // Consent defaults precede GTM. No direct GA4 tag, ad tag, or manual page_view/scroll.
    const consent = function() { window.dataLayer.push(arguments); };
    consent('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied' });
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-T2ZGF6ZP';
    document.head.appendChild(script);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('aside');
    panel.id = 'measurement-staging-controls';
    panel.setAttribute('aria-label', '計測の検証設定');
    panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:10001;max-width:calc(100vw - 24px);padding:12px;background:#fff;color:#162b40;border:1px solid #162b40;border-radius:8px;font:14px sans-serif;box-sizing:border-box';
    const label = document.createElement('p');
    label.textContent = '計測検証：' + (active ? (staging ? '送信許可（GTMプレビュー接続が必要）' : 'ローカル通知のみ') : '送信停止');
    label.style.margin = '0 0 8px';
    panel.appendChild(label);
    const privacy = document.createElement('a');
    privacy.href = '/privacy/#site-measurement';
    privacy.textContent = '解析する情報と停止方法';
    privacy.style.cssText = 'display:block;margin:0 0 8px;color:#162b40;text-decoration:underline';
    panel.appendChild(privacy);
    for (const [text, value] of [['解析のテストを許可', 'accepted'], ['拒否・停止', 'denied']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = text;
      button.style.cssText = 'margin-right:8px;padding:6px;cursor:pointer';
      button.addEventListener('click', () => setChoice(value));
      panel.appendChild(button);
    }
    document.body.appendChild(panel);
    const initialCycles = new WeakMap();
    document.querySelectorAll('.bill-tgl').forEach(g => initialCycles.set(g, g.querySelector('.on')?.dataset.bill || 'm'));
    document.addEventListener('click', e => {
      const button = e.target.closest('.bill-tgl button');
      if (button) { const group = button.closest('.bill-tgl'); initialCycles.set(group, group.querySelector('.on')?.dataset.bill); }
    }, true);
    document.addEventListener('click', e => {
      const el = e.target.closest('a, button');
      if (!active || !el || !e.isTrusted) return;
      const events = [];
      const record = (event, values) => events.push([event, values]);
      const pos = position(el);
      const link = el.tagName === 'A' ? new URL(el.href, location.href) : null;
      if (el.matches('[data-open-chat]')) {
        // link_url has no true destination; proposal is empty, never a made-up URL.
        record('contact_click', { link_position: pos, link_text: el.textContent.trim(), link_url: '' });
        if (path.startsWith('/partners/')) record('partner_click', { link_position: pos, inquiry_origin: 'partners' });
      } else if (link && link.origin === location.origin && link.pathname === '/contact/') {
        record('contact_click', { link_position: pos, link_text: el.textContent.trim(),
          link_url: location.origin + '/contact/' });
        if (path.startsWith('/partners/')) record('partner_click', { link_position: pos, inquiry_origin: 'partners' });
      }
      if (link?.origin === location.origin && link.pathname === '/signup/') record('signup_click', { link_position: pos });
      if (el.matches('.buy-btn[data-plan]') && link) {
        const plan = el.dataset.plan, cycle = link.searchParams.get('cycle');
        if (['light','standard','pro'].includes(plan) && ['month','year'].includes(cycle)) {
          record('plan_select', { plan_id: plan, billing_cycle: cycle, link_position: pos });
          if (link.hostname === 'app.staging.toybaco.jp' && link.pathname === '/toybaco/checkout')
            record('checkout_click', { plan_id: plan, billing_cycle: cycle });
        }
      } else if (link?.hostname === 'app.staging.toybaco.jp' && ['/', '/app/login', '/app/login/'].includes(link.pathname))
        record('login_click', { link_position: pos });
      if (el.matches('.bill-tgl button')) {
        const group = el.closest('.bill-tgl'), next = el.dataset.bill;
        if (initialCycles.get(group) !== next) {
          record('billing_cycle_change', { billing_cycle: next === 'y' ? 'year' : 'month' });
          initialCycles.set(group, next);
        }
      }
      if (el.matches('.pack-btn[data-pack]')) {
        // Bubble listener runs after the real target-container rendering listener.
        record('industry_select', { industry_id: el.dataset.pack });
        record('demo_interaction', { demo_action: 'pack_preview_change' });
      }
      // Same-tab navigation must not race the last GA event with page unload.
      // Modified clicks, downloads, chat controls and local fixtures keep native behavior.
      const waitForTags = staging && events.length && link && !e.defaultPrevented &&
        e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey &&
        (!el.target || el.target === '_self') && !el.hasAttribute('download') &&
        !el.matches('[data-open-chat]');
      if (!waitForTags) {
        for (const [event, values] of events) emit(event, values);
        return;
      }
      e.preventDefault();
      let remaining = events.length, dispatched = false, navigated = false;
      const navigate = () => {
        if (navigated) return;
        navigated = true;
        clearTimeout(fallback);
        location.assign(link.href);
      };
      // GTM may be blocked or its preview disconnected: never trap a visitor.
      const fallback = setTimeout(navigate, 1500);
      for (const [event, values] of events) {
        let completed = false;
        const finish = containerId => {
          // Google tags can also invoke callbacks; only our GTM container releases navigation.
          if (containerId !== 'GTM-T2ZGF6ZP' || completed) return;
          completed = true;
          remaining -= 1;
          if (dispatched && remaining === 0) navigate();
        };
        if (!emit(event, values, finish)) remaining -= 1;
      }
      dispatched = true;
      if (remaining === 0) navigate();
    });
    document.querySelectorAll('details[data-question-id]').forEach(details => {
      let userToggle = false, wasOpen = details.open;
      details.querySelector('summary')?.addEventListener('click', e => { userToggle = e.isTrusted; });
      details.addEventListener('toggle', () => {
        if (userToggle && details.open && !wasOpen) emit('faq_open', { question_id: details.dataset.questionId });
        userToggle = false; wasOpen = details.open;
      });
    });
    const slider = document.getElementById('calcRange');
    let lastValue = slider?.value;
    slider?.addEventListener('change', e => {
      if (!e.isTrusted || slider.value === lastValue) return;
      lastValue = slider.value;
      const n = Number(slider.value);
      emit('pricing_calculator_use', { staff_count_band: n <= 3 ? '2_3' : n <= 5 ? '4_5' :
        n <= 10 ? '6_10' : n <= 20 ? '11_20' : '21_30' });
    });
    if (path === '/pricing/' || path === '/pricing/index.html')
      emit('pricing_view', { pricing_location: 'pricing_page' });
    if (path === '/' || path === '/index.html') {
      const marker = document.querySelector('#pricing .price-h .mk');
      let visible = false, timer = null, done = false;
      const reset = () => { clearTimeout(timer); timer = null; };
      const update = () => {
        reset();
        if (visible && !document.hidden && !done) timer = setTimeout(() => {
          if (visible && !document.hidden && !done) {
            done = true; emit('pricing_view', { pricing_location: 'home_pricing' });
          }
        }, 1000);
      };
      if (marker) new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .99; update();
      }, { threshold: [0, .99, 1] }).observe(marker);
      document.addEventListener('visibilitychange', update);
      window.addEventListener('pagehide', reset);
    }
    const form = document.getElementById('contact-form');
    if (form) {
      const formCodes = { form_id: 'toybaco_contact', form_type: 'contact' };
      let started = false;
      const start = e => {
        if (!active || !e.isTrusted || started || e.target.name === 'website') return;
        started = true; emit('contact_form_start', formCodes);
      };
      form.addEventListener('input', start); form.addEventListener('change', start);
      form.addEventListener('toybaco:review-shown', () => emit('contact_form_confirm', formCodes));
      const seenErrors = new Set();
      form.addEventListener('toybaco:error', e => {
        const key = e.detail.type + ':' + e.detail.field;
        if (!seenErrors.has(key)) emit('form_error', { ...formCodes, error_type: e.detail.type, error_field: e.detail.field });
        seenErrors.add(key);
      });
      form.addEventListener('input', () => { seenErrors.clear(); });
      form.addEventListener('invalid', e => {
        const key = 'validation:' + e.target.name;
        if (!seenErrors.has(key)) emit('form_error', { ...formCodes, error_type: 'validation', error_field: e.target.name });
        seenErrors.add(key);
      }, true);
      // The real API callback dispatches only after code=sent + matching receipt.
      const receipts = new Set();
      form.addEventListener('toybaco:accepted', e => {
        if (receipts.has(e.detail.receipt)) return;
        receipts.add(e.detail.receipt);
        emit('contact_form_submit', { ...formCodes, inquiry_type: e.detail.topic });
      });
    }
  });
})();
