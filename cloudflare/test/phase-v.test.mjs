import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync,sign,createHash } from 'node:crypto';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { database } from './d1.mjs';
import { createAuth } from '../auth.mjs';
import { createQueue,scheduleBriefing } from '../queue.mjs';
import { createAccessVerifier } from '../access.mjs';
import { dispatchOne,notificationConfig } from '../notifications.mjs';
import { hash,token,encode,decode } from '../common.mjs';
import { createWorker } from '../worker.mjs';
const origin='https://friday.example',owner='owner-subject';
const identity={subject:owner};
const env={APP_ORIGIN:origin,ACCESS_OWNER_SUBJECT:owner};
const task={type:'research',environment:'cloud',provider:'retrieval',objective:'Investigate public evidence',conditions:'',shareResult:true,idempotencyKey:'test-key-001'};
async function setupExecutor(d,target='core') {const raw=token();d.sql.prepare('INSERT INTO executors(id,token_hash,target) VALUES(?,?,?)').run(target,await hash(raw),target);return new Request(origin,{headers:{Authorization:'Bearer '+raw}});}
test('real WebAuthn registration/assertion, replay, CSRF, expiry and revocation',async()=>{
  const d=database();let time=Date.now();const now=()=>time;
  try {
    const secret=token();d.sql.prepare('INSERT INTO bootstrap VALUES(1,?,?,?,0)').run(owner,await hash(secret),time+600000);
    const disabled=createAuth(d.db,env,{now});await assert.rejects(disabled.options({register:true,enrollmentCode:secret},identity),/enrollment_disabled/);
    const auth=createAuth(d.db,{...env,ENROLLMENT_ENABLED:'true'},{now});
    const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const jwk=publicKey.export({format:'jwk'}),id=encode(crypto.getRandomValues(new Uint8Array(32)));
    const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,decode(jwk.x)],[-3,decode(jwk.y)]]));
    const rp=createHash('sha256').update('friday.example').digest();
    const option=await auth.options({register:true,enrollmentCode:secret},identity);
    const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:option.options.challenge,origin,crossOrigin:false}));
    const authData=Buffer.concat([rp,Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),Buffer.from([0,32]),Buffer.from(decode(id)),Buffer.from(cose)]);
    const response={id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:encode(client),attestationObject:encode(encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(authData)]]))),transports:['internal']}};
    const registration=await auth.verify({register:true,challengeId:option.challengeId,response},identity);
    assert.match(registration.cookie,/Secure; HttpOnly; SameSite=Strict/);
    await assert.rejects(auth.verify({register:true,challengeId:option.challengeId,response},identity),/challenge_expired_or_used/);
    assert.equal(d.sql.prepare('SELECT used FROM bootstrap').get().used,1);
    const login=await auth.options({},identity);
    const client2=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:login.options.challenge,origin,crossOrigin:false}));
    const data=Buffer.concat([rp,Buffer.from([5]),Buffer.from([0,0,0,1])]);
    const signature=sign('sha256',Buffer.concat([data,createHash('sha256').update(client2).digest()]),privateKey);
    const assertion={id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:encode(client2),authenticatorData:encode(data),signature:encode(signature)}};
    const verified=await auth.verify({challengeId:login.challengeId,response:assertion},identity);
    const cookie=verified.cookie.split(';')[0];
    const s=await auth.session(new Request(origin,{headers:{Cookie:cookie}}),identity);
    await assert.rejects(auth.session(new Request(origin,{method:'POST',headers:{Cookie:cookie}}),identity),/csrf_denied/);
    await auth.session(new Request(origin,{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':verified.body.csrf}}),identity);
    await assert.rejects(auth.verify({challengeId:login.challengeId,response:assertion},identity),/challenge_expired_or_used/);
    await auth.revoke(s.id);await assert.rejects(auth.session(new Request(origin,{headers:{Cookie:cookie}}),identity),/session_required/);
    time+=1800001;await assert.rejects(auth.session(new Request(origin,{headers:{Cookie:registration.cookie.split(';')[0]}}),identity),/session_required/);
  }finally{d.close();}
});
test('expired challenges, forged assertions and durable auth rate limits fail closed',async()=>{
  const d=database();try{let time=100000;const auth=createAuth(d.db,env,{now:()=>time});
    d.sql.prepare('INSERT INTO challenges VALUES(?,?,?,?,?,NULL)').run('old',owner,'login','challenge',time-1);
    await assert.rejects(auth.verify({challengeId:'old'},identity),/challenge_expired_or_used/);
    d.sql.prepare('INSERT INTO challenges VALUES(?,?,?,?,?,NULL)').run('fresh',owner,'login','challenge',time+5000);
    await assert.rejects(auth.verify({challengeId:'fresh',response:{id:'fake'}},identity),/passkey_verification_failed/);
    assert.equal(d.sql.prepare("SELECT COUNT(*) n FROM challenges WHERE id='fresh'").get().n,0);
    for(let i=0;i<8;i++)await auth.options({},identity).catch(()=>{});
    await assert.rejects(createAuth(d.db,env,{now:()=>time}).options({},identity),/rate_limited/);
  }finally{d.close();}
});
test('Access verifies signatures and issuer/audience/expiry; spoofed headers rejected',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const key={...publicKey.export({format:'jwk'}),kid:'key',use:'sig',alg:'RS256'};
  const e={...env,DEVICE_POLICY_VERIFIED:'true',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'test-aud'};
  let calls=0;const verify=createAccessVerifier({fetchImpl:async(url)=>{calls++;assert.equal(url,e.ACCESS_ISSUER+'/cdn-cgi/access/certs');return Response.json({keys:[key]});}});
  const jwt=overrides=>{const h=encode(Buffer.from(JSON.stringify({alg:'RS256',kid:'key'}))),p=encode(Buffer.from(JSON.stringify({iss:e.ACCESS_ISSUER,aud:['test-aud'],sub:owner,iat:Date.now()/1000-1,exp:Date.now()/1000+600,...overrides})));return h+'.'+p+'.'+encode(sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey));};
  const request=raw=>new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':raw}});
  assert.deepEqual(await verify(request(jwt({})),e),identity);
  await verify(request(jwt({})),e);assert.equal(calls,1);
  for(const claims of [{aud:['other']},{iss:'https://evil.example'},{exp:0},{sub:'other'}])await assert.rejects(verify(request(jwt(claims)),e),/access_denied/);
  await assert.rejects(verify(new Request(origin,{headers:{'Cf-Access-Authenticated-User-Email':'owner'}}),e),/access_denied/);
  const forged=jwt({});await assert.rejects(verify(request(forged.slice(0,-12)+'aaaaaaaaaaaa'),e),/access_denied/);
  await assert.rejects(verify(request(jwt({})),{...e,DEVICE_POLICY_VERIFIED:'false'}),/device_policy_not_verified/);
});
test('D1 idempotency, approval, transactional claims, cancellation and outbox completion',async()=>{
  const d=database();try{const q=createQueue(d.db,{owner});const req=await setupExecutor(d),e=await q.executor(req);
    const t=await q.submit(task);assert.equal((await q.submit(task)).id,t.id);
    await assert.rejects(q.submit({...task,objective:'Changed payload'}),/idempotency_conflict/);
    assert.equal(await q.claim(e),null);await q.approve(t.id);
    const claimed=await Promise.all([q.claim(e),q.claim(e)]);assert.equal(claimed.filter(Boolean).length,1);
    const c=claimed.find(Boolean);await q.authorize(e,c.id,c.lease);
    await q.cancel(c.id);await assert.rejects(q.complete(e,{id:c.id,lease:c.lease,result:{text:'stale'}}),/completion_rejected/);
    assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0);
    const t2=await q.submit({...task,idempotencyKey:'second-task'});await q.approve(t2.id);const c2=await q.claim(e);await q.authorize(e,c2.id,c2.lease);await q.complete(e,{id:c2.id,lease:c2.lease,result:{text:'reported evidence'}});
    await assert.rejects(q.complete(e,{id:c2.id,lease:c2.lease,result:{}}),/completion_rejected/);
    assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,1);
  }finally{d.close();}
});
test('restart recovers interrupted work as unknown without reexecution; approvals expire',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'friday-phase-v-'));let d;try{const path=join(dir,'d1.sqlite');d=database(path);let time=Date.now();const options={owner,now:()=>time};let q=createQueue(d.db,options);const req=await setupExecutor(d);let e=await q.executor(req);const t=await q.submit(task);await q.approve(t.id);const c=await q.claim(e);await q.authorize(e,c.id,c.lease);d.close();d=database(path,false);q=createQueue(d.db,options);time+=120001;await q.recover();assert.equal((await q.read(t.id)).state,'outcome_unknown');e=await q.executor(req);assert.equal(await q.claim(e),null);
    const other=await q.submit({...task,idempotencyKey:'another-task'});await q.approve(other.id);time+=900001;await q.recover();assert.equal((await q.read(other.id)).state,'waiting_for_approval');time+=86400000;await q.recover();assert.equal((await q.read(other.id)).state,'failed');
  }finally{d?.close();rmSync(dir,{recursive:true,force:true});}
});
test('pre-execution retries capped; executor revocation and target separation enforced',async()=>{
  const d=database();try{const q=createQueue(d.db,{owner});const req=await setupExecutor(d),e=await q.executor(req);const w=await q.executor(await setupExecutor(d,'worker'));
    const t=await q.submit(task);await q.approve(t.id);assert.equal(await q.claim(w),null);
    for(let i=0;i<3;i++){const c=await q.claim(e);await q.release(e,c.id,c.lease);}assert.equal((await q.read(t.id)).state,'failed');assert.equal(await q.claim(e),null);
    const t2=await q.submit({...task,idempotencyKey:'revoke-test'});await q.approve(t2.id);const c=await q.claim(e);await q.revokeExecutor(e.id);await assert.rejects(q.executor(req),/executor_denied/);await assert.rejects(q.authorize(e,c.id,c.lease),/lease_revoked/);
    await assert.rejects(q.submit({...task,type:'shell'}),/unsupported_task/);
    await assert.rejects(q.submit({...task,environment:'cloudflare'}),/unsupported_task/);
  }finally{d.close();}
});
test('09:15 IST schedule requires cutover opt-in and creates one no-model task per day',async()=>{
  const d=database();try{const at=Date.parse('2026-11-11T03:45:00Z');await scheduleBriefing(d.db,at,owner);assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM tasks').get().n,0);d.sql.exec("INSERT INTO settings VALUES('daily_briefing_enabled','true'),('schedule_authority','cloudflare')");await Promise.all([scheduleBriefing(d.db,at,owner),scheduleBriefing(d.db,at,owner)]);await scheduleBriefing(d.db,at+60000,owner);const rows=d.sql.prepare('SELECT * FROM tasks').all();assert.equal(rows.length,1);assert.equal(rows[0].target,'core');assert.equal(JSON.parse(rows[0].payload).provider,'retrieval');assert.equal(rows[0].approved_hash,rows[0].payload_hash);
  }finally{d.close();}
});
const ntfy={FRIDAY_NTFY_ENABLED:'true',FRIDAY_NTFY_SERVER:'https://notify.example',FRIDAY_NTFY_TOKEN:'fixture-secret',FRIDAY_NTFY_TOPIC:'private-general',FRIDAY_NTFY_SECURITY_TOPIC:'private-security',FRIDAY_NTFY_ACL_VERIFIED:'true'};
function notification(d,type='task_completed',id='one'){d.sql.prepare("INSERT INTO tasks(id,kind,state,created_at,idempotency_key) VALUES(?,'research','completed',0,?)").run(id,id);d.sql.prepare("INSERT INTO notification_outbox(id,task_id,state,type,created_at,next_attempt_at) VALUES(?,?,'pending',?,0,0)").run(id,id,type);}
test('ntfy-only authenticated routing, priority, denied credentials and no public fallback',async()=>{
  const d=database();try{notification(d);notification(d,'critical_security_incident','two');const calls=[];
    const send=async(url,options)=>{calls.push({url,options});return Response.json({event:'message',id:'accepted',topic:url.split('/').at(-1)});};
    assert.equal((await dispatchOne(d.db,ntfy,{fetchImpl:send})).status,'sent');assert.equal(calls[0].url,'https://notify.example/private-security');assert.equal(calls[0].options.headers.Priority,'5');assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-secret');assert.match(calls[0].options.body,/not confirmed/);
    await dispatchOne(d.db,ntfy,{fetchImpl:send});assert.equal(calls[1].url,'https://notify.example/private-general');assert.ok(!JSON.stringify(calls.map(c=>c.options.body)).includes('fixture-secret'));
    for(const patch of [{FRIDAY_NTFY_TOKEN:''},{FRIDAY_NTFY_ACL_VERIFIED:'false'},{FRIDAY_NTFY_SECURITY_TOPIC:'private-general'},{FRIDAY_NTFY_SERVER:''}])assert.throws(()=>notificationConfig({...ntfy,...patch}));
    notification(d,'malware_detection','three');assert.equal((await dispatchOne(d.db,ntfy,{fetchImpl:async()=>new Response('',{status:403})})).status,'failed');
  }finally{d.close();}
});
test('ntfy bounded retries and unknown delivery are durable and never replayed',async()=>{
  const d=database();try{let time=100000;notification(d);for(let i=0;i<3;i++){await dispatchOne(d.db,ntfy,{now:()=>time,fetchImpl:async()=>new Response('',{status:429})});time+=300001;}assert.equal(d.sql.prepare('SELECT state,attempts FROM notification_outbox').get().attempts,3);assert.equal((await dispatchOne(d.db,ntfy,{now:()=>time})).status,'idle');notification(d,'task_completed','two');await dispatchOne(d.db,ntfy,{now:()=>time,fetchImpl:async()=>{throw Error('fixture-secret');}});assert.equal(d.sql.prepare("SELECT state FROM notification_outbox WHERE id='two'").get().state,'outcome_unknown');assert.equal((await dispatchOne(d.db,ntfy,{now:()=>time})).status,'idle');
  }finally{d.close();}
});
test('HTTP gate denies unauthenticated/desktop requests and protects task mutations',async()=>{
  const d=database();try{const e={...env,DB:d.db,FRONTEND_ENABLED:'true'};const worker=createWorker();assert.equal((await worker.fetch(new Request(origin+'/api/mobile/status'),e)).status,503);assert.equal((await worker.fetch(new Request(origin+'/api/desktop/open'),e)).status,404);assert.equal((await worker.fetch(new Request(origin+'/api/mobile/worker/claim',{method:'POST'}),e)).status,503);
    const outer=createWorker({access:async()=>identity});assert.equal((await outer.fetch(new Request(origin+'/api/mobile/status'),e)).status,401);assert.equal((await outer.fetch(new Request(origin+'/api/mobile/tasks',{method:'POST',headers:{Origin:'https://evil.example'}}),e)).status,403);
  }finally{d.close();}
});
test('notification preferences mute channels independently without sending',async()=>{
  const d=database();try{
    d.sql.exec("INSERT INTO settings VALUES('generalNotifications','false')");notification(d);
    assert.equal((await dispatchOne(d.db,ntfy,{fetchImpl:async()=>{throw Error('must not send');}})).status,'muted');
    notification(d,'sentinel_report','security');let calls=0;
    await dispatchOne(d.db,ntfy,{fetchImpl:async()=>{calls++;return Response.json({event:'message',id:'ack',topic:'private-security'});}});assert.equal(calls,1);
  }finally{d.close();}
});
