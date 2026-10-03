/* dialogs.js - Reusable dialog helper plus scale, area picking, rotate, crop, images, signatures and the flatten dialog. */
const scaleSelect=$('scale-select'), rotateBtn=$('rotate-btn'), cropBtn=$('crop-btn'), imageBtn=$('image-btn'), imageInput=$('image-input'),
      signBtn=$('sign-btn'), flattenBtn=$('flatten-btn'), pickBanner=$('pick-banner'), pickText=$('pick-text'), pickCancel=$('pick-cancel');

// A small reusable dialog. collect(ov,setErr) returns the result, or undefined to keep the dialog open. Esc cancels.
function dialog({title,body,ok='OK',cancel='Cancel',onReady,collect}){
  return new Promise(res=>{
    const ov=document.createElement('div'); ov.className='modal-ovl';
    ov.innerHTML=`<div class="modal-box wide" role="dialog" aria-modal="true" aria-label="${title}"><div class="dlg-h"><span>${title}</span><button class="dlg-x" type="button" aria-label="Close"><svg class="i sm"><use href="#i-x"/></svg></button></div><div class="dlg-body">${body}</div><div class="dlg-err"></div><div class="row"><button class="dlg-cancel">${cancel}</button><button class="dlg-ok primary">${ok}</button></div></div>`;
    document.body.appendChild(ov);
    const err=ov.querySelector('.dlg-err'), setErr=m=>{ err.textContent=m; };
    const onKey=e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); done(null); } };
    const done=v=>{ document.removeEventListener('keydown',onKey,true); ov.remove(); res(v); };
    document.addEventListener('keydown',onKey,true);
    ov.querySelector('.dlg-cancel').onclick=()=>done(null); ov.querySelector('.dlg-x').onclick=()=>done(null);
    ov.querySelector('.dlg-ok').onclick=()=>{ setErr(''); let v=true; if(collect){ try{ v=collect(ov,setErr); }catch(ex){ setErr(ex.message); return; } } if(v===undefined) return; done(v); };
    if(onReady) onReady(ov,setErr);
  });
}
function parsePageList(str,max){
  const out=new Set(); const parts=String(str).split(',').map(s=>s.trim()).filter(Boolean); if(!parts.length) return null;
  for(const p of parts){ const m=p.match(/^(\d+)(?:\s*-\s*(\d+))?$/); if(!m) return null; let a=+m[1], b=m[2]?+m[2]:a; if(a>b){ const t=a;a=b;b=t; } if(a<1||b>max) return null; for(let i=a;i<=b;i++) out.add(i); }
  return Array.from(out).sort((x,y)=>x-y);
}
function pageSelectHTML(nm,currentLabel){
  return `<h4>Pages</h4>
    <label class="opt"><input type="radio" name="${nm}" value="current" checked> ${currentLabel}</label>
    <label class="opt"><input type="radio" name="${nm}" value="all"> All pages (${numPages})</label>
    <label class="opt"><input type="radio" name="${nm}" value="range"> Page range <input type="text" id="${nm}-range" placeholder="e.g. 1, 3-5" style="flex:1;width:auto;min-width:0"></label>`;
}
// returns an array of page numbers, the string 'current', or null (after showing an error)
function readPageSelection(ov,nm,setErr){
  const v=ov.querySelector(`input[name="${nm}"]:checked`).value;
  if(v==='all') return Array.from({length:numPages},(_,i)=>i+1);
  if(v==='range'){ const l=parsePageList(ov.querySelector('#'+nm+'-range').value,numPages); if(!l){ setErr(`Enter page numbers from 1 to ${numPages}, like 1, 3-5`); return null; } return l; }
  return 'current';
}

