/* layout-dialog.js - One tabbed "Page layout" dialog for header & footer, page numbers and watermark.
   Each tab is a "spec": {key, cur, body, ready(ov), collect(ov,setErr)}. Only the tab you press Apply on is applied (or removed). */

// ---- helpers shared by the tabs
const pagesFromSel=(ov,nm,setErr)=>{ let p=readPageSelection(ov,nm,setErr); if(!p) return undefined; if(p==='current') p=[currentPage]; return p.length===numPages?null:p; };
function presetPageSel(ov,nm,cur){
  const all=ov.querySelector(`input[name="${nm}"][value="all"]`), rng=ov.querySelector(`input[name="${nm}"][value="range"]`);
  if(!cur||!cur.pages) all.checked=true; else { rng.checked=true; ov.querySelector('#'+nm+'-range').value=cur.pages.join(', '); }
}
const numField=(ov,sel,d,lo,hi)=>{ const v=parseFloat(ov.querySelector(sel).value); return Math.min(hi,Math.max(lo,isNaN(v)?d:v)); };
// live preview: position a small text run inside a preview box the way the page will show it
function placePreview(el,v,h,marginPx){
  el.style.top=el.style.bottom=el.style.left=el.style.right=el.style.transform='';
  el.style[v==='t'?'top':'bottom']=marginPx+'px';
  if(h==='l') el.style.left=marginPx+'px'; else if(h==='r') el.style.right=marginPx+'px'; else { el.style.left='50%'; el.style.transform='translateX(-50%)'; }
}

// ---- page numbers
function specPageNumbers(){
  const cur=layout.pageNumbers, L=Object.assign({fmt:'Page n of N',start:1,pos:'bc',size:10,margin:0.5,color:'#222222',skipFirst:false},cur||{});
  const FM=[['n','1, 2, 3'],['Page n','Page 1'],['Page n of N','Page 1 of N'],['n / N','1 / N'],['i','i, ii, iii'],['A','A, B, C']];
  return { key:'pageNumbers', cur,
    body:`<h4 style="margin-top:0">Format</h4><select id="pn-fmt">${FM.map(([v,t])=>`<option value="${v}"${v===L.fmt?' selected':''}>${t}</option>`).join('')}</select>
      <h4>Position</h4><div class="posgrid" id="pn-pos">${['tl','tc','tr','bl','bc','br'].map(p=>`<button type="button" data-pos="${p}"${p===L.pos?' class="on"':''}></button>`).join('')}</div>
      <h4>Style</h4><div class="pn-grid">
        <label>Start at<input type="number" id="pn-start" value="${L.start}"></label><label>Size (pt)<input type="number" id="pn-size" min="6" max="72" value="${L.size}"></label>
        <label>Margin (in)<input type="number" id="pn-margin" min="0.1" max="3" step="0.1" value="${L.margin}"></label><label>Color<input type="color" id="pn-color" value="${L.color}"></label></div>
      <label class="opt"><input type="checkbox" id="pn-skip"${L.skipFirst?' checked':''}> Skip first page</label>`+
      pageSelectHTML('pn',`Current page (${currentPage})`)+`<div class="pn-prev"><span id="pn-sample"></span></div>`,
    ready(ov){
      const q=s=>ov.querySelector(s); presetPageSel(ov,'pn',cur);
      const upd=()=>{ const pos=q('#pn-pos .on').dataset.pos, s=q('#pn-sample');
        s.textContent=pageNumberText(q('#pn-fmt').value,1,numPages,parseInt(q('#pn-start').value,10)||1);
        s.style.font=`${Math.max(6,(+q('#pn-size').value||10)*0.55)}px Helvetica, Arial, sans-serif`; s.style.color=q('#pn-color').value;
        placePreview(s,pos[0],pos[1],Math.min(30,(+q('#pn-margin').value||0.5)*14)); };
      ov.querySelectorAll('#pn-pos button').forEach(b=>b.onclick=()=>{ ov.querySelectorAll('#pn-pos button').forEach(x=>x.classList.toggle('on',x===b)); upd(); });
      ov.addEventListener('input',upd); ov.addEventListener('change',upd); upd();
    },
    collect(ov,setErr){
      const q=s=>ov.querySelector(s), pages=pagesFromSel(ov,'pn',setErr); if(pages===undefined) return undefined;
      return {fmt:q('#pn-fmt').value,start:parseInt(q('#pn-start').value,10)||1,pos:q('#pn-pos .on').dataset.pos,size:numField(ov,'#pn-size',10,6,72),margin:numField(ov,'#pn-margin',0.5,0.1,3),color:q('#pn-color').value,skipFirst:q('#pn-skip').checked,pages};
    } };
}

