/* ocr.js - Text recognition (OCR) for scanned pages, using Tesseract.js (bundled in vendor/tesseract; it runs offline in its own worker).
   Recognised words are kept per page as boxes in fractions of the visible page (ocrPages). They feed the text layer and Find (text.js)
   and, on save, are written into the PDF as invisible text in a content stream tagged /CEOCR, so the file is searchable in any viewer.
   The export part (exportOcrText) also runs inside the background save worker, so this file must load without a real DOM. */
let ocrPages={}; // page number -> {words:[{t, x0,y0,x1,y1, ln, rot}]}  (fractions; ln = line number; rot = reading direction in degrees, 0/90/180/270)
const OCR_BASE='vendor/tesseract/';
const OCR_MIN_CONF=40; // words Tesseract is less sure of than this are mostly specks and line-work read as letters
let ocrJob=null;

// ---- keeping the boxes in step with page operations
function remapOcrPages(fn){ const o={}; Object.keys(ocrPages).forEach(k=>{ const n=fn(+k); if(n!=null) o[n]=ocrPages[k]; }); ocrPages=o; }
// rotate / crop: re-express a page's word boxes against the new view of the page (mapPt maps one fraction point; dRot = added rotation)
function remapOcrPage(n,mapPt,dRot){
  const p=ocrPages[n]; if(!p) return;
  const words=p.words.map(w=>{ const cs=[mapPt(w.x0,w.y0),mapPt(w.x1,w.y0),mapPt(w.x1,w.y1),mapPt(w.x0,w.y1)], xs=cs.map(c=>c.x), ys=cs.map(c=>c.y);
    return Object.assign({},w,{x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys),rot:(((w.rot||0)+dRot)%360+360)%360}); });
  ocrPages=Object.assign({},ocrPages,{[n]:{words:words.filter(w=>w.x1>0&&w.y1>0&&w.x0<1&&w.y0<1)}}); // new objects, never changed in place (undo keeps the old ones)
}
// A word's reading frame in page pixels (W x H): origin = the top-left corner of the text as read, u = reading direction, v = "down" for the text,
// L = length along u, T = text height.
function ocrWordFrame(w,W,H){
  const x0=w.x0*W, x1=w.x1*W, y0=w.y0*H, y1=w.y1*H;
  switch(w.rot||0){
    case 90:  return {ox:x1,oy:y0,ux:0,uy:1,vx:-1,vy:0,L:y1-y0,T:x1-x0};
    case 180: return {ox:x1,oy:y1,ux:-1,uy:0,vx:0,vy:-1,L:x1-x0,T:y1-y0};
    case 270: return {ox:x0,oy:y1,ux:0,uy:-1,vx:1,vy:0,L:y1-y0,T:x1-x0};
    default:  return {ox:x0,oy:y0,ux:1,uy:0,vx:0,vy:1,L:x1-x0,T:y1-y0};
  }
}