// ---------- scale templates ----------
// "1" = N'" means 72 pt (one inch on a full-size sheet) equals N feet.
function updateScaleLabel(){
  scaleLabel.textContent=scaleInfo?(scaleInfo.template?`Scale: 1" = ${scaleInfo.template}'`:`Scale: 1 ${scaleInfo.unit} = ${scaleInfo.pointsPerUnit.toFixed(2)} pt`):'No scale set';
  scaleSelect.value=(scaleInfo&&scaleInfo.template)?String(scaleInfo.template):'';
}
function recomputeMeasurements(){
  let changed=false;
  Object.keys(annotations).forEach(k=>{
    const pv=pageViews[(+k)-1]; if(!pv) return;
    (annotations[k].measurements||[]).forEach(m=>{
      const pts=m.points; let raw;
      if(m.type==='length') raw=Math.hypot((pts[1].x-pts[0].x)*pv.ptsW,(pts[1].y-pts[0].y)*pv.ptsH);
      else { let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i],b=pts[(i+1)%pts.length]; s+=(a.x*pv.ptsW)*(b.y*pv.ptsH)-(b.x*pv.ptsW)*(a.y*pv.ptsH); } raw=Math.abs(s)/2; }
      if(m.type==='length'){ m.value=scaleInfo?raw/scaleInfo.pointsPerUnit:raw; m.unit=scaleInfo?scaleInfo.unit:'pt'; }
      else { m.value=scaleInfo?raw/(scaleInfo.pointsPerUnit**2):raw; m.unit=scaleInfo?scaleInfo.unit+'\u00b2':'pt\u00b2'; }
      changed=true;
    });
  });
  if(changed) renderAll();
}
function applyScale(ppu,unit,template){ scaleInfo={pointsPerUnit:ppu,unit,template:template||null}; updateScaleLabel(); recomputeMeasurements(); }
scaleSelect.onchange=()=>{ const n=parseFloat(scaleSelect.value); if(!n||!pdfDoc){ updateScaleLabel(); return; } applyScale(72/n,'ft',n); };

// ---------- picking a rectangle on a page (used by Crop and Print area) ----------
let pickState=null;
function endPickUI(){
  document.body.classList.remove('picking'); pickBanner.style.display='none';
  if(tool==='areapick'){ tool='select'; updateToolButtons(); }
  isDragging=false; if(pageViews.length) rebuildAllSvg();
}
function pickArea(msg){
  return new Promise(res=>{
    if(pickState) cancelPick();
    clearPending(true); selected=null; renderProps();
    tool='areapick'; pickState={resolve:res}; pickText.textContent=msg;
    pickBanner.style.display='flex'; document.body.classList.add('picking'); updateToolButtons(); rebuildAllSvg();
  });
}
function finishPick(r){ const st=pickState; if(!st) return; pickState=null; endPickUI(); st.resolve(r); }
function cancelPick(){ const st=pickState; if(!st) return; pickState=null; endPickUI(); st.resolve(null); }
pickCancel.onclick=cancelPick;

// ---------- rotate pages ----------
async function rotateDialog(){
  if(!pdfDoc) return;
  const res=await dialog({ title:'Rotate pages', ok:'Rotate',
    body:pageSelectHTML('rp',`Current page (${currentPage})`)+
      `<h4>Rotate</h4>
       <label class="opt"><input type="radio" name="rd" value="90" checked> 90° clockwise</label>
       <label class="opt"><input type="radio" name="rd" value="270"> 90° counterclockwise</label>
       <label class="opt"><input type="radio" name="rd" value="180"> 180°</label>`,
    collect:(ov,setErr)=>{ let pages=readPageSelection(ov,'rp',setErr); if(!pages) return undefined; if(pages==='current') pages=[currentPage];
      return {pages,deg:+ov.querySelector('input[name="rd"]:checked').value}; } });
  if(res) await rotatePages(res.pages,res.deg);
}
async function rotatePages(pages,deg){
  return withPageLock(async()=>{
    const r=await heavy('rotate',{pages,deg}); // rotates the pages and re-expresses every markup against the new view, in the background worker
    annotations=r.annotations; if(r.ocr) ocrPages=r.ocr;
    await reloadWorkingDoc(r.bytes,new Set(r.flat));
    await renderPage(); await renderPagePanel();
  });
}

// ---------- crop pages ----------
async function cropDialog(){
  if(!pdfDoc) return;
  const res=await dialog({ title:'Crop pages', ok:'Continue',
    body:`<h4>Action</h4>
      <label class="opt"><input type="radio" name="ca" value="draw" checked> Draw a crop area on a page</label>
      <label class="opt"><input type="radio" name="ca" value="reset"> Remove the crop (restore full page)</label>`+
      pageSelectHTML('cp',`Only the page I draw on / current page`)+
      `<div class="sub">The crop area you draw is applied to the chosen pages in the same page proportions. Markups move with the page.</div>`,
    collect:(ov,setErr)=>{ const pages=readPageSelection(ov,'cp',setErr); if(!pages) return undefined; return {action:ov.querySelector('input[name="ca"]:checked').value,pages}; } });
  if(!res) return;
  if(res.action==='reset'){ await cropPages(res.pages==='current'?[currentPage]:res.pages,null); return; }
  const area=await pickArea('Drag a rectangle around the part of the page to keep. Esc cancels.');
  if(!area) return;
  await cropPages(res.pages==='current'?[area.page]:res.pages,area);
}
async function cropPages(pages,f){
  return withPageLock(async()=>{
    const r=await heavy('crop',{pages,area:f}); // f = the rectangle to keep (fractions of the page), or null to remove the crop
    annotations=r.annotations; if(r.ocr) ocrPages=r.ocr;
    await reloadWorkingDoc(r.bytes,new Set(r.flat));
    await renderPage(); await renderPagePanel();
  });
}
rotateBtn.onclick=rotateDialog; cropBtn.onclick=cropDialog;

