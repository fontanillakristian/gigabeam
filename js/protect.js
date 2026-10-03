/* protect.js - Password protection: real AES-256 encryption of a PDF (the PDF 2.0 "Standard security handler", revision 6), and the matching
   decryption so a protected file can be opened and edited here.
   pdf-lib cannot encrypt, so this file does it: every stream and every string of every object is encrypted with AES-256-CBC, and an /Encrypt
   dictionary holds the password check values and the (password-wrapped) file key. It uses only the browser's Web Crypto API, so it also runs in
   the background worker. Needs a secure context (https or localhost): Web Crypto does not exist elsewhere.

   What it protects: without the open (user) password nothing in the file can be read, split, merged, reprinted or converted: the content is
   ciphertext. The permission flags (printing, copying, editing...) are only requests that well-behaved programs honour; anyone who can open
   the file can strip them. */

// ---- small helpers
const PR_enc=new TextEncoder();
const prConcat=(...a)=>{ const n=a.reduce((s,x)=>s+x.length,0), o=new Uint8Array(n); let p=0; a.forEach(x=>{ o.set(x,p); p+=x.length; }); return o; };
const prRand=n=>crypto.getRandomValues(new Uint8Array(n));
const prHex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const prSha=async(alg,data)=>new Uint8Array(await crypto.subtle.digest(alg,data));
const prPw=s=>PR_enc.encode(String(s||'').normalize('NFC')).slice(0,127); // UTF-8, at most 127 bytes
function prNeedCrypto(){ if(!(typeof crypto!=='undefined'&&crypto.subtle)) throw new Error('Encryption needs a secure page (https or localhost); it is not available when the file is opened straight from disk.'); }
// AES-CBC without padding, on data that is a multiple of 16 bytes (Web Crypto always pads, so the padding block is cut off / supplied)
async function prCbcRaw(keyBytes,iv,data,encrypt){
  const alg={name:'AES-CBC',iv}, key=await crypto.subtle.importKey('raw',keyBytes,'AES-CBC',false,['encrypt','decrypt']);
  if(encrypt) return new Uint8Array(await crypto.subtle.encrypt(alg,key,data)).slice(0,data.length);
  // decrypt: add one extra block that decrypts to a valid padding block, then Web Crypto strips it again
  const last=data.slice(data.length-16), pad=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv:last},key,new Uint8Array(16).fill(16))).slice(0,16);
  return new Uint8Array(await crypto.subtle.decrypt(alg,key,prConcat(data,pad)));
}
// Algorithm 2.B (ISO 32000-2): the slow, salted password hash that makes guessing passwords expensive
async function prHash(pw,salt,udata){
  let k=(await prSha('SHA-256',prConcat(pw,salt,udata))), e=new Uint8Array(1), i=0;
  while(i<64||e[e.length-1]>i-32){
    const one=prConcat(pw,k,udata), k1=new Uint8Array(one.length*64); for(let j=0;j<64;j++) k1.set(one,j*one.length);
    e=await prCbcRaw(k.slice(0,16),k.slice(16,32),k1,true);
    let s=0; for(let j=0;j<16;j++) s+=e[j];
    k=await prSha(['SHA-256','SHA-384','SHA-512'][s%3],e); i++;
  }
  return k.slice(0,32);
}
// permissions -> the /P value (a signed 32-bit number). perms: {print:'high'|'low'|'none', modify, copy, annotate, assemble, accessibility}
function prPermBits(p){
  p=Object.assign({print:'high',modify:true,copy:true,annotate:true,assemble:true,accessibility:true},p||{});
  let v=0xFFFFF0C0; // reserved bits are 1
  if(p.print!=='none') v|=4; if(p.print==='high') v|=2048;
  if(p.modify) v|=8; if(p.copy) v|=16; if(p.annotate) v|=32|256; if(p.assemble) v|=1024; if(p.accessibility) v|=512;
  return v|0;
}
function prPermsFrom(P){
  P=P|0; const has=b=>(P&b)!==0;
  return {print:has(4)?(has(2048)?'high':'low'):'none',modify:has(8),copy:has(16),annotate:has(32),assemble:has(1024),accessibility:has(512)};
}
const prIsStr=o=>o instanceof PDFLib.PDFString||o instanceof PDFLib.PDFHexString;

