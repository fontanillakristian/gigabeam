/* detect.js - "Detect form fields": finds the blanks of a form that isn't fillable and suggests a blank text box for each line / empty box,
   and a checkbox for each small square. Suggestions are shown for review first; accepted ones become normal markup text boxes and
   checkbox fields. Works from the PDF's drawing (lines, rectangles) and text, and, on scanned pages, from the page image plus OCR text.
   Everything here is in fractions of the visible page (like markups); "pt" sizes are converted with the page size W x H in points. */
let detectSug={}; // page -> [{id, kind:'text'|'checkbox', x0,y0,x1,y1, label}]
let detectSeq=0;

// ---- reading a page
// Text on the page as label boxes: the PDF's text (underscore runs split out, they are blanks, not labels) or the OCR words.
async function detectTexts(n,vp){
  const labels=[], blanks=[];
  if(ocrPages[n]){ ocrPages[n].words.forEach(w=>{ const b={s:w.t,x0:w.x0,y0:w.y0,x1:w.x1,y1:w.y1}, wp=(w.x1-w.x0)*vp.width, hp=(w.y1-w.y0)*vp.height;
      if(/^_{3,}$/.test(w.t)) blanks.push(b);
      else if(w.t.length<=3&&/^[\[\](){}|JIlOo0DUu□☐■▢]+$/.test(w.t)&&wp>=5&&wp<=26&&Math.abs(wp-hp)<=Math.max(3,0.35*wp)) blanks.push(Object.assign(b,{box:true})); // OCR reading a checkbox square as "[J]", "[]", "O"…
      else labels.push(b); }); return {labels,blanks}; }
  const tc=await pageTextContent(n); if(!tc) return {labels,blanks};
  tc.items.forEach(it=>{
    const s=it.str||''; if(!s.trim()) return;
    let last=0; const re=/_{3,}/g; let m;
    const part=(a,b)=>{ const t=s.slice(a,b); if(t.trim()){ const lead=t.length-t.trimStart().length, trail=t.length-t.trimEnd().length; labels.push(Object.assign({s:t.trim()},itemRect(it,vp,a+lead,b-trail))); } };
    while((m=re.exec(s))){ part(last,m.index); blanks.push(itemRect(it,vp,m.index,m.index+m[0].length)); last=m.index+m[0].length; }
    part(last,s.length);
    [...s].forEach((ch,i)=>{ if(ch==='☐'||ch==='□'||ch==='❑'||ch==='▢') blanks.push(Object.assign({box:true},itemRect(it,vp,i,i+1))); }); // box characters
  });
  return {labels,blanks};
}
// Lines and rectangles the page draws (from its PDF drawing commands), in page fractions
async function detectVector(page,vp,W,H){
  const O=pdfjsLib.OPS, U=pdfjsLib.Util, hsegs=[], vsegs=[], rects=[]; let paths=0;
  let ops; try{ ops=await page.getOperatorList(); }catch(e){ return {hsegs,vsegs,rects,paths}; }
  const toF=(ctm,x,y)=>{ const p=U.applyTransform([x,y],ctm), q=vp.convertToViewportPoint(p[0],p[1]); return {x:q[0]/W,y:q[1]/H}; };
  let ctm=[1,0,0,1,0,0]; const stack=[]; let pend=[]; // pending subpaths of the current path: arrays of points, or {rect:[4 points]}
  const box=pts=>{ const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y); return {x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)}; };
  const addBox=b=>{ const wp=(b.x1-b.x0)*W, hp=(b.y1-b.y0)*H;
    if(hp<=3&&wp>=36) hsegs.push({x0:b.x0,x1:b.x1,y:(b.y0+b.y1)/2}); else if(wp>=5&&hp>=5) rects.push(b); };
  const axisRect=pts=>{ if(pts.length<4||pts.length>5) return null; const b=box(pts), tol=1.2;
    return pts.every(p=>(Math.abs(p.x-b.x0)*W<tol||Math.abs(p.x-b.x1)*W<tol)&&(Math.abs(p.y-b.y0)*H<tol||Math.abs(p.y-b.y1)*H<tol))?b:null; };
  const flush=paint=>{ if(paint) pend.forEach(sp=>{ paths++;
      if(sp.rect){ addBox(box(sp.rect)); return; }
      const r=axisRect(sp.pts); if(r&&(r.x1-r.x0)*W>=5&&(r.y1-r.y0)*H>=5){ addBox(r); return; }
      for(let i=1;i<sp.pts.length;i++){ const a=sp.pts[i-1], b=sp.pts[i], dx=Math.abs(b.x-a.x)*W, dy=Math.abs(b.y-a.y)*H; if(dy<1&&dx>=36) hsegs.push({x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),y:(a.y+b.y)/2}); else if(dx<1&&dy>=8) vsegs.push({x:(a.x+b.x)/2,y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)}); } });
    pend=[]; };
  const PAINT=new Set([O.stroke,O.closeStroke,O.fill,O.eoFill,O.fillStroke,O.eoFillStroke,O.closeFillStroke,O.closeEOFillStroke]);
  for(let i=0;i<ops.fnArray.length;i++){
    const fn=ops.fnArray[i], args=ops.argsArray[i];
    if(fn===O.save) stack.push(ctm); else if(fn===O.restore) ctm=stack.pop()||[1,0,0,1,0,0];
    else if(fn===O.transform) ctm=U.transform(ctm,args);
    else if(fn===O.paintFormXObjectBegin){ stack.push(ctm); if(args&&args[0]) ctm=U.transform(ctm,args[0]); }
    else if(fn===O.paintFormXObjectEnd) ctm=stack.pop()||[1,0,0,1,0,0];
    else if(fn===O.constructPath){
      const sub=args[0], c=args[1]; let k=0, cur=null;
      for(const op of sub){
        if(op===O.rectangle){ const [x,y,w,h]=c.slice(k,k+4); k+=4; pend.push({rect:[toF(ctm,x,y),toF(ctm,x+w,y),toF(ctm,x+w,y+h),toF(ctm,x,y+h)]}); cur=null; }
        else if(op===O.moveTo){ cur={pts:[toF(ctm,c[k],c[k+1])]}; pend.push(cur); k+=2; }
        else if(op===O.lineTo){ if(!cur){ cur={pts:[]}; pend.push(cur); } cur.pts.push(toF(ctm,c[k],c[k+1])); k+=2; }
        else if(op===O.curveTo){ if(cur) cur.pts.push(toF(ctm,c[k+4],c[k+5])); k+=6; }
        else if(op===O.curveTo2||op===O.curveTo3){ if(cur) cur.pts.push(toF(ctm,c[k+2],c[k+3])); k+=4; }
        else if(op===O.closePath){ if(cur&&cur.pts.length) cur.pts.push(cur.pts[0]); }
      }
    }
    else if(PAINT.has(fn)) flush(true); else if(fn===O.endPath) flush(false);
    if(hsegs.length+rects.length>20000) break; // a heavy drawing sheet: enough to work with
  }
  return {hsegs,vsegs,rects,paths};
}
// Scanned page: find horizontal lines and small square boxes in the page image
async function detectRaster(page,W,H){
  const s=Math.min(3,2200/Math.max(W,H)), vp=page.getViewport({scale:s}), cw=Math.floor(vp.width), ch=Math.floor(vp.height);
  const c=document.createElement('canvas'); c.width=cw; c.height=ch; const cx=c.getContext('2d',{willReadFrequently:true}); cx.fillStyle='#fff'; cx.fillRect(0,0,cw,ch);
  await page.render({canvasContext:cx,viewport:vp,annotationMode:pdfjsLib.AnnotationMode.DISABLE}).promise;
  const px=cx.getImageData(0,0,cw,ch).data; c.width=0; c.height=0;
  const dark=new Uint8Array(cw*ch); for(let i=0,j=0;j<dark.length;i+=4,j++) dark[j]=(px[i]+px[i+1]+px[i+2])<420?1:0;
  const minLine=Math.round(36*s), boxMin=Math.round(6*s), boxMax=Math.round(24*s), runs=[], shortRuns=new Map();
  for(let y=0;y<ch;y++){ let x=0; const row=y*cw;
    while(x<cw){ if(!dark[row+x]){ x++; continue; } const x0=x; while(x<cw&&dark[row+x]) x++; const len=x-x0;
      if(len>=minLine) runs.push({y,x0,x1:x-1}); else if(len>=boxMin&&len<=boxMax){ let a=shortRuns.get(y); if(!a) shortRuns.set(y,a=[]); a.push({x0,x1:x-1}); } } }
  // merge long runs on neighbouring rows into lines; keep the thin ones (thick bars are drawings, not blanks)
  const lines=[]; runs.forEach(r=>{ const l=lines.find(q=>r.y-q.y1<=1&&r.y>=q.y1&&Math.min(q.x1,r.x1)-Math.max(q.x0,r.x0)>0.8*Math.min(q.x1-q.x0,r.x1-r.x0));
    if(l){ l.y1=r.y; l.x0=Math.min(l.x0,r.x0); l.x1=Math.max(l.x1,r.x1); } else lines.push({y0:r.y,y1:r.y,x0:r.x0,x1:r.x1}); });
  const hsegs=lines.filter(l=>l.y1-l.y0<=Math.max(2,3*s)).map(l=>({x0:l.x0/cw,x1:l.x1/cw,y:(l.y0+l.y1)/2/ch}));
  // vertical lines (table and box sides): long dark runs down a column, merged across neighbouring columns
  const minV=Math.round(8*s), vcols=[];
  for(let x=0;x<cw;x++){ let y=0; while(y<ch){ if(!dark[y*cw+x]){ y++; continue; } const y0=y; while(y<ch&&dark[y*cw+x]) y++; if(y-y0>=minV) vcols.push({x,y0,y1:y-1}); } }
  const vl=[]; vcols.forEach(r=>{ const l=vl.find(q=>r.x-q.xb<=1&&r.x>=q.xb&&Math.min(q.y1,r.y1)-Math.max(q.y0,r.y0)>0.8*Math.min(q.y1-q.y0,r.y1-r.y0)); if(l){ l.xb=r.x; l.y0=Math.min(l.y0,r.y0); l.y1=Math.max(l.y1,r.y1); } else vl.push({xa:r.x,xb:r.x,y0:r.y0,y1:r.y1}); });
  const vsegs=vl.filter(l=>l.xb-l.xa<=Math.max(2,3*s)).map(l=>({x:(l.xa+l.xb)/2/cw,y0:l.y0/ch,y1:l.y1/ch}));
  // squares: a short top edge with a matching bottom edge one side-length lower, dark left/right edges, and a mostly empty inside
  const colDark=(x,y0,y1)=>{ let d=0; for(let y=y0;y<=y1;y++){ if(dark[y*cw+x]||dark[y*cw+x+1]||dark[y*cw+x-1]) d++; } return d/(y1-y0+1); };
  const boxes=[];
  shortRuns.forEach((arr,y)=>arr.forEach(t=>{
    const L=t.x1-t.x0; if(boxes.some(b=>t.x0>=b.x0-2&&t.x1<=b.x1+2&&y>=b.y0-2&&y<=b.y1+2)) return;
    for(let dy=Math.round(L*0.8);dy<=Math.round(L*1.25);dy++){ const b=shortRuns.get(y+dy); if(!b) continue;
      const m=b.find(q=>Math.abs(q.x0-t.x0)<=2&&Math.abs(q.x1-t.x1)<=2); if(!m) continue;
      if(colDark(Math.max(1,t.x0),y,y+dy)<0.8||colDark(Math.min(cw-2,t.x1),y,y+dy)<0.8) continue;
      let inside=0, tot=0; for(let yy=y+3;yy<y+dy-2;yy++) for(let xx=t.x0+3;xx<t.x1-2;xx++){ tot++; inside+=dark[yy*cw+xx]; }
      if(tot&&inside/tot>0.12) continue;
      boxes.push({x0:t.x0,y0:y,x1:t.x1,y1:y+dy}); break; } }));
  // how much ink a box (page fractions) holds, ignoring a margin at its edges, and where the ink on its right ends — so printed words
  // count as "not blank" even where OCR missed them (it often skips text inside table cells)
  const ink=b=>{ const x0=Math.max(0,Math.round(b.x0*cw)+3), x1=Math.min(cw-1,Math.round(b.x1*cw)-3), y0=Math.max(0,Math.round(b.y0*ch)+3), y1=Math.min(ch-1,Math.round(b.y1*ch)-3);
    if(x1<=x0||y1<=y0) return {ratio:0,right:b.x0}; let d=0, right=-1;
    for(let y=y0;y<=y1;y++){ const row=y*cw; for(let x=x0;x<=x1;x++) if(dark[row+x]){ d++; if(x>right) right=x; } }
    return {ratio:d/((x1-x0+1)*(y1-y0+1)),right:right<0?b.x0:right/cw}; };
  return {hsegs,vsegs,ink,squares:boxes.map(b=>({x0:b.x0/cw,y0:b.y0/ch,x1:b.x1/cw,y1:b.y1/ch}))};
}

