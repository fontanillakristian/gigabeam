/* overlay.js - Drawing the per-page overlay: shapes, measurements, callouts, text boxes, selection and dragging. */
// ---------- drawing the overlay for one page ----------
function renderAll(){ pageViews.forEach(v=>{ buildImages(v.num); buildSvg(v.num); buildTextNodes(v.num); buildLayout(v.num); }); }
function rebuildAllSvg(){ pageViews.forEach(v=>buildSvg(v.num)); }

function arrowHead(x1,y1,x2,y2,size,color){
  const ang=Math.atan2(y2-y1,x2-x1), a1=ang+Math.PI-0.4, a2=ang+Math.PI+0.4;
  return svgEl('polygon',{points:`${x2},${y2} ${x2+size*Math.cos(a1)},${y2+size*Math.sin(a1)} ${x2+size*Math.cos(a2)},${y2+size*Math.sin(a2)}`, fill:color});
}
function bbox(pts){ const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y); return {x1:Math.min(...xs),y1:Math.min(...ys),x2:Math.max(...xs),y2:Math.max(...ys)}; }

// Pixel size of a text object's box. Boxes created by this version always carry boxW/boxH;
// older auto-sized callouts (no boxW) fall back to an estimate from the text itself.
function textBoxPx(a,W,H){
  if(a.boxW) return {w:a.boxW*W,h:a.boxH*H};
  const lines=(a.text||'').split('\n'), fs=a.size*scale;
  let maxw=60;
  if(measureCtx){ measureCtx.font=`${fs}px Helvetica, Arial, sans-serif`; lines.forEach(l=>{ maxw=Math.max(maxw,measureCtx.measureText(l).width+8); }); }
  else maxw=Math.max(60,Math.max(...lines.map(l=>l.length))*fs*0.55+8);
  return {w:maxw,h:lines.length*fs*1.2+8};
}
// Callout geometry. The leader attaches to whichever side of the box the arrow tip is on
// (left/right flips automatically as the tip is dragged across), at the vertical middle of
// that edge, then runs out along a short horizontal "leg" to a knee, then to the tip.
function calloutGeom(a,W,H){
  const {w,h}=textBoxPx(a,W,H);
  const boxL=a.fx*W, boxT=a.fy*H, boxR=boxL+w, boxB=boxT+h;
  const tip={x:a.leader.x*W,y:a.leader.y*H};
  const side=tip.x<(boxL+boxR)/2?'left':'right';
  const anchor={x:side==='left'?boxL:boxR, y:(boxT+boxB)/2};
  let leg=(a.legLength!=null?a.legLength:0.03)*W;
  const toTip=side==='left'?anchor.x-tip.x:tip.x-anchor.x; // >0 when the tip really is out on that side
  if(toTip>0) leg=Math.min(leg,toTip);
  const knee={x:anchor.x+(side==='left'?-leg:leg), y:anchor.y};
  return {boxL,boxT,boxR,boxB,tip,anchor,knee,side};
}

