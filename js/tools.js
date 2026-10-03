/* tools.js - Drawing and measuring gestures: the tools that create markups. */
// ---------- draw / measure gestures ----------
const DRAG_TOOLS=['line','rect','ellipse','highlighter','callout','text','areapick','checkbox','radio','dropdown'];
const CLICK_TOOLS=['scale','measure-length','measure-area','polygon','polyline','cloud'];

function onDown(e){
  if(e.button!==0) return; // only the left button draws (the middle button pans, see shell.js)
  if(!DRAG_TOOLS.includes(tool) || (tool!=='areapick'&&e.target.closest('.ann'))) return;
  isDragging=true; dragStart=frac(e); dragPts=[dragStart];
}
function onMove(e){
  if(isDragging){ const p=frac(e); if(tool==='highlighter') dragPts.push(p); buildSvg(drawPage,previewShape(tool,dragStart,p,dragPts)); return; }
  if(CLICK_TOOLS.includes(tool) && pendingPoints.length){ buildSvg(drawPage,previewPending(frac(e))); }
}
function onUp(e){
  if(e.button!==0) return; // a middle / right button release never finishes a drawing
  if(!isDragging) return;
  isDragging=false; const p=frac(e);
  if(tool==='areapick'){ // rectangle picked for Crop / Print area
    if(Math.abs(p.x-dragStart.x)<0.01||Math.abs(p.y-dragStart.y)<0.01){ buildSvg(drawPage); return; }
    finishPick({page:drawPage,x1:Math.min(p.x,dragStart.x),y1:Math.min(p.y,dragStart.y),x2:Math.max(p.x,dragStart.x),y2:Math.max(p.y,dragStart.y)}); return; }
  const dist=Math.hypot(p.x-dragStart.x,p.y-dragStart.y);
  // A genuine drag creates the new object (which becomes selected); a plain click with a
  // drawing tool still active — since the tool now stays put after drawing — just clears
  // whatever was selected, instead of leaving a stray sliver-sized object behind.
  if(dist<0.006 && tool!=='text' && tool!=='callout' && !FORM_TOOLS.includes(tool)){ if(selected) setSelected(null); buildSvg(drawPage); return; }
  if(tool==='callout'&&dist<0.006){ // a single click drops a callout with the default settings: arrow tip on the click, box up and to the right (or to the left near the page edge)
    const right=dragStart.x+0.08+0.16<=1; p.x=right?dragStart.x+0.08:dragStart.x-0.08; p.y=Math.max(0.03,dragStart.y-0.06); }
  finalizeDrag(tool,dragStart,p,dragPts);
  renderAll(); renderProps();
}
window.addEventListener('mouseup',onUp);
const INTERACTIVE_SVG_TAGS=['line','rect','ellipse','polygon','polyline','text'];
function onClick(e){
  if(Date.now()<suppressClickUntil) return;
  if(e.target.closest('.ann')||e.target.closest('.shape-del-btn')||e.target.closest('.area-close-btn')) return;
  const onInteractiveShape=INTERACTIVE_SVG_TAGS.includes(e.target.tagName);
  if(tool==='select' && !onInteractiveShape){ if(selected) setSelected(null); return; }
  if(!CLICK_TOOLS.includes(tool)) return;
  const p=frac(e);
  pendingPoints.push(p);
  if(tool==='scale' && pendingPoints.length===2){ finishScale(); }
  else if(tool==='measure-length' && pendingPoints.length===2){ finishLength(); }
  else { buildSvg(drawPage,previewPending(p)); updateMultiClickUI(); }
}
function onDblClick(){
  if(tool==='measure-area' && pendingPoints.length>=3) finishArea();
  else if((tool==='polygon'||tool==='cloud') && pendingPoints.length>=3) finishMultiShape(tool);
  else if(tool==='polyline' && pendingPoints.length>=2) finishMultiShape('polyline');
}
// Clicking the empty gap between pages (or margins) also deselects.
main.addEventListener('click',e=>{
  if(Date.now()<suppressClickUntil) return;
  if((e.target===main||e.target.id==='pages-container') && tool==='select' && selected) setSelected(null);
});

