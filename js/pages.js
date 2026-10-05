/* pages.js - The continuous page stack, lazy page rendering, page thumbnails, and page operations (delete, insert, reorder). */
// ---------- continuous page stack ----------
// Every page gets its own stage (canvas + SVG overlay + text boxes), stacked in one
// scrolling column. Canvases are only painted while near the viewport and released again
// when far away, so long documents don't hold every page bitmap in memory at once.
async function layoutPages(){
  const token=++layoutToken;
  clearPending(true); isDragging=false;
  if(pageObserver){ pageObserver.disconnect(); pageObserver=null; }
  const pages=await Promise.all(Array.from({length:numPages},(_,i)=>pdfDoc.getPage(i+1)));
  if(token!==layoutToken) return false;
  main.innerHTML='';
  const cont=document.createElement('div'); cont.id='pages-container';
  pageViews=[];
  pages.forEach((page,i)=>{
    const num=i+1;
    const vp=page.getViewport({scale}), vp1=page.getViewport({scale:1});
    const w=Math.floor(vp.width), h=Math.floor(vp.height);
    const stage=document.createElement('div'); stage.className='pg-stage'; stage.dataset.page=num;
    stage.style.width=w+'px'; stage.style.height=h+'px';
    const cv=document.createElement('canvas'); cv.className='pg-canvas'; cv.style.width=w+'px'; cv.style.height=h+'px';
    const sv=svgEl('svg',{class:'pg-svg',width:w,height:h}); sv.style.width=w+'px'; sv.style.height=h+'px';
    stage.appendChild(cv); stage.appendChild(sv);
    stage.addEventListener('mousedown',e=>{ drawPage=num; onDown(e); });
    stage.addEventListener('mousemove',onMove);
    stage.addEventListener('click',e=>{ if(pendingPoints.length&&drawPage!==num) clearPending(); drawPage=num; onClick(e); });
    stage.addEventListener('dblclick',e=>{ drawPage=num; onDblClick(e); });
    cont.appendChild(stage);
    pageViews.push({num,stage,canvas:cv,svg:sv,w,h,ptsW:vp1.width,ptsH:vp1.height,rendered:false,rendering:false});
  });
  main.appendChild(cont);
  if(drawPage>numPages) drawPage=1;
  applyViewMode();
  setupObserver();
  return true;
}
function setupObserver(){
  if(typeof IntersectionObserver==='undefined'){ pageViews.forEach(v=>renderPageCanvas(v)); return; }
  pageObserver=new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      const v=pageViews[(+en.target.dataset.page)-1]; if(!v) return;
      if(en.isIntersecting) renderPageCanvas(v); else releaseCanvas(v);
    });
  },{root:main,rootMargin:coarse()?'400px 0px':'800px 0px'}); // (phones hold fewer painted pages: less memory)
  pageViews.forEach(v=>pageObserver.observe(v.stage));
}
// How many bitmap pixels per screen pixel a page is painted with. Touch devices (phones, tablets) have sharp screens, so pages are painted
// at up to 2x for crisp text, but never with more pixels than PAGE_PX_TOUCH: iOS draws nothing at all for a canvas over ~16.7 million
// pixels and closes the tab when memory runs out, so a big sheet at high zoom is painted a little softer instead. Elsewhere 1x, as before.
const PAGE_PX_TOUCH=10e6, PAGE_PX_MAX=60e6;
function pageDensity(w,h){
  const want=coarse()?Math.min(2,window.devicePixelRatio||1):1, cap=coarse()?PAGE_PX_TOUCH:PAGE_PX_MAX;
  return Math.min(want,Math.sqrt(cap/Math.max(1,w*h)));
}
async function renderPageCanvas(v){
  if(v.rendered||v.rendering) return;
  v.rendering=true; const tok=layoutToken;
  try{
    const page=await pdfDoc.getPage(v.num);
    if(tok!==layoutToken) return;
    const d=pageDensity(v.w,v.h);
    v.canvas.width=Math.max(1,Math.floor(v.w*d)); v.canvas.height=Math.max(1,Math.floor(v.h*d)); // (its CSS size stays v.w x v.h)
    await page.render({canvasContext:v.canvas.getContext('2d'), viewport:page.getViewport({scale:scale*v.canvas.width/v.w}), annotationMode:pdfjsLib.AnnotationMode.ENABLE}).promise;
    if(tok===layoutToken) v.rendered=true;
  }catch(e){ /* a page that fails to paint just stays blank */ }
  finally{ v.rendering=false; }
}
function releaseCanvas(v){
  if(!v.rendered||v.rendering) return;
  v.canvas.width=0; v.canvas.height=0; v.rendered=false;
}
// One page at a time: every page keeps its place in pageViews (so the rest of the app is unchanged), but only the current page is shown.
function applyViewMode(){
  const single=viewMode==='single';
  pageViews.forEach(v=>{ v.stage.style.display=(single&&v.num!==currentPage)?'none':''; });
  document.body.classList.toggle('single-page',single);
}
function pageTopInMain(v){ return v.stage.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop; }
function scrollToPage(n,smooth){
  const v=pageViews[n-1]; if(!v) return;
  if(viewMode==='single'){ applyViewMode(); main.scrollTop=0; main.scrollLeft=0; return; } // (the page shown is the current one)
  const top=Math.max(0,pageTopInMain(v)-12);
  if(main.scrollTo){ try{ main.scrollTo({top,behavior:smooth?'smooth':'auto'}); return; }catch(e){} }
  main.scrollTop=top;
}
function captureScrollAnchor(){
  const v=pageViews[currentPage-1]; if(!v) return null;
  return {page:currentPage, ratio:(main.getBoundingClientRect().top - v.stage.getBoundingClientRect().top)/v.h};
}
function restoreScrollAnchor(a){
  if(!a) return; const v=pageViews[a.page-1]; if(!v) return;
  main.scrollTop=pageTopInMain(v)+a.ratio*v.h;
}
function updatePageIndicator(){
  pageNumInput.value=numPages?currentPage:''; pageTotal.textContent=numPages;
  prevBtn.disabled=!numPages||currentPage<=1; nextBtn.disabled=!numPages||currentPage>=numPages;
  const v=pageViews[currentPage-1]; $('paper-size').textContent=v?paperLabel(v.ptsW,v.ptsH):''; syncThumbMarks();
}
function goToPage(n){ currentPage=n; updatePageIndicator(); updateActiveThumb(); scrollToPage(n,false); }
// The "current" page follows scrolling: whichever page sits under a probe line near the top.
let scrollTick=false;
main.addEventListener('scroll',()=>{
  if(scrollTick) return; scrollTick=true;
  requestAnimationFrame(()=>{ scrollTick=false; updateCurrentPageFromScroll(); });
},{passive:true});
function updateCurrentPageFromScroll(){
  if(!pageViews.length||viewMode==='single') return; // (one page at a time: the page only changes by going to another one)
  const mr=main.getBoundingClientRect();
  const probe=mr.top+Math.min(mr.height*0.3,240);
  let best=1;
  for(const v of pageViews){ if(v.stage.getBoundingClientRect().top<=probe) best=v.num; else break; }
  // At the very top / bottom of the document the last (or first) page may be too short to reach the probe line.
  if(main.scrollTop<=0) best=1; else if(main.scrollTop+main.clientHeight>=main.scrollHeight-2) best=numPages;
  if(best!==currentPage){ currentPage=best; updatePageIndicator(); updateActiveThumb(); }
}
// Lays out every page, draws all overlays, then jumps to the current page.
async function renderPage(){
  const ok=await layoutPages(); if(!ok) return;
  renderAll(); renderProps(); updatePageIndicator(); updateActiveThumb();
  scrollToPage(currentPage,false);
}

