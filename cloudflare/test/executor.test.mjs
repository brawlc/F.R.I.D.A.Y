import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1Executor } from '../../backend/distributed/d1-executor.mjs';
import { createBriefingStore } from '../../backend/briefing/service.mjs';
import { openState } from '../../backend/distributed/state.mjs';
test('core bridge reuses daily delivery memory and refuses execution replay',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'friday-d1-executor-'));let journal;
  try {
    journal=openState(join(dir,'journal.sqlite'));
    const at=Date.parse('2026-11-11T03:45:00Z'),day='2026-11-11';
    await createBriefingStore(join(dir,'briefings')).save({days:{[day]:{status:'sent',report:{text:'Previously verified briefing'}}},seen:[]});
    const calls=[];const task={id:'briefing:'+day,type:'daily_briefing',environment:'cloud',day,lease:'fixture-lease'};
    const bridge=createD1Executor({origin:'https://private.example',directory:dir,credential:'a'.repeat(43),journal,env:{FRIDAY_NTFY_ENABLED:'false'},now:()=>at,fetchImpl:async(url,options)=>{const action=url.split('/').at(-1);calls.push(action);assert.match(url,/^https:\/\/private\.example\/api\/mobile\/worker\//);assert.equal(options.headers.Authorization,'Bearer '+'a'.repeat(43));if(action==='claim')return Response.json({task});if(action==='complete')assert.equal(JSON.parse(options.body).result.text,'Previously verified briefing');return Response.json({ok:true});}});
    assert.equal((await bridge.runOnce()).status,'completed');assert.deepEqual(calls,['heartbeat','claim','authorize','complete']);
    await assert.rejects(bridge.runOnce(),/replay refused/);
  }finally{journal?.close();await rm(dir,{recursive:true,force:true});}
});
test('core bridge never executes when its lease authorization is denied',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'friday-d1-denied-'));let journal;
  try{
    journal=openState(join(dir,'journal.sqlite'));const actions=[];
    const bridge=createD1Executor({origin:'https://private.example',directory:dir,credential:'a'.repeat(43),journal,env:{},fetchImpl:async(url,options)=>{const action=url.split('/').at(-1);actions.push(action);assert.ok(['heartbeat','claim','authorize','complete'].includes(action));if(action==='claim')return Response.json({task:{id:'one',type:'research',environment:'cloud',provider:'retrieval',lease:'fixture'}});if(action==='authorize')return new Response('',{status:403});if(action==='complete')assert.equal(JSON.parse(options.body).error,'execution_failed');return Response.json({ok:true});}});
    assert.equal((await bridge.runOnce()).status,'failed');assert.deepEqual(actions,['heartbeat','claim','authorize','complete']);
  }finally{journal?.close();await rm(dir,{recursive:true,force:true});}
});