function buildSvg(n,previewNode){
  n=n||drawPage;
  const v=pageViews[n-1]; if(!v) return;
  const W=v.w,H=v.h,svg=v.svg, selecting=tool==='select', grab=(arrName,idx)=>{ if(selecting) return true; if(pendingPoints.length) return false; const o=d[arrName]&&d[arrName][idx]; return !!o&&sameKindAsTool(arrName,o); }; // with a drawing tool active you can still pick up (select / move) markups of that tool's own kind
  svg.setAttribute('width',W); svg.setAttribute('height',H);
  svg.style.width=W+'px'; svg.style.height=H+'px';
  svg.innerHTML='';
  const d=pdr(n);
  // A lightweight hover outline that's repositioned directly (never via a full rebuild),
  // so hovering never tears out the very element a click/drag is landing on.
  const hoverRect=svgEl('rect',{fill:'none',stroke:'var(--accent)','stroke-width':1,'stroke-dasharray':'2,2',opacity:0.7});
  hoverRect.style.pointerEvents='none'; hoverRect.style.visibility='hidden';
  function showHover(arrName,idx){
    const obj=pdr(n)[arrName][idx]; if(!obj){ hoverRect.style.visibility='hidden'; return; }
    const pts=obj.points?obj.points:[{x:obj.x1,y:obj.y1},{x:obj.x2,y:obj.y2}];
    const b=bbox(pts); const pad=6;
    hoverRect.setAttribute('x',b.x1*W-pad); hoverRect.setAttribute('y',b.y1*H-pad);
    hoverRect.setAttribute('width',Math.max(1,(b.x2-b.x1)*W)+pad*2); hoverRect.setAttribute('height',Math.max(1,(b.y2-b.y1)*H)+pad*2);
    hoverRect.style.visibility='visible';
  }
  function hideHover(){ hoverRect.style.visibility='hidden'; }
  // Makes an SVG element grab-able (only in the Select tool) and hover-highlighted.
  const wireEl=(el,arrName,idx,pe)=>{
    el.style.pointerEvents=grab(arrName,idx)?pe:'none'; el.style.cursor='move';
    if(grab(arrName,idx)){
      el.addEventListener('mousedown',ev=>{ ev.stopPropagation(); startFeatureDrag(n,arrName,idx,ev); });
      el.addEventListener('mouseenter',()=>showHover(arrName,idx));
      el.addEventListener('mouseleave',hideHover);
    }
  };
  // An invisible, fatter copy of a thin line so it's easy to click.
  const hitLine=(x1,y1,x2,y2,w,arrName,idx)=>{
    const h=svgEl('line',{x1,y1,x2,y2,stroke:'rgba(0,0,0,0.001)','stroke-width':Math.max(12,w+8)});
    wireEl(h,arrName,idx,'stroke'); svg.appendChild(h);
  };
  (d.images||[]).forEach((im,idx)=>{ // invisible hit area so an image can be selected / moved (the picture itself sits beneath the overlay)
    const r=svgEl('rect',{x:Math.min(im.x1,im.x2)*W,y:Math.min(im.y1,im.y2)*H,width:Math.abs(im.x2-im.x1)*W,height:Math.abs(im.y2-im.y1)*H,fill:'rgba(0,0,0,0.001)',stroke:'none'});
    wireEl(r,'images',idx,'all'); svg.appendChild(r);
  });
  (d.fields||[]).forEach((fl,idx)=>{ // form fields (checkbox / radio / dropdown)
    svg.appendChild(fieldNode(fl,W,H));
    const hit=svgEl('rect',{x:Math.min(fl.x1,fl.x2)*W,y:Math.min(fl.y1,fl.y2)*H,width:Math.abs(fl.x2-fl.x1)*W,height:Math.abs(fl.y2-fl.y1)*H,fill:'rgba(0,0,0,0.001)',stroke:'none'});
    wireEl(hit,'fields',idx,'all'); svg.appendChild(hit);
  });
  d.shapes.forEach((s,idx)=>{
    if(s.type==='line'){
      const x1=s.x1*W,y1=s.y1*H,x2=s.x2*W,y2=s.y2*H;
      { const ln=svgEl('line',{x1,y1,x2,y2,stroke:s.color,'stroke-width':s.w}); applyDash(ln,s); svg.appendChild(ln); }
      if(s.arrowSize) svg.appendChild(arrowHead(x1,y1,x2,y2,s.arrowSize,s.color));
      hitLine(x1,y1,x2,y2,s.w,'shapes',idx);
      return;
    }
    if(s.type==='polygon'||s.type==='polyline'||s.type==='cloud'){
      const closed=s.type!=='polyline';
      const drawPts=s.type==='cloud'?puffOutline(s.points,W,H,s.bump,false):s.points.map(pt=>({x:pt.x*W,y:pt.y*H}));
      const ptStr=drawPts.map(p=>`${p.x},${p.y}`).join(' ');
      const el=svgEl(closed?'polygon':'polyline',{points:ptStr,stroke:s.color,'stroke-width':s.w,'stroke-linejoin':'round','stroke-linecap':'round',
        fill:closed?(s.fill?s.fillColor:(grab('shapes',idx)?'rgba(0,0,0,0.001)':'none')):'none'});
      applyDash(el,s); wireEl(el,'shapes',idx,closed?'all':'stroke'); svg.appendChild(el);
      return;
    }
    let el;
    if(s.type==='rect'){ const x=Math.min(s.x1,s.x2)*W,y=Math.min(s.y1,s.y2)*H,w=Math.abs(s.x2-s.x1)*W,h=Math.abs(s.y2-s.y1)*H;
      el=svgEl('rect',{x,y,width:w,height:h,stroke:s.color,'stroke-width':s.w,fill:s.fill?s.fillColor:(grab('shapes',idx)?'rgba(0,0,0,0.001)':'none')}); }
    else { const cx=(s.x1+s.x2)/2*W,cy=(s.y1+s.y2)/2*H,rx=Math.abs(s.x2-s.x1)/2*W,ry=Math.abs(s.y2-s.y1)/2*H;
      el=svgEl('ellipse',{cx,cy,rx,ry,stroke:s.color,'stroke-width':s.w,fill:s.fill?s.fillColor:(grab('shapes',idx)?'rgba(0,0,0,0.001)':'none')}); }
    applyDash(el,s); wireEl(el,'shapes',idx,'all'); svg.appendChild(el);
  });
  d.paths.forEach((p,idx)=>{
    const pts=p.points.map(pt=>`${pt.x*W},${pt.y*H}`).join(' ');
    const el=svgEl('polyline',{points:pts,stroke:p.color,'stroke-width':p.w,fill:'none','stroke-linecap':'round','stroke-linejoin':'round',opacity:p.opacity});
    wireEl(el,'paths',idx,'stroke'); svg.appendChild(el);
  });
  d.measurements.forEach((m,idx)=>{
    const fs=(m.fontSize||11)*scale, tc=m.textColor||m.color;
    const label=svgEl('text',{'font-size':fs,'font-family':'sans-serif','font-weight':'600','text-anchor':'middle',fill:tc});
    label.textContent=measureLabel(m);
    if(m.type==='length'){
      const [a,b]=m.points; const ax=a.x*W,ay=a.y*H,bx=b.x*W,by=b.y*H;
      const as=m.arrowSize!=null?m.arrowSize:8;
      { const ln=svgEl('line',{x1:ax,y1:ay,x2:bx,y2:by,stroke:m.color,'stroke-width':m.w}); applyDash(ln,m); svg.appendChild(ln); }
      if(as>0){ svg.appendChild(arrowHead(bx,by,ax,ay,as,m.color)); svg.appendChild(arrowHead(ax,ay,bx,by,as,m.color)); } // an arrow on each end
      label.setAttribute('x',(ax+bx)/2); label.setAttribute('y',(ay+by)/2-6);
      hitLine(ax,ay,bx,by,m.w,'measurements',idx);
    } else {
      const pts=m.points.map(pt=>`${pt.x*W},${pt.y*H}`).join(' ');
      const poly=svgEl('polygon',{points:pts,stroke:m.color,'stroke-width':m.w,fill:m.color,'fill-opacity':0.12}); applyDash(poly,m);
      let cx=0,cy=0; m.points.forEach(pt=>{cx+=pt.x;cy+=pt.y;}); cx=cx/m.points.length*W; cy=cy/m.points.length*H;
      label.setAttribute('x',cx); label.setAttribute('y',cy);
      wireEl(poly,'measurements',idx,'all'); svg.appendChild(poly);
    }
    wireEl(label,'measurements',idx,'all'); svg.appendChild(label);
    if(grab('measurements',idx)) label.addEventListener('dblclick',ev=>{ ev.stopPropagation(); editMeasureLabel(n,idx,label); }); // double-click the label to type your own text
  });
  d.texts.forEach((a,idx)=>{ if(!a.leader) return;
    if(a.align==='auto'){ const ta=v.stage.querySelector(`.ann[data-idx="${idx}"] textarea`); if(ta) ta.style.textAlign=effAlign(a,W,H); } // text follows the leader side
    const g=calloutGeom(a,W,H), lw=(a.borderW>0?a.borderW:1.2)*scale;
    if(a.arrowSize) svg.appendChild(arrowHead(g.knee.x,g.knee.y,g.tip.x,g.tip.y,a.arrowSize,a.color));
    else svg.appendChild(svgEl('circle',{cx:g.tip.x,cy:g.tip.y,r:3,fill:a.color}));
    svg.appendChild(svgEl('line',{x1:g.tip.x,y1:g.tip.y,x2:g.knee.x,y2:g.knee.y,stroke:a.color,'stroke-width':lw}));
    svg.appendChild(svgEl('line',{x1:g.knee.x,y1:g.knee.y,x2:g.anchor.x,y2:g.anchor.y,stroke:a.color,'stroke-width':lw}));
  });
  svg.appendChild(hoverRect);
  updateSelectionOverlay(n);
  if(previewNode) svg.appendChild(previewNode);
}

