/* protect-ui.js - Password protection in the interface: the "Password protection" dialog, asking for a password when a protected file is opened,
   and the lock mark on a protected tab. The encryption itself is in protect.js.
   A tab's protection is {userPw, ownerPw, perms}; it is applied every time that tab is saved (see saveActiveDocument), and kept for files that were
   opened with a password, so saving never silently strips it. */

// how good a password looks: length first, a little credit for variety
function pwStrength(s){
  s=String(s||''); if(!s) return {score:0,label:'',cls:''};
  const kinds=[/[a-z]/,/[A-Z]/,/\d/,/[^A-Za-z0-9]/].filter(r=>r.test(s)).length;
  let pts=s.length>=20?4:s.length>=16?3.4:s.length>=12?2.6:s.length>=8?1.6:0.6; pts+=Math.min(1,(kinds-1)*0.35);
  if(/^(.)\1+$/.test(s)||/^(password|12345678|qwerty|letmein|admin)/i.test(s)) pts=Math.min(pts,0.6);
  return pts>=4?{score:4,label:'Very strong',cls:'s4'}:pts>=3?{score:3,label:'Strong',cls:'s3'}:pts>=2?{score:2,label:'Fair: longer is better',cls:'s2'}:{score:1,label:'Weak: use 12 or more characters',cls:'s1'};
}
// a random password (letters and digits without look-alikes), 20 characters
function pwGenerate(n){ const A='abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', r=crypto.getRandomValues(new Uint32Array(n||20)); return Array.from(r,x=>A[x%A.length]).join(''); }

// ---- ask for the password of a file that is being opened
function askPassword(fileName,wasWrong){
  return dialog({title:'Password required',ok:'Open',
    body:`<div style="margin-bottom:10px"><b>${esc(fileName)}</b> is password protected.</div>
      <label>Password<input type="password" id="pw-open" autocomplete="off" spellcheck="false"></label>
      <div class="dlg-note" style="color:#ff8a8e;margin-top:6px;${wasWrong?'':'display:none'}">That password is not correct.</div>`,
    onReady:ov=>{ const i=ov.querySelector('#pw-open'); setTimeout(()=>i.focus(),0); i.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); ov.querySelector('.dlg-ok').click(); } }); },
    collect:(ov,setErr)=>{ const v=ov.querySelector('#pw-open').value; if(!v){ setErr('Enter the password'); return undefined; } return v; }});
}
// Decrypt a file read from disk. Resolves {bytes, protection} (protection = null when the file was not protected), or null when the user gave up or it can't be opened.
async function openProtected(name,buf){
  if(!rawHas(buf,'/Encrypt')) return {bytes:buf,protection:null};
  let pw='', wrong=false;
  for(;;){
    let r;
    try{ r=await heavy('unprotect',{bytes:new Uint8Array(buf).slice(),password:pw},{stateless:true}); }
    catch(err){
      if(err.code==='password'){ hideLoad(); const p=await askPassword(name,wrong||pw!==''); if(p==null) return null; pw=p; wrong=true; showLoad(name,'Unlocking…',20); continue; }
      hideLoad(); await modalAlert('Could not open '+esc(name)+': '+esc(err.message)); return null;
    }
    if(r.notEncrypted) return {bytes:buf,protection:null};
    const owner=r.role==='owner';
    return {bytes:r.bytes,protection:{userPw:pw,ownerPw:owner?pw:'',perms:r.perms,fromFile:true,role:r.role,legacy:!!r.legacy}};
  }
}

