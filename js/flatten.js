/* flatten.js - Flatten and unflatten: which pages are flattened, the dialogs, and the "allow unflatten later" preference. (The PDF work itself is in core.js.) */
// Flatten bakes each page's markups into ONE extra content stream. With "Allow unflatten later" that stream is
// tagged (CEFL) and the original markups stay in the file as hidden annotations, so Unflatten can drop the stream and
// un-hide them. A permanent flatten writes an untagged stream and deletes the originals.
let flatPages=new Set();
// which pages carry a flatten stream. `bytes` is a file's bytes or an already-parsed pdf-lib document.
async function detectFlattened(bytes){
  const s=new Set();
  if(!(bytes&&bytes.getPages)&&!rawHas(bytes,'/CEFL')) return s; // the tag sits in a stream dictionary, which is never compressed: no tag, nothing to parse
  try{ const doc=await pdfDocFrom(bytes), ctx=doc.context;
    doc.getPages().forEach((p,i)=>{ if(pageContentRefs(p,ctx).some(r=>streamHasTag(ctx,r,'CEFL'))) s.add(i+1); }); }catch(e){}
  return s;
}
const markLayoutBaked=(pages,add)=>['pageNumbers','headerFooter','watermark'].forEach(k=>{ const L=layout[k]; if(!L) return;
  const set=new Set(L.baked||[]); pages.forEach(p=>add?set.add(p):set.delete(p)); L.baked=Array.from(set).sort((a,b)=>a-b); });

async function flattenPages(pages,permanent,opts){ // opts.fields===false leaves form fields live on the flattened pages
  return withPageLock(async()=>{
    const r=await heavy('flatten',{pages,permanent,opts});
    annotations=r.annotations;
    await reloadWorkingDoc(r.bytes,new Set(r.flat)); // also refreshes flatPages
    markLayoutBaked(pages,true);
    await renderPage(); await renderPagePanel(); renderAll();
  });
}
async function unflattenDialog(){
  if(!pdfDoc||!flatPages.size) return;
  const list=Array.from(flatPages).sort((a,b)=>a-b);
  const res=await dialog({ title:'Unflatten pages', ok:'Unflatten',
    body:`<div class="sub" style="margin-top:0">Restore the markups that were flattened with “Allow unflatten later”. Pages flattened permanently aren't listed.</div>
      <div class="pg-pick">${list.map(n=>`<label class="opt"><input type="checkbox" checked data-n="${n}"> Page ${n}</label>`).join('')}</div>
      <div class="sub">Restored items go back where they were. Anything added to the page since stays part of the page.</div>`,
    collect:(ov,setErr)=>{ const p=Array.from(ov.querySelectorAll('input[data-n]:checked')).map(i=>+i.dataset.n); if(!p.length){ setErr('Select at least one page.'); return undefined; } return p; } });
  if(res) await unflattenPages(res);
}
async function unflattenPages(pages){
  return withPageLock(async()=>{
    const r=await heavy('unflatten',{pages});
    annotations=r.annotations;
    await reloadWorkingDoc(r.bytes,new Set(r.flat));
    markLayoutBaked(pages,false);
    await renderPage(); await renderPagePanel(); renderAll();
    toast(pages.length===1?'Page '+pages[0]+' unflattened':pages.length+' pages unflattened');
  });
}
$('unflatten-btn').onclick=unflattenDialog;

// ---- flatten preference
function getAllowUnflatten(){ try{ return localStorage.getItem('ce.allowUnflatten')!=='0'; }catch(e){ return true; } }
function setAllowUnflatten(v){ try{ localStorage.setItem('ce.allowUnflatten',v?'1':'0'); }catch(e){} }