// ---- turning geometry into suggestions
const dArea=b=>Math.max(0,b.x1-b.x0)*Math.max(0,b.y1-b.y0);
const dInter=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
const dIoU=(a,b)=>{ const i=dInter(a,b); return i/(dArea(a)+dArea(b)-i||1); };
async function detectPage(n){
  const page=await pdfDoc.getPage(n), vp=page.getViewport({scale:1}), W=vp.width, H=vp.height, pt=v=>v/W, ptY=v=>v/H;
  const {labels,blanks}=await detectTexts(n,vp);
  const vec=await detectVector(page,vp,W,H);
  let hsegs=vec.hsegs.slice(), vsegs=vec.vsegs.slice(), squares=[];
  const scanned=vec.paths<8; // hardly any drawing commands: a scanned image
  let ink=null; if(scanned){ const r=await detectRaster(page,W,H); hsegs=hsegs.concat(r.hsegs); vsegs=vsegs.concat(r.vsegs); squares=r.squares; ink=r.ink; }
  const rects=vec.rects.concat(cellsFromLines(hsegs,vsegs,W,H)); // boxes drawn as rectangles, plus table cells drawn as separate lines
  vec.rects.forEach(b=>{ const wp=(b.x1-b.x0)*W, hp=(b.y1-b.y0)*H; if(wp>=6&&wp<=24&&hp>=6&&hp<=24&&Math.abs(wp-hp)<=Math.max(2,0.2*wp)) squares.push(b); });
  blanks.filter(b=>b.box).forEach(b=>squares.push(b));
  blanks.filter(b=>!b.box).forEach(b=>hsegs.push({x0:b.x0,x1:b.x1,y:b.y0+(b.y1-b.y0)*0.85,from:'text'}));
  const overText=(b,frac)=>labels.some(l=>{ const i=dInter(b,l); return i>frac*dArea(l)||i>frac*dArea(b); });
  const labelH=l=>(l.y1-l.y0)*H, nearLabel=(y)=>{ let best=null; labels.forEach(l=>{ if(Math.abs((l.y0+l.y1)/2-y)<ptY(12)&&(!best||labelH(l)<labelH(best))) best=l; }); return best; };
  const out=[];
  const push=(kind,b,label)=>{ if(b.x1-b.x0<=0||b.y1-b.y0<=0) return; if(out.some(o=>dIoU(o,b)>0.3)) return; out.push({id:++detectSeq,kind,x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1,label:label||''}); };
  // 1) small squares -> checkboxes, named from the words beside them
  squares.forEach(sq=>{ if(overText(sq,0.5)) return; push('checkbox',sq,labelBeside(sq,labels,W)); });
  // 2) empty rectangles (table cells, boxes) -> a text box filling them; a cell with a label on its left gets a box in the empty part
  rects.forEach(b=>{ const wp=(b.x1-b.x0)*W, hp=(b.y1-b.y0)*H; if(wp<40||hp<12||hp>72||wp>0.9*W) return;
    const inner={x0:b.x0+pt(2),y0:b.y0+ptY(2),x1:b.x1-pt(2),y1:b.y1-ptY(2)}, inside=labels.filter(l=>dInter(l,inner)>0.5*dArea(l));
    const inkIn=ink&&!inside.length?ink(inner):null; // a scan: printed words OCR didn't read still count
    if(!inside.length&&!(inkIn&&inkIn.ratio>0.012)){ push('text',inner); return; }
    const emptyNext=rects.some(r=>Math.abs(r.x0-b.x1)*W<2&&Math.min(r.y1,b.y1)-Math.max(r.y0,b.y0)>0.7*(b.y1-b.y0)&&(r.x1-r.x0)*W>=40&&!labels.some(l=>dInter(l,r)>0.5*dArea(l))&&!(ink&&ink(r).ratio>0.012));
    if(emptyNext) return; // a label cell of a table: the empty cell beside it is the blank
    const right=(inside.length?Math.max(...inside.map(l=>l.x1)):inkIn.right)+pt(4); if((inner.x1-right)*W>=50&&!inside.some(l=>l.x0>right)) push('text',{x0:right,y0:inner.y0,x1:inner.x1,y1:inner.y1},inside.map(l=>l.s).join(' ')); });
  // 3) blank lines (rules, underscores) -> a text box sitting on the line
  hsegs.sort((a,b)=>a.y-b.y||a.x0-b.x0);
  const merged=[]; hsegs.forEach(s=>{ const m=merged.find(q=>Math.abs(q.y-s.y)<ptY(1.5)&&s.x0<=q.x1+pt(2)&&s.x1>=q.x0-pt(2)); if(m){ m.x0=Math.min(m.x0,s.x0); m.x1=Math.max(m.x1,s.x1); } else merged.push(Object.assign({},s)); });
  merged.forEach(s=>{ const wp=(s.x1-s.x0)*W; if(wp<36||wp>0.75*W) return;
    if(hsegs.some(h=>h.grid&&Math.abs(h.y-s.y)<ptY(2)&&Math.min(h.x1,s.x1)-Math.max(h.x0,s.x0)>0.5*(s.x1-s.x0))) return; // a table / box border, not a blank line
    const side=x=>vsegs.some(v=>Math.abs(v.x-x)<pt(3)&&v.y0<s.y+ptY(2)&&v.y1>s.y-ptY(2)); if(side(s.x0)&&side(s.x1)) return; // closed off at both ends: the bottom of a box
    const near=nearLabel(s.y-ptY(6)), hp=Math.max(12,Math.min(20,near?labelH(near)*1.5:16));
    const b={x0:s.x0,y0:s.y-ptY(hp+1),x1:s.x1,y1:s.y-ptY(1)};
    if(b.y0<0||overText(b,0.3)||(ink&&ink(b).ratio>0.02)) return; // text already sits on this line: it's an underline or a table rule, not a blank
    if(rects.some(r=>{ const rw=(r.x1-r.x0)*W, rh=(r.y1-r.y0)*H; return rw>=40&&rh>=12&&rh<=72&&dInter(r,b)>0.6*dArea(b); })) return; // already covered by a box
    push('text',b,labelLeft(b,labels,W)); });
  return out;
}
// Table cells drawn as separate lines: between two neighbouring horizontal lines, the vertical lines that join them split the band
// into cells. Lines used this way are marked .grid (borders, not blanks).
function cellsFromLines(hsegs,vsegs,W,H){
  const out=[], hs=hsegs.slice().sort((a,b)=>a.y-b.y), tolX=3/W, tolY=3/H;
  hs.forEach((A,i)=>{
    for(let j=i+1;j<hs.length;j++){ const B=hs[j], gap=(B.y-A.y)*H; if(gap<10) continue; if(gap>80) break;
      const ox0=Math.max(A.x0,B.x0), ox1=Math.min(A.x1,B.x1); if((ox1-ox0)*W<40) continue;
      const xs=vsegs.filter(v=>v.x>=ox0-tolX&&v.x<=ox1+tolX&&v.y0<=A.y+tolY&&v.y1>=B.y-tolY).map(v=>v.x).sort((p,q)=>p-q);
      const ux=[]; xs.forEach(x=>{ if(!ux.length||(x-ux[ux.length-1])*W>3) ux.push(x); });
      if(ux.length<2) continue;
      for(let k=1;k<ux.length;k++) if((ux[k]-ux[k-1])*W>=20) out.push({x0:ux[k-1],y0:A.y,x1:ux[k],y1:B.y});
      A.grid=true; B.grid=true; break; } });
  return out;
}
function labelBeside(sq,labels,W){ // words just right of a box (or just left), on the same row
  const cy=(sq.y0+sq.y1)/2, h=sq.y1-sq.y0, row=labels.filter(l=>Math.abs((l.y0+l.y1)/2-cy)<h*0.9);
  const right=row.filter(l=>l.x0>=sq.x1-1/W&&(l.x0-sq.x1)*W<30).sort((a,b)=>a.x0-b.x0);
  const pick=right.length?right:row.filter(l=>l.x1<=sq.x0+1/W&&(sq.x0-l.x1)*W<30).sort((a,b)=>b.x1-a.x1);
  if(!pick.length) return '';
  const words=[pick[0]]; for(const l of pick.slice(1)){ if((l.x0-words[words.length-1].x1)*W>8||words.length>=5) break; words.push(l); }
  return words.map(l=>l.s).join(' ').replace(/[:_]+$/,'').trim();
}
function labelLeft(b,labels,W){ // the words just left of a blank, on the same row ("Owner name:")
  const cy=(b.y0+b.y1)/2, h=b.y1-b.y0, row=labels.filter(l=>Math.abs((l.y0+l.y1)/2-cy)<h&&l.x1<=b.x0+2/W).sort((p,q)=>q.x1-p.x1);
  if(!row.length||(b.x0-row[0].x1)*W>80) return '';
  const words=[row[0]]; for(const l of row.slice(1)){ if((words[words.length-1].x0-l.x1)*W>8||words.length>=5) break; words.push(l); }
  return words.reverse().map(l=>l.s).join(' ').replace(/[:_]+$/,'').trim();
}

