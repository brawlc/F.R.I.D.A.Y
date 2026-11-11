import { boundedJSON, fail, stmt } from './common.mjs';
const security=new Set(['suspicious_activity','malware_detection','ransomware_detection','unauthorized_login','unusual_network_activity','critical_security_incident','security_recovery_report','sentinel_report']);
const general=new Set(['task_completed','research_completed','daily_briefing','automation_failure','worker_disconnected','pending_approval','notification_test']);
export function notificationConfig(env) {
  if(env.FRIDAY_NTFY_ENABLED!=='true')fail('notifications_disabled',503);
  let url;try{url=new URL(env.FRIDAY_NTFY_SERVER);}catch{fail('ntfy_configuration_invalid',503);}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!env.FRIDAY_NTFY_TOKEN||env.FRIDAY_NTFY_ACL_VERIFIED!=='true'||!/^[\w-]{1,100}$/.test(env.FRIDAY_NTFY_TOPIC||'')||!/^[\w-]{1,100}$/.test(env.FRIDAY_NTFY_SECURITY_TOPIC||'')||env.FRIDAY_NTFY_TOPIC===env.FRIDAY_NTFY_SECURITY_TOPIC)fail('ntfy_authenticated_separate_topics_required',503);
  return {url:url.origin,token:env.FRIDAY_NTFY_TOKEN,general:env.FRIDAY_NTFY_TOPIC,security:env.FRIDAY_NTFY_SECURITY_TOPIC};
}
export async function dispatchOne(db,env,{now=Date.now,fetchImpl=fetch}={}) {
  const config=notificationConfig(env); // No defaults, Telegram or public-topic fallback.
  await stmt(db,"UPDATE notification_outbox SET state='outcome_unknown',error='interrupted_delivery' WHERE state='sending' AND sending_at<=?",now()-30000).run();
  const r=await stmt(db,`UPDATE notification_outbox SET state='sending',attempts=attempts+1,sending_at=? WHERE id=(SELECT id FROM notification_outbox WHERE state='pending' AND attempts<3 AND next_attempt_at<=? ORDER BY CASE WHEN type IN ('critical_security_incident','malware_detection','ransomware_detection') THEN 0 ELSE 1 END,created_at LIMIT 1) RETURNING *`,now(),now()).first();
  if(!r)return {status:'idle'};
  const isSecurity=security.has(r.type);
  if(!isSecurity&&!general.has(r.type)){await stmt(db,"UPDATE notification_outbox SET state='failed',error='unsupported_event' WHERE id=?",r.id).run();return {status:'failed'};}
  const topic=isSecurity?config.security:config.general;
  const preference=await stmt(db,'SELECT value FROM settings WHERE key=?',isSecurity?'securityNotifications':'generalNotifications').first();
  if(preference?.value==='false') {
    await stmt(db,"UPDATE notification_outbox SET state='failed',error='owner_muted_no_delivery' WHERE id=?",r.id).run();
    return {status:'muted'};
  }
  const message=isSecurity?'FRIDAY security event requires review in the private app. Containment is not confirmed by this notification.':'FRIDAY has a task update. Open your private app for details.';
  let state='outcome_unknown',error='delivery_unknown',next=now();
  try {
    const response=await fetchImpl(config.url+'/'+topic,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+config.token,'Content-Type':'text/plain','Title':isSecurity?'FRIDAY security':'FRIDAY update','Priority':isSecurity?'5':'3'},body:message});
    if(response.status===429||response.status>=500){state=r.attempts<3?'pending':'failed';error='provider_retryable';next=now()+Math.min(300000,Math.max(5000*2**r.attempts,(Number(response.headers.get('Retry-After'))||0)*1000));}
    else if(!response.ok){state='failed';error='provider_rejected';}
    else {const data=await boundedJSON(response,8192);if(data.event==='message'&&typeof data.id==='string'&&data.topic===topic){state='sent';error=null;}}
  } catch { /* Ambiguous network/parse failures never replay or log provider secrets. */ }
  await stmt(db,'UPDATE notification_outbox SET state=?,error=?,next_attempt_at=? WHERE id=? AND state=\'sending\'',state,error,next,r.id).run();
  return {status:state,error};
}
