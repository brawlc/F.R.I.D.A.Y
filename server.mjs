import express from 'express';
import dotenv from 'dotenv';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const canUseDesktopBridge = process.platform === 'win32' && !process.env.RENDER;
const useOllama = process.env.FRIDAY_USE_OLLAMA !== 'false';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:latest';
const useGemini = process.env.FRIDAY_USE_GEMINI === 'true';
const gemini = useGemini && process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const modelOrder = String(process.env.FRIDAY_MODEL_ORDER || (gemini ? 'gemini,ollama' : 'ollama,gemini'))
  .split(',')
  .map(item => item.trim().toLowerCase())
  .filter(Boolean);
const googleSearchApiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';
const externalFetchTimeoutMs = Number(process.env.FRIDAY_EXTERNAL_FETCH_TIMEOUT_MS || 7000);
const ollamaFetchTimeoutMs = Number(process.env.FRIDAY_OLLAMA_TIMEOUT_MS || 12000);
let whisperPipelinePromise = null;

const openTargets = {
  instagram: 'https://www.instagram.com/',
  youtube: 'https://www.youtube.com/',
  google: 'https://www.google.com/',
  gmail: 'https://mail.google.com/',
  whatsapp: 'https://web.whatsapp.com/',
  chatgpt: 'https://chatgpt.com/',
  github: 'https://github.com/',
  facebook: 'https://www.facebook.com/',
  twitter: 'https://x.com/',
  linkedin: 'https://www.linkedin.com/',
  amazon: 'https://www.amazon.com/',
  netflix: 'https://www.netflix.com/',
  spotify: 'https://open.spotify.com/',
  hotstar: 'https://www.hotstar.com/in',
  'jio hotstar': 'https://www.hotstar.com/in',
  jiohotstar: 'https://www.hotstar.com/in',
  maps: 'https://www.google.com/maps',
};

app.use(express.json({ limit: '15mb' }));

app.use('/api/desktop', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get('/api/desktop/status', (_req, res) => {
  res.json({
    ok: true,
    desktopBridge: canUseDesktopBridge,
    platform: process.platform,
  });
});

function runPowerShellJson(script, args = []) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      cwd: __dirname,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr || error.message));
        return;
      }

      try {
        resolvePromise(stdout.trim() ? JSON.parse(stdout) : null);
      } catch {
        resolvePromise(stdout.trim());
      }
    });
  });
}

app.get('/api/desktop/voices', async (_req, res) => {
  if (!canUseDesktopBridge) {
    res.status(503).json({ ok: false, voices: [], error: 'Desktop bridge unavailable.' });
    return;
  }

  try {
    const script = [
      'Add-Type -AssemblyName System.Speech;',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
      '$voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo | Select-Object Name,@{Name="Culture";Expression={$_.Culture.Name}},Gender,Age,Description };',
      '$voices | ConvertTo-Json -Compress',
    ].join(' ');
    const voices = await new Promise((resolvePromise, rejectPromise) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error(stderr || error.message));
          return;
        }

        try {
          const parsed = stdout.trim() ? JSON.parse(stdout) : [];
          resolvePromise(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolvePromise([]);
        }
      });
    });

    res.json({ ok: true, voices });
  } catch (error) {
    res.status(500).json({
      ok: false,
      voices: [],
      error: error instanceof Error ? error.message : 'Could not list Windows voices.',
    });
  }
});

app.post('/api/desktop/speak', async (req, res) => {
  if (!canUseDesktopBridge) {
    res.status(503).json({ ok: false, error: 'Desktop bridge unavailable.' });
    return;
  }

  const text = String(req.body?.text || '').slice(0, 2000);
  const voice = String(req.body?.voice || '');
  const rate = Number.isFinite(Number(req.body?.rate)) ? Math.round(Number(req.body.rate)) : 0;
  const volume = Number.isFinite(Number(req.body?.volume)) ? Math.round(Number(req.body.volume)) : 100;

  if (!text.trim()) {
    res.status(400).json({ ok: false, error: 'No speech text received.' });
    return;
  }

  const payload = Buffer.from(JSON.stringify({ text, voice, rate, volume }), 'utf8').toString('base64');
  const scriptPath = join(__dirname, 'electron', 'windows-speak.ps1');

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, payload], {
        cwd: __dirname,
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error(stderr || error.message));
          return;
        }

        resolvePromise(stdout.trim());
      });
    });

    res.json({ ok: true, message: 'Spoken.' });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Windows speech failed.',
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'friday-ai',
    ollamaConfigured: useOllama,
    ollamaModel,
    googleSearchConfigured: Boolean(googleSearchApiKey && googleSearchEngineId),
    timestamp: new Date().toISOString(),
  });
});

const globalHeadlineFeeds = [
  'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://rss.cnn.com/rss/edition_world.rss',
];

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripGoogleNewsSource(title = '') {
  return title.replace(/\s+-\s+[^-]+$/i, '').trim();
}

function extractFirstRssHeadline(xml = '') {
  const itemMatch = xml.match(/<item\b[\s\S]*?<\/item>/i) || xml.match(/<entry\b[\s\S]*?<\/entry>/i);
  if (!itemMatch) return '';

  const titleMatch = itemMatch[0].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return stripGoogleNewsSource(decodeXmlEntities(titleMatch?.[1] || ''));
}

