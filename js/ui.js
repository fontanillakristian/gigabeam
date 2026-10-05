/* ui.js - Small UI helpers: toast, tool buttons, loading progress, fast pdf-lib parsing, and the background import of this editor's own saved data. */
function toast(m){ $('toast-msg').textContent=m; $('toast').classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>$('toast').classList.remove('show'),2600); }
// The Properties panel opens itself at most ONCE (the first markup), and never again once the person has opened or closed it themselves:
// after that it stays however they left it. byUser: the person asked for it. (On a phone it covers half the page, so it never opens by itself.)
let propsAutoShown=false, propsUserChoice=false;
function openProps(byUser){
  if(isPhone()&&!byUser) return;
  if(!byUser){ if(propsAutoShown||propsUserChoice) return; propsAutoShown=true; }
  propsPanel.classList.remove('hidden'); propsBtn.classList.add('on'); if(isNarrow()) hideLeft(); }
function syncSwatch(){ if(typeof syncPropbar==='function') syncPropbar(); } // (the color shown in the options bar; see propbar.js)
$('empty-open').onclick=()=>platform.open();

// ---- tool buttons (the engine's old buildToolbar() used to attach these)
document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));

// ---- loading helpers: fast pdf-lib parse, progress UI, background import of this editor's own saved data
// Yield one frame so progress can paint before heavy work. Background tabs pause requestAnimationFrame, so a timer backs it up.
const tick=()=>new Promise(r=>{ let done=false; const fin=()=>{ if(!done){ done=true; r(); } }; requestAnimationFrame(()=>setTimeout(fin,0)); setTimeout(fin,80); });
function showLoad(title,msg,pct){ const c=$('load-card'); c.style.display='flex'; $('lc-title').textContent=title; $('lc-msg').textContent=msg; $('lc-fill').style.width=Math.max(3,Math.min(100,pct))+'%'; }
function hideLoad(){ $('load-card').style.display='none'; }
function bgTask(msg,pct,onCancel){ const b=$('bg-task'), cb=$('bg-cancel'); if(msg==null){ b.style.display='none'; cb.hidden=true; cb.onclick=null; return; } b.style.display='flex'; $('bg-msg').textContent=msg; const f=$('bg-fill'); f.parentElement.classList.toggle('ind',pct==null); f.style.width=pct==null?'':Math.min(100,pct)+'%'; cb.hidden=!onCancel; cb.onclick=onCancel||null; } // onCancel: show a Cancel button
// pdf-lib yields to the browser every 100 objects by default, which is ~8x slower on big files; Fastest parses in one go.
const SAVE_OPTS={objectsPerTick:Infinity}; // pdf-lib saves in one go instead of yielding every 50 objects
function loadPdf(bytes,opts){ return PDFLib.PDFDocument.load(bytes,Object.assign({parseSpeed:PDFLib.ParseSpeeds.Fastest},opts)); }
function pdfDocFrom(x){ return (x&&x.getPages)?Promise.resolve(x):loadPdf(x,{ignoreEncryption:true,updateMetadata:false}); }
function rawHas(bytes,...needles){ const u=bytes instanceof ArrayBuffer?new Uint8Array(bytes):bytes, s=new TextDecoder('latin1').decode(u); return needles.some(n=>s.includes(n)); }
async function readFileWithProgress(file,onp){
  if(!file.stream||file.size<4*1048576){ if(onp) onp(1); return file.arrayBuffer(); }
  const out=new Uint8Array(file.size), rd=file.stream().getReader(); let got=0;
  for(;;){ const {done,value}=await rd.read(); if(done) break; out.set(value,got); got+=value.length; if(onp) onp(got/file.size); }
  return out.buffer;
}
// Only files this editor saved can contain its markups / layout / flatten data, so anything else skips the deep parse.
async function needsDeepRead(buf,doc){
  if(rawHas(buf,'/CEK','/CELayout','/CEFL','/CEWM')) return true;
  try{ const m=await doc.getMetadata(), i=m.info||{}; return /pdf-lib|Gigabeam|PDF Viewer & Editor/i.test((i.Producer||'')+' '+(i.Creator||'')); }catch(e){ return false; }
}
async function deepImport(tab){
  bgTask('Reading saved markups…',null); await tick();
  try{
    const copy=tab.originalBytes instanceof Uint8Array?tab.originalBytes.slice():new Uint8Array(tab.originalBytes.slice(0));
    const r=await heavy('inspect',{bytes:copy},{stateless:true}); // parsing a big file takes a couple of seconds, so it runs in the background worker
    const lay=r.layout, flat=new Set(r.flat), ann=r.annotations;
    const active=docs[activeDoc]===tab, A=active?annotations:tab.annotations, L=active?layout:tab.layout;
    Object.keys(lay).forEach(k=>{ if(!L[k]) L[k]=lay[k]; }); // never overwrite anything the user has already done meanwhile
    Object.keys(ann).forEach(n=>{ const cur=A[n]; if(!cur||Object.values(cur).every(a=>!a.length)) A[n]=ann[n]; });
    tab.flatPages=flat; if(active) flatPages=flat;
    if(r.stripped){ // the worker lifted out what the app draws itself (its own markups, a saved watermark), so pdf.js shows only the rest
      const nb=r.stripped;
      if(active){ await reloadWorkingDoc(nb,flat); historyStack=[]; redoStack=[]; updateHistBtns(); await renderPage(); await renderPagePanel(); } // (earlier undo points hold the un-stripped file)
      else { tab.originalBytes=nb; tab.pdfDoc=await pdfjsLib.getDocument({data:nb.slice()}).promise; }
    }
    if(active){ renderAll(); renderProps(); renderBookmarks(); syncThumbMarks(); }
  }catch(err){ toast('Could not read this file’s saved markups'); }
  bgTask(null);
}
