import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database(path=':memory:',initialize=true) {
  const sql=new DatabaseSync(path);sql.exec('PRAGMA foreign_keys=ON');
  if(initialize){sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_phase_v.sql',import.meta.url),'utf8'));}
  const wrap=(query,args=[])=>({bind:(...values)=>wrap(query,values),first:async()=>sql.prepare(query).get(...args)||null,all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>{const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};},query,args});
  const db={prepare:query=>wrap(query),batch:async statements=>{sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>{const q=sql.prepare(s.query);const results=q.columns().length?q.all(...s.args):undefined;const changes=results?sql.prepare('SELECT changes() AS n').get().n:Number(q.run(...s.args).changes);return {results,meta:{changes}};});sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {db,sql,close:()=>sql.close()};
}
