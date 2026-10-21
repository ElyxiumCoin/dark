'use strict';
/*
  One-way, non-destructive staging migration from Render PostgreSQL to Neon.
  Source DATABASE_URL remains the API database until an explicitly approved
  cutover. Re-running imports only source rows with a strictly newer revision.
  This script never deletes records, never logs credentials or player IDs.
*/
const {Pool}=require('pg');
const columns=[
  'telegram_id','telegram_username','telegram_name','game_name','game_title',
  'level','kills','searches','rubles','gram','score','equipment','game_state',
  'revision','created_at','updated_at','last_seen_at'
];
const binds=columns.map((name,i)=>'$'+(i+1)+(name==='equipment'||name==='game_state'?'::jsonb':'')).join(',');
const assignments=columns.slice(1).filter(x=>x!=='created_at').map(x=>x+'=EXCLUDED.'+x).join(',');
const insert='INSERT INTO zona_players('+columns.join(',')+') VALUES('+binds+') '+
  'ON CONFLICT(telegram_id) DO UPDATE SET '+assignments+
  ' WHERE zona_players.revision < EXCLUDED.revision';
const serialize=r=>columns.map(c=>(c==='equipment'||c==='game_state')
  ?(r[c]===null?null:JSON.stringify(r[c])):r[c]);
async function mirrorStagingPlayers(sourcePool,targetUrl){
  if(!targetUrl || targetUrl===process.env.DATABASE_URL) return;
  const target=new Pool({connectionString:targetUrl,max:2});
  try {
    const old=await sourcePool.query('SELECT '+columns.join(',')+' FROM zona_players ORDER BY telegram_id');
    const client=await target.connect();
    try {
      await client.query('BEGIN');
      for(const player of old.rows) await client.query(insert,serialize(player));
      await client.query('COMMIT');
    } catch(e) { await client.query('ROLLBACK');throw e; }
    finally {client.release();}
    const res=await target.query('SELECT telegram_id::text AS telegram_id,revision::text AS revision FROM zona_players');
    const rows=new Map(res.rows.map(r=>[r.telegram_id,r.revision]));
    const matched=old.rows.every(r=>rows.has(String(r.telegram_id)) &&
      BigInt(rows.get(String(r.telegram_id)))>=BigInt(r.revision));
    if(!matched)throw Error('revision_mismatch');
    console.log('[neon-migration] Non-destructive copy verified; source rows='+old.rowCount+
      ', target rows='+res.rowCount+'.');
  } finally {await target.end();}
}
module.exports={mirrorStagingPlayers};
