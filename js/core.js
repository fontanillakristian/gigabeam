/* core.js - The heavy, DOM-free PDF work: saving, printing, page operations, flatten / unflatten and reading a file's saved data.
   Every function here takes plain parameters and reads only the shared document state (originalBytes, annotations, layout, bookmarks, flatPages,
   scale, docs, imageStore). It never touches the page, so the very same code runs in two places:
     - js/pdf-worker.js, in a background worker (the normal case: the window stays responsive), and
     - on the main thread, as a fallback when a worker can't start (see heavy() in worker-api.js).
   Each returns a result object; when it changes the file it includes the new `bytes` and the set of flattened pages `flat`. */

// The working copy of a document never carries this editor's own visible annotations: the app draws those itself from its state
// (and writes them back on save), while pdf.js draws every OTHER annotation (other programs' markups, form fields). Removing ours
// from the working copy keeps them from being drawn twice. Hidden originals of flattened pages (F=2) stay, for Unflatten.
function stripOwnAnnots(doc){
  const {PDFName,PDFRef,PDFDict}=PDFLib, ctx=doc.context, CEK=PDFName.of('CEK'), gone=new Set();
  const drop=r=>{ if(r instanceof PDFRef) ctx.delete(r); };
  const dropAppearance=d=>{ const ap=ctx.lookup(d.get(PDFName.of('AP'))); if(!(ap instanceof PDFDict)) return;
    [PDFName.of('N'),PDFName.of('D')].forEach(k=>{ const v=ap.get(k), st=v instanceof PDFRef?ctx.lookup(v):null;
      if(v instanceof PDFRef){ // an image stamp's appearance owns its image XObject
        try{ const res=st&&st.dict?ctx.lookup(st.dict.get(PDFName.of('Resources'))):null, xo=res&&res.get?ctx.lookup(res.get(PDFName.of('XObject'))):null, im=xo&&xo.get?xo.get(PDFName.of('Im1')):null;
          if(im instanceof PDFRef){ const is=ctx.lookup(im); if(is&&is.dict) drop(is.dict.get(PDFName.of('SMask'))); drop(im); } }catch(e){}
        drop(v); }
      else if(v instanceof PDFDict) v.entries().forEach(([,r])=>drop(r)); }); }; // form field states (On / Off)
  doc.getPages().forEach(pg=>{ const arr=pg.node.Annots(); if(!arr) return;
    for(let i=arr.size()-1;i>=0;i--){ const ref=arr.get(i), d=ctx.lookup(ref);
      if(!(d&&d.get&&d.get(CEK))) continue;
      const F=d.get(PDFName.of('F')); if(F&&F.asNumber&&(F.asNumber()&2)===2) continue;
      arr.remove(i); gone.add(String(ref)); dropAppearance(d); drop(d.get(PDFName.of('CEI'))); drop(ref); } });
  if(!gone.size) return 0;
  const af=doc.catalog.lookup(PDFName.of('AcroForm')), fa=af instanceof PDFDict?af.lookup(PDFName.of('Fields')):null;
  if(fa&&fa.asArray) for(let i=fa.size()-1;i>=0;i--){ const r=fa.get(i), d=ctx.lookup(r);
    if(gone.has(String(r))){ fa.remove(i); continue; }
    if(d&&d.get&&d.get(CEK)){ const kids=d.lookup(PDFName.of('Kids')); // a radio group: drop it once none of its buttons are left
      if(kids&&kids.asArray&&kids.asArray().every(k=>gone.has(String(k)))){ fa.remove(i); drop(r); } } }
  return gone.size;
}
// finish an edited pdf-lib document: which pages are flattened now, then the saved bytes
async function finishDoc(doc,extra){
  stripOwnAnnots(doc);
  const flat=await detectFlattened(doc);
  const bytes=await doc.save(SAVE_OPTS);
  return Object.assign({bytes,flat:Array.from(flat)},extra);
}