// ---------- images ----------
function buildImages(n){
  const v=pageViews[n-1]; if(!v) return;
  const list=pdr(n).images||[], W=v.w, H=v.h;
  let els=Array.from(v.stage.querySelectorAll('.pg-img'));
  const same=els.length===list.length&&els.every((el,i)=>el.dataset.id===list[i].imgId);
  if(!same){
    els.forEach(el=>el.remove());
    els=list.map(im=>{ const el=document.createElement('img'); el.className='pg-img'; el.dataset.id=im.imgId; el.draggable=false; el.alt='';
      const rec=imageStore[im.imgId]; if(rec) el.src=rec.dataUrl; v.stage.insertBefore(el,v.svg); return el; });
  }
  list.forEach((im,i)=>{
    const el=els[i], x=Math.min(im.x1,im.x2)*W, y=Math.min(im.y1,im.y2)*H, w=Math.abs(im.x2-im.x1)*W, h=Math.abs(im.y2-im.y1)*H;
    el.style.left=x+'px'; el.style.top=y+'px'; el.style.width=w+'px'; el.style.height=h+'px';
    el.style.mixBlendMode=im.blend==='multiply'?'multiply':'normal'; el.style.opacity=im.opacity!=null?im.opacity:1;
  });
}
function startImageResize(n,idx,e){
  drawPage=n; const im=pd(n).images[idx]; if(!im) return; const v=pageViews[n-1];
  const x0=Math.min(im.x1,im.x2), y0=Math.min(im.y1,im.y2); let hist=false;
  const aspect=(im.nw&&im.nh)?im.nw/im.nh:(Math.abs(im.x2-im.x1)*v.w)/(Math.abs(im.y2-im.y1)*v.h);
  const mv=ev=>{ if(!hist){ pushHistory(); hist=true; }
    const p=frac(ev); const nw=Math.max(0.02,p.x-x0); let nh=Math.max(0.02,p.y-y0);
    if(im.lockAspect!==false&&!ev.shiftKey) nh=(nw*v.w/aspect)/v.h;
    im.x1=x0; im.y1=y0; im.x2=x0+nw; im.y2=y0+nh; buildImages(n); buildSvg(n); };
  const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); };
  window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
}
// Drops a new image / signature near the middle of what's on screen on the current page.
function addImageObject(dataUrl,mime,nw,nh,kind,name,widthFrac){
  const n=currentPage, v=pageViews[n-1]; if(!v) return;
  let wf=widthFrac||0.25, hf=(wf*v.w*(nh/nw))/v.h;
  if(hf>0.6){ hf=0.6; wf=(hf*v.h*(nw/nh))/v.w; }
  const mr=main.getBoundingClientRect(), r=v.stage.getBoundingClientRect();
  let cx=((mr.left+mr.width/2)-r.left)/v.w, cy=((mr.top+mr.height/2)-r.top)/v.h;
  cx=Math.min(1-wf/2-0.01,Math.max(wf/2+0.01,isFinite(cx)?cx:0.5)); cy=Math.min(1-hf/2-0.01,Math.max(hf/2+0.01,isFinite(cy)?cy:0.5));
  if(tool!=='select') setTool('select');
  pushHistory();
  const im={kind,imgId:registerImage(dataUrl,mime,nw,nh),x1:cx-wf/2,y1:cy-hf/2,x2:cx+wf/2,y2:cy+hf/2,blend:'normal',opacity:1,lockAspect:true,mime,nw,nh,name:name||''};
  pd(n).images.push(im);
  selected={page:n,arrName:'images',idx:pd(n).images.length-1}; openProps(); renderAll(); renderProps();
}
function loadImageFile(file){
  return new Promise((res,rej)=>{
    const fr=new FileReader(); fr.onerror=()=>rej(new Error('Could not read that file'));
    fr.onload=()=>{ const img=new Image(); img.onerror=()=>rej(new Error('That file is not a readable image'));
      img.onload=()=>{
        const k=Math.min(1,3000/Math.max(img.naturalWidth,img.naturalHeight)), w=Math.round(img.naturalWidth*k), h=Math.round(img.naturalHeight*k);
        const c=document.createElement('canvas'); c.width=w; c.height=h; const cx=c.getContext('2d');
        const isJpg=/jpe?g/i.test(file.type)||/\.jpe?g$/i.test(file.name);
        if(isJpg){ cx.fillStyle='#fff'; cx.fillRect(0,0,w,h); }
        cx.drawImage(img,0,0,w,h);
        const mime=isJpg?'image/jpeg':'image/png';
        res({dataUrl:c.toDataURL(mime,0.92),mime,nw:w,nh:h}); };
      img.src=fr.result; };
    fr.readAsDataURL(file);
  });
}
imageBtn.onclick=()=>{ if(pdfDoc) imageInput.click(); };
imageInput.onchange=async e=>{
  const file=e.target.files[0]; imageInput.value=''; if(!file) return;
  try{ const r=await loadImageFile(file); addImageObject(r.dataUrl,r.mime,r.nw,r.nh,'image',file.name,0.25); }
  catch(err){ await modalAlert('Could not insert that image: '+err.message); }
};
function renderImageProps(obj,pg){
  const op=obj.opacity!=null?obj.opacity:1;
  propsBody.innerHTML=`<label>Blend mode<select id="p-blend" style="width:100%;margin-top:4px">
      <option value="normal"${obj.blend!=='multiply'?' selected':''}>Normal</option>
      <option value="multiply"${obj.blend==='multiply'?' selected':''}>Multiply</option></select></label>
    <label>Opacity<input type="range" id="p-iop" min="0.05" max="1" step="0.05" value="${op}"></label>
    <label style="display:flex;align-items:center;gap:6px;margin-top:12px;"><input type="checkbox" id="p-lock" ${obj.lockAspect!==false?'checked':''} style="width:auto;margin:0;"> Lock aspect ratio</label>
    <p class="hint" style="white-space:normal;margin-top:10px">Drag to move. Drag the corner square to resize (hold Shift to stretch freely). Multiply lets the plan linework show through the image, like a Photoshop multiply layer.</p>
    <button id="p-del" class="primary" style="margin-top:8px;width:100%">Delete</button>`;
  sectionProps([['Appearance',['p-blend','p-iop','p-lock']]]);
  const redraw=()=>{ buildImages(pg); buildSvg(pg); };
  const wire=(id,fn,evt)=>{ const el=$(id); let pushed=false; el.addEventListener('focus',()=>pushed=false);
    el.addEventListener(evt,()=>{ if(!pushed){ pushHistory(); pushed=true; } fn(el); redraw(); }); };
  wire('p-blend',el=>{ obj.blend=el.value; },'change');
  wire('p-iop',el=>{ obj.opacity=parseFloat(el.value); },'input');
  wire('p-lock',el=>{ obj.lockAspect=el.checked; },'change');
  $('p-del').onclick=()=>deleteSelected();
}

