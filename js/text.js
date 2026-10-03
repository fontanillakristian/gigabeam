/* text.js - Page text: an invisible, selectable text layer on every page (the PDF's own text, or the words OCR recognised),
   the "Select text" tool, and Find (Ctrl+F) with highlighted results. */

// ---- the PDF's own text, read once per page and document (a new document object after a page operation starts afresh)
const textCache=new WeakMap();
function pageTextContent(n){
  if(!pdfDoc) return Promise.resolve(null);
  let m=textCache.get(pdfDoc); if(!m){ m=new Map(); textCache.set(pdfDoc,m); }
  if(!m.has(n)){ const doc=pdfDoc; m.set(n,doc.getPage(n).then(pg=>pg.getTextContent()).catch(()=>null)); }
  return m.get(n);
}

// ---- text layer (built when a page is painted, dropped with its bitmap)
async function buildTextLayer(v){
  if(v.textLayer||!pdfDoc) return;
  const div=document.createElement('div'); div.className='textLayer'; v.textLayer=div;
  v.stage.insertBefore(div,v.svg); // above the page picture, below the markups
  const ocr=ocrPages[v.num];
  if(ocr) return fillOcrLayer(div,v,ocr);
  const tc=await pageTextContent(v.num); if(!tc||v.textLayer!==div) return;
  const page=await pdfDoc.getPage(v.num), vp=page.getViewport({scale});
  div.style.setProperty('--scale-factor',scale);
  try{ await pdfjsLib.renderTextLayer({textContentSource:tc,container:div,viewport:vp,textDivs:[]}).promise; }catch(e){}
}
function fillOcrLayer(div,v,ocr){
  const W=v.w, H=v.h, words=ocr.words; div.style.width=W+'px'; div.style.height=H+'px';
  const frag=document.createDocumentFragment();
  words.forEach((w,i)=>{
    const f=ocrWordFrame(w,W,H), next=words[i+1], sameLine=next&&next.ln===w.ln, fs=Math.max(1,f.T*0.85);
    const s=document.createElement('span'); s.textContent=w.t+(sameLine?' ':'');
    let k=1; if(measureCtx){ measureCtx.font=`${fs}px sans-serif`; const mw=measureCtx.measureText(s.textContent).width; const room=sameLine?Math.max(f.L,Math.hypot((next.x0-w.x0)*W,(next.y0-w.y0)*H)):f.L; if(mw>0) k=room/mw; }
    s.style.left=f.ox+'px'; s.style.top=f.oy+'px'; s.style.fontSize=fs+'px'; s.style.fontFamily='sans-serif';
    s.style.transform=`rotate(${w.rot||0}deg) scaleX(${k.toFixed(4)})`;
    frag.appendChild(s); if(!sameLine) frag.appendChild(document.createElement('br'));
  });
  div.appendChild(frag);
}
function dropTextLayer(v){ if(v.textLayer){ v.textLayer.remove(); v.textLayer=null; } }
// a page's text changed (OCR finished): rebuild its layer if it is on screen, and refresh Find
function onTextChanged(n){
  const v=pageViews[n-1]; if(v&&v.textLayer){ dropTextLayer(v); if(v.rendered) buildTextLayer(v); }
  if(findState.q) runFind(true);
}
{ // hook into page painting (pages.js)
  const rp=renderPageCanvas, rel=releaseCanvas;
  renderPageCanvas=async function(v){ await rp.apply(this,arguments); if(v.rendered) buildTextLayer(v); };
  releaseCanvas=function(v){ rel.apply(this,arguments); if(!v.rendered) dropTextLayer(v); };
}

