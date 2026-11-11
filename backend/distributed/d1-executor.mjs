import { createExecutor } from './executor.mjs';
import { createIntelligenceBriefing, createBriefingStore, istDay } from '../briefing/service.mjs';
import { createNewsRetriever } from '../briefing/sources.mjs';
import { createCommunicationsHub,createDeliveryStore,readConfig } from '../communications/hub.mjs';
import { join } from 'node:path';
// Explicitly constructed by an operator-owned runner. No top-level startup,
// timers, shell commands, environment-file loading or changes to the old worker.
export function createD1Executor({origin,directory,credential,target='core',journal,env=process.env,fetchImpl=fetch,now=Date.now}) {
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.origin!==origin||url.username||!['core','worker'].includes(target)||!/^[\w-]{43}$/.test(credential||''))throw Error('Invalid private executor configuration');
  if(!journal?.change)throw Error('Durable execution journal required');
  const engine=createExecutor({directory,env,environment:target==='core'?'cloud':'worker',fetchImpl});
  const hub=createCommunicationsHub({config:readConfig(env),fetchImpl,store:createDeliveryStore(join(directory,'notifications.json')),maxAttempts:1});
  async function request(action,body={}) {
    const response=await fetchImpl(origin+'/api/mobile/worker/'+action,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Executor request rejected');return response.json();
  }
  return {async runOnce() {
    await request('heartbeat');const {task}=await request('claim');if(!task)return {status:'idle'};
    if(!['research','chat','daily_briefing'].includes(task.type)||(target==='worker'&&task.type==='daily_briefing')||task.environment!==(target==='core'?'cloud':'worker'))throw Error('Executor capability mismatch');
    // Persist BEFORE authorization/execution. A restart never replays this id.
    const fresh=journal.change(s=>{if(s.tasks.some(t=>t.id===task.id))return false;if(s.tasks.length>=500)throw Error('Journal capacity');s.tasks.push({id:task.id,state:'started',at:now()});return true;});
    if(!fresh)throw Error('Execution replay refused');
    const controller=new AbortController();
    const deadline=setTimeout(()=>controller.abort(),100000);
    const check=()=>request('authorize',{id:task.id,lease:task.lease});
    let checking=false;
    const timer=setInterval(()=>{if(checking)return;checking=true;void check().catch(()=>controller.abort()).finally(()=>{checking=false;});},10000);
    let result,error;
    try {
      await check();
      if(task.type==='daily_briefing') {
        if(task.day!==istDay(now()))throw Error('Expired briefing day');
        // Use the SAME persistent directory as the existing scheduler so its
        // day lock, seen-source memory and dispatch marker prevent duplicates.
        // Lease validation immediately before send makes revocation fail closed.
        const guardedHub={notify:async event=>{await check();if(controller.signal.aborted)throw Error('Approval revoked');return hub.notify(event);}};
        const boundedBriefing=createIntelligenceBriefing({store:createBriefingStore(join(directory,'briefings')),retrieve:createNewsRetriever({env,now,fetchImpl:(u,o)=>fetchImpl(u,{...o,signal:AbortSignal.any([controller.signal,...(o?.signal?[o.signal]:[])])})}),hub:guardedHub,now});
        const delivery=await boundedBriefing.run();
        result={status:delivery.status,text:delivery.report?.text||'Briefing already processed or unavailable.',day:task.day,limitations:['Public source reports, not independent experimental validation.']};
        if(['busy','failed','unknown','delivery_unknown_no_resend'].includes(delivery.status))error='briefing_unavailable_or_delivery_unknown';
      } else result=await engine.execute(task,{signal:controller.signal});
    } catch {error='execution_failed';}
    finally {clearInterval(timer);clearTimeout(deadline);}
    journal.change(s=>{Object.assign(s.tasks.find(t=>t.id===task.id),{state:error?'failed':'finished',completedAt:now()});});
    await request('complete',{id:task.id,lease:task.lease,result,error});
    journal.change(s=>{s.tasks.find(t=>t.id===task.id).reported=true;});
    return {status:error?'failed':'completed'};
  }};
}