// The selection outline / delete "×" / callout arrow-tip handle. These live in their own
// layer so selecting or deselecting never has to rebuild (and tear out) the shapes themselves.
function updateSelectionOverlay(n){
  const v=pageViews[n-1]; if(!v) return;
  const W=v.w,H=v.h;
  v.svg.querySelectorAll('.sel-layer').forEach(x=>x.remove());
  const oldDel=v.stage.querySelector('.shape-del-btn'); if(oldDel) oldDel.remove();
  const oldAdd=v.stage.querySelector('.shape-add-btn'); if(oldAdd) oldAdd.remove();
  const ex=extras().filter(x=>x.page===n&&x.arrName!=='texts'); // the other picked markups (text boxes outline themselves): a plain dashed outline, no handles
  if(ex.length){ const gx=svgEl('g',{class:'sel-layer'}); gx.style.pointerEvents='none';
    ex.forEach(x=>{ const o=(pdr(n)[x.arrName]||[])[x.idx]; if(!o) return; const b=bbox(o.points?o.points:[{x:o.x1,y:o.y1},{x:o.x2,y:o.y2}]), pad=6;
      gx.appendChild(svgEl('rect',{x:b.x1*W-pad,y:b.y1*H-pad,width:Math.max(1,(b.x2-b.x1)*W)+pad*2,height:Math.max(1,(b.y2-b.y1)*H)+pad*2,fill:'none',stroke:'var(--accent)','stroke-width':1.5,'stroke-dasharray':'4,3'})); });
    v.svg.appendChild(gx); }
  if(!selected||selected.page!==n) return;
  const obj=selObj(); if(!obj) return;
  const g=svgEl('g',{class:'sel-layer'}); g.style.pointerEvents='none';
  if(selected.arrName!=='texts'){
    const pts=obj.points?obj.points:[{x:obj.x1,y:obj.y1},{x:obj.x2,y:obj.y2}];
    const b=bbox(pts), pad=6;
    g.appendChild(svgEl('rect',{x:b.x1*W-pad,y:b.y1*H-pad,width:Math.max(1,(b.x2-b.x1)*W)+pad*2,height:Math.max(1,(b.y2-b.y1)*H)+pad*2,fill:'none',stroke:'var(--accent)','stroke-width':1.5,'stroke-dasharray':'4,3'}));
    if(selected.arrName==='images'||selected.arrName==='fields'){ const isField=selected.arrName==='fields', hd=svgEl('rect',{x:b.x2*W+pad-5,y:b.y2*H+pad-5,width:10,height:10,fill:'var(--accent)',stroke:'#fff','stroke-width':1});
      hd.style.pointerEvents='all'; hd.style.cursor='nwse-resize'; hd.addEventListener('mousedown',ev=>{ ev.stopPropagation(); (isField?startFieldResize:startImageResize)(n,selected.idx,ev); }); g.appendChild(hd); }
    const mkHandle=(cx,cy,r,cursor,fn,circle)=>{ const hd=circle?svgEl('circle',{cx,cy,r,fill:'var(--accent)',stroke:'#fff','stroke-width':1.5}):svgEl('rect',{x:cx-r,y:cy-r,width:r*2,height:r*2,fill:'var(--accent)',stroke:'#fff','stroke-width':1});
      hd.style.pointerEvents='all'; hd.style.cursor=cursor; hd.addEventListener('mousedown',ev=>{ ev.stopPropagation(); ev.preventDefault(); fn(ev); }); g.appendChild(hd); };
    if(obj.points&&(selected.arrName==='measurements'||(selected.arrName==='shapes'&&/^(polygon|polyline|cloud)$/.test(obj.type)))){ // a handle on every corner: drag to reposition it
      obj.points.forEach((pt,vi)=>mkHandle(pt.x*W,pt.y*H,5.5,'move',ev=>startVertexDrag(n,selected.arrName,selected.idx,vi,ev),true)); }
    if(selected.arrName==='shapes'&&(obj.type==='rect'||obj.type==='ellipse')){ // eight handles: corners and edge middles
      const xm=(b.x1+b.x2)/2*W, ym=(b.y1+b.y2)/2*H, X=[b.x1*W,xm,b.x2*W], Y=[b.y1*H,ym,b.y2*H], cur=['nwse-resize','ns-resize','nesw-resize','ew-resize',null,'ew-resize','nesw-resize','ns-resize','nwse-resize'];
      for(let r=0;r<3;r++) for(let c=0;c<3;c++){ if(r===1&&c===1) continue; mkHandle(X[c],Y[r],4.5,cur[r*3+c],ev=>startShapeResize(n,selected.idx,c-1,r-1,ev)); } }
    v.svg.appendChild(g);
    const delBtn=document.createElement('button'); delBtn.className='shape-del-btn'; delBtn.textContent='×'; delBtn.title='Delete';
    delBtn.style.left=(b.x2*W+pad-9)+'px'; delBtn.style.top=(b.y1*H-pad-9)+'px';
    delBtn.addEventListener('mousedown',e=>e.stopPropagation()); // otherwise the stage's own mousedown (tool still active) reads this as an empty click and deselects before the click handler ever runs
    delBtn.onclick=e=>{ e.preventDefault(); e.stopPropagation(); deleteSelected(); };
    v.stage.appendChild(delBtn);
    if(selected.arrName==='fields'&&obj.type==='radio'){ // radio buttons: group number tag (top-left) and a "+" below to add another button to the same group
      const badge=(o,main)=>{ const q=bbox([{x:o.x1,y:o.y1},{x:o.x2,y:o.y2}]), lab='G'+radioGroupNo(o.name), tw=lab.length*6.5+10, x=q.x1*W-pad, y=q.y1*H-pad-16;
        const bg=svgEl('rect',{x,y,width:tw,height:15,rx:3,fill:main?'var(--accent)':'#3b3c43',stroke:main?'none':'var(--accent)','stroke-width':1}), tx=svgEl('text',{x:x+tw/2,y:y+7.5,'text-anchor':'middle','dominant-baseline':'central','font-size':10,'font-family':'sans-serif','font-weight':'700',fill:'#fff'});
        tx.textContent=lab; g.appendChild(bg); g.appendChild(tx); };
      (pd(n).fields||[]).forEach(o=>{ if(o!==obj&&o.type==='radio'&&o.name===obj.name) badge(o,false); }); // the rest of this group on the page
      badge(obj,true);
      const addBtn=document.createElement('button'); addBtn.className='shape-add-btn'; addBtn.textContent='+'; addBtn.title='Add a radio button to this group';
      addBtn.style.left=((b.x1+b.x2)/2*W-10)+'px'; addBtn.style.top=(b.y2*H+pad+5)+'px';
      addBtn.addEventListener('mousedown',e=>e.stopPropagation());
      addBtn.onclick=e=>{ e.preventDefault(); e.stopPropagation(); addRadioToGroup(n,selected.idx); };
      v.stage.appendChild(addBtn);
    }
  } else if(obj.leader){
    const geo=calloutGeom(obj,W,H);
    const handle=svgEl('circle',{cx:geo.tip.x,cy:geo.tip.y,r:6,fill:obj.color,stroke:'#fff','stroke-width':1.5,opacity:0.85});
    handle.style.cursor='move'; handle.style.pointerEvents='all';
    handle.addEventListener('mousedown',ev=>{ ev.stopPropagation(); startLeaderDrag(n,selected.idx,ev); });
    g.appendChild(handle); v.svg.appendChild(g);
  }
}
// Single place that changes the selection; only the affected pages' overlays are touched.
function setSelected(sel){
  const prev=selected, pages=new Set(extras().map(x=>x.page)); selected=sel;
  if(prev) pages.add(prev.page); if(sel) pages.add(sel.page);
  pages.forEach(p=>updateSelectionOverlay(p));
  renderProps();
}
// pick several markups at once: `list` is every picked item ({page,arrName,idx}), `primary` the one the Properties panel follows
function setMultiSelection(list,primary){
  if(list.length<=1){ setSelected(list[0]||null); return; }
  const pages=new Set(extras().map(x=>x.page)); if(selected) pages.add(selected.page);
  selected={page:primary.page,arrName:primary.arrName,idx:primary.idx};
  multiSel={primary:selected,items:list.filter(x=>!(x.page===primary.page&&x.arrName===primary.arrName&&x.idx===primary.idx)).map(x=>({page:x.page,arrName:x.arrName,idx:x.idx}))};
  list.forEach(x=>pages.add(x.page));
  pages.forEach(p=>updateSelectionOverlay(p));
  renderProps();
}
// Keeps every text box's "selected" look (outline, ×, resize handle) matching `selected`,
// without rebuilding any box — so clearing a selection can't leave a stale × behind.
function syncTextSelectionUI(){
  pageViews.forEach(v=>{
    v.stage.querySelectorAll('.ann').forEach(node=>{
      const idx=+node.dataset.idx, sel=isSel(v.num,'texts',idx);
      node.classList.toggle('sel',sel); node.classList.toggle('msel',isMulti(v.num,'texts',idx));
      const del=node.querySelector('.del'), rs=node.querySelector('.rs');
      if(!sel){ if(del) del.remove(); if(rs) rs.remove(); }
      else if(!del){ const a=pdr(v.num).texts[idx]; if(a) attachSelUI(node,a,v.num,idx); }
    });
  });
}

