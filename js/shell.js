/* shell.js - Application chrome: toolbar mode tabs, side panels, zoom and status bar, pan tool, drag-and-drop, command menus and search, keyboard shortcuts. Loaded after the feature files because its command table references them. */
// ---- toolbar mode tabs (Markup / Forms / Document)
document.querySelectorAll('#mode-tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#mode-tabs button').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.modeset').forEach(g=>g.style.display=g.dataset.mode===b.dataset.mode?'flex':'none'); });

// ---- side panels
let leftView='pages';
const LEFT_VIEWS={pages:['Pages',pagesBtn],bookmarks:['Bookmarks',$('bookmarks-btn')],markups:['Markups',$('markups-btn')]};
const isNarrow=()=>innerWidth<=820; // side panels float over the canvas on narrow windows, so only one is open at a time
function closeProps(){ propsPanel.classList.add('hidden'); propsBtn.classList.remove('on'); }
function showLeft(v){ leftView=v; pagesPanel.classList.remove('hidden'); if(isNarrow()) closeProps();
  Object.keys(LEFT_VIEWS).forEach(k=>{ LEFT_VIEWS[k][1].classList.toggle('on',k===v); $('view-'+k).style.display=k===v?'':'none'; });
  $('left-title').textContent=LEFT_VIEWS[v][0]; if(v==='markups') refreshMarkups(); if(v==='bookmarks') renderBookmarks(); }
function hideLeft(){ pagesPanel.classList.add('hidden'); Object.values(LEFT_VIEWS).forEach(x=>x[1].classList.remove('on')); }
function toggleLeft(v){ if(!pagesPanel.classList.contains('hidden')&&leftView===v) hideLeft(); else showLeft(v); }
Object.keys(LEFT_VIEWS).forEach(k=>{ LEFT_VIEWS[k][1].onclick=()=>toggleLeft(k); });
$('pages-close').onclick=hideLeft;
propsBtn.onclick=()=>{ if(propsPanel.classList.contains('hidden')) openProps(); else closeProps(); };
$('props-close').onclick=closeProps;
[['left-split','left-panel','--left-w',1,150,420],['right-split','right-panel','--right-w',-1,220,480]].forEach(([s,p,v,dir,min,max])=>{
  const sp=$(s); sp.onmousedown=e=>{ e.preventDefault(); const x0=e.clientX, w0=$(p).offsetWidth; sp.classList.add('drag'); document.body.classList.add('resizing');
    const mv=ev=>document.documentElement.style.setProperty(v,Math.min(max,Math.max(min,w0+dir*(ev.clientX-x0)))+'px');
    const up=()=>{ sp.classList.remove('drag'); document.body.classList.remove('resizing'); removeEventListener('mousemove',mv); removeEventListener('mouseup',up); };
    addEventListener('mousemove',mv); addEventListener('mouseup',up); }; });

// ---- zoom + fit (engine scale 1.25 == 100%)
const zoomRange=$('zoom-range');
const ZOOM_CTRLS=()=>[zoomOutBtn,zoomInBtn,downloadBtn,printBtn,zoomRange,$('fit-width'),$('fit-page'),$('bm-toggle')];
function syncZoomUI(){ const p=Math.round(scale/1.25*100); zoomLabel.textContent=p+'%'; zoomRange.value=Math.min(240,Math.max(40,p)); }
zoomRange.addEventListener('input',()=>{ zoomLabel.textContent=zoomRange.value+'%'; });
zoomRange.addEventListener('change',()=>setZoom(+zoomRange.value/100*1.25));
function fitZoom(mode){ const v=pageViews[currentPage-1]; if(!v) return; let s=(main.clientWidth-90)/v.ptsW; if(mode==='page') s=Math.min(s,(main.clientHeight-64)/v.ptsH); setZoom(s); }
$('fit-width').onclick=()=>fitZoom('width'); $('fit-page').onclick=()=>fitZoom('page');
main.addEventListener('wheel',e=>{ if(!e.ctrlKey||!pdfDoc) return; e.preventDefault(); setZoom(scale+(e.deltaY<0?0.125:-0.125)); },{passive:false});