// ---- Find (Ctrl+F)
const findBar=$('find-bar'), findIn=$('find-input'), findCount=$('find-count');
const findState={q:'',cs:false,results:[],cur:-1,token:0,searching:false};
// The searchable text of a page and where each piece of it sits: OCR words when the page was recognised, otherwise the PDF's text items.
async function pageTextIndex(n){
  const ocr=ocrPages[n]; let text='', segs=[];
  if(ocr){ ocr.words.forEach(w=>{ segs.push({s:text.length,e:text.length+w.t.length,w}); text+=w.t+' '; }); return {text,segs}; }
  const tc=await pageTextContent(n); if(!tc) return {text,segs};
  const page=await pdfDoc.getPage(n), vp1=page.getViewport({scale:1});
  tc.items.forEach(it=>{ if(!it.str) { if(it.hasEOL) text+=' '; return; } segs.push({s:text.length,e:text.length+it.str.length,it,vp1}); text+=it.str; if(it.hasEOL) text+=' '; });
  return {text,segs};
}
// box (fractions of the page) of characters c0..c1 of one pdf.js text item
function itemRect(it,vp1,c0,c1){
  const [a,b,c,d,e,f]=it.transform, la=Math.hypot(a,b)||1, lc=Math.hypot(c,d)||la, ux=a/la, uy=b/la, vx=c/lc, vy=d/lc, len=it.str.length||1, x0=it.width*c0/len, x1=it.width*c1/len;
  const pts=[[x0,-0.22*lc],[x1,-0.22*lc],[x0,0.9*lc],[x1,0.9*lc]].map(([s,t])=>vp1.convertToViewportPoint(e+ux*s+vx*t,f+uy*s+vy*t));
  const xs=pts.map(p=>p[0]/vp1.width), ys=pts.map(p=>p[1]/vp1.height);
  return {x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};
}
async function runFind(keepCurrent){
  const q=findIn.value, tok=++findState.token, prevCur=findState.cur;
  findState.q=q; findState.cs=$('find-case').checked; findState.results=[]; if(!keepCurrent) findState.cur=-1;
  drawFindHighlights();
  if(!q.trim()||!pdfDoc){ findCount.textContent=''; return; }
  const needle=findState.cs?q:q.toLowerCase(); let firstJumped=false;
  findState.searching=true;
  for(let n=1;n<=numPages;n++){
    if(tok!==findState.token) return;
    if(n%10===1) findCount.textContent=`Searching… ${n}/${numPages}`;
    const {text,segs}=await pageTextIndex(n); if(tok!==findState.token) return;
    const hay=findState.cs?text:text.toLowerCase(); let at=hay.indexOf(needle);
    while(at>=0){
      const end=at+needle.length, rects=[];
      segs.forEach(sg=>{ if(sg.e<=at||sg.s>=end) return; rects.push(sg.w?{x0:sg.w.x0,y0:sg.w.y0,x1:sg.w.x1,y1:sg.w.y1}:itemRect(sg.it,sg.vp1,Math.max(at,sg.s)-sg.s,Math.min(end,sg.e)-sg.s)); });
      if(rects.length) findState.results.push({page:n,rects});
      at=hay.indexOf(needle,at+Math.max(1,needle.length));
    }
    if(!firstJumped&&findState.results.length&&!keepCurrent){ firstJumped=true; findState.cur=findState.results.findIndex(r=>r.page>=currentPage); if(findState.cur<0) findState.cur=0; showFindResult(); }
    else if(n%10===0) drawFindHighlights();
  }
  findState.searching=false;
  if(keepCurrent) findState.cur=Math.min(Math.max(prevCur,0),findState.results.length-1);
  drawFindHighlights(); updateFindCount();
}
function updateFindCount(){ const n=findState.results.length; findCount.textContent=!findState.q.trim()?'':n?`${findState.cur+1} of ${n.toLocaleString()}`:'No matches'; findBar.classList.toggle('nomatch',!!findState.q.trim()&&!n&&!findState.searching); }
function drawFindHighlights(){
  pageViews.forEach(v=>{ const old=v.stage.querySelector('.find-layer'); if(old) old.remove(); });
  if(!findState.results.length) return;
  const byPage={}; findState.results.forEach((r,i)=>{ (byPage[r.page]=byPage[r.page]||[]).push([r,i]); });
  Object.keys(byPage).forEach(p=>{ const v=pageViews[p-1]; if(!v) return;
    const layer=document.createElement('div'); layer.className='find-layer';
    byPage[p].forEach(([r,i])=>r.rects.forEach(b=>{ const d=document.createElement('div'); d.className='hit'+(i===findState.cur?' cur':''); d.style.left=(b.x0*v.w-1)+'px'; d.style.top=(b.y0*v.h-1)+'px'; d.style.width=((b.x1-b.x0)*v.w+2)+'px'; d.style.height=((b.y1-b.y0)*v.h+2)+'px'; layer.appendChild(d); }));
    v.stage.insertBefore(layer,v.svg); });
}
function showFindResult(){
  const r=findState.results[findState.cur]; if(!r){ updateFindCount(); return; }
  const v=pageViews[r.page-1]; if(!v) return;
  if(currentPage!==r.page){ currentPage=r.page; updatePageIndicator(); updateActiveThumb(); }
  const b=r.rects[0]; main.scrollTop=Math.max(0,pageTopInMain(v)+b.y0*v.h-main.clientHeight/3);
  const left=v.stage.offsetLeft+b.x0*v.w; if(left<main.scrollLeft||left>main.scrollLeft+main.clientWidth-60) main.scrollLeft=Math.max(0,left-main.clientWidth/3);
  drawFindHighlights(); updateFindCount();
}
function findStep(dir){ const n=findState.results.length; if(!n){ if(findIn.value.trim()&&findIn.value!==findState.q) runFind(); return; } findState.cur=((findState.cur+dir)%n+n)%n; showFindResult(); }
function openFind(){ if(!pdfDoc) return; findBar.hidden=false; findIn.focus(); findIn.select(); if(findIn.value.trim()&&!findState.results.length) runFind(); }
function closeFind(){ findBar.hidden=true; findState.token++; findState.q=''; findState.results=[]; findState.cur=-1; drawFindHighlights(); findCount.textContent=''; }
let findTimer=null;
findIn.addEventListener('input',()=>{ clearTimeout(findTimer); findTimer=setTimeout(()=>runFind(),250); });
findIn.addEventListener('keydown',e=>{ e.stopPropagation();
  if(e.key==='Enter'){ e.preventDefault(); if(findIn.value!==findState.q){ clearTimeout(findTimer); runFind(); } else findStep(e.shiftKey?-1:1); }
  else if(e.key==='Escape'){ e.preventDefault(); closeFind(); }
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){ e.preventDefault(); findIn.select(); } });
$('find-case').addEventListener('change',()=>{ if(findIn.value.trim()) runFind(); });
$('find-next').onclick=()=>findStep(1); $('find-prev').onclick=()=>findStep(-1); $('find-close').onclick=closeFind;
{ const ra=renderAll; renderAll=function(){ ra.apply(this,arguments); if(findState.results.length) drawFindHighlights(); }; } // page views are rebuilt on zoom
