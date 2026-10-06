/* Trusted manual controls only. Search text, demo text and form values never leave the page. */
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const measurement=window.toybacoMeasurement;if(!measurement)return;
    const emit=measurement.emit;
    const seen=new Set();
    document.querySelectorAll('[data-section-id]').forEach(section=>{
      const marker=section.querySelector('h2,h1');if(!marker||!('IntersectionObserver' in window))return;
      let visible=false,timer;const reset=()=>{clearTimeout(timer);};
      const update=()=>{reset();if(visible&&!document.hidden&&!seen.has(section.dataset.sectionId))timer=setTimeout(()=>{if(visible&&!document.hidden&&emit('section_view',{section_id:section.dataset.sectionId}))seen.add(section.dataset.sectionId);},1000);};
      new IntersectionObserver(entries=>{visible=entries[0].isIntersecting&&entries[0].intersectionRatio>=.5;update();},{threshold:[0,.5,1]}).observe(marker);
      document.addEventListener('visibilitychange',update);window.addEventListener('pagehide',reset);
    });
    let lastIndustry=document.getElementById('industry-jump-select')?.value;
    const beforeCycles=new WeakMap();
    document.addEventListener('click',event=>{const b=event.target.closest('[data-billing],[data-signup-cycle]');if(b)beforeCycles.set(b,b.getAttribute('aria-pressed'));},true);
    document.addEventListener('click',event=>{
      if(!event.isTrusted)return;
      const b=event.target.closest('[data-billing],[data-signup-cycle]');
      if(b&&beforeCycles.get(b)!=='true')emit('billing_cycle_change',{billing_cycle:b.dataset.billing||b.dataset.signupCycle});
      const choice=event.target.closest('.industry-choice');if(choice){const id=choice.hash.slice(1);if(id!==lastIndustry){emit('industry_select',{industry_id:id});lastIndustry=id;}}
      const demo=event.target.closest('[data-experience]'),button=event.target.closest('button');
      if(demo&&button){
        const map={message:'message_select',assign:'assign',draft:'draft',resolve:'resolve',reset:'reset',format:'format_change',reserve:'reserve',published:'published_example',play:'play'};
        const key=Object.keys(map).find(k=>button.hasAttribute('data-'+k));
        if(key)emit('demo_interaction',{demo_id:demo.dataset.experience,demo_action:map[key],...(demo.dataset.experience==='posting'?{media_format:demo.querySelector('[data-format][aria-pressed="true"]')?.dataset.format==='video'?'video':'image'}:{})});
      }
      const figure=event.target.closest('.feature-animation');
      if(figure&&button)emit('demo_interaction',{demo_id:figure.querySelector('iframe').src.includes('inbox')?'feature_inbox':'feature_post',demo_action:button.getAttribute('aria-pressed')==='true'?'pause':'resume'});
    });
    document.getElementById('industry-jump-select')?.addEventListener('change',event=>{if(event.isTrusted&&event.target.value!==lastIndustry){lastIndustry=event.target.value;emit('industry_select',{industry_id:lastIndustry});}});
    window.addEventListener('message',event=>{
      const frame=document.getElementById('industry-demo');
      if(!frame||event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='industry-demo-selected'||event.data.id===lastIndustry)return;
      if(emit('industry_select',{industry_id:event.data.id}))lastIndustry=event.data.id;
    });
    document.querySelectorAll('[data-experience] select,[data-experience] input[type="checkbox"]').forEach(control=>control.addEventListener('change',event=>{
      if(event.isTrusted)emit('demo_interaction',{demo_id:'posting',demo_action:control.hasAttribute('data-preview')?'preview_change':control.hasAttribute('data-time')?'time_change':'target_change',media_format:control.closest('[data-experience]').querySelector('[data-format][aria-pressed="true"]')?.dataset.format==='video'?'video':'image'});
    }));
    const query=document.getElementById('faq-query');let timer,lastQuery='';
    const count=()=>document.querySelectorAll('.faq-item:not([hidden])').length;
    const search=()=>{const value=query.value.trim();if(!value||value===lastQuery)return;lastQuery=value;const result=count();emit('faq_search',{faq_category:'all',result_count:result,has_results:String(result>0),query_length_band:value.length<=5?'1_5':value.length<=10?'6_10':value.length<=20?'11_20':'21_plus'});};
    query?.addEventListener('input',event=>{if(!event.isTrusted)return;clearTimeout(timer);if(!query.value.trim())lastQuery='';else timer=setTimeout(search,500);});
    document.getElementById('faq-search')?.addEventListener('submit',event=>{if(event.isTrusted){clearTimeout(timer);search();}});
    document.querySelectorAll('.faq-category').forEach(link=>{let before;link.addEventListener('click',()=>{before=link.getAttribute('aria-current');},true);link.addEventListener('click',event=>{if(event.isTrusted&&before!=='true')emit('faq_category_select',{faq_category:link.dataset.filter,result_count:count()});});});
    document.querySelectorAll('[data-guide-filter]').forEach(button=>{let before;button.addEventListener('click',()=>{before=button.getAttribute('aria-pressed');},true);button.addEventListener('click',event=>{if(event.isTrusted&&before!=='true')emit('guide_filter_select',{content_category:button.dataset.guideFilter,result_count:document.querySelectorAll('.guide-card:not([hidden])').length});});});
  });
})();
