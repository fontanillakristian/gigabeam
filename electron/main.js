/* main.js - The desktop (Electron) shell around the Gigabeam web app.
   It serves the app's own files to a window, answers the file requests of electron/preload.js (native Open / Save dialogs, reading and
   writing PDFs), keeps a single window (a second launch hands its files to the first), and asks the page before the window closes so
   unsaved changes can be saved. The app itself is the same code that runs in a browser (see js/platform.js). */
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');                  // the web app lives in the project folder
const SERVED = ['index.html', 'css', 'js', 'assets', 'vendor']; // and only these parts of it are ever served to the window
const DEV = process.argv.includes('--dev'), SMOKE = process.argv.includes('--smoke');
let win = null, forceClose = false, pendingPaths = [], ready = false;

// The page is loaded from a private, secure scheme instead of file://, so fetch(), workers and Web Crypto behave as they do on https.
protocol.registerSchemesAsPrivileged([{ scheme: 'gigabeam', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const pdfArgs = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => /\.pdf$/i.test(a) && fs.existsSync(a)).map(a => path.resolve(a));
const readPdf = p => ({ path: p, name: path.basename(p), bytes: fs.readFileSync(p) });

function sendPaths(paths) {
  if (!paths.length) return;
  if (win && ready) { win.webContents.send('open-paths', paths); if (win.isMinimized()) win.restore(); win.focus(); }
  else pendingPaths.push(...paths);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 640, minHeight: 480, backgroundColor: '#1b1c1f', title: 'Gigabeam', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  Menu.setApplicationMenu(null);                           // the app draws its own menu bar
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault()); // dropping a file on the window must not navigate away
  win.webContents.on('did-finish-load', () => { ready = true; if (pendingPaths.length) { win.webContents.send('open-paths', pendingPaths); pendingPaths = []; } if (SMOKE) smoke(); });
  // the close button asks the page first (it may hold unsaved tabs); the page answers by calling quit()
  win.on('close', e => { if (!forceClose && !SMOKE) { e.preventDefault(); win.webContents.send('close-requested'); } });
  win.on('closed', () => { win = null; ready = false; });
  win.loadURL('gigabeam://app/index.html');
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

// ---- file access for the page
ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open PDF', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
  return r.canceled ? [] : r.filePaths.map(readPdf);
});
ipcMain.handle('read-file', (e, p) => readPdf(p));
ipcMain.handle('save-dialog', async (e, o) => {
  const r = await dialog.showSaveDialog(win, { title: 'Save PDF', defaultPath: o && o.defaultPath ? path.join(path.dirname(o.defaultPath), (o.suggestedName || path.basename(o.defaultPath))) : (o && o.suggestedName) || 'document.pdf', filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
  return r.canceled ? null : (/\.pdf$/i.test(r.filePath) ? r.filePath : r.filePath + '.pdf');
});
ipcMain.handle('write-file', (e, p, bytes) => { const tmp = p + '.gigabeam-tmp'; fs.writeFileSync(tmp, Buffer.from(bytes)); fs.renameSync(tmp, p); return p; }); // write beside, then replace: a failed save never half-writes the original
ipcMain.handle('exists', (e, p) => fs.existsSync(p));
ipcMain.on('add-recent', (e, p) => { try { app.addRecentDocument(p); } catch (err) { /* not available everywhere */ } });
ipcMain.on('set-title', (e, t) => { if (win) win.setTitle(String(t)); });
ipcMain.on('quit', () => { forceClose = true; if (win) win.close(); else app.quit(); });

// ---- one window: a second launch (double-click, "Open with") passes its files to the first
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => sendPaths(pdfArgs(argv)));
  app.whenReady().then(() => {
    protocol.handle('gigabeam', req => {                    // gigabeam://app/<file>  ->  the app's own files
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
      const abs = path.normalize(path.join(ROOT, rel));
      if (!abs.startsWith(ROOT + path.sep) || !SERVED.some(s => rel === s || rel.startsWith(s + '/'))) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(abs).toString());
    });
    pendingPaths = pdfArgs(process.argv);
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}

// ---- `npm run smoke`: load the app, check the desktop pieces work, print the result, exit
async function smoke() {
  const js = `(async()=>{ const o=[]; const w=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<100&&typeof startWorker!=='function';i++) await w(100); await w(500);
    o.push('platform.isDesktop='+platform.isDesktop+' bridge='+typeof window.gigabeam+' secureContext='+isSecureContext+' crypto.subtle='+!!(crypto&&crypto.subtle));
    o.push('scripts loaded: '+(typeof openFiles==='function'&&typeof protectPdf==='function'&&typeof runOcr==='function'));
    o.push('icons from files: '+!!document.querySelector('svg symbol#i-open'));
    o.push('title='+document.title);
    const ok=await startWorker(); o.push('background worker started='+ok);
    const d=await PDFLib.PDFDocument.create(); d.addPage([300,300]); await openFiles([new File([await d.save()],'smoke.pdf',{type:'application/pdf'})]); await w(800); o.push('opened a PDF: tabs='+docs.length+' pages='+numPages);
    const r=await heavy('save'); o.push('worker save ok bytes='+r.bytes.length+' workerFailed='+pdfWorker.failed);
    const e=await protectPdf(r.bytes,{userPw:'smoke-test-password-1'}); o.push('AES-256 protect ok bytes='+e.length);
    const T=${JSON.stringify(path.join(app.getPath('temp'), 'gigabeam-smoke.pdf'))}, b=r.bytes;
    const wrote=await window.gigabeam.writeFile(T,b), ex=await window.gigabeam.exists(T), back=await window.gigabeam.readFile(T); o.push('bridge write/exists/read: '+(wrote===T)+' '+ex+' '+(back.bytes.length===b.length)+' name='+back.name);
    const tab=docs[activeDoc]; tab.path=T; tab.confirmedPath=null; markDirty();
    const pr=platform.chooseSave(tab,{saveAs:false,suggested:'x.pdf'}); await w(400); const ov=document.querySelector('.modal-ovl'); o.push('overwrite prompt shown for an existing file: '+!!(ov&&/already exists/.test(ov.textContent)));
    [...ov.querySelectorAll('button')].find(x=>x.textContent==='Overwrite').click(); const tg=await pr; o.push('after Overwrite: target ok='+(tg.path===T));
    tab.confirmedPath=T; const svd=await saveActiveDocument(); await w(300); o.push('Save (Ctrl+S) to the same path: saved='+svd+' dirty='+tab.dirty+' file bytes='+(await window.gigabeam.readFile(T)).bytes.length);
    return o.join('\\n'); })()`;
  try { console.log('SMOKE RESULT\n' + await win.webContents.executeJavaScript(js) + '\nSMOKE END'); } catch (err) { console.log('SMOKE ERROR ' + err.message); }
  forceClose = true; app.quit();
}
