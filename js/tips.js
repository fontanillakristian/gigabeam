/* tips.js - Tool names on hover.
   1. The "Tool:" label in the options bar shows the name of whatever toolbar button the mouse is over, live, and goes back to the active tool when the mouse leaves.
   2. A name tag appears next to a button once the mouse has rested on it for 1.5 seconds (and goes away when the mouse leaves or you click). */
const TIP_DELAY=1500;
let tipEl=null, tipTarget=null, tipTimer=null, tipSuppressed=null;
const tipText=el=>el&&el.dataset?(el.dataset.tip||''):'';
// the plain name of a button: a tool's title, else its tooltip text without the "(shortcut)" or ": explanation" tail
function toolNameOf(el){
  if(!el) return '';
  if(el.dataset.tool&&TOOL_TITLES[el.dataset.tool]) return TOOL_TITLES[el.dataset.tool];
  return tipText(el).replace(/\s*\([^)]*\)\s*$/,'').replace(/:.*$/,'').trim();
}
function hideTip(){ clearTimeout(tipTimer); tipTimer=null; if(tipEl){ tipEl.remove(); tipEl=null; } }
function showTip(el){
  hideTip(); const t=tipText(el); if(!t||!el.isConnected) return;
  tipEl=document.createElement('div'); tipEl.className='tip'; tipEl.textContent=t; document.body.appendChild(tipEl);
  const r=el.getBoundingClientRect(), w=tipEl.offsetWidth, h=tipEl.offsetHeight, side=el.closest('#rail-left')?'right':el.closest('#rail-right')?'left':el.closest('#status')?'top':'bottom';
  let x,y;
  if(side==='right'){ x=r.right+8; y=r.top+r.height/2-h/2; } else if(side==='left'){ x=r.left-8-w; y=r.top+r.height/2-h/2; }
  else{ x=r.left+r.width/2-w/2; y=side==='top'?r.top-8-h:r.bottom+8; }
  tipEl.style.left=Math.max(6,Math.min(innerWidth-w-6,x))+'px'; tipEl.style.top=Math.max(6,Math.min(innerHeight-h-6,y))+'px';
}
// what the "Tool:" label should say right now
function showToolName(){
  const b=$('tool-name'), over=tipTarget&&(tipTarget.matches('.tool,.rib-btn'))?toolNameOf(tipTarget):'';
  if(over){ b.textContent=over; b.classList.add('peek'); }
  else{ b.classList.remove('peek'); b.textContent=TOOL_TITLES[tool]||(tool==='areapick'?'Select area':''); }
}
let tipFrame=false, tipPoint=null;
document.addEventListener('mousemove',e=>{
  tipPoint=e; if(tipFrame) return; tipFrame=true;
  requestAnimationFrame(()=>{ tipFrame=false;
    // elementFromPoint also finds disabled buttons (they get no mouse events of their own)
    const el=tipPoint&&document.elementFromPoint(tipPoint.clientX,tipPoint.clientY), tgt=el&&el.closest?el.closest('[data-tip]'):null;
    if(tgt===tipTarget) return;
    tipTarget=tgt; tipSuppressed=null; hideTip(); showToolName();
    if(tgt) tipTimer=setTimeout(()=>{ if(tipTarget===tgt&&tipSuppressed!==tgt) showTip(tgt); },TIP_DELAY);
  });
},{passive:true});
document.addEventListener('mouseleave',()=>{ tipTarget=null; hideTip(); showToolName(); });
document.addEventListener('mousedown',()=>{ tipSuppressed=tipTarget; hideTip(); },true); // a click answers the question: drop the tag
document.addEventListener('keydown',()=>{ hideTip(); },true);
addEventListener('blur',()=>{ tipTarget=null; hideTip(); showToolName(); });
// keep the label right when the active tool changes
{ const ut=updateToolButtons; updateToolButtons=function(){ const r=ut.apply(this,arguments); showToolName(); return r; }; }
