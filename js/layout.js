/* layout.js - Page numbers, header/footer and watermark: the data model, live overlay and PDF export. (The dialog is in layout-dialog.js.) */
// ---- layout: page numbers, header/footer (text on every page) and watermark
// State lives in `layout` (per open file). It is drawn live as an overlay and regenerated on every save:
// text as tagged FreeText annotations (CEK='layout'), the watermark as a tagged content stream (CEWM).
function newLayout(){ return {pageNumbers:null,headerFooter:null,watermark:null}; }
let layout=newLayout();
async function importLayout(buf){
  try{ const {PDFName,decodePDFRawStream}=PDFLib, doc=await pdfDocFrom(buf), v=doc.catalog.get(PDFName.of('CELayout'));
    if(v&&v.decodeText){ const o=Object.assign(newLayout(),JSON.parse(v.decodeText())), wm=o.watermark;
      if(wm&&wm.type==='image'){
        const im=doc.catalog.get(PDFName.of('CEWMImg')), st=im&&doc.context.lookup(im);
        if(st&&st.dict){ const mime=String(st.dict.get(PDFName.of('Kind'))).includes('jpg')?'image/jpeg':'image/png';
          wm.imgId=registerImage(bytesToDataUrl(decodePDFRawStream(st).decode(),mime),mime,wm.imgNw||0,wm.imgNh||0); }
        else o.watermark=null; }
      return o; } }catch(e){}
  return newLayout();
}
function toRoman(n){ let s=''; for(const [v,t] of [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']]) while(n>=v){ s+=t; n-=v; } return s; }
function toAlpha(n){ let s=''; while(n>0){ s=String.fromCharCode(65+(n-1)%26)+s; n=Math.floor((n-1)/26); } return s; }
function pageNumberText(fmt,i,total,start){
  const n=start+i-1, N=start+total-1;
  switch(fmt){ case 'Page n': return 'Page '+n; case 'Page n of N': return `Page ${n} of ${N}`; case 'n / N': return `${n} / ${N}`;
    case 'i': return n>0?toRoman(n):String(n); case 'A': return n>0?toAlpha(n):String(n); default: return String(n); }
}
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fillTokens(s,n,total){
  const d=new Date();
  return String(s).replace(/\{page\}/g,n).replace(/\{pages\}/g,total).replace(/\{date\}/g,`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`)
    .replace(/\{file\}/g,((docs[activeDoc]&&docs[activeDoc].name)||'').replace(/\.pdf$/i,''));
}
// does a layout item (page numbers / header-footer / watermark) show on page n?
function appliesTo(L,n){ if(L.skipFirst&&n===1) return false; if(L.baked&&L.baked.includes(n)) return false; return !L.pages||L.pages.includes(n); }
// every text run to draw on page n: {text, v:'t'|'b', h:'l'|'c'|'r', size, color, margin(in)}
function textItemsFor(n,total){
  const items=[], pn=layout.pageNumbers, hf=layout.headerFooter;
  if(pn&&appliesTo(pn,n)) items.push({text:pageNumberText(pn.fmt,n,total,pn.start),v:pn.pos[0],h:pn.pos[1],size:pn.size,color:pn.color,margin:pn.margin});
  if(hf&&appliesTo(hf,n)) [['hl','t','l'],['hc','t','c'],['hr','t','r'],['fl','b','l'],['fc','b','c'],['fr','b','r']].forEach(([k,v,h])=>{
    const t=hf.slots[k]; if(t&&t.trim()) items.push({text:fillTokens(t,n,total),v,h,size:hf.size,color:hf.color,margin:hf.margin}); });
  return items;
}
// watermark geometry (all in points, y-down, page-relative)
function wmTextWidth(text,size){ if(measureCtx){ measureCtx.font=`700 ${size}px Helvetica, Arial, sans-serif`; return measureCtx.measureText(text).width; } return text.length*size*0.6; }
function wmTile(W,H,sx,sy,deg){
  const out=[], a=deg*Math.PI/180, c=Math.cos(a), s=Math.sin(a), cx=W/2, cy=H/2, R=Math.hypot(W,H)/2, ni=Math.ceil(R/sx)+1, nj=Math.ceil(R/sy)+1;
  for(let j=-nj;j<=nj;j++) for(let i=-ni;i<=ni;i++){
    const lx=i*sx+(j&1?sx/2:0), ly=j*sy, x=cx+lx*c-ly*s, y=cy+lx*s+ly*c;
    if(x>-sx&&x<W+sx&&y>-sy&&y<H+sy){ out.push([x,y]); if(out.length>400) return out; } }
  return out;
}
function wmCenters(wm,W,H,textW,iw,ih){
  if(!wm.tile) return [[W/2,H/2]];
  return wmTile(W,H,wm.type==='image'?iw*1.4:textW*1.4+wm.size*2,wm.type==='image'?ih*1.4:wm.size*3.2,wm.rot);
}
function wmOverlay(d,v,wm){
  const k=v.w/v.ptsW, rec=wm.type==='image'?imageStore[wm.imgId]:null; if(wm.type==='image'&&!rec) return;
  let iw=0,ih=0,tw=0; if(rec){ iw=wm.imgWidth*v.ptsW; ih=iw*rec.nh/rec.nw; } else tw=wmTextWidth(wm.text,wm.size);
  wmCenters(wm,v.ptsW,v.ptsH,tw,iw,ih).forEach(([x,y])=>{
    let el;
    if(rec){ el=document.createElement('img'); el.src=rec.dataUrl; el.draggable=false; el.style.width=(iw*k)+'px'; }
    else { el=document.createElement('div'); el.textContent=wm.text; Object.assign(el.style,{font:`700 ${wm.size*k}px Helvetica, Arial, sans-serif`,color:wm.color,whiteSpace:'nowrap'}); }
    Object.assign(el.style,{position:'absolute',left:(x*k)+'px',top:(y*k)+'px',transform:`translate(-50%,-50%) rotate(${wm.rot}deg)`,opacity:wm.opacity});
    if(wm.layer==='under'||wm.layer==='multiply') el.style.mixBlendMode='multiply'; // "under" is only approximated here; on an opaque scan the saved file hides it
    d.appendChild(el); });
}
function buildLayout(n){
  const v=pageViews[n-1]; if(!v) return;
  const old=v.stage.querySelector('.pg-layout'); if(old) old.remove();
  const items=textItemsFor(n,numPages), wm=layout.watermark&&appliesTo(layout.watermark,n)?layout.watermark:null;
  if(!items.length&&!wm) return;
  const d=document.createElement('div'); d.className='pg-layout';
  if(wm) wmOverlay(d,v,wm);
  items.forEach(it=>{
    const s=document.createElement('div'), m=it.margin*72*scale; s.textContent=it.text;
    Object.assign(s.style,{position:'absolute',font:`${it.size*scale}px Helvetica, Arial, sans-serif`,lineHeight:'1.2',color:it.color,whiteSpace:'nowrap'});
    if(it.v==='t') s.style.top=m+'px'; else s.style.bottom=m+'px';
    if(it.h==='l') s.style.left=m+'px'; else if(it.h==='r') s.style.right=m+'px'; else { s.style.left='50%'; s.style.transform='translateX(-50%)'; }
    d.appendChild(s); });
  v.stage.appendChild(d);
}
// After pages are deleted / inserted / reordered, every stored page number has to follow.
function remapPageRefs(fn){
  const mapList=a=>a?Array.from(new Set(a.map(fn).filter(x=>x!=null))).sort((p,q)=>p-q):a;
  ['pageNumbers','headerFooter','watermark'].forEach(k=>{ const L=layout[k]; if(!L) return; if(L.pages) L.pages=mapList(L.pages); if(L.baked) L.baked=mapList(L.baked); });
  if(typeof remapBookmarks==='function') bookmarks=remapBookmarks(bookmarks,fn);
}

// ---- low-level page-content helpers (pdf-lib)
function pageContentRefs(page,ctx){ const c=page.node.get(PDFLib.PDFName.of('Contents')); if(!c) return []; const l=ctx.lookup(c); return (l instanceof PDFLib.PDFArray)?l.asArray().slice():[c]; }
function setPageContents(page,ctx,refs){ page.node.set(PDFLib.PDFName.of('Contents'),ctx.obj(refs)); }
function streamHasTag(ctx,ref,tag){ const s=ctx.lookup(ref); return !!(s&&s.dict&&s.dict.get&&s.dict.get(PDFLib.PDFName.of(tag))); }
function stripTaggedStreams(doc,tag){
  const ctx=doc.context;
  doc.getPages().forEach(p=>{ const refs=pageContentRefs(p,ctx), keep=refs.filter(r=>!streamHasTag(ctx,r,tag));
    if(keep.length!==refs.length){ refs.filter(r=>!keep.includes(r)).forEach(r=>{ if(r instanceof PDFLib.PDFRef) ctx.delete(r); }); setPageContents(p,ctx,keep); } }); // drop the removed streams entirely so they don't linger in the file
}

// Watermark = one tagged content stream per page (prepended for "under", appended for "over").
async function addWatermarkStreams(pdf,pages){
  const wm=layout.watermark; if(!wm) return;
  const ctx=pdf.context; let font=null, emb=null, rec=null;
  if(wm.type==='image'){ rec=imageStore[wm.imgId]; if(!rec) return; const bytes=dataUrlToBytes(rec.dataUrl); emb=rec.mime==='image/jpeg'?await pdf.embedJpg(bytes):await pdf.embedPng(bytes); }
  else font=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const hx=wm.color.replace('#',''), col=[0,2,4].map(i=>(parseInt(hx.substr(i,2),16)/255).toFixed(3)).join(' '), f=n=>(+n.toFixed(4));
  const gsRef=ctx.register(ctx.obj({Type:'ExtGState',ca:wm.opacity,CA:wm.opacity,BM:wm.layer==='multiply'?'Multiply':'Normal'}));
  pages.forEach((page,i)=>{
    if(!appliesTo(wm,i+1)) return;
    const g=pageGeom(page), W=g.W, H=g.H, o=g.toUser(0,0);
    const gsKey=page.node.newExtGState('CEWMG',gsRef).toString();
    const resKey=rec?page.node.newXObject('CEWMI',emb.ref).toString():page.node.newFontDictionary('CEWMF',font.ref).toString();
    let iw=0,ih=0,tw=0; if(rec){ iw=wm.imgWidth*W; ih=iw*rec.nh/rec.nw; } else tw=font.widthOfTextAtSize(wm.text,wm.size);
    const th=-wm.rot*Math.PI/180, c=Math.cos(th), s=Math.sin(th);
    let ops=`q\n${gsKey} gs\n${g.M.slice(0,4).map(f).join(' ')} ${f(o.x)} ${f(o.y)} cm\n`; // display space -> real page space (rotation / crop aware)
    wmCenters(wm,W,H,tw,iw,ih).forEach(([x,y])=>{
      ops+=`q\n${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(x)} ${f(H-y)} cm\n`;
      if(rec) ops+=`${f(iw)} 0 0 ${f(ih)} ${f(-iw/2)} ${f(-ih/2)} cm\n${resKey} Do\n`;
      else ops+=`BT\n${resKey} ${wm.size} Tf\n${col} rg\n${f(-tw/2)} ${f(-wm.size*0.35)} Td\n${font.encodeText(wm.text).toString()} Tj\nET\n`;
      ops+='Q\n'; });
    ops+='Q\n';
    const st=ctx.register(ctx.stream(ops,{CEWM:true})), list=pageContentRefs(page,ctx);
    setPageContents(page,ctx,wm.layer==='under'?[st,...list]:[...list,st]);
  });
}

// Everything that isn't a markup, regenerated from state on each save.
async function exportExtras(x){
  const {pdf,pages,font,ctxP,addAnnot,setGeo,hexArr}=x, {PDFName,PDFHexString,rgb,degrees,drawText}=PDFLib;
  stripTaggedStreams(pdf,'CEWM');
  pdf.setProducer('PDF Viewer & Editor (pdf-lib)'); // marks the file as ours, so reopening it here knows to look for saved markups
  const safe=s=>Array.from(s).map(ch=>{ try{ font.encodeText(ch); return ch; }catch(e){ return '?'; } }).join('');
  pages.forEach((page,i)=>{
    const items=textItemsFor(i+1,pages.length); if(!items.length) return;
    const geo=pageGeom(page); setGeo(geo); const W=geo.W, H=geo.H;
    items.forEach(it=>{
      const txt=safe(it.text), size=it.size, tw=font.widthOfTextAtSize(txt,size), m=it.margin*72, bw=tw+2, bh=size*1.2, col=hexArr(it.color);
      const x0=it.h==='l'?m:it.h==='r'?W-m-bw:(W-bw)/2, yb=it.v==='t'?H-m-bh:m;
      const ops=drawText(font.encodeText(txt),{x:1,y:size*0.28,size,font:'F1',color:rgb(col[0],col[1],col[2]),rotate:degrees(0),xSkew:degrees(0),ySkew:degrees(0)});
      const apRef=ctxP.register(ctxP.formXObject(ops,{BBox:[0,0,bw,bh],Resources:{Font:{F1:font.ref}}}));
      addAnnot(page,{Type:'Annot',Subtype:'FreeText',Rect:[x0,yb,x0+bw,yb+bh],BS:{W:0},F:4,AP:{N:apRef},CEK:'layout'},
        {Contents:txt,DA:`${col[0].toFixed(3)} ${col[1].toFixed(3)} ${col[2].toFixed(3)} rg /Helv ${size} Tf`,CED:JSON.stringify({kind:'layout'})});
    });
  });
  await addWatermarkStreams(pdf,pages);
  await exportFields(x);
  writeOutlines(pdf,pages);
  const CEL=PDFName.of('CELayout'), IMG=PDFName.of('CEWMImg'), wm=layout.watermark;
  if(layout.pageNumbers||layout.headerFooter||wm) pdf.catalog.set(CEL,PDFHexString.fromText(JSON.stringify(layout))); else pdf.catalog.delete(CEL);
  if(wm&&wm.type==='image'&&imageStore[wm.imgId]){ const rec=imageStore[wm.imgId];
    pdf.catalog.set(IMG,ctxP.register(ctxP.flateStream(dataUrlToBytes(rec.dataUrl),{Kind:rec.mime==='image/jpeg'?'jpg':'png'}))); }
  else pdf.catalog.delete(IMG);
}
