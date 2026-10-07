/* properties.js - The Properties panel, default styles, delete / paste, tool switching and zoom. */
// ---------- Properties panel ----------
function renderProps(){
  propsBody.classList.remove('form'); syncTextSelectionUI();
  if(!selected){ propsBody.innerHTML='<p class="hint">No selection. Switch to Select tool and click a feature.</p>'; return; }
  const obj=selObj();
  if(!obj){ selected=null; propsBody.innerHTML='<p class="hint">No selection.</p>'; return; }
  const pg=selected.page;
  if(extras().length){ renderMultiProps(); return; }
  if(selected.arrName==='images'){ renderImageProps(obj,pg); return; }
  if(selected.arrName==='fields'){ renderFieldProps(obj,pg); return; }
  const isText=selected.arrName==='texts', isShape=selected.arrName==='shapes', isPath=selected.arrName==='paths', isMeasure=selected.arrName==='measurements';
  const isLine=isShape&&obj.type==='line', isLength=isMeasure&&obj.type==='length';
  const isFillableShape=isShape&&obj.type!=='line'&&obj.type!=='polyline';
  let html='';
  if(isText){
    html+=`<label>Font color<input type="color" id="p-textcolor" value="${obj.textColor||obj.color}"></label>`;
    html+=`<label>Font size<input type="number" id="p-size" min="6" max="200" value="${obj.size}"></label>`;
    html+=`<label>Font<select id="p-font">${Object.keys(TEXT_FACES).map(k=>`<option value="${k}"${(obj.fontName||'Helvetica')===k?' selected':''}>${TEXT_FACES[k].label}</option>`).join('')}</select></label>`;
    html+=fmtRowHTML(obj,"fmt-text","Whole box. Select text while typing to format just that part.");
    if(obj.boxW) html+=`<label>Justification<select id="p-align">
      <option value="left"${(!obj.align||obj.align==='left')?' selected':''}>Left</option>
      <option value="center"${obj.align==='center'?' selected':''}>Center</option>
      <option value="right"${obj.align==='right'?' selected':''}>Right</option>${obj.leader?`<option value="auto"${obj.align==='auto'?' selected':''}>Toward leader</option>`:''}</select></label>`;
    html+=`<label>Border thickness (0 = none)<input type="number" id="p-border" min="0" max="20" step="0.5" value="${obj.borderW||0}"></label>`;
    html+=`<label>${obj.leader?'Border / arrow color':'Border color'}<input type="color" id="p-color" value="${obj.color}"></label>`;
  } else {
    html+=`<label>${isMeasure?'Line color':'Color'}<input type="color" id="p-color" value="${obj.color}"></label>`;
  }
  if(isMeasure){
    html+=`<label>Label<input id="p-mlabel" value="${esc(obj.label!=null?obj.label:'')}" placeholder="${esc(measuredValue(obj))}" title="Your own text. {value} inserts the measured value. Empty = the measured value."></label>`;
    html+=`<div class="sub" style="margin:-2px 0 6px">Empty shows the measured value. Tip: double-click the label on the page. <b>{value}</b> inserts the reading.</div>`;
    if(obj.label!=null) html+=`<button id="p-mlabel-reset" style="width:100%;margin-bottom:6px">Use measured value</button>`;
    html+=`<label>Decimal places<input type="number" id="p-mdec" min="0" max="6" value="${obj.decimals!=null?obj.decimals:2}"></label>`;
    html+=fmtRowHTML(obj,"fmt-meas");
    html+=`<label>Font size<input type="number" id="p-size" min="6" max="72" value="${obj.fontSize||11}"></label>`;
    html+=`<label>Font color<input type="color" id="p-textcolor" value="${obj.textColor||obj.color}"></label>`;
  }
  if(isShape||isPath||isMeasure) html+=`<label>Line thickness<input type="number" id="p-w" min="1" max="20" value="${obj.w}"></label>`;
  if(isShape||isMeasure){ // line type (like AutoCAD): the pattern, and a scale that stretches / shrinks it
    const lt=obj.dash||(obj.type==='area'?'dashed':'solid');
    html+=`<label>Line type<select id="p-lt">${LINETYPES.map(([k,t])=>`<option value="${k}"${k===lt?' selected':''}>${t}</option>`).join('')}</select></label>`;
    html+=`<label>Line type scale<input type="number" id="p-ltscale" min="0.1" max="50" step="0.1" value="${obj.ltScale>0?obj.ltScale:1}"${lt==='solid'?' disabled':''}></label>`; }
  if(isShape&&obj.type==='cloud') html+=`<label>Bump size (% of page width)<input type="number" id="p-bump" min="0.3" max="8" step="0.1" value="${((obj.bump!=null?obj.bump:0.012)*100).toFixed(1)}"></label>`;
  if(isLine||isLength||(isText&&obj.leader)) html+=`<label>Arrow size${isLength?' (both ends)':''}<input type="number" id="p-arrow" min="0" max="24" value="${obj.arrowSize!=null?obj.arrowSize:(isLength?8:0)}"></label>`;
  if(isText&&obj.leader) html+=`<label>Leg length (% of page width)<input type="number" id="p-leglen" min="0" max="30" step="1" value="${Math.round((obj.legLength!=null?obj.legLength:0.03)*100)}"></label>`;
  if(isPath) html+=`<label>Opacity<input type="range" id="p-op" min="0.1" max="1" step="0.05" value="${obj.opacity}"></label>`;
  if(isText) html+=`<label style="display:flex;align-items:center;gap:6px;margin-top:12px;"><input type="checkbox" id="p-bg" ${obj.bg?'checked':''} style="width:auto;margin:0;"> Background mask</label>`;
  const opRow=(id,label)=>`<label>${label}<span class="oprow"><input type="range" id="${id}" min="0" max="100" step="1" value="${Math.round(fillAlpha(obj)*100)}"><input type="number" id="${id}n" min="0" max="100" step="1" value="${Math.round(fillAlpha(obj)*100)}"></span></label>`;
  if(isText && obj.bg) html+=`<label>Background color<input type="color" id="p-bgcolor" value="${obj.bgColor||'#ffffff'}"></label>`+opRow('p-bgop','Background opacity (%)');
  if(isFillableShape) html+=`<label style="display:flex;align-items:center;gap:6px;margin-top:12px;"><input type="checkbox" id="p-fillon" ${obj.fill?'checked':''} style="width:auto;margin:0;"> Fill</label>`;
  if(isFillableShape && obj.fill) html+=`<label>Fill color<input type="color" id="p-fillcolor" value="${obj.fillColor||obj.color}"></label>`+opRow('p-fillop','Fill opacity (%)');
  if(isText) html+=`<button id="p-copy" style="margin-top:14px;width:100%">Copy</button>`;
  html+=`<button id="p-setdef" style="margin-top:8px;width:100%">Set as default</button>`;
  html+=`<button id="p-del" class="primary" style="margin-top:8px;width:100%">Delete</button>`;
  propsBody.innerHTML=html;
  sectionProps([['Appearance',['p-color','p-w','p-lt','p-ltscale','p-bump','p-fillon','p-fillcolor','p-fillop','p-op','p-arrow','p-leglen']],['Text',['p-mlabel','p-mlabel-reset','p-mdec','p-textcolor','p-size','p-font','fmt-text','fmt-meas','p-align','p-border','p-bg','p-bgcolor','p-bgop']]]);
  const redraw=()=>{ buildSvg(pg); if(isText) buildTextNodes(pg); if(typeof syncPropbar==='function') syncPropbar(); }; // (the options bar follows the panel)
  const wire=(id,fn,evt='input')=>{ const el=$(id); if(!el) return; let pushed=false;
    el.addEventListener('focus',()=>pushed=false);
    el.addEventListener(evt,()=>{ if(!pushed){ pushHistory(); pushed=true; } fn(el.value); redraw(); }); };
  // Editing the line color first pins the font color to its current value, so changing a
  // border / arrow color never silently recolors the text (and vice-versa).
  wire('p-color', v=>{ if((isText||isMeasure)&&obj.textColor==null) obj.textColor=obj.color; obj.color=v; });
  wire('p-textcolor', v=>obj.textColor=v);
  wire('p-mlabel', v=>{ obj.label=v===''?null:v; scheduleMarkups(); });
  wire('p-mdec', v=>{ const nn=parseInt(v,10); obj.decimals=Math.max(0,Math.min(6,isNaN(nn)?2:nn)); scheduleMarkups(); });
  if($('p-mlabel-reset')) $('p-mlabel-reset').onclick=()=>{ pushHistory(); obj.label=null; redraw(); renderProps(); scheduleMarkups(); };
  wire('p-size', v=>{ const nn=parseFloat(v); if(nn>0){ if(isMeasure) obj.fontSize=nn; else obj.size=nn; } });
  wire('p-align', v=>obj.align=v, 'change');
  wire('p-font', v=>obj.fontName=v, 'change');
  if($("fmt-text")) bindFmtRow("fmt-text",obj,redraw);
  if($("fmt-meas")) bindFmtRow("fmt-meas",obj,redraw);
  wire('p-border', v=>{ const nn=parseFloat(v); obj.borderW=nn>0?nn:0; });
  wire('p-w', v=>obj.w=parseFloat(v)||obj.w);
  wire('p-lt', v=>{ obj.dash=v; const s=$('p-ltscale'); if(s) s.disabled=(v==='solid'); }, 'change');
  wire('p-ltscale', v=>{ const nn=parseFloat(v); obj.ltScale=nn>0?nn:1; });
  wire('p-arrow', v=>obj.arrowSize=parseFloat(v)||0);
  wire('p-leglen', v=>obj.legLength=(parseFloat(v)||0)/100);
  wire('p-op', v=>obj.opacity=parseFloat(v));
  wire('p-bgcolor', v=>obj.bgColor=v);
  [['p-fillop','p-fillopn'],['p-bgop','p-bgopn']].forEach(([rid,nid])=>{ const r=$(rid), nb=$(nid); if(!r) return; let pushed=false; // opacity: a slider and a number box that follow each other
    const apply=n=>{ if(!pushed){ pushHistory(); pushed=true; } obj.fillOpacity=n/100; redraw(); };
    [r,nb].forEach(el=>el.addEventListener('focus',()=>pushed=false)); r.addEventListener('pointerdown',()=>pushed=false);
    r.addEventListener('input',()=>{ nb.value=r.value; apply(+r.value); });
    nb.addEventListener('input',()=>{ const n=parseFloat(nb.value); if(n>=0&&n<=100){ r.value=n; apply(n); } });
    nb.addEventListener('change',()=>{ let n=parseFloat(nb.value); if(isNaN(n)) n=Math.round(fillAlpha(obj)*100); n=Math.min(100,Math.max(0,Math.round(n))); nb.value=n; r.value=n; apply(n); }); });
  wire('p-fillcolor', v=>obj.fillColor=v);
  wire('p-bump', v=>{ const nn=parseFloat(v); obj.bump=(nn>0?nn:1.2)/100; });
  const bgCb=$('p-bg'); if(bgCb) bgCb.addEventListener('change',()=>{ pushHistory(); obj.bg=bgCb.checked; if(obj.bg&&!obj.bgColor) obj.bgColor='#ffffff'; renderAll(); renderProps(); });
  const fillCb=$('p-fillon'); if(fillCb) fillCb.addEventListener('change',()=>{ pushHistory(); obj.fill=fillCb.checked; if(obj.fill&&!obj.fillColor) obj.fillColor=obj.color; buildSvg(pg); renderProps(); });
  if(isText) $('p-copy').onclick=()=>{ clipboard=clone(obj); pasteBtn.disabled=false; };
  $('p-setdef').onclick=()=>setAsDefault(selected.arrName,obj);
  $('p-del').onclick=()=>deleteSelected();
}
function kindOf(arrName,obj){
  if(arrName==='texts') return obj.leader?'callout':'text';
  if(arrName==='shapes') return obj.type;
  if(arrName==='paths') return 'highlighter';
  return null;
}
function setAsDefault(arrName,obj){
  const kind=kindOf(arrName,obj); if(!kind) return;
  colorPick.value=obj.color;
  if(obj.w!=null) widthPick.value=obj.w;
  if(obj.size!=null) sizePick.value=obj.size;
  const extra={};
  if(obj.arrowSize!=null) extra.arrowSize=obj.arrowSize;
  if(obj.align!=null) extra.align=obj.align;
  if(obj.fontName!=null) extra.fontName=obj.fontName; if(obj.bold!=null) extra.bold=obj.bold; if(obj.italic!=null) extra.italic=obj.italic;
  if(obj.bg!=null){ extra.bg=obj.bg; extra.bgColor=obj.bgColor; }
  if(obj.fill!=null){ extra.fill=obj.fill; extra.fillColor=obj.fillColor; }
  if(obj.opacity!=null) extra.opacity=obj.opacity;
  if(obj.fillOpacity!=null) extra.fillOpacity=obj.fillOpacity;
  if(obj.borderW!=null) extra.borderW=obj.borderW;
  if(obj.dash!=null) extra.dash=obj.dash; if(obj.ltScale!=null) extra.ltScale=obj.ltScale;
  if(obj.textColor!=null) extra.textColor=obj.textColor;
  if(obj.legLength!=null) extra.legLength=obj.legLength;
  typeDefaults[kind]=extra; syncSwatch(); toast('Default style saved for '+kind);
}
// Properties for several picked markups: the one thing they share is a colour, plus delete
function multiItems(){ return selected?[{page:selected.page,arrName:selected.arrName,idx:selected.idx}].concat(extras()):[]; }
function renderMultiProps(){
  const items=multiItems(), objs=items.map(x=>(pdr(x.page)[x.arrName]||[])[x.idx]).filter(Boolean), colored=objs.filter(o=>o.color);
  let html=`<p class="hint" style="margin-top:0"><b>${items.length} markups selected</b><br>Shift / Ctrl+click in the Markups list to add or remove one.</p>`;
  if(colored.length) html+=`<label>Color (${colored.length} of them)<input type="color" id="pm-color" value="${colored[0].color}"></label>`;
  html+=`<button id="pm-del" class="primary" style="margin-top:14px;width:100%">Delete ${items.length} markups</button>`;
  propsBody.innerHTML=html;
  const c=$('pm-color'); if(c){ let pushed=false; c.addEventListener('focus',()=>pushed=false);
    c.addEventListener('input',()=>{ if(!pushed){ pushHistory(); pushed=true; } colored.forEach(o=>{ if(o.textColor==null&&(o.leader!==undefined||o.value!==undefined)) o.textColor=o.color; o.color=c.value; }); renderAll(); }); } // (text / measurement colour changes only the line, as in the single-item panel)
  $('pm-del').onclick=()=>deleteSelected();
}
function deleteSelected(){
  if(!selected) return;
  const items=multiItems().filter(x=>{ const a=pd(x.page)[x.arrName]; return a&&a[x.idx]; }); if(!items.length) return;
  pushHistory();
  items.sort((p,q)=>p.page-q.page||(p.arrName<q.arrName?-1:p.arrName>q.arrName?1:0)||q.idx-p.idx); // highest index first so earlier ones keep their place
  items.forEach(x=>pd(x.page)[x.arrName].splice(x.idx,1));
  selected=null; renderAll(); renderProps();
}

