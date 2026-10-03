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
  const unsupported=msg=>{ const x=new Error(msg); x.code='unsupported'; return x; };
  let doc; try{ doc=await loadPdf(bytes,{ignoreEncryption:true,updateMetadata:false}); }catch(e){ throw unsupported('This protected file keeps its objects in compressed groups, which cannot be read without decrypting them first.'); }
  const ctx=doc.context, encRef=ctx.trailerInfo.Encrypt; if(!encRef) return {notEncrypted:true};
  const enc=ctx.lookup(encRef); if(!(enc instanceof PDFDict)){ return {notEncrypted:true}; }
  const num=k=>{ const v=enc.lookup(PDFName.of(k)); return v&&v.asNumber?v.asNumber():null; }, bin=k=>{ const v=enc.lookup(PDFName.of(k)); return v&&v.asBytes?v.asBytes():null; };
  const filt=enc.lookup(PDFName.of('Filter')), V=num('V')||0, R=num('R')||0;
  if(String(filt)!=='/Standard') throw unsupported('This file uses a custom protection plug-in that Gigabeam does not know.');
  const U=bin('U'), O=bin('O'), P=(num('P')||0)|0, pw=prPw(password), none=new Uint8Array(0);
  const encMetaV=enc.lookup(PDFName.of('EncryptMetadata')), metaPlain=!!encMetaV&&String(encMetaV)==='false';
  const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
  let role=null, legacy=false, decBytes=null;
  if(V===5&&(R===5||R===6)){
    // ---- AES-256 (what Gigabeam writes, and current Acrobat)
    const UE=bin('UE'), OE=bin('OE');
    if(!U||!O||!UE||!OE||U.length<48||O.length<48) throw unsupported('The protection data in this file is damaged.');
    const hashR=R===6?prHash:async(p,s,u)=>prSha('SHA-256',prConcat(p,s,u)); // revision 5 (Adobe's earlier AES-256): one plain SHA-256
    let fileKey=null;
    if(same(await hashR(pw,O.slice(32,40),U.slice(0,48)),O.slice(0,32))){ role='owner'; fileKey=await prCbcRaw(await hashR(pw,O.slice(40,48),U.slice(0,48)),new Uint8Array(16),OE.slice(0,32),false); }
    else if(same(await hashR(pw,U.slice(32,40),none),U.slice(0,32))){ role='user'; fileKey=await prCbcRaw(await hashR(pw,U.slice(40,48),none),new Uint8Array(16),UE.slice(0,32),false); }
    else { const x=new Error('Incorrect password'); x.code='password'; throw x; }
    const key=await crypto.subtle.importKey('raw',fileKey,'AES-CBC',false,['decrypt']);
    decBytes=async(ref,data)=>{ if(data.length<32||data.length%16) return data; return new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv:data.slice(0,16)},key,data.slice(16))); };
  } else if(V>=1&&V<=4&&R>=2&&R<=4){
    // ---- older handlers: RC4 40/128-bit (V1, V2) and RC4 or AES-128 through crypt filters (V4)
    legacy=true;
    if(!U||!O||U.length<32||O.length<32) throw unsupported('The protection data in this file is damaged.');
    const idArr=ctx.lookup(ctx.trailerInfo.ID), id0=(idArr&&idArr.lookup?(()=>{ const f=idArr.lookup(0); return f&&f.asBytes?f.asBytes():none; })():none);
    const keyLen=V===1?5:V===4?16:Math.max(5,Math.min(16,Math.floor((num('Length')||40)/8)));
    let stmM='rc4', strM='rc4'; // how streams and strings are encrypted
    if(V===4){ const cf=enc.lookup(PDFName.of('CF')), method=nm=>{ if(!nm||String(nm)==='/Identity') return 'none'; const f=cf&&cf.lookup&&cf.lookup(PDFName.of(String(nm).slice(1))), m=f&&f.lookup(PDFName.of('CFM')), s=m?String(m):'/None'; return s==='/AESV2'?'aes':s==='/V2'?'rc4':'none'; };
      stmM=method(enc.lookup(PDFName.of('StmF'))); strM=method(enc.lookup(PDFName.of('StrF'))); }
    const pBytes=new Uint8Array(4); new DataView(pBytes.buffer).setInt32(0,P,true);
    const padPw=p=>{ const o=new Uint8Array(32), b=p.slice(0,32); o.set(b); o.set(PR_PAD.slice(0,32-b.length),b.length); return o; };
    const lpw=Uint8Array.from(String(password||''),c=>c.charCodeAt(0)&255); // these handlers take the password as single-byte characters
    const mkKey=padded=>{ let h=prMd5(prConcat(padded,O.slice(0,32),pBytes,id0,(R>=4&&metaPlain)?new Uint8Array([255,255,255,255]):none)); if(R>=3) for(let i=0;i<50;i++) h=prMd5(h.slice(0,keyLen)); return h.slice(0,keyLen); }; // algorithm 2
    const xorKey=(k,i)=>k.map(b=>b^i);
    const userOk=key=>{ // algorithms 4 / 5 compared with /U
      if(R===2) return same(prRc4(key,PR_PAD),U.slice(0,32));
      let x=prRc4(key,prMd5(prConcat(PR_PAD,id0))); for(let i=1;i<=19;i++) x=prRc4(xorKey(key,i),x); return same(x,U.slice(0,16)); };
    let fileKey=mkKey(padPw(lpw));
    if(userOk(fileKey)) role='user';
    else { // maybe it is the owner password: recover the user password from /O (algorithm 7), then check that
      let h=prMd5(padPw(lpw)); if(R>=3) for(let i=0;i<50;i++) h=prMd5(h); const ok=h.slice(0,R===2?5:keyLen); let d=O.slice(0,32);
      if(R===2) d=prRc4(ok,d); else for(let i=19;i>=0;i--) d=prRc4(xorKey(ok,i),d);
      const k2=mkKey(d); if(userOk(k2)){ role='owner'; fileKey=k2; } else { const x=new Error('Incorrect password'); x.code='password'; throw x; } }
    const objKey=(ref,aes)=>{ const n=ref.objectNumber, g=ref.generationNumber; return prMd5(prConcat(fileKey,Uint8Array.from([n&255,(n>>8)&255,(n>>16)&255,g&255,(g>>8)&255]),aes?PR_enc.encode('sAlT'):none)).slice(0,Math.min(keyLen+5,16)); }; // algorithm 1
    decBytes=async(ref,data,isStream)=>{
      const m=isStream?stmM:strM; if(m==='none') return data;
      const k=objKey(ref,m==='aes'); if(m==='rc4') return prRc4(k,data);
      if(data.length<32||data.length%16) return data;
      const ck=await crypto.subtle.importKey('raw',k,'AES-CBC',false,['decrypt']); return new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv:data.slice(0,16)},ck,data.slice(16))); };
  } else throw unsupported('This file uses a kind of protection (version '+V+', revision '+R+') that Gigabeam does not support.');
  // ---- decrypt every stream and string
  const decStr=async(ref,s)=>PDFHexString.of(prHex(await decBytes(ref,s.asBytes(),false)));
  const walk=async(ref,o)=>{
    if(o instanceof PDFDict){ for(const [k,v] of Array.from(o.entries())){ if(prIsStr(v)) o.set(k,await decStr(ref,v)); else if(v instanceof PDFDict||v instanceof PDFArray) await walk(ref,v); } }
    else if(o instanceof PDFArray){ for(let i=0;i<o.size();i++){ const v=o.get(i); if(prIsStr(v)) o.set(i,await decStr(ref,v)); else if(v instanceof PDFDict||v instanceof PDFArray) await walk(ref,v); } }
  };
  for(const [ref,obj] of Array.from(ctx.enumerateIndirectObjects())){
    if(String(ref)===String(encRef)) continue;
    if(obj instanceof PDFStream){
      const t=obj.dict.get(PDFName.of('Type')), ts=t?String(t):'';
      if(ts==='/XRef'){ ctx.delete(ref); continue; }
      await walk(ref,obj.dict);
      if(ts==='/Metadata'&&metaPlain) continue;
      const data=await decBytes(ref,obj.getContents(),true); obj.dict.set(PDFName.of('Length'),PDFNumber.of(data.length)); ctx.assign(ref,PDFRawStream.of(obj.dict,data));
    } else if(obj instanceof PDFDict||obj instanceof PDFArray) await walk(ref,obj);
    else if(prIsStr(obj)) ctx.assign(ref,await decStr(ref,obj));
  }
  ctx.delete(encRef); delete ctx.trailerInfo.Encrypt;
  return {bytes:await doc.save(Object.assign({},SAVE_OPTS,{useObjectStreams:false})),role,perms:prPermsFrom(P),P,legacy};
}

