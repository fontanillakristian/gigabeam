/* propbar.js - The options bar under the toolbar (like Bluebeam's markup bar).
   It follows the selection, live, both ways:
   - a markup is selected: the bar shows ITS color, line thickness, line type, font, size, bold / italic and fill, and editing them changes the markup at once
     (the Properties panel updates too, and an edit in the panel shows here);
   - nothing selected: the bar sets the style of the NEXT markup. Color, line thickness and text size live in the hidden inputs color-pick / width-pick /
     size-pick (read by tools.js); line type, font, bold / italic and fill are kept per tool in typeDefaults.
   Line thickness and size are "combo" boxes: type any number, or pick one from the list. */
const PB_WIDTHS=[0.5,1,1.5,2,3,4,6,8,10,12,16,20], PB_SIZES=[6,7,8,9,10,11,12,14,16,18,20,24,28,32,36,48,72,96];
const PB_LT_TOOLS=new Set(['line','rect','ellipse','polygon','polyline','cloud']), PB_FILL_TOOLS=new Set(['rect','ellipse','polygon','cloud']), PB_TEXT_TOOLS=new Set(['text','callout']);
const pbBar=$('propbar'), pbColor=$('pb-color'), pbW=$('pb-w'), pbSize=$('pb-size'), pbLt=$('pb-lt'), pbFont=$('pb-font'), pbFillOn=$('pb-fillon'), pbFillColor=$('pb-fillcolor'), pbNote=$('pb-note');
pbLt.innerHTML=LINETYPES.map(([k,t])=>`<option value="${k}">${t.replace(/ \(.*/,'')}</option>`).join('');
pbFont.innerHTML=Object.keys(TEXT_FACES).map(k=>`<option value="${k}">${TEXT_FACES[k].label.replace(/ \(.*/,'')}</option>`).join('');
const pbField=n=>pbBar.querySelector(`.field[data-f="${n}"]`);

// ---- what the bar is showing: a markup, several, something that has no bar controls (images, form fields), or the defaults for new markups
function pbModel(){
  if(extras().length) return {mode:'multi'};
  const o=selected&&selObj();
  if(!o) return {mode:'default'};
  if(selected.arrName==='images'||selected.arrName==='fields') return {mode:'other'};
  return {mode:'obj',o,a:selected.arrName};
}
const pbTd=()=>typeDefaults[tool]||(typeDefaults[tool]={}); // the saved style for new markups of the active tool

