import { fail, hash, token, stmt, rate, bytes } from './common.mjs';
export const LIMITS=Object.freeze({httpAttempts:15,modelCalls:5,outputTokens:5400,inputTokensPerCall:8000,inputTokens:24000,runtimeMs:100000,followUps:1});
export function createQueue(db,{now=Date.now,owner}={}) {
  const read= id=>stmt(db,'SELECT * FROM tasks WHERE id=? AND owner=?',id,owner).first();
  async function recover() {
    await db.batch([
      stmt(db,"UPDATE tasks SET state='outcome_unknown',failure='executor_disconnected_or_lease_expired',completed_at=? WHERE state='running' AND (lease_until<=? OR expires_at<=? OR approval_expires_at<=? OR EXISTS(SELECT 1 FROM executors e WHERE e.id=executor_id AND e.revoked=1))",now(),now(),now(),now()),
      stmt(db,"UPDATE tasks SET state='failed',failure='task_expired',completed_at=? WHERE state IN ('queued','waiting_for_approval') AND expires_at<=?",now(),now()),
      stmt(db,"UPDATE tasks SET state='waiting_for_approval',approved_hash=NULL WHERE state='queued' AND approval_expires_at<=?",now()),
      stmt(db,'DELETE FROM rates WHERE expires_at<=?',now()),
      stmt(db,'DELETE FROM challenges WHERE expires_at<=?',now()),
      stmt(db,'DELETE FROM sessions WHERE expires_at<=?',now()),
      stmt(db,"DELETE FROM notification_outbox WHERE task_id IN (SELECT id FROM tasks WHERE state IN ('completed','failed','cancelled') AND completed_at<? ORDER BY completed_at LIMIT 50) AND state IN ('sent','failed')",now()-30*86400000),
      stmt(db,"DELETE FROM tasks WHERE id IN (SELECT id FROM tasks WHERE state IN ('completed','failed','cancelled') AND completed_at<? AND NOT EXISTS(SELECT 1 FROM notification_outbox n WHERE n.task_id=tasks.id) ORDER BY completed_at LIMIT 50)",now()-30*86400000),
    ]);
  }
  async function executor(request) {
    const authorization=request.headers.get('Authorization')||'';
    if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))fail('executor_denied',401);
    const e=await stmt(db,'SELECT * FROM executors WHERE token_hash=? AND revoked=0',await hash(authorization.slice(7))).first();
    if(!e)fail('executor_denied',401);
    await rate(db,'executor:'+e.id,120,now());
    await stmt(db,'UPDATE executors SET last_seen=? WHERE id=? AND revoked=0',now(),e.id).run();
    return e;
  }
  async function submit(input) {
    if(!['research','chat'].includes(input.type)||!['cloud','worker'].includes(input.environment))fail('unsupported_task');
    const provider=input.provider||'retrieval';
    if(!['retrieval','ollama','openai','gemini','venice'].includes(provider)||(input.environment==='worker'&&!['retrieval','ollama'].includes(provider))||(input.environment==='cloud'&&provider==='ollama')||(input.type==='chat'&&provider==='retrieval'))fail('provider_denied');
    if(input.shareResult!==true)fail('explicit_cloud_storage_consent_required');
    if(typeof input.objective!=='string'||!input.objective.trim()||input.objective.length>2000||typeof(input.conditions||'')!=='string'||(input.conditions||'').length>3000||!/^[\w-]{8,80}$/.test(input.idempotencyKey||''))fail('invalid_task');
    const payload=JSON.stringify({type:input.type,environment:input.environment,provider,objective:input.objective.trim(),conditions:input.conditions||'',shareResult:true});
    const digest=await hash(payload),key=owner+':'+input.idempotencyKey;
    const previous=await stmt(db,'SELECT * FROM tasks WHERE idempotency_key=?',key).first();
    if(previous){if(previous.payload_hash!==digest)fail('idempotency_conflict',409);return previous;}
    await rate(db,'submit:'+owner,100,now(),86400000);
    await stmt(db,`INSERT OR IGNORE INTO tasks(id,kind,state,created_at,idempotency_key,owner,payload,payload_hash,target,expires_at)
      SELECT ?,?,'waiting_for_approval',?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM tasks)<500`,crypto.randomUUID(),input.type,now(),key,owner,payload,digest,input.environment==='worker'?'worker':'core',now()+86400000).run();
    const row=await stmt(db,'SELECT * FROM tasks WHERE idempotency_key=?',key).first();
    if(!row)fail('task_capacity',429);if(row.payload_hash!==digest)fail('idempotency_conflict',409);return row;
  }
  async function approve(id) {
    const row=await stmt(db,`UPDATE tasks SET state='queued',approved_hash=payload_hash,approval_expires_at=? WHERE id=? AND owner=? AND state='waiting_for_approval' AND expires_at>? AND payload_hash IS NOT NULL RETURNING *`,now()+900000,id,owner,now()+120000).first();
    if(!row)fail('approval_denied',409);return row;
  }
  async function cancel(id) {
    const row=await stmt(db,`UPDATE tasks SET state='cancelled',approved_hash=NULL,approval_expires_at=NULL,completed_at=? WHERE id=? AND owner=? AND state IN ('waiting_for_approval','queued','running') RETURNING *`,now(),id,owner).first();
    if(!row)fail('task_not_active',409);return row;
  }
  async function claim(e) {
    await recover(); const lease=token();
    // One conditional UPDATE is a transaction; partial unique index also enforces
    // one active execution per target across isolates, requests and restarts.
    const row=await stmt(db,`UPDATE tasks SET state='running',executor_id=?,lease_hash=?,lease_until=?,attempts=attempts+1,started_at=NULL
      WHERE id=(SELECT id FROM tasks WHERE target=? AND state='queued' AND approved_hash=payload_hash AND approval_expires_at>? AND expires_at>? AND attempts<3 ORDER BY created_at LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM tasks WHERE target=? AND state='running')
      AND EXISTS(SELECT 1 FROM executors WHERE id=? AND revoked=0 AND last_seen>?) RETURNING *`,e.id,await hash(lease),now()+120000,e.target,now()+120000,now()+120000,e.target,e.id,now()-90000).first();
    if(!row)return null;
    return {...JSON.parse(row.payload),id:row.id,lease,kind:row.kind,limits:LIMITS};
  }
  async function authorize(e,id,lease) {
    const row=await stmt(db,`UPDATE tasks SET started_at=COALESCE(started_at,?) WHERE id=? AND executor_id=? AND state='running' AND lease_hash=? AND lease_until>? AND expires_at>? AND approved_hash=payload_hash AND approval_expires_at>? AND EXISTS(SELECT 1 FROM executors WHERE id=? AND revoked=0) RETURNING id`,now(),id,e.id,await hash(lease),now(),now(),now(),e.id).first();
    if(!row)fail('lease_revoked_or_expired',409); return {ok:true,limits:LIMITS};
  }
  async function release(e,id,lease) {
    // Retry ONLY a claimed task that has never received execution authorization.
    const r=await stmt(db,`UPDATE tasks SET state=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,lease_hash=NULL,lease_until=NULL,failure='executor_not_started' WHERE id=? AND executor_id=? AND state='running' AND started_at IS NULL AND lease_hash=? AND lease_until>? AND EXISTS(SELECT 1 FROM executors WHERE id=? AND revoked=0) RETURNING id`,id,e.id,await hash(lease),now(),e.id).first();
    if(!r)fail('retry_unsafe',409);return {ok:true};
  }
  async function complete(e,input) {
    const result=JSON.stringify(input.result??null);if(bytes(result).length>256000)fail('result_too_large',413);
    const state=input.error?'failed':'completed';
    // Outbox insertion is in the same D1 batch transaction as completion. The
    // exact lease digest ties the second statement to this completion.
    const digest=await hash(input.lease);
    const results=await db.batch([
      stmt(db,`UPDATE tasks SET state=?,result=?,failure=?,completed_at=? WHERE id=? AND executor_id=? AND state='running' AND lease_hash=? AND lease_until>? AND expires_at>? AND approval_expires_at>? AND approved_hash=payload_hash AND started_at IS NOT NULL AND EXISTS(SELECT 1 FROM executors WHERE id=? AND revoked=0) AND (SELECT COALESCE(SUM(length(CAST(result AS BLOB))),0) FROM tasks)+?<8000000 RETURNING id`,state,result,input.error?'executor_reported_failure':null,now(),input.id,e.id,digest,now(),now(),now(),e.id,bytes(result).length),
      stmt(db,`INSERT OR IGNORE INTO notification_outbox(id,task_id,state,type,created_at,next_attempt_at) SELECT id,id,'pending',?, ?,? FROM tasks WHERE id=? AND executor_id=? AND lease_hash=? AND state=? AND kind<>'daily_briefing'`,input.error?'automation_failure':'task_completed',now(),now(),input.id,e.id,digest,state),
    ]);
    if(results[0].meta.changes!==1)fail('completion_rejected',409);
    return {ok:true};
  }
  return {read,recover,executor,submit,approve,cancel,claim,authorize,release,complete,
    async revokeExecutor(id){await db.batch([stmt(db,'UPDATE executors SET revoked=1 WHERE id=?',id),stmt(db,"UPDATE tasks SET state='outcome_unknown',failure='executor_revoked',completed_at=? WHERE executor_id=? AND state='running'",now(),id)]);},
    async list(){return (await stmt(db,'SELECT * FROM tasks WHERE owner=? ORDER BY created_at DESC LIMIT 500',owner).all()).results;},
  };
}