// ---------- text boxes / callouts ----------
function buildTextNodes(n){
  const v=pageViews[n-1]; if(!v) return;
  v.stage.querySelectorAll('.ann').forEach(x=>x.remove());
  pdr(n).texts.forEach((a,idx)=>renderTextNode(n,a,idx));
}
function attachSelUI(node,a,n,idx){
  const v=pageViews[n-1], W=v.w, H=v.h;
  const del=document.createElement('button'); del.className='del'; del.textContent='×'; del.title='Delete';
  del.addEventListener('mousedown',e=>e.stopPropagation());
  del.onclick=e=>{ e.preventDefault(); e.stopPropagation(); deleteSelected(); };
  node.appendChild(del);
  if(a.boxW){
    const rs=document.createElement('div'); rs.className='rs';
    rs.addEventListener('mousedown',e=>{
      e.preventDefault(); e.stopPropagation(); drawPage=n;
      const sx=e.clientX, sy=e.clientY, rw=a.boxW*W, rh=a.boxH*H; let hist=false;
      const mv=ev=>{ if(!hist){ pushHistory(); hist=true; }
        const nw=Math.max(30,rw+(ev.clientX-sx)), nh=Math.max(20,rh+(ev.clientY-sy));
        node.style.width=nw+'px'; node.style.height=nh+'px'; a.boxW=nw/W; a.boxH=nh/H;
        if(a.leader) buildSvg(n); };
      const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); };
      window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
    });
    node.appendChild(rs);
  }
}
function selectTextNode(n,idx){ setSelected({page:n,arrName:'texts',idx}); }
function renderTextNode(n,a,idx){
  const v=pageViews[n-1], W=v.w, H=v.h;
  const sel=isSel(n,'texts',idx);
  const node=document.createElement('div'); node.className='ann'+(sel?' sel':'')+(a.text?'':' blank'); node.dataset.idx=idx; // (an empty box gets a faint on-screen tint so it can be found and filled in)
  const tc=a.textColor||a.color, bw=a.borderW>0?a.borderW*scale:0;
  node.style.left=(a.fx*W)+'px'; node.style.top=(a.fy*H)+'px'; node.style.color=tc;
  node.style.background=a.bg?(a.bgColor||'#ffffff'):'transparent';
  if(bw){ node.style.boxShadow=`inset 0 0 0 ${bw}px ${a.color}`; node.style.padding=`${1+bw}px ${2+bw}px`; }
  if(a.boxW){ node.style.width=(a.boxW*W)+'px'; node.style.height=(a.boxH*H)+'px'; }
  const ta=document.createElement('textarea'); ta.value=a.text; ta.style.color=tc; ta.style.fontSize=(a.size*scale)+'px'; ta.style.textAlign=effAlign(a,W,H);
  if(!a.boxW){ ta.rows=1; ta.style.width='auto'; }
  ta.addEventListener('input',()=>{ markDirty(); a.text=ta.value; node.classList.toggle('blank',!ta.value); if(!a.boxW){ autoGrow(ta); if(a.leader) buildSvg(n); } });
  ta.addEventListener('mousedown',()=>{ drawPage=n; if(!isSel(n,'texts',idx)) selectTextNode(n,idx); });
  node.appendChild(ta); if(!a.boxW) requestAnimationFrame(()=>autoGrow(ta));
  node.addEventListener('mousedown',e=>{
    if(e.target===ta||e.target.closest('.rs')||e.target.closest('.del')||e.target.closest('button')) return;
    drawPage=n; e.preventDefault(); e.stopPropagation();
    const sx=e.clientX, sy=e.clientY, ox=parseFloat(node.style.left), oy=parseFloat(node.style.top), origLeader=a.leader?{...a.leader}:null;
    let moved=false, hist=false;
    const mv=ev=>{ const dx=ev.clientX-sx, dy=ev.clientY-sy;
      if(!moved){ if(Math.abs(dx)<=2&&Math.abs(dy)<=2) return; moved=true; if(!hist){ pushHistory(); hist=true; } }
      const nx=ox+dx, ny=oy+dy; node.style.left=nx+'px'; node.style.top=ny+'px';
      a.fx=nx/W; a.fy=ny/H;
      if(a.leader&&origLeader){ a.leader.x=origLeader.x+dx/W; a.leader.y=origLeader.y+dy/H; }
      buildSvg(n); };
    const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); if(!moved) selectTextNode(n,idx); };
    window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
  });
  if(sel) attachSelUI(node,a,n,idx);
  v.stage.appendChild(node);
}
function autoGrow(ta){ ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px'; ta.style.width='auto'; ta.style.width=Math.max(60,ta.scrollWidth+4)+'px'; }

function startFeatureDrag(n,arrName,idx,e){
  drawPage=n;
  setSelected({page:n,arrName,idx});
  const obj=pd(n)[arrName][idx], orig=clone(obj);
  if(obj.locked){ // a locked form field stays put (it can still be selected, edited and filled in)
    const once=ev=>{ window.removeEventListener('mouseup',once); swallowNextClick(); if(arrName==='fields') activateField(n,idx,ev); };
    window.addEventListener('mouseup',once); return; }
  const start=frac(e); let histPushed=false;
  const mv=ev=>{ const p=frac(ev); const dx=p.x-start.x, dy=p.y-start.y;
    if(!histPushed&&(Math.abs(dx)>0.001||Math.abs(dy)>0.001)){ pushHistory(); histPushed=true; }
    if(orig.points) obj.points=orig.points.map(pt=>({x:pt.x+dx,y:pt.y+dy}));
    else { obj.x1=orig.x1+dx; obj.y1=orig.y1+dy; obj.x2=orig.x2+dx; obj.y2=orig.y2+dy; }
    if(arrName==='images') buildImages(n);
    buildSvg(n); };
  const up=ev=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); renderProps(); buildSvg(n);
    if(arrName==='fields'&&!histPushed) activateField(n,idx,ev); }; // a plain click (no drag) on a form field also fills it in
  window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
}
// Type a measurement's label in place: Enter / clicking away keeps it, Esc cancels, and an empty box goes back to the measured value.
function editMeasureLabel(n,idx,labelEl){
  const m=pd(n).measurements[idx], v=pageViews[n-1]; if(!m||!v) return;
  const b=labelEl.getBBox(), inp=document.createElement('input'); inp.className='mlabel-edit';
  inp.value=m.label!=null?m.label:measuredValue(m); inp.placeholder=measuredValue(m); inp.title='Your own text. {value} inserts the measured value; leave empty to show the measured value.';
  inp.style.left=(b.x+b.width/2)+'px'; inp.style.top=(b.y+b.height/2)+'px'; inp.style.fontSize=((m.fontSize||11)*scale)+'px'; inp.style.color=m.textColor||m.color;
  inp.style.width=Math.max(120,b.width+40)+'px';
  let done=false;
  const finish=keep=>{ if(done) return; done=true; const val=inp.value; inp.remove();
    if(keep){ const next=(val.trim()===''||val===measuredValue(m))?null:val; if(next!==(m.label??null)){ pushHistory(); m.label=next; } }
    buildSvg(n); renderProps(); scheduleMarkups(); };
  inp.addEventListener('mousedown',e=>e.stopPropagation());
  inp.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); finish(true); } else if(e.key==='Escape'){ e.preventDefault(); finish(false); } });
  inp.addEventListener('blur',()=>finish(true));
  v.stage.appendChild(inp); inp.focus(); inp.select();
}
// drag one corner of a polygon / polyline / cloud / area / length measurement (measurements are re-measured as they change)
function startVertexDrag(n,arrName,idx,vi,e){
  drawPage=n; const o=pd(n)[arrName][idx]; if(!o||!o.points[vi]) return; let hist=false;
  const mv=ev=>{ if(!hist){ pushHistory(); hist=true; } const p=frac(ev); o.points[vi]={x:p.x,y:p.y}; if(arrName==='measurements') recalcMeasure(o); buildSvg(n); };
  const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); renderProps(); scheduleMarkups(); };
  window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
}
function recalcMeasure(m){
  if(m.type==='length'){ const d=distPts(m.points[0],m.points[1]); m.value=scaleInfo?d/scaleInfo.pointsPerUnit:d; }
  else { const a=areaPts(m.points); m.value=scaleInfo?a/(scaleInfo.pointsPerUnit**2):a; }
}
// resize a rectangle / ellipse from a handle: hx, hy = -1 (left / top edge), 0 (not moved on that axis), 1 (right / bottom edge). Shift keeps the proportions.
function startShapeResize(n,idx,hx,hy,e){
  drawPage=n; const s=pd(n).shapes[idx]; if(!s) return;
  const o=clone(s), L=Math.min(o.x1,o.x2), R=Math.max(o.x1,o.x2), T=Math.min(o.y1,o.y2), B=Math.max(o.y1,o.y2), v=pageViews[n-1], minW=6/v.ptsW, minH=6/v.ptsH; let hist=false;
  const mv=ev=>{ if(!hist){ pushHistory(); hist=true; } const p=frac(ev);
    let l=L,r=R,t=T,b=B;
    if(hx<0) l=Math.min(p.x,R-minW); else if(hx>0) r=Math.max(p.x,L+minW);
    if(hy<0) t=Math.min(p.y,B-minH); else if(hy>0) b=Math.max(p.y,T+minH);
    if(ev.shiftKey&&hx&&hy){ const k=Math.max((r-l)/(R-L),(b-t)/(B-T)); const nw=(R-L)*k, nh=(B-T)*k; if(hx<0) l=R-nw; else r=L+nw; if(hy<0) t=B-nh; else b=T+nh; }
    s.x1=l; s.x2=r; s.y1=t; s.y2=b; buildSvg(n); };
  const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); renderProps(); };
  window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
}
function startLeaderDrag(n,idx,e){
  drawPage=n;
  const a=pd(n).texts[idx]; if(!a||!a.leader) return;
  const orig={...a.leader}, start=frac(e); let histPushed=false;
  const mv=ev=>{ const p=frac(ev); const dx=p.x-start.x, dy=p.y-start.y;
    if(!histPushed&&(Math.abs(dx)>0.001||Math.abs(dy)>0.001)){ pushHistory(); histPushed=true; }
    a.leader.x=orig.x+dx; a.leader.y=orig.y+dy;
    buildSvg(n); }; // the leader re-attaches to the nearer side of the box on every move
  const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); swallowNextClick(); };
  window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up);
}
