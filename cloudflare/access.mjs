import { boundedJSON, bytes, decode, fail } from './common.mjs';
// Trust only a configured issuer, never a URL from JWT claims or headers.
export function createAccessVerifier({fetchImpl=fetch, now=Date.now}={}) {
  let cached;
  return async function verify(request, env) {
    if(env.DEVICE_POLICY_VERIFIED!=='true') fail('device_policy_not_verified',503);
    const issuer=env.ACCESS_ISSUER;
    if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer||'') || !env.ACCESS_AUDIENCE || !env.ACCESS_OWNER_SUBJECT) fail('access_not_configured',503);
    const raw=request.headers.get('Cf-Access-Jwt-Assertion')||'';
    if(raw.length>12000)fail('access_denied',401);
    let h,p,parts;
    try { parts=raw.split('.'); if(parts.length!==3)throw Error(); h=JSON.parse(new TextDecoder().decode(decode(parts[0])));p=JSON.parse(new TextDecoder().decode(decode(parts[1]))); } catch { fail('access_denied',401); }
    const t=now()/1000;
    if(h.alg!=='RS256'||typeof h.kid!=='string'||h.crit||p.iss!==issuer||p.sub!==env.ACCESS_OWNER_SUBJECT||!Array.isArray(p.aud)||!p.aud.includes(env.ACCESS_AUDIENCE)||!Number.isFinite(p.exp)||p.exp<=t||!Number.isFinite(p.iat)||p.iat>t+30||(p.nbf!==undefined&&(!Number.isFinite(p.nbf)||p.nbf>t)))fail('access_denied',401);
    if(!cached||cached.issuer!==issuer||cached.until<=now()) {
      const r=await fetchImpl(issuer+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(5000)});
      if(!r.ok)fail('access_keys_unavailable',503);
      const data=await boundedJSON(r); if(!Array.isArray(data.keys)||data.keys.length>16)fail('access_keys_unavailable',503);
      cached={issuer,until:now()+300000,keys:data.keys};
    }
    const jwk=cached.keys.find(k=>k.kid===h.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
    if(!jwk)fail('access_denied',401);
    try {
      const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
      if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),bytes(parts[0]+'.'+parts[1])))fail('access_denied',401);
    } catch { fail('access_denied',401); }
    return {subject:p.sub};
  };
}
