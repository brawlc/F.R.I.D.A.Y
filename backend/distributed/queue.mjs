import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { audit, outbox } from './state.mjs';
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const fail = (code, status = 400) => { throw Object.assign(Error(code), { status }); };
const terminal = t => ['completed','failed','cancelled'].includes(t.state);
export function createQueue(store, { now = Date.now, providers = ['retrieval'], heartbeatMs = 90000 } = {}) {
  function maintenance(s) {
    for (const w of Object.values(s.workers)) if (!w.revoked && w.lastSeen && now() - w.lastSeen > heartbeatMs && !w.offlineNotified) { w.offlineNotified = true; outbox(s, 'worker_disconnected', w.id + ':' + w.lastSeen, 'medium', now()); }
    for (const t of s.tasks) {
      if (terminal(t)) continue;
      if (t.state === 'running' && t.leaseUntil <= now()) { t.state = 'failed'; t.failure = 'execution_outcome_unknown_no_automatic_replay'; t.completedAt = now(); audit(s,'task_lease_expired',t.id,now()); outbox(s,'automation_failure',t.id,'high',now()); }
      else if (t.approval && t.approval.expiresAt <= now() && t.state !== 'running') { t.approval = null; t.state = 'waiting_for_approval'; audit(s,'approval_expired',t.id,now()); }
      else if (t.approval && t.state !== 'running') t.state = t.environment === 'worker' && !Object.values(s.workers).some(w => !w.revoked && now()-w.lastSeen < heartbeatMs) ? 'waiting_for_worker' : 'queued';
    }
  }
  return {
    tick: () => store.change(s => maintenance(s)),
    submit(input) { return store.change(s => {
      maintenance(s);
      if (!input || !['research','chat'].includes(input.type) || !['cloud','worker'].includes(input.environment)) fail('unsupported_task');
      const provider = input.provider || 'retrieval';
      if (!['retrieval','ollama','openai','gemini','venice'].includes(provider) || (input.environment === 'cloud' && (!providers.includes(provider) || provider === 'ollama')) || (input.environment === 'worker' && !['retrieval','ollama'].includes(provider)) || (input.type === 'chat' && provider === 'retrieval')) fail('provider_not_permitted');
      if (typeof input.objective !== 'string' || !input.objective.trim() || input.objective.length > 2000 || typeof (input.conditions || '') !== 'string' || (input.conditions || '').length > 3000) fail('invalid_objective');
      if (input.environment === 'worker' && input.shareResult !== true) fail('explicit_result_sync_consent_required');
      if (typeof input.idempotencyKey !== 'string' || !/^[\w-]{8,80}$/.test(input.idempotencyKey)) fail('idempotency_key_required');
      const spec = { type: input.type, environment: input.environment, provider, objective: input.objective.trim(), conditions: input.conditions || '', shareResult: input.shareResult === true };
      const hash = digest(JSON.stringify(spec));
      const prior = s.tasks.find(t => t.key === input.idempotencyKey);
      if (prior) { if(prior.specHash !== hash) fail('idempotency_conflict',409); return prior; }
      s.tasks = s.tasks.filter(t => !terminal(t) || t.completedAt > now()-30*86400000);
      if (s.tasks.length >= 500) fail('task_capacity',429);
      const t = { ...spec, id: randomUUID(), key: input.idempotencyKey, specHash: hash, createdAt: now(), priority: 3, state: 'waiting_for_approval', approval: null, retries: 0, failure: null, completedAt: null };
      s.tasks.push(t); audit(s,'task_submitted',t.id,now()); outbox(s,'pending_approval',t.id,'medium',now()); return t;
    }); },
    approve(id) { return store.change(s => { const t=s.tasks.find(t=>t.id===id); if(!t || terminal(t) || t.state==='running') fail('invalid_approval',409); t.approval={ specHash:t.specHash, expiresAt:now()+15*60000, approvedAt:now() }; t.state='queued'; maintenance(s); if(t.state==='waiting_for_worker')outbox(s,'worker_disconnected','waiting:'+id,'medium',now()); audit(s,'task_approved',id,now()); return t; }); },
    cancel(id) { return store.change(s=> { const t=s.tasks.find(t=>t.id===id); if(!t || terminal(t)) fail('task_not_active',409); t.state='cancelled'; t.approval=null; t.completedAt=now(); audit(s,'task_cancelled',id,now()); return t; }); },
    heartbeat(id) { return store.change(s => { const w=s.workers[id]; if(!w || w.revoked) fail('worker_revoked',403); w.lastSeen=now(); w.offlineNotified=false; maintenance(s); return { heartbeatMs, taskTypes:['research','chat'], providers:['retrieval','ollama'] }; }); },
    claim(environment, workerId = 'cloud') { return store.change(s => {
      maintenance(s);
      if (environment==='worker' && (!s.workers[workerId] || s.workers[workerId].revoked || now()-s.workers[workerId].lastSeen>=heartbeatMs)) fail('worker_unavailable',403);
      if (s.tasks.some(t => t.state==='running' && (t.environment===environment))) return null;
      const t=s.tasks.find(t=>t.environment===environment && t.state==='queued' && t.approval?.expiresAt>now()+110000 && t.approval.specHash===t.specHash);
      if(!t) return null;
      const lease=token(); t.leaseHash=digest(lease); t.leaseUntil=now()+120000; t.state='running'; t.workerId=workerId; t.startedAt=now(); audit(s,'task_started',t.id,now()); return {...t,lease,leaseHash:undefined};
    }); },
    complete(id, workerId, lease, result, error) { return store.change(s=> {
      maintenance(s); const t=s.tasks.find(t=>t.id===id);
      if(!t || t.state!=='running' || t.workerId!==workerId || t.leaseHash!==digest(lease) || t.approval?.expiresAt<=now() || (workerId!=='cloud' && s.workers[workerId]?.revoked)) fail('stale_or_revoked_lease',409);
      if(Buffer.byteLength(JSON.stringify(result ?? null))>256000) { result=null;error='result_too_large'; }
      if(Buffer.byteLength(JSON.stringify(s.tasks))+Buffer.byteLength(JSON.stringify(result ?? null))>8000000) {result=null;error='result_storage_capacity';}
      // Worker outputs are claims from that worker; never proof of physical validation.
      t.result=result; t.resultProvenance=workerId==='cloud'?'cloud-generated':'worker-reported-unvalidated'; t.state=error?'failed':'completed'; t.failure=error?(['result_too_large','result_storage_capacity'].includes(error)?error:'execution_failed'):null; t.completedAt=now(); delete t.leaseHash;
      audit(s,t.state==='completed'?'task_completed':'task_failed',id,now()); outbox(s,error?'automation_failure':'research_completed',id,error?'high':'medium',now()); return t;
    }); },
  };
}