// ---- status bar
function paperLabel(w,h){
  const a=Math.min(w,h)/72, b=Math.max(w,h)/72, fmt=n=>(+n.toFixed(2)).toString();
  const P=[['Letter',8.5,11],['Legal',8.5,14],['Tabloid',11,17],['A4',8.27,11.69],['A3',11.69,16.54],['ARCH C',18,24],['ARCH D',24,36],['ARCH E',36,48]];
  const m=P.find(([,x,y])=>Math.abs(x-a)<0.08&&Math.abs(y-b)<0.08);
  return (m?m[0]+' · ':'')+fmt(w/72)+' × '+fmt(h/72)+' in';
}
main.addEventListener('mousemove',e=>{
  const st=e.target.closest&&e.target.closest('.pg-stage'), v=st&&pageViews[(+st.dataset.page)-1];
  if(!v){ $('coords').textContent=''; return; }
  const r=st.getBoundingClientRect(); $('coords').textContent=`x ${((e.clientX-r.left)/v.w*v.ptsW).toFixed(1)}   y ${((e.clientY-r.top)/v.h*v.ptsH).toFixed(1)} pt`; });
main.addEventListener('mouseleave',()=>{ $('coords').textContent=''; });
$('prev-btn').onclick=()=>{ if(currentPage>1) goToPage(currentPage-1); };
$('next-btn').onclick=()=>{ if(currentPage<numPages) goToPage(currentPage+1); };
pageNumInput.addEventListener('change',()=>{ if(!pdfDoc) return; const n=Math.min(numPages,Math.max(1,parseInt(pageNumInput.value,10)||currentPage)); goToPage(n); updatePageIndicator(); });
pageNumInput.addEventListener('keydown',e=>{ if(e.key==='Enter') pageNumInput.blur(); });

// ---- pan tool
main.addEventListener('mousedown',e=>{
  if(tool!=='pan'||e.button!==0) return; e.preventDefault();
  const sx=e.clientX, sy=e.clientY, ox=main.scrollLeft, oy=main.scrollTop; document.body.classList.add('panning');
  const mv=ev=>{ main.scrollLeft=ox-(ev.clientX-sx); main.scrollTop=oy-(ev.clientY-sy); };
  const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); document.body.classList.remove('panning'); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up); });

// ---- drag a PDF onto the canvas
['dragenter','dragover'].forEach(t=>main.addEventListener(t,e=>{ if(e.dataTransfer&&Array.from(e.dataTransfer.types).includes('Files')){ e.preventDefault(); document.body.classList.add('dropping'); } }));
main.addEventListener('dragleave',e=>{ if(!main.contains(e.relatedTarget)) document.body.classList.remove('dropping'); });
main.addEventListener('drop',e=>{
  document.body.classList.remove('dropping');
  const fs=Array.from(e.dataTransfer?e.dataTransfer.files:[]).filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name)); if(!fs.length) return;
  e.preventDefault(); openFiles(fs); });

