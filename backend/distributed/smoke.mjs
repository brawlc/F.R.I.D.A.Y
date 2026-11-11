import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openState} from './state.mjs';
import {digest} from './queue.mjs';
const dir=await mkdtemp(join(tmpdir(),'friday-core-smoke-'));
const store=openState(join(dir,'state.sqlite'));store.change(s=>s.sessions.push({id:'fixture',hash:digest('fixture-session'),csrf:'fixture',expiresAt:Date.now()+60000}));store.close();
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const child=spawn(process.execPath,['backend/distributed/server.mjs'],{env:{...process.env,FRIDAY_CLOUD_DATA:dir,FRIDAY_CLOUD_ORIGIN:'https://fixture.tailnet.ts.net',FRIDAY_CLOUD_PORT:String(port),FRIDAY_CLOUD_PROVIDERS:'',FRIDAY_NTFY_ENABLED:'false'},stdio:'ignore',windowsHide:true});const exited=once(child,'exit');
async function get(){return new Promise((resolve,reject)=>{const r=request(`http://127.0.0.1:${port}/api/mobile/status`,{headers:{Host:'fixture.tailnet.ts.net',Cookie:'__Host-friday=fixture-session','Tailscale-App-Capabilities':'{"friday.local/role":[{"roles":["owner"]}]}'},timeout:1000},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('timeout')));r.end();});}
try{let result;for(let i=0;i<60;i++){try{result=await get();break;}catch{await new Promise(r=>setTimeout(r,250));}}assert.equal(result?.status,200);assert.equal(result.body.cloud,'online');assert.deepEqual(result.body.workers,[]);assert.deepEqual(result.body.tasks,[]);console.log('PASS: actual cloud entry point starts independently with no worker, no notifications and no model requests. Serve headers simulated.');}finally{child.kill();await exited;await rm(dir,{recursive:true,force:true});}
