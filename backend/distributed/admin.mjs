import { resolve,join } from 'node:path';
import { openState,audit } from './state.mjs';
import { digest } from './queue.mjs';
// Run only via an explicitly approved administrative session on the core host.
const [action,id]=process.argv.slice(2);
if(!['register-worker','rotate-worker','revoke-worker','recover-owner','revoke-sessions'].includes(action))throw Error('Specify register-worker, rotate-worker, revoke-worker, recover-owner or revoke-sessions');
const store=openState(join(resolve(process.env.FRIDAY_CLOUD_DATA||'.friday-cloud'),'state.sqlite'));
try{store.change(s=>{
  if(action.endsWith('worker')){
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id||''))throw Error('Invalid worker ID');
    if(action==='revoke-worker'){if(!s.workers[id])throw Error('Unknown worker');s.workers[id].revoked=true;}
    else {const raw=process.env.FRIDAY_WORKER_TOKEN;if(!raw||raw.length<43)throw Error('Supply a random 32-byte FRIDAY_WORKER_TOKEN via environment; never command arguments');if(action==='register-worker'&&s.workers[id])throw Error('Worker already registered');if(action==='rotate-worker'&&!s.workers[id])throw Error('Unknown worker');s.workers[id]={id,tokenHash:digest(raw),lastSeen:0,revoked:false};}
  }else{ s.sessions=[];s.challenges=[];if(action==='recover-owner'){s.credentials=[];s.enrollmentUsed=false;} }
  audit(s,action,id||'');
});console.log('Administrative update saved. No credentials printed.');}finally{store.close();}