// ---------- signatures ----------
const SIG_FONTS=[{name:'Great Vibes',css:'"Great Vibes"'},{name:'Dancing Script',css:'"Dancing Script"'},{name:'Caveat',css:'"Caveat"'}];
const SIG_FALLBACK=', "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';
function trimCanvas(src,pad){
  const w=src.width,h=src.height, d=src.getContext('2d').getImageData(0,0,w,h).data; let x1=w,y1=h,x2=-1,y2=-1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(d[(y*w+x)*4+3]>8){ if(x<x1)x1=x; if(x>x2)x2=x; if(y<y1)y1=y; if(y>y2)y2=y; }
  if(x2<0) return null;
  const out=document.createElement('canvas'); out.width=x2-x1+1+pad*2; out.height=y2-y1+1+pad*2;
  out.getContext('2d').drawImage(src,x1,y1,x2-x1+1,y2-y1+1,pad,pad,x2-x1+1,y2-y1+1); return out;
}
function renderTypedSig(text,fontCss,color,px){
  const c=document.createElement('canvas'), font=`${px}px ${fontCss}${SIG_FALLBACK}`;
  const m=c.getContext('2d'); m.font=font; c.width=Math.ceil(m.measureText(text).width)+px; c.height=Math.ceil(px*1.8);
  const x=c.getContext('2d'); x.font=font; x.fillStyle=color; x.textBaseline='alphabetic'; x.fillText(text,px/2,px*1.15); return c;
}
async function signatureDialog(){
  if(!pdfDoc) return;
  const fontsReady=(document.fonts&&document.fonts.load)?Promise.all(SIG_FONTS.map(f=>document.fonts.load(`48px ${f.css}`).catch(()=>{}))):Promise.resolve();
  const res=await dialog({ title:'Add signature', ok:'Insert',
    body:`<div class="sg-tabs"><button type="button" data-tab="draw" class="on">Draw</button><button type="button" data-tab="type">Type</button></div>
      <label class="opt" style="margin-top:0">Ink <select id="sg-color" style="width:auto"><option value="#111111">Black</option><option value="#0b3fa8">Blue</option></select></label>
      <div id="sg-draw"><canvas id="sg-canvas" width="480" height="170" style="width:100%;margin-top:8px;border:1px dashed var(--border);border-radius:6px;background:#fff;touch-action:none;cursor:crosshair"></canvas>
        <div class="sub">Sign inside the box with your mouse, finger or pen. <button type="button" id="sg-clear" style="padding:2px 8px">Clear</button></div></div>
      <div id="sg-type" style="display:none">
        <label>Full name<input id="sg-name" placeholder="Your name"></label>
        <label>Initials<input id="sg-init" placeholder="Initials" maxlength="6"></label>
        <h4>Insert</h4>
        <label class="opt"><input type="radio" name="sg-what" value="sig" checked> Signature (full name)</label>
        <label class="opt"><input type="radio" name="sg-what" value="ini"> Initials</label>
        <h4>Style</h4><div id="sg-styles"></div></div>`,
    onReady:ov=>{
      const q=s=>ov.querySelector(s); let mode='draw', drawn=false, styleIdx=0;
      const ink=()=>q('#sg-color').value;
      const cv=q('#sg-canvas'), cx=cv.getContext('2d'); cx.lineWidth=3.2; cx.lineCap='round'; cx.lineJoin='round';
      let drawing=false,last=null;
      const pos=e=>{ const r=cv.getBoundingClientRect(); return {x:(e.clientX-r.left)*cv.width/(r.width||cv.width),y:(e.clientY-r.top)*cv.height/(r.height||cv.height)}; };
      cv.addEventListener('pointerdown',e=>{ drawing=true; last=pos(e); cx.strokeStyle=ink(); cx.beginPath(); cx.moveTo(last.x,last.y); cx.lineTo(last.x+0.1,last.y); cx.stroke(); drawn=true; try{ cv.setPointerCapture(e.pointerId); }catch(_){} e.preventDefault(); });
      cv.addEventListener('pointermove',e=>{ if(!drawing) return; const p=pos(e); cx.strokeStyle=ink(); cx.beginPath(); cx.moveTo(last.x,last.y); cx.lineTo(p.x,p.y); cx.stroke(); last=p; });
      ['pointerup','pointercancel','pointerleave'].forEach(t=>cv.addEventListener(t,()=>{ drawing=false; }));
      q('#sg-clear').onclick=()=>{ cx.clearRect(0,0,cv.width,cv.height); drawn=false; };
      const styleBox=q('#sg-styles');
      SIG_FONTS.forEach((f,i)=>{ const row=document.createElement('label'); row.className='sg-style';
        row.innerHTML=`<input type="radio" name="sg-style" value="${i}"${i===0?' checked':''}><canvas width="400" height="56"></canvas>`;
        row.querySelector('input').onchange=()=>{ styleIdx=i; }; styleBox.appendChild(row); });
      const what=()=>q('input[name="sg-what"]:checked').value;
      const textNow=()=>what()==='sig'?(q('#sg-name').value.trim()||'Your name'):(q('#sg-init').value.trim()||'YN');
      const previews=()=>{ const t=textNow(); styleBox.querySelectorAll('canvas').forEach((pc,i)=>{
        const px=pc.getContext('2d'); px.clearRect(0,0,pc.width,pc.height);
        const tr=trimCanvas(renderTypedSig(t,SIG_FONTS[i].css,ink(),110),4); if(!tr) return;
        const k=Math.min(392/tr.width,48/tr.height); px.drawImage(tr,0,0,tr.width,tr.height,(400-tr.width*k)/2,(56-tr.height*k)/2,tr.width*k,tr.height*k); }); };
      ['#sg-name','#sg-init'].forEach(s=>q(s).addEventListener('input',previews));
      ov.querySelectorAll('input[name="sg-what"]').forEach(r=>r.addEventListener('change',previews));
      q('#sg-color').addEventListener('change',()=>{ // recolor what's already drawn, then refresh the typed previews
        if(drawn){ cx.globalCompositeOperation='source-in'; cx.fillStyle=ink(); cx.fillRect(0,0,cv.width,cv.height); cx.globalCompositeOperation='source-over'; }
        previews(); });
      ov.querySelectorAll('.sg-tabs button').forEach(b=>b.onclick=()=>{ mode=b.dataset.tab;
        ov.querySelectorAll('.sg-tabs button').forEach(x=>x.classList.toggle('on',x===b));
        q('#sg-draw').style.display=mode==='draw'?'block':'none'; q('#sg-type').style.display=mode==='type'?'block':'none'; if(mode==='type') previews(); });
      ov._get=()=>({mode,drawn,styleIdx,what:what(),ink:ink(),cv,name:q('#sg-name').value.trim(),init:q('#sg-init').value.trim()});
      fontsReady.then(()=>{ if(ov.isConnected) previews(); });
    },
    collect:(ov,setErr)=>{
      const s=ov._get();
      if(s.mode==='draw'){
        if(!s.drawn){ setErr('Draw your signature in the box first.'); return undefined; }
        const t=trimCanvas(s.cv,6); if(!t){ setErr('Draw your signature in the box first.'); return undefined; }
        return {dataUrl:t.toDataURL('image/png'),w:t.width,h:t.height,widthFrac:0.2,label:'Signature'};
      }
      const text=s.what==='sig'?s.name:s.init;
      if(!text){ setErr(s.what==='sig'?'Type your full name.':'Type your initials.'); return undefined; }
      const t=trimCanvas(renderTypedSig(text,SIG_FONTS[s.styleIdx].css,s.ink,160),8); if(!t){ setErr('Could not render that text.'); return undefined; }
      return {dataUrl:t.toDataURL('image/png'),w:t.width,h:t.height,widthFrac:s.what==='sig'?0.2:0.08,label:s.what==='sig'?'Signature':'Initials'};
    } });
  if(res) addImageObject(res.dataUrl,'image/png',res.w,res.h,'signature',res.label,res.widthFrac);
}
signBtn.onclick=signatureDialog;

