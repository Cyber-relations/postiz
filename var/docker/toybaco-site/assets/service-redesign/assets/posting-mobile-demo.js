// The phone view presents one complete scene at a time without horizontal scrolling.
(()=>{
 const demo=document.querySelector('.posting-mobile-demo');
 if(!demo)return;
 const tabs=[...demo.querySelectorAll('[role=tab]')];
 const panels=[...demo.querySelectorAll('[role=tabpanel]')];
 const select=(tab,focus=false)=>{
  tabs.forEach(item=>{const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1});
  panels.forEach(panel=>{panel.hidden=panel.id!==tab.getAttribute('aria-controls')});
  if(focus)tab.focus();
 };
 tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>select(tab));
  tab.addEventListener('keydown',event=>{
   let next;
   if(event.key==='ArrowRight')next=(index+1)%tabs.length;
   else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
   else if(event.key==='Home')next=0;
   else if(event.key==='End')next=tabs.length-1;
   else return;
   event.preventDefault();select(tabs[next],true);
  });
 });
})();
