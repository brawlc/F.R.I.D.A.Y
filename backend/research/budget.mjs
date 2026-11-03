import { performance } from 'node:perf_hooks';
export const LIMITS = Object.freeze({ maxRequests: 10, maxHttpAttempts: 15, maxModelCalls: 5, maxInputTokensPerCall: 8000, maxInputTokens: 24000, maxOutputTokens: 5400, maxOutputTokensPerCall: 1800, maxFollowUps: 1, runtimeMs: 100000, retrievalMs: 45000 });
export const OUTPUT = Object.freeze({ planner: 600, analyst: 1800, critic: 600, 'followup-analyst': 1800, 'followup-critic': 600 });
export function createBudget(timeoutMs = LIMITS.runtimeMs) {
  const start = performance.now();
  const runtimeMs = Math.min(LIMITS.runtimeMs, Math.max(1, timeoutMs));
  const usage = { ...LIMITS, runtimeMs, requests: 0, httpAttempts: 0, modelCalls: 0, inputTokensReserved: 0, outputTokensReserved: 0, retrievalMsUsed: 0, followUps: 0, stages: [], accounting: 'Input: UTF-8 bytes plus 1024 framing tokens reserved; output: requested limits reserved, not measured billing.' };
  const remaining = () => Math.max(0, runtimeMs - (performance.now() - start));
  const inputCost = (system, prompt) => Buffer.byteLength(system + prompt, 'utf8') + 1024;
  function reserveModel(role, system, prompt) {
    const cost = inputCost(system, prompt), output = OUTPUT[role];
    if (!output || usage.stages.some(s => s.role === role)) return 'stage_limit';
    if (!remaining()) return 'runtime_exhausted';
    if (usage.httpAttempts >= usage.maxHttpAttempts || usage.modelCalls >= usage.maxModelCalls) return 'model_or_http_budget_exhausted';
    if (cost > usage.maxInputTokensPerCall || cost + usage.inputTokensReserved > usage.maxInputTokens) return 'input_budget_exhausted';
    if (output + usage.outputTokensReserved > usage.maxOutputTokens) return 'output_budget_exhausted';
    usage.modelCalls++; usage.httpAttempts++; usage.inputTokensReserved += cost; usage.outputTokensReserved += output;
    usage.stages.push({ role, inputTokensReserved: cost, outputTokensReserved: output, status: 'started' });
    return null;
  }
  return { usage, remaining, inputCost, reserveModel, snapshot: () => ({ ...structuredClone(usage), elapsedMs: Math.ceil(performance.now() - start) }) };
}
// Enforce deadlines even if an injected adapter does not honor cancellation.
export async function boundedCall(fn, signal) {
  signal.throwIfAborted();
  let listener;
  const abort = new Promise((_, reject) => { listener = () => reject(signal.reason); signal.addEventListener('abort', listener, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return fn(); }), abort]); }
  finally { signal.removeEventListener('abort', listener); }
}