function pasteClipboard(){
  if(!clipboard||!pdfDoc) return;
  pushHistory();
  const t=clone(clipboard), n=currentPage;
  t.fx=Math.min(0.92,(t.fx||0)+0.03); t.fy=Math.min(0.92,(t.fy||0)+0.03);
  if(t.leader){ t.leader.x=Math.min(0.95,t.leader.x+0.03); t.leader.y=Math.min(0.95,t.leader.y+0.03); }
  pd(n).texts.push(t);
  selected={page:n,arrName:'texts',idx:pd(n).texts.length-1};
  openProps(); renderAll(); renderProps();
}
pasteBtn.onclick=pasteClipboard;
document.addEventListener('keydown',e=>{
  const active=document.activeElement, tag=(active&&active.tagName)||'';
  const k=e.key.toLowerCase();
  if(k==='escape'){
    if(document.querySelector('.modal-ovl')) return; // dialogs close themselves
    if(pickState){ cancelPick(); e.preventDefault(); return; }
    if(active&&active.blur&&isTyping(active)) active.blur();
    if(tool!=='select'||pendingPoints.length||isDragging){ isDragging=false; setTool('select'); e.preventDefault(); return; } // cancel the current tool
    if(selected) setSelected(null);
    return;
  }
  if(k==='delete'||k==='backspace'){
    if(tag==='INPUT'||tag==='SELECT') return; // let those fields edit normally
    if(k==='delete'&&deleteFromPagesPanel()){ e.preventDefault(); return; } // pages picked in the Pages panel
    if(active&&active.isContentEditable) return; // typing inside a text box: Backspace / Delete only edit its text, never remove the box (an empty form blank is meant to stay). Remove a box with its x button, or press Esc and then Delete.
    if(selected){ deleteSelected(); e.preventDefault(); }
    return;
  }
  if(isTyping(active)) return;
  if(!(e.ctrlKey||e.metaKey)) return;
  if(k==='c' && selected && selected.arrName==='texts'){ const o=selObj(); if(o){ clipboard=clone(o); pasteBtn.disabled=false; e.preventDefault(); } }
  else if(k==='v'){ pasteClipboard(); e.preventDefault(); }
});

