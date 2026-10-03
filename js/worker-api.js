/* worker-api.js - Runs the heavy PDF work (see core.js) in a background worker so the window stays responsive.
   heavy('save') / heavy('deletePage',{n}) / ... sends the current document state to js/pdf-worker.js and resolves with the result.
   If a worker can't start (very old browser, blocked, opened from disk) heavy() just runs the same function on the main thread. */
const pdfWorker={w:null,ready:null,failed:false,seq:0,pending:new Map()};
let WORKER_TIMEOUT_MS=180000; // longest a single background step may take before we give up on the worker

function startWorker(){
  if(pdfWorker.ready||pdfWorker.failed) return pdfWorker.ready||Promise.resolve(false);
  if(typeof Worker==='undefined'){ pdfWorker.failed=true; return Promise.resolve(false); }
  pdfWorker.ready=new Promise(resolve=>{
    const fail=msg=>{
      if(!pdfWorker.failed) console.warn('Background worker unavailable ('+msg+'); the heavy work will run on the main thread instead.');
      pdfWorker.failed=true; pdfWorker.pending.forEach(p=>p.reject(Object.assign(new Error(msg),{workerDied:true}))); pdfWorker.pending.clear(); resolve(false);
    };
    try{
      const w=new Worker('js/pdf-worker.js'); pdfWorker.w=w;
      w.onerror=e=>fail((e&&e.message)||'worker error');
      w.onmessage=e=>{
        const m=e.data;
        if(m.type==='ready') resolve(true);
        else if(m.type==='initError') fail(m.message);
        else{ const p=pdfWorker.pending.get(m.id); if(!p) return; pdfWorker.pending.delete(m.id); if(m.type==='result') p.resolve(m.result); else p.reject(new Error(m.message)); }
      };
      const lib=document.querySelector('script[src*="pdf-lib"]');
      w.postMessage({type:'init',lib:lib&&lib.src});
    }catch(err){ fail(err.message); }
  });
  return pdfWorker.ready;
}

// everything the worker needs to know about the open document (structured-cloned; the file bytes are copied and transferred)
function workerState(){
  const bytes=originalBytes instanceof Uint8Array?originalBytes.slice():new Uint8Array(originalBytes.slice(0));
  const images={}, need=id=>{ if(id&&imageStore[id]) images[id]=imageStore[id]; };
  Object.values(annotations).forEach(d=>(d.images||[]).forEach(im=>need(im.imgId)));
  if(layout.watermark) need(layout.watermark.imgId);
  return {bytes,annotations,layout,bookmarks,flat:Array.from(flatPages),scale,name:(docs[activeDoc]&&docs[activeDoc].name)||'',images};
}
// images the worker read out of a file arrive with the result; keep them under the same ids
function adoptImages(res){ if(res&&res.images) Object.keys(res.images).forEach(id=>{ if(!imageStore[id]) imageStore[id]=res.images[id]; }); return res; }

// run one CORE function. Typed arrays in `params` (src, bytes) are handed over rather than copied, so pass a copy you can lose.
// opts.stateless: the call doesn't depend on the open document (e.g. reading some other tab's file), so don't send it.
async function heavy(op,params,opts){
  params=params||{};
  if(!pdfWorker.failed&&await startWorker()){
    const id=++pdfWorker.seq, state=(opts&&opts.stateless)?{bytes:new Uint8Array(0),annotations:{},layout:newLayout(),bookmarks:[],flat:[],scale:1.25,name:'',images:{}}:workerState(), transfer=[state.bytes.buffer];
    if(params.src) transfer.push(params.src.buffer);
    if(params.bytes) transfer.push(params.bytes.buffer);
    try{
      const res=await new Promise((resolve,reject)=>{
        // watchdog: a worker that never answers (crashed / out of memory) must not leave the page stuck on "Working…"
        const timer=setTimeout(()=>{ pdfWorker.pending.delete(id); pdfWorker.failed=true; try{ pdfWorker.w.terminate(); }catch(e){} reject(Object.assign(new Error('the background worker stopped responding'),{workerDied:true})); },WORKER_TIMEOUT_MS);
        pdfWorker.pending.set(id,{resolve:v=>{ clearTimeout(timer); resolve(v); },reject:e=>{ clearTimeout(timer); reject(e); }});
        pdfWorker.w.postMessage({type:'call',id,op,state,params},transfer);
      });
      return adoptImages(res);
    }catch(err){ if(!err.workerDied) throw err; console.warn('Background worker failed ('+err.message+'); redoing this step on the main thread.'); } // the worker itself died: fall through to the main thread
  }
  return CORE[op](params);
}
