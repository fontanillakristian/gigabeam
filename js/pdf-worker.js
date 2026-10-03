/* pdf-worker.js - Background worker for the heavy PDF work.
   It loads pdf-lib and the SAME app scripts the page uses (so there is one implementation, not two), with a stubbed DOM so their
   start-up wiring does nothing here, then runs functions from CORE (js/core.js) on request.
   Messages in : {type:'init', lib}  and  {type:'call', id, op, state, params}
   Messages out: {type:'ready'} / {type:'initError', message}  and  {type:'result', id, result} / {type:'error', id, message} */

// A stand-in for anything DOM-shaped: every property read gives another stand-in, every call returns one, assignments are ignored.
function makeDummy(){
  return new Proxy(function(){},{
    get(_,k){ if(k===Symbol.toPrimitive) return ()=>''; if(k==='then') return undefined; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return makeDummy(); },
    set(){ return true; }, has(){ return true; }, apply(){ return makeDummy(); }, construct(){ return makeDummy(); }
  });
}
self.window=self; self.document=makeDummy(); self.pdfjsLib=makeDummy(); self.innerWidth=1024; self.innerHeight=768;

// the app scripts, in the same order as js/boot.js, minus the ones that only drive the UI (boot, shell, touch, init)
const WORKER_SCRIPTS=['state','utils','documents','pages','overlay','tools','properties','dialogs','export','ui','markups-list','bookmarks','forms','flatten','layout','layout-dialog','core'];

// load the state the page sent into the shared globals the app code reads
function applyState(s){
  originalBytes=new Uint8Array(s.bytes.buffer||s.bytes); annotations=s.annotations; layout=s.layout; bookmarks=s.bookmarks;
  flatPages=new Set(s.flat); scale=s.scale; docs=[{name:s.name}]; activeDoc=0;
  Object.keys(imageStore).forEach(k=>{ delete imageStore[k]; }); Object.assign(imageStore,s.images);
}
// images referenced by the result (read from a file) go back with it
function collectImages(r){
  const imgs={}, need=id=>{ if(id&&imageStore[id]) imgs[id]=imageStore[id]; };
  if(r&&r.annotations) Object.values(r.annotations).forEach(d=>(d.images||[]).forEach(im=>need(im.imgId)));
  if(r&&r.layout&&r.layout.watermark) need(r.layout.watermark.imgId);
  if(Object.keys(imgs).length) r.images=imgs;
}

self.onmessage=async e=>{
  const m=e.data;
  if(m.type==='init'){
    try{
      importScripts(m.lib);
      importScripts(...WORKER_SCRIPTS.map(n=>n+'.js'));
      measureCtx=(typeof OffscreenCanvas!=='undefined')?new OffscreenCanvas(1,1).getContext('2d'):null; // text measuring for legacy callouts
      self.postMessage({type:'ready'});
    }catch(err){ self.postMessage({type:'initError',message:(err&&err.message)||String(err)}); }
    return;
  }
  if(m.type==='call'){
    try{
      applyState(m.state);
      const r=await CORE[m.op](m.params||{});
      collectImages(r);
      const transfer=[]; if(r&&r.bytes&&r.bytes.buffer) transfer.push(r.bytes.buffer); if(r&&r.stripped&&r.stripped.buffer) transfer.push(r.stripped.buffer); // hand the (large) files back without copying
      self.postMessage({type:'result',id:m.id,result:r},transfer);
    }catch(err){ self.postMessage({type:'error',id:m.id,message:(err&&err.message)||String(err)}); }
  }
};
