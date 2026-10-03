/* bookmarks.js - Bookmarks: tree UI, import from the PDF outline, and writing /Outlines on save. */
// ---- bookmarks: a tree of {id,title,page,open,kids}; written to the PDF as /Outlines on save
let bookmarks=[], bmId=1, bmSel=null, bmEditing=null;
function findBookmark(id,list=bookmarks){ for(const b of list){ if(b.id===id) return {b,list}; const r=findBookmark(id,b.kids); if(r) return r; } return null; }
function bookmarksHavePage(p,list=bookmarks){ return list.some(b=>b.page===p||bookmarksHavePage(p,b.kids)); }
// pages moved: follow them; a bookmark whose page was deleted goes away and its children move up
function remapBookmarks(list,fn){
  const out=[];
  list.forEach(b=>{ const kids=remapBookmarks(b.kids,fn), np=fn(b.page); if(np==null) out.push(...kids); else out.push(Object.assign({},b,{page:np,kids})); });
  return out;
}
async function importBookmarks(pdf){
  try{ const ol=await pdf.getOutline(); if(!ol||!ol.length) return [];
    const conv=async items=>{ const out=[];
      for(const it of items){ let page=null;
        try{ let dest=it.dest; if(typeof dest==='string') dest=await pdf.getDestination(dest);
          if(Array.isArray(dest)){ const ref=dest[0]; page=(typeof ref==='object'&&ref!==null)?(await pdf.getPageIndex(ref))+1:(+ref)+1; } }catch(e){}
        out.push({id:bmId++,title:it.title||'Untitled',page:page||1,open:false,kids:await conv(it.items||[])}); }
      return out; };
    return await conv(ol); }catch(e){ return []; }
}
function renderBookmarks(){
  const host=$('bm-tree'); if(!host) return; host.innerHTML='';
  if(!bookmarks.length) host.innerHTML='<div class="soon-note">'+(pdfDoc?'No bookmarks yet.<br>Bookmark the current page to jump back to it quickly.':'Open a PDF to add bookmarks.')+'</div>';
  (function walk(list,depth){ list.forEach(b=>{
    const r=document.createElement('div'); r.className='bm-row'+(b.id===bmSel?' on':''); r.style.paddingLeft=(6+depth*16)+'px';
    r.innerHTML=`<span class="tw ${b.kids.length?(b.open?'open':''):'none'}"><svg class="i"><use href="#i-right"/></svg></span><svg class="i sm ic"><use href="#i-bookmark"/></svg>`+
      (bmEditing===b.id?'<input>':'<span class="nm"></span>')+`<span class="pg">p.${b.page}</span><span class="acts"><button data-a="ren" title="Rename"><svg class="i sm"><use href="#i-edit"/></svg></button><button data-a="del" title="Delete"><svg class="i sm"><use href="#i-trash"/></svg></button></span>`;
    const nm=r.querySelector('.nm'); if(nm) nm.textContent=b.title;
    r.onclick=e=>{ const a=e.target.closest('[data-a]');
      if(e.target.closest('.tw')) b.open=!b.open;
      else if(a&&a.dataset.a==='del'){ pushHistory(); const f=findBookmark(b.id); f.list.splice(f.list.indexOf(b),1); if(bmSel===b.id) bmSel=null; }
      else if(a&&a.dataset.a==='ren') bmEditing=b.id;
      else if(e.target.tagName!=='INPUT'){ bmSel=b.id; if(pdfDoc) goToPage(Math.min(b.page,numPages)); }
      renderBookmarks(); };
    host.appendChild(r);
    const inp=r.querySelector('input');
    if(inp){ inp.value=b.title; inp.focus(); inp.select();
      const done=()=>{ if(bmEditing!==b.id) return; const t=inp.value.trim(); if(t&&t!==b.title){ pushHistory(); b.title=t; } bmEditing=null; renderBookmarks(); };
      inp.onblur=done; inp.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') done(); else if(e.key==='Escape'){ bmEditing=null; renderBookmarks(); } }; }
    if(b.open) walk(b.kids,depth+1); }); })(bookmarks,0);
  syncThumbMarks();
}
function addBookmark(sub){
  if(!pdfDoc) return;
  pushHistory();
  const nb={id:bmId++,title:'Page '+currentPage,page:currentPage,open:false,kids:[]}, parent=sub&&bmSel&&findBookmark(bmSel);
  if(parent){ parent.b.kids.push(nb); parent.b.open=true; } else bookmarks.push(nb);
  bmSel=nb.id; bmEditing=nb.id; showLeft('bookmarks');
}
function toggleBookmarkHere(){
  if(!pdfDoc) return;
  if(bookmarksHavePage(currentPage)){ // remove the bookmark(s) that point here (children move up)
    pushHistory(); bookmarks=remapBookmarks(bookmarks,n=>n===currentPage?null:n); renderBookmarks(); toast('Bookmark removed from page '+currentPage);
  } else addBookmark(false);
}
$('bm-add').onclick=()=>addBookmark(false); $('bm-sub').onclick=()=>addBookmark(true);
$('bm-add-btn').onclick=()=>addBookmark(false); $('bm-toggle').onclick=toggleBookmarkHere;
function syncThumbMarks(){
  document.querySelectorAll('#pages-list .thumb').forEach((t,i)=>{ t.classList.toggle('has-bm',bookmarksHavePage(i+1)); t.classList.toggle('flat',typeof flatPages!=='undefined'&&flatPages.has(i+1)); });
  const b=$('bm-toggle'); if(b) b.classList.toggle('on',bookmarksHavePage(currentPage));
  $('unflatten-btn').disabled=!pdfDoc||!flatPages.size;
}
// Write the bookmark tree as the PDF's /Outlines (replaces whatever outline the file had).
function writeOutlines(pdf,pages){
  const {PDFName,PDFHexString}=PDFLib, ctx=pdf.context, cat=pdf.catalog;
  if(!bookmarks.length){ cat.delete(PDFName.of('Outlines')); return; }
  const rootRef=ctx.nextRef();
  const visible=b=>b.open?b.kids.reduce((s,k)=>s+1+visible(k),0):0, total=b=>b.kids.reduce((s,k)=>s+1+total(k),0);
  const build=(list,parentRef)=>{
    const refs=list.map(()=>ctx.nextRef());
    list.forEach((b,i)=>{
      const pg=pages[Math.min(Math.max(b.page,1),pages.length)-1], d=ctx.obj({Parent:parentRef,Dest:[pg.ref,PDFName.of('Fit')]});
      d.set(PDFName.of('Title'),PDFHexString.fromText(b.title));
      if(i>0) d.set(PDFName.of('Prev'),refs[i-1]); if(i<list.length-1) d.set(PDFName.of('Next'),refs[i+1]);
      if(b.kids.length){ const kr=build(b.kids,refs[i]); d.set(PDFName.of('First'),kr[0]); d.set(PDFName.of('Last'),kr[kr.length-1]); d.set(PDFName.of('Count'),ctx.obj(b.open?visible(b):-total(b))); }
      ctx.assign(refs[i],d); });
    return refs; };
  const top=build(bookmarks,rootRef), root=ctx.obj({Type:'Outlines',First:top[0],Last:top[top.length-1],Count:bookmarks.reduce((s,b)=>s+1+visible(b),0)});
  ctx.assign(rootRef,root); cat.set(PDFName.of('Outlines'),rootRef);
}
