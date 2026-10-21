'use strict';
// One-time staging data copy, run before normal API startup.
// The web service keeps its existing DATABASE_URL while this script copies.
const {Pool}=require('pg');
const {mirrorStagingPlayers}=require('./migrate-neon');
async function main() {
  const url=process.env.MIGRATION_NEON_URL;
  const sourceUrl=process.env.DATABASE_URL;
  if(!url || !sourceUrl) {
    console.warn('[neon-migration] Skipped: one or more URLs not configured.');
    if(process.env.ZONA_DB_TARGET==='neon')process.exitCode=1;
    return;
  }
  const source=new Pool({connectionString:sourceUrl,max:2});
  try {
    await mirrorStagingPlayers(source,url);
  } catch(e) {
    // Never put connection details or player identifiers in deploy logs.
    const code=['migration_verification_failed','revision_mismatch'].includes(e.message)
      ? e.message : /^[A-Z0-9_]{4,10}$/.test(e.code||'') ? e.code : 'copy_failed';
    console.warn('[neon-migration] Copy not verified: '+code+'. Source DB still used.');
    if(process.env.ZONA_DB_TARGET==='neon')process.exitCode=1;
  } finally {
    await source.end();
  }
}
main().catch(()=>{
  console.warn('[neon-migration] Copy unsuccessful; source unchanged.');
  if(process.env.ZONA_DB_TARGET==='neon')process.exitCode=1;
});