const CORE={
  // ---- save / print
  async save(){ return {bytes:await buildExportBytes()}; },
  async print(p){ let bytes=await buildExportBytes(); if(p.area) bytes=await cropBytesToArea(bytes,p.area); return {bytes}; },

  // ---- page operations
  async deletePage(p){ const doc=await loadPdf(originalBytes); (p.ns||[p.n]).slice().sort((a,b)=>b-a).forEach(n=>doc.removePage(n-1)); return finishDoc(doc); }, // p.ns: several pages at once (removed from the end so numbers stay valid)
  async insertBlank(p){
    const doc=await loadPdf(originalBytes), ref=doc.getPage(Math.max(0,Math.min(p.after-1,doc.getPageCount()-1))), g=pageGeom(ref); // the size you SEE (rotation / crop applied)
    doc.insertPage(p.after,[g.W,g.H]); return finishDoc(doc);
  },
  async insertPdf(p){
    const doc=await loadPdf(originalBytes), src=await loadPdf(p.src), copied=await doc.copyPages(src,src.getPageIndices());
    copied.forEach((pg,i)=>doc.insertPage(p.after+i,pg)); return finishDoc(doc,{count:copied.length});
  },
  // p.order: the OLD 1-based page numbers, listed in the NEW desired sequence
  async reorder(p){
    const doc=await loadPdf(originalBytes), out=await PDFLib.PDFDocument.create(), copied=await out.copyPages(doc,p.order.map(n=>n-1));
    copied.forEach(pg=>out.addPage(pg)); return finishDoc(out);
  },
  // rotate / crop also re-express every markup against the new view of the page, so they return the updated `annotations`
  async rotate(p){
    const doc=await loadPdf(originalBytes);
    p.pages.forEach(n=>{ const pg=doc.getPage(n-1), oldG=pageGeom(pg);
      pg.setRotation(PDFLib.degrees((((pg.getRotation().angle+p.deg)%360)+360)%360)); remapPageAnnotations(n,oldG,pageGeom(pg)); });
    return finishDoc(doc,{annotations,ocr:ocrPages});
  },
  async crop(p){
    const doc=await loadPdf(originalBytes), f=p.area;
    p.pages.forEach(n=>{ const pg=doc.getPage(n-1), oldG=pageGeom(pg);
      if(f){ const cs=[[f.x1,f.y1],[f.x2,f.y1],[f.x2,f.y2],[f.x1,f.y2]].map(([fx,fy])=>oldG.toUser(fx*oldG.W,(1-fy)*oldG.H)), xs=cs.map(c=>c.x), ys=cs.map(c=>c.y), x=Math.min(...xs), y=Math.min(...ys);
        pg.setCropBox(x,y,Math.max(...xs)-x,Math.max(...ys)-y); }
      else { const mb=pg.getMediaBox(); pg.setCropBox(mb.x,mb.y,mb.width,mb.height); }
      remapPageAnnotations(n,oldG,pageGeom(pg)); });
    return finishDoc(doc,{annotations,ocr:ocrPages});
  },

  // ---- flatten: bake each page's markups into ONE extra content stream. With "allow unflatten" the stream is tagged (CEFL) and the
  // originals stay in the file as hidden annotations; a permanent flatten writes an untagged stream and deletes the originals.
  async flatten(p){
    const permanent=p.permanent, opts=p.opts, pages=p.pages;
    const doc=await loadPdf(await buildExportBytes());
    const {PDFName,PDFRef,PDFNumber,PDFDict,PDFBool}=PDFLib, ctxP=doc.context, pageSet=new Set(pages), f=n=>(+n.toFixed(5));
    const dropObj=r=>{ if(r instanceof PDFRef) ctxP.delete(r); };
    doc.getPages().forEach((page,i)=>{
      const flatHere=pageSet.has(i+1), refs=[];
      pageContentRefs(page,ctxP).forEach(r=>{
        if(!streamHasTag(ctxP,r,'CEWM')){ refs.push(r); return; }
        if(!flatHere) return; // regenerated live on save
        const s=ctxP.lookup(r); s.dict.delete(PDFName.of('CEWM')); if(!permanent) s.dict.set(PDFName.of('CEFL'),PDFBool.True); refs.push(r); });
      if(flatHere){
        const arr=page.node.Annots(); let ops='';
        for(let k=arr?arr.size()-1:-1;k>=0;k--){
          const ref=arr.get(k), d=ctxP.lookup(ref);
          if(!d||!d.get||!d.get(PDFName.of('CEK'))) continue; // only bake OUR markups; leave any pre-existing PDF annotations alone
          if(opts&&opts.fields===false&&d.get(PDFName.of('CEK')).decodeText()==='field') continue;
          const ap=ctxP.lookup(d.get(PDFName.of('AP'))), nObj=ap&&ap.get&&ap.get(PDFName.of('N'));
          const nRef=nObj instanceof PDFDict?(()=>{ const as=d.get(PDFName.of('AS')); return as&&nObj.get(as); })():nObj; // form fields: bake the state currently showing
          if(!(nRef instanceof PDFRef)) continue;
          const apStream=ctxP.lookup(nRef), bb=apStream.dict.get(PDFName.of('BBox')).asArray().map(x=>x.asNumber()), mObj=apStream.dict.get(PDFName.of('Matrix')),
            M=mObj?mObj.asArray().map(x=>x.asNumber()):[1,0,0,1,0,0], rc=d.get(PDFName.of('Rect')).asArray().map(x=>x.asNumber());
          // standard appearance placement: transform the BBox corners by Matrix, then map that box onto Rect
          const cs=[[bb[0],bb[1]],[bb[2],bb[1]],[bb[2],bb[3]],[bb[0],bb[3]]].map(([x,y])=>[M[0]*x+M[2]*y+M[4],M[1]*x+M[3]*y+M[5]]),
            tx=cs.map(c=>c[0]), ty=cs.map(c=>c[1]), tx0=Math.min(...tx), tx1=Math.max(...tx), ty0=Math.min(...ty), ty1=Math.max(...ty),
            sx=(tx1-tx0)>1e-6?(rc[2]-rc[0])/(tx1-tx0):1, sy=(ty1-ty0)>1e-6?(rc[3]-rc[1])/(ty1-ty0):1, A=[sx,0,0,sy,rc[0]-tx0*sx,rc[1]-ty0*sy];
          const xKey=page.node.newXObject('CEFlat',nRef).toString(), caObj=d.get(PDFName.of('CA'));
          let gs=''; if(caObj){ const ca=caObj.asNumber(); if(ca<0.999){ gs=page.node.newExtGState('CEGS',ctxP.register(ctxP.obj({Type:'ExtGState',ca,CA:ca}))).toString()+' gs\n'; } }
          ops+=`q\n${gs}${A.map(f).join(' ')} cm\n${xKey} Do\nQ\n`;
          const isLayout=d.get(PDFName.of('CEK')).decodeText()==='layout';
          if(permanent||isLayout){ dropObj(d.get(PDFName.of('CEI'))); arr.remove(k); dropObj(ref); } // layout text is tracked by state ("baked"), never kept as a hidden copy
          else d.set(PDFName.of('F'),PDFNumber.of(2)); // hidden: the baked copy shows everywhere; Unflatten un-hides this one
        }
        if(ops) refs.push(ctxP.register(ctxP.stream(ops,permanent?{}:{CEFL:true})));
      }
      setPageContents(page,ctxP,refs);
    });
    const flat=await detectFlattened(doc), ann=await importAnnotations(doc,flat); // what's editable on screen afterwards (hidden originals of flat pages stay off screen)
    stripOwnAnnots(doc); // (the editable copies now live in `ann`)
    return {bytes:await doc.save(SAVE_OPTS),flat:Array.from(flat),annotations:ann};
  },
  async unflatten(p){
    const doc=await loadPdf(await buildExportBytes());
    const {PDFName,PDFNumber}=PDFLib, ctxP=doc.context, set=new Set(p.pages);
    doc.getPages().forEach((page,i)=>{
      const here=set.has(i+1);
      const keep=pageContentRefs(page,ctxP).filter(r=>!streamHasTag(ctxP,r,'CEWM')&&!(here&&streamHasTag(ctxP,r,'CEFL'))); // live watermark is redrawn on save
      setPageContents(page,ctxP,keep);
      if(!here) return;
      const arr=page.node.Annots(); if(!arr) return;
      for(let k=0;k<arr.size();k++){ const d=ctxP.lookup(arr.get(k)); if(!d||!d.get||!d.get(PDFName.of('CEK'))) continue;
        const F=d.get(PDFName.of('F')); if(F&&F.asNumber&&(F.asNumber()&2)===2) d.set(PDFName.of('F'),PDFNumber.of(4)); }
    });
    const flat=await detectFlattened(doc), ann=await importAnnotations(doc,flat);
    stripOwnAnnots(doc); // (the editable copies now live in `ann`)
    return {bytes:await doc.save(SAVE_OPTS),flat:Array.from(flat),annotations:ann};
  },

  // ---- reading the data this editor saved in a file (markups, layout, flatten info): one parse serves all of it
  async inspect(p){ // p.bytes: the file to read (it need not be the tab that is open now)
    const src=p.bytes, doc=await loadPdf(src,{ignoreEncryption:true,updateMetadata:false});
    const lay=await importLayout(doc), flat=await detectFlattened(doc), ann=await importAnnotations(doc,flat);
    let changed=false;
    if(lay.watermark&&rawHas(src,"/CEWM")){ stripTaggedStreams(doc,"CEWM"); changed=true; } // a saved watermark is a content stream: lift it out so it is drawn (and editable) as an overlay
    if(stripOwnAnnots(doc)) changed=true; // our own markups are drawn by the app, not by pdf.js (see stripOwnAnnots)
    const stripped=changed?await doc.save(SAVE_OPTS):null;
    return {layout:lay,flat:Array.from(flat),annotations:ann,stripped};
  }
};