function setTool(newTool){
  if(pickState) cancelPick();
  tool=newTool; clearPending(true); updateToolButtons();
  selected=null; rebuildAllSvg(); renderProps(); // interactivity of existing shapes depends on the tool
}
function updateToolButtons(){
  document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active', b.dataset.tool===tool));
  $('tool-name').textContent=TOOL_TITLES[tool]||(tool==='areapick'?'Select area':'');
  document.body.classList.toggle('pan',tool==='pan');
  document.body.classList.toggle('drawing',tool!=='select'&&tool!=='pan'&&tool!=='textselect'); // (touch: fingers draw instead of scroll)
  document.body.classList.toggle('textsel',tool==='textselect'); // the text layer takes the mouse; markups let it through
}
function setToolButtonsDisabled(v){ document.querySelectorAll('.tool,.rib-btn,#scale-select').forEach(b=>b.disabled=v); }
setToolButtonsDisabled(true);
undoBtn.onclick=doUndo; redoBtn.onclick=doRedo;
prevBtn.onclick=()=>{ if(currentPage>1) goToPage(currentPage-1); };
nextBtn.onclick=()=>{ if(currentPage<numPages) goToPage(currentPage+1); };
// Zooming keeps one spot steady: the middle of the selected markup (which ends up in the middle of the window), or with nothing selected the
// same spot of the same page, the one in the middle of the window.
// opts.pageTop: keep the top of the current page in view instead (the Fit buttons). opts.view: ignore the selection (pinch zoom on a touch screen).
function selectionCenter(){ // {page, x, y} as fractions of the page, or null
  const o=selected&&selObj(); if(!o) return null; const a=selected.arrName; let x,y;
  if(a==='texts'){ x=o.fx+(o.boxW||0)/2; y=o.fy+(o.boxH||0)/2; }
  else if(o.points&&o.points.length){ const b=bbox(o.points); x=(b.x1+b.x2)/2; y=(b.y1+b.y2)/2; }
  else if(o.x1!=null){ x=(o.x1+o.x2)/2; y=(o.y1+o.y2)/2; }
  else return null;
  return {page:selected.page,x,y};
}
function zoomFocus(opts){
  if(opts&&opts.pageTop) return {top:captureScrollAnchor()};
  const mr=main.getBoundingClientRect(), c=!(opts&&opts.view)&&selectionCenter(), cv=c&&pageViews[c.page-1];
  if(cv&&cv.stage.offsetParent!==null) return {page:c.page,x:c.x,y:c.y,sx:mr.width/2,sy:mr.height/2};
  const v=pageViews[currentPage-1]; if(!v) return null;
  const r=v.stage.getBoundingClientRect(), cl=n=>Math.min(1,Math.max(0,n)), x=cl((mr.left+mr.width/2-r.left)/v.w), y=cl((mr.top+mr.height/2-r.top)/v.h);
  return {page:currentPage,x,y,sx:r.left+x*v.w-mr.left,sy:r.top+y*v.h-mr.top};
}
function applyZoomFocus(f){
  if(!f) return; if(f.top){ restoreScrollAnchor(f.top); return; }
  const v=pageViews[f.page-1]; if(!v) return;
  const mr=main.getBoundingClientRect(), r=v.stage.getBoundingClientRect();
  main.scrollLeft+=(r.left+f.x*v.w-mr.left)-f.sx; main.scrollTop+=(r.top+f.y*v.h-mr.top)-f.sy;
}
async function setZoom(s,opts){
  const ns=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,s)); if(ns===scale||!pdfDoc) return;
  const focus=zoomFocus(opts);
  scale=ns; syncZoomUI();
  const ok=await layoutPages(); if(!ok) return;
  renderAll(); renderProps(); applyZoomFocus(focus);
}
zoomInBtn.onclick=()=>setZoom(scale+0.25);
zoomOutBtn.onclick=()=>setZoom(scale-0.25);

