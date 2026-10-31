# FRIDAY Irish Neural voice

Restart FRIDAY, open voice controls and select **FRIDAY Irish Neural (online)**, then **Test**. This update selects that preset once; later changes are saved normally. Emily (`en-IE-EmilyNeural`) uses a slightly slower rate and natural pitch. It is a FRIDAY-inspired preset, not a reproduction of the actor's voice.

The online voice uses `node-edge-tts` without a paid API key. Internet access is required and spoken text is sent to Microsoft's service. The UI labels this explicitly. Choose a Windows/local voice for sensitive content; automated secret detection is not provided. Existing language-model usage costs are unchanged.

Synthesis uses a bounded worker, a 4,000-character limit, two concurrent requests maximum and a timeout. Audio is held temporarily in memory, not saved in speech-history files. Muting, changing voices or starting a new utterance cancels online playback. Provider failures fall back to Windows speech when available, otherwise browser speech. The service is unofficial and may stop working after upstream changes.

Verification: `node --test backend/test/voice.test.mjs`, `npm run lint`, `npm run build`. A live sample sentence also produced MP3 bytes; perceived similarity is subjective and not certified.
