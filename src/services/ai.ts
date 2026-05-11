import { GoogleGenAI } from "@google/genai";
import { FRIDAY_SYSTEM_PROMPT } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function transcribeAudioCommand(audioBase64: string, mimeType: string) {
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