// ---- header & footer
function specHeaderFooter(){
  const cur=layout.headerFooter, H0=Object.assign({size:9,margin:0.5,color:'#555555',skipFirst:false},cur||{});
  const S=Object.assign({hl:'',hc:'{file}',hr:'{date}',fl:'',fc:'',fr:'Page {page} of {pages}'},cur?cur.slots:{});
  const inp=(k,ph)=>`<input data-k="${k}" placeholder="${ph}" value="${S[k].replace(/"/g,'&quot;')}">`;
  return { key:'headerFooter', cur,
    body:`<h4 style="margin-top:0">Header</h4><div class="hf-row">${inp('hl','Left')}${inp('hc','Center')}${inp('hr','Right')}</div>
      <h4>Footer</h4><div class="hf-row">${inp('fl','Left')}${inp('fc','Center')}${inp('fr','Right')}</div>
      <div class="tokens">Insert <button type="button" data-tok="{page}">Page #</button><button type="button" data-tok="{pages}">Total pages</button><button type="button" data-tok="{date}">Date</button><button type="button" data-tok="{file}">File name</button></div>
      <h4>Style</h4><div class="pn-grid">
        <label>Size (pt)<input type="number" id="hf-size" min="6" max="48" value="${H0.size}"></label><label>Margin (in)<input type="number" id="hf-margin" min="0.1" max="3" step="0.1" value="${H0.margin}"></label>
        <label>Color<input type="color" id="hf-color" value="${H0.color}"></label></div>
      <label class="opt"><input type="checkbox" id="hf-skip"${H0.skipFirst?' checked':''}> Skip first page</label>`+
      pageSelectHTML('hf',`Current page (${currentPage})`)+`<div class="pn-prev" id="hf-prev"></div>`,
    ready(ov){
      const q=s=>ov.querySelector(s), ins=Array.from(ov.querySelectorAll('.hf-row input')); let last=ins[4];
      ins.forEach(i=>i.addEventListener('focus',()=>{ last=i; }));
      presetPageSel(ov,'hf',cur);
      const upd=()=>{ const pv=q('#hf-prev'); pv.innerHTML=''; const fs=Math.max(6,(+q('#hf-size').value||9)*0.55), m=Math.min(24,(+q('#hf-margin').value||0.5)*14);
        ins.forEach(i=>{ const k=i.dataset.k, s=document.createElement('span'); s.textContent=fillTokens(i.value,1,numPages);
          s.style.font=`${fs}px Helvetica, Arial, sans-serif`; s.style.color=q('#hf-color').value; placePreview(s,k[0]==='h'?'t':'b',k[1],m); pv.appendChild(s); }); };
      ov.querySelectorAll('[data-tok]').forEach(b=>b.onclick=()=>{ last.value+=b.dataset.tok; last.focus(); upd(); });
      ov.addEventListener('input',upd); ov.addEventListener('change',upd); upd();
    },
    collect(ov,setErr){
      const q=s=>ov.querySelector(s), slots={}; ov.querySelectorAll('.hf-row input').forEach(i=>{ slots[i.dataset.k]=i.value; });
      if(!Object.values(slots).some(v=>v.trim())){ setErr('Type text in at least one header or footer box.'); return undefined; }
      const pages=pagesFromSel(ov,'hf',setErr); if(pages===undefined) return undefined;
      return {slots,size:numField(ov,'#hf-size',9,6,48),margin:numField(ov,'#hf-margin',0.5,0.1,3),color:q('#hf-color').value,skipFirst:q('#hf-skip').checked,pages};
    } };
}

