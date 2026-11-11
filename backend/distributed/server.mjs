import { resolve,join } from 'node:path';
import { openState } from './state.mjs';
import { createCloudApp } from './app.mjs';
import { createExecutor } from './executor.mjs';
import { createCommunicationsHub,createDeliveryStore,readConfig } from '../communications/hub.mjs';
import { createOutbox } from './outbox.mjs';
import { createBriefingStore,createIntelligenceBriefing } from '../briefing/service.mjs';
import { createNewsRetriever } from '../briefing/sources.mjs';
import { startBriefingScheduler } from '../communications/scheduler.mjs';
// Deliberately does not load desktop .env files or local memory.
const directory=resolve(process.env.FRIDAY_CLOUD_DATA||'.friday-cloud');
const origin=process.env.FRIDAY_CLOUD_ORIGIN;
if(!origin)throw Error('FRIDAY_CLOUD_ORIGIN is required');
const providers=['retrieval',...(process.env.FRIDAY_CLOUD_PROVIDERS||'').split(',').filter(x=>['openai','gemini','venice'].includes(x))];
const store=openState(join(directory,'state.sqlite'));
const hub=createCommunicationsHub({config:readConfig(),store:createDeliveryStore(join(directory,'notifications.json')),maxAttempts:1});
const flush=createOutbox(store,hub);
const {app,queue}=createCloudApp({store,origin,enrollmentHash:process.env.FRIDAY_ENROLLMENT_SHA256,providers,wake:()=>void flush().catch(()=>{})});
const executor=createExecutor({directory,environment:'cloud'});
const briefing=createIntelligenceBriefing({store:createBriefingStore(join(directory,'briefings')),retrieve:createNewsRetriever(),hub});
let active=false;
async function tick(){if(active)return;active=true;try{queue.tick();await flush();const task=queue.claim('cloud');if(task){let result,error;try{result=await executor.execute(task);}catch{error='execution_failed';}queue.complete(task.id,'cloud',task.lease,result,error);await flush();}}catch{console.error('Cloud tick failed; review durable state.');}finally{active=false;}}
const timers=[setInterval(()=>void tick(),15000),setInterval(()=>void flush().catch(()=>{}),2000)];
const schedule=startBriefingScheduler(hub,{enabled:true,runner:{run:()=>store.read().settings.daily?briefing.run():Promise.resolve({status:'busy'})},onError:()=>console.error('Briefing unavailable; no news invented.')});
const server=app.listen(Number(process.env.FRIDAY_CLOUD_PORT||3210),'127.0.0.1',()=>{console.log('FRIDAY cloud core listening on loopback; Tailscale Serve required.');void tick();});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{for(const t of timers)clearInterval(t);if(schedule)clearInterval(schedule);server.close(()=>{store.close();process.exit(0);});});
