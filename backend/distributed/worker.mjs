import { resolve,join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openState } from './state.mjs';
import { createExecutor } from './executor.mjs';
const origin=new URL(process.env.FRIDAY_CLOUD_ORIGIN||'https://invalid');
if(origin.protocol!=='https:'||!origin.hostname.endsWith('.ts.net')||origin.pathname!=='/'||origin.username||origin.search||origin.hash)throw Error('Private core origin required');
const credential=process.env.FRIDAY_WORKER_TOKEN;
if(!credential||credential.length<43)throw Error('Worker credential required');
const directory=resolve(process.env.FRIDAY_WORKER_DATA||'.friday-worker');
const store=openState(join(directory,'worker.sqlite'));
const executor=createExecutor({directory,environment:'worker'});
let stopped=false;
for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>{stopped=true;});
async function request(path,body={}) { const r=await fetch(new URL('/api/mobile/worker/'+path,origin),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Worker request rejected');return r.json(); }
while(!stopped){
  try{
    await request('heartbeat');const {task}=await request('claim');
    if(task){
      const fresh=store.change(s=>{if(s.tasks.some(t=>t.id===task.id))return false;if(s.tasks.length>=500)throw Error('Local journal retention review required');s.tasks.push({id:task.id,state:'started',at:Date.now()});return true;});
      if(!fresh)throw Error('Duplicate task refused');
      const controller=new AbortController();
      const guard=async()=>{await request('authorize',{id:task.id,lease:task.lease});};
      const timer=setInterval(()=>void guard().catch(()=>controller.abort()),10000);
      let result,error;
      try{await guard();result=await executor.execute(task,{signal:controller.signal});}catch{error='execution_failed';}finally{clearInterval(timer);}
      store.change(s=>{Object.assign(s.tasks.find(t=>t.id===task.id),{state:error?'failed':'finished',result,error,completedAt:Date.now()});});
      await request('complete',{id:task.id,lease:task.lease,result,error});
      store.change(s=>{s.tasks.find(t=>t.id===task.id).reported=true;});
    }
  }catch{console.error('Worker unavailable or task interrupted. Journal retained; no automatic execution replay.');}
  await delay(15000);
}
store.close();
