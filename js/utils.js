/* utils.js - Page geometry (rotation / crop), image store, revision-cloud outline, history (undo / redo) and simple modal prompts. */
// ---------- page geometry ----------
// What you SEE in the editor (pdf.js) is the page after /Rotate and clipped to the CropBox.
// Markups are stored as fractions of that visible page, so anything written back into the PDF
// has to go through this same mapping. Display coordinates here are in points, y-UP, with the
// origin at the bottom-left of the visible page; toUser() converts them to real page space.
function pageGeom(page){
  const rot=((page.getRotation().angle%360)+360)%360;
  const mb=page.getMediaBox();
  let cb=page.getCropBox();
  const x1=Math.max(cb.x,mb.x), y1=Math.max(cb.y,mb.y), x2=Math.min(cb.x+cb.width,mb.x+mb.width), y2=Math.min(cb.y+cb.height,mb.y+mb.height);
  if(x2>x1&&y2>y1) cb={x:x1,y:y1,width:x2-x1,height:y2-y1}; else cb={x:mb.x,y:mb.y,width:mb.width,height:mb.height};
  const swap=rot===90||rot===270;
  const W=swap?cb.height:cb.width, H=swap?cb.width:cb.height;
  const toUser=(x,y)=>{
    if(rot===90)  return {x:cb.x+(H-y), y:cb.y+x};
    if(rot===180) return {x:cb.x+(W-x), y:cb.y+(H-y)};
    if(rot===270) return {x:cb.x+y,     y:cb.y+(W-x)};
    return {x:cb.x+x, y:cb.y+y};
  };
  const fromUser=(ux,uy)=>{
    const dx=ux-cb.x, dy=uy-cb.y;
    if(rot===90)  return {x:dy,     y:H-dx};
    if(rot===180) return {x:W-dx,   y:H-dy};
    if(rot===270) return {x:W-dy,   y:dx};
    return {x:dx,y:dy};
  };
  // linear part of display->user, used as an appearance-stream /Matrix so drawn content stays upright on rotated pages
  const M=rot===90?[0,1,-1,0,0,0]:rot===180?[-1,0,0,-1,0,0]:rot===270?[0,-1,1,0,0,0]:[1,0,0,1,0,0];
  return {rot,cb,W,H,toUser,fromUser,M};
}
// When a page's rotation or crop changes, every markup on it is re-expressed against the new view
// (points follow the page; text boxes and images keep their physical size and stay upright).
function remapPageAnnotations(n,oldG,newG){
  const Wo=oldG.W,Ho=oldG.H,Wn=newG.W,Hn=newG.H;
  const mapPt=(x,y)=>{ const u=oldG.toUser(x*Wo,(1-y)*Ho); const nd=newG.fromUser(u.x,u.y); return {x:nd.x/Wn,y:1-nd.y/Hn}; };
  if(typeof remapOcrPage==='function') remapOcrPage(n,mapPt,newG.rot-oldG.rot); // recognised text moves with the page
  const d=annotations[n]; if(!d) return;
  const mapBox=(cx,cy,wpt,hpt)=>{ const c=mapPt(cx,cy), bw=wpt/Wn, bh=hpt/Hn; return {fx:c.x-bw/2,fy:c.y-bh/2,bw,bh}; };
  (d.shapes||[]).forEach(s=>{ const a=mapPt(s.x1,s.y1), b=mapPt(s.x2,s.y2); s.x1=a.x;s.y1=a.y;s.x2=b.x;s.y2=b.y; });
  (d.paths||[]).concat(d.measurements||[]).forEach(o=>{ o.points=o.points.map(p=>mapPt(p.x,p.y)); });
  (d.texts||[]).forEach(t=>{
    if(t.boxW){ const r=mapBox(t.fx+t.boxW/2,t.fy+t.boxH/2,t.boxW*Wo,t.boxH*Ho); t.fx=r.fx;t.fy=r.fy;t.boxW=r.bw;t.boxH=r.bh; }
    else { const c=mapPt(t.fx,t.fy); t.fx=c.x; t.fy=c.y; }
    if(t.leader){ const c=mapPt(t.leader.x,t.leader.y); t.leader.x=c.x; t.leader.y=c.y; }
    if(t.legLength!=null) t.legLength=t.legLength*Wo/Wn;
  });
  (d.images||[]).concat(d.fields||[]).forEach(im=>{
    const w=Math.abs(im.x2-im.x1)*Wo, h=Math.abs(im.y2-im.y1)*Ho;
    const r=mapBox((im.x1+im.x2)/2,(im.y1+im.y2)/2,w,h); im.x1=r.fx;im.y1=r.fy;im.x2=r.fx+r.bw;im.y2=r.fy+r.bh;
  });
}