// ---- watermark
function specWatermark(){
  const cur=layout.watermark, W0=Object.assign({type:'text',text:'CONFIDENTIAL',size:64,color:'#e5484d',opacity:0.2,rot:-45,layer:'over',tile:false,imgWidth:0.5,imgId:null},cur||{});
  let picked=W0.imgId?{id:W0.imgId,nw:W0.imgNw,nh:W0.imgNh}:null;
  return { key:'watermark', cur,
    body:`<label class="opt" style="margin-top:0"><input type="radio" name="wmt" value="text"${W0.type==='text'?' checked':''}> Text</label>
      <label class="opt"><input type="radio" name="wmt" value="image"${W0.type==='image'?' checked':''}> Image</label>
      <div id="wm-textbox"><label>Text<input id="wm-text" value="${W0.text.replace(/"/g,'&quot;')}"></label>
        <div class="pn-grid"><label>Font size (pt)<input type="number" id="wm-size" min="8" max="400" value="${W0.size}"></label><label>Color<input type="color" id="wm-color" value="${W0.color}"></label></div></div>
      <div id="wm-imgbox" style="display:none"><div style="display:flex;align-items:center;gap:10px;margin-top:8px"><button type="button" id="wm-pick">Choose image…</button><span id="wm-imgname" class="hint">${picked?'Image selected':'.png or .jpg'}</span></div>
        <input type="file" id="wm-file" accept="image/png,image/jpeg"><label>Width (% of page)<input type="number" id="wm-imgw" min="5" max="100" value="${Math.round(W0.imgWidth*100)}"></label></div>
      <div class="pn-grid"><label>Opacity (%)<input type="number" id="wm-op" min="5" max="100" value="${Math.round(W0.opacity*100)}"></label><label>Rotation (° clockwise)<input type="number" id="wm-rot" min="-180" max="180" value="${W0.rot}"></label>
        <label>Layer<select id="wm-layer"><option value="over"${W0.layer==='over'?' selected':''}>Over page content</option><option value="multiply"${W0.layer==='multiply'?' selected':''}>Blend with page (multiply)</option><option value="under"${W0.layer==='under'?' selected':''}>Behind page content</option></select></label>
        <label>Position<select id="wm-pos"><option value="c"${!W0.tile?' selected':''}>Center</option><option value="t"${W0.tile?' selected':''}>Tiled</option></select></label></div>`+
      `<div class="sub" style="margin-top:8px">Scanned sheets have an opaque background, so “Behind page content” is hidden on them. Use “Blend with page” to let the watermark show through the linework.</div>`+
      pageSelectHTML('wm',`Current page (${currentPage})`)+`<div class="pn-prev" id="wm-prev"></div>`,
    ready(ov){
      const q=s=>ov.querySelector(s); presetPageSel(ov,'wm',cur);
      const type=()=>q('input[name="wmt"]:checked').value;
      const upd=()=>{ const t=type(); q('#wm-textbox').style.display=t==='text'?'':'none'; q('#wm-imgbox').style.display=t==='image'?'':'none';
        const pv=q('#wm-prev'); pv.innerHTML=''; const op=(+q('#wm-op').value||20)/100, rot=+q('#wm-rot').value||0;
        const mk=(x,y)=>{ let el; if(t==='image'){ const rec=picked&&imageStore[picked.id]; if(!rec) return; el=document.createElement('img'); el.src=rec.dataUrl; el.style.width=((+q('#wm-imgw').value||50)*1.4)+'px'; }
          else { el=document.createElement('div'); el.textContent=q('#wm-text').value||' '; Object.assign(el.style,{font:`700 ${Math.max(8,(+q('#wm-size').value||64)*0.3)}px Helvetica, Arial, sans-serif`,color:q('#wm-color').value,whiteSpace:'nowrap'}); }
          Object.assign(el.style,{position:'absolute',left:x+'%',top:y+'%',transform:`translate(-50%,-50%) rotate(${rot}deg)`,opacity:op}); pv.appendChild(el); };
        if(q('#wm-pos').value==='t'){ for(let j=0;j<3;j++) for(let i=0;i<3;i++) mk(15+i*35+(j&1?15:0),20+j*30); } else mk(50,50); };
      q('#wm-pick').onclick=()=>q('#wm-file').click();
      q('#wm-file').onchange=async()=>{ const f=q('#wm-file').files[0]; if(!f) return; try{ const r=await loadImageFile(f); picked={id:registerImage(r.dataUrl,r.mime,r.nw,r.nh),nw:r.nw,nh:r.nh}; q('#wm-imgname').textContent=f.name; upd(); }catch(err){ q('.dlg-err').textContent=err.message; } };
      ov.addEventListener('input',upd); ov.addEventListener('change',upd); upd();
    },
    collect(ov,setErr){
      const q=s=>ov.querySelector(s), t=q('input[name="wmt"]:checked').value;
      if(t==='text'&&!q('#wm-text').value.trim()){ setErr('Type the watermark text.'); return undefined; }
      if(t==='image'&&!picked){ setErr('Choose an image first.'); return undefined; }
      const pages=pagesFromSel(ov,'wm',setErr); if(pages===undefined) return undefined;
      const o={type:t,text:q('#wm-text').value,size:numField(ov,'#wm-size',64,8,400),color:q('#wm-color').value,opacity:numField(ov,'#wm-op',20,5,100)/100,rot:numField(ov,'#wm-rot',-45,-180,180),layer:q('#wm-layer').value,tile:q('#wm-pos').value==='t',imgWidth:numField(ov,'#wm-imgw',50,5,100)/100,pages};
      if(t==='image'){ o.imgId=picked.id; o.imgNw=picked.nw; o.imgNh=picked.nh; }
      return o;
    } };
}

