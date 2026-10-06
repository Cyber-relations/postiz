/* Industry selection, editing examples, and read-only demo share one state. */
(() => {
 const data = window.industryPackData;
 if (!data) return;
 const packs = new Map(data.packs.map(pack => [pack.id, pack]));
 const sections = [...document.querySelectorAll('.industry-detail')];
 const selector = document.getElementById('industry-jump-select');
 const frame = document.getElementById('industry-demo');
 const controls = document.querySelector('.flow-controls');
 const flowBody = document.getElementById('flow-post-body');
 const cards = [...document.querySelectorAll('.industry-choice')];
 const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const samples = {
  beauty:{values:['10','9','金','11','00','14','00'],fields:[['日時','10月9日（金）'],['空き時間','11:00 / 14:00']]},
  food:{values:['10','9','金','17','30','4'],fields:[['日時','10月9日（金）17:30'],['人数','4名まで']]},
  estate:{values:['10','9','金','11','00','14','00'],fields:[['内見の日程','10月9日（金）'],['案内できる時間','11:00 / 14:00']]},
  'retail-ec':{values:['トートバッグ','10','9','https://example.com/item'],fields:[['商品名','トートバッグ'],['案内する日','10月9日'],['案内先','自社の商品ページ']]},
  clinic:{values:['10','9','11','00','14','00'],label:'例：クリニック（医療機関）',fields:[['予約の日程','10月9日'],['空き時間','11:00 / 14:00']]},
  school:{values:['10','9','16','17'],fields:[['体験授業の日程','10月9日'],['時間','16時 / 17時']]},
  auto:{values:['10','9','11','14'],fields:[['整備予約の日程','10月9日'],['受付できる時間','11時 / 14時']]},
  reform:{values:['10','10','9','10','12'],fields:[['案内する月','10月'],['現地調査の日程','10月9日 / 10月12日']]},
  hotel:{values:['10','9','10','9','2'],fields:[['宿泊日','10月9日'],['空室数','2室']]},
  'bridal-photo':{values:['10','10','9','10','12'],fields:[['案内する月','10月'],['撮影の日程','10月9日 / 10月12日']]},
  pet:{values:['10','9','金','11','00','14','00'],label:'例：トリミングサロン',fields:[['予約の日程','10月9日（金）'],['空き時間','11:00 / 14:00']]},
  pro:{values:['10','9','金','11','00','14','00'],fields:[['面談の日程','10月9日（金）'],['時間','11:00 / 14:00']]}
 };
 let currentId = packs.has(location.hash.slice(1)) ? location.hash.slice(1) : 'beauty';
 let flowView = 'template';
 function renderFlow() {
  const pack = packs.get(currentId), sample = samples[currentId], post = pack.posts[0];
  let position = 0;
  const source = flowView === 'edited' && currentId === 'retail-ec' ? post.body.replace('◯商品','◯') : post.body;
  flowBody.innerHTML = escape(source).replace(/◯|&lt;URL&gt;/g,token => {
   const value = sample.values[position++];
   return '<mark class="'+(flowView === 'edited'?'filled-field':'template-field')+'">'+(flowView === 'edited'?escape(value ?? token):token)+'</mark>';
  });
  document.getElementById('flow-example-label').textContent = sample.label || '例：'+pack.label;
  document.getElementById('flow-template-title').textContent = post.title;
  document.getElementById('flow-paper-state').textContent = flowView === 'edited' ? '自社情報を入れた例' : '投稿文のひな形';
  document.getElementById('flow-fields').innerHTML = sample.fields.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('');
  const note = post.editingNote || pack.postEditingNote || '';
  document.getElementById('flow-editing-note-body').textContent = note;
  document.getElementById('flow-editing-note').hidden = !note;
  controls.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.flowView === flowView)));
  document.querySelector('.pack-workbench').dataset.view = flowView;
  flowBody.classList.remove('flow-change');void flowBody.offsetWidth;flowBody.classList.add('flow-change');
 }
 function sendSelection() {
  frame?.contentWindow?.postMessage({type:'industry-demo-select',id:currentId},location.origin);
 }
 function choose(id,{historyMode=null,scroll=false,focus=false}={}) {
  if (!packs.has(id)) return;
  currentId=id;
  if(selector) selector.value=id;
  cards.forEach(card=>{
   if(card.hash==='#'+id)card.setAttribute('aria-current','true');
   else card.removeAttribute('aria-current');
  });
  sections.forEach(section=>section.querySelector('.industry-disclosure').open=section.id===id);
  const pack=packs.get(id);
  document.querySelector('.scene-industry b').textContent=pack.label;
  document.querySelector('.scene-industry img').src=document.querySelector('.industry-choice[href="#'+id+'"] .industry-choice-art').getAttribute('src');
  document.getElementById('selected-pack-status').textContent='選択中：'+pack.label;
  renderFlow();sendSelection();
  if(historyMode && location.hash!=='#'+id)history[historyMode==='push'?'pushState':'replaceState'](null,'','#'+id);
  if(scroll){
   const section=document.getElementById(id);
   if(focus)section.querySelector('.pack-detail-summary').focus({preventScroll:true});
   requestAnimationFrame(()=>section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
  }
 }
 cards.forEach(card=>card.addEventListener('click',event=>{
  if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
  event.preventDefault();choose(card.hash.slice(1),{historyMode:'push',scroll:true,focus:true});
 }));
 selector?.addEventListener('change',()=>choose(selector.value,{historyMode:'push',scroll:true,focus:true}));
 sections.forEach(section=>section.querySelector('.industry-disclosure').addEventListener('toggle',event=>{
  if(event.currentTarget.open && section.id!==currentId)choose(section.id,{historyMode:'replace'});
 }));
 controls.hidden=false;
 controls.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{flowView=button.dataset.flowView;renderFlow();}));
 const followHash=()=>{const id=location.hash.slice(1);if(packs.has(id))choose(id,{scroll:true});};
 window.addEventListener('hashchange',followHash);
 window.addEventListener('popstate',followHash);
 frame?.addEventListener('load',sendSelection);
 window.addEventListener('message',event=>{
  if(!frame || event.source!==frame.contentWindow || event.origin!==location.origin)return;
  if(event.data?.type==='industry-demo-ready')sendSelection();
  if(event.data?.type==='industry-demo-selected')choose(event.data.id,{historyMode:'replace'});
  if(event.data?.type==='industry-demo-height'){
   const height=Number(event.data.height);
   if(Number.isFinite(height) && height>0 && height<6000)frame.style.height=Math.max(350,Math.ceil(height))+'px';
  }
 });
 document.body.classList.add('pack-enhanced');choose(currentId);
})();
