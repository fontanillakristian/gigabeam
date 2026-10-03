/* preload.js - Gives the page window.gigabeam: the small, fixed set of things it may ask the desktop shell to do (see the contract at the top of
   js/platform.js). The page itself has no access to Node or the file system. */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('gigabeam', {
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readFile: p => ipcRenderer.invoke('read-file', p),
  saveDialog: o => ipcRenderer.invoke('save-dialog', o),
  writeFile: (p, bytes) => ipcRenderer.invoke('write-file', p, bytes),
  exists: p => ipcRenderer.invoke('exists', p),
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } }, // the real disk path of a dropped file
  onOpenPaths: cb => ipcRenderer.on('open-paths', (e, paths) => cb(paths)),
  onCloseRequested: cb => ipcRenderer.on('close-requested', () => cb()),
  quit: () => ipcRenderer.send('quit'),
  addRecent: p => ipcRenderer.send('add-recent', p),
  setTitle: t => ipcRenderer.send('set-title', t)
});
