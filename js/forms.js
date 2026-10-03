/* forms.js - Form fields (checkbox, radio, dropdown): placing, filling in, Properties tabs and AcroForm export. Also the sectioned Properties layout used by all object types. */
// ---- Properties panel: regroup the engine's plain field list into a header + sections + action buttons
function sectionProps(groups){
  const o=selObj(); if(!o) return;
  const inf=mkInfo(selected.arrName,o), nodes=Array.from(propsBody.children);
  const head=document.createElement('div'); head.className='fp-head';
  head.innerHTML=`<span class="ic"><svg class="i"><use href="#${MK_ICON[inf.k]||'i-rect'}"/></svg></span><div><b>${MK_LABEL[inf.k]||'Markup'}</b><small>Page ${selected.page}</small></div>`;
  const secs=groups.map(([t])=>{ const s=document.createElement('div'); s.className='fp-sec'; s.innerHTML=`<h5>${t}</h5>`; return s; }), acts=document.createElement('div'); acts.className='fp-actions';
  nodes.forEach(nd=>{ const el=nd.matches('input,select,button')?nd:nd.querySelector('input,select,button'), id=(el&&el.id)||'';
    if(id==='p-copy'||id==='p-setdef'||id==='p-del'){ acts.appendChild(nd); return; }
    let gi=groups.findIndex(g=>g[1].includes(id)); if(gi<0) gi=0; secs[gi].appendChild(nd); });
  propsBody.innerHTML=''; propsBody.classList.add('form'); propsBody.appendChild(head);
  secs.forEach(s=>{ if(s.querySelector('label,p')) propsBody.appendChild(s); }); propsBody.appendChild(acts);
}