function previewShape(t,p1,p2,pts){
  const v=V(), W=v.w,H=v.h, c=colorPick.value, w=parseInt(widthPick.value);
  const wrap=el=>{ el.style.pointerEvents='none'; return el; };
  if(t==='areapick') return wrap(svgEl('rect',{x:Math.min(p1.x,p2.x)*W,y:Math.min(p1.y,p2.y)*H,width:Math.abs(p2.x-p1.x)*W,height:Math.abs(p2.y-p1.y)*H,stroke:'#3b5bfd','stroke-width':2,fill:'rgba(59,91,253,0.12)','stroke-dasharray':'6,4'}));
  if(t==='line') return wrap(svgEl('line',{x1:p1.x*W,y1:p1.y*H,x2:p2.x*W,y2:p2.y*H,stroke:c,'stroke-width':w,'stroke-dasharray':'4,4'}));
  if(FORM_TOOLS.includes(t)) return wrap(svgEl('rect',{x:Math.min(p1.x,p2.x)*W,y:Math.min(p1.y,p2.y)*H,width:Math.abs(p2.x-p1.x)*W,height:Math.abs(p2.y-p1.y)*H,stroke:'#2f5da8','stroke-width':1.5,fill:'rgba(47,93,168,0.12)','stroke-dasharray':'4,3'}));
  if(t==='rect'||t==='text'){ const x=Math.min(p1.x,p2.x)*W,y=Math.min(p1.y,p2.y)*H,ww=Math.abs(p2.x-p1.x)*W,hh=Math.abs(p2.y-p1.y)*H;
    return wrap(svgEl('rect',{x,y,width:ww,height:hh,stroke:t==='text'?'#3b5bfd':c,'stroke-width':t==='text'?1.5:w,fill:'none','stroke-dasharray':'4,4'})); }
  if(t==='ellipse'){ const cx=(p1.x+p2.x)/2*W,cy=(p1.y+p2.y)/2*H,rx=Math.abs(p2.x-p1.x)/2*W,ry=Math.abs(p2.y-p1.y)/2*H;
    return wrap(svgEl('ellipse',{cx,cy,rx,ry,stroke:c,'stroke-width':w,fill:'none','stroke-dasharray':'4,4'})); }
  if(t==='highlighter'){ const s=pts.map(pt=>`${pt.x*W},${pt.y*H}`).join(' ');
    return wrap(svgEl('polyline',{points:s,stroke:c,'stroke-width':w*3,fill:'none',opacity:0.35,'stroke-linecap':'round'})); }
  if(t==='callout') return wrap(svgEl('line',{x1:p1.x*W,y1:p1.y*H,x2:p2.x*W,y2:p2.y*H,stroke:c,'stroke-width':1.5,'stroke-dasharray':'4,4'}));
}
function previewPending(cur){
  const v=V(), W=v.w,H=v.h, g=svgEl('g',{}); g.style.pointerEvents='none';
  const all=[...pendingPoints, cur];
  g.appendChild(svgEl('polyline',{points:all.map(pt=>`${pt.x*W},${pt.y*H}`).join(' '),stroke:colorPick.value,'stroke-width':parseInt(widthPick.value),fill:'none','stroke-dasharray':'4,4'}));
  pendingPoints.forEach((pt,i)=>g.appendChild(svgEl('circle',{cx:pt.x*W,cy:pt.y*H,r:(i===0&&tool==='measure-area')?5:3,fill:colorPick.value})));
  return g;
}
// Once a closed shape (measure-area / polygon / cloud) has 3+ corners, a ✓ sits on the FIRST
// corner; an open polyline instead grows a ✓ at the LAST point once it has 2+. Either click
// finishes the shape (double-click still works too).
function updateMultiClickUI(){
  const old=document.querySelector('.area-close-btn'); if(old) old.remove();
  const v=V(); if(!v||!pendingPoints.length) return;
  const closedTool=tool==='measure-area'||tool==='polygon'||tool==='cloud';
  if(closedTool&&pendingPoints.length>=3){
    const p=pendingPoints[0];
    const b=document.createElement('button'); b.className='area-close-btn'; b.textContent='✓'; b.title='Close the shape and finish';
    b.style.left=(p.x*v.w-11)+'px'; b.style.top=(p.y*v.h-11)+'px';
    b.addEventListener('mousedown',e=>e.stopPropagation());
    b.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); if(tool==='measure-area') finishArea(); else finishMultiShape(tool); });
    v.stage.appendChild(b);
  } else if(tool==='polyline'&&pendingPoints.length>=2){
    const p=pendingPoints[pendingPoints.length-1];
    const b=document.createElement('button'); b.className='area-close-btn'; b.textContent='✓'; b.title='Finish the line';
    b.style.left=(p.x*v.w-11)+'px'; b.style.top=(p.y*v.h-11)+'px';
    b.addEventListener('mousedown',e=>e.stopPropagation());
    b.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); finishMultiShape('polyline'); });
    v.stage.appendChild(b);
  }
}
function clearPending(skipRebuild){
  const had=pendingPoints.length>0; pendingPoints=[];
  const b=document.querySelector('.area-close-btn'); if(b) b.remove();
  if(had&&!skipRebuild&&V()) buildSvg(drawPage);
}

let typeDefaults={}; // kind -> {extra style fields to seed new objects with}

