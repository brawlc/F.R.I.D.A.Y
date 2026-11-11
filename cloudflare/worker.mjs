import { createAuth } from './auth.mjs';
import { createAccessVerifier } from './access.mjs';
import { createQueue, scheduleBriefing, LIMITS } from './queue.mjs';
import { dispatchOne } from './notifications.mjs';
import { boundedJSON, fail, stmt, rate } from './common.mjs';
export { proposeDailyBriefing } from './schedule-proposal.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{...headers,...extra}});
const allowed=/^\/api\/mobile\/(status|auth\/(options|verify)|tasks(?:\/[\w:-]+\/(approve|cancel|pdf))?|settings|sessions\/revoke|logout|workers\/[\w-]+\/revoke|worker\/(heartbeat|claim|authorize|release|complete))$/;
const view=t=>({...JSON.parse(t.payload),id:t.id,state:t.state,createdAt:t.created_at,failure:t.failure,result:t.result?JSON.parse(t.result):undefined,resultProvenance:'executor-reported-unvalidated'});
export function createWorker({access=createAccessVerifier(),authFactory=createAuth,now=Date.now,fetchImpl=fetch}={}) {
  async function flush(env) {
    if(env.FRIDAY_NTFY_ENABLED!=='true')return;
    try{await dispatchOne(env.DB,env,{now,fetchImpl});}
    catch {await stmt(env.DB,"UPDATE notification_outbox SET error='dispatch_configuration_or_storage_unavailable' WHERE state='pending'").run();}
  }
  return {
    async fetch(request,env,ctx={waitUntil:()=>{}}) {
      const url=new URL(request.url),path=url.pathname;
      if(path.startsWith('/api/')&&!allowed.test(path))return json({error:'route_unavailable'},404);
      if(env.FRONTEND_ENABLED!=='true')return json({error:'private_application_disabled'},503);
      try {
        if(url.protocol!=='https:'||url.origin!==env.APP_ORIGIN)fail('origin_denied',403);
        const worker=path.startsWith('/api/mobile/worker/');
        if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail('origin_denied',403);
        if(!worker&&!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin)fail('origin_required',403);
        if(!env.DB)fail('database_unavailable',503);
        const queue=createQueue(env.DB,{now,owner:env.ACCESS_OWNER_SUBJECT});
        if(worker) {
          if(env.EXECUTOR_API_ENABLED!=='true'||request.method!=='POST')fail('executor_api_disabled',503);
          const e=await queue.executor(request),body=await boundedJSON(request,280000),action=path.split('/').at(-1);
          if(action==='heartbeat'){ctx.waitUntil(flush(env));return json({ok:true,limits:LIMITS});}
          if(action==='claim')return json({task:await queue.claim(e)});
          if(action==='authorize')return json(await queue.authorize(e,body.id,body.lease));
          if(action==='release')return json(await queue.release(e,body.id,body.lease));
          const result=await queue.complete(e,body);ctx.waitUntil(flush(env));return json(result);
        }
        const identity=await access(request,env);
        if(!identity||identity.subject!==env.ACCESS_OWNER_SUBJECT)fail('access_denied',401);
        const auth=authFactory(env.DB,env,{now});
        if(path==='/api/mobile/auth/options'||path==='/api/mobile/auth/verify') {
          if(request.method!=='POST')fail('method_not_allowed',405);
          const input=await boundedJSON(request);
          if(path.endsWith('/options'))return json(await auth.options(input,identity));
          const result=await auth.verify(input,identity);return json(result.body,200,{'Set-Cookie':result.cookie});
        }
        // Login shell needs the outer device/identity gate, not an app session.
        if(!path.startsWith('/api/')) {
          if(!['GET','HEAD'].includes(request.method)||!path.startsWith('/mobile/')||!env.ASSETS)fail('route_unavailable',404);
          const assetURL=new URL(path.slice('/mobile'.length)||'/',url.origin);
          const r=await env.ASSETS.fetch(new Request(assetURL,request));
          const h=new Headers(r.headers);for(const [k,v]of Object.entries(headers))h.set(k,v);
          return new Response(r.body,{status:r.status,headers:h});
        }
        const session=await auth.session(request,identity);
        await rate(env.DB,'api:'+identity.subject,120,now());
        if(path==='/api/mobile/status'&&request.method==='GET') {
          await queue.recover();
          const settings=(await env.DB.prepare('SELECT key,value FROM settings').all()).results;
          return json({ok:true,csrf:session.csrf,cloud:'online',providers:['retrieval',...(env.CORE_PROVIDERS||'').split(',').filter(x=>['openai','gemini','venice'].includes(x))],tasks:(await queue.list()).map(view),workers:(await env.DB.prepare('SELECT id,revoked,last_seen FROM executors').all()).results.map(w=>({id:w.id,revoked:!!w.revoked,online:!w.revoked&&w.last_seen>now()-90000})),alerts:[],notifications:(await env.DB.prepare('SELECT id,type,state,error FROM notification_outbox ORDER BY created_at DESC LIMIT 30').all()).results,sessions:(await stmt(env.DB,'SELECT id,expires_at AS expiresAt FROM sessions WHERE subject=? AND expires_at>?',identity.subject,now()).all()).results,settings:{daily:settings.some(s=>s.key==='daily_briefing_enabled'&&s.value==='true'),generalNotifications:!settings.some(s=>s.key==='generalNotifications'&&s.value==='false'),securityNotifications:!settings.some(s=>s.key==='securityNotifications'&&s.value==='false')},capabilities:{pdf:false},limits:LIMITS});
        }
        if(path.endsWith('/pdf'))fail('pdf_available_on_private_core_only',501);
        if(request.method!=='POST')fail('method_not_allowed',405);
        const body=await boundedJSON(request);
        if(path==='/api/mobile/tasks') {
          if(body.environment==='cloud'&&!['retrieval',...(env.CORE_PROVIDERS||'').split(',')].includes(body.provider||'retrieval'))fail('provider_not_configured');
          return json({task:view(await queue.submit(body))},201);
        }
        const task=/^\/api\/mobile\/tasks\/([\w:-]+)\/(approve|cancel)$/.exec(path);
        if(task)return json({task:view(await queue[task[2]](task[1]))});
        if(path==='/api/mobile/logout'){await auth.revoke(session.id);return json({ok:true},200,{'Set-Cookie':'__Host-friday=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});}
        if(path==='/api/mobile/sessions/revoke'){await auth.revoke(String(body.id||''));return json({ok:true});}
        const revoke=/^\/api\/mobile\/workers\/([\w-]+)\/revoke$/.exec(path);
        if(revoke){await queue.revokeExecutor(revoke[1]);return json({ok:true});}
        if(path==='/api/mobile/settings') {
          if(typeof body.daily!=='boolean') {
            const keys=['generalNotifications','securityNotifications'].filter(k=>typeof body[k]==='boolean');
            if(!keys.length)fail('unsupported_setting');
            await env.DB.batch(keys.map(k=>stmt(env.DB,'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,String(body[k]))));
            return json({ok:true});
          }
          if(body.daily&&env.SCHEDULE_CUTOVER_VERIFIED!=='true')fail('schedule_cutover_not_verified',409);
          await env.DB.batch([stmt(env.DB,"INSERT INTO settings VALUES('daily_briefing_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(body.daily)),stmt(env.DB,"INSERT INTO settings VALUES('schedule_authority','cloudflare') ON CONFLICT(key) DO UPDATE SET value=excluded.value")]);
          if(!body.daily)await env.DB.prepare("UPDATE tasks SET state='cancelled',approved_hash=NULL WHERE kind='daily_briefing' AND state IN ('queued','running')").run();
          return json({ok:true});
        }
        fail('route_unavailable',404);
      } catch(e) {return json({error:e.safe?e.message:'service_unavailable'},e.safe?e.status:503);}
    },
    async scheduled(event,env) {
      if(env.SCHEDULER_ENABLED!=='true')return;
      if(!env.DB)throw Error('schedule_database_unavailable');
      await createQueue(env.DB,{now,owner:env.ACCESS_OWNER_SUBJECT}).recover();
      if(env.SCHEDULE_CUTOVER_VERIFIED==='true'&&env.ACCESS_OWNER_SUBJECT)await scheduleBriefing(env.DB,event.scheduledTime,env.ACCESS_OWNER_SUBJECT);
      await flush(env);
    },
  };
}
export default createWorker();
