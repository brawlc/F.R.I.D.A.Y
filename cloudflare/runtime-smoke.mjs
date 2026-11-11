// Offline workerd/D1 check using the Miniflare already installed with Wrangler.
// Supply its local package entry path; never installs or provisions anything.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createQueue } from './queue.mjs';
import { hash,token } from './common.mjs';
if(!process.env.FRIDAY_MINIFLARE_MODULE)throw Error('Local Miniflare module path required');
const { Miniflare,convertV4MiniflareOptions }=await import(pathToFileURL(process.env.FRIDAY_MINIFLARE_MODULE).href);
const options={modules:true,scriptPath:resolve('work/phase-v-worker/worker.js'),compatibilityDate:'2026-11-10',d1Databases:{DB:'phase-v-offline'},bindings:{FRONTEND_ENABLED:'false'},port:0};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try {
  assert.equal((await mf.dispatchFetch('http://localhost/api/mobile/status')).status,503);
  assert.equal((await mf.dispatchFetch('http://localhost/api/desktop/open')).status,404);
  const db=await mf.getD1Database('DB');
  for(const file of ['schema.sql','migrations/0002_phase_v.sql']) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    const statements=source.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
    await db.batch(statements.map(s=>db.prepare(s)));
  }
  const q=createQueue(db,{owner:'runtime-owner'}),raw=token();
  await db.prepare("INSERT INTO executors(id,token_hash,target) VALUES('core',?,'core')").bind(await hash(raw)).run();
  const e=await q.executor(new Request('https://fixture.example',{headers:{Authorization:'Bearer '+raw}}));
  const task=await q.submit({type:'research',environment:'cloud',provider:'retrieval',objective:'Offline D1 integration only',shareResult:true,idempotencyKey:'runtime-task'});
  await q.approve(task.id);const claims=await Promise.all([q.claim(e),q.claim(e)]);assert.equal(claims.filter(Boolean).length,1);
  const c=claims.find(Boolean);await q.authorize(e,c.id,c.lease);await q.complete(e,{id:c.id,lease:c.lease,result:{text:'Fixture only; no research performed.'}});
  assert.equal((await q.read(task.id)).state,'completed');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM notification_outbox').first()).n,1);
  console.log('PASS: bundled Worker starts in workerd; disabled/desktop routes denied; real local D1 migration, atomic claim and completion/outbox transaction pass. No remote resources.');
} finally {await mf.dispose();}