// ---------- inserted images & signatures ----------
// Image bytes live here (not inside the annotation objects) so undo snapshots stay tiny.
const imageStore={}; let imgCounter=0;
function registerImage(dataUrl,mime,nw,nh){ const id='img'+(++imgCounter)+'_'+Math.random().toString(36).slice(2,8); imageStore[id]={dataUrl,mime,nw,nh}; return id; }
function dataUrlToBytes(u){ const b=atob(u.slice(u.indexOf(',')+1)); const a=new Uint8Array(b.length); for(let i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return a; }
function bytesToDataUrl(bytes,mime){ let s=''; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return 'data:'+mime+';base64,'+btoa(s); }
// Pulls the original image bytes back out of a previously saved stamp (its private /CEI stream).
function readImageRecord(doc,dict,data){
  try{
    const {PDFName,decodePDFRawStream}=PDFLib;
    const st=doc.context.lookup(dict.get(PDFName.of('CEI'))); if(!st) return null;
    const mime=data.mime||'image/png';
    return registerImage(bytesToDataUrl(decodePDFRawStream(st).decode(),mime),mime,data.nw||0,data.nh||0);
  }catch(e){ return null; }
}
// Effective text alignment: "auto" on a callout means flush toward whichever side the leader leg is on.
function effAlign(a,W,H){
  if(a.align==='auto'){ if(a.leader&&a.boxW) return calloutGeom(a,W,H).side==='left'?'left':'right'; return 'left'; }
  return a.align||'left';
}

// ---------- revision-cloud outline ----------
// Turns a plain corner-point polygon into a scalloped "cloud" outline, as one shared routine so
// the on-screen preview and the exported PDF trace the identical bumps. fracPts are the corners
// in fraction-of-page coordinates (what's actually stored/moved); W,H are the CURRENT page size in
// whatever unit the caller wants the result in (editor CSS px, or export PDF points) — bump size is
// expressed as a fraction of the page width so the cloud looks the same proportionally either way.
// flipY switches between the editor's top-down y and the export's bottom-up (PDF) y.
function puffOutline(fracPts,W,H,bumpFrac,flipY){
  bumpFrac=bumpFrac>0?bumpFrac:0.012;
  const P=fracPts.map(p=>flipY?{x:p.x*W,y:H-p.y*H}:{x:p.x*W,y:p.y*H});
  const bump=Math.max(2,bumpFrac*W);
  let cx=0,cy=0; P.forEach(p=>{cx+=p.x;cy+=p.y;}); cx/=P.length; cy/=P.length;
  const out=[];
  for(let i=0;i<P.length;i++){
    const a=P[i], b=P[(i+1)%P.length];
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1e-9;
    const ux=dx/len, uy=dy/len;
    let nx=-uy, ny=ux; // perpendicular to the edge
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
    if(Math.hypot(mx+nx-cx,my+ny-cy)<Math.hypot(mx-cx,my-cy)){ nx=-nx; ny=-ny; } // flip so it always bulges away from the centroid
    const nSeg=Math.max(1,Math.round(len/bump)), step=len/nSeg, SAMPLES=6;
    for(let k=0;k<nSeg;k++) for(let s=0;s<SAMPLES;s++){
      const t=k+s/SAMPLES, px=a.x+ux*step*t, py=a.y+uy*step*t;
      const bulge=Math.sin(Math.PI*(s/SAMPLES))*(step/2);
      out.push({x:px+nx*bulge,y:py+ny*bulge});
    }
  }
  return out;
}

function pd(p){ if(!annotations[p]) annotations[p]={texts:[],shapes:[],paths:[],measurements:[],images:[],fields:[]}; if(!annotations[p].images) annotations[p].images=[]; if(!annotations[p].fields) annotations[p].fields=[]; return annotations[p]; }
function pdr(p){ return annotations[p]||EMPTY_PAGE; } // read-only access (doesn't create empty page entries)
function V(){ return pageViews[drawPage-1]; }
function selObj(){ if(!selected) return null; const arr=pdr(selected.page)[selected.arrName]; return (arr&&arr[selected.idx])||null; }
function isSel(page,arrName,idx){ return !!selected&&selected.page===page&&selected.arrName===arrName&&selected.idx===idx; }
function svgEl(tag,attrs){ const el=document.createElementNS(SVGNS,tag); for(const k in attrs) el.setAttribute(k,attrs[k]); return el; }
function frac(e){ const v=V(); const r=v.stage.getBoundingClientRect(); // clamped to the page, so a drag can't spill onto the next page
  return {x:Math.min(1,Math.max(0,(e.clientX-r.left)/v.w)), y:Math.min(1,Math.max(0,(e.clientY-r.top)/v.h))}; }
function distPts(a,b){ const v=V(); return Math.hypot((b.x-a.x)*v.ptsW,(b.y-a.y)*v.ptsH); }
function areaPts(pts){ const v=V(); let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i],b=pts[(i+1)%pts.length]; s += (a.x*v.ptsW)*(b.y*v.ptsH) - (b.x*v.ptsW)*(a.y*v.ptsH); } return Math.abs(s)/2; }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function swallowNextClick(){ suppressClickUntil=Date.now()+120; } // a drag's mouseup is followed by a stray click; ignore it
// ---- undo / redo
// Each history entry is a snapshot of everything undoable: markups and form fields, page numbers / header & footer /
// watermark, and bookmarks. Page operations (delete, insert, reorder, rotate, crop, flatten, unflatten) also keep the file
// bytes from before the operation so they can be undone too; only the newest few keep their bytes, to bound memory.
const MAX_HISTORY=60, MAX_BYTE_SNAPSHOTS=5;
let historyBusy=false;
function snapshot(withBytes){ return {ann:clone(annotations),layout:clone(layout),bm:clone(bookmarks),page:currentPage,bytes:withBytes?originalBytes:null,ocr:withBytes?Object.assign({},ocrPages):null}; } // (page operations renumber / move the OCR text too; its word lists are never changed in place)
// ---- unsaved changes: a tab is "dirty" from its first edit until it is saved
function markDirty(){ const t=docs[activeDoc]; if(t&&!t.dirty){ t.dirty=true; renderTabBar(); } }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function pushHistory(withBytes){
  markDirty();
  historyStack.push(snapshot(withBytes));
  if(historyStack.length>MAX_HISTORY) historyStack.shift();
  let kept=0; for(let i=historyStack.length-1;i>=0;i--){ const s=historyStack[i]; if(s.bytes&&++kept>MAX_BYTE_SNAPSHOTS){ s.bytes=null; s.lost=true; } }
  redoStack=[]; updateHistBtns();
}
function updateHistBtns(){ undoBtn.disabled=!historyStack.length||historyBusy; redoBtn.disabled=!redoStack.length||historyBusy; }
async function stepHistory(from,to){ // pop one entry off `from`, put the current state on `to`, and restore the entry
  if(!from.length||historyBusy) return;
  historyBusy=true; updateHistBtns();
  try{
    const s=from.pop();
    if(s.lost){ from.length=0; toast('That page operation is too old to undo'); return; }
    to.push(snapshot(!!s.bytes)); markDirty();
    annotations=s.ann; layout=s.layout; bookmarks=s.bm; selected=null;
    if(s.ocr) ocrPages=s.ocr;
    if(s.bytes&&s.bytes!==originalBytes){ // a page operation: bring the file back too
      bgTask('Restoring…',null); await tick();
      try{ await reloadWorkingDoc(s.bytes); currentPage=Math.min(s.page,numPages); await renderPage(); await renderPagePanel(); } finally{ bgTask(null); }
    }
    renderAll(); renderProps(); renderBookmarks(); syncThumbMarks();
  } finally{ historyBusy=false; updateHistBtns(); }
}
function doUndo(){ return stepHistory(historyStack,redoStack); }
function doRedo(){ return stepHistory(redoStack,historyStack); }

