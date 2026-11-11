import { reportSanitizer } from '../research/pdf.mjs';
import { readdir,lstat,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createResearchMemory } from '../research/memory.mjs';
import { createResearchOrchestrator } from '../research/orchestrator.mjs';
import { createRetrieval } from '../research/retrieval.mjs';
import { createModel } from '../research/portable-model.mjs';
export function createExecutor({directory,env=process.env,environment,fetchImpl=fetch}) {
  const memory=createResearchMemory(join(directory,'research'));
  async function retain(){
    const root=join(directory,'research');let files;try{files=await readdir(root);}catch(e){if(e.code==='ENOENT')return;throw e;}
    const rows=[];for(const name of files.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){const path=join(root,name),info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())throw Error('Unsafe research retention path');rows.push({path,at:info.mtimeMs});}
    rows.sort((a,b)=>b.at-a.at);for(const [i,row]of rows.entries())if(i>=100||row.at<Date.now()-30*86400000)await unlink(row.path);
  }
  const scrub=reportSanitizer(env);
  const sanitize=value=>typeof value==='string'?scrub(value):Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitize(v)])):value;
  return { memory, async execute(task,{signal}={}) {
    if(task.environment!==environment || !['research','chat'].includes(task.type) || (environment==='cloud' && task.provider==='ollama')) throw Error('Unsupported execution');
    if(environment==='worker' && (!task.shareResult || !['retrieval','ollama'].includes(task.provider))) throw Error('Worker data/provider restriction');
    if(environment==='cloud')await retain();
    const boundedFetch=(url,options)=>fetchImpl(url,{...options,signal:AbortSignal.any([options.signal,...(signal?[signal]:[])])});
    const generate=createModel({provider:task.provider,env,fetchImpl:boundedFetch});
    if(task.type==='chat') {
      const text=await generate({role:'assistant',system:'You are FRIDAY. Answer the user. No tools, files, command execution, memory access or experiments are available. State uncertainty honestly.',prompt:task.objective,maxTokens:1200,json:false,signal:AbortSignal.timeout(25000)});
      return {text:scrub(text),usage:{modelCalls:1,maxOutputTokens:1200},limitations:['Conversation-only; no desktop actions executed.']};
    }
    const result=await createResearchOrchestrator({memory,retrieve:createRetrieval({env,fetchImpl:boundedFetch}),generate:task.provider==='retrieval'?undefined:generate}).run({objective:task.objective,conditions:task.conditions});
    if(environment==='cloud')await retain();
    return sanitize(result);
  }};
}