function updateActiveThumb(){
  if(!pagesList) return;
  pagesList.querySelectorAll('.thumb').forEach((el,idx)=>el.classList.toggle('active', idx+1===currentPage));
  const el=pagesList.children[currentPage-1];
  if(el&&el.getBoundingClientRect){ // keep the active thumbnail in view as the document scrolls
    const lr=pagesList.getBoundingClientRect(), er=el.getBoundingClientRect();
    if(er.top<lr.top) pagesList.scrollTop-=(lr.top-er.top)+8; else if(er.bottom>lr.bottom) pagesList.scrollTop+=(er.bottom-lr.bottom)+8;
  }
}

// ---- multi-select in the thumbnail list, and drag-to-reorder with a landing line between thumbnails
let thumbSel=new Set(), thumbAnchor=null, thumbDrag=null, dropAt=null;
function syncThumbSel(){
  pagesList.querySelectorAll('.thumb').forEach((el,idx)=>el.classList.toggle('selected',thumbSel.has(idx+1)));
  pagesList.classList.toggle('has-sel',thumbSel.size>0);
  const bar=document.getElementById('sel-bar'); if(!bar) return;
  bar.style.display=thumbSel.size?'flex':'none';
  document.getElementById('sel-count').textContent=thumbSel.size+' selected';
}
function thumbSelect(n,mode){
  if(mode==='clear') thumbSel.clear();
  else if(mode==='all'){ for(let k=1;k<=numPages;k++) thumbSel.add(k); }
  else if(mode==='range'){ const a=thumbAnchor||currentPage||n, lo=Math.min(a,n), hi=Math.max(a,n); thumbSel.clear(); for(let k=lo;k<=hi;k++) thumbSel.add(k); }
  else{ thumbSel.has(n)?thumbSel.delete(n):thumbSel.add(n); thumbAnchor=n; }
  syncThumbSel();
}
function clearDropMarks(){ dropAt=null; pagesList.querySelectorAll('.drop-before,.drop-after').forEach(t=>t.classList.remove('drop-before','drop-after')); }
// the gap the pointer is nearest to: 0 = above page 1 ... numPages = below the last page
function dropIndexAt(ev){
  const t=ev.target.closest&&ev.target.closest('.thumb');
  if(t){ const r=t.getBoundingClientRect(); return (+t.dataset.n)-1+(ev.clientY>r.top+r.height/2?1:0); }
  const kids=pagesList.children; for(let k=0;k<kids.length;k++){ const r=kids[k].getBoundingClientRect(); if(ev.clientY<r.top+r.height/2) return k; }
  return kids.length;
}
pagesList.addEventListener('dragover',ev=>{
  if(!thumbDrag) return; ev.preventDefault(); ev.dataTransfer.dropEffect='move';
  const lr=pagesList.getBoundingClientRect(); if(ev.clientY<lr.top+40) pagesList.scrollTop-=14; else if(ev.clientY>lr.bottom-40) pagesList.scrollTop+=14; // scroll while dragging near an edge
  const idx=dropIndexAt(ev); if(idx===dropAt) return; clearDropMarks(); dropAt=idx;
  const kids=pagesList.children; if(idx<kids.length) kids[idx].classList.add('drop-before'); else if(kids.length) kids[kids.length-1].classList.add('drop-after');
});
pagesList.addEventListener('dragleave',ev=>{ if(!pagesList.contains(ev.relatedTarget)) clearDropMarks(); });
pagesList.addEventListener('drop',async ev=>{
  if(!thumbDrag) return; ev.preventDefault();
  const moving=thumbDrag, at=dropIndexAt(ev); thumbDrag=null; clearDropMarks();
  const rest=[]; for(let n=1;n<=numPages;n++) if(!moving.includes(n)) rest.push(n);
  const order=rest.slice(); order.splice(rest.filter(n=>n<=at).length,0,...moving); // rest pages that stay above the landing line come first
  if(order.every((n,k)=>n===k+1)) return; // landed where it already was
  await reorderPages(order); // (renderPagePanel clears the selection)
});
document.getElementById('sel-delete').onclick=()=>deletePages(Array.from(thumbSel));
document.getElementById('sel-clear').onclick=()=>thumbSelect(null,'clear');
document.getElementById('sel-all').onclick=()=>thumbSelect(null,'all');