// ---- MD5 and RC4: the older security handlers need them (Web Crypto has neither)
const PR_PAD=Uint8Array.from([0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,0x64,0x00,0x4E,0x56,0xFF,0xFA,0x01,0x08,0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A]);
const PR_MD5_S=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
const PR_MD5_K=(()=>{ const k=new Uint32Array(64); for(let i=0;i<64;i++) k[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296); return k; })();
function prMd5(msg){
  const len=msg.length, n=(((len+8)>>>6)+1)*64, buf=new Uint8Array(n); buf.set(msg); buf[len]=0x80;
  const dv=new DataView(buf.buffer); dv.setUint32(n-8,(len<<3)>>>0,true); dv.setUint32(n-4,Math.floor(len/536870912),true);
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476; const M=new Uint32Array(16);
  for(let off=0;off<n;off+=64){
    for(let i=0;i<16;i++) M[i]=dv.getUint32(off+i*4,true);
    let A=a0,B=b0,C=c0,D=d0;
    for(let i=0;i<64;i++){ let F,g;
      if(i<16){ F=(B&C)|(~B&D); g=i; } else if(i<32){ F=(D&B)|(~D&C); g=(5*i+1)%16; } else if(i<48){ F=B^C^D; g=(3*i+5)%16; } else { F=C^(B|~D); g=(7*i)%16; }
      F=(F+A+PR_MD5_K[i]+M[g])>>>0; A=D; D=C; C=B; B=(B+((F<<PR_MD5_S[i])|(F>>>(32-PR_MD5_S[i]))))>>>0; }
    a0=(a0+A)>>>0; b0=(b0+B)>>>0; c0=(c0+C)>>>0; d0=(d0+D)>>>0; }
  const out=new Uint8Array(16), o=new DataView(out.buffer); o.setUint32(0,a0,true); o.setUint32(4,b0,true); o.setUint32(8,c0,true); o.setUint32(12,d0,true); return out;
}
function prRc4(key,data){
  const S=new Uint8Array(256); for(let i=0;i<256;i++) S[i]=i;
  for(let i=0,j=0;i<256;i++){ j=(j+S[i]+key[i%key.length])&255; const t=S[i]; S[i]=S[j]; S[j]=t; }
  const out=new Uint8Array(data.length); let a=0,b=0;
  for(let k=0;k<data.length;k++){ a=(a+1)&255; b=(b+S[a])&255; const t=S[a]; S[a]=S[b]; S[b]=t; out[k]=data[k]^S[(S[a]+S[b])&255]; }
  return out;
}
