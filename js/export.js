/* export.js - Saving: writes markups into the PDF as real annotations, then handles download and print. */
async function buildExportBytes(){
    const {PDFDocument,rgb,degrees,PDFName,PDFRef,PDFHexString,drawText,drawLine,setFillingColor,rectangle,fill,breakTextIntoLines,lineSplit,cleanText,StandardFonts,
      pushGraphicsState,popGraphicsState,setGraphicsState,moveTo,lineTo,closePath,stroke,setStrokingColor,setLineWidth,setDashPattern,concatTransformationMatrix,drawObject,
      appendBezierCurve,setLineCap,setLineJoin,LineCapStyle,LineJoinStyle}=PDFLib;
    const pdf=await loadPdf(originalBytes);
    const font=await pdf.embedFont(StandardFonts.Helvetica);
    const faceCache={Helvetica:font}; // the standard fonts text boxes use, embedded once each, on demand
    const faceFor=async a=>{ const nm=textStdName(a); if(!faceCache[nm]) faceCache[nm]=await pdf.embedFont(StandardFonts[nm]); return faceCache[nm]; };
    const pages=pdf.getPages();
    const ctxP=pdf.context;
    const hexArr=h=>{ h=h.replace('#',''); return [parseInt(h.substr(0,2),16)/255, parseInt(h.substr(2,2),16)/255, parseInt(h.substr(4,2),16)/255]; };
    const xy=(fx,fy,W,H)=>({x:fx*W,y:H-fy*H});
    const winSafe=s=>Array.from(String(s)).map(ch=>{ try{ font.encodeText(ch); return ch; }catch(e){ return '?'; } }).join(''); // the standard font only covers Western characters
    // Strip any annotations this app previously wrote (tagged CEK/CED) so re-saving
    // doesn't duplicate them — the in-app state (possibly edited/deleted) is authoritative.
    // Image stamps also own a private copy of the image bytes (/CEI) and an image XObject; drop those
    // objects too so repeated open/save cycles don't keep piling up orphaned image data.
    const dropObj=r=>{ if(r instanceof PDFRef) ctxP.delete(r); };
    function purgeImageStamp(d){
      try{ const cek=d.get(PDFName.of('CEK')); if(!cek||!cek.decodeText||cek.decodeText()!=='image') return;
        const ap=ctxP.lookup(d.get(PDFName.of('AP'))), nRef=ap&&ap.get?ap.get(PDFName.of('N')):null;
        if(nRef instanceof PDFRef){ const st=ctxP.lookup(nRef), res=st&&st.dict?ctxP.lookup(st.dict.get(PDFName.of('Resources'))):null,
          xo=res&&res.get?ctxP.lookup(res.get(PDFName.of('XObject'))):null, imRef=xo&&xo.get?xo.get(PDFName.of('Im1')):null;
          if(imRef instanceof PDFRef){ const ist=ctxP.lookup(imRef); if(ist&&ist.dict) dropObj(ist.dict.get(PDFName.of('SMask'))); dropObj(imRef); }
          dropObj(nRef); }
        dropObj(d.get(PDFName.of('CEI')));
      }catch(e){}
    }
    // A flattened page keeps its hidden originals (F=2) in the file so it can be unflattened; those survive the purge.
    const keptFlat=(d,n)=>{ const F=d.get(PDFName.of('F')); return flatPages.has(n)&&F&&F.asNumber&&(F.asNumber()&2)===2; };
    const keptWidgetRefs=[]; // hidden form widgets of flattened pages stay registered in the AcroForm
    pages.forEach((page,pgi)=>{
      const arr=page.node.Annots(); if(!arr) return;
      for(let i=arr.size()-1;i>=0;i--){
        const ref=arr.get(i), d=ctxP.lookup(ref);
        if(d && d.get && d.get(PDFName.of('CEK'))){ if(keptFlat(d,pgi+1)){ keptWidgetRefs.push(ref); continue; } purgeImageStamp(d); arr.remove(i); dropObj(ref); }
      }
    });
    // Builds a real PDF annotation dict (not flattened page content) so the markup
    // stays a discrete, editable object in Acrobat/Bluebeam/Foxit/etc. `textFields`
    // (Contents/DA/CED) are written as hex strings so multi-line/unicode text survives
    // intact. CEK/CED are a private tag holding the exact in-app object as JSON, so this
    // app can perfectly reconstruct and re-edit its own annotations on a later re-open.
    // Everything below is authored in the DISPLAY frame (what you see, y-up, in points). addAnnot maps it
    // into real page space, honouring /Rotate and the CropBox origin, and gives appearance streams a
    // /Matrix so drawn text/lines/images stay upright on rotated pages.
    let curGeo=null;
    function addAnnot(page, dictObj, textFields){
      const g=curGeo;
      const pair=arr=>{ const o=[]; for(let i=0;i+1<arr.length;i+=2){ const p=g.toUser(arr[i],arr[i+1]); o.push(p.x,p.y); } return o; };
      const r=dictObj.Rect, cs=[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]].map(([x,y])=>g.toUser(x,y)), xs=cs.map(c=>c.x), ys=cs.map(c=>c.y);
      dictObj.Rect=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
      if(dictObj.L) dictObj.L=pair(dictObj.L);
      if(dictObj.CL) dictObj.CL=pair(dictObj.CL);
      if(dictObj.Vertices) dictObj.Vertices=pair(dictObj.Vertices);
      if(dictObj.InkList) dictObj.InkList=dictObj.InkList.map(pair);
      if(g.rot && dictObj.AP && dictObj.AP.N){ const st=ctxP.lookup(dictObj.AP.N); if(st&&st.dict&&!st.dict.get(PDFName.of('Matrix'))) st.dict.set(PDFName.of('Matrix'),ctxP.obj(g.M)); } // (form fields set their own Matrix, which already includes the page rotation)
      const dict=ctxP.obj(dictObj);
      if(textFields) for(const k in textFields) dict.set(PDFName.of(k), k==='DA'?PDFLib.PDFString.of(textFields[k]):PDFHexString.fromText(textFields[k]));
      const annRef=ctxP.register(dict); page.node.addAnnot(annRef); return annRef;
    }
    // Line annotations get their own explicit appearance stream (like FreeText already
    // did) rather than relying on the viewer to auto-generate one from geometry alone —
    // that auto-generation turned out to be inconsistent between PDF viewers (a Line with
    // no /AP rendered in some but not others, including when printing).
    // opts: {arrowEnd, arrowStart (sizes; 0/undefined = none), caption:{text,size,color}}
    function lineAnnot(page,p1,p2,color,w,opts,extra,textFields){
      opts=opts||{};
      const aEnd=opts.arrowEnd||0, aStart=opts.arrowStart||0, cap=opts.caption||null;
      const pad=Math.max(w,aEnd,aStart)+3+(cap?cap.size+6:0);
      const bx1=Math.min(p1.x,p2.x)-pad, by1=Math.min(p1.y,p2.y)-pad, bx2=Math.max(p1.x,p2.x)+pad, by2=Math.max(p1.y,p2.y)+pad;
      const lp1={x:p1.x-bx1,y:p1.y-by1}, lp2={x:p2.x-bx1,y:p2.y-by1}, col=rgb(color[0],color[1],color[2]);
      let ops=[...drawLine(Object.assign({start:lp1,end:lp2,thickness:w,color:col},opts.dash?{dashArray:opts.dash,dashPhase:0}:{}))];
      const arrow=(tip,from,size)=>{ const ang=Math.atan2(tip.y-from.y,tip.x-from.x), a1=ang+Math.PI-0.4, a2=ang+Math.PI+0.4;
        ops.push(...drawLine({start:tip,end:{x:tip.x+size*Math.cos(a1),y:tip.y+size*Math.sin(a1)},thickness:w,color:col}));
        ops.push(...drawLine({start:tip,end:{x:tip.x+size*Math.cos(a2),y:tip.y+size*Math.sin(a2)},thickness:w,color:col})); };
      if(aEnd) arrow(lp2,lp1,aEnd);
      if(aStart) arrow(lp1,lp2,aStart);
      if(cap){
        const cw=font.widthOfTextAtSize(cap.text,cap.size), tcol=rgb(cap.color[0],cap.color[1],cap.color[2]);
        ops.push(...drawText(font.encodeText(cap.text),{x:(lp1.x+lp2.x)/2-cw/2,y:(lp1.y+lp2.y)/2+4,size:cap.size,font:'F1',color:tcol,rotate:degrees(0),xSkew:degrees(0),ySkew:degrees(0)}));
      }
      const xobjRef=ctxP.register(ctxP.formXObject(ops,{BBox:[0,0,bx2-bx1,by2-by1],Resources:cap?{Font:{F1:font.ref}}:undefined}));
      addAnnot(page, Object.assign({ Type:'Annot', Subtype:'Line', Rect:[bx1,by1,bx2,by2],
        L:[p1.x,p1.y,p2.x,p2.y], C:color, BS:{W:w}, F:4, AP:{N:xobjRef},
        LE:[ aStart?'OpenArrow':'None', aEnd?'OpenArrow':'None' ] }, extra||{}), textFields);
    }
    // Plain polygon / polyline / revision-cloud shapes: solid stroke, optional fill when closed.
    function linesAnnot(page,pts,color,w,closed,fillColor,textFields,dash){
      const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y), pad=w+3;
      const bx1=Math.min(...xs)-pad, by1=Math.min(...ys)-pad, bx2=Math.max(...xs)+pad, by2=Math.max(...ys)+pad;
      const lp=pts.map(p=>({x:p.x-bx1,y:p.y-by1})), col=rgb(color[0],color[1],color[2]);
      const path=()=>{ const o=[moveTo(lp[0].x,lp[0].y)]; for(let i=1;i<lp.length;i++) o.push(lineTo(lp[i].x,lp[i].y)); if(closed) o.push(closePath()); return o; };
      const ops=[];
      if(closed&&fillColor){ const fc=rgb(fillColor[0],fillColor[1],fillColor[2]); ops.push(setFillingColor(fc),...path(),fill()); }
      ops.push(pushGraphicsState(),setStrokingColor(col),setLineWidth(w),setLineJoin(LineJoinStyle.Round),setLineCap(dash?LineCapStyle.Butt:LineCapStyle.Round),...(dash?[setDashPattern(dash,0)]:[]),...path(),stroke(),popGraphicsState());
      const xobjRef=ctxP.register(ctxP.formXObject(ops,{BBox:[0,0,bx2-bx1,by2-by1]}));
      const flat=[]; pts.forEach(p=>flat.push(p.x,p.y));
      const dictObj={ Type:'Annot', Subtype:closed?'Polygon':'PolyLine', Rect:[bx1,by1,bx2,by2], Vertices:flat, C:color, BS:dash?{W:w,S:'D',D:dash}:{W:w}, F:4, AP:{N:xobjRef}, CEK:'shape' };
      if(closed&&fillColor) dictObj.IC=fillColor;
      addAnnot(page,dictObj,textFields);
    }
    // Area polygons carry an explicit appearance too: translucent fill, dashed outline, and
    // the measurement label at the centroid (so the area reading shows up in every viewer).
    function polygonAnnot(page,pts,color,w,label,fontSize,textColor,extra,textFields,dash){
      let cx=0,cy=0; pts.forEach(p=>{cx+=p.x;cy+=p.y;}); cx/=pts.length; cy/=pts.length;
      const lw=font.widthOfTextAtSize(label,fontSize);
      const xs=pts.map(p=>p.x).concat([cx-lw/2,cx+lw/2]), ys=pts.map(p=>p.y).concat([cy-fontSize,cy+fontSize]);
      const pad=w+3;
      const bx1=Math.min(...xs)-pad, by1=Math.min(...ys)-pad, bx2=Math.max(...xs)+pad, by2=Math.max(...ys)+pad;
      const lp=pts.map(p=>({x:p.x-bx1,y:p.y-by1})), col=rgb(color[0],color[1],color[2]), tcol=rgb(textColor[0],textColor[1],textColor[2]);
      const path=()=>{ const o=[moveTo(lp[0].x,lp[0].y)]; for(let i=1;i<lp.length;i++) o.push(lineTo(lp[i].x,lp[i].y)); o.push(closePath()); return o; };
      const ops=[pushGraphicsState(),setGraphicsState('GS1'),setFillingColor(col),...path(),fill(),popGraphicsState(),
                 pushGraphicsState(),setStrokingColor(col),setLineWidth(w),...(dash?[setDashPattern(dash,0)]:[]),...path(),stroke(),popGraphicsState()];
      ops.push(...drawText(font.encodeText(label),{x:cx-bx1-lw/2,y:cy-by1-fontSize/3,size:fontSize,font:'F1',color:tcol,rotate:degrees(0),xSkew:degrees(0),ySkew:degrees(0)}));
      const xobjRef=ctxP.register(ctxP.formXObject(ops,{BBox:[0,0,bx2-bx1,by2-by1],Resources:{Font:{F1:font.ref},ExtGState:{GS1:{Type:'ExtGState',ca:0.15,CA:1}}}}));
      const flat=[]; pts.forEach(p=>flat.push(p.x,p.y));
      addAnnot(page, Object.assign({ Type:'Annot', Subtype:'Polygon', Rect:[bx1,by1,bx2,by2], Vertices:flat, C:color, IC:color, BS:dash?{W:w,S:'D',D:dash}:{W:w}, F:4, AP:{N:xobjRef} }, extra||{}), textFields);
    }
    for(const pn of Object.keys(annotations)) for(const a of (annotations[pn].texts||[])) await faceFor(a);
    for(const pn of Object.keys(annotations)){
      const page=pages[parseInt(pn,10)-1]; if(!page) continue;
      const geo=pageGeom(page); curGeo=geo; const W=geo.W, H=geo.H; const d=annotations[pn]; // W,H = the page as displayed
      for(const im of (d.images||[])){ // pictures & signatures: a Stamp annotation whose appearance is the image (multiply/normal blend + opacity)
        const rec=imageStore[im.imgId]; if(!rec) continue;
        const bytes=dataUrlToBytes(rec.dataUrl), emb=rec.mime==='image/jpeg'?await pdf.embedJpg(bytes):await pdf.embedPng(bytes);
        const left=Math.min(im.x1,im.x2)*W, right=Math.max(im.x1,im.x2)*W, top=H-Math.min(im.y1,im.y2)*H, bottom=H-Math.max(im.y1,im.y2)*H, dw=right-left, dh=top-bottom, op=im.opacity!=null?im.opacity:1;
        const ops=[pushGraphicsState(),setGraphicsState('GS1'),concatTransformationMatrix(dw,0,0,dh,0,0),drawObject('Im1'),popGraphicsState()];
        const apRef=ctxP.register(ctxP.formXObject(ops,{BBox:[0,0,dw,dh],Resources:{XObject:{Im1:emb.ref},ExtGState:{GS1:{Type:'ExtGState',BM:im.blend==='multiply'?'Multiply':'Normal',ca:op,CA:op}}}}));
        const ceiRef=ctxP.register(ctxP.flateStream(bytes)), meta=Object.assign({},im); delete meta.imgId;
        addAnnot(page,{Type:'Annot',Subtype:'Stamp',Name:'CEImage',Rect:[left,bottom,right,top],F:4,AP:{N:apRef},CEI:ceiRef,CEK:'image'},{CED:JSON.stringify(meta)});
      }
      d.shapes.forEach(s=>{
        const p1=xy(s.x1,s.y1,W,H), p2=xy(s.x2,s.y2,W,H), col=hexArr(s.color);
        if(s.type==='line') lineAnnot(page,p1,p2,col,s.w,{arrowEnd:s.arrowSize||0,dash:dashPattern(s)},{CEK:'shape'},{CED:JSON.stringify(s)});
        else if(s.type==='rect'){ const x=Math.min(p1.x,p2.x),y=Math.min(p1.y,p2.y),w=Math.abs(p2.x-p1.x),h=Math.abs(p2.y-p1.y),ib=s.w/2,
            strokeC=rgb(col[0],col[1],col[2]);
          const ops=[]; if(s.fill){ const fc=hexArr(s.fillColor||s.color); ops.push(setFillingColor(rgb(fc[0],fc[1],fc[2])),rectangle(ib,ib,Math.max(0,w-2*ib),Math.max(0,h-2*ib)),fill()); }
          const dsh=dashPattern(s); ops.push(pushGraphicsState(),setStrokingColor(strokeC),setLineWidth(s.w),...(dsh?[setDashPattern(dsh,0)]:[]),rectangle(ib,ib,Math.max(0,w-2*ib),Math.max(0,h-2*ib)),stroke(),popGraphicsState());
          const apRef=ctxP.register(ctxP.formXObject(ops,{BBox:[0,0,w,h]}));
          const dictObj={ Type:'Annot', Subtype:'Square', Rect:[x,y,x+w,y+h], C:col, BS:dashPattern(s)?{W:s.w,S:'D',D:dashPattern(s)}:{W:s.w}, F:4, AP:{N:apRef}, CEK:'shape' };
          if(s.fill) dictObj.IC=hexArr(s.fillColor||s.color);
          addAnnot(page,dictObj,{CED:JSON.stringify(s)}); }
        else if(s.type==='ellipse'){ const x=Math.min(p1.x,p2.x),y=Math.min(p1.y,p2.y),w=Math.abs(p2.x-p1.x),h=Math.abs(p2.y-p1.y),
            strokeC=rgb(col[0],col[1],col[2]), kap=0.5522847498, cx=w/2, cy=h/2, rx=Math.max(0,w/2-s.w/2), ry=Math.max(0,h/2-s.w/2);
          const oval=()=>[moveTo(cx+rx,cy),
            appendBezierCurve(cx+rx,cy+ry*kap, cx+rx*kap,cy+ry, cx,cy+ry),
            appendBezierCurve(cx-rx*kap,cy+ry, cx-rx,cy+ry*kap, cx-rx,cy),
            appendBezierCurve(cx-rx,cy-ry*kap, cx-rx*kap,cy-ry, cx,cy-ry),
            appendBezierCurve(cx+rx*kap,cy-ry, cx+rx,cy-ry*kap, cx+rx,cy), closePath()];
          const ops=[]; if(s.fill){ const fc=hexArr(s.fillColor||s.color); ops.push(setFillingColor(rgb(fc[0],fc[1],fc[2])),...oval(),fill()); }
          const dsh=dashPattern(s); ops.push(pushGraphicsState(),setStrokingColor(strokeC),setLineWidth(s.w),...(dsh?[setDashPattern(dsh,0)]:[]),...oval(),stroke(),popGraphicsState());
          const apRef=ctxP.register(ctxP.formXObject(ops,{BBox:[0,0,w,h]}));
          const dictObj={ Type:'Annot', Subtype:'Circle', Rect:[x,y,x+w,y+h], C:col, BS:dashPattern(s)?{W:s.w,S:'D',D:dashPattern(s)}:{W:s.w}, F:4, AP:{N:apRef}, CEK:'shape' };
          if(s.fill) dictObj.IC=hexArr(s.fillColor||s.color);
          addAnnot(page,dictObj,{CED:JSON.stringify(s)}); }
        else if(s.type==='polygon'||s.type==='polyline'||s.type==='cloud'){
          const closed=s.type!=='polyline';
          const pagePts=s.type==='cloud'?puffOutline(s.points,W,H,s.bump,true):s.points.map(pt=>xy(pt.x,pt.y,W,H));
          linesAnnot(page,pagePts,col,s.w,closed,(closed&&s.fill)?hexArr(s.fillColor||s.color):null,{CED:JSON.stringify(s)},dashPattern(s));
        }
      });
      d.paths.forEach(p=>{
        const pts=p.points.map(pt=>xy(pt.x,pt.y,W,H)), flat=[]; pts.forEach(pt=>flat.push(pt.x,pt.y));
        const xs=pts.map(pt=>pt.x), ys=pts.map(pt=>pt.y), pad=p.w+4;
        const ibx1=Math.min(...xs)-pad, iby1=Math.min(...ys)-pad, ibx2=Math.max(...xs)+pad, iby2=Math.max(...ys)+pad;
        const ilp=pts.map(pt=>({x:pt.x-ibx1,y:pt.y-iby1})), icol=rgb(...hexArr(p.color));
        const iops=[pushGraphicsState(),setStrokingColor(icol),setLineWidth(p.w),setLineJoin(LineJoinStyle.Round),setLineCap(LineCapStyle.Round),
          moveTo(ilp[0].x,ilp[0].y),...ilp.slice(1).map(pt=>lineTo(pt.x,pt.y)),stroke(),popGraphicsState()];
        const iApRef=ctxP.register(ctxP.formXObject(iops,{BBox:[0,0,ibx2-ibx1,iby2-iby1]}));
        addAnnot(page,{ Type:'Annot', Subtype:'Ink', Rect:[ibx1,iby1,ibx2,iby2],
          InkList:[flat], C:hexArr(p.color), CA:p.opacity, BS:{W:p.w}, F:4, AP:{N:iApRef}, CEK:'path' },{CED:JSON.stringify(p)});
      });
      d.measurements.forEach(m=>{
        const col=hexArr(m.color), tcol=hexArr(m.textColor||m.color), fs=m.fontSize||11, label=winSafe(measureLabel(m));
        if(m.type==='length'){ const a=xy(m.points[0].x,m.points[0].y,W,H), b=xy(m.points[1].x,m.points[1].y,W,H);
          const as=m.arrowSize!=null?m.arrowSize:8; // an arrow on each end of the dimension line
          lineAnnot(page,a,b,col,m.w,{dash:dashPattern(m),arrowStart:as,arrowEnd:as,caption:{text:label,size:fs,color:tcol}},{IT:'LineDimension',Cap:true,CP:'Inline',CEK:'measurement'},{Contents:label,CED:JSON.stringify(m)});
        } else { const pts=m.points.map(pt=>xy(pt.x,pt.y,W,H));
          polygonAnnot(page,pts,col,m.w,label,fs,tcol,{CEK:'measurement'},{Contents:label,CED:JSON.stringify(m)},dashPattern(m)); }
      });
      d.texts.forEach(a=>{
        const tf=faceCache[textStdName(a)]||font; // this text box's own font (family, bold, italic)
        const lineCol=hexArr(a.color), txtCol=hexArr(a.textColor||a.color), pos=xy(a.fx,a.fy,W,H), al=effAlign(a,W,H); // pos = top-left of the box
        const bw=a.borderW>0?a.borderW:0, pad=2+bw;
        const lrgb=rgb(lineCol[0],lineCol[1],lineCol[2]), trgb=rgb(txtCol[0],txtCol[1],txtCol[2]);
        const rawLines=lineSplit(cleanText(a.text));
        let boxWpt,boxHpt;
        if(a.boxW){ boxWpt=a.boxW*W; boxHpt=a.boxH*H; }
        else { const maxLW=Math.max(10,...rawLines.map(l=>tf.widthOfTextAtSize(l,a.size))); boxWpt=maxLW+8+2*bw; boxHpt=rawLines.length*a.size*1.2+8+2*bw; }
        const llx=pos.x, ury=pos.y, urx=pos.x+boxWpt, lly=pos.y-boxHpt;
        // A callout's pointer line is folded into this SAME FreeText annotation (via a
        // custom-drawn leader + native /CL) rather than a second Line annotation, so a
        // callout round-trips as ONE editable object, not two.
        let ox1=llx, oy1=lly, ox2=urx, oy2=ury, tipPage=null, anchorPage=null, kneePage=null;
        if(a.leader){
          tipPage=xy(a.leader.x,a.leader.y,W,H);
          // The leader attaches to whichever side of the box the tip is on (same rule as the editor).
          const side=tipPage.x<(llx+urx)/2?'left':'right';
          anchorPage={x:side==='left'?llx:urx,y:(lly+ury)/2};
          let legLenPt=(a.legLength!=null?a.legLength:0.03)*W;
          const toTip=side==='left'?anchorPage.x-tipPage.x:tipPage.x-anchorPage.x;
          if(toTip>0) legLenPt=Math.min(legLenPt,toTip);
          kneePage={x:anchorPage.x+(side==='left'?-legLenPt:legLenPt),y:anchorPage.y};
          ox1=Math.min(ox1,tipPage.x,kneePage.x); oy1=Math.min(oy1,tipPage.y,kneePage.y);
          ox2=Math.max(ox2,tipPage.x,kneePage.x); oy2=Math.max(oy2,tipPage.y,kneePage.y);
        }
        const boxOffX=llx-ox1, boxOffY=lly-oy1;
        let lines=[];
        rawLines.forEach(line=>{ if(line===''){ lines.push(''); return; }
          const wrapped=breakTextIntoLines(line,[' '],boxWpt-2*pad,t=>tf.widthOfTextAtSize(t,a.size));
          lines.push(...(wrapped.length?wrapped:[''])); });
        let ops=[];
        if(a.bg){ const bgCol=hexArr(a.bgColor||'#ffffff');
          ops.push(setFillingColor(rgb(bgCol[0],bgCol[1],bgCol[2])), rectangle(boxOffX,boxOffY,boxWpt,boxHpt), fill()); }
        if(bw){ ops.push(pushGraphicsState(),setStrokingColor(lrgb),setLineWidth(bw),rectangle(boxOffX+bw/2,boxOffY+bw/2,boxWpt-bw,boxHpt-bw),stroke(),popGraphicsState()); }
        if(a.leader){
          const lt=bw>0?bw:1.2;
          const anchorL={x:anchorPage.x-ox1,y:anchorPage.y-oy1}, tipL={x:tipPage.x-ox1,y:tipPage.y-oy1}, kneeL={x:kneePage.x-ox1,y:kneePage.y-oy1};
          ops.push(...drawLine({start:kneeL,end:tipL,thickness:lt,color:lrgb}));
          ops.push(...drawLine({start:anchorL,end:kneeL,thickness:lt,color:lrgb}));
          if(a.arrowSize){ const ang=Math.atan2(tipL.y-kneeL.y,tipL.x-kneeL.x), a1=ang+Math.PI-0.4, a2=ang+Math.PI+0.4;
            ops.push(...drawLine({start:tipL,end:{x:tipL.x+a.arrowSize*Math.cos(a1),y:tipL.y+a.arrowSize*Math.sin(a1)},thickness:lt,color:lrgb}));
            ops.push(...drawLine({start:tipL,end:{x:tipL.x+a.arrowSize*Math.cos(a2),y:tipL.y+a.arrowSize*Math.sin(a2)},thickness:lt,color:lrgb})); }
        }
        lines.forEach((line,i)=>{
          const lw=tf.widthOfTextAtSize(line,a.size);
          let lx=boxOffX+pad; if(al==='center') lx=boxOffX+Math.max(pad,(boxWpt-lw)/2); else if(al==='right') lx=boxOffX+Math.max(pad,boxWpt-lw-pad);
          const ly=boxOffY+boxHpt-a.size-i*a.size*1.2-pad;
          ops.push(...drawText(tf.encodeText(line),{x:lx,y:ly,size:a.size,font:'F1',color:trgb,rotate:degrees(0),xSkew:degrees(0),ySkew:degrees(0)}));
        });
        const xobj=ctxP.formXObject(ops,{BBox:[0,0,ox2-ox1,oy2-oy1],Resources:{Font:{F1:tf.ref}}});
        const xobjRef=ctxP.register(xobj);
        const qVal=al==='center'?1:al==='right'?2:0;
        const dictObj={ Type:'Annot', Subtype:'FreeText', Rect:[ox1,oy1,ox2,oy2], Q:qVal, BS:{W:bw}, F:4, AP:{N:xobjRef}, CEK:'text' };
        if(a.leader){ dictObj.IT='FreeTextCallout'; dictObj.CL=[tipPage.x,tipPage.y,kneePage.x,kneePage.y,anchorPage.x,anchorPage.y]; dictObj.LE=a.arrowSize?'OpenArrow':'None'; }
        addAnnot(page,dictObj,
          { Contents:a.text, DA:`${txtCol[0].toFixed(3)} ${txtCol[1].toFixed(3)} ${txtCol[2].toFixed(3)} rg /Helv ${a.size} Tf`, CED:JSON.stringify(a) });
      });
    }
    // Everything that isn't a markup (page numbers, header/footer, watermark, bookmarks, form fields)
    // is regenerated from app state on every save — see exportExtras().
    await exportExtras({pdf,pages,font,ctxP,addAnnot,setGeo:g=>{ curGeo=g; },hexArr,keptWidgetRefs});
    exportOcrText({pdf,pages,font,ctxP}); // recognised text, as an invisible searchable layer
    return pdf.save(SAVE_OPTS);
}