// ---- commands (drive both the menu bar and the search box)
const needDoc=fn=>()=>{ if(pdfDoc) fn(); };
const tl=id=>needDoc(()=>setTool(id));
// [menu, label, shortcut, run, soon?]  ('-' label = divider)
const COMMANDS=[
  ['File','Open PDF…','Ctrl+O',()=>platform.open()],
  ['File','Save PDF','Ctrl+S',needDoc(()=>{ if(!downloadBtn.disabled) downloadBtn.click(); })],
  ['File','Save PDF as…','Ctrl+Shift+S',needDoc(()=>{ if(!downloadBtn.disabled) saveActiveDocument({saveAs:true}); })],
  ['File','Password protection…','',needDoc(protectDialog)],
  ['File','Print…','Ctrl+P',needDoc(()=>{ if(!printBtn.disabled) printBtn.click(); })],
  ['File','-'],['File','Close tab','',needDoc(()=>requestCloseTab(activeDoc))],
  ['Edit','Undo','Ctrl+Z',needDoc(doUndo)],['Edit','Redo','Ctrl+Y',needDoc(doRedo)],['Edit','-'],
  ['Edit','Find…','Ctrl+F',needDoc(openFind)],['Edit','-'],
  ['Edit','Paste text box','Ctrl+V',needDoc(pasteClipboard)],['Edit','Delete selection','Del',needDoc(deleteSelected)],
  ['View','Zoom in','',needDoc(()=>zoomInBtn.click())],['View','Zoom out','',needDoc(()=>zoomOutBtn.click())],
  ['View','Fit width','',needDoc(()=>fitZoom('width'))],['View','Fit page','',needDoc(()=>fitZoom('page'))],['View','Actual size (100%)','',needDoc(()=>setZoom(1.25))],['View','-'],
  ['View','Toggle pages panel','',()=>pagesBtn.click()],['View','Toggle properties panel','',()=>propsBtn.click()],['View','Show markups list','',()=>showLeft('markups')],['View','Show bookmarks','',()=>showLeft('bookmarks')],['View','Show pages panel','',()=>showLeft('pages')],
  ['Document','Rotate pages…','',needDoc(rotateDialog)],['Document','Crop pages…','',needDoc(cropDialog)],['Document','Recognize text (OCR)…','',needDoc(ocrDialog)],['Document','Flatten markups…','',needDoc(flattenDialog)],['Document','-'],
  ['Document','Insert blank page','',needDoc(()=>addBlankBtn.click())],['Document','Insert PDF…','',needDoc(()=>insertPdfBtn.click())],['Document','-'],
  ['Document','Header & footer…','',needDoc(headerFooterDialog)],['Document','Page numbers…','',needDoc(pageNumbersDialog)],['Document','Watermark…','',needDoc(watermarkDialog)],['Document','Bookmark this page','',needDoc(()=>addBookmark(false))],['Document','Unflatten…','',needDoc(unflattenDialog)],
  ['Markup','Text','T',tl('text')],['Markup','Callout','C',tl('callout')],['Markup','Line','L',tl('line')],['Markup','Rectangle','R',tl('rect')],['Markup','Ellipse','E',tl('ellipse')],
  ['Markup','Polygon','',tl('polygon')],['Markup','Polyline','',tl('polyline')],['Markup','Revision cloud','',tl('cloud')],['Markup','Highlighter','Shift+H',tl('highlighter')],
  ['Forms','Detect form fields…','',needDoc(detectDialog)],['Forms','-'],
  ['Forms','Checkbox','',tl('checkbox')],['Forms','Radio button','',tl('radio')],['Forms','Dropdown','',tl('dropdown')],['Forms','-'],['Forms','Reset all fields','',needDoc(resetAllFields)],
  ['Measure','Calibrate scale','',tl('scale')],['Measure','Measure length','',tl('measure-length')],['Measure','Measure area','',tl('measure-area')],
  ['Tools','Select / Move','V',tl('select')],['Tools','Pan','H',tl('pan')],['Tools','Select text','X',tl('textselect')],['Tools','-'],
  ['Tools','Insert image…','',needDoc(()=>$('image-btn').click())],['Tools','Signature…','',needDoc(signatureDialog)],
  ['Help','Keyboard shortcuts','',()=>modalAlert('<b>Shortcuts</b><br>V Select · H Pan · X Select text · T Text · C Callout · L Line · R Rectangle · E Ellipse · Shift+H Highlighter<br>Ctrl+O Open · Ctrl+S Save · Ctrl+Shift+S Save as · Ctrl+F Find · Ctrl+P Print · Ctrl+Z Undo · Ctrl+Y Redo · Ctrl+C / Ctrl+V copy / paste a text box · Ctrl+K search commands · Esc cancel the current tool')],
];
const menuPop=$('menu-pop'), cmdPop=$('cmd-pop');
function closeMenus(){ menuPop.classList.remove('show'); cmdPop.classList.remove('show'); document.querySelectorAll('.menu-item').forEach(m=>m.classList.remove('open')); }
function miHTML(c,extra){ return `<div class="mi${c[4]?' off':''}" ${extra||''}><span>${c[1]}</span>${c[4]?'<small>Soon</small>':(c[2]?`<small>${c[2]}</small>`:'')}</div>`; }
function openMenu(btn){
  const items=COMMANDS.filter(c=>c[0]===btn.dataset.menu);
  menuPop.innerHTML=items.map(c=>c[1]==='-'?'<div class="msep"></div>':miHTML(c,`data-i="${COMMANDS.indexOf(c)}"`)).join('');
  const r=btn.getBoundingClientRect(); menuPop.style.left=r.left+'px'; menuPop.style.top=(r.bottom+2)+'px';
  document.querySelectorAll('.menu-item').forEach(m=>m.classList.toggle('open',m===btn)); cmdPop.classList.remove('show'); menuPop.classList.add('show');
}
document.querySelectorAll('.menu-item').forEach(b=>{
  b.addEventListener('click',e=>{ e.stopPropagation(); if(b.classList.contains('open')) closeMenus(); else openMenu(b); });
  b.addEventListener('mouseenter',()=>{ if(menuPop.classList.contains('show')&&!b.classList.contains('open')) openMenu(b); }); });