// ---- form fields: checkbox / radio button / dropdown (real AcroForm fields in the saved PDF)
const FORM_TOOLS=['checkbox','radio','dropdown'];
const FIELD_LABEL={checkbox:'Checkbox',radio:'Radio button',dropdown:'Dropdown'};
const FIELD_STYLE_KEYS=['visibility','orient','readOnly','required','border','borderColor','fill','fillColor','thickness','style','font','fontSize','textColor','checkStyle'];
const FIELD_CSS_FONT={Helvetica:'Helvetica, Arial, sans-serif',Times:'"Times New Roman", Times, serif',Courier:'"Courier New", Courier, monospace'};
const fieldDefaults={};
let lastRadioGroup=null; // consecutive radio buttons join one group until you switch tools
{ const st=setTool; setTool=function(t){ if(t!=='radio') lastRadioGroup=null; return st.apply(this,arguments); }; }
const FIELD_BASE=()=>({tooltip:'',visibility:'visible',orient:0,readOnly:false,required:false,locked:false,border:true,borderColor:'#2f5da8',fill:true,fillColor:'#eaf2ff',thickness:1,style:'solid',font:'Helvetica',fontSize:0,textColor:'#1a1a1a'});
function allFields(){ const out=[]; Object.keys(annotations).forEach(k=>(annotations[k].fields||[]).forEach(f=>out.push(f))); return out; }
// Every field has a DEFAULT (set in Properties: "Checked by default" / "Default value") and a CURRENT value (what you fill in on the page).
function normalizeField(f){ if(f.defChecked===undefined) f.defChecked=!!f.checked; if(f.type==='dropdown'&&f.defValue===undefined) f.defValue=f.value||''; return f; } // files saved before defaults existed
function resetField(f){
  if(f.type==='radio') allFields().forEach(o=>{ if(o.type==='radio'&&o.name===f.name) o.checked=!!o.defChecked; }); // a group resets as a whole
  else if(f.type==='checkbox') f.checked=!!f.defChecked;
  else f.value=f.defValue||'';
}
async function resetAllFields(){
  if(!allFields().length){ toast('No form fields to reset'); return; }
  if(!await modalConfirm('Reset all form fields to their default values? Anything filled in will be cleared (Undo brings it back).')) return;
  pushHistory(); allFields().forEach(resetField); renderAll(); renderProps(); toast('Form fields reset to their defaults');
}
$('reset-fields-btn').onclick=resetAllFields;
// radio groups are numbered in document order (G1, G2 …) — shown as a tag on the selected button
function radioGroupNo(name){ const names=[]; allFields().forEach(f=>{ if(f.type==='radio'&&!names.includes(f.name)) names.push(f.name); }); return names.indexOf(name)+1; }
// the "+" under a selected radio button: another button in the same group, same look, placed just below (or beside if there's no room)
function addRadioToGroup(n,idx,newGroup){ // newGroup: start a different group instead (its first button; radio buttons drawn next join it)
  const src=pd(n).fields[idx], v=pageViews[n-1]; if(!src||!v) return;
  const grp=newGroup?uniqueFieldName('RadioGroup'):src.name;
  const w=Math.abs(src.x2-src.x1), h=Math.abs(src.y2-src.y1), gap=6/v.ptsH, x=Math.min(src.x1,src.x2), y=Math.max(src.y1,src.y2)+gap;
  let nx=x, ny=y; if(ny+h>1){ nx=Math.min(1-w,x+w+6/v.ptsW); ny=Math.min(src.y1,src.y2); }
  const f=Object.assign(clone(src),{name:grp,x1:nx,y1:ny,x2:nx+w,y2:ny+h,checked:false,defChecked:false,exportValue:'Choice'+(allFields().filter(o=>o.type==='radio'&&o.name===grp).length+1)});
  pushHistory(); pd(n).fields.push(f); lastRadioGroup=grp; if(newGroup) toast('New radio group started: '+grp);
  selected={page:n,arrName:'fields',idx:pd(n).fields.length-1}; renderAll(); renderProps();
}
function uniqueFieldName(base){ const names=new Set(allFields().map(f=>f.name)); let i=1; while(names.has(base+i)) i++; return base+i; }
function addField(type,p1,p2){
  const v=V(), n=drawPage, d=pd(n), dw=type==='dropdown'?150:16, dh=type==='dropdown'?22:16;
  let x1=Math.min(p1.x,p2.x), y1=Math.min(p1.y,p2.y), w=Math.abs(p2.x-p1.x), h=Math.abs(p2.y-p1.y);
  if(w*v.ptsW<8||h*v.ptsH<8){ w=dw/v.ptsW; h=dh/v.ptsH; } // a plain click drops a default-size field
  else if(type!=='dropdown'){ const s=Math.min(w*v.ptsW,h*v.ptsH); w=s/v.ptsW; h=s/v.ptsH; } // checkbox / radio stay square
  x1=Math.max(0,Math.min(x1,1-w)); y1=Math.max(0,Math.min(y1,1-h));
  const f=Object.assign(FIELD_BASE(),{type,x1,y1,x2:x1+w,y2:y1+h},clone(fieldDefaults[type]||{}));
  if(type==='checkbox') Object.assign(f,{name:uniqueFieldName('Checkbox'),checkStyle:f.checkStyle||'check',exportValue:'Yes',checked:false,defChecked:false});
  else if(type==='radio'){ const grp=lastRadioGroup||uniqueFieldName('RadioGroup'); lastRadioGroup=grp;
    Object.assign(f,{name:grp,checkStyle:f.checkStyle||'circle',exportValue:'Choice'+(allFields().filter(x=>x.type==='radio'&&x.name===grp).length+1),checked:false,defChecked:false,unison:false}); }
  else Object.assign(f,{name:uniqueFieldName('Dropdown'),items:['Option 1','Option 2','Option 3'],value:'',defValue:'',allowCustom:false,sort:false,commit:true});
  pushHistory(); d.fields.push(f);
  selected={page:n,arrName:'fields',idx:d.fields.length-1}; openProps();
}
// unit-square shapes for the mark inside a checked box / radio button (y grows downward)
function markCmds(style){
  switch(style){
    case 'cross': return {mode:'stroke',c:[['M',.27,.27],['L',.73,.73],['M',.73,.27],['L',.27,.73]]};
    case 'diamond': return {mode:'fill',c:[['M',.5,.14],['L',.86,.5],['L',.5,.86],['L',.14,.5],['Z']]};
    case 'square': return {mode:'fill',c:[['M',.26,.26],['L',.74,.26],['L',.74,.74],['L',.26,.74],['Z']]};
    case 'star': { const p=[]; for(let i=0;i<10;i++){ const r=i%2?0.19:0.42, a=-Math.PI/2+i*Math.PI/5; p.push([.5+r*Math.cos(a),.5+r*Math.sin(a)]); } return {mode:'fill',c:[['M',...p[0]],...p.slice(1).map(q=>['L',...q]),['Z']]}; }
    case 'circle': { const r=.27, k=.5523*r; return {mode:'fill',c:[['M',.5+r,.5],['C',.5+r,.5+k,.5+k,.5+r,.5,.5+r],['C',.5-k,.5+r,.5-r,.5+k,.5-r,.5],['C',.5-r,.5-k,.5-k,.5-r,.5,.5-r],['C',.5+k,.5-r,.5+r,.5-k,.5+r,.5],['Z']]}; }
    default: return {mode:'stroke',c:[['M',.2,.55],['L',.42,.77],['L',.8,.25]]};
  }
}
function cmdsToSvg(cs,x,y,w,h){ const X=u=>(x+u*w).toFixed(2), Y=u=>(y+u*h).toFixed(2);
  return cs.map(c=>c[0]==='Z'?'Z':c[0]+(c.length===3?`${X(c[1])},${Y(c[2])}`:`${X(c[1])},${Y(c[2])} ${X(c[3])},${Y(c[4])} ${X(c[5])},${Y(c[6])}`)).join(' '); }
