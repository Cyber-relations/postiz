const appShell = document.getElementById('appShell');
if (appShell) {
  const $id = id => document.getElementById(id);
  const ghost = $id('ghostCur');
  let curScene = 0, tourTimers = [];
  const tAfter = (ms, fn) => tourTimers.push(setTimeout(fn, ms));
  const clearTour = () => { tourTimers.forEach(t => { clearTimeout(t); clearInterval(t); }); tourTimers = []; };
  const cursorTo = (x, y, ms = 650) => {
    ghost.style.transitionDuration = `${ms}ms, ${ms}ms, .3s`;
    ghost.style.left = x + '%'; ghost.style.top = y + '%';
  };
  /* 実要素の位置へカーソルを動かす(ウィンドウサイズが変わってもズレない) */
  const wrapEl = document.getElementById('appWrap');
  const cursorToEl = (id, ms = 650, dx = .5, dy = .5) => {
    const el = typeof id === 'string' ? $id(id) : id;
    if (!el) return;
    const w = wrapEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    cursorTo(((r.left + r.width * dx) - w.left) / w.width * 100,
             ((r.top + r.height * dy) - w.top) / w.height * 100, ms);
  };
  const cursorJumpEl = (id, dx = .5, dy = .5) => {
    ghost.style.transitionDuration = '0ms, 0ms, .3s';
    cursorToEl(id, 0, dx, dy);
  };
  const gclick = () => { ghost.classList.remove('clicked'); void ghost.offsetWidth; ghost.classList.add('clicked'); };
  const typeInto = (el, text, cps = 24, done) => {
    el.textContent = '';
    let i = 0;
    const iv = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(iv); done && done(); }
    }, cps);
    tourTimers.push(iv);
  };
  const show = (id, on = true) => $id(id).classList.toggle('hiddenm', !on);
  const popMsg = id => { const el = $id(id); el.classList.remove('hiddenm'); el.classList.add('popin'); };

  const REPLY = 'お問い合わせありがとうございます。ご希望の日時・メニューをお知らせください。';
  const AIREPLY = '本日の営業は 21:00 までです🌙 21時以降をご希望の場合は、明日以降のお時間をご案内できます。ご希望の日時をお知らせください。';

  /* シーン n の「開始状態」を同期的に組み立てる(途中スクロールでも破綻しない) */
  const base = n => {
    clearTour();
    appShell.classList.toggle('night', n >= 5);
    appShell.classList.toggle('postview', n === 4);
    $id('postPanel').classList.toggle('loaded', n === 4);
    $id('navInbox').classList.toggle('on', n !== 4);
    $id('navPost').classList.toggle('on', n === 4);
    $id('appClock').textContent = n >= 5 ? '23:42' : '14:0' + Math.min(n, 4);
    const convNew = $id('convNew');
    convNew.classList.toggle('shown', n >= 1);
    convNew.classList.toggle('settle', n >= 2);
    convNew.classList.toggle('sel', n >= 2);
    const unread = n >= 2 ? 12 : (n >= 1 ? 13 : 12);
    $id('unreadCnt').textContent = unread;
    $id('navUnread').textContent = unread;
    $id('chatPane').classList.toggle('open', n >= 2);
    $id('assignChip').classList.toggle('shown', n >= 2);
    show('assignMeta', n >= 2);
    const replied = n >= 3;
    $id('replyMsg').textContent = replied ? REPLY : '';
    show('replyMsg', replied);
    show('sentMeta', replied);
    $id('composerText').innerHTML = '返信を入力(<b style="color:var(--acoral)">/</b> で定型文)';
    $id('slashPop').classList.remove('shown');
    show('nightQ', false); $id('aiThink').classList.remove('shown');
    show('aiMsg', false); show('aiMeta', false);
    ['q1','q2','q3'].forEach(q => $id(q).classList.remove('shown'));
    $id('lineToast').classList.remove('shown');
    ghost.classList.toggle('on', n >= 2 && n <= 4);
  };

  /* 演出が終わったら少し置いて同じシーンをループ再生する */
  const loopScene = (n, delay) => tAfter(delay, () => { if (curScene === n) scenes[n](); });

  const scenes = {
    1(){ // 届く
      base(0);
      tAfter(300, () => $id('lineToast').classList.add('shown'));
      tAfter(1400, () => {
        $id('lineToast').classList.remove('shown');
        $id('convNew').classList.add('shown');
        const c = $id('unreadCnt'); c.textContent = 13; $id('navUnread').textContent = 13;
        c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
      });
      loopScene(1, 4600);
    },
    2(){ // ひらく
      base(1);
      ghost.classList.add('on');
      cursorJumpEl('sendBtn', .5, 2.2);
      tAfter(300, () => cursorToEl('convNew', 780, .45, .5));
      tAfter(1200, () => { gclick(); $id('convNew').classList.add('sel','settle');
        $id('unreadCnt').textContent = 12; $id('navUnread').textContent = 12; });
      tAfter(1430, () => $id('chatPane').classList.add('open'));
      tAfter(2050, () => { $id('assignChip').classList.add('shown'); show('assignMeta'); });
      loopScene(2, 5400);
    },
    3(){ // かえす
      base(2);
      ghost.classList.add('on');
      cursorJumpEl('convNew', .45, .5);
      tAfter(300, () => cursorToEl('composerText', 720, .3, .5));
      tAfter(1180, () => { gclick(); $id('slashPop').classList.add('shown'); });
      tAfter(1450, () => cursorToEl('slashFirst', 420));
      tAfter(2100, () => {
        gclick(); $id('slashPop').classList.remove('shown');
        typeInto($id('composerText'), REPLY, 20, () => {
          tAfter(250, () => cursorToEl('sendBtn', 500));
          tAfter(820, () => {
            gclick();
            $id('composerText').innerHTML = '返信を入力(<b style="color:var(--acoral)">/</b> で定型文)';
            $id('replyMsg').textContent = REPLY; popMsg('replyMsg');
          });
          tAfter(1320, () => popMsg('sentMeta'));
          tAfter(4600, () => { if (curScene === 3) scenes[3](); });
        });
      });
    },
    4(){ // とどける(サイドバーの「投稿」→ パネルが開く実挙動)
      base(3);
      ghost.classList.add('on');
      cursorJumpEl('sendBtn');
      tAfter(350, () => cursorToEl('navPost', 700, .42, .5));
      tAfter(1200, () => { gclick();
        $id('navInbox').classList.remove('on'); $id('navPost').classList.add('on');
        appShell.classList.add('postview');   // スピナー表示から
      });
      tAfter(2300, () => $id('postPanel').classList.add('loaded'));
      tAfter(2650, () => cursorToEl('pvBtn', 650));
      tAfter(3450, () => gclick());
      tAfter(3650, () => $id('q1').classList.add('shown'));
      tAfter(3860, () => $id('q2').classList.add('shown'));
      tAfter(4070, () => $id('q3').classList.add('shown'));
      loopScene(4, 7600);
    },
    5(){ // やすむ(AI)
      base(3);
      ghost.classList.remove('on');   // 夜は誰も操作していない
      appShell.classList.add('night');
      $id('appClock').textContent = '23:42';
      tAfter(600, () => popMsg('nightQ'));
      tAfter(1350, () => $id('aiThink').classList.add('shown'));
      tAfter(2500, () => {
        $id('aiThink').classList.remove('shown');
        popMsg('aiMsg');
        typeInto($id('aiMsg'), AIREPLY, 16, () => tAfter(300, () => popMsg('aiMeta')));
      });
      tAfter(8200, () => { if (curScene === 5) scenes[5](); });
    },
  };

  const setScene = n => {
    if (n === curScene) return;
    curScene = n;
    document.querySelectorAll('.tstep').forEach(s =>
      s.classList.toggle('on', +s.dataset.step === n));
    scenes[n] && scenes[n]();
  };


  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=reduced.matches;
  const select=n=>{if(paused){curScene=n;base(n);if(n===5){appShell.classList.add('night');show('nightQ');$id('aiMsg').textContent=AIREPLY;show('aiMsg');show('aiMeta')}}else{curScene=0;setScene(n)}};
  window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;if(e.data?.type==='tour-scene'&&Number.isInteger(e.data.scene)&&e.data.scene>=1&&e.data.scene<=5)select(e.data.scene);if(e.data?.type==='tour-pause'){paused=!!e.data.paused;select(curScene||1)}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTour();else select(curScene||1)});
  select(1);
}
const fit=()=>{document.getElementById('canvas').style.transform='scale('+Math.min(innerWidth/1100,innerHeight/620)+')'};addEventListener('resize',fit);fit();