// ---- the dialog
async function layoutDialog(startTab){
  if(!pdfDoc) return;
  const specs={hf:specHeaderFooter(),pn:specPageNumbers(),wm:specWatermark()}, order=['hf','pn','wm'], names={hf:'Header & footer',pn:'Page numbers',wm:'Watermark'};
  let active=startTab||'hf';
  const res=await dialog({ title:'Page layout', ok:'Apply',
    body:`<div class="lt-tabs">${order.map(t=>`<button type="button" data-tab="${t}">${names[t]}</button>`).join('')}</div>`+order.map(t=>`<div class="lt-pane" data-tab="${t}">${specs[t].body}</div>`).join(''),
    onReady:ov=>{
      order.forEach(t=>specs[t].ready(ov));
      const okBtn=ov.querySelector('.dlg-ok'), rm=document.createElement('button');
      rm.type='button'; rm.textContent='Remove'; rm.style.marginRight='auto'; rm.onclick=()=>{ ov._remove=true; okBtn.click(); }; ov.querySelector('.row').prepend(rm);
      const show=t=>{ active=t;
        ov.querySelectorAll('.lt-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
        ov.querySelectorAll('.lt-pane').forEach(p=>{ p.style.display=p.dataset.tab===t?'':'none'; });
        okBtn.textContent=specs[t].cur?'Update':'Apply'; rm.style.display=specs[t].cur?'':'none'; ov.querySelector('.dlg-err').textContent=''; };
      ov.querySelectorAll('.lt-tabs button').forEach(b=>{ b.onclick=()=>show(b.dataset.tab); }); show(active);
    },
    collect:(ov,setErr)=>{
      if(ov._remove) return {tab:active,remove:true};
      const r=specs[active].collect(ov,setErr); return r===undefined?undefined:{tab:active,res:r};
    } });
  if(!res) return;
  const sp=specs[res.tab]; pushHistory();
  if(res.remove){ layout[sp.key]=null; toast(names[res.tab]+' removed'); }
  else { res.res.baked=(sp.cur&&sp.cur.baked)||[]; layout[sp.key]=res.res; toast(names[res.tab]+(sp.cur?' updated':' added')); }
  renderAll();
}
function pageNumbersDialog(){ return layoutDialog('pn'); }
function headerFooterDialog(){ return layoutDialog('hf'); }
function watermarkDialog(){ return layoutDialog('wm'); }
$('pn-btn').onclick=pageNumbersDialog; $('hf-btn').onclick=headerFooterDialog; $('wm-btn').onclick=watermarkDialog;