async function fetchTextWithCurl(url, timeoutMs = externalFetchTimeoutMs) {
  const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const maxTimeSeconds = Math.max(2, Math.ceil(timeoutMs / 1000));

  return await new Promise((resolvePromise, rejectPromise) => {
    execFile(curlCommand, [
      '-L',
      '--silent',
      '--show-error',
      '--fail',
      '--max-time',
      String(maxTimeSeconds),
      '-A',
      'FRIDAY-AI/1.0 (+local desktop assistant)',
      url,
    ], {
      windowsHide: true,
      timeout: timeoutMs + 1500,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr.trim() || error.message));
        return;
      }

      resolvePromise(stdout);
    });
  });
}

async function fetchRssText(feedUrl) {
  try {
    const response = await fetchWithTimeout(feedUrl, {
      headers: {
        'User-Agent': 'FRIDAY-AI/1.0 (+local desktop assistant)',
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    }, externalFetchTimeoutMs);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      text: await response.text(),
      via: 'fetch',
    };
  } catch (error) {
    try {
      return {
        ok: true,
        text: await fetchTextWithCurl(feedUrl, externalFetchTimeoutMs),
        via: 'curl',
      };
    } catch (curlError) {
      const fetchMessage = error instanceof Error ? error.message : 'fetch failed';
      const curlMessage = curlError instanceof Error ? curlError.message : 'curl failed';
      return {
        ok: false,
        error: `${fetchMessage}; curl fallback: ${curlMessage}`,
      };
    }
  }
}

app.get('/api/news/top-headline', async (_req, res) => {
  const feedErrors = [];

  for (const feedUrl of globalHeadlineFeeds) {
    try {
      const feed = await fetchRssText(feedUrl);

      if (!feed.ok) {
        feedErrors.push(`${new URL(feedUrl).hostname}: ${feed.error || 'request failed'}`);
        continue;
      }

      const headline = extractFirstRssHeadline(feed.text);
      if (headline) {
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          ok: true,
          headline,
          source: new URL(feedUrl).hostname.replace(/^www\./, ''),
          via: feed.via,
          fetchedAt: new Date().toISOString(),
        });
        return;
      }
      feedErrors.push(`${new URL(feedUrl).hostname}: no headline found`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed';
      feedErrors.push(`${new URL(feedUrl).hostname}: ${message}`);
      // Try the next feed.
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({
    ok: false,
    error: 'No global headline feed responded.',
    feeds: feedErrors,
  });
});

async function fetchWithTimeout(url, options = {}, timeoutMs = externalFetchTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getWhisperPipeline() {
  if (!whisperPipelinePromise) {
    whisperPipelinePromise = import('@xenova/transformers').then(async ({ pipeline, env }) => {
      env.allowLocalModels = false;
      return await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    });
  }

  return whisperPipelinePromise;
}

function parsePcm16Wav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Audio payload is not a WAV file.');
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;

    if (id === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
      if (audioFormat !== 1 || bitsPerSample !== 16) {
        throw new Error('Only 16-bit PCM WAV audio is supported.');
      }
    } else if (id === 'data') {
      dataStart = start;
      dataSize = size;
      break;
    }

    offset = start + size + (size % 2);
  }

  if (dataStart < 0 || dataSize <= 0) {
    throw new Error('WAV file does not contain audio data.');
  }

  const frameCount = Math.floor(dataSize / (2 * channels));
  const samples = new Float32Array(frameCount);
  let readOffset = dataStart;

  for (let frame = 0; frame < frameCount; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      mixed += buffer.readInt16LE(readOffset) / 32768;
      readOffset += 2;
    }
    samples[frame] = mixed / channels;
  }

  return { samples, sampleRate };
}

function resampleLinear(samples, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return samples;

  const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(targetLength);
  const ratio = (samples.length - 1) / Math.max(1, targetLength - 1);

  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(samples.length - 1, left + 1);
    const weight = sourceIndex - left;
    output[i] = samples[left] * (1 - weight) + samples[right] * weight;
  }

  return output;
}

async function transcribeWavWithWhisper(audioBuffer) {
  const { samples, sampleRate } = parsePcm16Wav(audioBuffer);
  const audio = resampleLinear(samples, sampleRate, 16000);
  const transcriber = await getWhisperPipeline();
  const result = await transcriber(audio);

  return String(result?.text || '').trim();
}

