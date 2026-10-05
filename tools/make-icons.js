// tools/make-icons.js - builds every logo / icon file from the two source images in build/brand-src/:
//   icon-source.svg      the app icon (blue square with a white pen nib), as delivered
//   wordmark-source.png  the wide "Gigabeam" logo
// Run it with:   node node_modules/electron/cli.js tools/make-icons.js
// (Electron is used only because it can draw SVG to PNG with no extra tools installed.)
// Writes: assets/brand/icon.svg, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png, wordmark.png
//         build/icon.png (installer / app icon) and build/icon.ico (Windows, 16-256 px)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), src = path.join(root, 'build', 'brand-src'), out = path.join(root, 'assets', 'brand');
const BLUE = '#2563EB';

// the pen nib: the last three paths of the source SVG (the first is the blue square, the next four only paint white corners onto it)
const srcSvg = fs.readFileSync(path.join(src, 'icon-source.svg'), 'utf8');
const paths = [...srcSvg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map(m => ({ fill: m[1], d: m[2] }));
const pen = paths.slice(5).map(p => `<path fill="${p.fill}" d="${p.d}"/>`).join('');
const svg = (bg, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${bg}${inner}</svg>`;
const ROUND = `<rect width="1024" height="1024" rx="228" fill="${BLUE}"/>`, SQUARE = `<rect width="1024" height="1024" fill="${BLUE}"/>`;

const page = `<canvas id=c></canvas><script>
window.svgToPng = (svg, size) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); x.drawImage(im, 0, 0, size, size); res(c.toDataURL('image/png')); }; im.onerror = () => rej(new Error('svg failed')); im.src = 'data:image/svg+xml;base64,' + btoa(svg); });
window.bbox = svg => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-9999px'; d.innerHTML = svg; document.body.appendChild(d); const b = d.querySelector('g').getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
window.wordmark = (png, w, h, r) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.beginPath(); x.roundRect(0, 0, w, h, r); x.clip(); x.drawImage(im, 0, 0, w, h); res(c.toDataURL('image/png')); }; im.onerror = () => rej(new Error('png failed')); im.src = png; });
</script>`;

const png = d => Buffer.from(d.split(',')[1], 'base64');
function ico(entries) { // entries: [{size, data}] PNG-in-ICO
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = 6 + 16 * entries.length; const dirs = [], datas = [];
  for (const e of entries) { const d = Buffer.alloc(16); d[0] = e.size >= 256 ? 0 : e.size; d[1] = e.size >= 256 ? 0 : e.size; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(e.data.length, 8); d.writeUInt32LE(off, 12); off += e.data.length; dirs.push(d); datas.push(e.data); }
  return Buffer.concat([head, ...dirs, ...datas]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  const run = (fn, ...a) => win.webContents.executeJavaScript(`${fn}(${a.map(x => JSON.stringify(x)).join(',')})`);
  try {
    fs.mkdirSync(out, { recursive: true });
    const round = svg(ROUND, pen), square = svg(SQUARE, pen);
    const bb = await run('bbox', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g>${pen}</g></svg>`);
    console.log('pen box (of 1024):', JSON.stringify(bb), 'centre', Math.round(bb.x + bb.w / 2), Math.round(bb.y + bb.h / 2));
    // the pen is centred on the icon (it was drawn off-centre by a few pixels in the source, so nudge it to the middle)
    const dx = Math.round(512 - (bb.x + bb.w / 2)), dy = Math.round(512 - (bb.y + bb.h / 2));
    const centred = `<g transform="translate(${dx} ${dy})">${pen}</g>`;
    const iconRound = svg(ROUND, centred), iconSquare = svg(SQUARE, centred);
    // maskable (Android crops it to any shape): the pen stays inside the central circle, so it is drawn smaller
    const maskable = svg(SQUARE, `<g transform="translate(512 512) scale(0.66) translate(-512 -512)">${centred}</g>`);
    fs.writeFileSync(path.join(out, 'icon.svg'), iconRound.replace('<svg ', '<svg width="1024" height="1024" '));
    const write = (f, d) => fs.writeFileSync(f, png(d));
    write(path.join(out, 'favicon-32.png'), await run('svgToPng', iconRound, 32));
    write(path.join(out, 'apple-touch-icon.png'), await run('svgToPng', iconSquare, 180)); // no rounding, no transparency: iPhone rounds it itself
    write(path.join(out, 'icon-192.png'), await run('svgToPng', iconRound, 192));
    write(path.join(out, 'icon-512.png'), await run('svgToPng', iconRound, 512));
    write(path.join(out, 'icon-maskable-512.png'), await run('svgToPng', maskable, 512));
    write(path.join(root, 'build', 'icon.png'), await run('svgToPng', iconRound, 1024));
    const sizes = [16, 24, 32, 48, 64, 128, 256], entries = [];
    for (const s of sizes) entries.push({ size: s, data: png(await run('svgToPng', iconRound, s)) });
    fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(entries));
    // the wide logo: same picture, with real transparent rounded corners (the source has white ones), half size
    const wm = 'data:image/png;base64,' + fs.readFileSync(path.join(src, 'wordmark-source.png')).toString('base64');
    write(path.join(out, 'wordmark.png'), await run('wordmark', wm, 1032, 256, 54));
    console.log('icons written');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; }
  app.quit();
});