function modalPrompt(msg,defVal){
  return new Promise(res=>{
    const ov=document.createElement('div'); ov.className='modal-ovl';
    ov.innerHTML=`<div class="modal-box"><div>${msg}</div><input id="mi" value="${defVal||''}">
      <div class="row"><button id="mc">Cancel</button><button id="mo" class="primary">OK</button></div></div>`;
    document.body.appendChild(ov);
    const inp=ov.querySelector('#mi'); inp.focus(); inp.select();
    const done=v=>{ov.remove(); res(v);};
    ov.querySelector('#mo').onclick=()=>done(inp.value);
    ov.querySelector('#mc').onclick=()=>done(null);
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter') done(inp.value); if(e.key==='Escape') done(null); });
  });
}
function modalAlert(msg){
  return new Promise(res=>{
    const ov=document.createElement('div'); ov.className='modal-ovl';
    ov.innerHTML=`<div class="modal-box" role="alertdialog" aria-modal="true"><div>${msg}</div><div class="row"><button id="mo2" class="primary">OK</button></div></div>`;
    document.body.appendChild(ov);
    const done=()=>{ document.removeEventListener('keydown',onKey,true); ov.remove(); res(); };
    const onKey=e=>{ if(e.key==='Escape'||e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); done(); } };
    document.addEventListener('keydown',onKey,true);
    ov.querySelector('#mo2').onclick=done; ov.querySelector('#mo2').focus();
  });
}
// A message with any number of buttons; resolves with the pressed button's id, or null on Esc.
// buttons: [{id, label, primary?, danger?}]
function modalChoice(msg,buttons){
  return new Promise(res=>{
    const ov=document.createElement('div'); ov.className='modal-ovl';
    ov.innerHTML=`<div class="modal-box" role="alertdialog" aria-modal="true"><div>${msg}</div><div class="row">${buttons.map(b=>`<button type="button" data-id="${b.id}" class="${b.primary?'primary':''}${b.danger?' danger':''}">${b.label}</button>`).join('')}</div></div>`;
    document.body.appendChild(ov);
    const done=v=>{ document.removeEventListener('keydown',onKey,true); ov.remove(); res(v); };
    const onKey=e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener('keydown',onKey,true);
    ov.querySelectorAll('button').forEach(b=>{ b.onclick=()=>done(b.dataset.id); });
    const p=ov.querySelector('button.primary'); if(p) p.focus();
  });
}
function modalConfirm(msg){
  return new Promise(res=>{
    const ov=document.createElement('div'); ov.className='modal-ovl';
    ov.innerHTML=`<div class="modal-box" role="alertdialog" aria-modal="true"><div>${msg}</div><div class="row"><button id="mcf-no">Cancel</button><button id="mcf-yes" class="primary">OK</button></div></div>`;
    document.body.appendChild(ov);
    const done=v=>{ document.removeEventListener('keydown',onKey,true); ov.remove(); res(v); };
    const onKey=e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); done(false); } };
    document.addEventListener('keydown',onKey,true);
    ov.querySelector('#mcf-yes').onclick=()=>done(true); ov.querySelector('#mcf-no').onclick=()=>done(false); ov.querySelector('#mcf-yes').focus();
  });
}