menuPop.addEventListener('click',e=>{ const mi=e.target.closest('.mi'); if(!mi||!mi.dataset.i) return; const c=COMMANDS[+mi.dataset.i]; closeMenus(); if(c&&c[3]) c[3](); });
document.addEventListener('click',e=>{ if(!e.target.closest('.pop,.search,.menu-item')) closeMenus(); });
// search box
const cmdIn=$('cmd-search'); let cmdHits=[];
function runHit(i){ const c=cmdHits[i]; closeMenus(); cmdIn.value=''; cmdIn.blur(); if(c&&c[3]) c[3](); }
cmdIn.addEventListener('input',()=>{
  const q=cmdIn.value.trim().toLowerCase(); if(!q){ cmdPop.classList.remove('show'); return; }
  cmdHits=COMMANDS.filter(c=>c[1]!=='-'&&(c[0]+' '+c[1]).toLowerCase().includes(q)).slice(0,9);
  cmdPop.innerHTML=cmdHits.length?cmdHits.map((c,i)=>miHTML(c,`data-h="${i}"`).replace('<span>',`<span><span class="grp-l">${c[0]} › </span>`)).join(''):'<div class="mi off"><span>No matching commands</span></div>';
  const r=cmdIn.parentElement.getBoundingClientRect(); cmdPop.style.left=Math.min(r.left,innerWidth-250)+'px'; cmdPop.style.top=(r.bottom+4)+'px';
  menuPop.classList.remove('show'); cmdPop.classList.add('show'); const f=cmdPop.querySelector('.mi:not(.off)'); if(f) f.classList.add('hl'); });
cmdIn.addEventListener('keydown',e=>{
  if(e.key==='Enter'){ const i=cmdHits.findIndex(c=>!c[4]); if(i>=0) runHit(i); }
  else if(e.key==='Escape'){ cmdIn.value=''; closeMenus(); cmdIn.blur(); } });
cmdPop.addEventListener('click',e=>{ const mi=e.target.closest('.mi'); if(mi&&mi.dataset.h!=null) runHit(+mi.dataset.h); });

// ---- keyboard shortcuts
const KEYTOOL={v:'select',h:'pan',x:'textselect',t:'text',c:'callout',l:'line',r:'rect',e:'ellipse'};
document.addEventListener('keydown',e=>{
  if(document.querySelector('.modal-ovl')) return;
  const a=document.activeElement, tag=(a&&a.tagName)||'', typing=isTyping(a), k=e.key.toLowerCase();
  if(e.ctrlKey||e.metaKey){
    if(k==='o'){ e.preventDefault(); platform.open(); }
    else if(k==='s'){ e.preventDefault(); if(pdfDoc&&!downloadBtn.disabled){ if(e.shiftKey) saveActiveDocument({saveAs:true}); else downloadBtn.click(); } }
    else if(k==='p'){ e.preventDefault(); if(!printBtn.disabled) printBtn.click(); }
    else if(k==='k'){ e.preventDefault(); cmdIn.focus(); cmdIn.select(); }
    else if(k==='f'){ e.preventDefault(); openFind(); }
    else if(!typing&&k==='z'&&!e.shiftKey){ e.preventDefault(); doUndo(); }
    else if(!typing&&(k==='y'||(k==='z'&&e.shiftKey))){ e.preventDefault(); doRedo(); }
    return;
  }
  if(typing||e.altKey||!pdfDoc) return;
  if(k==='h'&&e.shiftKey){ setTool('highlighter'); return; }
  if(KEYTOOL[k]&&!e.shiftKey) setTool(KEYTOOL[k]);
});
// ---- the desktop app's open-from-OS and window-close events, and (in a browser) the "leave this page?" warning — see platform.js
platform.wire({ onOpenPaths:paths=>platform.openPaths(paths), onCloseRequested:requestCloseWindow });