let pagePanelToken=0, thumbObserver=null;
// The thumbnail list is built instantly (empty, correctly-shaped placeholders) and each thumbnail is painted only while it is
// near the scroll viewport — two at a time — then released again when far away. An 842-page file therefore costs a few
// milliseconds here instead of rendering every page up front.
// bitmap width for a thumbnail: sharp on high-resolution screens, never huge
const thumbPx=()=>Math.min(600,Math.max(160,Math.round(thumbW*Math.min(2,window.devicePixelRatio||1))));
async function renderPagePanel(){
  if(!pagesList) return;
  const myToken=++pagePanelToken;
  if(thumbObserver){ thumbObserver.disconnect(); thumbObserver=null; }
  pagesList.innerHTML=''; thumbSel.clear(); thumbAnchor=null; syncThumbSel();
  if(!pdfDoc) return;
  const frag=document.createDocumentFragment(), wraps=[];
  for(let i=1;i<=numPages;i++){
    const wrap=document.createElement('div'); wrap.className='thumb'+(i===currentPage?' active':''); wrap.dataset.n=i;
    wrap.draggable=true;
    const pv=pageViews[i-1], pic=document.createElement('div'); pic.className='pic'; pic.style.aspectRatio=pv?`${pv.ptsW} / ${pv.ptsH}`:'0.773';
    pic.appendChild(document.createElement('canvas')); wrap.appendChild(pic);
    const label=document.createElement('span'); label.className='lbl'; label.textContent=i; wrap.appendChild(label);
    const chk=document.createElement('button'); chk.className='sel-chk'; chk.title='Select page (Shift / Ctrl+click to select several)'; chk.setAttribute('aria-label','Select page '+i); chk.innerHTML='<svg class="i sm"><use href="#i-check"/></svg>';
    chk.onclick=e=>{ e.stopPropagation(); thumbSelect(i,e.shiftKey?'range':'toggle'); };
    pic.appendChild(chk);
    const del=document.createElement('button'); del.className='del'; del.title='Delete page'; del.innerHTML='<svg class="i sm"><use href="#i-x"/></svg>';
    del.onclick=e=>{ e.stopPropagation(); deletePages(thumbSel.has(i)&&thumbSel.size>1?Array.from(thumbSel):[i]); }; // on a selected page this deletes the whole selection
    pic.appendChild(del);
    pic.insertAdjacentHTML('beforeend','<span class="badge"><svg class="i"><use href="#i-lock"/></svg>Flattened</span>');
    wrap.insertAdjacentHTML('beforeend','<span class="bm"><svg class="i"><use href="#i-bookmark"/></svg></span>');
    wrap.onclick=e=>{ if(e.shiftKey) thumbSelect(i,'range'); else if(e.ctrlKey||e.metaKey) thumbSelect(i,'toggle'); else{ if(thumbSel.size) thumbSelect(null,'clear'); goToPage(i); if(isPhone()) hideLeft(); } }; // (on a phone the panel covers the page: get out of the way)
    wrap.addEventListener('dragstart',ev=>{
      thumbDrag=thumbSel.has(i)?Array.from(thumbSel).sort((p,q)=>p-q):[i]; // dragging a selected page carries the whole selection
      ev.dataTransfer.setData('text/plain',String(i)); ev.dataTransfer.effectAllowed='move';
      thumbDrag.forEach(n=>{ const t=pagesList.children[n-1]; if(t) t.classList.add('dragging'); });
    });
    wrap.addEventListener('dragend',()=>{ thumbDrag=null; clearDropMarks(); pagesList.querySelectorAll('.dragging').forEach(t=>t.classList.remove('dragging')); });
    frag.appendChild(wrap); wraps.push(wrap);
  }
  pagesList.appendChild(frag); syncThumbMarks(); updateActiveThumb();
  const queue=[]; let running=0;
  const paint=async w=>{
    w.dataset.state='painting';
    try{ const page=await pdfDoc.getPage(+w.dataset.n), v0=page.getViewport({scale:1}), tv=page.getViewport({scale:thumbPx()/v0.width}), c=w.querySelector('canvas');
      if(myToken!==pagePanelToken) return;
      c.width=Math.floor(tv.width); c.height=Math.floor(tv.height);
      await page.render({canvasContext:c.getContext('2d'),viewport:tv,annotationMode:pdfjsLib.AnnotationMode.ENABLE}).promise;
      w.dataset.state='done';
    }catch(e){ w.dataset.state=''; }
  };
  const pump=()=>{ while(running<2&&queue.length){ const w=queue.shift(); if(myToken!==pagePanelToken||!w.isConnected||w.dataset.state!=='queued') continue; running++; paint(w).finally(()=>{ running--; pump(); }); } };
  if(typeof IntersectionObserver==='undefined'){ wraps.slice(0,40).forEach(w=>{ w.dataset.state='queued'; queue.push(w); }); pump(); return; }
  thumbObserver=new IntersectionObserver(entries=>{
    entries.forEach(en=>{ const w=en.target;
      if(en.isIntersecting){ if(!w.dataset.state){ w.dataset.state='queued'; queue.push(w); } }
      else if(w.dataset.state==='done'){ const c=w.querySelector('canvas'); c.width=0; c.height=0; w.dataset.state=''; } // free the bitmap
      else if(w.dataset.state==='queued') w.dataset.state='';
    });
    pump();
  },{root:pagesList,rootMargin:'500px 0px'});
  wraps.forEach(w=>thumbObserver.observe(w));
}

