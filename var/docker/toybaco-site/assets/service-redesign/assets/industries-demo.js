/* Read-only preset explorer. Native controls; no customer messages are sent. */
(() => {
 const data = window.industryPackData;
 if (!data) return;
 const {packs,icons} = data;
 const $ = id => document.getElementById(id);
 let currentPack = packs[0], currentPanel = 'reply';
 const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const formatted = value => escape(value).replace(/◯|&lt;URL&gt;/g, token => '<span class="editable-placeholder">'+token+'</span>');
 const symbol = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
 const animate = el => {el.classList.remove('sample-enter');void el.offsetWidth;el.classList.add('sample-enter');};
 const setHeight = () => parent.postMessage({type:'industry-demo-height',height:Math.ceil(document.getElementById('pack-demo').getBoundingClientRect().height)},location.origin);
 const selected = (container, index) => container.querySelectorAll('button').forEach((button,i) => button.setAttribute('aria-pressed',String(i===index)));
 function renderReply(index) {
  const reply = currentPack.replies[index];
  $('demo-reply-title').textContent = reply.title;
  $('demo-reply-body').innerHTML = formatted(reply.body);
  selected($('demo-reply-list'),index);
  animate($('demo-reply-body'));
  setHeight();
 }
 function renderPost(index) {
  const post = currentPack.posts[index];
  $('demo-post-title').textContent = post.title;
  $('demo-post-body').innerHTML = formatted(post.body);
  const editingNote = post.editingNote || currentPack.postEditingNote || '';
  $('demo-post-editing-note-body').textContent = editingNote;
  $('demo-post-editing-note').hidden = !editingNote;
  selected($('demo-post-list'),index);
  animate($('demo-post-body'));
  setHeight();
 }
 function choices(container, list, render) {
  container.replaceChildren();
  list.forEach((item,index) => {
   const button = document.createElement('button');
   button.className = 'template-choice';button.type='button';button.textContent=item.title;
   button.setAttribute('aria-pressed',String(index===0));
   button.addEventListener('click', () => render(index));
   container.append(button);
  });
 }
 function renderPack(pack, notifyParent = false) {
  currentPack=pack;
  $('packList').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.pack===pack.id)));
  $('demo-industry-select').value=pack.id;
  $('packAcct').textContent=pack.store;
  $('reply-count').textContent=pack.counts[0];
  const customer=pack.convs[0];
  $('demo-customer').textContent=customer.name;
  $('demo-question').textContent=customer.pv;
  $('demo-label').textContent=pack.lab0;
  const marks={line:'<img src="assets/brands/line.png" alt="LINE公式アカウント">',ig:'<img src="assets/brands/instagram-color.png" alt="Instagram DM">',mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-label="メール" role="img"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>'};
  $('demo-channel').innerHTML=marks[customer.ch];
  choices($('demo-reply-list'),pack.replies.slice(0,3),renderReply);
  $('reply-list-note').textContent='ほか'+(pack.counts[0]-3)+'種類の定型文も含まれます';
  renderReply(0);
  $('demo-label-list').innerHTML=pack.labels.map(([label,color],i)=>'<div class="demo-label-item"><span><i style="background:'+color+'" aria-hidden="true"></i>'+escape(label)+'</span><p>'+escape(pack.labelDescriptions[i]||'対応内容に合わせて分類')+'</p></div>').join('');
  choices($('demo-post-list'),pack.posts,renderPost);
  renderPost(0);
  $('pack-announcement').textContent=pack.label+'のひな形を表示しました';
  if(notifyParent)parent.postMessage({type:'industry-demo-selected',id:pack.id},location.origin);
  setHeight();
 }
 function changePanel(name, focus=false) {
  currentPanel=name;
  document.querySelectorAll('[data-panel]').forEach(button=>{
   const active=button.dataset.panel===name;
   button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
   document.getElementById(button.getAttribute('aria-controls')).hidden=!active;
   if(active&&focus)button.focus();
  });
  setHeight();
 }
 packs.forEach(pack => {
  const button=document.createElement('button');
  button.type='button';button.className='pack-btn';button.dataset.pack=pack.id;
  button.setAttribute('aria-pressed',String(pack===currentPack));
  button.innerHTML=symbol(pack.icon)+'<span>'+escape(pack.label)+'</span>';
  button.addEventListener('click',()=>renderPack(pack,true));$('packList').append(button);
  const option=document.createElement('option');option.value=pack.id;option.textContent=pack.label;$('demo-industry-select').append(option);
 });
 $('demo-industry-select').addEventListener('change',event=>renderPack(packs.find(pack=>pack.id===event.target.value),true));
 const tabs=[...document.querySelectorAll('[data-panel]')];
 tabs.forEach((button,index)=>{
  button.addEventListener('click',()=>changePanel(button.dataset.panel));
  button.addEventListener('keydown',event=>{
   let next;
   if(event.key==='ArrowRight')next=(index+1)%tabs.length;
   else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
   else if(event.key==='Home')next=0;
   else if(event.key==='End')next=tabs.length-1;
   else return;
   event.preventDefault();changePanel(tabs[next].dataset.panel,true);
  });
 });
 window.addEventListener('message',event=>{
  if(event.source!==parent || event.origin!==location.origin || event.data?.type!=='industry-demo-select')return;
  const pack=packs.find(pack=>pack.id===event.data.id);
  if(pack && pack.id!==currentPack.id)renderPack(pack);
 });
 renderPack(currentPack);changePanel(currentPanel);
 document.querySelector('.demo-window').setAttribute('aria-busy','false');
 tabs.forEach(button=>button.disabled=false);
 $('demo-industry-select').disabled=false;
 parent.postMessage({type:'industry-demo-ready'},location.origin);
 if('ResizeObserver' in window)new ResizeObserver(setHeight).observe($('pack-demo'));
 document.fonts?.ready.then(setHeight);
 window.addEventListener('resize',setHeight);
})();