// ---- show the current values (never touching a box the person is typing in)
function pbSet(el,v){ if(document.activeElement!==el) el.value=v; }
function syncPropbar(){
  const m=pbModel(), show={}, val={};
  const fmt={bold:false,italic:false}; let label={color:'Color',line:'Line',size:'Size',fill:'Fill'}, note='';
  if(m.mode==='obj'){
    const o=m.o, isText=m.a==='texts', isShape=m.a==='shapes', isMeasure=m.a==='measurements', t=o.type;
    show.color=1; show.line=1;
    val.color=isText?(o.textColor||o.color):o.color; val.line=isText?(o.borderW||0):o.w;
    if(isText){ label.color='Font'; label.line='Border'; show.font=1; show.size=1; show.fmt=1; show.fill=1; label.fill='Fill';
      val.font=o.fontName||'Helvetica'; val.size=o.size; fmt.bold=!!o.bold; fmt.italic=!!o.italic; val.fillOn=!!o.bg; val.fillColor=o.bgColor||'#ffffff'; }
    if(isShape||isMeasure) { show.lt=1; val.lt=o.dash||(t==='area'?'dashed':'solid'); }
    if(isMeasure){ show.size=1; show.fmt=1; val.size=o.fontSize||11; fmt.bold=!!o.bold; fmt.italic=!!o.italic; }
    if(isShape&&t!=='line'&&t!=='polyline'){ show.fill=1; val.fillOn=!!o.fill; val.fillColor=o.fillColor||o.color; }
  }else if(m.mode==='default'){
    show.color=1; show.line=1; show.size=1;
    val.color=colorPick.value; val.line=widthPick.value; val.size=sizePick.value;
    const td=typeDefaults[tool]||{};
    if(PB_LT_TOOLS.has(tool)){ show.lt=1; val.lt=td.dash||'solid'; }
    if(PB_TEXT_TOOLS.has(tool)){ show.font=1; show.fmt=1; show.fill=1; val.font=td.fontName||'Helvetica'; fmt.bold=!!td.bold; fmt.italic=!!td.italic; val.fillOn=!!td.bg; val.fillColor=td.bgColor||'#ffffff'; }
    if(PB_FILL_TOOLS.has(tool)){ show.fill=1; val.fillOn=!!td.fill; val.fillColor=td.fillColor||colorPick.value; }
  }else if(m.mode==='multi'){
    const objs=multiItems().map(x=>(pdr(x.page)[x.arrName]||[])[x.idx]).filter(o=>o&&o.color);
    if(objs.length){ show.color=1; val.color=objs[0].color; }
    note=multiItems().length+' markups selected (change the color here)';
  }else note='Edit this one in Properties';
  ['color','line','lt','font','size','fmt','fill'].forEach(n=>{ pbField(n).hidden=!show[n]; });
  pbNote.hidden=!note; pbNote.textContent=note;
  $('pb-color-l').textContent=label.color; $('pb-line-l').textContent=label.line; $('pb-size-l').textContent=label.size; $('pb-fill-l').textContent=label.fill;
  if(show.color){ pbSet(pbColor,val.color); $('color-swatch').querySelector('i').style.background=val.color; }
  if(show.line) pbSet(pbW,val.line!=null?+(+val.line).toFixed(2):''); if(show.size) pbSet(pbSize,val.size!=null?+(+val.size).toFixed(2):'');
  if(show.lt) pbLt.value=val.lt; if(show.font) pbFont.value=val.font;
  if(show.fmt) pbBar.querySelectorAll('.pbfmt button').forEach(b=>b.classList.toggle('on',!!fmt[b.dataset.k]));
  if(show.fill){ pbFillOn.checked=!!val.fillOn; pbFillColor.value=val.fillColor; }
  document.body.classList.toggle('has-sel',m.mode==='obj'||m.mode==='multi'); // (phone layout: show the bar while something is selected)
}
syncSwatch=function(){ syncPropbar(); }; // (a default style changed elsewhere, e.g. "Set as default")
{ const rp=renderProps; renderProps=function(){ const r=rp.apply(this,arguments); try{ syncPropbar(); }catch(e){ console.error(e); } return r; }; } // (every selection or edit already refreshes the Properties panel)

// ---- editing: a selected markup changes at once (one undo step per burst of edits); with nothing selected the defaults change
let pbPushed=false, pbRaf=0, pbKey='';
pbBar.addEventListener('pointerdown',()=>{ pbPushed=false; },true); pbBar.addEventListener('focusin',()=>{ pbPushed=false; });
function pbAfter(){ if(pbRaf) return; pbRaf=requestAnimationFrame(()=>{ pbRaf=0; renderProps(); }); } // refresh the panel and this bar
function pbEdit(fn){
  const m=pbModel();
  if(m.mode==='default'){ fn(null,null,true); pbAfter(); return; }
  if(m.mode!=='obj') return;
  const key=selected.page+':'+selected.arrName+':'+selected.idx; if(key!==pbKey){ pbKey=key; pbPushed=false; }
  if(!pbPushed){ pushHistory(); pbPushed=true; }
  fn(m.o,m.a,false);
  const pg=selected.page; buildSvg(pg); if(m.a==='texts') buildTextNodes(pg); 
  if(typeof scheduleMarkups==='function') scheduleMarkups();
  pbAfter();
}
// color
pbColor.addEventListener('input',()=>{ const v=pbColor.value, m=pbModel();
  if(m.mode==='multi'){ if(!pbPushed){ pushHistory(); pbPushed=true; } multiItems().forEach(x=>{ const o=(pdr(x.page)[x.arrName]||[])[x.idx]; if(o&&o.color){ if(o.textColor==null&&(o.leader!==undefined||o.value!==undefined)) o.textColor=o.color; o.color=v; } }); renderAll(); pbAfter(); return; }
  pbEdit((o,a,def)=>{ if(def) colorPick.value=v; else if(a==='texts') o.textColor=v; else{ if(a==='measurements'&&o.textColor==null) o.textColor=o.color; o.color=v; } }); });
