/* touch.js - Touch and pen input.
   The editing code listens for mouse events, so pen and touch pointers are translated into the equivalent mouse events:
   - a pen always acts like a mouse (draw, move, resize);
   - a finger acts like a mouse when a drawing tool is active, or when it starts on a markup / text box;
   - a finger on blank page keeps scrolling natively, and two fingers pinch-zoom the document. */
(function(){
  'use strict';
  const drawing=()=>tool!=='select'&&tool!=='pan';
  const isControl=el=>!!el&&(el.isContentEditable||/^(TEXTAREA|INPUT|SELECT|BUTTON|OPTION)$/.test(el.tagName));
  // is this element a markup / text box the user can grab? (svg children live inside .pg-svg)
  const onObject=el=>!!el&&((el.closest&&el.closest('.ann')&&!isControl(el))||(el.ownerSVGElement&&el.ownerSVGElement.classList&&el.ownerSVGElement.classList.contains('pg-svg')));
  const fire=(type,x,y,target)=>{
    const t=target||document.elementFromPoint(x,y)||document.body;
    t.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,view:window,button:0,buttons:type==='mouseup'||type==='click'||type==='dblclick'?0:1}));
    return t;
  };

  let act=null, lastTap={t:0,x:0,y:0};
  const fingers=new Map(); let pinch=null;

  function pinchDist(){ const p=Array.from(fingers.values()); return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1; }
  function endPinch(apply){
    if(!pinch) return; const cont=document.getElementById('pages-container');
    if(cont){ cont.style.transform=''; cont.style.transformOrigin=''; }
    const r=pinch.ratio; pinch=null;
    if(apply&&pdfDoc&&Math.abs(r-1)>0.03) setZoom(scale*r,{view:true});
  }

  main.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'||isControl(e.target)) return;
    if(e.pointerType==='touch'){ // keep track of fingers for pinch-zoom
      fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(fingers.size===2&&!act){ const cont=document.getElementById('pages-container'), mid=Array.from(fingers.values()).reduce((s,p)=>({x:s.x+p.x/2,y:s.y+p.y/2}),{x:0,y:0});
        if(cont){ const cr=cont.getBoundingClientRect(); cont.style.transformOrigin=(mid.x-cr.left)+'px '+(mid.y-cr.top)+'px'; }
        pinch={d0:pinchDist(),ratio:1}; return; }
    }
    if(e.pointerType==='touch'&&!(drawing()||onObject(e.target))) return; // blank page: let the browser scroll
    if(!e.isPrimary||act) return;
    e.preventDefault();
    act={id:e.pointerId,x0:e.clientX,y0:e.clientY,t0:Date.now(),moved:false,target:e.target};
    try{ main.setPointerCapture(e.pointerId); }catch(_){} // keep receiving this finger even when the overlay under it is rebuilt mid-drag
    fire('mousedown',e.clientX,e.clientY,e.target);
  },{passive:false});

  window.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'&&fingers.has(e.pointerId)){
      fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pinch&&fingers.size===2){ pinch.ratio=Math.min(3,Math.max(0.3,pinchDist()/pinch.d0)); const cont=document.getElementById('pages-container'); if(cont) cont.style.transform='scale('+pinch.ratio+')'; return; }
    }
    if(!act||e.pointerId!==act.id) return;
    e.preventDefault();
    if(!act.moved&&Math.hypot(e.clientX-act.x0,e.clientY-act.y0)>6) act.moved=true;
    fire('mousemove',e.clientX,e.clientY);
  },{passive:false});

  function finish(e,cancelled){
    if(e.pointerType==='touch'){ fingers.delete(e.pointerId); if(pinch&&fingers.size<2) endPinch(!cancelled); }
    if(!act||e.pointerId!==act.id) return;
    const a=act; act=null;
    const el=fire('mouseup',e.clientX,e.clientY);
    if(cancelled||a.moved||Date.now()-a.t0>700) return;
    fire('click',e.clientX,e.clientY,el); // a tap: what a mouse click would do (placing points, selecting, toggling fields)
    const now=Date.now();
    if(now-lastTap.t<350&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<30){ fire('dblclick',e.clientX,e.clientY,el); lastTap={t:0,x:0,y:0}; } // double-tap finishes a shape
    else lastTap={t:now,x:e.clientX,y:e.clientY};
  }
  window.addEventListener('pointerup',e=>finish(e,false));
  window.addEventListener('pointercancel',e=>finish(e,true));
  // iOS Safari zooms the whole app on a pinch outside the pages (toolbars, panels) despite the viewport settings; only the document zooms
  document.addEventListener('gesturestart',e=>e.preventDefault());
})();
