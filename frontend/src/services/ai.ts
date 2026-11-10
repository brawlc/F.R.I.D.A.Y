import { FRIDAY_SYSTEM_PROMPT } from "../constants";
import { isResearchConversation } from './commandRouting';

let lastTranscriptionError = '';

export function getLastTranscriptionError() {
  return lastTranscriptionError;
}

function cleanProviderError(message: string, label = 'AI provider') {
  try {
    const parsed = JSON.parse(message);
    message = parsed?.error?.message || message;
  } catch {
    // The server already returned a readable message.
  }

  if (/quota exceeded|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(message)) {
    const retryMatch = message.match(/retry in\s+([^.]+(?:\.\d+)?s)/i) || message.match(/retryDelay["']?\s*:\s*["']?([^"',}]+)/i);
    return `${label} quota is exhausted.${retryMatch?.[1] ? ` Retry in ${retryMatch[1]}.` : ''}`;
  }

  return message;
}

function cleanTranscript(text = '') {
  const cleaned = text.trim();
  if (/^\[(?:BLANK_AUDIO|MUSIC|SILENCE|NO_SPEECH)\]$/i.test(cleaned)) return '';
  return cleaned;
}

export async function transcribeAudioCommand(audioBase64: string, mimeType: string) {
  lastTranscriptionError = '';

  try {
    if (mimeType === 'audio/wav') {
      const wavResponse = await fetch('/api/transcribe-wav', {
        method: 'POST',
        signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType }),
      });

      if (wavResponse.ok) {
        const result = await wavResponse.json() as { ok?: boolean; text?: string };
        return cleanTranscript(result.text);
      }

      const result = await wavResponse.json().catch(() => null) as { error?: string } | null;
      lastTranscriptionError = result?.error || wavResponse.statusText || 'Windows WAV transcription failed.';
      console.error('Local WAV transcription error:', lastTranscriptionError);
      return '';
    }

    const localResponse = await fetch('/api/transcribe', {
      method: 'POST',
      signal: AbortSignal.timeout(120000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType }),
    });

    if (localResponse.ok) {
      const result = await localResponse.json() as { ok?: boolean; text?: string };
      return cleanTranscript(result.text);
    }

    const result = await localResponse.json().catch(() => null) as { error?: string } | null;
    lastTranscriptionError = cleanProviderError(result?.error || localResponse.statusText, 'Gemini transcription');
    console.error('Local transcription error:', lastTranscriptionError);
    return '';
  } catch (error) {
    lastTranscriptionError = error instanceof Error ? error.message : 'Local transcription request failed.';
    console.error('Local transcription request failed:', error);
  }

  return '';
}

export async function* streamFridayResponse(messages: { role: 'user' | 'assistant' | 'system', content: string }[], onResearch?: (id?: string) => void) {
  const controller = new AbortController();
  const lastUser = [...messages].reverse().find(message => message.role === 'user')?.content || '';
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant')?.content || '';
  const isResearch = isResearchConversation(lastUser, lastAssistant);
  const timeout = window.setTimeout(() => controller.abort(), isResearch ? 115000 : 45000);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        messages,
        systemInstruction: FRIDAY_SYSTEM_PROMPT,
      }),
    });

    const result = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: string; provider?: string; researchId?: string } | null;

    if (!response.ok || !result?.ok) {
      const error = cleanProviderError(result?.error || response.statusText || 'FRIDAY server request failed.', 'AI provider');
      yield `FRIDAY could not get an AI response: ${error}`;
      return;
    }

    if (result.provider === 'research') onResearch?.(typeof result.researchId === 'string' && /^[a-f0-9-]{36}$/i.test(result.researchId) ? result.researchId : undefined);
    yield result.text?.trim() || 'The AI provider returned an empty response.';
  } catch (error) {
    console.error("FRIDAY local mind error:", error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      yield "The FRIDAY server took too long to answer. I released the console so you can type again.";
      return;
    }
    yield "I cannot reach the FRIDAY server right now. Check that the local server is running.";
  } finally {
    window.clearTimeout(timeout);
  }
}
export async function runDiagnosticsCommand(command: string): Promise<string> {
  const normalized = command.trim().toLowerCase();
  const wantsFull = /\b(full system diagnostic|system diagnostic|generate security report|security report|analyze system bottlenecks|monitor all services|diagnostic report)\b/.test(normalized);
  const wantsNetwork = /\b(scan network health|network health|kali network diagnostics)\b/.test(normalized);
  const wantsConnections = /\b(show active connections|active connections)\b/.test(normalized);

  if (wantsFull) {
    const response = await fetch('/api/diagnostics/full');
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || response.statusText || 'Diagnostics failed.');
    }
    return [
      '**System Intelligence Report**',
      result.summary || 'Diagnostics completed.',
      '',
      '**Kali Network Evidence**',
      String(result?.kali?.network || result?.kali?.error || '').slice(0, 4000),
    ].join('\n');
  }

  const action = wantsConnections ? 'active-connections' : wantsNetwork ? 'network-diagnostics' : '';
  if (!action) return '';

  const response = await fetch('/api/kali/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || response.statusText || 'Kali diagnostics failed.');
  }
  return [
    action === 'active-connections' ? '**Kali Active Connections**' : '**Kali Network Diagnostics**',
    result.output || 'No output returned.',
  ].join('\n');
}
