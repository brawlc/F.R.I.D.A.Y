// Portable research transport: the same provider endpoints and per-stage interface as desktop.
// Explicit provider selection: never fall back from local execution to an external model.
export function createModel({provider='retrieval',env=process.env,fetchImpl=fetch}) {
  return async ({system,prompt,role,signal,maxTokens=600,json=true}) => {
    if(provider==='retrieval') throw Error('No model requested');
    const instruction=`${system}\nIndependent role: ${role}. No tools or execution permissions.`;
    let url,body,headers={'Content-Type':'application/json'};
    const messages=[{role:'system',content:instruction},{role:'user',content:prompt}];
    if(provider==='ollama') { url='http://127.0.0.1:11434/api/chat'; body={model:env.OLLAMA_MODEL||'llama3.1:latest',messages,stream:false,options:{num_predict:maxTokens,num_ctx:6144},...(json?{format:'json'}:{})}; }
    else if(provider==='gemini' && env.GEMINI_API_KEY) { url='https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent'; headers['x-goog-api-key']=env.GEMINI_API_KEY;body={systemInstruction:{parts:[{text:instruction}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens,...(json?{responseMimeType:'application/json'}:{})}}; }
    else if(provider==='openai' && env.OPENAI_API_KEY) {url='https://api.openai.com/v1/chat/completions';headers.Authorization=`Bearer ${env.OPENAI_API_KEY}`;body={model:env.OPENAI_MODEL||'gpt-4o',messages,max_tokens:maxTokens,...(json?{response_format:{type:'json_object'}}:{})};}
    else if(provider==='venice' && (env.VENICE_API_KEY||env.VENICE_ADMIN_KEY)) {url='https://api.venice.ai/api/v1/chat/completions';headers.Authorization=`Bearer ${env.VENICE_API_KEY||env.VENICE_ADMIN_KEY}`;body={model:env.VENICE_MODEL||'zai-org-glm-5',messages,max_tokens:maxTokens,venice_parameters:{include_venice_system_prompt:false}};}
    else throw Error('Selected provider unavailable');
    const r=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([signal||AbortSignal.timeout(25000),AbortSignal.timeout(25000)])});
    if(!r.ok){await r.body?.cancel();throw Error('Model request failed');}
    const reader=r.body.getReader();let bytes=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>256000)throw Error('Model response limit');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
    const data=JSON.parse(Buffer.concat(chunks).toString());if(data.choices?.[0]?.finish_reason==='length'||data.candidates?.[0]?.finishReason==='MAX_TOKENS')throw Error('Truncated model output');
    return String(data.message?.content||data.choices?.[0]?.message?.content||(data.candidates?.[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join(''));
  };
}
