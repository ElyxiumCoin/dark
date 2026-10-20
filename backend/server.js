'use strict';
require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { verifyTelegramInitData } = require('./auth');

if (!process.env.BOT_TOKEN || !process.env.DATABASE_URL) {
  throw new Error('Configure BOT_TOKEN and DATABASE_URL in your private hosting environment');
}
const app = express();
app.disable('x-powered-by');
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean));
app.use('/api', (req, res, next) => {
  res.vary('Origin');
  const origin = req.get('origin');
  if (origin) {
    if (!allowedOrigins.has(origin)) return res.status(403).json({error:'Недопустимый адрес игры'});
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({limit:'300kb'}));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({error:'Сохранение слишком большое'});
  if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({error:'Неверный JSON'});
  next(err);
});
const pool = new Pool({connectionString:process.env.DATABASE_URL, max:10});
const int = (v, lo, hi) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.trunc(Number(v)))) : lo;
const money = (v, hi) => Number.isFinite(Number(v)) ? Math.round(Math.max(0, Math.min(hi, Number(v))) * 100)/100 : 0;
const safeText = (v, n, fallback) => typeof v === 'string' ? (v.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n) || fallback) : fallback;
function statsOf(s) {
  const level = int(s.level, 1, 100);
  const kills = int(s.tracker?.kills, 0, 100000000);
  const searches = int(s.tracker?.searches, 0, 100000000);
  const rubles = int(s.rubles, 0, 100000000000);
  const gram = money(s.gramcoin, 100000000);
  return {
    level,kills,searches,rubles,gram,
    name:safeText(s.name,24,'Сталкер'),
    title:safeText(s.title,32,'Новичок'),
    equipment: {
      weapon:safeText(s.equipment?.weapon,80,'')||null,
      armor:safeText(s.equipment?.armor,80,'')||null,
      artifact:safeText(s.equipment?.artifact,80,'')||null
    },
    score:level*200 + kills*12 + Math.floor(rubles/250) + Math.floor(gram*30)
  };
}
async function authenticate(req, res, next) {
  try {
    const header=req.get('authorization')||'';
    if(!header.startsWith('tma ')) return res.status(401).json({error:'Откройте игру через Telegram Mini App'});
    const user=verifyTelegramInitData(header.slice(4), process.env.BOT_TOKEN);
    req.telegramUser=user;
    await pool.query(`INSERT INTO zona_players(telegram_id,telegram_username,telegram_name,game_name)
      VALUES($1,$2,$3,$3) ON CONFLICT(telegram_id) DO UPDATE SET
        telegram_username=EXCLUDED.telegram_username,
        telegram_name=EXCLUDED.telegram_name,last_seen_at=NOW()`,[user.id,user.username,user.name]);
    next();
  } catch(e) {
    if (['invalid_telegram_data','invalid_telegram_signature','invalid_telegram_user','telegram_session_expired'].includes(e.message))
      return res.status(401).json({error:'Telegram не подтвердил вход. Закройте Mini App и откройте снова.'});
    next(e);
  }
}
app.get('/api/health',async(req,res,next)=>{
  try { await pool.query('SELECT 1');res.json({ok:true}); }catch(e){next(e);}
});
app.get('/api/me',authenticate,async(req,res,next)=>{
  try {
    const {rows}=await pool.query('SELECT telegram_id::text AS telegram_id, revision, game_state, updated_at FROM zona_players WHERE telegram_id=$1',[req.telegramUser.id]);
    const row=rows[0];
    res.set('Cache-Control','no-store');
    res.json({telegramId:row.telegram_id,revision:Number(row.revision),gameState:row.game_state,updatedAt:row.updated_at});
  } catch(e){next(e);}
});
app.post('/api/save',authenticate,async(req,res,next)=>{
  try {
    const {state,revision}=req.body||{};
    if (!state || Array.isArray(state) || typeof state!=='object' || !Number.isSafeInteger(revision) || revision<0)
      return res.status(400).json({error:'Неверный формат сохранения'});
    const s=statsOf(state);
    const {rows}=await pool.query(`UPDATE zona_players SET
      game_name=$2, game_title=$3, level=$4, kills=$5, searches=$6, rubles=$7,
      gram=$8, score=$9, equipment=$10::jsonb, game_state=$11::jsonb,
      revision=revision+1,updated_at=NOW(),last_seen_at=NOW()
      WHERE telegram_id=$1 AND revision=$12
      RETURNING revision,updated_at`,[
      req.telegramUser.id,s.name,s.title,s.level,s.kills,s.searches,s.rubles,
      s.gram,s.score,JSON.stringify(s.equipment),JSON.stringify(state),revision]);
    res.set('Cache-Control','no-store');
    if(!rows.length) {
      const latest=await pool.query('SELECT revision FROM zona_players WHERE telegram_id=$1',[req.telegramUser.id]);
      return res.status(409).json({error:'Прогресс изменён с другого устройства',revision:Number(latest.rows[0]?.revision||0)});
    }
    res.json({ok:true,revision:Number(rows[0].revision),updatedAt:rows[0].updated_at});
  }catch(e){next(e);}
});
const orders={score:'score DESC,telegram_id',level:'level DESC,score DESC,telegram_id',kills:'kills DESC,score DESC,telegram_id',gram:'gram DESC,score DESC,telegram_id'};
app.get('/api/leaderboard',authenticate,async(req,res,next)=>{
  try {
    const sort=Object.hasOwn(orders,req.query.sort)?req.query.sort:'score';
    const {rows}=await pool.query(`WITH ranks AS (
      SELECT telegram_id,telegram_username,game_name,game_title,level,kills,searches,
        rubles,gram,score,equipment,updated_at,
        ROW_NUMBER() OVER(ORDER BY ${orders[sort]}) AS position,
        COUNT(*) OVER() AS total
      FROM zona_players WHERE game_state IS NOT NULL
    )
    SELECT (telegram_id=$1::bigint) AS is_me, telegram_username,game_name,game_title,
      level,kills,searches,rubles,gram,score,equipment,position,total
    FROM ranks WHERE position<=50 OR telegram_id=$1::bigint ORDER BY position`,[req.telegramUser.id]);
    res.set('Cache-Control','no-store');
    res.json({sort,total:Number(rows[0]?.total||0),players:rows.map(p=>({
      isMe:p.is_me,username:p.telegram_username,name:p.game_name,title:p.game_title,
      level:p.level,kills:Number(p.kills),searches:Number(p.searches),rubles:Number(p.rubles),
      gram:Number(p.gram),score:Number(p.score),equipment:p.equipment,rank:Number(p.position)
    }))});
  }catch(e){next(e);}
});
app.get('/',(req,res)=>res.json({ok:true,service:'zona-z-telegram-api'}));
app.use((err,req,res,next)=>{
  console.error(err);
  if(!res.headersSent)res.status(500).json({error:'Ошибка сервера. Попробуйте позднее.'});
});
async function start(){
  await pool.query(await fs.readFile(path.join(__dirname,'schema.sql'),'utf8'));
  app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('ZONA Z API online'));
}
if(require.main===module) start().catch(e=>{console.error(e);process.exit(1)});
module.exports={app,statsOf};