// ---- the dialog
async function protectDialog(){
  if(!pdfDoc) return;
  const tab=docs[activeDoc], cur=tab&&tab.protection, perms=Object.assign({print:'high',modify:true,copy:true,annotate:true,assemble:true,accessibility:true},cur&&cur.perms);
  if(typeof crypto==='undefined'||!crypto.subtle){ await modalAlert('Password protection needs Gigabeam to run from https or localhost. It is not available when the page is opened straight from disk.'); return; }
  const chk=(id,label,on)=>`<label class="chk"><input type="checkbox" id="${id}"${on?' checked':''}> ${label}</label>`;
  const r=await dialog({title:'Password protection',ok:cur?'Apply changes':'Protect',
    body:`<div class="sub" style="margin-bottom:10px">Encrypts the saved file with AES-256. Without the password nobody can open it, and so nobody can read, split, merge or reprint it.</div>
      <label>Password to open the file<input type="password" id="pp-user" autocomplete="new-password" spellcheck="false" value="${esc(cur?cur.userPw:'')}"></label>
      <div class="pp-meter"><i id="pp-bar"></i></div><div class="sub" id="pp-strength" style="min-height:14px"></div>
      <label>Confirm password<input type="password" id="pp-user2" autocomplete="new-password" spellcheck="false" value="${esc(cur?cur.userPw:'')}"></label>
      <div class="row" style="justify-content:flex-start;gap:8px;margin:8px 0 2px"><button type="button" id="pp-gen">Generate a strong password</button><button type="button" id="pp-copy">Copy</button>${chk('pp-show','Show',false)}</div>
      <div class="sub" style="margin:2px 0 12px"><b>There is no way to recover a lost password.</b> Keep it somewhere safe.</div>
      <div class="fp-sec" style="margin:0"><h5>Restrictions</h5>
        <div class="sub" style="margin-bottom:6px">Honoured by Acrobat and most viewers, but they are requests, not locks: a program that ignores them can still use the file once it is open. The password is the real protection.</div>
        <label>Printing<select id="pp-print"><option value="high"${perms.print==='high'?' selected':''}>Allowed</option><option value="low"${perms.print==='low'?' selected':''}>Low quality only</option><option value="none"${perms.print==='none'?' selected':''}>Not allowed</option></select></label>
        ${chk('pp-copyc','Allow copying text and images',perms.copy)}${chk('pp-mod','Allow editing the content',perms.modify)}${chk('pp-ann','Allow comments and filling in forms',perms.annotate)}
        ${chk('pp-asm','Allow inserting, deleting and rotating pages',perms.assemble)}${chk('pp-acc','Allow screen readers',perms.accessibility)}
        <label style="margin-top:8px">Password to change these restrictions (optional)<input type="password" id="pp-owner" autocomplete="new-password" spellcheck="false" value="${esc(cur&&cur.ownerPw&&cur.ownerPw!==cur.userPw?cur.ownerPw:'')}" placeholder="Same as the open password if empty"></label>
      </div>
      ${cur?`<div class="row" style="justify-content:flex-start;margin-top:10px"><button type="button" id="pp-remove" class="danger">Remove password protection</button></div>`:''}`,
    onReady:(ov,setErr)=>{
      const u=ov.querySelector('#pp-user'), u2=ov.querySelector('#pp-user2'), o=ov.querySelector('#pp-owner'), bar=ov.querySelector('#pp-bar'), st=ov.querySelector('#pp-strength');
      const meter=()=>{ const s=pwStrength(u.value); bar.style.width=(s.score*25)+'%'; bar.className='s'+s.score; st.textContent=s.label; };
      u.addEventListener('input',meter); meter();
      ov.querySelector('#pp-show').addEventListener('change',e=>{ [u,u2,o].forEach(x=>{ x.type=e.target.checked?'text':'password'; }); });
      ov.querySelector('#pp-gen').onclick=()=>{ const p=pwGenerate(20); u.value=p; u2.value=p; ov.querySelector('#pp-show').checked=true; [u,u2,o].forEach(x=>{ x.type='text'; }); meter(); };
      ov.querySelector('#pp-copy').onclick=async()=>{ try{ await navigator.clipboard.writeText(u.value); toast('Password copied'); }catch(e){ u.select(); document.execCommand('copy'); toast('Password copied'); } };
      const rm=ov.querySelector('#pp-remove'); if(rm) rm.onclick=()=>{ ov.querySelector('.dlg-ok').dataset.remove='1'; ov.querySelector('.dlg-ok').click(); };
    },
    collect:(ov,setErr)=>{
      if(ov.querySelector('.dlg-ok').dataset.remove) return {remove:true};
      const u=ov.querySelector('#pp-user').value, u2=ov.querySelector('#pp-user2').value, o=ov.querySelector('#pp-owner').value;
      if(u.length<8){ setErr('Use at least 8 characters for the password (12 or more is much safer).'); return undefined; }
      if(u!==u2){ setErr('The two passwords do not match.'); return undefined; }
      if(/[^\x00-\x7F]/.test(u+o)){ setErr('Use letters, digits and common symbols only, so other programs can accept the password too.'); return undefined; }
      return {userPw:u,ownerPw:o||u,perms:{print:ov.querySelector('#pp-print').value,copy:ov.querySelector('#pp-copyc').checked,modify:ov.querySelector('#pp-mod').checked,annotate:ov.querySelector('#pp-ann').checked,assemble:ov.querySelector('#pp-asm').checked,accessibility:ov.querySelector('#pp-acc').checked}};
    }});
  if(!r) return;
  if(r.remove){ tab.protection=null; markDirty(); renderTabBar(); toast('Password protection removed. Save to write an unprotected file.'); return; }
  tab.protection=r; markDirty(); renderTabBar();
  toast('Password protection set. It is applied when you save.');
}
$('protect-btn').onclick=protectDialog;
