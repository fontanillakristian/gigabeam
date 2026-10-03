/* platform.js - The one place that knows whether the app is running in a browser tab or inside the desktop (Electron) app.
   The rest of the code asks `platform` to open and save files and to handle closing the window, and never cares which one it is.

   In the desktop app, electron/preload.js defines window.gigabeam with this contract (all calls are async unless noted):
     openDialog()                       -> [{path, name, bytes}]   native "Open" dialog (several files allowed); [] if cancelled
     readFile(path)                     -> {path, name, bytes}
     saveDialog({suggestedName, defaultPath}) -> path | null       native "Save as" dialog
     writeFile(path, bytes)             -> path                    writes the file (throws on failure)
     exists(path)                       -> boolean                 is there already a file at this path (used to ask before overwriting)
     pathForFile(file)  (sync)          -> path | ''               real disk path of a File dropped onto the window
     onOpenPaths(cb)                    cb(paths[])                files the OS asked us to open (double-click, "Open with", second launch)
     onCloseRequested(cb)               cb()                       the window's close button was pressed; the page answers with quit() or does nothing (cancel)
     quit()                                                         close the window for real
     addRecent(path), setTitle(text)    (fire and forget)
   In a browser there is no window.gigabeam and the original behaviour is used: a file picker, showSaveFilePicker when available
   (otherwise a download), and the browser's own "leave this page?" warning. */
const platform=(()=>{
  const br=()=>window.gigabeam||null; // looked up at call time
  const baseName=p=>String(p||'').split(/[\\/]/).pop();
  const pdfTypes=[{description:'PDF document',accept:{'application/pdf':['.pdf']}}];
  const toFile=r=>{ const f=new File([r.bytes],r.name||baseName(r.path),{type:'application/pdf'}); f.gbPath=r.path; return f; }; // a File that remembers where it came from

  return {
    get isDesktop(){ return !!br(); },

    // ---- opening
    // Show the Open dialog (a native one on desktop, the browser's file picker otherwise) and open what was chosen.
    async open(){
      if(!br()){ fileInput.click(); return; }
      const picked=await br().openDialog(); if(picked&&picked.length) await openFiles(picked.map(toFile));
    },
    // Open files by disk path (the OS handed them to us). Desktop only.
    async openPaths(paths){
      if(!br()) return;
      const files=[]; for(const p of paths){ try{ files.push(toFile(await br().readFile(p))); }catch(err){ await modalAlert('Could not open '+esc(baseName(p))+': '+esc(err.message)); } }
      if(files.length) await openFiles(files);
    },
    // Where a File lives on disk, so Save can overwrite it ('' in a browser, or when unknown)
    pathOf(file){ if(file.gbPath) return file.gbPath; try{ return (br()&&br().pathForFile&&br().pathForFile(file))||''; }catch(e){ return ''; } },
    noteOpened(path){ if(br()&&path&&br().addRecent) br().addRecent(path); },

    // ---- saving
    // Decide where this tab is saved. Resolves to a target object for write(), or false when the user cancelled.
    // Save reuses the tab's earlier target (or the file it was opened from); saveAs always asks.
    async chooseSave(tab,{saveAs,suggested}){
      if(br()){
        const dialog=async()=>{ const p=await br().saveDialog({suggestedName:suggested,defaultPath:(tab&&tab.path)||undefined}); return p?{path:p}:false; }; // the native Save dialog asks about replacing an existing file itself
        const known=!saveAs&&tab&&(tab.saveTarget||(tab.path&&{path:tab.path}));
        if(!known) return dialog();
        // Saving straight over an existing file: ask once per file (a Save that already wrote to it, or one chosen in the Save dialog, is already confirmed)
        const path=known.path;
        if(!path||tab.confirmedPath===path||!(br().exists&&await br().exists(path))) return known;
        const c=await modalChoice(`<b>${esc(baseName(path))}</b> already exists.<br>Do you want to overwrite it with your changes?<div class="sub" style="margin-top:6px;word-break:break-all">${esc(path)}</div>`,
          [{id:'overwrite',label:'Overwrite',primary:true},{id:'saveas',label:'Save as…'},{id:'cancel',label:'Cancel'}]);
        if(c==='overwrite'){ return known; }
        if(c==='saveas') return dialog();
        return false;
      }
      if(!saveAs&&tab&&tab.saveTarget) return tab.saveTarget;
      if(window.showSaveFilePicker){ // ask first, while the click that started this is still fresh
        try{ return {handle:await window.showSaveFilePicker({suggestedName:suggested,types:pdfTypes})}; }
        catch(err){ if(err&&err.name==='AbortError') return false; }
      }
      return {download:true};
    },
    // Write the bytes to a target from chooseSave(). Resolves to {name, path?} (path is set when it went to a disk path).
    async write(target,bytes,suggested){
      if(target.path){ await br().writeFile(target.path,bytes); return {name:baseName(target.path),path:target.path}; }
      if(target.handle){ const w=await target.handle.createWritable(); await w.write(bytes); await w.close(); return {name:target.handle.name}; }
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})), link=document.createElement('a'); link.href=url; link.download=suggested;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000);
      return {name:suggested};
    },

    // ---- window
    setTitle(text){ if(br()&&br().setTitle) br().setTitle(text); else document.title=text; },
    // Called once at start-up with the handlers the page provides.
    wire({onOpenPaths,onCloseRequested}){
      if(br()){
        if(br().onOpenPaths) br().onOpenPaths(onOpenPaths);
        if(br().onCloseRequested) br().onCloseRequested(onCloseRequested);
      }else{
        addEventListener('beforeunload',e=>{ if(docs.some(t=>t.dirty)){ e.preventDefault(); e.returnValue=''; } }); // the browser shows its own confirmation
      }
    },
    quit(){ if(br()) br().quit(); }
  };
})();