// ---- running it
async function runDetect(pages){
  const doc=pdfDoc; let found=0, cancelled=false; const cancel=()=>{ cancelled=true; };
  bgTask('Looking for form fields…',0,cancel);
  try{
    for(let i=0;i<pages.length;i++){ const n=pages[i];
      if(cancelled||pdfDoc!==doc) break;
      bgTask(`Looking for form fields: page ${n} (${i+1} of ${pages.length})`,i/pages.length*100,cancel);
      const existing=pd(n), taken=[...(existing.texts||[]).map(t=>({x0:t.fx,y0:t.fy,x1:t.fx+(t.boxW||0.05),y1:t.fy+(t.boxH||0.02)})),...(existing.fields||[]).map(f=>({x0:Math.min(f.x1,f.x2),y0:Math.min(f.y1,f.y2),x1:Math.max(f.x1,f.x2),y1:Math.max(f.y1,f.y2)}))];
      const sug=(await detectPage(n)).filter(s=>!taken.some(t=>dIoU(t,s)>0.3)); // skip blanks that already have a box or field
      if(sug.length) detectSug[n]=sug; else delete detectSug[n];
      found+=sug.length; drawDetect(); await tick();
    }
  }catch(err){ await modalAlert('Field detection failed: '+esc(err.message||String(err))); }
  finally{ bgTask(null); }
  if(!found) toast(cancelled?'Detection stopped':'No form fields found on '+(pages.length===1?'this page':'those pages'));
  else{ const p=Object.keys(detectSug).map(Number).sort((a,b)=>a-b)[0]; if(p&&!pages.includes(currentPage)) goToPage(p); }
  drawDetect();
}
async function detectDialog(){
  if(!pdfDoc) return;
  const r=await dialog({title:'Detect form fields',ok:'Detect',
    body:`<div class="sub" style="margin-bottom:10px">Finds the blanks of a form (lines, empty boxes, small squares) and suggests a blank text box or a checkbox for each. You review the suggestions before anything is added.</div>
      <label class="chk"><input type="radio" name="dt-pg" value="cur" checked> Current page (${currentPage})</label>
      <label class="chk"><input type="radio" name="dt-pg" value="all"> All pages (${numPages})</label>
      <label class="chk"><input type="radio" name="dt-pg" value="range"> Pages <input id="dt-range" class="ctl" style="width:120px;margin-left:6px" placeholder="e.g. 1-3, 7"></label>
      <div class="sub" style="margin-top:10px">Scanned pages: run <b>Recognize text (OCR)</b> first, so labels are found and printed words aren't mistaken for blanks.</div>`,
    onReady:ov=>{ const rg=ov.querySelector('#dt-range'), pick=()=>{ ov.querySelector('input[value="range"]').checked=true; }; rg.addEventListener('focus',pick); rg.addEventListener('input',pick); },
    collect:(ov,setErr)=>{ const mode=ov.querySelector('input[name="dt-pg"]:checked').value; let pages=[];
      if(mode==='cur') pages=[currentPage]; else if(mode==='all') for(let i=1;i<=numPages;i++) pages.push(i);
      else { pages=parsePageList(ov.querySelector('#dt-range').value,numPages); if(!pages.length){ setErr('Enter pages like 1-3, 7'); return undefined; } }
      return pages; }});
  if(r) runDetect(r);
}

