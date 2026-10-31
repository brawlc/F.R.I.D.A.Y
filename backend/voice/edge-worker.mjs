import { EdgeTTS } from 'node-edge-tts';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { text, rate, pitch } = JSON.parse(input);
const tts = new EdgeTTS({ voice: 'en-IE-EmilyNeural', lang: 'en-IE', rate, pitch, timeout: 18000 });
for await (const chunk of tts.streamAudio(text)) {
  if (Buffer.isBuffer(chunk)) process.stdout.write(chunk);
}
