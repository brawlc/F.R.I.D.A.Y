// Read-only local artifact audit. Never outputs secret values or matched text.
import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'dotenv';
const root=new URL('../',import.meta.url);
const values=[];
for(const file of ['.env','.env.local','backend/.env','backend/.env.local']) {
  try{const config=parse(await readFile(new URL(file,root)));for(const [key,value]of Object.entries(config))if(/key|token|password|secret|topic|chat_id/i.test(key)&&value.length>=8)values.push(value);}catch(e){if(e.code!=='ENOENT')throw Error('Cannot inspect local secret configuration');}
}
for(const [key,value]of Object.entries(process.env))if(/FRIDAY.*(KEY|TOKEN|PASSWORD|SECRET)|API_KEY/.test(key)&&value?.length>=8)values.push(value);
const errors=[],files=[];
async function scan(directory,prefix='') {
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const name=join(prefix,entry.name);if(entry.isSymbolicLink())throw Error('Unexpected artifact symlink');
    if(entry.isDirectory()){await scan(new URL(entry.name+'/',directory),name);continue;}
    const data=await readFile(new URL(entry.name,directory));files.push({file:name,bytes:data.length});
    const text=data.toString('utf8');
    if(values.some(v=>text.includes(v)))errors.push({file:name,reason:'configured_secret_match'});
    if(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\//i.test(text)||text.includes('http://127.0.0.1:3000'))errors.push({file:name,reason:'localhost_backend_url'});
    if(/\/api\/(desktop|kali|hardware)\/|fridayDesktop|gesture-control\.html/.test(text))errors.push({file:name,reason:'desktop_interface'});
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bsk-proj-[A-Za-z0-9_-]{30,}/.test(text))errors.push({file:name,reason:'credential_pattern'});
    if(/(?:\.env|\.sqlite|\.jsonl|\.map)$/.test(entry.name))errors.push({file:name,reason:'unexpected_private_or_source_artifact'});
  }
}
await scan(new URL('mobile-dist/',root));
console.log(JSON.stringify({ok:errors.length===0,files,errors,scope:'Known configured secrets, credential patterns, local API URLs and desktop interfaces; not a proof against unknown secrets.'},null,2));
if(errors.length)process.exitCode=1;