// ---- save: invisible, searchable text
function exportOcrText({pdf,pages,font,ctxP}){
  const pageNums=Object.keys(ocrPages).map(Number).filter(n=>pages[n-1]&&ocrPages[n].words.length); if(!pageNums.length) return;
  const enc=t=>Array.from(t).filter(ch=>{ try{ font.encodeText(ch); return true; }catch(e){ return false; } }).join(''), r=v=>+v.toFixed(3);
  pageNums.forEach(n=>{
    const page=pages[n-1], g=pageGeom(page), W=g.W, H=g.H;
    const keep=pageContentRefs(page,ctxP).filter(ref=>!streamHasTag(ctxP,ref,'CEOCR')); // a re-recognised page replaces its earlier text
    const fKey=page.node.newFontDictionary('CEOCRF',font.ref).toString();
    let ops='q\nBT\n3 Tr\n'+fKey+' 1 Tf\n';
    ocrPages[n].words.forEach(w=>{
      const t=enc(w.t); if(!t) return;
      const f=ocrWordFrame(w,W,H), fs=f.T*0.82, bx=f.ox+f.vx*f.T*0.8, by=f.oy+f.vy*f.T*0.8; // baseline, about 80% down the box
      const U=(x,y)=>g.toUser(x,H-y), b0=U(bx,by), b1=U(bx+f.ux,by+f.uy), up=U(bx-f.vx,by-f.vy);
      const ux=b1.x-b0.x, uy=b1.y-b0.y, vx=up.x-b0.x, vy=up.y-b0.y, natural=font.widthOfTextAtSize(t,1)*fs;
      if(!(natural>0)||!(fs>0)) return;
      ops+=`${r(Math.min(400,100*f.L/natural))} Tz\n${r(ux*fs)} ${r(uy*fs)} ${r(vx*fs)} ${r(vy*fs)} ${r(b0.x)} ${r(b0.y)} Tm\n${font.encodeText(t).toString()} Tj\n`;
    });
    ops+='ET\nQ\n';
    keep.push(ctxP.register(ctxP.stream(ops,{CEOCR:true})));
    setPageContents(page,ctxP,keep);
  });
}

