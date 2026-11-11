import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { digest, token, fail } from './queue.mjs';
import { audit, outbox } from './state.mjs';
export const CAPABILITY = 'friday.local/role';
export function privateBoundary(origin,onDenied=()=>{}) {
  const expected = new URL(origin);
  if(expected.protocol!=='https:' || !expected.hostname.endsWith('.ts.net') || expected.pathname!=='/' || expected.search || expected.hash || expected.username) throw Error('Private HTTPS ts.net origin required');
  return (req,res,next) => {
    const deny=()=>{onDenied();return res.sendStatus(403);};
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.host!==expected.host) return deny();
    let capabilities; try { capabilities=JSON.parse(req.headers['tailscale-app-capabilities'] || '{}')[CAPABILITY] || []; } catch { return deny(); }
    if(!Array.isArray(capabilities)) return deny();
    req.tailRoles=capabilities.flatMap(c=>c&&Array.isArray(c.roles)?c.roles:[]).filter(r=>['owner','worker'].includes(r));
    if(!req.tailRoles.length) return deny();
    if(req.headers.origin && req.headers.origin!==expected.origin) return deny();
    if(!['GET','HEAD'].includes(req.method) && !req.path.startsWith('/api/mobile/worker/') && req.headers.origin!==expected.origin) return deny();
    next();
  };
}
export function createAuth(store,{origin,enrollmentHash='',now=Date.now,webAuthn={generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse}}) {
  const rpID=new URL(origin).hostname;
  function session(req) {
    const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-friday='))?.slice(14);
    const found=raw&&store.read().sessions.find(s=>s.hash===digest(raw)&&s.expiresAt>now());
    return found || null;
  }
  const owner = (req,res,next) => { if(!req.tailRoles.includes('owner')) return res.sendStatus(403); const s=session(req); if(!s) return res.sendStatus(401); if(!['GET','HEAD'].includes(req.method) && req.headers['x-csrf-token']!==s.csrf) return res.sendStatus(403); req.ownerSession=s; next(); };
  function attempt() { store.change(s=>{ const key='auth_attempt'; const recent=s.audit.filter(a=>a.event===key&&a.at>now()-60000); if(recent.length>=10) fail('rate_limited',429); audit(s,key,'',now()); }); }
  function challenge(flow, value) { return store.change(s=> { s.challenges=s.challenges.filter(c=>c.expiresAt>now()); const id=token(); s.challenges.push({id,flow,value,expiresAt:now()+120000}); return id; }); }
  function consume(id,flow) { return store.change(s=> { const c=s.challenges.find(c=>c.id===id&&c.flow===flow&&c.expiresAt>now()); s.challenges=s.challenges.filter(c=>c.id!==id); if(!c) fail('invalid_challenge',403); return c.value; }); }
  return { owner, session,
    async options(req) {
      if(!req.tailRoles.includes('owner')) fail('owner_device_required',403); attempt(); const s=store.read(); const register=req.body.register===true;
      if(register && (s.credentials.length || s.enrollmentUsed || !enrollmentHash || digest(req.body.enrollmentCode||'')!==enrollmentHash)) fail('enrollment_not_authorized',403);
      if(!register && !s.credentials.length) fail('enrollment_required',403);
      const options=register?await webAuthn.generateRegistrationOptions({ rpName:'FRIDAY',rpID,userName:'owner',userID:new TextEncoder().encode('friday-owner'),attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'} }):await webAuthn.generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:s.credentials.map(c=>({id:c.id,transports:c.transports}))});
      return {options,challengeId:challenge(register?'register':'login',options.challenge),register};
    },
    async verify(req,res) {
      if(!req.tailRoles.includes('owner')) fail('owner_device_required',403); attempt(); const register=req.body.register===true; const expectedChallenge=consume(req.body.challengeId,register?'register':'login');
      try {
        if(register) {
          const verified=await webAuthn.verifyRegistrationResponse({response:req.body.response,expectedChallenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});
          if(!verified.verified || !verified.registrationInfo) fail('invalid_passkey',403);
          const c=verified.registrationInfo.credential;
          store.change(s=> { if(s.credentials.length || s.enrollmentUsed) fail('already_enrolled',409); s.credentials.push({id:c.id,publicKey:Buffer.from(c.publicKey).toString('base64url'),counter:c.counter,transports:c.transports}); s.enrollmentUsed=true; audit(s,'owner_enrolled','',now()); });
        } else {
          const c=store.read().credentials.find(c=>c.id===req.body.response?.id); if(!c) fail('unknown_passkey',403);
          const verified=await webAuthn.verifyAuthenticationResponse({ response:req.body.response,expectedChallenge,expectedOrigin:origin,expectedRPID:rpID,credential:{...c,publicKey:new Uint8Array(Buffer.from(c.publicKey,'base64url'))},requireUserVerification:true });
          if(!verified.verified) fail('invalid_passkey',403);
          store.change(s=>{const current=s.credentials.find(x=>x.id===c.id); if(!current || current.counter!==c.counter) fail('authentication_race',409); current.counter=verified.authenticationInfo.newCounter;});
        }
        const raw=token(),csrf=token(); store.change(s=>{s.sessions=s.sessions.filter(x=>x.expiresAt>now()).slice(-4); s.sessions.push({id:token(),hash:digest(raw),csrf,createdAt:now(),expiresAt:now()+30*60000});audit(s,'login_success','',now());});
        res.cookie('__Host-friday',raw,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:30*60000}); return {ok:true,csrf};
      } catch { store.change(s=>{audit(s,'login_rejected','',now());outbox(s,'unauthorized_login',String(Math.floor(now()/60000)),'high',now());}); fail('passkey_verification_failed',403); }
    },
  };
}
