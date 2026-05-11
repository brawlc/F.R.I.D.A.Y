import { FRIDAY_SYSTEM_PROMPT } from "../constants";

let lastTranscriptionError = '';

export function getLastTranscriptionError() {
  return lastTranscriptionError;
}

function cleanTranscriptionError(message: string) {
  try {
    const parsed = JSON.parse(message);
    message = parsed?.error?.message || message;
  } catch {
    // The server already returned a readable message.
  }

  if (/quota exceeded|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(message)) {
    const retryMatch = message.match(/retry in\s+([^.]+(?:\.\d+)?s)/i) || message.match(/retryDelay["']?\s*:\s*["']?([^"',}]+)/i);
    return `Gemini transcription quota is exhausted.${retryMatch?.[1] ? ` Retry in ${retryMatch[1]}.` : ''}`;
  }

  return message;
}

export async function transcribeAudioCommand(audioBase64: string, mimeType: string) {
  lastTranscriptionError = '';

  try {
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
    lastTranscriptionError = cleanTranscriptionError(result?.error || localResponse.statusText);
    console.error('Local transcription error:', lastTranscriptionError);
    return '';
  } catch (error) {
    lastTranscriptionError = error instanceof Error ? error.message : 'Local transcription request failed.';
    console.error('Local transcription request failed:', error);
  }

  return '';
}

export async function* streamFridayResponse(messages: { role: 'user' | 'assistant' | 'system', content: string }[]) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        systemInstruction: FRIDAY_SYSTEM_PROMPT,
      }),
    });

    const result = await response.json().catch(() => null) as { ok?: boolean; text?: string; error?: string } | null;

    if (!response.ok || !result?.ok) {
      const error = cleanTranscriptionError(result?.error || response.statusText || 'FRIDAY server request failed.');
      yield `I cannot reach the Gemini server right now: ${error}`;
      return;
    }

    yield result.text?.trim() || 'I did not receive a response from Gemini.';
  } catch (error) {
    console.error("Gemini Error:", error);
    yield "I cannot reach the FRIDAY server right now. Check the Render service and network connection.";
  }
}
