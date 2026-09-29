
const pcalWrap = document.getElementById('pcalWrap');
if (pcalWrap) {
  const P = id => document.getElementById(id);
  const pg = P('pcalGhost');
  let pTimers = [], pPlaying = false;
  const pAfter = (ms, fn) => pTimers.push(setTimeout(fn, ms));
  const pClear = () => { pTimers.forEach(t => { clearTimeout(t); clearInterval(t); }); pTimers = []; };
  const pCursorTo = (id, ms = 620, dx = .5, dy = .5) => {
    const el = P(id); if (!el) return;
    const w = pcalWrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    pg.style.transitionDuration = `${ms}ms, ${ms}ms, .3s`;
    pg.style.left = ((r.left + r.width * dx) - w.left) / w.width * 100 + '%';
    pg.style.top = ((r.top + r.height * dy) - w.top) / w.height * 100 + '%';
  };
  const pClick = () => { pg.classList.remove('clicked'); void pg.offsetWidth; pg.classList.add('clicked'); };
  const POST_TEXT = '【新メニュー】秋のケアカラー、はじめました🍁 ツヤ感長持ち。ご予約はメッセージからどうぞ';
  const pReset = () => {
    pClear();
    P('pcalComp').classList.remove('open');
    ['pch1','pch2','pch3','pch4'].forEach(c => P(c).classList.remove('on'));
    P('pcalNewChip').classList.remove('shown');
    P('pcalText').innerHTML = '<span class="pc-ph">お知らせを入力…</span>';
    pg.classList.remove('on');
    pg.style.transitionDuration = '0ms, 0ms, .3s';
    pg.style.left = '86%'; pg.style.top = '80%';
  };
  const pPlay = () => {
    pReset();
    pAfter(350, () => { pg.classList.add('on'); pCursorTo('pcalNew', 700); });
    pAfter(1150, () => { pClick();
      const b = P('pcalNew'); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 250);
      P('pcalComp').classList.add('open');
    });
    pAfter(1750, () => {
      const el = P('pcalText');
      el.textContent = '';
      let i = 0;
      const iv = setInterval(() => {
        el.textContent = POST_TEXT.slice(0, ++i);
        if (i >= POST_TEXT.length) clearInterval(iv);
      }, 26);
      pTimers.push(iv);
    });
    pAfter(3300, () => pCursorTo('pch1', 420));
    pAfter(3800, () => { pClick(); P('pch1').classList.add('on'); });
    pAfter(4050, () => P('pch2').classList.add('on'));
    pAfter(4280, () => P('pch3').classList.add('on'));
    pAfter(4500, () => P('pch4').classList.add('on'));
    pAfter(4850, () => pCursorTo('pcalSend', 560));
    pAfter(5550, () => { pClick(); P('pcalComp').classList.remove('open'); });
    pAfter(6050, () => P('pcalNewChip').classList.add('shown'));
    pAfter(6500, () => pg.classList.remove('on'));
    pAfter(9200, () => { if (pPlaying) pPlay(); });
  };
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=reduced.matches;
  const render=()=>{pClear();pPlaying=!paused&&!document.hidden;if(pPlaying)pPlay();else{pReset();P('pcalNewChip').classList.add('shown')}};
  window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='feature-demo-pause')return;paused=!!e.data.paused;render()});
  document.addEventListener('visibilitychange',render);
  render();
}
const fit=()=>{document.getElementById('canvas').style.transform='scale('+innerWidth/700+')'};
addEventListener('resize',fit);fit();
