import { GoogleGenAI } from "@google/genai";
import { FRIDAY_SYSTEM_PROMPT } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{
        role: "user",
        parts: [
          {
            text: [
              "Transcribe the entire audio clip exactly as spoken.",
              "Preserve long sentences, all command details, app names, file names, punctuation when clear, and the wake word if it was spoken.",
              "Do not summarize, shorten, correct intent, add commentary, add labels, add markdown, or wrap the result in quotes.",
              "Return only the spoken words."
            ].join(" ")
          },
          {
            inlineData: {
              data: audioBase64,
              mimeType,
            }
          }
        ]
      }]
    });

    return response.text?.trim() || '';
  } catch (error) {
    lastTranscriptionError = error instanceof Error ? error.message : (lastTranscriptionError || 'Gemini transcription failed.');
    console.error("Gemini Transcription Error:", error);
    return '';
  }
}

export async function* streamFridayResponse(messages: { role: 'user' | 'assistant' | 'system', content: string }[]) {
  try {
    const chat = ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: FRIDAY_SYSTEM_PROMPT,
      }
    });

    // We only send the latest user message to simplify for now, or we can send the whole history
    const userMessage = messages[messages.length - 1].content;
    const streamResponse = await chat.sendMessageStream({ message: userMessage });

    for await (const chunk of streamResponse) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  } catch (error) {
    console.error("Gemini Error:", error);
    yield "Error: Connection lost. Systems failing, Sir. Please check your connectivity.";
  }
}