// ---- recognising pages (main thread only)
let tesseractLoading=null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  if(!tesseractLoading) tesseractLoading=new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=OCR_BASE+'tesseract.min.js'; s.onload=res; s.onerror=()=>{ tesseractLoading=null; rej(new Error('could not load the OCR engine')); }; document.head.appendChild(s); });
  return tesseractLoading;
}
async function pageHasText(n){ const tc=await pageTextContent(n); return !!(tc&&tc.items.some(it=>it.str&&it.str.trim())); }
// Recognise the given pages, in order, in the background. opts.skipText: leave pages that already contain text alone.
async function runOcr(pages,opts){
  if(ocrJob){ toast('Text recognition is already running'); return; }
  const skipText=!(opts&&opts.skipText===false), job={cancelled:false}, doc=pdfDoc, store=ocrPages;
  let stop; const stopped=new Promise(res=>{ stop=res; }); // settles when Cancel is pressed, so a page in progress doesn't hold things up
  const cancel=()=>{ job.cancelled=true; stop(null); };
  ocrJob=job; let worker=null, done=0, recognised=0, skipped=0, words=0;
  bgTask('Starting text recognition…',0,cancel);
  try{
    await loadTesseract();
    const base=new URL(OCR_BASE,location.href).href;
    worker=await Tesseract.createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base+'lang',gzip:true,workerBlobURL:false,cacheMethod:'none'});
    for(const n of pages){
      if(job.cancelled||pdfDoc!==doc) break; // stopped, or the document changed underneath (tab switch / page operation)
      bgTask(`Recognizing text: page ${n} (${done+1} of ${pages.length})`,done/pages.length*100,cancel);
      if(skipText&&!store[n]&&await pageHasText(n)){ skipped++; done++; continue; }
      const page=await doc.getPage(n), v1=page.getViewport({scale:1}), s=Math.max(1,Math.min(4.2,(opts&&opts.px||3500)/Math.max(v1.width,v1.height))), vp=page.getViewport({scale:s});
      const c=document.createElement('canvas'); c.width=Math.floor(vp.width); c.height=Math.floor(vp.height);
      const cx=c.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,c.width,c.height);
      await Promise.race([page.render({canvasContext:cx,viewport:vp,annotationMode:pdfjsLib.AnnotationMode.ENABLE}).promise,stopped]);
      if(job.cancelled) break;
      const res=await Promise.race([worker.recognize(c),stopped]), cw=c.width, ch=c.height; c.width=0; c.height=0; // (free the big bitmap straight away)
      if(!res||job.cancelled||pdfDoc!==doc) break;
      const out=[], lines=(res.data.lines&&res.data.lines.length)?res.data.lines:[{words:res.data.words||[]}];
      lines.forEach((ln,li)=>(ln.words||[]).forEach(w=>{ const t=(w.text||'').trim(); if(!t||w.confidence<OCR_MIN_CONF||!/[A-Za-z0-9]/.test(t)) return;
        out.push({t,x0:w.bbox.x0/cw,y0:w.bbox.y0/ch,x1:w.bbox.x1/cw,y1:w.bbox.y1/ch,ln:li,rot:0}); }));
      store[n]={words:out}; words+=out.length; recognised++; done++;
      markDirty(); onTextChanged(n);
    }
    const msg=job.cancelled?`Text recognition stopped after ${recognised} page${recognised===1?'':'s'}`:`Recognized ${words.toLocaleString()} words on ${recognised} page${recognised===1?'':'s'}`+(skipped?` (${skipped} already had text)`:'');
    toast(msg+(recognised?'. Save to make the PDF searchable.':''));
  }catch(err){ await modalAlert('Text recognition failed: '+esc(err.message||String(err))); }
  finally{ if(worker){ try{ worker.terminate().catch(()=>{}); }catch(e){} } if(ocrJob===job) ocrJob=null; bgTask(null); } // (not awaited: a worker stopped mid-page may never answer)
}
// The "Recognize text" dialog: which pages, and whether to skip pages that already have text
async function ocrDialog(){
  if(!pdfDoc) return;
  const r=await dialog({title:'Recognize text (OCR)',ok:'Recognize',
    body:`<div class="sub" style="margin-bottom:10px">Reads the text of scanned pages so you can select, copy and find it. Saving then makes the PDF searchable in any viewer. Runs on this computer; nothing is uploaded. About 3–5 seconds per text page; dense drawing sheets take 20–60 seconds each.</div>
      <label class="chk"><input type="radio" name="ocr-pg" value="cur" checked> Current page (${currentPage})</label>
      <label class="chk"><input type="radio" name="ocr-pg" value="all"> All pages (${numPages})</label>
      <label class="chk"><input type="radio" name="ocr-pg" value="range"> Pages <input id="ocr-range" class="ctl" style="width:120px;margin-left:6px" placeholder="e.g. 1-3, 7"></label>
      <label style="display:block;margin-top:10px">Quality <select id="ocr-q" class="ctl" style="margin-left:6px"><option value="2500">Fast</option><option value="3500" selected>Standard</option><option value="4500">Detailed (small text on large sheets)</option></select></label>
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="ocr-skip" checked> Skip pages that already contain text</label>
      <div class="sub" style="padding-left:24px">English. Handwriting isn't recognized.</div>`,
    onReady:ov=>{ const rg=ov.querySelector('#ocr-range'), pick=()=>{ ov.querySelector('input[value="range"]').checked=true; }; rg.addEventListener('focus',pick); rg.addEventListener('input',pick); },
    collect:(ov,setErr)=>{
      const mode=ov.querySelector('input[name="ocr-pg"]:checked').value; let pages=[];
      if(mode==='cur') pages=[currentPage]; else if(mode==='all') for(let i=1;i<=numPages;i++) pages.push(i);
      else { pages=parsePageList(ov.querySelector('#ocr-range').value,numPages); if(!pages.length){ setErr('Enter pages like 1-3, 7'); return undefined; } }
      return {pages,skipText:ov.querySelector('#ocr-skip').checked,px:+ov.querySelector('#ocr-q').value}; }});
  if(r) runOcr(r.pages,{skipText:r.skipText,px:r.px});
}
function parsePageList(s,max){ const set=new Set(); String(s||'').split(/[,;\s]+/).forEach(part=>{ const m=part.match(/^(\d+)(?:-(\d+))?$/); if(!m) return; let a=+m[1], b=m[2]?+m[2]:a; if(a>b) [a,b]=[b,a]; for(let i=Math.max(1,a);i<=Math.min(max,b);i++) set.add(i); }); return Array.from(set).sort((p,q)=>p-q); }
$('ocr-btn').onclick=ocrDialog;