export async function scheduleBriefing(db,scheduledTime,owner) {
  const ist=new Date(scheduledTime+330*60000);if(!Number.isFinite(scheduledTime)||ist.getUTCHours()!==9||ist.getUTCMinutes()!==15)return;
  const day=ist.toISOString().slice(0,10),id='briefing:'+day;
  const payload=JSON.stringify({type:'daily_briefing',day,environment:'cloud',provider:'retrieval',shareResult:true,objective:'Daily verified F1 and aerospace briefing'});
  // Standing schedule approval is explicit and separate from research approval.
  // A daily task expires before the next run. It never calls a model.
  await stmt(db,`INSERT OR IGNORE INTO tasks(id,kind,state,created_at,idempotency_key,owner,payload,payload_hash,approved_hash,target,expires_at,approval_expires_at)
    SELECT ?,'daily_briefing','queued',?,?,?,?,?,?,'core',?,? WHERE EXISTS(SELECT 1 FROM settings WHERE key='daily_briefing_enabled' AND value='true') AND EXISTS(SELECT 1 FROM settings WHERE key='schedule_authority' AND value='cloudflare') AND (SELECT COUNT(*) FROM tasks)<500`,id,scheduledTime,id,owner,payload,await hash(payload),await hash(payload),scheduledTime+23*3600000,scheduledTime+23*3600000).run();
}
