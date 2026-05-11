import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Terminal as TerminalIcon,
  Cpu,
  Shield,
  Zap,
  X,
  Minus,
  Square,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  SlidersHorizontal,
  Hand,
  Ear,
} from 'lucide-react';
import { Message } from '../types';
import { TerminalMessage } from './TerminalMessage';
import { getLastTranscriptionError, streamFridayResponse, transcribeAudioCommand } from '../services/ai';

type SpeechMode = 'browser' | 'gemini';
type LocalCommandResult = string | null;
type DesktopOpenResult = {
  ok: boolean;
  desktopBridge?: boolean;
  clientOpen?: boolean;
  message?: string;
  url?: string;
};
const MAX_GEMINI_RECORDING_MS = 9000;
const WAKE_PHRASE_RECORDING_MS = 3500;
const CONVERSATION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const AUTO_SPEECH_START_RMS = 10;
const AUTO_SPEECH_STOP_RMS = 7;
const AUTO_SPEECH_ABOVE_NOISE_RMS = 7;
const AUTO_SILENCE_STOP_MS = 900;
const AUTO_RECORD_COOLDOWN_MS = 1200;
const MIN_AUTO_RECORDING_MS = 900;

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorLike {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
    fridayDesktop?: {
      showWindow: () => void;
    };
  }
}

