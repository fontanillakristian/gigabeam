/* markups-list.js - The Markups list panel (a read-only view over the annotations). */
// ---- markups list (read-only view over `annotations`)
const MK_ICON={text:'i-text',callout:'i-callout',line:'i-line',rect:'i-rect',ellipse:'i-ellipse',polygon:'i-polygon',polyline:'i-polyline',cloud:'i-cloud',highlighter:'i-highlighter',length:'i-length',area:'i-area',image:'i-image',signature:'i-sign',checkbox:'i-checkbox',radio:'i-radio',dropdown:'i-dropdown'};
const MK_LABEL={text:'Text box',callout:'Callout',line:'Line',rect:'Rectangle',ellipse:'Ellipse',polygon:'Polygon',polyline:'Polyline',cloud:'Revision cloud',highlighter:'Highlighter',length:'Length',area:'Area',image:'Image',signature:'Signature',checkbox:'Checkbox',radio:'Radio button',dropdown:'Dropdown'};
function mkInfo(arr,o){
  if(arr==='texts') return {k:o.leader?'callout':'text',name:(o.text||'').trim().split('\n')[0]||(o.leader?'Callout':'Text')};
  if(arr==='shapes') return {k:o.type,name:MK_LABEL[o.type]};
  if(arr==='paths') return {k:'highlighter',name:'Highlighter'};
  if(arr==='measurements') return {k:o.type,name:o.value.toFixed(2)+' '+o.unit};
  if(arr==='fields') return {k:o.type,name:o.type==='radio'?`${o.name} · ${o.exportValue}`:o.name};
  const sig=o.kind==='signature'; return {k:sig?'signature':'image',name:o.name||(sig?'Signature':'Image')};
}
// Click a row to select it; Shift+click picks the range from the last row you clicked, Ctrl/Cmd+click adds or removes one.
let mkRows=[], mkAnchor=null;
const sameItem=(a,b)=>a&&b&&a.page===b.page&&a.arrName===b.arrName&&a.idx===b.idx;
function mkRowClick(e,me){
  if(tool!=='select') setTool('select');
  if(e.shiftKey&&mkAnchor){
    const a=mkRows.findIndex(x=>sameItem(x,mkAnchor)), b=mkRows.findIndex(x=>sameItem(x,me));
    if(a>=0&&b>=0){ setMultiSelection(mkRows.slice(Math.min(a,b),Math.max(a,b)+1),me); goToPage(me.page); openProps(); return; }
  }
  if(e.ctrlKey||e.metaKey){
    let cur=multiItems(); const at=cur.findIndex(x=>sameItem(x,me));
    if(at>=0) cur.splice(at,1); else cur.push(me);
    mkAnchor=me; setMultiSelection(cur,cur.some(x=>sameItem(x,me))?me:cur[cur.length-1]); openProps(); return;
  }
  mkAnchor=me; goToPage(me.page); setSelected(me); openProps();
}
function refreshMarkups(){
  const host=$('mk-list'); host.innerHTML=''; let count=0; mkRows=[];
  Object.keys(annotations).map(Number).sort((a,b)=>a-b).forEach(n=>{
    const d=annotations[n], rows=[];
    ['texts','shapes','paths','measurements','images','fields'].forEach(arr=>(d[arr]||[]).forEach((o,idx)=>rows.push({arr,o,idx})));
    if(!rows.length) return;
    const h=document.createElement('div'); h.className='mk-page'; h.textContent='Page '+n; host.appendChild(h);
    rows.forEach(({arr,o,idx})=>{ count++;
      const inf=mkInfo(arr,o), r=document.createElement('div'); r.className='mk-row'+(isSel(n,arr,idx)||isMulti(n,arr,idx)?' on':''); mkRows.push({page:n,arrName:arr,idx});
      r.innerHTML=`<svg class="i sm ic"><use href="#${MK_ICON[inf.k]||'i-rect'}"/></svg><div class="t"><b></b><small>${MK_LABEL[inf.k]||''}</small></div>`+(o.color?'<span class="cl"></span>':'');
      r.querySelector('b').textContent=inf.name; if(o.color) r.querySelector('.cl').style.background=o.color;
      r.onclick=e=>mkRowClick(e,{page:n,arrName:arr,idx});
      host.appendChild(r); });
  });
  if(!count) host.innerHTML='<div class="soon-note">'+(pdfDoc?'No markups yet.<br>Draw something and it will be listed here.':'Open a PDF to see its markups.')+'</div>';
}
let mkPending=false;
function scheduleMarkups(){ if(mkPending||leftView!=='markups'||pagesPanel.classList.contains('hidden')) return; mkPending=true; requestAnimationFrame(()=>{ mkPending=false; refreshMarkups(); }); }
{ const rp=renderProps, ra=renderAll; renderProps=function(){ rp.apply(this,arguments); scheduleMarkups(); }; renderAll=function(){ ra.apply(this,arguments); scheduleMarkups(); }; }