function fieldFontPx(f,h,k){ return f.fontSize>0?f.fontSize*k:Math.min(h*0.62,14*k); }
function fieldNode(f,W,H){
  const g=svgEl('g',{}); g.style.pointerEvents='none'; if(/^hidden/.test(f.visibility)) g.style.opacity=.35;
  const x=Math.min(f.x1,f.x2)*W, y=Math.min(f.y1,f.y2)*H, w=Math.abs(f.x2-f.x1)*W, h=Math.abs(f.y2-f.y1)*H, k=scale, t=f.border?f.thickness*k:0, round=f.type==='radio';
  const shape=a=>round?svgEl('ellipse',Object.assign({cx:x+w/2,cy:y+h/2,rx:Math.max(0,w/2-t/2),ry:Math.max(0,h/2-t/2)},a)):svgEl('rect',Object.assign({x:x+t/2,y:y+t/2,width:Math.max(0,w-t),height:Math.max(0,h-t)},a));
  if(f.style==='underline'&&!round){
    if(f.fill) g.appendChild(svgEl('rect',{x,y,width:w,height:h,fill:f.fillColor}));
    if(f.border) g.appendChild(svgEl('line',{x1:x,y1:y+h-t/2,x2:x+w,y2:y+h-t/2,stroke:f.borderColor,'stroke-width':t}));
  } else {
    const a={fill:f.fill?f.fillColor:'none',stroke:f.border?f.borderColor:'none','stroke-width':t}; if(f.style==='dashed') a['stroke-dasharray']=`${3*k},${3*k}`;
    g.appendChild(shape(a));
    if((f.style==='beveled'||f.style==='inset')&&f.border&&!round){ const c1=f.style==='beveled'?'#ffffff':'#7a7a7a', c2=f.style==='beveled'?'#7a7a7a':'#ffffff';
      g.appendChild(svgEl('polyline',{points:`${x+t*1.5},${y+h-t*1.5} ${x+t*1.5},${y+t*1.5} ${x+w-t*1.5},${y+t*1.5}`,fill:'none',stroke:c1,'stroke-width':t}));
      g.appendChild(svgEl('polyline',{points:`${x+w-t*1.5},${y+t*2.5} ${x+w-t*1.5},${y+h-t*1.5} ${x+t*2.5},${y+h-t*1.5}`,fill:'none',stroke:c2,'stroke-width':t})); }
  }
  if(f.type==='dropdown'){
    const fs=fieldFontPx(f,h,k), inner=svgEl('svg',{x,y,width:w,height:h,overflow:'hidden'}), tx=svgEl('text',{x:t+3*k,y:h/2,'dominant-baseline':'central','font-size':fs,fill:f.textColor,'font-family':FIELD_CSS_FONT[f.font]||FIELD_CSS_FONT.Helvetica});
    tx.textContent=f.value||''; inner.appendChild(tx); g.appendChild(inner);
    const ax=x+w-Math.min(h*0.7,16*k)-t, ay=y+h/2; g.appendChild(svgEl('polyline',{points:`${ax},${ay-2*k} ${ax+4*k},${ay+2*k} ${ax+8*k},${ay-2*k}`,fill:'none',stroke:f.border?f.borderColor:'#666','stroke-width':1.4,'stroke-linecap':'round','stroke-linejoin':'round'}));
  } else if(f.checked){
    const m=markCmds(f.checkStyle);
    g.appendChild(svgEl('path',{d:cmdsToSvg(m.c,x,y,w,h),fill:m.mode==='fill'?f.textColor:'none',stroke:f.textColor,'stroke-width':m.mode==='stroke'?Math.max(1.4,Math.min(w,h)*0.1):0.5,'stroke-linecap':'round','stroke-linejoin':'round'}));
  }
  return g;
}
// Filling a field in: checkbox toggles, radio selects (and clears the rest of its group), dropdown opens its list.
let fieldPop=null;
function closeFieldPop(){ if(fieldPop){ fieldPop.remove(); fieldPop=null; document.removeEventListener('mousedown',fieldPopAway,true); } }
function fieldPopAway(e){ if(fieldPop&&!fieldPop.contains(e.target)) closeFieldPop(); }
function activateField(n,idx,ev){
  const f=pd(n).fields[idx], v=pageViews[n-1]; if(!f||!v) return;
  closeFieldPop();
  if(f.readOnly){ toast('This field is read only'); return; }
  if(f.type==='checkbox'){ pushHistory(); f.checked=!f.checked; }
  else if(f.type==='radio'){ if(f.checked) return; pushHistory(); allFields().forEach(o=>{ if(o.type==='radio'&&o.name===f.name) o.checked=false; }); f.checked=true; }
  else {
    const r=v.stage.getBoundingClientRect(), x=r.left+Math.min(f.x1,f.x2)*v.w, y=r.top+Math.max(f.y1,f.y2)*v.h, w=Math.abs(f.x2-f.x1)*v.w;
    const pop=document.createElement('div'); pop.className='pop show'; pop.style.minWidth=Math.max(140,w)+'px'; pop.style.left=x+'px'; pop.style.top=(y+2)+'px';
    const pick=val=>{ pushHistory(); f.value=val; closeFieldPop(); buildSvg(n); renderProps(); };
    if(f.allowCustom){ const inp=document.createElement('input'); inp.placeholder='Type a value…'; inp.value=f.value||''; inp.style.cssText='width:100%;height:26px;margin-bottom:4px;background:var(--c-canvas);border:1px solid var(--c-line);border-radius:4px;color:var(--c-text);padding:0 8px;font:inherit;user-select:text';
      inp.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') pick(inp.value); else if(e.key==='Escape') closeFieldPop(); }; pop.appendChild(inp); setTimeout(()=>inp.focus(),0); }
    const opts=[''].concat(f.sort?f.items.slice().sort((a,b)=>a.localeCompare(b)):f.items);
    opts.forEach(s=>{ const it=document.createElement('div'); it.className='mi'+(s===(f.value||'')?' hl':''); it.textContent=s||'(none)'; if(!s) it.style.opacity='.6'; it.onclick=()=>pick(s); pop.appendChild(it); });
    document.body.appendChild(pop); fieldPop=pop;
    const b=pop.getBoundingClientRect(); if(b.bottom>innerHeight-8) pop.style.top=Math.max(8,y-b.height-(Math.abs(f.y2-f.y1)*v.h)-2)+'px';
    setTimeout(()=>document.addEventListener('mousedown',fieldPopAway,true),0); return;
  }
  renderAll(); renderProps();
}
function startFieldResize(n,idx,e){
  drawPage=n; const f=pd(n).fields[idx]; if(!f||f.locked) return; const v=pageViews[n-1], x0=Math.min(f.x1,f.x2), y0=Math.min(f.y1,f.y2); let hist=false;
  const mv=ev=>{ if(!hist){ pushHistory(); hist=true; }
    const p=frac(ev); let nw=Math.max(8/v.ptsW,p.x-x0), nh=Math.max(8/v.ptsH,p.y-y0);
    if(f.type!=='dropdown'&&!ev.shiftKey){ const s=Math.max(nw*v.ptsW,nh*v.ptsH); nw=s/v.ptsW; nh=s/v.ptsH; } // checkbox / radio stay square (Shift = free)
    f.x1=x0; f.y1=y0; f.x2=x0+nw; f.y2=y0+nh; buildSvg(n); };
  const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); renderProps(); };
  window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
}
// Properties panel for a form field: General / Appearance / Options (like Bluebeam's field properties)
function renderFieldProps(f,pg){
  propsBody.classList.add('form');
  const v=pageViews[pg-1], tab=renderFieldProps.tab||'general';
  if(renderFieldProps.obj!==f){ renderFieldProps.obj=f; renderFieldProps.dd=-1; }
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const sel=(id,opts,val)=>`<select id="${id}">${opts.map(([o,t])=>`<option value="${o}"${String(o)===String(val)?' selected':''}>${t}</option>`).join('')}</select>`;
  const chk=(id,label,on)=>`<label class="chk"><input type="checkbox" id="${id}"${on?' checked':''}> ${label}</label>`;
  const num=(id,label,val,extra)=>`<label>${label}<input type="number" id="${id}" value="${val}" ${extra||''}></label>`;
  const STY=[['check','Check'],['circle','Circle'],['cross','Cross'],['diamond','Diamond'],['square','Square'],['star','Star']];
  let body='';
  if(tab==='general'){
    body=`<div class="fp-sec"><label>${f.type==='radio'?'Group name':'Name'}<input id="f-name" value="${esc(f.name)}"></label>
      <label>Tooltip<input id="f-tip" value="${esc(f.tooltip)}" placeholder="Shown on hover"></label>
      <label>Visibility${sel('f-vis',[['visible','Visible'],['hidden','Hidden'],['noprint',"Visible but doesn't print"],['hiddenprint','Hidden but printable']],f.visibility)}</label>
      <label>Orientation${sel('f-orient',[[0,'0°'],[90,'90°'],[180,'180°'],[270,'270°']],f.orient)}</label>
      ${chk('f-ro','Read only',f.readOnly)}${chk('f-req','Required',f.required)}${chk('f-lock','Lock field position',f.locked)}</div>
      <div class="fp-sec"><h5>Size &amp; position (pt)</h5><div class="fp-grid">
        ${num('f-x','X',(Math.min(f.x1,f.x2)*v.ptsW).toFixed(1),'step="0.5"')}${num('f-y','Y',(Math.min(f.y1,f.y2)*v.ptsH).toFixed(1),'step="0.5"')}
        ${num('f-w','Width',(Math.abs(f.x2-f.x1)*v.ptsW).toFixed(1),'step="0.5" min="6"')}${num('f-h','Height',(Math.abs(f.y2-f.y1)*v.ptsH).toFixed(1),'step="0.5" min="6"')}</div></div>`;
  } else if(tab==='appearance'){
    body=`<div class="fp-sec"><h5>Border &amp; fill</h5>
      <label>Border</label><div class="fp-color"><input type="color" id="f-bc" value="${f.borderColor}">${chk('f-bon','Show',f.border)}</div>
      <label>Fill</label><div class="fp-color"><input type="color" id="f-fc" value="${f.fillColor}">${chk('f-fon','Show',f.fill)}</div>
      <label>Thickness${sel('f-th',[[1,'Thin'],[2,'Medium'],[3,'Thick']],f.thickness)}</label>
      <label>Style${sel('f-st',[['solid','Solid'],['dashed','Dashed'],['beveled','Beveled'],['inset','Inset'],['underline','Underline']],f.style)}</label></div>
      <div class="fp-sec"><h5>Text</h5>
      <label>Font${sel('f-font',[['Helvetica','Helvetica'],['Times','Times'],['Courier','Courier']],f.font)}</label>
      ${f.type==='dropdown'?num('f-fs','Font size (0 = auto)',f.fontSize,'min="0" max="72"'):''}
      <label>${f.type==='dropdown'?'Text color':'Mark color'}<input type="color" id="f-tc" value="${f.textColor}"></label></div>`;
  } else if(f.type==='checkbox'){
    body=`<div class="fp-sec"><label>Check style${sel('f-cs',STY,f.checkStyle)}</label><label>Export value<input id="f-ev" value="${esc(f.exportValue)}"></label>${chk('f-chk','Checked by default',f.defChecked)}
      <div class="fp-note">Currently ${f.checked?'checked':'unchecked'}. Clicking the field on the page changes the current state; the default is what Reset returns it to.</div>
      <button id="f-reset" style="width:100%;margin-top:10px">Reset to default</button></div>`;
  } else if(f.type==='radio'){
    body=`<div class="fp-sec"><label>Button style${sel('f-cs',[STY[1],...STY.filter(s=>s[0]!=='circle')],f.checkStyle)}</label><label>Export value<input id="f-ev" value="${esc(f.exportValue)}"></label>
      ${chk('f-chk','Selected by default',f.defChecked)}${chk('f-uni','Buttons with the same name &amp; value are selected in unison',f.unison)}
      <div class="fp-note">Buttons that share a group name act as one choice: only one can be selected.</div>
      <div class="fp-note">Currently ${f.checked?'selected':'not selected'}.</div>
      <button id="f-reset" style="width:100%;margin-top:10px">Reset group to default</button>
      <button id="f-addbtn" style="width:100%;margin-top:8px">+ Add button to group</button></div>`;
  } else {
    const dd=renderFieldProps.dd;
    body=`<div class="fp-sec"><h5>Items</h5><div class="items"><div class="list">${f.items.map((s,i)=>`<div class="it${i===dd?' on':''}" data-i="${i}">${esc(s)}</div>`).join('')||'<div class="it" style="color:var(--c-faint)">No items</div>'}</div>
      <div class="ibar"><input id="dd-new" placeholder="Item label"><button id="dd-add" title="Add"><svg class="i sm"><use href="#i-plus"/></svg></button><button id="dd-up" title="Move up"><svg class="i sm"><use href="#i-up"/></svg></button><button id="dd-dn" title="Move down"><svg class="i sm"><use href="#i-chev"/></svg></button><button id="dd-rm" title="Remove"><svg class="i sm"><use href="#i-trash"/></svg></button></div></div>
      <label>Default value${sel('f-val',[['','(none)'],...f.items.map(s=>[esc(s),esc(s)])],esc(f.defValue))}</label>
      <div class="fp-note">Currently ${f.value?'“'+esc(f.value)+'”':'empty'}. Choosing a value on the page changes the current value; the default is what Reset returns it to.</div>
      <button id="f-reset" style="width:100%;margin-top:8px">Reset to default</button>
      ${chk('f-cust','Allow custom text entry',f.allowCustom)}${chk('f-sort','Sort items alphabetically',f.sort)}${chk('f-commit','Commit selection immediately',f.commit)}</div>`;
  }
  const tabs=[['general','General'],['appearance','Appearance'],['options','Options']];
  propsBody.innerHTML=`<div class="fp-head"><span class="ic"><svg class="i"><use href="#i-${f.type}"/></svg></span><div><b>${FIELD_LABEL[f.type]}</b><small>Form field · Page ${pg}</small></div></div>
    ${f.type==='radio'?`<button id="f-newgrp" class="primary" style="width:100%;height:34px;margin:0 0 10px" title="Start a separate group: the new button is not tied to this group, and radio buttons you draw next join it">Start a new radio group</button>`:''}
    <div class="ptabs">${tabs.map(([t,l])=>`<button data-t="${t}"${t===tab?' class="on"':''}>${l}</button>`).join('')}</div>${body}
    <div class="fp-actions"><button id="f-dup">Duplicate</button><button id="f-def">Set as default</button><button id="p-del">Delete field</button></div>`;
  propsBody.querySelectorAll('.ptabs button').forEach(b=>b.onclick=()=>{ renderFieldProps.tab=b.dataset.t; renderProps(); });
  const redraw=()=>{ buildSvg(pg); scheduleMarkups(); };
  const bind=(id,fn,evt)=>{ const el=$(id); if(!el) return; let pushed=false; el.addEventListener('focus',()=>{ pushed=false; });
    el.addEventListener(evt||'input',()=>{ if(!pushed){ pushHistory(); pushed=true; } fn(el); redraw(); }); };
  bind('f-name',el=>{ f.name=el.value; if(f.type==='radio') lastRadioGroup=f.name; });
  bind('f-tip',el=>{ f.tooltip=el.value; }); bind('f-vis',el=>{ f.visibility=el.value; },'change'); bind('f-orient',el=>{ f.orient=+el.value; },'change');
  bind('f-ro',el=>{ f.readOnly=el.checked; },'change'); bind('f-req',el=>{ f.required=el.checked; },'change'); bind('f-lock',el=>{ f.locked=el.checked; },'change');
  bind('f-x',el=>{ const w=f.x2-f.x1; f.x1=Math.max(0,(+el.value||0)/v.ptsW); f.x2=f.x1+w; }); bind('f-y',el=>{ const h=f.y2-f.y1; f.y1=Math.max(0,(+el.value||0)/v.ptsH); f.y2=f.y1+h; });
  bind('f-w',el=>{ f.x2=f.x1+Math.max(6,+el.value||6)/v.ptsW; }); bind('f-h',el=>{ f.y2=f.y1+Math.max(6,+el.value||6)/v.ptsH; });
  bind('f-bc',el=>{ f.borderColor=el.value; }); bind('f-fc',el=>{ f.fillColor=el.value; }); bind('f-tc',el=>{ f.textColor=el.value; });
  bind('f-bon',el=>{ f.border=el.checked; },'change'); bind('f-fon',el=>{ f.fill=el.checked; },'change');
  bind('f-th',el=>{ f.thickness=+el.value; },'change'); bind('f-st',el=>{ f.style=el.value; },'change'); bind('f-font',el=>{ f.font=el.value; },'change'); bind('f-fs',el=>{ f.fontSize=Math.max(0,+el.value||0); });
  bind('f-cs',el=>{ f.checkStyle=el.value; },'change'); bind('f-ev',el=>{ f.exportValue=el.value; });
  bind('f-chk',el=>{ f.defChecked=el.checked; f.checked=el.checked; if(el.checked&&f.type==='radio') allFields().forEach(o=>{ if(o!==f&&o.type==='radio'&&o.name===f.name){ o.checked=false; o.defChecked=false; } }); },'change');
  bind('f-uni',el=>{ f.unison=el.checked; },'change'); bind('f-cust',el=>{ f.allowCustom=el.checked; },'change'); bind('f-sort',el=>{ f.sort=el.checked; },'change'); bind('f-commit',el=>{ f.commit=el.checked; },'change');
  bind('f-val',el=>{ f.defValue=el.value; f.value=el.value; },'change');
  if($('f-reset')) $('f-reset').onclick=async()=>{
    if(!await modalConfirm(f.type==='radio'?'Reset this radio group to its default selection? The current choice will be lost (Undo brings it back).':`Reset this ${FIELD_LABEL[f.type].toLowerCase()} to its default? The current ${f.type==='dropdown'?'value':'state'} will be lost (Undo brings it back).`)) return;
    pushHistory(); resetField(f); buildSvg(pg); renderProps(); };
  propsBody.querySelectorAll('.items .it[data-i]').forEach(r=>r.onclick=()=>{ renderFieldProps.dd=+r.dataset.i; renderProps(); });
  const ddDo=fn=>{ pushHistory(); fn(); if(f.value&&!f.items.includes(f.value)) f.value=''; if(f.defValue&&!f.items.includes(f.defValue)) f.defValue=''; buildSvg(pg); renderProps(); };
  if($('dd-add')){
    const add=()=>{ const s=$('dd-new').value.trim(); if(!s) return; ddDo(()=>{ f.items.push(s); renderFieldProps.dd=f.items.length-1; }); };
    $('dd-add').onclick=add; $('dd-new').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); add(); } });
    $('dd-rm').onclick=()=>{ const i=renderFieldProps.dd; if(i<0) return; ddDo(()=>{ f.items.splice(i,1); renderFieldProps.dd=Math.min(i,f.items.length-1); }); };
    $('dd-up').onclick=()=>{ const i=renderFieldProps.dd; if(i<1) return; ddDo(()=>{ [f.items[i-1],f.items[i]]=[f.items[i],f.items[i-1]]; renderFieldProps.dd=i-1; }); };
    $('dd-dn').onclick=()=>{ const i=renderFieldProps.dd; if(i<0||i>=f.items.length-1) return; ddDo(()=>{ [f.items[i+1],f.items[i]]=[f.items[i],f.items[i+1]]; renderFieldProps.dd=i+1; }); };
  }
  if($('f-addbtn')) $('f-addbtn').onclick=()=>addRadioToGroup(pg,selected.idx);
  if($('f-newgrp')) $('f-newgrp').onclick=()=>addRadioToGroup(pg,selected.idx,true);
  $('f-dup').onclick=()=>{ pushHistory(); const c=clone(f), d=pd(pg); c.x1+=.02; c.x2+=.02; c.y1+=.02; c.y2+=.02; if(f.type!=='radio') c.name=uniqueFieldName(FIELD_LABEL[f.type].split(' ')[0]);
    else { c.exportValue='Choice'+(allFields().filter(o=>o.type==='radio'&&o.name===f.name).length+1); c.checked=false; c.defChecked=false; }
    d.fields.push(c); selected={page:pg,arrName:'fields',idx:d.fields.length-1}; renderAll(); renderProps(); };
  $('f-def').onclick=()=>{ const o={}; FIELD_STYLE_KEYS.forEach(k=>{ if(f[k]!==undefined) o[k]=f[k]; }); fieldDefaults[f.type]=o; toast('Default style saved for '+FIELD_LABEL[f.type].toLowerCase()+' fields'); };
  $('p-del').onclick=()=>deleteSelected();
}
// Save: every field becomes a real widget annotation + AcroForm entry (radio buttons share a parent field).
async function exportFields(x){
  const {pdf,pages,ctxP,addAnnot,setGeo,hexArr}=x, L=PDFLib, {PDFName,PDFHexString,PDFDict,rgb,degrees,StandardFonts}=L, cat=pdf.catalog, AF=PDFName.of('AcroForm');
  const list=[]; pages.forEach((pg,i)=>{ const d=annotations[i+1]; if(d&&d.fields) d.fields.forEach(f=>list.push({f,page:pg})); });
  let af=cat.lookup(AF); if(!(af instanceof PDFDict)) af=null;
  const keep=[], seen=new Set();
  if(af){ const fa=af.lookup(PDFName.of('Fields')); if(fa&&fa.asArray) fa.asArray().forEach(r=>{ const d=ctxP.lookup(r); if(d&&d.get&&!d.get(PDFName.of('CEK'))) keep.push(r); }); }
  (x.keptWidgetRefs||[]).forEach(w=>{ const wd=ctxP.lookup(w), par=wd&&wd.get&&wd.get(PDFName.of('Parent')), top=par||w, key=String(top); if(!seen.has(key)){ seen.add(key); keep.push(top); } });
  if(!list.length&&!af&&!keep.length) return;
  const FM={Helvetica:['Helv',StandardFonts.Helvetica],Times:['TiRo',StandardFonts.TimesRoman],Courier:['Cour',StandardFonts.Courier]}, emb={};
  for(const nm of new Set(['Helvetica',...list.map(e=>e.f.font||'Helvetica')])){ const m=FM[nm]||FM.Helvetica; emb[nm]={tag:m[0],font:await pdf.embedFont(m[1])}; }
  const hv=emb.Helvetica.font, safe=s=>Array.from(String(s||'')).map(ch=>{ try{ hv.encodeText(ch); return ch; }catch(e){ return '?'; } }).join('');
  const nameOf=s=>String(s||'Off').replace(/[^A-Za-z0-9_\-]/g,'_')||'On', used=new Set(), uniq=n=>{ let s=(n||'Field'), c=2; const b=s; while(used.has(s)) s=b+'_'+(c++); used.add(s); return s; };
  const col=h=>{ const c=hexArr(h); return rgb(c[0],c[1],c[2]); }, mul=(a,b)=>[a[0]*b[0]+a[1]*b[2],a[0]*b[1]+a[1]*b[3],a[2]*b[0]+a[3]*b[2],a[2]*b[1]+a[3]*b[3]];
  const top=[], groups=new Map(), K=0.5522847498;
  for(const {f,page} of list){
    const geo=pageGeom(page); setGeo(geo); const W=geo.W, H=geo.H, x0=Math.min(f.x1,f.x2)*W, w=Math.abs(f.x2-f.x1)*W, h=Math.abs(f.y2-f.y1)*H, yb=H-Math.max(f.y1,f.y2)*H;
    const orient=((f.orient||0)%360+360)%360, sw=orient===90||orient===270, bw=sw?h:w, bh=sw?w:h, an=orient*Math.PI/180;
    const Mx=mul([Math.cos(an),Math.sin(an),-Math.sin(an),Math.cos(an)],geo.M.slice(0,4)).map(v=>Math.round(v*1e6)/1e6).concat([0,0]), needM=orient!==0||geo.rot;
    const t=f.border?f.thickness:0, radio=f.type==='radio', dash=f.style==='dashed';
    const boxOps=on=>{
      const o=[], oval=()=>{ const cx=bw/2, cy=bh/2, rx=Math.max(0,bw/2-t/2), ry=Math.max(0,bh/2-t/2); return [L.moveTo(cx+rx,cy),L.appendBezierCurve(cx+rx,cy+ry*K,cx+rx*K,cy+ry,cx,cy+ry),L.appendBezierCurve(cx-rx*K,cy+ry,cx-rx,cy+ry*K,cx-rx,cy),L.appendBezierCurve(cx-rx,cy-ry*K,cx-rx*K,cy-ry,cx,cy-ry),L.appendBezierCurve(cx+rx*K,cy-ry,cx+rx,cy-ry*K,cx+rx,cy),L.closePath()]; };
      if(f.fill) o.push(L.pushGraphicsState(),L.setFillingColor(col(f.fillColor)),...(radio?oval():[L.rectangle(0,0,bw,bh)]),L.fill(),L.popGraphicsState());
      if(f.border&&t>0){
        if(f.style==='underline'&&!radio) o.push(L.pushGraphicsState(),L.setStrokingColor(col(f.borderColor)),L.setLineWidth(t),L.moveTo(0,t/2),L.lineTo(bw,t/2),L.stroke(),L.popGraphicsState());
        else { o.push(L.pushGraphicsState(),L.setStrokingColor(col(f.borderColor)),L.setLineWidth(t)); if(dash) o.push(L.setDashPattern([3,3],0));
          o.push(...(radio?oval():[L.rectangle(t/2,t/2,Math.max(0,bw-t),Math.max(0,bh-t))]),L.stroke(),L.popGraphicsState());
          if((f.style==='beveled'||f.style==='inset')&&!radio){ const a=f.style==='beveled'?rgb(1,1,1):rgb(.48,.48,.48), b=f.style==='beveled'?rgb(.48,.48,.48):rgb(1,1,1);
            o.push(L.pushGraphicsState(),L.setStrokingColor(a),L.setLineWidth(t),L.moveTo(t*1.5,t*1.5),L.lineTo(t*1.5,bh-t*1.5),L.lineTo(bw-t*1.5,bh-t*1.5),L.stroke(),L.popGraphicsState(),
              L.pushGraphicsState(),L.setStrokingColor(b),L.setLineWidth(t),L.moveTo(bw-t*1.5,bh-t*2.5),L.lineTo(bw-t*1.5,t*1.5),L.lineTo(t*2.5,t*1.5),L.stroke(),L.popGraphicsState()); } } }
      if(on&&f.type!=='dropdown'){ const m=markCmds(f.checkStyle||(radio?'circle':'check')), X=u=>u*bw, Y=u=>(1-u)*bh, c=col(f.textColor);
        o.push(L.pushGraphicsState()); if(m.mode==='fill') o.push(L.setFillingColor(c)); else o.push(L.setStrokingColor(c),L.setLineWidth(Math.max(1.2,Math.min(bw,bh)*0.1)),L.setLineCap(L.LineCapStyle.Round),L.setLineJoin(L.LineJoinStyle.Round));
        m.c.forEach(c2=>{ if(c2[0]==='M') o.push(L.moveTo(X(c2[1]),Y(c2[2]))); else if(c2[0]==='L') o.push(L.lineTo(X(c2[1]),Y(c2[2]))); else if(c2[0]==='C') o.push(L.appendBezierCurve(X(c2[1]),Y(c2[2]),X(c2[3]),Y(c2[4]),X(c2[5]),Y(c2[6]))); else o.push(L.closePath()); });
        o.push(m.mode==='fill'?L.fill():L.stroke(),L.popGraphicsState()); }
      return o; };
    const stream=(ops,res)=>ctxP.register(ctxP.formXObject(ops,Object.assign({BBox:[0,0,bw,bh]},needM?{Matrix:Mx}:{},res?{Resources:res}:{})));
    const fe=emb[f.font]||emb.Helvetica, fs=f.fontSize>0?f.fontSize:Math.min(12,bh*0.62), tc=hexArr(f.textColor);
    const common={Type:'Annot',Subtype:'Widget',Rect:[x0,yb,x0+w,yb+h],F:{visible:4,hidden:2,noprint:0,hiddenprint:36}[f.visibility]!=null?{visible:4,hidden:2,noprint:0,hiddenprint:36}[f.visibility]:4,
      MK:Object.assign({R:orient},f.border?{BC:hexArr(f.borderColor)}:{},f.fill?{BG:hexArr(f.fillColor)}:{}),
      BS:Object.assign({W:t,S:{solid:'S',dashed:'D',beveled:'B',inset:'I',underline:'U'}[f.style]||'S'},dash?{D:[3,3]}:{}),CEK:'field'};
    const DA=`${tc.map(v=>v.toFixed(3)).join(' ')} rg /${fe.tag} ${f.type==='dropdown'&&!(f.fontSize>0)?0:(f.fontSize||0)} Tf`, flags=(f.readOnly?1:0)|(f.required?2:0);
    const tf=extra=>Object.assign({DA,CED:JSON.stringify(f)},f.tooltip?{TU:f.tooltip}:{},extra);
    if(f.type==='checkbox'){
      const on=nameOf(f.exportValue||'Yes'), ref=addAnnot(page,Object.assign({},common,{FT:'Btn',Ff:flags,AP:{N:{[on]:stream(boxOps(true)),Off:stream(boxOps(false))}},AS:f.checked?on:'Off',V:f.checked?on:'Off',DV:f.defChecked?on:'Off'}),tf({T:uniq(f.name)}));
      top.push(ref);
    } else if(radio){
      let g=groups.get(f.name); if(!g){ g={ref:ctxP.nextRef(),kids:[],sel:'Off',f,unison:false}; groups.set(f.name,g); }
      const on=nameOf(f.exportValue||'Choice'), ref=addAnnot(page,Object.assign({},common,{Parent:g.ref,AP:{N:{[on]:stream(boxOps(true)),Off:stream(boxOps(false))}},AS:f.checked?on:'Off'}),tf({}));
      if(f.checked) g.sel=on; if(f.defChecked) g.defSel=on; if(f.unison) g.unison=true; g.kids.push(ref);
    } else {
      const ops=boxOps(false);
      ops.push(...L.drawText(fe.font.encodeText(safe(f.value)),{x:t+2,y:(bh-fs)/2+fs*0.22,size:fs,font:fe.tag,color:col(f.textColor),rotate:degrees(0),xSkew:degrees(0),ySkew:degrees(0)}));
      const Ff=flags|131072|(f.allowCustom?262144:0)|(f.sort?524288:0)|(f.commit?67108864:0);
      const ref=addAnnot(page,Object.assign({},common,{FT:'Ch',Ff,AP:{N:stream(ops,{Font:{[fe.tag]:fe.font.ref}})}}),tf(Object.assign({T:uniq(f.name)},Object.assign(f.value?{V:f.value}:{},f.defValue?{DV:f.defValue}:{}))));
      ctxP.lookup(ref).set(PDFName.of('Opt'),ctxP.obj((f.items||[]).map(s=>PDFHexString.fromText(String(s)))));
      top.push(ref);
    }
  }
  groups.forEach((g,name)=>{
    const p=ctxP.obj({FT:'Btn',Ff:32768|(g.unison?33554432:0)|(g.f.readOnly?1:0)|(g.f.required?2:0),V:g.sel,DV:g.defSel||'Off',Kids:g.kids,CEK:'fieldgroup'});
    p.set(PDFName.of('T'),PDFHexString.fromText(uniq(name))); if(g.f.tooltip) p.set(PDFName.of('TU'),PDFHexString.fromText(g.f.tooltip));
    ctxP.assign(g.ref,p); top.push(g.ref); });
  if(!af){ if(!top.length&&!keep.length) return; af=ctxP.obj({}); cat.set(AF,ctxP.register(af)); }
  af.set(PDFName.of('Fields'),ctxP.obj([...keep,...top]));
  af.set(PDFName.of('DA'),PDFLib.PDFString.of('/Helv 0 Tf 0 g'));
  let dr=af.lookup(PDFName.of('DR')); if(!(dr instanceof PDFDict)){ dr=ctxP.obj({}); af.set(PDFName.of('DR'),dr); }
  let fd=dr.lookup(PDFName.of('Font')); if(!(fd instanceof PDFDict)){ fd=ctxP.obj({}); dr.set(PDFName.of('Font'),fd); }
  Object.values(emb).forEach(e=>fd.set(PDFName.of(e.tag),e.font.ref));
}
