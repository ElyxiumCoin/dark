'use strict';
const crypto = require('node:crypto');
function verifyTelegramInitData(raw, token, now=Math.floor(Date.now()/1000)) {
  if(typeof raw!=='string'||!raw||raw.length>8192||!token) throw Error('invalid_telegram_data');
  const p=new URLSearchParams(raw);
  for(const k of ['hash','auth_date','user']) if(p.getAll(k).length!==1) throw Error('invalid_telegram_data');
  const received=p.get('hash');
  if(!/^[a-f0-9]{64}$/i.test(received||'')) throw Error('invalid_telegram_data');
  const check=[...p.entries()].filter(([k])=>k!=='hash'&&k!=='signature')
    .sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  const hash=crypto.createHmac('sha256',secret).update(check).digest();
  if(!crypto.timingSafeEqual(hash,Buffer.from(received,'hex'))) throw Error('invalid_telegram_signature');
  const authDate=Number(p.get('auth_date'));
  if(!Number.isSafeInteger(authDate)||authDate>now+60||now-authDate>86400) throw Error('telegram_session_expired');
  let user;
  try {user=JSON.parse(p.get('user'));}catch{throw Error('invalid_telegram_user');}
  if(!user||!Number.isSafeInteger(user.id)||user.id<=0) throw Error('invalid_telegram_user');
  return {id:String(user.id),
    username:typeof user.username==='string'?user.username.slice(0,32):null,
    name:[user.first_name,user.last_name].filter(x=>typeof x==='string').join(' ').slice(0,80)||'Сталкер'};
}
module.exports={verifyTelegramInitData};
