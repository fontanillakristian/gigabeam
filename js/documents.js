/* documents.js - Opening files, importing saved markups, and the multi-tab document model. */
openBtn.onclick=()=>fileInput.click();
// Reconstructs this app's own editable objects from any CEK/CED-tagged annotations
// left by a previous save, so a PDF exported by this app can be re-opened and edited
// again (rather than only being viewable/editable as generic markup elsewhere).
async function importAnnotations(buf,skipPages){ // skipPages: flattened pages. Their HIDDEN originals stay in the file (not on screen); anything visible there is imported as usual
  const result={};
  try{
    const {PDFName}=PDFLib;
    const doc=await pdfDocFrom(buf); // a bytes buffer, or an already-parsed document (so one parse serves every import)
    doc.getPages().forEach((page,i)=>{
      const arr=page.node.Annots(); if(!arr) return;
      const flat=!!(skipPages&&skipPages.has(i+1));
      for(let j=0;j<arr.size();j++){
        const dict=doc.context.lookup(arr.get(j)); if(!dict||!dict.get) continue;
        const cek=dict.get(PDFName.of('CEK')), ced=dict.get(PDFName.of('CED'));
        if(!cek||!ced) continue;
        if(flat){ const F=dict.get(PDFName.of('F')); if(F&&F.asNumber&&(F.asNumber()&2)===2) continue; }
        let kind,data;
        try{ kind=cek.decodeText?cek.decodeText():null; data=JSON.parse(ced.decodeText()); } catch(e){ continue; }
        const pageNum=i+1; if(!result[pageNum]) result[pageNum]={texts:[],shapes:[],paths:[],measurements:[],images:[],fields:[]};
        if(kind==='text') result[pageNum].texts.push(data);
        else if(kind==='shape') result[pageNum].shapes.push(data);
        else if(kind==='path') result[pageNum].paths.push(data);
        else if(kind==='measurement') result[pageNum].measurements.push(data);
        else if(kind==='field') result[pageNum].fields.push(normalizeField(data));
        else if(kind==='image'){ const id=readImageRecord(doc,dict,data); if(id){ data.imgId=id; result[pageNum].images.push(data); } }
      }
    });
  }catch(e){ /* not fatal - just means nothing importable */ }
  return result;
}

fileInput.onchange=async e=>{
  const files=Array.from(e.target.files||[]); if(!files.length) return;
  // Open fast, show progress: pdf.js opens the file and page 1 is on screen first. The slow pdf-lib parse (needed only to
  // recover markups saved by THIS editor) is skipped for other files and otherwise runs afterwards, in the background.
  const added=[];
  for(const file of files){
    try{
      showLoad(file.name,'Reading file…',0);
      const buf=await readFileWithProgress(file,p=>showLoad(file.name,'Reading file… '+Math.round(p*100)+'%',p*25));
      showLoad(file.name,'Opening document…',30); await tick();
      let doc;
      try{ doc=await pdfjsLib.getDocument({data:buf.slice(0)}).promise; }
      catch(err){ hideLoad(); await modalAlert('Could not open '+file.name+': '+err.message); continue; }
      showLoad(file.name,'Checking for saved markups…',40); await tick();
      const deep=await needsDeepRead(buf,doc), bm=await importBookmarks(doc);
      let scale0=1.25; // big sheets (A3 / ARCH) open fitted to the window width
      try{ const w=(await doc.getPage(1)).getViewport({scale:1}).width, avail=main.clientWidth-90; if(w*1.25>avail) scale0=Math.min(3,Math.max(0.5,avail/w)); }catch(err){}
      const tab={ layout:newLayout(), bookmarks:bm, flatPages:new Set(), name:file.name, pdfDoc:doc, originalBytes:buf, numPages:doc.numPages, currentPage:1,
        scale:scale0, annotations:{}, scaleInfo:null, historyStack:[], redoStack:[], selected:null, deep };
      docs.push(tab); added.push(tab);
    }catch(err){ hideLoad(); await modalAlert('Could not open '+file.name+': '+err.message); }
  }
  fileInput.value='';
  if(!added.length){ hideLoad(); return; }
  emptyMsg.style.display='none';
  ZOOM_CTRLS().forEach(b=>b.disabled=false);
  setToolButtonsDisabled(false);
  const last=added[added.length-1];
  showLoad(last.name,`Preparing ${last.numPages} page${last.numPages===1?'':'s'}…`,55); await tick();
  await loadTab(docs.indexOf(last));
  showLoad(last.name,'Rendering page 1…',85);
  for(let i=0;i<80&&document.visibilityState==='visible'&&!(pageViews[0]&&pageViews[0].rendered);i++) await new Promise(r=>setTimeout(r,50)); // (nothing paints in a background tab, so don't wait there)
  hideLoad();
  for(const t of added) if(t.deep) await deepImport(t);
};

