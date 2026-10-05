// tools/serve.js - a tiny static server for working on the browser version: node tools/serve.js [port]
// No dependencies. Listens on this computer only (localhost) and serves just the web app's own files.
const http=require('http'), fs=require('fs'), path=require('path');
const root=path.resolve(__dirname,'..'), port=+process.argv[2]||8090;
const allowed=/^\/(index\.html|css\/|js\/|assets\/|vendor\/)/;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml',
  '.png':'image/png','.ico':'image/x-icon','.ttf':'font/ttf','.wasm':'application/wasm','.gz':'application/gzip','.txt':'text/plain; charset=utf-8','.pdf':'application/pdf'};
http.createServer((req,res)=>{
  let p; try{ p=decodeURIComponent(req.url.split('?')[0]); }catch(e){ res.writeHead(400); return res.end(); }
  if(p==='/') p='/index.html';
  const f=path.join(root,path.normalize(p));
  if(!allowed.test(p)||!f.startsWith(root)) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(f,(err,st)=>{
    if(err||!st.isFile()){ res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200,{'Content-Type':types[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(port,'127.0.0.1',()=>console.log(`Gigabeam (browser version): http://localhost:${port}/`));
