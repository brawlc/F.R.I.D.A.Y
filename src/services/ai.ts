import { FRIDAY_SYSTEM_PROMPT } from "../constants";

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

export async function transcribeAudioCommand(audioBase64: string, mimeType: string) {
  lastTranscriptionError = '';

  try {
    if (mimeType === 'audio/wav') {
      const wavResponse = await fetch('/api/transcribe-wav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType }),
      });

      if (wavResponse.ok) {
        const result = await wavResponse.json() as { ok?: boolean; text?: string };
        return result.text?.trim() || '';
      }

      const result = await wavResponse.json().catch(() => null) as { error?: string } | null;
      lastTranscriptionError = result?.error || wavResponse.statusText || 'Windows WAV transcription failed.';
      console.error('Local WAV transcription error:', lastTranscriptionError);
      return '';
    }

    const localResponse = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType }),
    });

    if (localResponse.ok) {
      const result = await localResponse.json() as { ok?: boolean; text?: string };
      return result.text?.trim() || '';
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

export async function* streamFridayResponse(messages: { role: 'user' | 'assistant' | 'system', content: string }[]) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);

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

    const result = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: string } | null;

    if (!response.ok || !result?.ok) {
      const error = cleanProviderError(result?.error || response.statusText || 'FRIDAY server request failed.', 'Ollama local mind');
      yield `I cannot reach Ollama right now: ${error}`;
      return;
    }

    yield result.text?.trim() || 'I did not receive a response from Ollama.';
  } catch (error) {
    console.error("FRIDAY local mind error:", error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      yield "The FRIDAY server took too long to answer. I released the console so you can type again.";
      return;
    }
    yield "I cannot reach the FRIDAY server right now. Check the local server and Ollama.";
  } finally {
    window.clearTimeout(timeout);
  }
}