// Save the active document. Where the browser supports it (Chrome / Edge on https or localhost) a real "Save as" dialog is used, so we
// know whether the file was actually written (and later saves of the same tab overwrite that file); elsewhere it is a normal download.
// Resolves true when saved, false when cancelled or failed.
// opts.saveAs: always ask where (File > Save As). The picking and writing live in platform.js (browser vs desktop app).
async function saveActiveDocument(opts){
  if(!originalBytes) return false;
  const saveAs=!!(opts&&opts.saveAs), tab=docs[activeDoc], suggested=((tab&&tab.name)||'document.pdf').replace(/\.pdf$/i,'')+'-edited.pdf';
  const target=await platform.chooseSave(tab,{saveAs,suggested}); // asks first, while the click that started this is still fresh
  if(!target) return false;
  downloadBtn.disabled=true; $('save-label').textContent='Saving…'; bgTask('Saving PDF…',null); await tick();
  try{
    const bytes=(await heavy('save')).bytes; // building the PDF runs in the background worker
    const r=await platform.write(target,bytes,suggested);
    if(tab){ if(!target.download) tab.saveTarget=target; if(r.path){ tab.path=r.path; tab.name=r.name; tab.confirmedPath=r.path; } tab.dirty=false; renderTabBar(); }
    toast('Saved '+r.name);
    return true;
  }catch(err){ if(tab) tab.saveTarget=null; await modalAlert('Could not save PDF: '+esc(err.message)); return false; }
  finally{ downloadBtn.disabled=false; $('save-label').textContent='Save PDF'; bgTask(null); }
}
downloadBtn.onclick=()=>saveActiveDocument();

