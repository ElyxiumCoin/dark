'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {verifyTelegramInitData}=require('../auth');
const token='123456:TEST';
const now=1800000000;
function signedData(user,authDate=now){
  const p=new URLSearchParams({user:JSON.stringify(user),auth_date:String(authDate),query_id:'q'});
  const check=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  p.set('hash',crypto.createHmac('sha256',secret).update(check).digest('hex'));
  return p.toString();
}
test('valid Telegram user',()=>assert.deepEqual(verifyTelegramInitData(signedData({id:123,first_name:'Тест'}),token,now),{id:'123',username:null,name:'Тест'}));
test('forged ID denied',()=>assert.throws(()=>verifyTelegramInitData(signedData({id:123}).replace('123','999'),token,now),/signature/));
test('expired init data denied',()=>assert.throws(()=>verifyTelegramInitData(signedData({id:123},now-86401),token,now),/expired/));
test('duplicate user denied',()=>assert.throws(()=>verifyTelegramInitData(signedData({id:123})+'&user=%7B%22id%22%3A1%7D',token,now),/invalid_telegram_data/));