app.post('/api/transcribe', async (req, res) => {
  if (!gemini) {
    res.status(500).json({
      ok: false,
      error: 'GEMINI_API_KEY is missing in .env.local.',
    });
    return;
  }

  const audioBase64 = String(req.body?.audioBase64 || '');
  const mimeType = String(req.body?.mimeType || 'audio/webm');

  if (!audioBase64) {
    res.status(400).json({
      ok: false,
      error: 'No audio payload received.',
    });
    return;
  }

  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{
        role: 'user',
        parts: [
          {
            text: [
              'Transcribe the entire audio clip exactly as spoken.',
              'Preserve long sentences, command details, app names, file names, punctuation when clear, and the wake word if it was spoken.',
              'Do not summarize, shorten, correct intent, add commentary, add labels, add markdown, or wrap the result in quotes.',
              'Return only the spoken words.'
            ].join(' ')
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

    res.json({
      ok: true,
      text: response.text?.trim() || '',
    });
  } catch (error) {
    console.error('Gemini transcription error:', error);
    let message = error instanceof Error ? error.message : 'Gemini transcription failed.';

    try {
      const parsed = JSON.parse(message);
      message = parsed?.error?.message || message;
    } catch {
      // Keep the original SDK error message.
    }

    res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

app.post('/api/transcribe-wav', async (req, res) => {
  if (!canUseDesktopBridge) {
    res.status(503).json({
      ok: false,
      error: 'Local Windows transcription is only available in the desktop app.',
    });
    return;
  }

  const audioBase64 = String(req.body?.audioBase64 || '');
  if (!audioBase64) {
    res.status(400).json({
      ok: false,
      error: 'No WAV audio payload received.',
    });
    return;
  }

  let tempFolder = '';
  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    try {
      const text = await transcribeWavWithWhisper(audioBuffer);
      res.json({
        ok: true,
        text,
        provider: 'whisper',
        model: 'Xenova/whisper-tiny.en',
      });
      return;
    } catch (whisperError) {
      console.error('Local Whisper transcription failed:', whisperError);
    }

    tempFolder = await mkdtemp(join(tmpdir(), 'friday-stt-'));
    const wavPath = join(tempFolder, 'speech.wav');
    await writeFile(wavPath, audioBuffer);

    const result = await runPowerShellJson(join(__dirname, 'electron', 'windows-transcribe-wav.ps1'), [wavPath]);
    if (!result?.ok) {
      res.status(500).json({
        ok: false,
        error: result?.error || 'Windows WAV transcription failed.',
      });
      return;
    }

    res.json({
      ok: true,
      text: String(result.text || '').trim(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Windows WAV transcription failed.',
    });
  } finally {
    if (tempFolder) {
      await rm(tempFolder, { recursive: true, force: true }).catch(() => {});
    }
  }
});

function wantsWeather(text) {
  return /\b(weather|temperature|forecast|rain|humidity|wind|climate)\b/i.test(text);
}

function wantsTime(text) {
  return /\b(time|date|day)\b/i.test(text);
}

function wantsCapabilities(text) {
  return /\b(what can you do|help|commands|capabilities|features)\b/i.test(text);
}

function wantsCasualReply(text) {
  return /^(?:hi|hello|hey|yo|sup|good morning|good afternoon|good evening)\b/i.test(text)
    || /\b(how are you|how are you doing|how's it going|how is it going|what's up|whats up)\b/i.test(text)
    || /\b(thank you|thanks|nice|cool|okay|ok)\b/i.test(text);
}

function wantsCompanyIdentity(text) {
  return /\b(founder|founded by|owner|ceo|director|who owns|who started|company founder)\b/i.test(text);
}

function cleanWeatherText(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .slice(0, 18)
    .join('\n');
}

async function getWeatherSummary(query = '') {
  const normalized = String(query || '').trim();
  const locationMatch = normalized.match(/\b(?:in|for|at|near)\s+([a-zA-Z\s,-]{2,60})$/i);
  const location = locationMatch?.[1]?.trim() || '';
  const target = location || '';
  const url = `https://wttr.in/${encodeURIComponent(target)}?format=j1`;

  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'friday-ai-local-assistant',
    },
  });

  if (!response.ok) {
    throw new Error(`Weather service returned ${response.status}.`);
  }

  const data = await response.json();
  const current = data?.current_condition?.[0];
  const area = data?.nearest_area?.[0];
  const city = area?.areaName?.[0]?.value || area?.region?.[0]?.value || (location || 'your area');
  const country = area?.country?.[0]?.value || '';
  const condition = current?.weatherDesc?.[0]?.value || 'conditions unavailable';
  const tempC = current?.temp_C;
  const feelsC = current?.FeelsLikeC;
  const humidity = current?.humidity;
  const windKmph = current?.windspeedKmph;
  const precipMm = current?.precipMM;

  return [
    `Weather for ${city}${country ? `, ${country}` : ''}: ${condition}.`,
    `Temperature: ${tempC} C, feels like ${feelsC} C.`,
    `Humidity: ${humidity}%. Wind: ${windKmph} km/h. Rain: ${precipMm} mm.`,
  ].join('\n');
}

async function getLocalBrainResponse(text) {
  const normalized = String(text || '').trim();
  const lower = normalized.toLowerCase();

  if (wantsCasualReply(normalized)) {
    if (/\b(thank you|thanks)\b/i.test(normalized)) return 'Anytime, Sir.';
    if (/^(?:hi|hello|hey|yo)\b/i.test(normalized)) return 'Hello, Sir. I am online.';
    return 'Doing well, Sir. Local systems are online.';
  }

  if (wantsCompanyIdentity(normalized) && /\bdp\s*vision|dpvision\b/i.test(normalized)) {
    return [
      'Public source check: DP Vision Analytics is listed with founder name "Mrs. Pooja".',
      'Source: https://www.dpvisionanalytics.in/about-us.htm',
      'I should not have stated Dnyaneshwar Pawar earlier. That was unverified.'
    ].join('\n');
  }

  if (wantsWeather(normalized)) {
    try {
      return await getWeatherSummary(normalized);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Weather lookup failed.';
      return `I could not fetch live weather directly right now: ${message}`;
    }
  }

  if (wantsTime(normalized)) {
    return `Current local time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
  }

  if (wantsCapabilities(normalized)) {
    return [
      'I can answer directly for local status, time, weather, app launching, folders, common web targets, planning, coding help, and safe Windows automation.',
      'For risky actions like deleting files, formatting drives, changing credentials, payments, or security-sensitive changes, I will ask before acting.',
    ].join('\n');
  }

  if (/\b(gemini|google ai)\b/i.test(lower)) {
    return gemini
      ? 'Gemini is temporarily enabled, but FRIDAY now prefers Ollama locally for general reasoning.'
      : 'Gemini is disabled by default. FRIDAY now uses Ollama locally for general reasoning when available.';
  }

  if (/\b(ollama|local model|local mind|llama)\b/i.test(lower)) {
    return `Ollama local mind is ${useOllama ? 'enabled' : 'disabled'}. Model: ${ollamaModel}.`;
  }

  return '';
}

function toOllamaMessages(messages, systemInstruction) {
  const converted = [];
  if (systemInstruction) {
    converted.push({ role: 'system', content: systemInstruction });
  }

  for (const message of messages) {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'system' ? 'system' : 'user';
    const content = String(message?.content || '').trim();
    if (content) converted.push({ role, content });
  }

  return converted;
}

async function generateOllamaResponse(messages, systemInstruction) {
  if (!useOllama) return null;

  const response = await fetchWithTimeout(`${ollamaBaseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      messages: toOllamaMessages(messages, systemInstruction),
      stream: false,
      keep_alive: '10m',
      options: {
        temperature: 0.35,
        num_ctx: 2048,
        num_predict: 160,
      },
    }),
  }, ollamaFetchTimeoutMs);

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const error = result?.error || response.statusText || 'Ollama request failed.';
    throw new Error(error);
  }

  return String(result?.message?.content || '').trim();
}