// ---- encrypt
// bytes: a complete, unencrypted PDF. opts: {userPw, ownerPw, perms}. Resolves to the encrypted file's bytes.
async function protectPdf(bytes,opts){
  prNeedCrypto();
  const {PDFName,PDFHexString,PDFRawStream,PDFStream,PDFNumber,PDFDict,PDFArray,PDFRef}=PDFLib;
  const userPw=prPw(opts.userPw), ownerPw=prPw(opts.ownerPw||opts.userPw), P=prPermBits(opts.perms);
  // 1. the file key, and the password check values (algorithms 8 and 9, ISO 32000-2)
  const fileKey=prRand(32);
  const uvs=prRand(8), uks=prRand(8), U=prConcat(await prHash(userPw,uvs,new Uint8Array(0)),uvs,uks);
  const UE=await prCbcRaw(await prHash(userPw,uks,new Uint8Array(0)),new Uint8Array(16),fileKey,true);
  const ovs=prRand(8), oks=prRand(8), O=prConcat(await prHash(ownerPw,ovs,U),ovs,oks);
  const OE=await prCbcRaw(await prHash(ownerPw,oks,U),new Uint8Array(16),fileKey,true);
  const perm=new Uint8Array(16); new DataView(perm.buffer).setUint32(0,P>>>0,true); perm.set([255,255,255,255],4); perm[8]=84; perm[9]=97; perm[10]=100; perm[11]=98; perm.set(prRand(4),12); // P, ffffffff, 'T', 'adb', random
  const PermsV=await prCbcRaw(fileKey,new Uint8Array(16),perm,true); // one block, so CBC with a zero IV equals ECB
  // 2. encrypt every stream and string
  const doc=await loadPdf(bytes), ctx=doc.context, key=await crypto.subtle.importKey('raw',fileKey,'AES-CBC',false,['encrypt']);
  const aes=async data=>{ const iv=prRand(16); return prConcat(iv,new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv},key,data))); };
  const encStr=async s=>PDFHexString.of(prHex(await aes(s.asBytes())));
  const walk=async o=>{ // encrypt the strings inside a direct object, in place
    if(o instanceof PDFDict){ for(const [k,v] of Array.from(o.entries())){ if(prIsStr(v)) o.set(k,await encStr(v)); else if(v instanceof PDFDict||v instanceof PDFArray) await walk(v); } }
    else if(o instanceof PDFArray){ for(let i=0;i<o.size();i++){ const v=o.get(i); if(prIsStr(v)) o.set(i,await encStr(v)); else if(v instanceof PDFDict||v instanceof PDFArray) await walk(v); } }
  };
  const typeOf=o=>{ const t=o&&o.dict&&o.dict.get(PDFName.of('Type')); return t?String(t):''; };
  for(const [ref,obj] of Array.from(ctx.enumerateIndirectObjects())){
    if(obj instanceof PDFStream){
      const t=typeOf(obj);
      if(t==='/ObjStm'||t==='/XRef'){ ctx.delete(ref); continue; } // its objects were already unpacked: leaving it would leave a plain copy behind
      await walk(obj.dict);
      const data=await aes(obj.getContents()), dict=obj.dict; dict.set(PDFName.of('Length'),PDFNumber.of(data.length));
      ctx.assign(ref,PDFRawStream.of(dict,data));
    } else if(obj instanceof PDFDict||obj instanceof PDFArray) await walk(obj);
    else if(prIsStr(obj)) ctx.assign(ref,await encStr(obj));
  }
  // 3. the /Encrypt dictionary (its own strings are not encrypted) and the file identifier
  const enc=ctx.obj({Filter:'Standard',V:5,R:6,Length:256,CF:{StdCF:{AuthEvent:'DocOpen',CFM:'AESV3',Length:32}},StmF:'StdCF',StrF:'StdCF',P,EncryptMetadata:true});
  enc.set(PDFName.of('O'),PDFHexString.of(prHex(O))); enc.set(PDFName.of('U'),PDFHexString.of(prHex(U)));
  enc.set(PDFName.of('OE'),PDFHexString.of(prHex(OE))); enc.set(PDFName.of('UE'),PDFHexString.of(prHex(UE))); enc.set(PDFName.of('Perms'),PDFHexString.of(prHex(PermsV)));
  ctx.trailerInfo.Encrypt=ctx.register(enc);
  const id=PDFHexString.of(prHex(prRand(16))); ctx.trailerInfo.ID=ctx.obj([id,id]);
  return doc.save(Object.assign({},SAVE_OPTS,{useObjectStreams:false,addDefaultPage:false})); // (SAVE_OPTS: don't pause every 50 objects)
}

