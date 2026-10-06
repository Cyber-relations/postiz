// Only animate visible cards; respect motion preference and each pause button.
(()=>{
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 document.querySelectorAll('.feature-animation').forEach(figure=>{
  const frame=figure.querySelector('iframe'),button=figure.querySelector('button');
  let paused=reduced.matches,visible=false;
  const update=()=>{button.textContent=paused?'再生':'一時停止';button.setAttribute('aria-pressed',String(paused));frame.contentWindow?.postMessage({type:'feature-demo-pause',paused:paused||!visible||document.hidden},location.origin)};
  button.addEventListener('click',()=>{paused=!paused;update()});
  frame.addEventListener('load',update);
  new IntersectionObserver(es=>{visible=es[0].isIntersecting;update()},{threshold:.2}).observe(figure);
  document.addEventListener('visibilitychange',update);
  reduced.addEventListener('change',()=>{paused=reduced.matches;update()});update();
 });
})();
