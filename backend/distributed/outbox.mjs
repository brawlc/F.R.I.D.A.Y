import { audit } from './state.mjs';
import { SECURITY_TYPES } from '../communications/hub.mjs';
// Ordinary deliveries cannot hold up the security channel. A transport ambiguity is not replayed.
export function createOutbox(store,hub,{now=Date.now}={}) {
  const active=new Set();
  async function channel(security) {
    if(active.has(security))return;active.add(security);
    try {
      const entry=store.change(s=>{
        for(const n of s.outbox)if(n.state==='sending'&&n.leaseUntil<=now()){n.state='unknown';n.error='dispatch_interrupted_no_replay';}
        const n=s.outbox.filter(n=>n.state==='queued'&&n.nextAt<=now()&&SECURITY_TYPES.has(n.type)===security).sort((a,b)=>(b.severity==='critical')-(a.severity==='critical'))[0];
        if(!n)return null;if(s.settings[security?'securityNotifications':'generalNotifications']===false){n.state='muted';audit(s,'notification_muted',n.id,now());return null;}n.state='sending';n.leaseUntil=now()+20000;n.tries++;return n;
      });
      if(!entry)return;
      let result;try{result=await hub.notify({type:entry.type,id:entry.id,severity:entry.severity});}catch{result={status:'unknown'};}
      store.change(s=>{const n=s.outbox.find(n=>n.id===entry.id&&n.type===entry.type);if(!n)return;const retry=result.status==='failed'&&/^provider_(429|5\d\d)$/.test(result.error||'')&&n.tries<3;n.state=retry?'queued':['sent','deduplicated'].includes(result.status)?'sent':result.error==='network_or_timeout'?'unknown':['failed','disabled','rejected'].includes(result.status)?'failed':'unknown';n.nextAt=now()+Math.min(60000,1000*2**n.tries);n.error=result.error||null;audit(s,'notification_'+n.state,n.id,now());});
    } finally {active.delete(security);}
  }
  return ()=>Promise.all([channel(true),channel(false)]);
}