// ---- decrypt
// Opens a protected file: tries the password and, if right, returns the decrypted bytes. Resolves to
//   {notEncrypted:true}  or  {bytes, role:'user'|'owner', perms}    and throws an Error with .code = 'password' | 'unsupported'.
async function unprotectPdf(bytes,password){
  prNeedCrypto();
  const {PDFName,PDFHexString,PDFRawStream,PDFStream,PDFDict,PDFArray,PDFNumber}=PDFLib;
  let doc; try{ doc=await loadPdf(bytes,{ignoreEncryption:true,updateMetadata:false}); }catch(e){ const x=new Error('This protected file uses compressed objects that cannot be read without decrypting them first.'); x.code='unsupported'; throw x; }
  const ctx=doc.context, encRef=ctx.trailerInfo.Encrypt; if(!encRef) return {notEncrypted:true};
  const enc=ctx.lookup(encRef); if(!(enc instanceof PDFDict)){ return {notEncrypted:true}; }
  const num=k=>{ const v=enc.lookup(PDFName.of(k)); return v&&v.asNumber?v.asNumber():null; }, bin=k=>{ const v=enc.lookup(PDFName.of(k)); return v&&v.asBytes?v.asBytes():null; };
  const filt=enc.lookup(PDFName.of('Filter')), V=num('V'), R=num('R');
  if(String(filt)!=='/Standard'||V!==5||(R!==5&&R!==6)){ const x=new Error('This file uses an older kind of protection (RC4 or AES-128). Gigabeam can edit files protected with AES-256.'); x.code='unsupported'; throw x; }
  const U=bin('U'), O=bin('O'), UE=bin('UE'), OE=bin('OE'), P=num('P')|0, pw=prPw(password), none=new Uint8Array(0);
  if(!U||!O||!UE||!OE||U.length<48||O.length<48){ const x=new Error('The protection data in this file is damaged.'); x.code='unsupported'; throw x; }
  const hashR=R===6?prHash:async(p,s,u)=>prSha('SHA-256',prConcat(p,s,u)); // revision 5 (Adobe's earlier AES-256): one plain SHA-256
  const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
  let role=null, fileKey=null;
  if(same(await hashR(pw,O.slice(32,40),U.slice(0,48)),O.slice(0,32))){ role='owner'; fileKey=await prCbcRaw(await hashR(pw,O.slice(40,48),U.slice(0,48)),new Uint8Array(16),OE.slice(0,32),false); }
  else if(same(await hashR(pw,U.slice(32,40),none),U.slice(0,32))){ role='user'; fileKey=await prCbcRaw(await hashR(pw,U.slice(40,48),none),new Uint8Array(16),UE.slice(0,32),false); }
  else { const x=new Error('Incorrect password'); x.code='password'; throw x; }
  const encMeta=enc.lookup(PDFName.of('EncryptMetadata')); const metaPlain=encMeta&&String(encMeta)==='false';
  const key=await crypto.subtle.importKey('raw',fileKey,'AES-CBC',false,['decrypt']);
  const aes=async data=>{ if(data.length<32||data.length%16) return data; return new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv:data.slice(0,16)},key,data.slice(16))); };
  const decStr=async s=>{ const b=s.asBytes(); return PDFHexString.of(prHex(await aes(b))); };
  const walk=async o=>{
    if(o instanceof PDFDict){ for(const [k,v] of Array.from(o.entries())){ if(prIsStr(v)) o.set(k,await decStr(v)); else if(v instanceof PDFDict||v instanceof PDFArray) await walk(v); } }
    else if(o instanceof PDFArray){ for(let i=0;i<o.size();i++){ const v=o.get(i); if(prIsStr(v)) o.set(i,await decStr(v)); else if(v instanceof PDFDict||v instanceof PDFArray) await walk(v); } }
  };
  for(const [ref,obj] of Array.from(ctx.enumerateIndirectObjects())){
    if(String(ref)===String(encRef)) continue;
    if(obj instanceof PDFStream){
      const t=obj.dict.get(PDFName.of('Type')), ts=t?String(t):'';
      if(ts==='/XRef') { ctx.delete(ref); continue; }
      await walk(obj.dict);
      if(ts==='/Metadata'&&metaPlain) continue;
      const data=await aes(obj.getContents()); obj.dict.set(PDFName.of('Length'),PDFNumber.of(data.length)); ctx.assign(ref,PDFRawStream.of(obj.dict,data));
    } else if(obj instanceof PDFDict||obj instanceof PDFArray) await walk(obj);
    else if(prIsStr(obj)) ctx.assign(ref,await decStr(obj));
  }
  ctx.delete(encRef); delete ctx.trailerInfo.Encrypt;
  return {bytes:await doc.save(Object.assign({},SAVE_OPTS,{useObjectStreams:false})),role,perms:prPermsFrom(P),P};
}