// Crops the (already exported) document down to one rectangle of one page, ready to print.
async function cropBytesToArea(bytes,area){
  const src=await loadPdf(bytes), idx=area.page-1, pg=src.getPage(idx), g=pageGeom(pg);
  const cs=[[area.x1,area.y1],[area.x2,area.y1],[area.x2,area.y2],[area.x1,area.y2]].map(([fx,fy])=>g.toUser(fx*g.W,(1-fy)*g.H));
  const xs=cs.map(c=>c.x), ys=cs.map(c=>c.y), x=Math.min(...xs), y=Math.min(...ys), w=Math.max(...xs)-x, h=Math.max(...ys)-y;
  for(let i=src.getPageCount()-1;i>=0;i--) if(i!==idx) src.removePage(i);
  const only=src.getPage(0); only.setMediaBox(x,y,w,h); only.setCropBox(x,y,w,h);
  return src.save(SAVE_OPTS);
}
function openForPrint(bytes){
  const blob=new Blob([bytes],{type:'application/pdf'}), url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(win){ win.addEventListener('load',()=>{ try{ win.focus(); win.print(); }catch(e){} }); }
  else{
    const iframe=document.createElement('iframe'); iframe.style.display='none'; iframe.src=url;
    document.body.appendChild(iframe);
    iframe.onload=()=>{ try{ iframe.contentWindow.focus(); iframe.contentWindow.print(); }catch(e){} };
  }
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function printFlow(){
  if(!originalBytes) return;
  const mode=await dialog({ title:'Print', ok:'Continue',
    body:`<label class="opt"><input type="radio" name="pm" value="full" checked> Full pages (the whole document)</label>
      <label class="opt"><input type="radio" name="pm" value="area"> Select an area of a page to print</label>
      <div class="sub">With an area, you drag a rectangle on a page and only that part prints, sized to fit the paper.</div>`,
    collect:ov=>ov.querySelector('input[name="pm"]:checked').value });
  if(!mode) return;
  let area=null;
  if(mode==='area'){ area=await pickArea('Drag a rectangle around the area to print. Esc cancels.'); if(!area) return; }
  printBtn.disabled=true; toast('Preparing print…');
  try{
    openForPrint((await heavy('print',{area})).bytes);
  }catch(err){ await modalAlert('Could not prepare the document for printing: '+err.message); }
  finally{ printBtn.disabled=false; }
}
printBtn.onclick=printFlow;