// ---------- flatten pages ----------
async function flattenDialog(){
  if(!pdfDoc) return;
  const res=await dialog({ title:'Flatten pages', ok:'Flatten',
    body:pageSelectHTML('fp',`Current page (${currentPage})`)+
      `<h4>Options</h4>
       <label class="opt"><input type="checkbox" id="fl-allow" ${getAllowUnflatten()?'checked':''}> Allow unflatten later</label>
       <div class="sub" style="margin-top:2px;padding-left:24px">Keeps the editing data for your markups inside the PDF, so Document ▸ Unflatten can restore them later, even after the file is reopened here. Leave it unchecked to flatten permanently: the markups can't be moved, edited or removed afterward, not even in this editor.</div>
       <label class="opt"><input type="checkbox" id="fl-fields" checked> Include form fields</label>
       <div class="sub" style="margin-top:2px;padding-left:24px">Uncheck to leave checkboxes, radio buttons and dropdowns fillable on the flattened pages.</div>
       <label class="opt"><input type="checkbox" id="fl-remember"> Remember the unflatten choice</label>
       <div class="sub">Flattening bakes your markups into the page so every PDF viewer shows them correctly.</div>`,
    collect:(ov,setErr)=>{ let pages=readPageSelection(ov,'fp',setErr); if(!pages) return undefined; if(pages==='current') pages=[currentPage];
      const allow=ov.querySelector('#fl-allow').checked; if(ov.querySelector('#fl-remember').checked) setAllowUnflatten(allow);
      return {pages,permanent:!allow,fields:ov.querySelector('#fl-fields').checked}; } });
  if(!res) return;
  if(res.permanent){
    const sure=await modalConfirm(`Flatten ${res.pages.length===numPages?'all pages':res.pages.length===1?'this page':res.pages.length+' pages'} permanently? The markups will no longer be editable afterward, even in this app.`);
    if(!sure) return;
  }
  await flattenPages(res.pages,res.permanent,{fields:res.fields});
}
flattenBtn.onclick=flattenDialog;