function shiftAnnotationPages(fn){
  const newAnn={};
  Object.keys(annotations).forEach(k=>{ const n=parseInt(k,10); const nn=fn(n); if(nn!=null) newAnn[nn]=annotations[k]; });
  annotations=newAnn; remapPageRefs(fn);
}
async function reloadWorkingDoc(newBytes,flatSet){ // flatSet: the flattened pages, when the caller already knows them (saves re-reading a big file)
  originalBytes=newBytes;
  pdfDoc=await pdfjsLib.getDocument({data:newBytes.slice()}).promise;
  numPages=pdfDoc.numPages;
  flatPages=flatSet||await detectFlattened(newBytes);
  if(currentPage>numPages) currentPage=numPages;
  selected=null;
  if(docs[activeDoc]){ docs[activeDoc].originalBytes=originalBytes; docs[activeDoc].pdfDoc=pdfDoc; docs[activeDoc].numPages=numPages; }
}
// Page-structural edits (delete/insert/reorder) all read-modify-write the SAME shared
// state (originalBytes, annotations, numPages...). Two of these overlapping — e.g. a
// second click landing before the first's chain of awaits finishes — corrupts that
// shared state (confirmed: it's the actual cause of pages/annotations getting jumbled).
// This lock makes them strictly one-at-a-time.
let pageOpBusy=false;
async function withPageLock(fn){
  if(pageOpBusy) return;
  pageOpBusy=true; pagesPanel.classList.add('busy'); bgTask('Working…',null); await tick(); // let the indicator paint before the heavy work
  const before=originalBytes, tab=docs[activeDoc], wasDirty=!!(tab&&tab.dirty); pushHistory(true); // undo point that also remembers the file as it was
  try{ await fn(); }
  finally{
    pageOpBusy=false; pagesPanel.classList.remove('busy'); bgTask(null);
    const top=historyStack[historyStack.length-1];
    if(originalBytes===before&&top&&top.bytes===before){ historyStack.pop(); updateHistBtns(); if(tab){ tab.dirty=wasDirty; renderTabBar(); } } // cancelled or failed: nothing changed, so no undo point and no "unsaved" mark
  }
}
async function deletePages(nums){ return withPageLock(async()=>{
  const ns=Array.from(new Set(nums)).filter(n=>n>=1&&n<=numPages).sort((p,q)=>p-q); if(!ns.length) return;
  if(ns.length>=numPages){ await modalAlert(numPages===1?"Can't delete the only page in the document.":"Can't delete every page in the document."); return; }
  const ok=await modalConfirm(ns.length===1?`Delete page ${ns[0]}? You can bring it back with Undo.`:`Delete ${ns.length} pages (${ns.length<=8?ns.join(', '):ns.slice(0,8).join(', ')+'…'})? You can bring them back with Undo.`); if(!ok) return;
  const r=await heavy('deletePage',{ns}); // the file work runs in the background worker (core.js)
  const before=n=>ns.filter(x=>x<n).length, cur=currentPage;
  shiftAnnotationPages(n=> ns.includes(n)?null : n-before(n));
  await reloadWorkingDoc(r.bytes,new Set(r.flat));
  currentPage=Math.max(1,Math.min(numPages,cur-before(cur))); // a deleted current page lands on the page that followed it
  await renderPage(); await renderPagePanel();
});}
const deletePage=n=>deletePages([n]);
async function insertBlankPage(afterPageNum){ return withPageLock(async()=>{
  const r=await heavy('insertBlank',{after:afterPageNum});
  shiftAnnotationPages(n=> n>afterPageNum?n+1:n);
  await reloadWorkingDoc(r.bytes,new Set(r.flat));
  currentPage=afterPageNum+1;
  await renderPage(); await renderPagePanel();
});}
async function insertPdfFromFile(afterPageNum,file){ return withPageLock(async()=>{
  const src=new Uint8Array(await file.arrayBuffer());
  const r=await heavy('insertPdf',{after:afterPageNum,src});
  shiftAnnotationPages(n=> n>afterPageNum?n+r.count:n);
  await reloadWorkingDoc(r.bytes,new Set(r.flat));
  currentPage=afterPageNum+1;
  await renderPage(); await renderPagePanel();
});}
// newOrder: array of the OLD 1-based page numbers, listed in the NEW desired sequence.
async function reorderPages(newOrder){ return withPageLock(async()=>{
  const r=await heavy('reorder',{order:newOrder});
  const oldToNew={}; newOrder.forEach((oldNum,i)=>oldToNew[oldNum]=i+1);
  const newAnn={};
  Object.keys(annotations).forEach(k=>{ const n=parseInt(k,10); if(oldToNew[n]!=null) newAnn[oldToNew[n]]=annotations[k]; });
  const oldCurrent=currentPage;
  annotations=newAnn; remapPageRefs(n=>oldToNew[n]!=null?oldToNew[n]:null);
  await reloadWorkingDoc(r.bytes,new Set(r.flat));
  currentPage=oldToNew[oldCurrent]||1;
  await renderPage(); await renderPagePanel();
});}
function modalPageChoice(maxPage,defaultPage){
  return new Promise(res=>{
    const ov=document.createElement('div'); ov.className='modal-ovl';
    ov.innerHTML=`<div class="modal-box"><div>Insert relative to which page? (1-${maxPage})</div>
      <input id="mpg-num" type="number" min="1" max="${maxPage}" value="${defaultPage}">
      <div class="row" style="justify-content:flex-start;gap:14px;margin-top:10px;">
        <label style="display:flex;align-items:center;gap:4px;font-size:13px;"><input type="radio" name="mpg-pos" value="before" style="width:auto;"> Before</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:13px;"><input type="radio" name="mpg-pos" value="after" checked style="width:auto;"> After</label>
      </div>
      <div class="row"><button id="mpg-cancel">Cancel</button><button id="mpg-ok" class="primary">Insert</button></div></div>`;
    document.body.appendChild(ov);
    const done=v=>{ov.remove(); res(v);};
    ov.querySelector('#mpg-cancel').onclick=()=>done(null);
    ov.querySelector('#mpg-ok').onclick=()=>{
      const num=parseInt(ov.querySelector('#mpg-num').value,10);
      const pos=ov.querySelector('input[name="mpg-pos"]:checked').value;
      if(!num||num<1||num>maxPage){ done(null); return; }
      done({num,pos});
    };
  });
}
addBlankBtn.onclick=()=>{ if(pdfDoc) insertBlankPage(currentPage); };
insertPdfBtn.onclick=()=>{ if(pdfDoc) insertPdfInput.click(); };
insertPdfInput.onchange=async e=>{
  const file=e.target.files[0]; insertPdfInput.value=''; if(!file) return;
  const choice=await modalPageChoice(numPages,currentPage); if(!choice) return;
  const afterPageNum=choice.pos==='after'?choice.num:choice.num-1;
  try{ await insertPdfFromFile(afterPageNum,file); }
  catch(err){ await modalAlert('Could not insert that PDF: '+err.message); }
};