function finalizeDrag(t,p1,p2,pts){
  if(FORM_TOOLS.includes(t)){ addField(t,p1,p2); return; }
  const n=drawPage, d=pd(n), c=colorPick.value, w=parseInt(widthPick.value);
  if(t==='line'||t==='rect'||t==='ellipse'){ pushHistory();
    const base={type:t,x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,color:c,w,arrowSize:0,fill:false,fillColor:c};
    d.shapes.push(Object.assign(base, typeDefaults[t]||{}));
    selected={page:n,arrName:'shapes',idx:d.shapes.length-1}; openProps(); }
  else if(t==='highlighter'){ if(pts.length>1){ pushHistory();
    const base={points:pts.slice(),color:c,w:w*3,opacity:0.35};
    d.paths.push(Object.assign(base, typeDefaults.highlighter||{}));
    selected={page:n,arrName:'paths',idx:d.paths.length-1}; openProps(); } }
  else if(t==='callout'){ pushHistory();
    // Callouts are fixed-size boxes now (resizable via the corner handle). The box sits on the
    // far side of where the drag was released, with its edge-middle at that point, so the
    // leader naturally attaches to the side facing the arrow tip.
    const bw=0.16, bh=0.055, right=p2.x>=p1.x;
    const fx=Math.max(0,Math.min(1-bw,right?p2.x:p2.x-bw)), fy=Math.max(0,Math.min(1-bh,p2.y-bh/2));
    const base={fx,fy,boxW:bw,boxH:bh,text:'Note',color:c,textColor:c,size:parseInt(sizePick.value),align:'left',bg:false,bgColor:'#ffffff',
      leader:{x:p1.x,y:p1.y},arrowSize:8,legLength:0.03,borderW:1};
    Object.assign(base, typeDefaults.callout||{}); base.leader={x:p1.x,y:p1.y}; base.fx=fx; base.fy=fy; base.boxW=bw; base.boxH=bh;
    d.texts.push(base);
    selected={page:n,arrName:'texts',idx:d.texts.length-1}; openProps(); }
  else if(t==='text'){ let bw=Math.abs(p2.x-p1.x), bh=Math.abs(p2.y-p1.y);
    if(bw<0.02||bh<0.015){ bw=0.15; bh=0.045; }
    pushHistory();
    const base={fx:Math.min(p1.x,p2.x),fy:Math.min(p1.y,p2.y),boxW:bw,boxH:bh,text:'Text',color:c,size:parseInt(sizePick.value),align:'left',bg:false,bgColor:'#ffffff',leader:null,borderW:0};
    Object.assign(base, typeDefaults.text||{}); base.fx=Math.min(p1.x,p2.x); base.fy=Math.min(p1.y,p2.y); base.boxW=bw; base.boxH=bh;
    d.texts.push(base);
    selected={page:n,arrName:'texts',idx:d.texts.length-1}; openProps(); }
}

async function finishScale(){
  const d0=distPts(pendingPoints[0],pendingPoints[1]); clearPending();
  const val=await modalPrompt('Enter the real-world length of that line (e.g. "10 ft" or "3.5 m"):','10 ft');
  if(!val) return;
  const m=val.match(/([\d.]+)\s*([a-zA-Z"'\u2032\u2033]*)/);
  if(!m||!parseFloat(m[1])){ await modalAlert('Could not read that value — scale not set.'); return; }
  const num=parseFloat(m[1]), unit=m[2]||'units';
  applyScale(d0/num,unit,null);
}
function finishLength(){
  const n=drawPage, c=colorPick.value;
  const d0=distPts(pendingPoints[0],pendingPoints[1]);
  const value=scaleInfo?d0/scaleInfo.pointsPerUnit:d0, unit=scaleInfo?scaleInfo.unit:'pt';
  pushHistory();
  pd(n).measurements.push({type:'length',points:pendingPoints.slice(),value,unit,color:c,w:parseInt(widthPick.value),fontSize:11,textColor:c,arrowSize:8});
  clearPending(true);
  selected={page:n,arrName:'measurements',idx:pd(n).measurements.length-1}; openProps(); renderAll(); renderProps();
}
function finishArea(){
  if(pendingPoints.length<3) return;
  const n=drawPage, c=colorPick.value, pts=pendingPoints.slice();
  const a0=areaPts(pts);
  const value=scaleInfo?a0/(scaleInfo.pointsPerUnit**2):a0, unit=scaleInfo?scaleInfo.unit+'\u00b2':'pt\u00b2';
  pushHistory();
  pd(n).measurements.push({type:'area',points:pts,value,unit,color:c,w:parseInt(widthPick.value),fontSize:11,textColor:c});
  clearPending(true);
  selected={page:n,arrName:'measurements',idx:pd(n).measurements.length-1}; openProps(); renderAll(); renderProps();
}
// Polygon / polyline / cloud: a plain shape defined by clicked corners (cloud keeps the plain
// corners and re-derives its scalloped outline at render time, so moving a corner re-puffs it).
function finishMultiShape(t){
  const minPts=t==='polyline'?2:3; if(pendingPoints.length<minPts) return;
  const n=drawPage, c=colorPick.value, pts=pendingPoints.slice();
  pushHistory();
  const base={type:t,points:pts,color:c,w:parseInt(widthPick.value),fill:false,fillColor:c};
  if(t==='cloud') base.bump=0.012;
  Object.assign(base, typeDefaults[t]||{}); base.type=t; base.points=pts;
  pd(n).shapes.push(base);
  clearPending(true);
  selected={page:n,arrName:'shapes',idx:pd(n).shapes.length-1}; openProps(); renderAll(); renderProps();
}