// ---- multi-selection (Markups list: Shift / Ctrl+click). `selected` stays the main item; the others ride along with it.
// The extras are tied to the exact `selected` object they were made with, so anything that assigns a new `selected` drops them automatically.
let multiSel={primary:null,items:[]};
function extras(){ return (selected&&multiSel.primary===selected)?multiSel.items:[]; }
function isMulti(page,arrName,idx){ return extras().some(x=>x.page===page&&x.arrName===arrName&&x.idx===idx); }
// the kind of markup a drawing tool makes, so that tool can also pick up markups of the same kind
function sameKindAsTool(arrName,o){
  if(arrName==='texts') return tool==='text'?!o.leader:tool==='callout'?!!o.leader:false;
  if(arrName==='shapes') return tool===o.type;
  if(arrName==='paths') return tool==='highlighter';
  if(arrName==='measurements') return tool==='measure-'+o.type;
  if(arrName==='fields') return tool===o.type;
  return false;
}

// ---- line types (AutoCAD style): a pattern of dashes / gaps scaled by the line width and a per-markup "linetype scale"
const LINETYPES=[['solid','Solid'],['dashed','Dashed (broken)'],['center','Center'],['divide','Two dots (dash-dot-dot)']];
const LT_PATTERNS={dashed:[3,1.5],center:[7.5,1.5,1.5,1.5],divide:[3,1.5,.4,1.5,.4,1.5]}; // in units of U (below)
// the dash pattern in points for a markup, or null for a solid line (area measurements default to dashed, as they always were)
function dashPattern(o){
  const t=o.dash||(o.type==='area'?'dashed':'solid'), P=LT_PATTERNS[t]; if(!P) return null;
  const U=Math.max(4,(o.w||1)*2)*(o.ltScale>0?o.ltScale:1);
  return P.map(v=>+(v*U).toFixed(2));
}
// on-screen version: the same pattern at the current zoom
function dashAttr(o){ const p=dashPattern(o); return p?p.map(v=>+(v*scale).toFixed(2)).join(','):null; }
function applyDash(el,o){ const d=dashAttr(o); if(d){ el.setAttribute('stroke-dasharray',d); el.setAttribute('stroke-linecap','butt'); } }