app.post('/api/weather', async (req, res) => {
  try {
    const query = String(req.body?.query || '');
    const text = await getWeatherSummary(query);
    res.json({ ok: true, text });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Weather lookup failed.',
    });
  }
});

app.post('/api/chat', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const latestUserMessage = [...messages].reverse().find(message => message?.role === 'user');
  const text = String(latestUserMessage?.content || '').trim();
  const systemInstruction = String(req.body?.systemInstruction || '').trim();

  if (!text) {
    res.status(400).json({
      ok: false,
      error: 'No user message received.',
    });
    return;
  }

  try {
    const localBrainResponse = await getLocalBrainResponse(text);
    if (localBrainResponse) {
      res.json({
        ok: true,
        text: localBrainResponse,
      });
      return;
    }

    const webSearch = await getWebContextForPrompt(text);
    if (webSearch.attempted && !webSearch.context && requiresVerifiedResearch(text)) {
      res.json({
        ok: true,
        text: [
          'I could not verify that from live search right now, so I will not guess.',
          webSearch.error ? `Search status: ${webSearch.error}` : 'Search status: no reliable results were returned.'
        ].join('\n'),
      });
      return;
    }

    const promptText = webSearch.context
      ? [
          text,
          '',
          `CURRENT DATE: ${new Date().toISOString().slice(0, 10)}`,
          'WEB SEARCH CONTEXT',
          'Verification rules:',
          '- For factual, founder, owner, CEO, director, company identity, legal, price, weather, current, latest, medical, financial, or source-backed questions: answer only from this web context.',
          '- If this web context does not verify the answer, say: "I could not verify that from the search results."',
          '- Do not use training memory, assumptions, or "internal records" for these facts.',
          '- Give the direct answer first, then include a short Sources section with the URLs you relied on.',
          webSearch.context,
        ].join('\n')
      : webSearch.attempted
        ? [
            text,
            '',
            `CURRENT DATE: ${new Date().toISOString().slice(0, 10)}`,
            `WEB SEARCH STATUS: unavailable. ${webSearch.error || 'No results were returned.'}`,
            'If the user asked for current, latest, or research-backed information, say that live web search is not available right now and do not invent current facts.'
          ].join('\n')
      : text;

    let geminiTried = false;
    let geminiError = '';
    let ollamaError = '';

    if (modelOrder[0] === 'gemini' && gemini) {
      geminiTried = true;
      try {
        const response = await gemini.models.generateContent({
          model: 'gemini-3-flash-preview',
          config: systemInstruction ? { systemInstruction } : undefined,
          contents: [{
            role: 'user',
            parts: [{ text: promptText }],
          }],
        });

        res.json({
          ok: true,
          text: response.text?.trim() || '',
          provider: 'gemini',
          model: 'gemini-3-flash-preview',
        });
        return;
      } catch (error) {
        console.error('Gemini primary chat error:', error);
        geminiError = error instanceof Error ? error.message : 'Gemini request failed.';
      }
    }

    try {
      const ollamaText = await generateOllamaResponse([
        ...messages.filter(message => message !== latestUserMessage),
        { role: 'user', content: promptText },
      ], systemInstruction);

      if (ollamaText) {
        res.json({
          ok: true,
          text: ollamaText,
          provider: 'ollama',
          model: ollamaModel,
        });
        return;
      }
    } catch (error) {
      console.error('Ollama chat error:', error);
      ollamaError = error instanceof Error ? error.message : 'Ollama request failed.';
      if (!gemini) {
        if (webSearch.context && requiresVerifiedResearch(text)) {
          res.json({
            ok: true,
            text: [
              'I found live search results, but the local model did not summarize them in time.',
              'Search results:',
              webSearch.context,
            ].join('\n\n'),
          });
          return;
        }

        res.json({
          ok: true,
          text: `Ollama local mind is enabled, but I could not reach it: ${error instanceof Error ? error.message : 'Unknown error'}. Start Ollama or temporarily enable Gemini.`,
        });
        return;
      }
    }

    if (!gemini || geminiTried) {
      if (webSearch.context && requiresVerifiedResearch(text)) {
        res.json({
          ok: true,
          text: [
            'I found live search results, but the local model did not summarize them.',
            'Search results:',
            webSearch.context,
          ].join('\n\n'),
        });
        return;
      }

      res.json({
        ok: true,
        text: [
          'Local FRIDAY tools are active, but no reasoning model answered.',
          ollamaError ? `Ollama status: ${ollamaError}` : '',
          geminiError ? `Gemini status: ${geminiError}` : '',
        ].filter(Boolean).join('\n'),
      });
      return;
    }

    const response = await gemini.models.generateContent({
      model: 'gemini-3-flash-preview',
      config: systemInstruction ? { systemInstruction } : undefined,
      contents: [{
        role: 'user',
        parts: [{ text: promptText }],
      }],
    });

    res.json({
      ok: true,
      text: response.text?.trim() || '',
    });
  } catch (error) {
    console.error('Gemini chat error:', error);
    let message = error instanceof Error ? error.message : 'Gemini chat failed.';

    try {
      const parsed = JSON.parse(message);
      message = parsed?.error?.message || message;
    } catch {
      // Keep the SDK message.
    }

    res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

function shouldUseWebSearch(text) {
  const normalized = text.toLowerCase();
  if (wantsCasualReply(normalized)) return false;
  return /\b(search|google|research|look up|lookup|find out|latest|current|currently|recent|news|price|weather|score|schedule|source|sources|citation|cite|verify)\b/.test(normalized)
    || /\b(today|tomorrow|yesterday)\b.*\b(news|weather|price|score|schedule|date|event|happened|happening)\b/.test(normalized)
    || /\b(lockdown|curfew|restriction|travel ban|shutdown)\b/.test(normalized)
    || /\b(who is|what is|when is|where is|how much|which|is there|are there)\b/.test(normalized);
}

function requiresVerifiedResearch(text) {
  const normalized = text.toLowerCase();
  if (wantsCasualReply(normalized)) return false;
  return /\b(search|google|research|look up|lookup|find out|latest|current|currently|recent|news|price|weather|score|schedule|source|sources|citation|cite|verify)\b/.test(normalized)
    || /\b(today|tomorrow|yesterday)\b.*\b(news|weather|price|score|schedule|date|event|happened|happening)\b/.test(normalized)
    || /\b(lockdown|curfew|restriction|travel ban|shutdown)\b/.test(normalized)
    || /\b(founder|owner|ceo|director|company|legal|medical|financial|identity)\b/.test(normalized)
    || /\b(who is|what is|when is|where is|how much|which|is there|are there)\b/.test(normalized);
}

function cleanResearchQuery(text) {
  return String(text || '')
    .replace(/^\s*(?:hey|hi|hello|yo|okay|ok)\s+friday\b[\s,.:;!?-]*/i, '')
    .replace(/^\s*friday\b[\s,.:;!?-]*/i, '')
    .replace(/\b(?:please|sir|boss)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSearchResult(item, index) {
  const title = String(item?.title || 'Untitled result').trim();
  const link = String(item?.link || '').trim();
  const snippet = String(item?.snippet || '').replace(/\s+/g, ' ').trim();
  return `${index + 1}. ${title}\nURL: ${link}\nSummary: ${snippet}`;
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
}

function stripHtml(value = '') {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchUrl(rawUrl = '') {
  const decoded = decodeHtmlEntities(rawUrl);
  const candidate = decoded.startsWith('//') ? `https:${decoded}` : decoded;
  try {
    const url = new URL(candidate);
    const nested = url.searchParams.get('uddg');
    return nested || candidate;
  } catch {
    return decoded;
  }
}

async function getFallbackSearchContext(text) {
  const query = cleanResearchQuery(text);
  const params = new URLSearchParams({ q: query });
  const response = await fetchWithTimeout(`https://html.duckduckgo.com/html/?${params.toString()}`, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 friday-ai-local-research',
    },
  });

  if (!response.ok) {
    throw new Error(`Fallback search returned ${response.status}.`);
  }

  const html = await response.text();
  const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) || [];
  const results = [];

  for (const block of blocks) {
    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const link = normalizeSearchUrl(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    const snippet = stripHtml(snippetMatch?.[1] || '');
    if (!link || !title) continue;

    results.push({ title, link, snippet });
    if (results.length >= 5) break;
  }

  return results.map(formatSearchResult).join('\n\n');
}

async function getWebContextForPrompt(text) {
  if (!shouldUseWebSearch(text)) return { attempted: false, context: '', error: '' };
  const query = cleanResearchQuery(text);
  if (!googleSearchApiKey || !googleSearchEngineId) {
    try {
      const fallbackContext = await getFallbackSearchContext(query);
      return {
        attempted: true,
        context: fallbackContext,
        error: fallbackContext ? '' : 'No fallback search results were returned.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fallback search failed.';
      return {
        attempted: true,
        context: '',
        error: `Google Search environment variables are missing. ${message}`,
      };
    }
  }

  const params = new URLSearchParams({
    key: googleSearchApiKey,
    cx: googleSearchEngineId,
    q: query,
    num: '8',
    safe: 'active',
  });

  try {
    const response = await fetchWithTimeout(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const error = result?.error?.message || response.statusText;
      console.error('Google Custom Search error:', error);
      try {
        const fallbackContext = await getFallbackSearchContext(text);
        return {
          attempted: true,
          context: fallbackContext,
          error: fallbackContext ? '' : error,
        };
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Fallback search failed.';
        return { attempted: true, context: '', error: `${error} Fallback search failed: ${fallbackMessage}` };
      }
    }

    const items = Array.isArray(result?.items) ? result.items : [];
    const context = items
      .filter(item => item?.link)
      .slice(0, 5)
      .map(formatSearchResult)
      .join('\n\n');

    return { attempted: true, context, error: '' };
  } catch (error) {
    console.error('Google Custom Search request failed:', error);
    const message = error instanceof Error ? error.message : 'Google Custom Search request failed.';
    return { attempted: true, context: '', error: message };
  }
}

const userProfile = process.env.USERPROFILE || process.env.HOME || '';
const operaGxCandidates = [
  join(userProfile, 'AppData', 'Local', 'Programs', 'Opera GX', 'launcher.exe'),
  join(userProfile, 'AppData', 'Local', 'Programs', 'Opera GX', 'opera.exe'),
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Opera GX', 'launcher.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Opera GX', 'launcher.exe'),
];
const operaGxExecutable = operaGxCandidates.find(path => existsSync(path));
const chromeCandidates = [
  join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const chromeExecutable = chromeCandidates.find(path => existsSync(path));
const chromeTarget = chromeExecutable
  ? { command: chromeExecutable }
  : { command: 'cmd.exe', args: ['/c', 'start', '', 'chrome'] };
const localTargets = {
  'opera gx': operaGxExecutable
    ? { command: operaGxExecutable }
    : { command: 'cmd.exe', args: ['/c', 'start', '', 'opera'] },
  opera: operaGxExecutable
    ? { command: operaGxExecutable }
    : { command: 'cmd.exe', args: ['/c', 'start', '', 'opera'] },
  'google chrome': chromeTarget,
  'chrome browser': chromeTarget,
  chrome: chromeTarget,
  'cross browser': chromeTarget,
  cross: chromeTarget,
  notepad: { command: 'notepad.exe' },
  calculator: { command: 'calc.exe' },
  camera: { command: 'cmd.exe', args: ['/c', 'start', '', 'microsoft.windows.camera:'] },
  'microphone settings': { command: 'cmd.exe', args: ['/c', 'start', '', 'ms-settings:privacy-microphone'] },
  'mic settings': { command: 'cmd.exe', args: ['/c', 'start', '', 'ms-settings:privacy-microphone'] },
  'speech settings': { command: 'cmd.exe', args: ['/c', 'start', '', 'ms-settings:speech'] },
  'language settings': { command: 'cmd.exe', args: ['/c', 'start', '', 'ms-settings:regionlanguage'] },
  'sound settings': { command: 'cmd.exe', args: ['/c', 'start', '', 'ms-settings:sound'] },
  'voice training': { command: 'control.exe', args: ['/name', 'Microsoft.SpeechRecognition'] },
  'speech recognition': { command: 'control.exe', args: ['/name', 'Microsoft.SpeechRecognition'] },
  explorer: { command: 'explorer.exe' },
  files: { command: 'explorer.exe' },
  downloads: { command: 'explorer.exe', args: [join(userProfile, 'Downloads')] },
  documents: { command: 'explorer.exe', args: [join(userProfile, 'Documents')] },
  desktop: { command: 'explorer.exe', args: [join(userProfile, 'Desktop')] },
  pictures: { command: 'explorer.exe', args: [join(userProfile, 'Pictures')] },
  music: { command: 'explorer.exe', args: [join(userProfile, 'Music')] },
  videos: { command: 'explorer.exe', args: [join(userProfile, 'Videos')] },
  vscode: { command: 'cmd.exe', args: ['/c', 'start', '', 'code'] },
  'vs code': { command: 'cmd.exe', args: ['/c', 'start', '', 'code'] },
};

const browserTargets = {
  'opera gx': localTargets['opera gx'],
  opera: localTargets.opera,
  'google chrome': localTargets['google chrome'],
  'chrome browser': localTargets['chrome browser'],
  chrome: localTargets.chrome,
};

const closeTargets = {
  'opera gx': ['opera.exe', 'launcher.exe'],
  opera: ['opera.exe', 'launcher.exe'],
  'google chrome': ['chrome.exe'],
  'chrome browser': ['chrome.exe'],
  chrome: ['chrome.exe'],
  notepad: ['notepad.exe'],
  calculator: ['calculator.exe', 'calc.exe'],
  vscode: ['Code.exe'],
  'vs code': ['Code.exe'],
};

const desktopActions = {
  'lock screen': {
    patterns: [/\block (?:my |the )?(?:screen|pc|computer|workstation)\b/i, /\block\b/i],
    message: 'Enjoy your break. I’ll lock things up for you.',
    command: 'rundll32.exe',
    args: ['user32.dll,LockWorkStation'],
    delayMs: 1800,
  },
  'open task manager': {
    patterns: [/\b(task manager|taskmgr)\b/i],
    message: 'Opening Task Manager.',
    command: 'taskmgr.exe',
    args: [],
  },
  battery: {
    patterns: [/\b(battery|power level|charge|battery life)\b/i],
    handler: getBatteryStatus,
  },
};

let lastDesktopTarget = '';

function normalizeCommandText(rawTarget = '') {
  return String(rawTarget)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTargetPhrase(command, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(command);
}

function findTarget(rawTarget, targets) {
  const target = normalizeCommandText(rawTarget);
  return Object.entries(targets)
    .sort(([a], [b]) => b.length - a.length)
    .find(([name]) => hasTargetPhrase(target, name));
}

function resolveOpenTarget(rawTarget = '') {
  const target = normalizeCommandText(rawTarget);
  const explicitX = /(?:^|\s)(?:open|launch|start)\s+x(?:\s|$)/.test(target);
  if (explicitX) return { name: 'x', url: 'https://x.com/' };

  const match = findTarget(rawTarget, openTargets);
  return match ? { name: match[0], url: match[1] } : null;
}

function resolveBrowserUrlTarget(rawTarget = '') {
  const siteMatch = findTarget(rawTarget, openTargets);
  const browserMatch = findTarget(rawTarget, browserTargets);
  if (!siteMatch || !browserMatch) return null;
  if (siteMatch[0] === browserMatch[0]) return null;
  return {
    siteName: siteMatch[0],
    browserName: browserMatch[0],
    url: siteMatch[1],
    browser: browserMatch[1],
  };
}

function extractSearchQuery(rawTarget = '') {
  const text = String(rawTarget || '').trim();
  const patterns = [
    /\b(?:open|launch|start)\s+(?:google|browser|chrome|opera gx|opera)\b.*?\bsearch(?:\s+(?:for|about))?\s+(.+)$/i,
    /\bsearch\s+(?:in|on|with|using)\s+(?:google|browser|chrome|opera gx|opera)(?:\s+(?:for|about))?\s+(.+)$/i,
    /\bsearch(?:\s+(?:google|the web))?(?:\s+(?:for|about))?\s+(.+)$/i,
    /\bgoogle(?:\s+(?:search|for))?\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const query = match?.[1]
      ?.replace(/\b(?:now|please|on google|in google|on my browser|in my browser)\b/gi, ' ')
      .replace(/^(?:for|about)\s+/i, '')
      .replace(/[,\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (query) return query;
  }

  return '';
}

function resolveLocalTarget(rawTarget = '') {
  const match = findTarget(rawTarget, localTargets);
  return match ? { name: match[0], target: match[1] } : null;
}

function resolveCloseTarget(rawTarget = '') {
  const normalized = normalizeCommandText(rawTarget);
  if (/\b(it|that|last app|last window)\b/.test(normalized) && lastDesktopTarget && closeTargets[lastDesktopTarget]) {
    return { name: lastDesktopTarget, processes: closeTargets[lastDesktopTarget] };
  }

  const match = findTarget(rawTarget, closeTargets);
  return match ? { name: match[0], processes: match[1] } : null;
}

function openUrl(url) {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }

  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function openLocalTarget(target) {
  spawn(target.command, target.args || [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function openBrowserUrl(browser, url) {
  const args = browser.args
    ? [...browser.args, url]
    : [url];
  spawn(browser.command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function resolveUserPath(rawPath = '') {
  const cleaned = String(rawPath || '')
    .replace(/^["']|["']$/g, '')
    .replace(/^~(?=\\|\/|$)/, userProfile)
    .trim();
  if (!cleaned) return null;

  const resolvedPath = resolve(cleaned);
  const safeRoots = [
    resolve(userProfile),
    resolve(join(userProfile, 'Desktop')),
    resolve(join(userProfile, 'Downloads')),
    resolve(join(userProfile, 'Documents')),
    resolve(join(userProfile, 'Pictures')),
    resolve(join(userProfile, 'Music')),
    resolve(join(userProfile, 'Videos')),
  ];

  const isSafe = safeRoots.some(root => resolvedPath === root || resolvedPath.startsWith(`${root}\\`));
  if (!isSafe || !existsSync(resolvedPath)) return null;
  return resolvedPath;
}

function extractPathRequest(rawTarget = '') {
  return String(rawTarget || '')
    .replace(/^\s*(?:open|launch|start)\s+(?:file|folder|path)?\s*/i, '')
    .trim();
}

function closeLocalTarget(processes) {
  for (const processName of processes) {
    spawn('taskkill.exe', ['/IM', processName, '/T'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  }
}

function resolveDesktopAction(rawTarget = '') {
  const target = String(rawTarget || '');
  return Object.entries(desktopActions)
    .find(([, action]) => action.patterns.some(pattern => pattern.test(target)));
}

function runDesktopAction(action) {
  const run = () => {
    spawn(action.command, action.args || [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  };

  if (action.delayMs) {
    setTimeout(run, action.delayMs);
    return;
  }

  run();
}

function runPowerShellCommand(command, args = []) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command, ...args], {
      cwd: __dirname,
      windowsHide: true,
      timeout: 12000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr || error.message));
        return;
      }

      resolvePromise(stdout.trim());
    });
  });
}

async function getBatteryStatus() {
  const output = await runPowerShellJson(join(__dirname, 'electron', 'windows-battery-status.ps1'));
  return output || 'Battery status is unavailable right now.';
}

app.post('/api/desktop/action', async (req, res) => {
  if (!canUseDesktopBridge) {
    res.status(503).json({
      ok: false,
      desktopBridge: false,
      message: 'Local desktop bridge is not available from this hosted server.',
    });
    return;
  }

  const resolved = resolveDesktopAction(req.body?.target);

  if (!resolved) {
    res.status(400).json({
      ok: false,
      message: `I can perform: ${Object.keys(desktopActions).join(', ')}.`,
    });
    return;
  }

  const [name, action] = resolved;
  if (action.handler) {
    try {
      const message = await action.handler(req.body?.target);
      res.json({
        ok: true,
        desktopBridge: true,
        name,
        message,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        desktopBridge: true,
        name,
        message: error instanceof Error ? error.message : 'Desktop action failed.',
      });
    }
    return;
  }

  runDesktopAction(action);
  res.json({
    ok: true,
    desktopBridge: true,
    name,
    message: action.message,
  });
});

app.post('/api/desktop/open', (req, res) => {
  const rawTarget = req.body?.target;
  const searchQuery = extractSearchQuery(rawTarget);

  if (searchQuery) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
    if (canUseDesktopBridge) openUrl(url);
    lastDesktopTarget = 'google';
    res.json({
      ok: true,
      desktopBridge: canUseDesktopBridge,
      clientOpen: !canUseDesktopBridge,
      name: 'google search',
      url,
      message: `Searching Google for ${searchQuery}.`,
    });
    return;
  }

  const browserUrlTarget = resolveBrowserUrlTarget(rawTarget);

  if (browserUrlTarget) {
    if (!canUseDesktopBridge) {
      res.status(503).json({
        ok: false,
        desktopBridge: false,
        message: 'Local desktop bridge is not available from this hosted server. Keep Friday running on your Windows desktop to control local browsers.',
      });
      return;
    }

    openBrowserUrl(browserUrlTarget.browser, browserUrlTarget.url);
    lastDesktopTarget = browserUrlTarget.browserName;
    res.json({
      ok: true,
      desktopBridge: true,
      name: `${browserUrlTarget.siteName} on ${browserUrlTarget.browserName}`,
      url: browserUrlTarget.url,
      message: `Opening ${browserUrlTarget.siteName} on ${browserUrlTarget.browserName}.`,
    });
    return;
  }

  const requestedPath = resolveUserPath(extractPathRequest(rawTarget));

  if (requestedPath) {
    if (!canUseDesktopBridge) {
      res.status(503).json({
        ok: false,
        desktopBridge: false,
        message: 'Local desktop bridge is not available from this hosted server.',
      });
      return;
    }

    openLocalTarget({ command: 'explorer.exe', args: [requestedPath] });
    lastDesktopTarget = requestedPath;
    res.json({
      ok: true,
      desktopBridge: true,
      name: requestedPath,
      message: `Opening ${requestedPath}.`,
    });
    return;
  }

  const resolvedLocal = resolveLocalTarget(rawTarget);

  if (resolvedLocal) {
    if (!canUseDesktopBridge) {
      res.status(503).json({
        ok: false,
        desktopBridge: false,
        message: 'Local desktop bridge is not available from this hosted server. Keep FRIDAY running on your Windows desktop to open apps and folders.',
      });
      return;
    }

    openLocalTarget(resolvedLocal.target);
    lastDesktopTarget = resolvedLocal.name;
    res.json({
      ok: true,
      desktopBridge: true,
      name: resolvedLocal.name,
      message: `Opening ${resolvedLocal.name}.`,
    });
    return;
  }

  const resolved = resolveOpenTarget(rawTarget);

  if (!resolved) {
    res.status(400).json({
      ok: false,
      message: `I can open: ${[...Object.keys(openTargets), ...Object.keys(localTargets)].join(', ')}.`,
    });
    return;
  }

  if (canUseDesktopBridge) openUrl(resolved.url);
  lastDesktopTarget = resolved.name;
  res.json({
    ok: true,
    desktopBridge: canUseDesktopBridge,
    clientOpen: !canUseDesktopBridge,
    name: resolved.name,
    url: resolved.url,
    message: `Opening ${resolved.name}.`,
  });
});

app.post('/api/desktop/close', (req, res) => {
  if (!canUseDesktopBridge) {
    res.status(503).json({
      ok: false,
      desktopBridge: false,
      message: 'Local desktop bridge is not available from this hosted server.',
    });
    return;
  }

  const resolved = resolveCloseTarget(req.body?.target);

  if (!resolved) {
    res.status(400).json({
      ok: false,
      message: `I can close: ${Object.keys(closeTargets).join(', ')}.`,
    });
    return;
  }

  closeLocalTarget(resolved.processes);
  res.json({
    ok: true,
    desktopBridge: true,
    name: resolved.name,
    message: `Closing ${resolved.name}.`,
  });
});

if (process.env.NODE_ENV === 'production' && existsSync(resolve(__dirname, 'dist'))) {
  app.use(express.static(resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`FRIDAY online: http://${host}:${port}`);
});