// ---- review: suggestions drawn on the pages, accepted one by one, per page, or all at once
function detectCount(){ let t=0,c=0; Object.values(detectSug).forEach(a=>a.forEach(s=>{ if(s.kind==='checkbox') c++; else t++; })); return {t,c,all:t+c}; }
function drawDetect(){
  pageViews.forEach(v=>{ const old=v.stage.querySelector('.detect-layer'); if(old) old.remove(); });
  Object.keys(detectSug).forEach(p=>{ const v=pageViews[p-1]; if(!v) return;
    const layer=document.createElement('div'); layer.className='detect-layer';
    detectSug[p].forEach(s=>{ const d=document.createElement('div'); d.className='dsug '+s.kind; d.dataset.id=s.id;
      d.style.left=(s.x0*v.w)+'px'; d.style.top=(s.y0*v.h)+'px'; d.style.width=((s.x1-s.x0)*v.w)+'px'; d.style.height=((s.y1-s.y0)*v.h)+'px';
      d.title=(s.kind==='checkbox'?'Checkbox':'Text box')+(s.label?' · '+s.label:'')+' (suggested)';
      d.innerHTML=`<span class="dtag">${s.kind==='checkbox'?'☐':'T'}</span><span class="dact"><button class="ok" title="Add this one">✓</button><button class="no" title="Discard this one">✕</button></span>`;
      d.querySelector('.ok').onclick=e=>{ e.stopPropagation(); acceptSuggestions(+p,[s.id]); };
      d.querySelector('.no').onclick=e=>{ e.stopPropagation(); discardSuggestion(+p,s.id); };
      d.addEventListener('mousedown',e=>e.stopPropagation());
      layer.appendChild(d); });
    v.stage.appendChild(layer); });
  const bar=$('detect-bar'), k=detectCount();
  bar.hidden=!k.all;
  if(k.all) $('detect-msg').innerHTML=`<b>${k.all}</b> suggested field${k.all===1?'':'s'} <span>(${k.t} text box${k.t===1?'':'es'}, ${k.c} checkbox${k.c===1?'':'es'})</span>`;
}
// make real objects from suggestions
function acceptSuggestions(page,ids){
  const pagesToDo=page==null?Object.keys(detectSug).map(Number):[page]; let made=0, pushed=false;
  pagesToDo.forEach(p=>{ const list=detectSug[p]; if(!list) return; const d=pd(p), v=pageViews[p-1]; if(!v) return;
    list.filter(s=>!ids||ids.includes(s.id)).forEach(s=>{
      if(!pushed){ pushHistory(); pushed=true; }
      if(s.kind==='checkbox'){
        const used=new Set(allFields().map(f=>f.name)), base=(s.label||'Checkbox').replace(/[^\w \-]/g,'').trim().slice(0,30)||'Checkbox'; let name=base, i=2; while(used.has(name)) name=base+' '+(i++);
        d.fields.push(Object.assign(FIELD_BASE(),{type:'checkbox',x1:s.x0,y1:s.y0,x2:s.x1,y2:s.y1},clone(fieldDefaults.checkbox||{}),{name,tooltip:s.label||'',checkStyle:(fieldDefaults.checkbox&&fieldDefaults.checkbox.checkStyle)||'check',exportValue:'Yes',checked:false,defChecked:false}));
      }else{
        const hpt=(s.y1-s.y0)*v.ptsH, size=Math.max(7,Math.min(14,Math.round(hpt*0.62)));
        const t={fx:s.x0,fy:s.y0,boxW:s.x1-s.x0,boxH:s.y1-s.y0,text:'',color:'#1a1a1a',size,align:'left',bg:false,bgColor:'#ffffff',leader:null,borderW:0};
        Object.assign(t,typeDefaults.text||{}); Object.assign(t,{fx:s.x0,fy:s.y0,boxW:s.x1-s.x0,boxH:s.y1-s.y0,text:'',leader:null,size}); d.texts.push(t);
      }
      made++; });
    detectSug[p]=list.filter(s=>ids&&!ids.includes(s.id)); if(!detectSug[p].length) delete detectSug[p]; });
  if(made){ renderAll(); renderProps(); toast(`Added ${made} field${made===1?'':'s'}`); }
  drawDetect();
}
function discardSuggestion(page,id){ if(!detectSug[page]) return; detectSug[page]=detectSug[page].filter(s=>s.id!==id); if(!detectSug[page].length) delete detectSug[page]; drawDetect(); }
function clearDetect(){ detectSug={}; drawDetect(); }
$('detect-btn').onclick=detectDialog;
$('detect-all').onclick=()=>acceptSuggestions(null,null);
$('detect-page').onclick=()=>{ if(detectSug[currentPage]) acceptSuggestions(currentPage,null); else toast('No suggestions on this page'); };
$('detect-clear').onclick=clearDetect;
{ const ra=renderAll; renderAll=function(){ ra.apply(this,arguments); if(Object.keys(detectSug).length) drawDetect(); }; } // page views are rebuilt on zoom
{ // suggestions belong to one document state: a page operation, an undo of one, or switching tabs makes them stale
  const rw=reloadWorkingDoc, lt=loadTab;
  reloadWorkingDoc=function(){ if(Object.keys(detectSug).length) clearDetect(); return rw.apply(this,arguments); };
  loadTab=function(){ if(Object.keys(detectSug).length) clearDetect(); return lt.apply(this,arguments); };
}