// ---- measurement labels: the measured value by default; the user can replace it with any text ({value} inserts the live reading)
function measuredValue(m){ const dp=m.decimals!=null?m.decimals:2; return Number(m.value).toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp})+' '+m.unit; }
function measureLabel(m){ return (m.label!=null&&m.label!=='')?String(m.label).replace(/\{value\}/g,measuredValue(m)):measuredValue(m); }

// ---- text box fonts: family + bold + italic. The saved PDF uses the matching standard font.
const TEXT_FACES={
  Helvetica:{label:'Helvetica (sans-serif)',css:'Helvetica, Arial, sans-serif',std:['Helvetica','HelveticaBold','HelveticaOblique','HelveticaBoldOblique']},
  Times:{label:'Times (serif)',css:'"Times New Roman", Times, serif',std:['TimesRoman','TimesRomanBold','TimesRomanItalic','TimesRomanBoldItalic']},
  Courier:{label:'Courier (monospace)',css:'"Courier New", Courier, monospace',std:['Courier','CourierBold','CourierOblique','CourierBoldOblique']}
};
const textFace=a=>TEXT_FACES[a.fontName]||TEXT_FACES.Helvetica;
const textStdName=a=>textFace(a).std[(a.bold?1:0)+(a.italic?2:0)];
const textCssFont=(a,px)=>`${a.italic?'italic ':''}${a.bold?'bold ':''}${px}px ${textFace(a).css}`;