$('color-swatch').onclick=()=>pbColor.click();
// line thickness and size: type a number or pick one
function pbNumber(input,list,min,max,step,apply){
  const ok=n=>n>=min&&n<=max, set=n=>{ n=Math.min(max,Math.max(min,+(+n).toFixed(2))); input.value=n; apply(n); };
  input.addEventListener('input',()=>{ const n=parseFloat(input.value); if(ok(n)) apply(n); }); // (while typing, only values that make sense are applied)
  input.addEventListener('change',()=>{ const n=parseFloat(input.value); if(isNaN(n)){ input.blur(); syncPropbar(); return; } set(n); }); // (not a number: put the real value back)
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){ e.preventDefault(); set((parseFloat(input.value)||min)+(e.key==='ArrowUp'?step:-step)); }
    else if(e.key==='Enter'){ input.blur(); } });
  input.parentElement.querySelector('.cb').addEventListener('click',()=>pbOpenList(input,list,n=>{ pbPushed=false; set(n); }));
}
const pbList=document.createElement('div'); pbList.className='pop combo-pop'; document.body.appendChild(pbList); let pbListPick=null;
function pbOpenList(input,list,pick){
  if(pbList.classList.contains('show')&&pbList._for===input){ pbList.classList.remove('show'); return; }
  const r=input.parentElement.getBoundingClientRect(), cur=parseFloat(input.value);
  pbList.innerHTML=list.map(n=>`<div class="mi${n===cur?' hl':''}" data-v="${n}"><span>${n}</span></div>`).join('');
  pbList.style.left=r.left+'px'; pbList.style.top=(r.bottom+2)+'px'; pbList.style.minWidth=r.width+'px'; pbList.classList.add('show'); pbList._for=input; pbListPick=pick;
  const hl=pbList.querySelector('.hl'); if(hl) hl.scrollIntoView({block:'nearest'});
}
pbList.addEventListener('click',e=>{ const mi=e.target.closest('.mi'); if(!mi||!pbListPick) return; pbList.classList.remove('show'); pbListPick(+mi.dataset.v); });
document.addEventListener('pointerdown',e=>{ if(!e.target.closest('.combo,.combo-pop')) pbList.classList.remove('show'); },true);
pbBar.addEventListener('scroll',()=>pbList.classList.remove('show'),{passive:true});
pbNumber(pbW,PB_WIDTHS,0,40,0.5,n=>pbEdit((o,a,def)=>{ if(def) widthPick.value=n||2; else if(a==='texts') o.borderW=n>0?n:0; else if(n>0) o.w=n; }));
pbNumber(pbSize,PB_SIZES,2,400,1,n=>pbEdit((o,a,def)=>{ if(n<=0) return; if(def) sizePick.value=n; else if(a==='measurements') o.fontSize=n; else o.size=n; }));
// line type, font, bold / italic, fill
pbLt.addEventListener('change',()=>pbEdit((o,a,def)=>{ (def?pbTd():o).dash=pbLt.value; }));
pbFont.addEventListener('change',()=>pbEdit((o,a,def)=>{ (def?pbTd():o).fontName=pbFont.value; }));
pbBar.querySelectorAll('.pbfmt button').forEach(b=>b.addEventListener('click',()=>pbEdit((o,a,def)=>{
  const t=def?pbTd():o, k=b.dataset.k; t[k]=!t[k]; })));
pbFillOn.addEventListener('change',()=>pbEdit((o,a,def)=>{ const t=def?pbTd():o, text=def?PB_TEXT_TOOLS.has(tool):a==='texts', on=pbFillOn.checked;
  if(text){ t.bg=on; if(on&&!t.bgColor) t.bgColor=pbFillColor.value||'#ffffff'; }
  else{ t.fill=on; if(on&&!t.fillColor) t.fillColor=def?colorPick.value:o.color; } }));
pbFillColor.addEventListener('input',()=>pbEdit((o,a,def)=>{ const t=def?pbTd():o, text=def?PB_TEXT_TOOLS.has(tool):a==='texts', v=pbFillColor.value;
  if(text){ t.bg=true; t.bgColor=v; } else{ t.fill=true; t.fillColor=v; } }));
