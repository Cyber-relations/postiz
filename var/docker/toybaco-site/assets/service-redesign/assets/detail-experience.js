/* Local, illustrative service simulations. No requests, persistence or real sends. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const inquiry = document.querySelector('[data-experience="inquiry"]');
  const posting = document.querySelector('[data-experience="posting"]');
  const result = (root, title, text) => {
    root.querySelector('[data-result-title]').textContent = title;
    root.querySelector('[data-result-text]').textContent = text;
  };
  function feedback(element) {
    if (!reduced.matches && element?.animate) element.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  }
  function reveal(root) {
    root.hidden = false;
    root.closest('section').querySelector('.legacy-demo')?.removeAttribute('open');
  }
  if (inquiry) {
    const samples = [
      { source: '代表メール', subject: '申し込み方法について', customer: 'サービスの申し込みを検討しています。手続きの進め方を教えてください。', team: '申し込み窓口', memo: '申し込み前のご相談です。検討している内容を確認して、担当窓口から案内します。', reply: 'お問い合わせありがとうございます。ご検討中の内容を確認して、申し込みの手順をご案内します。' },
      { source: 'サポートメール', subject: '設定の進め方について', customer: '利用を始めました。初期設定は何から進めればよいでしょうか？', team: 'サポート窓口', memo: '初期設定のご質問です。これまでのやり取りを確認して、設定手順を案内します。', reply: 'ご連絡ありがとうございます。まず、設定したい内容をお知らせください。状況を確認して手順をご案内します。' },
      { source: 'LINE公式アカウント', subject: '営業時間を教えてください', customer: '明日お店に行きたいのですが、何時から営業していますか？', team: '店舗窓口', memo: '明日の営業時間についてのご質問です。店舗の営業予定を確認して返信します。', reply: 'お問い合わせありがとうございます。明日は10時から18時まで営業予定です。ご来店をお待ちしています。' },
      { source: 'Instagram DM', subject: '商品の取り扱いについて', customer: '投稿で見た商品は、店舗でも購入できますか？', team: '商品担当', memo: 'SNSを見たお客様からのご質問です。商品の取り扱いと在庫を確認して案内します。', reply: 'お問い合わせありがとうございます。ご希望の商品名をお知らせください。取り扱い店舗と在庫を確認してご案内します。' }
    ];
    const states = samples.map(() => ({ memo: false, draft: false, resolved: false }));
    let selected = 0;
    const q = selector => inquiry.querySelector(selector);
    function render() {
      const sample = samples[selected], state = states[selected];
      q('[data-source]').textContent = sample.source;
      q('[data-subject]').textContent = sample.subject;
      q('[data-customer]').textContent = sample.customer;
      q('[data-status]').textContent = state.resolved ? '対応完了' : state.memo ? '担当あり' : '未対応';
      q('[data-memo]').hidden = !state.memo;
      q('[data-memo] small').textContent = `担当：${sample.team} / 社内メモ`;
      q('[data-memo-text]').textContent = sample.memo;
      q('[data-reply]').hidden = !state.draft;
      q('[data-reply-label]').textContent = state.resolved ? '返信・対応完了の説明例' : '定型文を入れた返信の下書き例';
      q('[data-reply-text]').textContent = sample.reply;
      q('[data-assign]').setAttribute('aria-pressed', String(state.memo));
      q('[data-draft]').setAttribute('aria-pressed', String(state.draft));
      q('[data-resolve]').hidden = !state.draft;
      q('[data-resolve]').disabled = state.resolved;
      q('[data-resolve]').textContent = state.resolved ? '対応完了の例を表示中' : '対応完了の例を見る';
      inquiry.querySelectorAll('[data-message]').forEach((button, index) => {
        button.setAttribute('aria-pressed', String(index === selected));
        q(`[data-row-state="${index}"]`).textContent = states[index].resolved ? '対応完了' : states[index].memo ? '担当あり' : '未対応';
      });
      if (state.resolved) result(inquiry, '対応状況も同じ一覧に', '対応を終えた問い合わせと これから対応する問い合わせを見分ける');
      else if (state.draft) result(inquiry, 'よく使う返信を下書きに', '定型文をもとに内容を確認・編集して お客様への返信を準備');
      else if (state.memo) result(inquiry, '担当と経緯もまとめて共有', '社内メモで確認事項を残し 同じ会話を見ながら引き継ぐ');
      else result(inquiry, '探す場所はひとつ', `${sample.source}の連絡も 他の窓口と同じ一覧から確認`);
    }
    inquiry.querySelectorAll('[data-message]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.message); render(); feedback(q('.experience-conversation')); }));
    q('[data-assign]').addEventListener('click', () => { states[selected].memo = !states[selected].memo; render(); });
    q('[data-draft]').addEventListener('click', () => { states[selected].draft = !states[selected].draft; states[selected].resolved = false; render(); });
    q('[data-resolve]').addEventListener('click', () => { states[selected].resolved = true; render(); });
    q('[data-reset]').addEventListener('click', () => { selected = 0; states.forEach(s => { s.memo = s.draft = s.resolved = false; }); render(); });
    render();
    reveal(inquiry);
  }
  if (posting) {
    const q = selector => posting.querySelector(selector);
    const accounts = {
      instagram: { label: 'Instagram', icon: 'instagram-color.png' },
      x: { label: 'X', icon: 'x.png' },
      maps: { label: 'Google マップ', icon: 'google-maps.webp' },
      facebook: { label: 'Facebook', icon: 'facebook.png' },
      threads: { label: 'Threads', icon: 'threads.svg' },
      tiktok: { label: 'TikTok', icon: 'tiktok.png' }
    };
    const copy = {
      photo: '持ち歩く道具を、すっきりひとつに。\nネイビーの新しいポーチが登場しました。商品の詳細はプロフィールから。',
      video: '道具をまとめて、さっと持ち出す。\n新しいポーチの使い方を動画でご紹介。気になるアイテムをチェックしてみてください。'
    };
    let format = 'photo', reserved = false, published = false, playing = false;
    const destinations = () => Array.from(q('[data-targets]').querySelectorAll('input:checked')).map(input => input.value);
    const icon = key => { const img = document.createElement('img'); img.src = `/assets/service-redesign/assets/brands/${accounts[key].icon}`; img.alt = ''; img.width = img.height = 26; return img; };
    function preview() {
      const key = q('[data-preview]').value;
      q('[data-preview-logo]').replaceChildren();
      if (accounts[key]) {
        q('[data-preview-logo]').append(icon(key));
        q('[data-preview-name]').textContent = `${accounts[key].label} / 公式アカウント例`;
      } else q('[data-preview-name]').textContent = '投稿先を選んでください';
      q('[data-preview-copy]').textContent = q('[data-copy]').value || '文面を入力すると ここで確認できます';
      const reactions = q('.experience-reactions');
      reactions.hidden = !key || key === 'maps';
      const share = reactions.querySelectorAll('svg')[2];
      share.replaceChildren();
      const shape = markup => { const template = document.createElement('template'); template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`; return [...template.content.firstChild.children]; };
      const heart = '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>';
      const thumbsUp = '<path d="M7 21H3V10h4M7 21h10a2 2 0 0 0 2-1.5l2-7A2 2 0 0 0 19 10h-6l1-5c0-2-3-3-4-1l-3 6Z"/>';
      reactions.querySelectorAll('svg')[0].replaceChildren(...shape(key === 'facebook' ? thumbsUp : heart));
      const repeat = '<path d="m3 7 4-4 4 4M7 3v13h9M21 17l-4 4-4-4M17 21V8H8"/>';
      const send = '<path d="m22 2-7 20-4-9L2 9l20-7ZM22 2 11 13"/>';
      const shareArrow = '<path d="m14 3 7 7-7 7v-5c-5.5 0-9 2.5-11 7 0-8 4-12 11-12Z"/>';
      share.append(...shape(key === 'instagram' ? send : ['facebook','tiktok'].includes(key) ? shareArrow : repeat));
      reactions.setAttribute('aria-label', `${accounts[key]?.label || 'SNS'}側のいいね・コメント・${['instagram','facebook','tiktok'].includes(key) ? 'シェア' : 'リポスト'}・保存の表示例。トイバコの集計項目ではありません`);
    }
    function clearReservation() {
      reserved = published = false;
      q('[data-calendar]').hidden = true;
      result(posting, 'ひとつの下書きから準備', '投稿先の選択と文面の確認から 予約まで同じ場所で');
    }
    function updateTargets() {
      const keys = destinations(), selected = q('[data-preview]').value;
      q('[data-preview]').replaceChildren();
      keys.forEach(key => { const option = document.createElement('option'); option.value = key; option.textContent = accounts[key].label; q('[data-preview]').append(option); });
      if (keys.includes(selected)) q('[data-preview]').value = selected;
      q('[data-preview]').disabled = keys.length === 0;
      q('[data-reserve]').disabled = keys.length === 0 || !q('[data-copy]').value.trim();
      clearReservation();
      preview();
      if (!keys.length) result(posting, '投稿先を選んでから予約', 'まとめたいアカウントを選ぶと 投稿先の表示例を確認できます');
    }
    function setFormat(next) {
      format = next;
      q('[data-copy]').value = copy[format];
      posting.querySelectorAll('[data-format]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === format)));
      q('[data-targets]').replaceChildren();
      (format === 'photo' ? ['instagram', 'x', 'maps', 'facebook', 'threads'] : ['tiktok']).forEach(key => {
        const label = document.createElement('label'), input = document.createElement('input'), brand = document.createElement('span');
        input.type = 'checkbox'; input.value = key; input.checked = true;
        brand.className = 'detail-brand'; brand.setAttribute('aria-hidden', 'true'); brand.append(icon(key));
        label.append(input, brand, document.createTextNode(accounts[key].label));
        q('[data-targets]').append(label);
        input.addEventListener('change', updateTargets);
      });
      q('[data-media]').classList.toggle('video', format === 'video');
      q('[data-play]').hidden = q('[data-video-label]').hidden = format !== 'video';
      setPlaying(false);
      updateTargets();
    }
    function setPlaying(next) {
      playing = next;
      q('[data-media]').classList.toggle('playing', playing && !reduced.matches);
      q('[data-play]').setAttribute('aria-pressed', String(playing));
      q('[data-play]').setAttribute('aria-label', playing ? '説明用の動画イメージを一時停止' : '説明用の動画イメージを再生');
      q('[data-play] span').textContent = playing ? 'Ⅱ' : '▶';
    }
    function calendar() {
      const time = q('[data-time]').value === 'fri' ? '金曜日 18:00' : '土曜日 10:00';
      q('[data-events]').replaceChildren();
      destinations().forEach(key => {
        const event = document.createElement('div'), info = document.createElement('div'), title = document.createElement('b'), detail = document.createElement('small');
        event.className = 'experience-event';
        title.textContent = `${accounts[key].label} · ${published ? '公開済みの例' : time}`;
        detail.textContent = `${format === 'photo' ? '写真のお知らせ' : '動画で紹介'} / ${published ? '予約枠が空く' : '予約中の例'}`;
        info.append(title, detail); event.append(icon(key), info); q('[data-events]').append(event);
      });
      q('[data-calendar]').hidden = false;
      feedback(q('[data-events]'));
      q('[data-published]').textContent = published ? '予約中の例へ戻す' : '公開後の例を見る';
      q('[data-calendar-note]').textContent = published ? '公開すると 同時予約の枠が空きます' : '選んだ投稿先と日時をまとめて確認';
      result(posting, published ? '予約は月間の投稿数ではありません' : `${destinations().length}つの投稿先をまとめて予約する例`, published ? '公開後は予約枠が空くので 次のお知らせを予約できます' : '実際には投稿先ごとの条件と内容を確認して 予約します');
    }
    posting.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => { setFormat(button.dataset.format); }));
    q('[data-preview]').addEventListener('change', preview);
    q('[data-copy]').addEventListener('input', () => { clearReservation(); preview(); q('[data-reserve]').disabled = !destinations().length || !q('[data-copy]').value.trim(); });
    q('[data-time]').addEventListener('change', clearReservation);
    q('[data-play]').addEventListener('click', () => setPlaying(!playing));
    q('[data-reserve]').addEventListener('click', () => { if (!destinations().length || !q('[data-copy]').value.trim()) return; reserved = true; published = false; calendar(); });
    q('[data-published]').addEventListener('click', () => { if (reserved) { published = !published; calendar(); } });
    q('[data-reset]').addEventListener('click', () => { q('[data-time]').value = 'fri'; setFormat('photo'); });
    reduced.addEventListener('change', () => setPlaying(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => { if (!entries[0].isIntersecting) setPlaying(false); }, { threshold: .1 }).observe(posting);
    setFormat('photo');
    reveal(posting);
  }
  // Preserve the fixed CTA, but avoid obstructing the hero and the final CTA.
  const floating = document.querySelector('.detail-floating-cta');
  const hero = document.querySelector('.detail-hero');
  const final = document.querySelector('.detail-final');
  if (floating && hero && final && 'IntersectionObserver' in window) {
    let heroVisible = true, finalVisible = false, experienceVisible = false;
    const update = () => { floating.hidden = heroVisible || finalVisible || experienceVisible; };
    new IntersectionObserver(entries => { heroVisible = entries[0].isIntersecting; update(); }, { threshold: 0 }).observe(hero);
    new IntersectionObserver(entries => { finalVisible = entries[0].isIntersecting; update(); }, { threshold: 0 }).observe(final);
    const experience = inquiry || posting;
    if (experience) new IntersectionObserver(entries => { experienceVisible = entries[0].isIntersecting; update(); }, { threshold: 0 }).observe(experience);
    update();
  }
})();
