export const fail = (code, status = 400) => { throw Object.assign(Error(code), { status, safe: true }); };
export const bytes = text => new TextEncoder().encode(text);
export const encode = value => btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
export const decode = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
export const token = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(String(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
export async function rate(db, key, limit, now = Date.now(), period = 60000) {
  const bucket = Math.floor(now / period);
  const row = await stmt(db, `INSERT INTO rates(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`, `${key}:${bucket}`, (bucket+2)*period).first();
  if (row.count > limit) fail('rate_limited', 429);
}
export async function boundedJSON(response, max = 65536) {
  const reader = response.body?.getReader(); if (!reader) fail('body_required');
  let size = 0; const chunks = [];
  try { for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>max)fail('body_too_large',413); chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  const all=new Uint8Array(size); let at=0; for(const c of chunks){all.set(c,at);at+=c.length;}
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { fail('invalid_json'); }
}
