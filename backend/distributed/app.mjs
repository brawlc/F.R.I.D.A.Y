import express from 'express';
import { join, resolve } from 'node:path';
import { privateBoundary,createAuth } from './auth.mjs';
import { createQueue,digest,fail } from './queue.mjs';
import { audit,outbox } from './state.mjs';
import { generateResearchPdf } from '../research/pdf.mjs';
export function createCloudApp({store,origin,enrollmentHash,providers=['retrieval'],webAuthn,now=Date.now,wake=()=>{}}) {
  const app=express(),queue=createQueue(store,{providers,now}),auth=createAuth(store,{origin,enrollmentHash,now,webAuthn});
  app.disable('x-powered-by');app.use(privateBoundary(origin,()=>{store.change(s=>{const id=String(Math.floor(now()/60000));if(!s.audit.some(a=>a.event==='network_access_rejected'&&a.id===id)){audit(s,'network_access_rejected',id,now());outbox(s,'unauthorized_login',id,'high',now());}});wake();}));app.use(express.json({limit:'600kb',strict:true}));
  const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
  const rates=new Map(); app.use('/api/mobile',(req,res,next)=>{const key=req.tailRoles.join(',');const r=rates.get(key)||{at:now(),n:0};if(now()-r.at>60000){r.at=now();r.n=0;}rates.set(key,r);if(++r.n>240)return res.sendStatus(429);next();});
  app.post('/api/mobile/auth/options',wrap(async(req,res)=>res.json(await auth.options(req))));
  app.post('/api/mobile/auth/verify',wrap(async(req,res)=>res.json(await auth.verify(req,res))));
  function worker(req,res,next) {const raw=String(req.headers.authorization||'').replace(/^Bearer /,'');const s=store.read();const w=Object.values(s.workers).find(w=>!w.revoked&&w.tokenHash===digest(raw));if(!req.tailRoles.includes('worker')||!w)return res.sendStatus(403);req.workerId=w.id;next();}
  app.post('/api/mobile/worker/heartbeat',worker,wrap((req,res)=>res.json(queue.heartbeat(req.workerId))));
  app.post('/api/mobile/worker/claim',worker,wrap((req,res)=>res.json({task:queue.claim('worker',req.workerId)})));
  app.post('/api/mobile/worker/authorize',worker,wrap((req,res)=>{const t=store.read().tasks.find(t=>t.id===req.body.id);if(!t||t.state!=='running'||t.workerId!==req.workerId||t.leaseHash!==digest(req.body.lease)||t.leaseUntil<=now()||t.approval?.expiresAt<=now())fail('lease_revoked',403);queue.heartbeat(req.workerId);res.json({ok:true});}));
  app.post('/api/mobile/worker/complete',worker,wrap((req,res)=>res.json({task:queue.complete(req.body.id,req.workerId,req.body.lease,req.body.result,req.body.error)})));
  app.use('/api/mobile',auth.owner);
  app.get('/api/mobile/status',wrap((req,res)=>{queue.tick();const s=store.read();res.json({ok:true,csrf:req.ownerSession.csrf,cloud:'online',providers,tasks:s.tasks.map(({leaseHash,...t})=>t).reverse(),workers:Object.values(s.workers).map(({tokenHash,...w})=>({...w,online:!w.revoked&&now()-w.lastSeen<90000})),alerts:s.audit.slice(-50).reverse(),notifications:s.outbox.slice(-30),sessions:s.sessions.filter(x=>x.expiresAt>now()).map(({hash,csrf,...x})=>x),settings:s.settings,limits:{taskConcurrency:1,approvalMinutes:15,sessionMinutes:30,researchHttpAttempts:15,researchModelCalls:5,researchOutputTokens:5400,researchRuntimeSeconds:100}});}));
  app.post('/api/mobile/tasks',wrap((req,res)=>{const task=queue.submit(req.body);wake();res.status(201).json({task});}));
  app.post('/api/mobile/tasks/:id/approve',wrap((req,res)=>{const task=queue.approve(req.params.id);wake();res.json({task});}));
  app.post('/api/mobile/tasks/:id/cancel',wrap((req,res)=>res.json({task:queue.cancel(req.params.id)})));
  app.get('/api/mobile/tasks/:id/pdf',wrap(async(req,res)=>{const t=store.read().tasks.find(t=>t.id===req.params.id&&t.type==='research'&&t.state==='completed');if(!t?.result)fail('report_unavailable',404);const data=await generateResearchPdf(t.result);res.type('pdf').set('Content-Disposition',`attachment; filename="research-${t.result.id}.pdf"`).send(data);}));
  app.post('/api/mobile/sessions/revoke',wrap((req,res)=>{store.change(s=>{s.sessions=s.sessions.filter(x=>x.id!==req.body.id);audit(s,'session_revoked','',now());});res.json({ok:true});}));
  app.post('/api/mobile/logout',wrap((req,res)=>{store.change(s=>{s.sessions=s.sessions.filter(x=>x.id!==req.ownerSession.id);});res.clearCookie('__Host-friday',{httpOnly:true,secure:true,sameSite:'strict',path:'/'});res.json({ok:true});}));
  app.post('/api/mobile/workers/:id/revoke',wrap((req,res)=>{store.change(s=>{const w=s.workers[req.params.id];if(!w)fail('worker_unknown',404);w.revoked=true;for(const t of s.tasks)if(t.workerId===w.id&&t.state==='running'){t.state='failed';t.failure='worker_revoked_outcome_unknown';t.completedAt=now();}audit(s,'worker_revoked',w.id,now());});res.json({ok:true});}));
  app.post('/api/mobile/settings',wrap((req,res)=>{if(!['daily','generalNotifications','securityNotifications'].some(k=>typeof req.body[k]==='boolean'))fail('invalid_setting');store.change(s=>{for(const key of ['daily','generalNotifications','securityNotifications'])if(typeof req.body[key]==='boolean')s.settings[key]=req.body[key];audit(s,'notification_or_schedule_settings_changed','',now());});wake();res.json({ok:true});}));
  app.use('/api',(req,res)=>res.sendStatus(404));
  // Only the dedicated mobile build is served; never the desktop server or local data roots.
  app.use('/mobile',express.static(resolve('mobile-dist'),{index:'index.html',dotfiles:'deny'}));
  app.get('/',(req,res)=>res.redirect('/mobile/'));
  app.use((error,req,res,next)=>{if(res.headersSent)return next(error);store.change(s=>{audit(s,'request_rejected','',now());if(error.status===403)outbox(s,'unauthorized_login',String(Math.floor(now()/60000)),'high',now());});wake();res.status(error.status||500).json({ok:false,error:error.status?error.message:'service_error'});});
  return {app,queue};
}
