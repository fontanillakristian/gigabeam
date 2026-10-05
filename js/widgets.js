/* widgets.js - Small shared controls that upgrade plain inputs wherever they appear (the options bar, the Properties panel, dialogs):
   1. Color wells. Every <input type="color"> becomes four small squares: the first shows the color and opens the color window, the other three
      (close together) are the colors picked most recently. The real input stays in the page, hidden, so the code that reads its .value and listens for
      its input / change events keeps working unchanged. Mark an input data-nowell to leave it alone.
   2. Sliders show their filled part (--p), so a range input looks like a proper slider. */
(function(){
  'use strict';
  const KEY='gb-recent-colors', SEED=['#e0362b','#2f8cff','#1a1a1a'], HEX=/^#[0-9a-f]{6}$/i;
  let recents=SEED.slice();
  try{ const s=JSON.parse(localStorage.getItem(KEY)); if(Array.isArray(s)) recents=s.filter(c=>HEX.test(c)).concat(SEED).slice(0,3); }catch(e){}
  const wells=new Set(), valueProp=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
  // programmatic `input.value = ...` does not fire an event, so the value property is wrapped to keep the squares / slider fill current
  function watchValue(inp,refresh){
    Object.defineProperty(inp,'value',{configurable:true,get(){ return valueProp.get.call(this); },set(v){ valueProp.set.call(this,v); refresh(); }});
  }

  // ---- color wells
  function remember(hex){
    hex=String(hex).toLowerCase(); if(!HEX.test(hex)) return;
    recents=[hex].concat(recents.filter(c=>c!==hex)).slice(0,3);
    try{ localStorage.setItem(KEY,JSON.stringify(recents)); }catch(e){}
    wells.forEach(w=>w());
  }
  function makeWell(inp){
    if(inp.dataset.well||inp.dataset.nowell!==undefined||inp.id==='color-pick') return; // (color-pick is the hidden holder of the default markup color)
    inp.dataset.well='1';
    const wrap=document.createElement('span'); wrap.className='cwell';
    inp.parentNode.insertBefore(wrap,inp); wrap.appendChild(inp);
    const main=document.createElement('button'); main.type='button'; main.className='cw-main'; main.title='Pick a color…'; main.setAttribute('aria-label','Pick a color');
    const rec=document.createElement('span'); rec.className='cw-rec';
    const dots=[0,1,2].map(i=>{ const b=document.createElement('button'); b.type='button'; b.className='cw-recent'; b.setAttribute('aria-label','Recent color '+(i+1)); rec.appendChild(b); return b; });
    wrap.append(main,rec);
    const refresh=()=>{
      const v=(inp.value||'').toLowerCase(); main.style.background=v||'#000';
      dots.forEach((b,i)=>{ const c=recents[i]||SEED[i]; b.style.background=c; b.title=c; b.dataset.c=c; b.classList.toggle('cur',c===v); });
      const off=inp.disabled; wrap.classList.toggle('off',off); [main,...dots].forEach(b=>b.disabled=off);
    };
    watchValue(inp,refresh); wells.add(refresh); refresh();
    const fire=t=>inp.dispatchEvent(new Event(t,{bubbles:true}));
    main.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); if(inp.disabled) return; try{ inp.showPicker?inp.showPicker():inp.click(); }catch(err){ inp.click(); } });
    rec.addEventListener('click',e=>{ const b=e.target.closest('.cw-recent'); if(!b) return; e.preventDefault(); e.stopPropagation();
      valueProp.set.call(inp,b.dataset.c); refresh(); fire('input'); fire('change'); remember(b.dataset.c); });
    inp.addEventListener('input',refresh);
    inp.addEventListener('change',()=>{ refresh(); remember(inp.value); }); // the color window was closed on a color: that one is now the most recent
  }

  // ---- sliders: the filled part up to the thumb
  function fillSlider(r){ const min=+r.min||0, max=r.max===''?100:+r.max, v=+r.value; r.style.setProperty('--p',(max>min?Math.min(100,Math.max(0,(v-min)/(max-min)*100)):0)+'%'); }
  function makeSlider(r){ if(r.dataset.slider) return; r.dataset.slider='1'; const f=()=>fillSlider(r); watchValue(r,f); r.addEventListener('input',f); f(); }

  function scan(root){
    if(root.nodeType!==1) return;
    if(root.matches('input[type=color]')) makeWell(root); else if(root.matches('input[type=range]')) makeSlider(root);
    root.querySelectorAll('input[type=color]').forEach(makeWell); root.querySelectorAll('input[type=range]').forEach(makeSlider);
  }
  scan(document.body);
  new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
  // attributes such as min / max / disabled set after the control was created
  document.addEventListener('change',e=>{ if(e.target.matches&&e.target.matches('input[type=range]')) fillSlider(e.target); },true);
})();