function snapshotCurrent(){
  if(activeDoc<0||!docs[activeDoc]) return;
  const t=docs[activeDoc];
  t.pdfDoc=pdfDoc; t.originalBytes=originalBytes; t.numPages=numPages; t.currentPage=currentPage; t.scale=scale;
  t.annotations=annotations; t.scaleInfo=scaleInfo; t.historyStack=historyStack; t.redoStack=redoStack; t.selected=selected; t.layout=layout; t.bookmarks=bookmarks; t.flatPages=flatPages;
}
async function loadTab(idx){
  snapshotCurrent(); activeDoc=idx; const t=docs[idx];
  pdfDoc=t.pdfDoc; originalBytes=t.originalBytes; numPages=t.numPages; currentPage=t.currentPage; scale=t.scale;
  annotations=t.annotations; scaleInfo=t.scaleInfo; historyStack=t.historyStack; redoStack=t.redoStack; selected=t.selected; layout=t.layout||newLayout(); bookmarks=t.bookmarks||[]; flatPages=t.flatPages||new Set();
  updateScaleLabel();
  syncZoomUI();
  updateHistBtns(); renderTabBar();
  await renderPage();
  await renderPagePanel();
}
// Close a tab, asking first if it has unsaved changes.
async function requestCloseTab(i){
  const t=docs[i]; if(!t) return;
  if(t.dirty){
    const c=await modalChoice(`<b>${esc(t.name)}</b> has changes that haven't been saved.<br>Do you want to save before closing?`,
      [{id:'save',label:'Save',primary:true},{id:'discard',label:"Don't save",danger:true},{id:'cancel',label:'Cancel'}]);
    if(c===null||c==='cancel') return;
    if(c==='save'){ if(i!==activeDoc) await loadTab(i); if(!(await saveActiveDocument())) return; } // a cancelled save keeps the tab open
  }
  closeTab(i);
}
function closeTab(i){
  snapshotCurrent(); // keep the active tab's live state when a different tab is closed
  docs.splice(i,1);
  if(!docs.length){
    activeDoc=-1; pdfDoc=null; originalBytes=null; numPages=0; annotations={}; selected=null; scaleInfo=null; layout=newLayout(); bookmarks=[]; flatPages=new Set(); updateScaleLabel();
    layoutToken++; if(pageObserver){ pageObserver.disconnect(); pageObserver=null; }
    pageViews=[]; clearPending(true);
    main.innerHTML=''; main.appendChild(emptyMsg); emptyMsg.style.display='block';
    updatePageIndicator(); syncZoomUI();
    ZOOM_CTRLS().forEach(b=>b.disabled=true);
    setToolButtonsDisabled(true);
    pagesList.innerHTML='';
    renderProps();
    renderTabBar(); return;
  }
  const newIdx=Math.min(i<=activeDoc?Math.max(0,activeDoc-1):activeDoc, docs.length-1);
  activeDoc=-1; loadTab(newIdx);
}
function renderTabBar(){
  tabBar.innerHTML='';
  docs.forEach((t,i)=>{
    const b=document.createElement('div'); b.className='tab'+(i===activeDoc?' active':'')+(t.dirty?' dirty':''); b.title=t.name+(t.dirty?' (unsaved changes)':'');
    b.innerHTML=(i===activeDoc||t.dirty?'<span class="dot"></span>':'')+'<span class="name"></span><button class="x" aria-label="Close tab"><svg class="i sm"><use href="#i-x"/></svg></button>';
    b.querySelector('.name').textContent=t.name;
    b.querySelector('.x').onclick=ev=>{ ev.stopPropagation(); requestCloseTab(i); };
    b.onclick=()=>{ if(i!==activeDoc) loadTab(i); };
    tabBar.appendChild(b);
  });
  const add=document.createElement('button'); add.className='tab-add'; add.title='Open PDF'; add.innerHTML='<svg class="i sm"><use href="#i-plus"/></svg>';
  add.onclick=()=>fileInput.click(); tabBar.appendChild(add);
}