export const Terminal: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'initial',
      role: 'friday',
      content: 'FRIDAY online. Systems ready, Sir.',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [wakeMode, setWakeMode] = useState(true);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('Voice idle');
  const [micLevel, setMicLevel] = useState(0);
  const [speechMode, setSpeechMode] = useState<SpeechMode>('browser');
  const [isRecording, setIsRecording] = useState(false);
  const [isWakePhraseRecording, setIsWakePhraseRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [clapWakeEnabled, setClapWakeEnabled] = useState(() => localStorage.getItem('friday.clapWake') !== 'false');
  const [isClapArmed, setIsClapArmed] = useState(false);
  const [clapDebug, setClapDebug] = useState({ peak: 0, rms: 0 });
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(() => localStorage.getItem('friday.handsFree') !== 'false');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => localStorage.getItem('friday.voiceURI') || '');
  const [voiceRate, setVoiceRate] = useState(() => Number(localStorage.getItem('friday.voiceRate') || '0.94'));
  const [voicePitch, setVoicePitch] = useState(() => Number(localStorage.getItem('friday.voicePitch') || '1.06'));
  const [showVoiceControls, setShowVoiceControls] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const clapArmTimerRef = useRef<number | null>(null);
  const conversationIdleTimerRef = useRef<number | null>(null);
  const lastAudioDebugAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const shouldListenRef = useRef(false);
  const processingRef = useRef(false);
  const wakeModeRef = useRef(true);
  const speechModeRef = useRef<SpeechMode>('browser');
  const clapWakeEnabledRef = useRef(clapWakeEnabled);
  const conversationActiveRef = useRef(false);
  const isClapArmedRef = useRef(false);
  const isRecordingRef = useRef(false);
  const isTranscribingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const voiceDetectedInRecordingRef = useRef(false);
  const silenceStartedAtRef = useRef(0);
  const autoRecordCooldownUntilRef = useRef(0);
  const ambientRmsRef = useRef(0);
  const isWakePhraseRecordingRef = useRef(false);
  const recognitionRestartTimerRef = useRef<number | null>(null);
  const recognitionRestartAttemptsRef = useRef(0);
  const speechResumeTimerRef = useRef<number | null>(null);
  const speechEndFallbackTimerRef = useRef<number | null>(null);
  const assistantSpeakingRef = useRef(false);
  const speechSuppressionUntilRef = useRef(0);
  const lastMicFailureRef = useRef({ name: '', at: 0 });
  const startWakePhraseRecordingRef = useRef<() => void>(() => {});
  const startHandsFreeRecordingRef = useRef<() => void>(() => {});
  const stopHandsFreeRecordingRef = useRef<() => void>(() => {});

  const speechSupported = useMemo(() => {
    return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }, []);

  const micSupported = useMemo(() => {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    processingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    isWakePhraseRecordingRef.current = isWakePhraseRecording;
  }, [isWakePhraseRecording]);

  useEffect(() => {
    isTranscribingRef.current = isTranscribing;
  }, [isTranscribing]);

  useEffect(() => {
    wakeModeRef.current = wakeMode;
  }, [wakeMode]);

  useEffect(() => {
    speechModeRef.current = speechMode;
  }, [speechMode]);

  useEffect(() => {
    clapWakeEnabledRef.current = clapWakeEnabled;
  }, [clapWakeEnabled]);

  useEffect(() => {
    conversationActiveRef.current = isConversationActive;
  }, [isConversationActive]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);

      if (!selectedVoiceURI && voices.length > 0) {
          const preferredVoice = voices.find(voice => /jenny|aria|sara|samantha|zira|hazel|susan|female|natural|online/i.test(voice.name))
            || voices.find(voice => voice.lang.toLowerCase().startsWith('en'))
            || voices[0];
          setSelectedVoiceURI(preferredVoice.voiceURI || preferredVoice.name);
        }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [selectedVoiceURI]);

  useEffect(() => {
    localStorage.setItem('friday.voiceURI', selectedVoiceURI);
  }, [selectedVoiceURI]);

  useEffect(() => {
    localStorage.setItem('friday.voiceRate', String(voiceRate));
  }, [voiceRate]);

  useEffect(() => {
    localStorage.setItem('friday.voicePitch', String(voicePitch));
  }, [voicePitch]);

  useEffect(() => {
    localStorage.setItem('friday.clapWake', String(clapWakeEnabled));
  }, [clapWakeEnabled]);

  useEffect(() => {
    localStorage.setItem('friday.handsFree', String(handsFreeEnabled));
  }, [handsFreeEnabled]);

  const restartRecognitionWhenReady = useCallback((delay = 0) => {
    if (speechResumeTimerRef.current) {
      window.clearTimeout(speechResumeTimerRef.current);
      speechResumeTimerRef.current = null;
    }

    speechResumeTimerRef.current = window.setTimeout(() => {
      speechResumeTimerRef.current = null;

      if (!shouldListenRef.current || processingRef.current || isRecordingRef.current || isTranscribingRef.current) return;

      const now = performance.now();
      if (assistantSpeakingRef.current || now < speechSuppressionUntilRef.current) {
        restartRecognitionWhenReady(Math.max(250, speechSuppressionUntilRef.current - now));
        return;
      }

      try {
        recognitionRestartAttemptsRef.current = 0;
        recognitionRef.current?.start();
        setVoiceStatus(wakeModeRef.current ? 'Listening for "Friday"' : 'Listening');
      } catch {
        setVoiceStatus('Voice engine restarting');
        restartRecognitionWhenReady(500);
      }
    }, delay);
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !('speechSynthesis' in window) || !text.trim()) return;

    if (speechResumeTimerRef.current) {
      window.clearTimeout(speechResumeTimerRef.current);
      speechResumeTimerRef.current = null;
    }

    if (speechEndFallbackTimerRef.current) {
      window.clearTimeout(speechEndFallbackTimerRef.current);
      speechEndFallbackTimerRef.current = null;
    }

    window.speechSynthesis.cancel();
    assistantSpeakingRef.current = true;

    try {
      recognitionRef.current?.stop();
    } catch {
      // Recognition may already be stopped by the browser.
    }

    const cleanText = text
      .replace(/\[[^\]]+\]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) {
      assistantSpeakingRef.current = false;
      speechSuppressionUntilRef.current = performance.now() + 300;
      restartRecognitionWhenReady(300);
      return;
    }

    const estimatedSpeechMs = Math.min(12000, Math.max(1500, cleanText.length * 55));
    speechSuppressionUntilRef.current = performance.now() + estimatedSpeechMs + 900;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = voiceRate;
    utterance.pitch = voicePitch;
    utterance.volume = 1;

    const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(voice => (voice.voiceURI || voice.name) === selectedVoiceURI)
      || voices.find(voice => /jenny|aria|sara|samantha|zira|hazel|susan|female|natural|online/i.test(voice.name));
    if (selectedVoice) utterance.voice = selectedVoice;

    const resumeAfterSpeech = () => {
      if (!assistantSpeakingRef.current) return;
      if (speechEndFallbackTimerRef.current) {
        window.clearTimeout(speechEndFallbackTimerRef.current);
        speechEndFallbackTimerRef.current = null;
      }

      assistantSpeakingRef.current = false;
      speechSuppressionUntilRef.current = performance.now() + 700;
      restartRecognitionWhenReady(700);
    };

    utterance.onend = resumeAfterSpeech;
    utterance.onerror = resumeAfterSpeech;
    speechEndFallbackTimerRef.current = window.setTimeout(resumeAfterSpeech, estimatedSpeechMs + 1200);
    window.speechSynthesis.speak(utterance);
  }, [availableVoices, restartRecognitionWhenReady, selectedVoiceURI, voiceEnabled, voicePitch, voiceRate]);

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'system',
      content,
      timestamp: new Date()
    }]);
  }, []);

  const stopMicMeter = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (clapArmTimerRef.current) {
      window.clearTimeout(clapArmTimerRef.current);
      clapArmTimerRef.current = null;
    }

    if (conversationIdleTimerRef.current) {
      window.clearTimeout(conversationIdleTimerRef.current);
      conversationIdleTimerRef.current = null;
    }

    if (recognitionRestartTimerRef.current) {
      window.clearTimeout(recognitionRestartTimerRef.current);
      recognitionRestartTimerRef.current = null;
    }
    recognitionRestartAttemptsRef.current = 0;

    if (speechResumeTimerRef.current) {
      window.clearTimeout(speechResumeTimerRef.current);
      speechResumeTimerRef.current = null;
    }

    if (speechEndFallbackTimerRef.current) {
      window.clearTimeout(speechEndFallbackTimerRef.current);
      speechEndFallbackTimerRef.current = null;
    }

    assistantSpeakingRef.current = false;
    speechSuppressionUntilRef.current = 0;

    recorderRef.current = null;
    recordingChunksRef.current = [];

    if (meterFrameRef.current) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    if (audioContextRef.current?.state !== 'closed') {
      void audioContextRef.current?.close();
    }
    audioContextRef.current = null;
    setMicLevel(0);
    setClapDebug({ peak: 0, rms: 0 });
    setRecordingSeconds(0);
    setIsWakePhraseRecording(false);
    isWakePhraseRecordingRef.current = false;
    ambientRmsRef.current = 0;
    setIsClapArmed(false);
    setIsConversationActive(false);
  }, []);

  const startMicMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceStatus('Microphone API unavailable');
      return false;
    }

    try {
      stopMicMeter();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        setVoiceStatus('Microphone granted; audio meter unavailable');
        mediaStreamRef.current = stream;
        return true;
      }

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const samples = new Uint8Array(analyser.fftSize);

      analyser.fftSize = 512;
      source.connect(analyser);
      mediaStreamRef.current = stream;
      audioContextRef.current = audioContext;

      const updateMeter = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        let peak = 0;

        for (const sample of samples) {
          const centered = sample - 128;
          sum += centered * centered;
          peak = Math.max(peak, Math.abs(centered));
        }

        const rms = Math.sqrt(sum / samples.length);
        const previousAmbient = ambientRmsRef.current || rms;
        const isBusyWithVoice =
          isRecordingRef.current
          || isTranscribingRef.current
          || processingRef.current
          || (('speechSynthesis' in window) && window.speechSynthesis.speaking);
        const shouldTrackAmbient =
          !isBusyWithVoice
          && (!isClapArmedRef.current || rms < previousAmbient + AUTO_SPEECH_ABOVE_NOISE_RMS);

        if (shouldTrackAmbient) {
          ambientRmsRef.current = previousAmbient * 0.96 + rms * 0.04;
        }

        const ambientRms = ambientRmsRef.current || rms;
        const speechStartRms = Math.max(AUTO_SPEECH_START_RMS, ambientRms + AUTO_SPEECH_ABOVE_NOISE_RMS);
        const speechStopRms = Math.max(AUTO_SPEECH_STOP_RMS, ambientRms + 2);
        const relativeRms = Math.max(0, rms - Math.max(0, ambientRms - 2));
        setMicLevel(Math.min(100, Math.round(relativeRms * 7)));

        const now = performance.now();
        if (isClapArmedRef.current && now - lastAudioDebugAtRef.current > 180) {
          lastAudioDebugAtRef.current = now;
          setClapDebug({ peak: Math.round(peak), rms: Math.round(rms) });
        }

        if (
          clapWakeEnabledRef.current
          && isClapArmedRef.current
          && speechModeRef.current === 'gemini'
          && !isRecordingRef.current
          && !isTranscribingRef.current
          && !processingRef.current
          && now > autoRecordCooldownUntilRef.current
          && !isBusyWithVoice
          && rms > speechStartRms
        ) {
          autoRecordCooldownUntilRef.current = now + WAKE_PHRASE_RECORDING_MS + 900;
          setVoiceStatus('Checking wake phrase');
          startWakePhraseRecordingRef.current();
        }

        if (
          handsFreeEnabled
          && conversationActiveRef.current
          && !isClapArmedRef.current
          && !isRecordingRef.current
          && !isTranscribingRef.current
          && !processingRef.current
          && now > autoRecordCooldownUntilRef.current
          && !isBusyWithVoice
          && rms > speechStartRms
        ) {
          setVoiceStatus('Speech detected');
          startHandsFreeRecordingRef.current();
        }

        if (isRecordingRef.current) {
          const elapsed = now - recordingStartedAtRef.current;

          if (rms > speechStartRms) {
            voiceDetectedInRecordingRef.current = true;
            silenceStartedAtRef.current = 0;
          } else if (
            voiceDetectedInRecordingRef.current
            && elapsed > MIN_AUTO_RECORDING_MS
            && rms < speechStopRms
          ) {
            if (!silenceStartedAtRef.current) silenceStartedAtRef.current = now;
            if (now - silenceStartedAtRef.current > AUTO_SILENCE_STOP_MS) {
              stopHandsFreeRecordingRef.current();
            }
          }
        }

        meterFrameRef.current = window.requestAnimationFrame(updateMeter);
      };

      updateMeter();
      return true;
    } catch (error) {
      const name = error instanceof DOMException ? error.name : 'unknown';
      const micErrorHelp: Record<string, string> = {
        NotFoundError: 'No microphone device was found. Check Windows Settings > System > Sound > Input, connect or enable a microphone, then reload this tab.',
        DevicesNotFoundError: 'No microphone device was found. Check Windows Settings > System > Sound > Input, connect or enable a microphone, then reload this tab.',
        NotAllowedError: 'Microphone permission is blocked. Allow microphone access from the browser address bar, then press the mic button again.',
        SecurityError: 'Microphone access is blocked for this page. Allow microphone access in the browser site settings, then reload.',
        NotReadableError: 'The microphone is busy or unavailable. Close other apps using the mic, then try again.',
        TrackStartError: 'The microphone is busy or unavailable. Close other apps using the mic, then try again.',
        OverconstrainedError: 'The selected microphone does not support the requested audio settings. Try a different input device.',
      };
      const help = micErrorHelp[name] || `Browser returned: ${name}`;
      const now = Date.now();

      shouldListenRef.current = false;
      setIsListening(false);
      setIsClapArmed(false);
      isClapArmedRef.current = false;
      setVoiceStatus(name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'No microphone found' : `Microphone error: ${name}`);

      if (lastMicFailureRef.current.name !== name || now - lastMicFailureRef.current.at > 10000) {
        lastMicFailureRef.current = { name, at: now };
        addSystemMessage(`MICROPHONE CHECK FAILED\n${help}`);
      }

      return false;
    }
  }, [addSystemMessage, handsFreeEnabled, stopMicMeter]);

  const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Audio conversion failed'));
        return;
      }
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  const endConversation = useCallback((status = 'Wake phrase idle') => {
    conversationActiveRef.current = false;
    setIsConversationActive(false);
    setIsClapArmed(false);
    isClapArmedRef.current = false;
    setVoiceStatus(status);
    stopMicMeter();
  }, [stopMicMeter]);

  const refreshConversationIdleTimer = useCallback(() => {
    if (conversationIdleTimerRef.current) {
      window.clearTimeout(conversationIdleTimerRef.current);
      conversationIdleTimerRef.current = null;
    }

    conversationIdleTimerRef.current = window.setTimeout(() => {
      endConversation('Conversation timed out');
    }, CONVERSATION_IDLE_TIMEOUT_MS);
  }, [endConversation]);

  const stripWakePhrase = useCallback((text: string) => {
    const cleaned = normalizeVoiceCommand(text);
    if (!wakeModeRef.current || conversationActiveRef.current) return cleaned;

    const normalized = cleaned.toLowerCase();
    const wakeIndex = normalized.indexOf('friday');
    if (wakeIndex === -1) return '';

    return cleaned.slice(wakeIndex + 'friday'.length).trim();
  }, []);

  const postDesktopOpen = async (endpoint: string, command: string) => {
    const response = await fetch(`${endpoint}/api/desktop/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: command }),
    });
    return await response.json() as DesktopOpenResult;
  };

  const runDesktopOpenCommand = useCallback(async (command: string) => {
    const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    try {
      const result = await postDesktopOpen('', command);

      if (result.ok && result.clientOpen && result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
        return result.message || 'Opening requested target.';
      }

      if (result.ok) return result.message || 'Opening requested target.';

      if (!isLocalPage && result.desktopBridge === false) {
        const localResult = await postDesktopOpen('http://127.0.0.1:3000', command);
        if (localResult.ok && localResult.clientOpen && localResult.url) {
          window.open(localResult.url, '_blank', 'noopener,noreferrer');
        }
        return localResult.message || (localResult.ok ? 'Opening requested target.' : 'Desktop command failed.');
      }

      return result.message || (result.ok ? 'Opening requested target.' : 'Desktop command failed.');
    } catch {
      if (!isLocalPage) {
        try {
          const localResult = await postDesktopOpen('http://127.0.0.1:3000', command);
          if (localResult.ok && localResult.clientOpen && localResult.url) {
            window.open(localResult.url, '_blank', 'noopener,noreferrer');
          }
          return localResult.message || (localResult.ok ? 'Opening requested target.' : 'Desktop command failed.');
        } catch {
          return 'Local desktop bridge offline. Keep FRIDAY running on this Windows PC, then try again.';
        }
      }

      return 'Desktop bridge offline. Start FRIDAY with npm run dev so I can control approved desktop actions.';
    }
  }, []);

  const handleLocalCommand = useCallback((cmd: string): LocalCommandResult => {
    if (cmd === 'clear' || cmd === 'cls') {
      setMessages([]);
      return 'Terminal cleared.';
    }

    if (cmd === 'time') {
      return `Current Internal Time: ${new Date().toLocaleString()}`;
    }

    if (cmd === 'help') {
      return `AVAILABLE SYSTEM COMMANDS:\n- open instagram/youtube/google/gmail/whatsapp/chatgpt/github: Open site in browser\n- open notepad/calculator/camera/settings/explorer/downloads/documents/desktop/vscode: Open approved local apps and folders\n- clear/cls: Clear the terminal screen\n- time: Display system clock\n- help: Show this menu\n- status: Diagnostic overview\n- listen: Enable voice input\n- stop listening: Disable voice input\n- sleep/stand down/go idle: End active conversation\n- mute/unmute: Toggle spoken responses\n\nVoice: Hand icon controls the "Friday wake up" wake phrase. Ear icon controls hands-free follow-up. With both on, FRIDAY can wake from standby, answer, and keep listening until sleep or timeout.`;
    }

    if (cmd === 'status' || cmd === 'system checks' || cmd === 'do system checks' || cmd.includes('do system checks')) {
      return `SYSTEM DIAGNOSTICS [OK]\nCORE TEMPERATURE: 38 C\nMEMORY USAGE: 2.1GB / 64GB\nNETWORK: SECURE_LINK_PRO\nAI MODEL: GEMINI_FLASH_3.0\nVOICE INPUT: ${speechSupported ? 'AVAILABLE' : 'UNSUPPORTED'}\nAUDIO OUTPUT: ${'speechSynthesis' in window ? 'AVAILABLE' : 'UNSUPPORTED'}\nINTEGRITY: 100%`;
    }

    if (cmd === 'listen') {
      setIsListening(true);
      return 'Voice input enabled.';
    }

    if (cmd === 'stop listening') {
      setIsListening(false);
      endConversation('Voice input disabled.');
      return 'Voice input disabled.';
    }

    if (cmd === 'sleep' || cmd === 'stand down' || cmd === 'go idle') {
      endConversation('Conversation idle.');
      return 'Standing down. Say Friday wake up when you need me again.';
    }

    if (cmd === 'mute') {
      setVoiceEnabled(false);
      return 'Spoken responses muted.';
    }

    if (cmd === 'unmute') {
      setVoiceEnabled(true);
      return 'Spoken responses restored.';
    }

    return null;
  }, [endConversation, speechSupported]);

  const normalizeVoiceCommand = (rawText: string) => rawText.replace(/[^\p{L}\p{N}\s?!.,"'-]/gu, '').trim();
  const stripAssistantEcho = (rawText: string) => {
    let cleaned = normalizeVoiceCommand(rawText);
    cleaned = cleaned.replace(/^error:?\s*connection lost\.?\s*systems failing,?\s*sir\.?\s*/i, '');
    cleaned = cleaned.replace(/^please check your connectivity\.?\s*/i, '');
    cleaned = cleaned.replace(/^i cannot reach the friday server right now\.?\s*/i, '');
    cleaned = cleaned.replace(/^i cannot reach the gemini server right now:?\s*/i, '');
    return cleaned.trim();
  };
  const hasCommandText = (rawText: string) => /[\p{L}\p{N}]/u.test(rawText);
  const isAssistantFailureEcho = (rawText: string) => {
    const normalized = stripAssistantEcho(rawText).toLowerCase();
    return normalized === ''
      || normalized === 'friday'
      || normalized === 'friday.'
      || normalized === 'sir';
  };
  const isFridayWakeUpPhrase = (rawText: string) => {
    const normalized = normalizeVoiceCommand(rawText).toLowerCase();
    return /\bfriday\b/.test(normalized) && /\b(wake up|wakeup|activate|online|start listening)\b/.test(normalized);
  };

  const handleSendText = useCallback(async (rawText: string) => {
    const text = stripAssistantEcho(rawText).trim();
    if (!text || !hasCommandText(text) || processingRef.current) return;

    if (isAssistantFailureEcho(text)) {
      setLiveTranscript('');
      setVoiceStatus(wakeModeRef.current ? 'Listening for "Friday"' : 'Listening');
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    const cmd = text.toLowerCase();
    let localResponse = handleLocalCommand(cmd);

    if (!localResponse && /\b(open|launch|start)\b/.test(cmd)) {
      localResponse = await runDesktopOpenCommand(cmd);
    }

    if (localResponse) {
      if (cmd !== 'clear' && cmd !== 'cls') addSystemMessage(localResponse);
      speak(localResponse);
      setIsProcessing(false);
      return;
    }

    const fridayMessageId = (Date.now() + 1).toString();
    const fridayMessage: Message = {
      id: fridayMessageId,
      role: 'friday',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, fridayMessage]);

    let accumulatedContent = '';
    const aiMessages = [...messages, userMessage].map(m => ({
      role: (m.role === 'user' ? 'user' : (m.role === 'friday' ? 'assistant' : 'system')) as 'user' | 'assistant' | 'system',
      content: m.content
    }));

    try {
      const streamer = streamFridayResponse(aiMessages);
      for await (const chunk of streamer) {
        accumulatedContent += chunk;
        setMessages(prev =>
          prev.map(m =>
            m.id === fridayMessageId
              ? { ...m, content: accumulatedContent }
              : m
          )
        );
      }
      if (!isAssistantFailureEcho(accumulatedContent)) speak(accumulatedContent);
    } finally {
      setMessages(prev =>
        prev.map(m =>
          m.id === fridayMessageId
            ? { ...m, isStreaming: false }
            : m
        )
      );
      setIsProcessing(false);
    }
  }, [addSystemMessage, handleLocalCommand, messages, runDesktopOpenCommand, speak]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await handleSendText(input);
  };

  const stopGeminiRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  useEffect(() => {
    stopHandsFreeRecordingRef.current = stopGeminiRecording;
  }, [stopGeminiRecording]);

  const startGeminiRecording = useCallback(async (wakePhraseCheck = false) => {
    if (isRecordingRef.current || isTranscribingRef.current) return;

    if (clapArmTimerRef.current) {
      window.clearTimeout(clapArmTimerRef.current);
      clapArmTimerRef.current = null;
    }
    isClapArmedRef.current = false;
    setIsClapArmed(false);

    const micReady = mediaStreamRef.current || await startMicMeter();
    if (!micReady || !mediaStreamRef.current) return;

    if (!('MediaRecorder' in window)) {
      setVoiceStatus('Audio recorder unavailable');
      addSystemMessage('AUDIO RECORDER UNAVAILABLE\nYour browser can access the mic, but it cannot create audio recordings for Gemini transcription.');
      return;
    }

    recordingChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      setIsRecording(false);
      setIsWakePhraseRecording(false);
      isWakePhraseRecordingRef.current = false;
      setIsTranscribing(true);
      setRecordingSeconds(0);
      setVoiceStatus('Transcribing with Gemini');

      try {
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        if (blob.size < 1200) {
          setVoiceStatus('Recording too short');
          addSystemMessage('RECORDING TOO SHORT\nPress the mic, speak your full sentence clearly, then press the mic again when finished.');
          return;
        }

        const audioBase64 = await blobToBase64(blob);
        const transcript = await transcribeAudioCommand(audioBase64, mimeType);

        if (wakePhraseCheck) {
          setLiveTranscript(transcript || '');

          if (transcript && isFridayWakeUpPhrase(transcript)) {
            conversationActiveRef.current = true;
            setIsConversationActive(true);
            refreshConversationIdleTimer();
            autoRecordCooldownUntilRef.current = performance.now() + 900;
            setVoiceStatus('Wake phrase detected');
            window.fridayDesktop?.showWindow();
            speak('FRIDAY online. How can I help, Sir?');
          } else {
            setVoiceStatus(transcript ? 'Standby: say "Friday wake up"' : 'Wake phrase not heard');
            if (transcript) addSystemMessage(`HEARD DURING WAKE CHECK: ${transcript}`);
            if (!transcript && getLastTranscriptionError()) {
              addSystemMessage(`WAKE TRANSCRIPTION FAILED\n${getLastTranscriptionError()}`);
            }
          }

          return;
        }

        const command = stripWakePhrase(transcript);

        if (!transcript) {
          setVoiceStatus('No transcript returned');
          addSystemMessage(`GEMINI TRANSCRIPTION RETURNED EMPTY\n${getLastTranscriptionError() || 'Check GEMINI_API_KEY in .env.local, internet access, and speak clearly for 2-25 seconds.'}`);
          return;
        }

        setLiveTranscript(transcript);

        if (!command) {
          setVoiceStatus('Wake word required');
          addSystemMessage(`HEARD: ${transcript}\nSay "Friday" before the command, or turn off wake mode with the radio button.`);
          return;
        }

        setVoiceStatus('Command captured');
        await handleSendText(command);
      } finally {
        setIsTranscribing(false);

        if (wakePhraseCheck && !conversationActiveRef.current) {
          isClapArmedRef.current = true;
          setIsClapArmed(true);
          autoRecordCooldownUntilRef.current = performance.now() + 900;
          setVoiceStatus('Standby: say "Friday wake up"');
          return;
        }

        if (conversationActiveRef.current) {
          refreshConversationIdleTimer();
          autoRecordCooldownUntilRef.current = performance.now() + AUTO_RECORD_COOLDOWN_MS;
          setVoiceStatus(handsFreeEnabled ? 'Hands-free listening' : 'Conversation active');
        } else {
          stopMicMeter();
        }
      }
    };

    recorderRef.current = recorder;
    recorder.start(1000);
    recordingStartedAtRef.current = performance.now();
    voiceDetectedInRecordingRef.current = false;
    silenceStartedAtRef.current = 0;
    setIsRecording(true);
    setIsWakePhraseRecording(wakePhraseCheck);
    isWakePhraseRecordingRef.current = wakePhraseCheck;
    setRecordingSeconds(0);
    setVoiceStatus(wakePhraseCheck ? 'Listening for wake phrase' : 'Recording command');
    recordingIntervalRef.current = window.setInterval(() => {
      const maxSeconds = Math.ceil((wakePhraseCheck ? WAKE_PHRASE_RECORDING_MS : MAX_GEMINI_RECORDING_MS) / 1000);
      setRecordingSeconds(seconds => Math.min(maxSeconds, seconds + 1));
    }, 1000);
    recordingTimerRef.current = window.setTimeout(stopGeminiRecording, wakePhraseCheck ? WAKE_PHRASE_RECORDING_MS : MAX_GEMINI_RECORDING_MS);
  }, [addSystemMessage, handleSendText, handsFreeEnabled, refreshConversationIdleTimer, speak, startMicMeter, stopGeminiRecording, stopMicMeter, stripWakePhrase]);

  useEffect(() => {
    startWakePhraseRecordingRef.current = () => {
      void startGeminiRecording(true);
    };
  }, [startGeminiRecording]);

  useEffect(() => {
    startHandsFreeRecordingRef.current = () => {
      void startGeminiRecording();
    };
  }, [startGeminiRecording]);

  const armClapWake = useCallback(async () => {
    if (!speechSupported) {
      setSpeechMode('browser');
      setVoiceStatus('Browser speech recognition unavailable');
      addSystemMessage('LOCAL VOICE MODE NEEDS BROWSER SPEECH RECOGNITION\nGemini STT is disabled. Use Microsoft Edge or Chrome speech recognition, or install a native offline STT runtime later.');
      return;
    }

    const micReady = await startMicMeter();
    if (!micReady) return;

    setSpeechMode('browser');
    setLiveTranscript('');
    setIsClapArmed(true);
    isClapArmedRef.current = true;
    setClapDebug({ peak: 0, rms: 0 });
    setVoiceStatus(speechSupported ? 'Listening for "Friday wake up"' : 'Say "Friday wake up" to activate');

    if (speechSupported) {
      shouldListenRef.current = true;
      setIsListening(true);
    }

    if (clapArmTimerRef.current) {
      window.clearTimeout(clapArmTimerRef.current);
      clapArmTimerRef.current = null;
    }
  }, [addSystemMessage, speechSupported, startMicMeter, stopMicMeter]);

  const toggleListening = async () => {
    if (clapWakeEnabled) {
      if (isRecording) {
        stopGeminiRecording();
        return;
      }

      if (isConversationActive) {
        if (!speechSupported) {
          setVoiceStatus('Browser speech recognition unavailable');
          addSystemMessage('VOICE COMMANDS UNAVAILABLE\nGemini STT is disabled, and this browser is not exposing speech recognition.');
          return;
        }

        setSpeechMode('browser');
        shouldListenRef.current = true;
        setIsListening(true);
        setVoiceStatus('Listening');
        return;
      }

      if (isClapArmed) {
        shouldListenRef.current = false;
        setIsListening(false);
        endConversation('Wake phrase idle');
        return;
      }

      await armClapWake();
      return;
    }

    if (isListening) {
      shouldListenRef.current = false;
      setIsListening(false);
      setVoiceStatus('Voice idle');
      recognitionRef.current?.stop();
      stopMicMeter();
      return;
    }

    const micReady = await startMicMeter();
    if (!micReady) return;

    if (!speechSupported) {
      setSpeechMode('browser');
      setVoiceStatus('Browser speech recognition unavailable');
      addSystemMessage('BROWSER SPEECH RECOGNITION UNAVAILABLE\nGemini STT is disabled. Use Edge/Chrome speech recognition, or install a native offline STT runtime later.');
      return;
    }

    setLiveTranscript('');
    setIsListening(true);
  };

  useEffect(() => {
    if (!speechSupported) {
      setVoiceStatus('Voice input unsupported in this browser');
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      if (assistantSpeakingRef.current || performance.now() < speechSuppressionUntilRef.current) {
        return;
      }

      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript.trim();

        if (event.results[i].isFinal) {
          recognitionRestartAttemptsRef.current = 0;
          const cleanedTranscript = normalizeVoiceCommand(transcript);
          const normalized = cleanedTranscript.toLowerCase();
          let command = cleanedTranscript;

          if (clapWakeEnabledRef.current && isClapArmedRef.current) {
            setLiveTranscript(cleanedTranscript);

            if (isFridayWakeUpPhrase(cleanedTranscript)) {
              conversationActiveRef.current = true;
              setIsConversationActive(true);
              setIsClapArmed(false);
              isClapArmedRef.current = false;
              refreshConversationIdleTimer();
              setVoiceStatus('Wake phrase detected');
              window.fridayDesktop?.showWindow();
              speak('FRIDAY online. How can I help, Sir?');
            } else if (/\bfriday\b/.test(normalized)) {
              const wakeIndex = normalized.indexOf('friday');
              const command = cleanedTranscript.slice(wakeIndex + 'friday'.length).trim();

              if (hasCommandText(command)) {
                conversationActiveRef.current = true;
                setIsConversationActive(true);
                setIsClapArmed(false);
                isClapArmedRef.current = false;
                refreshConversationIdleTimer();
                setVoiceStatus('Command captured');
                void handleSendText(command);
              } else {
                setVoiceStatus('Listening for command');
              }
            } else {
              setVoiceStatus('Listening for "Friday wake up"');
            }

            continue;
          }

          if (wakeModeRef.current) {
            const wakeIndex = conversationActiveRef.current ? -1 : normalized.indexOf('friday');
            if (!conversationActiveRef.current && wakeIndex === -1) {
              setVoiceStatus(`Mic active; say "Friday" first`);
              continue;
            }

            command = conversationActiveRef.current
              ? cleanedTranscript
              : cleanedTranscript.slice(wakeIndex + 'friday'.length).trim();
          }

          if (hasCommandText(command)) {
            setLiveTranscript(command);
            void handleSendText(command);
          } else {
            setVoiceStatus('Listening for command');
          }
        } else {
          interim += `${transcript} `;
        }
      }

      if (interim.trim()) setLiveTranscript(interim.trim());
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted') {
        setVoiceStatus(wakeModeRef.current ? 'Listening for "Friday"' : 'Listening');
        restartRecognitionWhenReady(250);
        return;
      }

      if (event.error === 'network') {
        shouldListenRef.current = false;
        setIsListening(false);
        setSpeechMode('browser');
        setVoiceStatus('Browser speech service unavailable');
        addSystemMessage('BROWSER SPEECH SERVICE FAILED\nGemini STT is disabled, so FRIDAY will not fall back to quota-limited transcription. Try Edge/Chrome again, or we can add a native offline runtime once the Windows build tools are available.');
        stopMicMeter();
        return;
      }

      setVoiceStatus(`Voice error: ${event.error}`);
      if (event.error === 'not-allowed' || event.error === 'audio-capture') {
        shouldListenRef.current = false;
        setIsListening(false);
        stopMicMeter();
      }
    };

    recognition.onend = () => {
      if (assistantSpeakingRef.current || performance.now() < speechSuppressionUntilRef.current) {
        restartRecognitionWhenReady(Math.max(250, speechSuppressionUntilRef.current - performance.now()));
        return;
      }

      if (shouldListenRef.current) {
        recognitionRestartAttemptsRef.current += 1;

        if (recognitionRestartAttemptsRef.current > 5) {
          shouldListenRef.current = false;
          setIsListening(false);
          setVoiceStatus('Voice engine paused');
          addSystemMessage('VOICE ENGINE PAUSED\nSpeech recognition kept stopping, so FRIDAY paused it to protect the browser. Press the mic button to try again.');
          stopMicMeter();
          return;
        }

        const delay = Math.min(2500, 350 * recognitionRestartAttemptsRef.current);
        if (recognitionRestartTimerRef.current) window.clearTimeout(recognitionRestartTimerRef.current);
        recognitionRestartTimerRef.current = window.setTimeout(() => {
          if (shouldListenRef.current && !processingRef.current) {
            try {
              recognition.start();
              setVoiceStatus(wakeModeRef.current ? 'Listening for "Friday"' : 'Listening');
            } catch {
              setVoiceStatus('Voice engine restarting');
            }
          }
        }, delay);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      recognition.stop();
    };
  }, [addSystemMessage, handleSendText, restartRecognitionWhenReady, speechSupported, stopMicMeter]);

  useEffect(() => {
    shouldListenRef.current = isListening;

    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (isListening && !isProcessing && !assistantSpeakingRef.current && performance.now() >= speechSuppressionUntilRef.current) {
      try {
        recognitionRestartAttemptsRef.current = 0;
        recognition.start();
        setVoiceStatus(wakeMode ? 'Listening for "Friday"' : 'Listening');
      } catch {
        setVoiceStatus(wakeMode ? 'Listening for "Friday"' : 'Listening');
      }
    } else if (isListening && !isProcessing) {
      restartRecognitionWhenReady(Math.max(250, speechSuppressionUntilRef.current - performance.now()));
    } else {
      recognition.stop();
      if (!isListening) setVoiceStatus('Voice idle');
    }
  }, [isListening, isProcessing, restartRecognitionWhenReady, wakeMode]);

  useEffect(() => {
    return () => {
      stopMicMeter();
    };
  }, [stopMicMeter]);

  return (
    <div className="flex flex-col h-screen max-h-screen bg-black overflow-hidden p-4 md:p-8">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col flex-1 border border-terminal-border rounded-lg bg-terminal-bg shadow-2xl shadow-terminal-accent/5 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2 bg-terminal-border/50 border-b border-terminal-border select-none">
          <div className="flex items-center gap-2">
            <TerminalIcon size={16} className="text-terminal-accent" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-terminal-accent/80">FRIDAY OS v1.3.0 - Hands-Free Interface</span>
          </div>
          <div className="items-center gap-4 text-[10px] font-mono text-terminal-accent/40 hidden md:flex">
            <div className="flex items-center gap-1"><Cpu size={10} /> <span>CPU: 4%</span></div>
            <div className="flex items-center gap-1"><Zap size={10} /> <span>POWER: OPTIMAL</span></div>
            <div className="flex items-center gap-1"><Shield size={10} /> <span>ENCRYPTION: ACTIVE</span></div>
          </div>
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500/20 flex items-center justify-center cursor-not-allowed"><Minus size={8} className="text-yellow-500/50" /></div>
            <div className="w-3 h-3 rounded-full bg-terminal-accent/20 flex items-center justify-center cursor-not-allowed"><Square size={8} className="text-terminal-accent/50" /></div>
            <div className="w-3 h-3 rounded-full bg-red-500/20 flex items-center justify-center cursor-not-allowed"><X size={8} className="text-red-500/50" /></div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-terminal-border bg-black/40">
          <button
            type="button"
            onClick={toggleListening}
            disabled={!micSupported || isTranscribing}
            className={`h-9 w-9 inline-flex items-center justify-center rounded border transition-colors ${isListening || isRecording || isClapArmed || isConversationActive ? 'border-terminal-green text-terminal-green bg-terminal-green/10' : 'border-terminal-border text-terminal-accent hover:bg-terminal-accent/10'} disabled:cursor-not-allowed disabled:opacity-40`}
            title={clapWakeEnabled ? isConversationActive ? 'Listen for next conversation turn' : 'Arm Friday wake up' : isListening ? 'Stop voice input' : 'Start browser voice input'}
          >
            {isClapArmed ? <Hand size={16} /> : isListening || isRecording ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setVoiceEnabled(prev => !prev)}
            className={`h-9 w-9 inline-flex items-center justify-center rounded border transition-colors ${voiceEnabled ? 'border-terminal-accent text-terminal-accent bg-terminal-accent/10' : 'border-terminal-border text-terminal-text/60 hover:bg-white/5'}`}
            title={voiceEnabled ? 'Mute FRIDAY voice' : 'Unmute FRIDAY voice'}
          >
            {voiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setWakeMode(prev => !prev)}
            className={`h-9 w-9 inline-flex items-center justify-center rounded border transition-colors ${wakeMode ? 'border-terminal-green text-terminal-green bg-terminal-green/10' : 'border-terminal-border text-terminal-text/60 hover:bg-white/5'}`}
            title={wakeMode ? 'Wake phrase on' : 'Wake phrase off'}
          >
            <Radio size={16} />
          </button>
          <button
            type="button"
            onClick={async () => {
              const nextEnabled = !clapWakeEnabled;
              setClapWakeEnabled(nextEnabled);
              stopMicMeter();
              shouldListenRef.current = false;
              setIsListening(false);

              if (nextEnabled) {
                setVoiceStatus('Arming wake phrase');
                window.setTimeout(() => {
                  void armClapWake();
                }, 150);
              } else {
                setVoiceStatus('Manual voice mode');
              }
            }}
            className={`h-9 w-9 inline-flex items-center justify-center rounded border transition-colors ${clapWakeEnabled ? 'border-terminal-green text-terminal-green bg-terminal-green/10' : 'border-terminal-border text-terminal-text/60 hover:bg-white/5'}`}
            title={clapWakeEnabled ? 'Friday wake up on' : 'Friday wake up off'}
          >
            <Hand size={16} />
          </button>
          <button
            type="button"
            onClick={() => setHandsFreeEnabled(prev => !prev)}
            className={`h-9 w-9 inline-flex items-center justify-center rounded border transition-colors ${handsFreeEnabled ? 'border-terminal-green text-terminal-green bg-terminal-green/10' : 'border-terminal-border text-terminal-text/60 hover:bg-white/5'}`}
            title={handsFreeEnabled ? 'Hands-free conversation on' : 'Hands-free conversation off'}
          >
            <Ear size={16} />
          </button>
          <button
            type="button"
            onClick={() => setShowVoiceControls(prev => !prev)}
            className={`h-9 w-9 inline-flex items-center justify-center rounded border transition-colors ${showVoiceControls ? 'border-terminal-green text-terminal-green bg-terminal-green/10' : 'border-terminal-border text-terminal-text/60 hover:bg-white/5'}`}
            title="Voice controls"
          >
            <SlidersHorizontal size={16} />
          </button>
          <div className="min-w-0 flex-1 font-mono text-[11px] uppercase tracking-wider text-terminal-text/60">
            <span className="text-terminal-accent/80">{voiceStatus}</span>
            {isConversationActive && !isRecording && <span className="ml-3 text-terminal-green">Active</span>}
            {isConversationActive && handsFreeEnabled && !isRecording && <span className="ml-3 text-terminal-green/70">Auto</span>}
            {isRecording && <span className="ml-3 text-terminal-green">{recordingSeconds}s / {isWakePhraseRecording ? WAKE_PHRASE_RECORDING_MS / 1000 : MAX_GEMINI_RECORDING_MS / 1000}s</span>}
            {isClapArmed && <span className="ml-3 text-terminal-green">wake armed</span>}
            {isClapArmed && <span className="ml-3 text-terminal-text/40">peak {clapDebug.peak} rms {clapDebug.rms}</span>}
            <span className="ml-3 text-terminal-green/70">No-Gemini Browser STT</span>
            {liveTranscript && <span className="ml-3 normal-case tracking-normal text-terminal-text/50">{liveTranscript}</span>}
          </div>
          <div className="h-2 w-28 overflow-hidden rounded bg-terminal-border" title="Microphone input level">
            <div
              className={`h-full transition-all ${micLevel > 8 ? 'bg-terminal-green' : 'bg-terminal-accent/40'}`}
              style={{ width: `${micLevel}%` }}
            />
          </div>
        </div>

        {showVoiceControls && (
          <div className="grid gap-3 border-b border-terminal-border bg-black/60 px-4 py-3 md:grid-cols-[minmax(220px,1fr)_160px_160px_96px]">
            <select
              value={selectedVoiceURI}
              onChange={(event) => setSelectedVoiceURI(event.target.value)}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-2 font-mono text-xs text-terminal-text outline-none focus:border-terminal-accent"
              title="FRIDAY voice"
            >
              {availableVoices.length === 0 && <option value="">System default voice</option>}
              {availableVoices.map(voice => {
                const id = voice.voiceURI || voice.name;
                return (
                  <option key={id} value={id}>
                    {voice.name} ({voice.lang})
                  </option>
                );
              })}
            </select>
            <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-terminal-text/60">
              Rate
              <input
                type="range"
                min="0.7"
                max="1.2"
                step="0.02"
                value={voiceRate}
                onChange={(event) => setVoiceRate(Number(event.target.value))}
                className="min-w-0 flex-1"
              />
            </label>
            <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-terminal-text/60">
              Pitch
              <input
                type="range"
                min="0.6"
                max="1.35"
                step="0.02"
                value={voicePitch}
                onChange={(event) => setVoicePitch(Number(event.target.value))}
                className="min-w-0 flex-1"
              />
            </label>
            <button
              type="button"
              onClick={() => speak('Voice calibration complete. FRIDAY is online and listening for Friday wake up, Sir.')}
              className="h-9 rounded border border-terminal-accent px-3 font-mono text-xs uppercase tracking-wider text-terminal-accent hover:bg-terminal-accent/10"
            >
              Test
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scrollbar-hide"
        >
          <div className="text-[10px] text-terminal-accent/30 font-mono mb-8 opacity-50 select-none whitespace-pre-wrap">
            {`[ SYSTEM DIAGNOSTICS ]\n> BOOT SEQUENCE COMPLETE\n> KERNEL LOADED\n> NEURAL NETWORKS ONLINE\n> VOICE SYNTHESIS READY\n> MICROPHONE HANDSHAKE STANDING BY`}
          </div>

          <AnimatePresence mode="popLayout">
            {messages.map((m) => (
              <TerminalMessage key={m.id} message={m} />
            ))}
          </AnimatePresence>

          {isProcessing && messages[messages.length - 1]?.role !== 'friday' && (
            <div className="flex items-center gap-2 text-terminal-green font-mono text-sm animate-pulse">
              <span>[PROCESSING]</span>
              <span className="terminal-cursor" />
            </div>
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="p-4 bg-terminal-bg border-t border-terminal-border flex items-center gap-2 group"
        >
          <span className="text-terminal-accent font-mono text-sm shrink-0 select-none">C:\Users\BOSS&gt;</span>
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isProcessing}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-terminal-text font-mono text-sm placeholder:text-terminal-border"
            placeholder={isProcessing ? "FRIDAY is thinking..." : "Enter command, or say: Friday status"}
            spellCheck={false}
            autoComplete="off"
          />
          {!isProcessing && input.length > 0 && (
            <button
              type="submit"
              className="text-terminal-accent hover:bg-terminal-accent/10 p-1 rounded transition-colors"
              title="Send"
            >
              <Zap size={16} />
            </button>
          )}
        </form>
      </motion.div>

      <div className="fixed inset-0 pointer-events-none z-50 opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%]" />
    </div>
  );
};
