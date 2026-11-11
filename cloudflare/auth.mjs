import * as webauthn from '@simplewebauthn/server';
import { fail, token, hash, encode, decode, stmt, rate, bytes } from './common.mjs';
export function createAuth(db, env, { now=Date.now, webAuthn=webauthn }={}) {
  const origin=new URL(env.APP_ORIGIN);
  if(origin.protocol!=='https:'||origin.origin!==env.APP_ORIGIN)fail('invalid_auth_origin',503);
  const subject=env.ACCESS_OWNER_SUBJECT;
  async function session(request, identity) {
    const raw=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-friday='))?.slice(14);
    if(!raw||raw.length>100||identity.subject!==subject)fail('session_required',401);
    const s=await stmt(db,`SELECT s.* FROM sessions s JOIN credentials c ON c.id=s.credential_id WHERE s.token_hash=? AND s.subject=? AND s.expires_at>? AND c.revoked=0`,await hash(raw),subject,now()).first();
    if(!s)fail('session_required',401);
    if(!['GET','HEAD'].includes(request.method)&&request.headers.get('X-CSRF-Token')!==s.csrf)fail('csrf_denied',403);
    return s;
  }
  async function options(input, identity) {
    if(identity.subject!==subject)fail('owner_required',403); await rate(db,'auth:'+subject,10,now());
    const register=input.register===true;
    const credential=await stmt(db,'SELECT * FROM credentials WHERE owner=?',subject).first();
    let bootstrapHash=null;
    if(register) {
      if(env.ENROLLMENT_ENABLED!=='true'||typeof input.enrollmentCode!=='string'||input.enrollmentCode.length<43||input.enrollmentCode.length>128||credential)fail('enrollment_disabled',403);
      bootstrapHash=await hash(input.enrollmentCode);
      if(!await stmt(db,'SELECT id FROM bootstrap WHERE id=1 AND subject=? AND secret_hash=? AND used=0 AND expires_at>?',subject,bootstrapHash,now()).first())fail('enrollment_denied',403);
    } else if(!credential||credential.revoked)fail('enrollment_required',403);
    const opts=register?await webAuthn.generateRegistrationOptions({rpName:'FRIDAY',rpID:origin.hostname,userName:'owner',userID:bytes(subject),attestationType:'none',supportedAlgorithmIDs:[-7],authenticatorSelection:{residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'}}):await webAuthn.generateAuthenticationOptions({rpID:origin.hostname,userVerification:'required',allowCredentials:[{id:credential.id}]});
    const id=token();
    await db.batch([stmt(db,'DELETE FROM challenges WHERE expires_at<=?',now()),stmt(db,'INSERT INTO challenges VALUES(?,?,?,?,?,?)',id,subject,register?'register':'login',opts.challenge,now()+120000,bootstrapHash)]);
    return {options:opts,challengeId:id,register};
  }
  async function verify(input, identity) {
    if(identity.subject!==subject)fail('owner_required',403); await rate(db,'auth:'+subject,10,now());
    const register=input.register===true;
    if(register&&env.ENROLLMENT_ENABLED!=='true')fail('enrollment_disabled',403);
    // Atomic consumption BEFORE verification prevents replay, including concurrent requests.
    const c=await stmt(db,'DELETE FROM challenges WHERE id=? AND subject=? AND flow=? AND expires_at>? RETURNING *',String(input.challengeId||''),subject,register?'register':'login',now()).first();
    if(!c)fail('challenge_expired_or_used',403);
    let credential,verified;
    try {
      if(register) {
        verified=await webAuthn.verifyRegistrationResponse({response:input.response,expectedChallenge:c.value,expectedOrigin:origin.origin,expectedRPID:origin.hostname,requireUserVerification:true,supportedAlgorithmIDs:[-7]});
        if(!verified.verified||!verified.registrationInfo)throw Error();
        credential=verified.registrationInfo.credential;
      } else {
        credential=await stmt(db,'SELECT * FROM credentials WHERE id=? AND owner=? AND revoked=0',String(input.response?.id||''),subject).first(); if(!credential)throw Error();
        verified=await webAuthn.verifyAuthenticationResponse({response:input.response,expectedChallenge:c.value,expectedOrigin:origin.origin,expectedRPID:origin.hostname,requireUserVerification:true,credential:{id:credential.id,publicKey:decode(credential.public_key),counter:credential.counter}});
        if(!verified.verified)throw Error();
      }
    } catch { fail('passkey_verification_failed',403); }
    const raw=token(),id=token(),csrf=token(),nonce=token(),expiry=now()+1800000;
    const statements=[stmt(db,'DELETE FROM sessions WHERE expires_at<=?',now())];
    if(register) {
      statements.push(stmt(db,`INSERT INTO credentials(id,owner,public_key,counter,last_auth) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bootstrap WHERE id=1 AND subject=? AND secret_hash=? AND used=0 AND expires_at>?)`,credential.id,subject,encode(credential.publicKey),credential.counter,nonce,subject,c.bootstrap_hash,now()));
      statements.push(stmt(db,'UPDATE bootstrap SET used=1 WHERE id=1 AND EXISTS(SELECT 1 FROM credentials WHERE id=? AND last_auth=?)',credential.id,nonce));
    } else statements.push(stmt(db,'UPDATE credentials SET counter=?,version=version+1,last_auth=? WHERE id=? AND version=? AND revoked=0',verified.authenticationInfo.newCounter,nonce,credential.id,credential.version));
    statements.push(stmt(db,`INSERT INTO sessions SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credentials WHERE id=? AND last_auth=? AND revoked=0) AND (SELECT COUNT(*) FROM sessions WHERE subject=?)<5`,id,await hash(raw),subject,credential.id,csrf,expiry,credential.id,nonce,subject));
    let results;try { results=await db.batch(statements); } catch { fail('authentication_race_or_unavailable',409); }
    if(results.at(-1).meta.changes!==1)fail('authentication_race_or_session_limit',409);
    return {body:{ok:true,csrf},cookie:`__Host-friday=${raw}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`};
  }
  return {session,options,verify,async revoke(id){await stmt(db,'DELETE FROM sessions WHERE id=? AND subject=?',id,subject).run();},async revokeAll(){await stmt(db,'DELETE FROM sessions WHERE subject=?',subject).run();}};
}