// ---- text style toggles (bold, italic, strikethrough, superscript, subscript) shared by text boxes, measurement labels and dropdown fields
const FMT_BTNS=[['bold','<b>B</b>','Bold'],['italic','<i>I</i>','Italic'],['strike','<s>S</s>','Strikethrough'],['sup','x<sup>2</sup>','Superscript'],['sub','x<sub>2</sub>','Subscript']];
function fmtRowHTML(o,id,hint){ // the first button carries the id (sectionProps files the row under its section by it)
  return `<div class="fmt-wrap"><div class="fmt-row">${FMT_BTNS.map(([k,h,t],i)=>`<button type="button" class="fmt${o[k]?' on':''}" data-k="${k}" title="${t}"${i?'':` id="${id}"`}>${h}</button>`).join('')}</div>${hint?`<div class="sub" style="margin-top:4px">${hint}</div>`:''}</div>`;
}
function bindFmtRow(id,o,onChange){
  const row=$(id).parentElement;
  row.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    pushHistory(); const k=b.dataset.k; o[k]=!o[k]; if(o[k]&&k==='sup') o.sub=false; if(o[k]&&k==='sub') o.sup=false;
    row.querySelectorAll('button').forEach(x=>x.classList.toggle('on',!!o[x.dataset.k])); onChange(); });
}
