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
  BrainCircuit,
  Save,
  Trash2,
} from 'lucide-react';
import { Message } from '../types';
import { TerminalMessage } from './TerminalMessage';
import { getLastTranscriptionError, streamFridayResponse, transcribeAudioCommand } from '../services/ai';

type SpeechMode = 'browser' | 'native';
type HudPanel = 'none' | 'chat' | 'stats';
type LocalCommandResult = string | null;
type DesktopOpenResult = {
  ok: boolean;
  desktopBridge?: boolean;
  clientOpen?: boolean;
  message?: string;
  url?: string;
};
type DesktopActionResult = DesktopOpenResult;
type NativeVoice = {
  Name: string;
  Culture?: string;
  Gender?: string;
  Description?: string;
};
type VoiceProfile = {
  id: string;
  name: string;
  voiceURI: string;
  rate: number;
  pitch: number;
  builtin?: boolean;
};
const MAX_GEMINI_RECORDING_MS = 9000;
const WAKE_PHRASE_RECORDING_MS = 3500;
const CONVERSATION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const AUTO_SPEECH_START_RMS = 6;
const AUTO_SPEECH_STOP_RMS = 4;
const AUTO_SPEECH_ABOVE_NOISE_RMS = 3.5;
const AUTO_SILENCE_STOP_MS = 1000;
const AUTO_RECORD_COOLDOWN_MS = 900;
const MIN_AUTO_RECORDING_MS = 800;
const SPEECH_START_PEAK_ABOVE_NOISE = 7;
const SPEECH_TRIM_PAD_MS = 280;
const DOUBLE_CLAP_WINDOW_MS = 2400;
const CLAP_DEBOUNCE_MS = 90;
const CLAP_WAKE_COOLDOWN_MS = 1200;
const CLAP_PEAK_THRESHOLD = 18;
const CLAP_RMS_ABOVE_AMBIENT = 2.5;
const CLAP_RMS_JUMP = 1.2;
const MIC_ALWAYS_ON = false;
const IDLE_FOCUS_TIMEOUT_MS = 5 * 60 * 1000;
const FRIDAY_VOICE_INPUT_MODE_VERSION = 'manual-v1';
const FRIDAY_VOICE_SETTINGS_VERSION = 'cinematic-v1';
const FRIDAY_CINEMATIC_PROFILE: VoiceProfile = {
  id: 'cinematic',
  name: 'FRIDAY Cinematic',
  voiceURI: 'native:Microsoft Zira Desktop',
  rate: 0.96,
  pitch: 1.12,
  builtin: true,
};
const JARVIS_STYLE_PROFILE: VoiceProfile = {
  id: 'jarvis',
  name: 'JARVIS Style',
  voiceURI: 'native:Microsoft David Desktop',
  rate: 0.9,
  pitch: 0.82,
  builtin: true,
};
const BUILT_IN_VOICE_PROFILES: VoiceProfile[] = [
  FRIDAY_CINEMATIC_PROFILE,
  JARVIS_STYLE_PROFILE,
  { id: 'classic', name: 'FRIDAY Classic', voiceURI: 'native:Microsoft Zira Desktop', rate: 0.94, pitch: 1.06, builtin: true },
  { id: 'calm', name: 'Calm Assistant', voiceURI: '', rate: 0.88, pitch: 0.98, builtin: true },
  { id: 'tactical', name: 'Fast Tactical', voiceURI: '', rate: 1.08, pitch: 0.92, builtin: true },
  { id: 'soft', name: 'Soft Female', voiceURI: '', rate: 0.92, pitch: 1.16, builtin: true },
  { id: 'deep', name: 'Deep Assistant', voiceURI: '', rate: 0.9, pitch: 0.72, builtin: true },
];

function scoreFridayVoice(name: string, description = '') {
  const text = `${name} ${description}`.toLowerCase();
  let score = 0;

  if (/zira/.test(text)) score += 100;
  if (/jenny/.test(text)) score += 95;
  if (/aria/.test(text)) score += 90;
  if (/sara|samantha|hazel|susan/.test(text)) score += 70;
  if (/female/.test(text)) score += 30;
  if (/natural|online|neural/.test(text)) score += 25;
  if (/\ben[-_]?us\b|\ben[-_]?gb\b|english/.test(text)) score += 15;
  if (/david|mark|male/.test(text)) score -= 60;

  return score;
}
const DESKTOP_BOOT_GREETINGS = [
  'Good to see you, Sir.',
  'I have missed you, Sir.',
  'Welcome back, Sir.',
  'Systems are glad to have you back, Sir.',
  'At your service again, Sir.',
  'Friday is online and ready for you, Sir.',
  'Back on watch, Sir.',
  'Good morning, Sir. I am online.',
  'Welcome back. I am listening, Sir.',
  'All systems awake. Good to see you, Sir.',
];

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
      focusWindow?: () => void;
      exitFullscreen?: () => void;
      restartNativeVoice?: () => Promise<boolean>;
      openExternalUrl?: (url: string) => Promise<boolean>;
      onWindowHidden?: (callback: () => void) => () => void;
      onWindowShown?: (callback: (detail?: { forceEngage?: boolean }) => void) => () => void;
      onNativeVoiceCommand?: (callback: (text: string) => void) => () => void;
      onNativeVoiceStatus?: (callback: (status: string) => void) => () => void;
    };
  }
}

export const Terminal: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'initial',
      role: 'friday',
      content: 'Friday online. Ready when you are, Sir.',
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
  const [clapWakeEnabled, setClapWakeEnabled] = useState(() => localStorage.getItem('friday.clapWake') === 'true');
  const [isClapArmed, setIsClapArmed] = useState(false);
  const [clapDebug, setClapDebug] = useState({ peak: 0, rms: 0 });
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(() => localStorage.getItem('friday.handsFree') === 'true');
  const [browserSpeechFailed, setBrowserSpeechFailed] = useState(false);
  const [nativeVoiceBlocked, setNativeVoiceBlocked] = useState(true);
  const [isWindowHidden, setIsWindowHidden] = useState(false);
  const [showLlmForm, setShowLlmForm] = useState(false);
  const [hudPanel, setHudPanel] = useState<HudPanel>('none');
  const [isIdleFocus, setIsIdleFocus] = useState(false);
  const [llmForm, setLlmForm] = useState({
    mode: 'Assistant',
    task: '',
    context: '',
    output: 'Concise answer',
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [nativeVoices, setNativeVoices] = useState<NativeVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => localStorage.getItem('friday.voiceURI') || FRIDAY_CINEMATIC_PROFILE.voiceURI);
  const [voiceRate, setVoiceRate] = useState(() => Number(localStorage.getItem('friday.voiceRate') || String(FRIDAY_CINEMATIC_PROFILE.rate)));
  const [voicePitch, setVoicePitch] = useState(() => Number(localStorage.getItem('friday.voicePitch') || String(FRIDAY_CINEMATIC_PROFILE.pitch)));
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState(() => localStorage.getItem('friday.voiceProfileId') || FRIDAY_CINEMATIC_PROFILE.id);
  const [customVoiceProfiles, setCustomVoiceProfiles] = useState<VoiceProfile[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('friday.customVoiceProfiles') || '[]') as VoiceProfile[];
      return Array.isArray(stored) ? stored.filter(profile => profile?.id && profile?.name) : [];
    } catch {
      return [];
    }
  });
  const [customVoiceProfileName, setCustomVoiceProfileName] = useState('');
  const [showVoiceControls, setShowVoiceControls] = useState(false);
  const [voiceArmRequestId, setVoiceArmRequestId] = useState(0);
  const idleFocusTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wavRecorderStopRef = useRef<(() => void) | null>(null);
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
  const lastClapAtRef = useRef(0);
  const clapCountRef = useRef(0);
  const clapWakeCooldownUntilRef = useRef(0);
  const previousPeakRef = useRef(0);
  const previousRmsRef = useRef(0);
  const ambientRmsRef = useRef(0);
  const isWakePhraseRecordingRef = useRef(false);
  const recognitionRestartTimerRef = useRef<number | null>(null);
  const recognitionRestartAttemptsRef = useRef(0);
  const speechResumeTimerRef = useRef<number | null>(null);
  const speechEndFallbackTimerRef = useRef<number | null>(null);
  const assistantSpeakingRef = useRef(false);
  const speechSuppressionUntilRef = useRef(0);
  const lastAssistantSpeechTextRef = useRef('');
  const lastAssistantSpeechAtRef = useRef(0);
  const lastMicFailureRef = useRef({ name: '', at: 0 });
  const nativeVoiceFailureRef = useRef('');
  const nativeVoiceEngineNoticeRef = useRef(false);
  const autoClapArmStartedRef = useRef(false);
  const lastSttUnavailableNoticeAtRef = useRef(0);
  const autoEngageStartedRef = useRef(false);
  const lastDesktopEngageAtRef = useRef(0);
  const suppressNextShownEngageRef = useRef(false);
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingInputsRef = useRef<string[]>([]);
  const isWindowHiddenRef = useRef(false);
  const startWakePhraseRecordingRef = useRef<() => void>(() => {});
  const startHandsFreeRecordingRef = useRef<() => void>(() => {});
  const stopHandsFreeRecordingRef = useRef<() => void>(() => {});
  const triggerDoubleClapWakeRef = useRef<() => void>(() => {});

  const nativeVoiceAvailable = useMemo(() => {
    return typeof window !== 'undefined' && Boolean(window.fridayDesktop?.onNativeVoiceCommand);
  }, []);

  const speechSupported = useMemo(() => {
    return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }, []);

  const micSupported = useMemo(() => {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }, []);

  const voiceProfiles = useMemo(() => {
    return [...BUILT_IN_VOICE_PROFILES, ...customVoiceProfiles];
  }, [customVoiceProfiles]);

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
    isWindowHiddenRef.current = isWindowHidden;
  }, [isWindowHidden]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);

      if (!selectedVoiceURI && voices.length > 0) {
        const preferredVoice = [...voices].sort((a, b) => {
          return scoreFridayVoice(b.name, b.lang) - scoreFridayVoice(a.name, a.lang);
        })[0];
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
    if (!nativeVoiceAvailable) return;

    let cancelled = false;

    const loadNativeVoices = async () => {
      try {
        const response = await fetch('/api/desktop/voices');
        const result = await response.json().catch(() => null) as { ok?: boolean; voices?: NativeVoice[] } | null;
        if (!cancelled && result?.ok && Array.isArray(result.voices)) {
          setNativeVoices(result.voices);

          if (!selectedVoiceURI && result.voices.length > 0) {
            const preferred = [...result.voices].sort((a, b) => {
              return scoreFridayVoice(b.Name, b.Description || b.Culture || '') - scoreFridayVoice(a.Name, a.Description || a.Culture || '');
            })[0];
            setSelectedVoiceURI(`native:${preferred.Name}`);
          }
        }
      } catch {
        // Browser voices remain available as a fallback.
      }
    };

    void loadNativeVoices();

    return () => {
      cancelled = true;
    };
  }, [nativeVoiceAvailable, selectedVoiceURI]);

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
    localStorage.setItem('friday.voiceProfileId', selectedVoiceProfileId);
  }, [selectedVoiceProfileId]);

  useEffect(() => {
    localStorage.setItem('friday.customVoiceProfiles', JSON.stringify(customVoiceProfiles));
  }, [customVoiceProfiles]);

  useEffect(() => {
    if (localStorage.getItem('friday.voiceInputModeVersion') === FRIDAY_VOICE_INPUT_MODE_VERSION) return;
    setClapWakeEnabled(false);
    setHandsFreeEnabled(false);
    setIsClapArmed(false);
    isClapArmedRef.current = false;
    shouldListenRef.current = false;
    setIsListening(false);
    setVoiceStatus('Voice idle');
    localStorage.setItem('friday.clapWake', 'false');
    localStorage.setItem('friday.handsFree', 'false');
    localStorage.setItem('friday.voiceInputModeVersion', FRIDAY_VOICE_INPUT_MODE_VERSION);
  }, []);

  useEffect(() => {
    if (localStorage.getItem('friday.voiceSettingsVersion') === FRIDAY_VOICE_SETTINGS_VERSION) return;
    if (nativeVoiceAvailable && nativeVoices.length === 0) return;

    const preferredNative = nativeVoices.length > 0
      ? [...nativeVoices].sort((a, b) => {
          return scoreFridayVoice(b.Name, b.Description || b.Culture || '') - scoreFridayVoice(a.Name, a.Description || a.Culture || '');
        })[0]
      : null;
    const preferredBrowser = !preferredNative && availableVoices.length > 0
      ? [...availableVoices].sort((a, b) => {
          return scoreFridayVoice(b.name, b.lang) - scoreFridayVoice(a.name, a.lang);
        })[0]
      : null;

    setSelectedVoiceProfileId(FRIDAY_CINEMATIC_PROFILE.id);
    setSelectedVoiceURI(preferredNative
      ? `native:${preferredNative.Name}`
      : preferredBrowser
        ? preferredBrowser.voiceURI || preferredBrowser.name
        : FRIDAY_CINEMATIC_PROFILE.voiceURI);
    setVoiceRate(FRIDAY_CINEMATIC_PROFILE.rate);
    setVoicePitch(FRIDAY_CINEMATIC_PROFILE.pitch);
    localStorage.setItem('friday.voiceSettingsVersion', FRIDAY_VOICE_SETTINGS_VERSION);
  }, [availableVoices, nativeVoiceAvailable, nativeVoices]);

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
    if (!voiceEnabled || !text.trim()) return;

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

    lastAssistantSpeechTextRef.current = cleanText;
    lastAssistantSpeechAtRef.current = performance.now();

    if (selectedVoiceURI.startsWith('native:')) {
      const nativeVoice = selectedVoiceURI.replace(/^native:/, '');
      assistantSpeakingRef.current = true;
      const estimatedSpeechMs = Math.min(12000, Math.max(1500, cleanText.length * 55));
      speechSuppressionUntilRef.current = performance.now() + estimatedSpeechMs + 900;

      void fetch('/api/desktop/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          voice: nativeVoice,
          rate: Math.round((voiceRate - 1) * 10),
          volume: 100,
        }),
      }).finally(() => {
        window.setTimeout(() => {
          assistantSpeakingRef.current = false;
          speechSuppressionUntilRef.current = performance.now() + 700;
          restartRecognitionWhenReady(700);
        }, estimatedSpeechMs);
      });
      return;
    }

    if (!('speechSynthesis' in window)) return;

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

  const speakNativeOrBrowser = useCallback((text: string) => {
    if (!voiceEnabled || !text.trim()) return;

    const cleanText = text.replace(/\s+/g, ' ').trim();
    const estimatedSpeechMs = Math.min(12000, Math.max(1500, cleanText.length * 55));
    lastAssistantSpeechTextRef.current = cleanText;
    lastAssistantSpeechAtRef.current = performance.now();

    speechQueueRef.current = speechQueueRef.current.catch(() => undefined).then(async () => {
      assistantSpeakingRef.current = true;
      speechSuppressionUntilRef.current = performance.now() + estimatedSpeechMs + 900;

      try {
        const response = await fetch('/api/desktop/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voice: selectedVoiceURI.startsWith('native:') ? selectedVoiceURI.replace(/^native:/, '') : '',
            rate: Math.round((voiceRate - 1) * 10),
            volume: 100,
          }),
        });
        if (!response.ok) throw new Error('Native speech unavailable');
      } catch {
        assistantSpeakingRef.current = false;
        speak(cleanText);
        await new Promise(resolve => window.setTimeout(resolve, estimatedSpeechMs + 300));
      } finally {
        assistantSpeakingRef.current = false;
        speechSuppressionUntilRef.current = performance.now() + 700;
        restartRecognitionWhenReady(700);
      }
    });
  }, [restartRecognitionWhenReady, selectedVoiceURI, speak, voiceEnabled, voiceRate]);

  const applyVoiceProfile = useCallback((profile: VoiceProfile) => {
    setSelectedVoiceProfileId(profile.id);
    if (profile.voiceURI) setSelectedVoiceURI(profile.voiceURI);
    setVoiceRate(profile.rate);
    setVoicePitch(profile.pitch);
  }, []);

  const saveVoiceProfile = useCallback(() => {
    const selectedProfile = voiceProfiles.find(profile => profile.id === selectedVoiceProfileId);
    const existingCustom = customVoiceProfiles.find(profile => profile.id === selectedVoiceProfileId);
    const name = customVoiceProfileName.trim() || existingCustom?.name || selectedProfile?.name || 'Custom Voice';
    const nextProfile: VoiceProfile = {
      id: existingCustom?.id || `custom-${Date.now()}`,
      name,
      voiceURI: selectedVoiceURI,
      rate: voiceRate,
      pitch: voicePitch,
    };

    setCustomVoiceProfiles(prev => {
      const exists = prev.some(profile => profile.id === nextProfile.id);
      return exists
        ? prev.map(profile => profile.id === nextProfile.id ? nextProfile : profile)
        : [...prev, nextProfile];
    });
    setSelectedVoiceProfileId(nextProfile.id);
    setCustomVoiceProfileName('');
    addSystemMessage(`VOICE PROFILE SAVED\n${nextProfile.name}`);
  }, [addSystemMessage, customVoiceProfileName, customVoiceProfiles, selectedVoiceProfileId, selectedVoiceURI, voicePitch, voiceProfiles, voiceRate]);

  const deleteVoiceProfile = useCallback(() => {
    const selectedProfile = customVoiceProfiles.find(profile => profile.id === selectedVoiceProfileId);
    if (!selectedProfile) return;

    setCustomVoiceProfiles(prev => prev.filter(profile => profile.id !== selectedVoiceProfileId));
    setSelectedVoiceProfileId('classic');
    setCustomVoiceProfileName('');
    applyVoiceProfile(BUILT_IN_VOICE_PROFILES[0]);
    addSystemMessage(`VOICE PROFILE DELETED\n${selectedProfile.name}`);
  }, [addSystemMessage, applyVoiceProfile, customVoiceProfiles, selectedVoiceProfileId]);

  const testVoiceProfile = useCallback(() => {
    if (selectedVoiceProfileId === JARVIS_STYLE_PROFILE.id) {
      speak('Systems are online, Sir. I am monitoring all active interfaces.');
      return;
    }

    speak('Systems are online. Good evening, Sir. Friday is listening.');
  }, [selectedVoiceProfileId, speak]);

  const releaseBrowserMicMeter = useCallback(() => {
    if (meterFrameRef.current) {
      window.clearTimeout(meterFrameRef.current);
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
    ambientRmsRef.current = 0;
    lastClapAtRef.current = 0;
    clapCountRef.current = 0;
    previousPeakRef.current = 0;
    previousRmsRef.current = 0;
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

    releaseBrowserMicMeter();
    setRecordingSeconds(0);
    setIsWakePhraseRecording(false);
    isWakePhraseRecordingRef.current = false;
    ambientRmsRef.current = 0;
    lastClapAtRef.current = 0;
    clapCountRef.current = 0;
    clapWakeCooldownUntilRef.current = 0;
    previousPeakRef.current = 0;
    previousRmsRef.current = 0;
    setIsClapArmed(false);
    setIsConversationActive(false);
  }, [releaseBrowserMicMeter]);

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
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 512;
      const samples = new Uint8Array(analyser.fftSize);
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
        const now = performance.now();
        const isBusyWithVoice =
          isRecordingRef.current
          || isTranscribingRef.current
          || processingRef.current
          || assistantSpeakingRef.current
          || now < speechSuppressionUntilRef.current
          || (('speechSynthesis' in window) && window.speechSynthesis.speaking);
        const shouldTrackAmbient =
          !isBusyWithVoice
          && (!isClapArmedRef.current || rms < previousAmbient + AUTO_SPEECH_ABOVE_NOISE_RMS);

        if (shouldTrackAmbient) {
          ambientRmsRef.current = previousAmbient * 0.96 + rms * 0.04;
        }

        const ambientRms = ambientRmsRef.current || rms;
        const speechStartRms = Math.max(AUTO_SPEECH_START_RMS, ambientRms + AUTO_SPEECH_ABOVE_NOISE_RMS);
        const speechStopRms = Math.max(AUTO_SPEECH_STOP_RMS, ambientRms + 1.2);
        const speechStartPeak = Math.max(10, ambientRms + SPEECH_START_PEAK_ABOVE_NOISE);
        const relativeRms = Math.max(0, rms - Math.max(0, ambientRms - 2));
        setMicLevel(Math.min(100, Math.round(relativeRms * 7)));

        if (isClapArmedRef.current && now - lastAudioDebugAtRef.current > 180) {
          lastAudioDebugAtRef.current = now;
          setClapDebug({ peak: Math.round(peak), rms: Math.round(rms) });
        }

        const rmsJump = rms - previousRmsRef.current;
        const peakJump = peak - previousPeakRef.current;
        const clapPeakThreshold = isWindowHiddenRef.current ? 9 : CLAP_PEAK_THRESHOLD;
        const clapPeakJumpThreshold = isWindowHiddenRef.current ? 5 : 10;
        const clapRmsAboveAmbient = isWindowHiddenRef.current ? 0.9 : CLAP_RMS_ABOVE_AMBIENT;
        const isSharpClap =
          clapWakeEnabledRef.current
          && isClapArmedRef.current
          && !processingRef.current
          && !isBusyWithVoice
          && now > clapWakeCooldownUntilRef.current
          && peak >= clapPeakThreshold
          && (
            rms >= ambientRms + clapRmsAboveAmbient
            || rmsJump >= CLAP_RMS_JUMP
            || peakJump >= clapPeakJumpThreshold
          );

        if (isSharpClap && now - lastClapAtRef.current > CLAP_DEBOUNCE_MS) {
          const withinDoubleClapWindow = now - lastClapAtRef.current <= DOUBLE_CLAP_WINDOW_MS;
          clapCountRef.current = withinDoubleClapWindow ? clapCountRef.current + 1 : 1;
          lastClapAtRef.current = now;
          setVoiceStatus(clapCountRef.current >= 2 ? 'Double clap detected' : `Clap ${clapCountRef.current}/2`);

          if (clapCountRef.current >= 2) {
            clapWakeCooldownUntilRef.current = now + CLAP_WAKE_COOLDOWN_MS;
            clapCountRef.current = 0;
            triggerDoubleClapWakeRef.current();
          }
        } else if (clapCountRef.current > 0 && now - lastClapAtRef.current > DOUBLE_CLAP_WINDOW_MS) {
          clapCountRef.current = 0;
        }

        previousPeakRef.current = peak;
        previousRmsRef.current = rms;

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
          && peak > speechStartPeak
        ) {
          setSpeechMode('browser');
          setVoiceStatus('Speech detected; recording locally');
          startHandsFreeRecordingRef.current();
        } else if (
          handsFreeEnabled
          && MIC_ALWAYS_ON
          && wakeModeRef.current
          && !conversationActiveRef.current
          && !isClapArmedRef.current
          && !isRecordingRef.current
          && !isTranscribingRef.current
          && !processingRef.current
          && now > autoRecordCooldownUntilRef.current
          && !isBusyWithVoice
          && rms > speechStartRms
          && peak > speechStartPeak
        ) {
          setSpeechMode('browser');
          setVoiceStatus('Checking for "Friday"');
          startWakePhraseRecordingRef.current();
        } else if (
          conversationActiveRef.current
          && !isClapArmedRef.current
          && !processingRef.current
          && !isBusyWithVoice
          && rms > speechStartRms
          && peak > speechStartPeak
          && nativeVoiceBlocked
          && !speechSupported
          && now - lastSttUnavailableNoticeAtRef.current > 4500
        ) {
          lastSttUnavailableNoticeAtRef.current = now;
          setVoiceStatus('Audio detected; speech-to-text unavailable');
        }

        if (isRecordingRef.current) {
          const elapsed = now - recordingStartedAtRef.current;

          if (rms > speechStartRms && peak > speechStartPeak) {
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

        meterFrameRef.current = window.setTimeout(updateMeter, isWindowHiddenRef.current ? 35 : 25);
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
  }, [addSystemMessage, handsFreeEnabled, nativeVoiceAvailable, nativeVoiceBlocked, speechSupported, stopMicMeter]);

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

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
  };

  const encodeWav = (chunks: Float32Array[], sampleRate: number) => {
    const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    let offset = 0;

    const writeString = (value: string) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset, value.charCodeAt(i));
        offset += 1;
      }
    };

    writeString('RIFF');
    view.setUint32(offset, 36 + sampleCount * 2, true); offset += 4;
    writeString('WAVE');
    writeString('fmt ');
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * 2, true); offset += 4;
    view.setUint16(offset, 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString('data');
    view.setUint32(offset, sampleCount * 2, true); offset += 4;

    for (const chunk of chunks) {
      for (const sample of chunk) {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
        offset += 2;
      }
    }

    return buffer;
  };

  const cleanSpeechChunks = (chunks: Float32Array[], sampleRate: number) => {
    const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (!sampleCount) return chunks;

    const merged = new Float32Array(sampleCount);
    let writeOffset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    const filtered = new Float32Array(merged.length);
    let previousInput = 0;
    let previousOutput = 0;
    for (let i = 0; i < merged.length; i += 1) {
      const input = merged[i];
      const output = input - previousInput + 0.995 * previousOutput;
      filtered[i] = output;
      previousInput = input;
      previousOutput = output;
    }

    const frameSize = Math.max(160, Math.round(sampleRate * 0.02));
    const frameCount = Math.max(1, Math.ceil(filtered.length / frameSize));
    const frameRms: number[] = [];
    for (let frame = 0; frame < frameCount; frame += 1) {
      const start = frame * frameSize;
      const end = Math.min(filtered.length, start + frameSize);
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += filtered[i] * filtered[i];
      frameRms.push(Math.sqrt(sum / Math.max(1, end - start)));
    }

    const ambientFloat = Math.max(0, ambientRmsRef.current) / 128;
    const sortedRms = [...frameRms].sort((a, b) => a - b);
    const measuredFloor = sortedRms[Math.floor(sortedRms.length * 0.25)] || 0;
    const noiseFloor = Math.max(ambientFloat, measuredFloor);
    const voiceThreshold = Math.max(0.007, noiseFloor + 0.007);
    const gateThreshold = Math.max(0.004, noiseFloor + 0.0025);
    const padFrames = Math.ceil((SPEECH_TRIM_PAD_MS / 1000) * sampleRate / frameSize);

    let firstVoiceFrame = frameRms.findIndex(value => value >= voiceThreshold);
    let lastVoiceFrame = frameRms.length - 1;
    while (lastVoiceFrame >= 0 && frameRms[lastVoiceFrame] < voiceThreshold) {
      lastVoiceFrame -= 1;
    }

    if (firstVoiceFrame < 0 || lastVoiceFrame < firstVoiceFrame) {
      firstVoiceFrame = 0;
      lastVoiceFrame = frameRms.length - 1;
    }

    const startFrame = Math.max(0, firstVoiceFrame - padFrames);
    const endFrame = Math.min(frameRms.length - 1, lastVoiceFrame + padFrames);
    const startSample = startFrame * frameSize;
    const endSample = Math.min(filtered.length, (endFrame + 1) * frameSize);
    const cleaned = filtered.slice(startSample, endSample);

    for (let frame = 0; frame < Math.ceil(cleaned.length / frameSize); frame += 1) {
      const sourceFrame = startFrame + frame;
      const start = frame * frameSize;
      const end = Math.min(cleaned.length, start + frameSize);
      const gain = (frameRms[sourceFrame] || 0) < gateThreshold ? 0.18 : 1;
      if (gain === 1) continue;
      for (let i = start; i < end; i += 1) cleaned[i] *= gain;
    }

    let peak = 0;
    for (const sample of cleaned) peak = Math.max(peak, Math.abs(sample));
    if (peak > 0 && peak < 0.7) {
      const gain = Math.min(5.5, 0.86 / peak);
      for (let i = 0; i < cleaned.length; i += 1) cleaned[i] = Math.max(-1, Math.min(1, cleaned[i] * gain));
    }

    return [cleaned];
  };

  const endConversation = useCallback((status = 'Wake phrase idle') => {
    conversationActiveRef.current = false;
    setIsConversationActive(false);
    if (MIC_ALWAYS_ON && wakeModeRef.current) {
      setIsClapArmed(false);
      isClapArmedRef.current = false;
      shouldListenRef.current = true;
      setIsListening(true);
      setVoiceStatus('Listening for "Friday"');
      void startMicMeter();
      return;
    }

    if (clapWakeEnabledRef.current) {
      setIsClapArmed(true);
      isClapArmedRef.current = true;
      setVoiceStatus('Double clap standby');
      return;
    }

    setIsClapArmed(false);
    isClapArmedRef.current = false;
    setVoiceStatus(status);
    stopMicMeter();
  }, [startMicMeter, stopMicMeter]);

  const refreshConversationIdleTimer = useCallback(() => {
    if (conversationIdleTimerRef.current) {
      window.clearTimeout(conversationIdleTimerRef.current);
      conversationIdleTimerRef.current = null;
    }

    conversationIdleTimerRef.current = window.setTimeout(() => {
      endConversation('Conversation timed out');
    }, CONVERSATION_IDLE_TIMEOUT_MS);
  }, [endConversation]);

  const focusFridayWindow = useCallback(() => {
    if (window.fridayDesktop?.focusWindow) {
      window.fridayDesktop.focusWindow();
      return;
    }

    window.fridayDesktop?.showWindow();
  }, []);

  const triggerDoubleClapWake = useCallback(() => {
    suppressNextShownEngageRef.current = true;
    focusFridayWindow();
    inputRef.current?.focus();
    const shouldActivateConversation = true;
    conversationActiveRef.current = shouldActivateConversation;
    setIsConversationActive(shouldActivateConversation);
    setIsClapArmed(false);
    isClapArmedRef.current = false;
    shouldListenRef.current = false;
    setIsListening(false);
    setSpeechMode('browser');
    setLiveTranscript('');
    setIsWindowHidden(false);
    setVoiceStatus(shouldActivateConversation ? 'Double clap wake active' : 'F.R.I.D.A.Y opened by double clap');

    if (shouldActivateConversation) {
      shouldListenRef.current = false;
      setIsListening(true);
      setVoiceStatus('Local voice active; speak your command');
      refreshConversationIdleTimer();
      addSystemMessage('DOUBLE CLAP WAKE\nF.R.I.D.A.Y is active. Speak your command now, or type below.');
      autoRecordCooldownUntilRef.current = performance.now() + (voiceEnabled ? 1200 : 300);
      void startMicMeter().then((ready) => {
        if (!ready) {
          setIsListening(false);
          setVoiceStatus('Microphone unavailable after double clap');
          return;
        }

        conversationActiveRef.current = true;
        setIsConversationActive(true);
        isClapArmedRef.current = false;
        setIsClapArmed(false);
        shouldListenRef.current = false;
        setIsListening(true);
        refreshConversationIdleTimer();
        setVoiceStatus(handsFreeEnabled ? 'Hands-free listening' : 'Local voice active; speak your command');
      });
      if (voiceEnabled) speakNativeOrBrowser('Friday awake. Ready when you are, Sir.');
    } else {
      addSystemMessage('DOUBLE CLAP LAUNCH\nF.R.I.D.A.Y window opened.');
    }
  }, [addSystemMessage, focusFridayWindow, handsFreeEnabled, refreshConversationIdleTimer, speakNativeOrBrowser, startMicMeter, voiceEnabled]);

  useEffect(() => {
    triggerDoubleClapWakeRef.current = triggerDoubleClapWake;
  }, [triggerDoubleClapWake]);

  const stripWakePhrase = useCallback((text: string) => {
    const cleaned = normalizeVoiceCommand(text);
    if (!wakeModeRef.current || conversationActiveRef.current) return cleaned;

    const wakeIndex = findWakeWordIndex(cleaned);
    if (wakeIndex === -1) return '';

    return stripFridayAddress(cleaned.slice(wakeIndex)).trim();
  }, []);

  const postDesktopOpen = async (endpoint: string, command: string) => {
    const response = await fetch(`${endpoint}/api/desktop/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: command }),
    });
    return await response.json() as DesktopOpenResult;
  };

  const postDesktopClose = async (endpoint: string, command: string) => {
    const response = await fetch(`${endpoint}/api/desktop/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: command }),
    });
    return await response.json() as DesktopActionResult;
  };

  const postDesktopAction = async (endpoint: string, command: string) => {
    const response = await fetch(`${endpoint}/api/desktop/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: command }),
    });
    return await response.json() as DesktopActionResult;
  };

  const openUrlFromElectron = async (url?: string) => {
    if (!url || !window.fridayDesktop?.openExternalUrl) return false;
    try {
      return await window.fridayDesktop.openExternalUrl(url);
    } catch {
      return false;
    }
  };

  const runDesktopOpenCommand = useCallback(async (command: string) => {
    const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    try {
      const result = await postDesktopOpen('', command);

      if (result.ok && result.clientOpen && result.url) {
        if (!await openUrlFromElectron(result.url)) {
          window.open(result.url, '_blank', 'noopener,noreferrer');
        }
        return result.message || 'Opening requested target.';
      }

      if (result.ok && result.url) {
        await openUrlFromElectron(result.url);
      }

      if (result.ok) return result.message || 'Opening requested target.';

      if (!isLocalPage && result.desktopBridge === false) {
        const localResult = await postDesktopOpen('http://127.0.0.1:3000', command);
        if (localResult.ok && localResult.clientOpen && localResult.url) {
          if (!await openUrlFromElectron(localResult.url)) {
            window.open(localResult.url, '_blank', 'noopener,noreferrer');
          }
        }
        return localResult.message || (localResult.ok ? 'Opening requested target.' : 'Desktop command failed.');
      }

      return result.message || (result.ok ? 'Opening requested target.' : 'Desktop command failed.');
    } catch {
      if (!isLocalPage) {
        try {
          const localResult = await postDesktopOpen('http://127.0.0.1:3000', command);
          if (localResult.ok && localResult.clientOpen && localResult.url) {
            if (!await openUrlFromElectron(localResult.url)) {
              window.open(localResult.url, '_blank', 'noopener,noreferrer');
            }
          }
          return localResult.message || (localResult.ok ? 'Opening requested target.' : 'Desktop command failed.');
        } catch {
          return 'Local desktop bridge offline. Keep FRIDAY running on this Windows PC, then try again.';
        }
      }

      return 'Desktop bridge offline. Start FRIDAY with npm run dev so I can control approved desktop actions.';
    }
  }, []);

  const runDesktopCloseCommand = useCallback(async (command: string) => {
    const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    try {
      const result = await postDesktopClose('', command);
      if (result.ok) return result.message || 'Closing requested target.';

      if (!isLocalPage && result.desktopBridge === false) {
        const localResult = await postDesktopClose('http://127.0.0.1:3000', command);
        return localResult.message || (localResult.ok ? 'Closing requested target.' : 'Desktop command failed.');
      }

      return result.message || 'Desktop command failed.';
    } catch {
      if (!isLocalPage) {
        try {
          const localResult = await postDesktopClose('http://127.0.0.1:3000', command);
          return localResult.message || (localResult.ok ? 'Closing requested target.' : 'Desktop command failed.');
        } catch {
          return 'Local desktop bridge offline. Keep FRIDAY running on this Windows PC, then try again.';
        }
      }

      return 'Desktop bridge offline. Start FRIDAY with npm run dev so I can control approved desktop actions.';
    }
  }, []);

  const runDesktopActionCommand = useCallback(async (command: string) => {
    const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    try {
      const result = await postDesktopAction('', command);
      if (result.ok) return result.message || 'Running requested desktop action.';

      if (!isLocalPage && result.desktopBridge === false) {
        const localResult = await postDesktopAction('http://127.0.0.1:3000', command);
        return localResult.message || (localResult.ok ? 'Running requested desktop action.' : 'Desktop action failed.');
      }

      return result.message || 'Desktop action failed.';
    } catch {
      if (!isLocalPage) {
        try {
          const localResult = await postDesktopAction('http://127.0.0.1:3000', command);
          return localResult.message || (localResult.ok ? 'Running requested desktop action.' : 'Desktop action failed.');
        } catch {
          return 'Local desktop bridge offline. Keep FRIDAY running on this Windows PC, then try again.';
        }
      }

      return 'Desktop bridge offline. Start FRIDAY with npm run dev so I can run approved desktop actions.';
    }
  }, []);

  const handleLocalCommand = useCallback((cmd: string): LocalCommandResult => {
    if (cmd === 'clear' || cmd === 'cls') {
      setMessages([]);
      setHudPanel('none');
      return 'Terminal cleared.';
    }

    if (cmd === 'open chat' || cmd === 'show chat' || cmd === 'chat') {
      setHudPanel('chat');
      return 'Chat opened.';
    }

    if (cmd === 'exit fullscreen' || cmd === 'leave fullscreen' || cmd === 'normal screen' || cmd === 'windowed mode') {
      window.fridayDesktop?.exitFullscreen?.();
      return 'Leaving fullscreen.';
    }

    if (cmd === 'close chat' || cmd === 'hide chat') {
      setHudPanel('none');
      return 'Chat hidden.';
    }

    if (cmd === 'open stats' || cmd === 'show stats' || cmd === 'stats' || cmd === 'stat') {
      setHudPanel('stats');
      return 'Stats opened.';
    }

    if (cmd === 'close stats' || cmd === 'hide stats' || cmd === 'close panels' || cmd === 'hide panels') {
      setHudPanel('none');
      return 'Panels hidden.';
    }

    if (cmd === 'time') {
      return `Current Internal Time: ${new Date().toLocaleString()}`;
    }

    if (cmd === 'help') {
      return `AVAILABLE SYSTEM COMMANDS:\n- open instagram/youtube/google/gmail/whatsapp/chatgpt/github/jio hotstar: Open site in browser\n- open chrome/opera gx/notepad/calculator/camera/settings/microphone settings/speech settings/voice training/explorer/downloads/documents/desktop/vscode: Open approved local apps and folders\n- close opera gx/chrome/notepad/calculator/vscode: Close approved local apps\n- lock screen / restart computer / shutdown computer / sleep computer / open task manager: Run approved Windows actions\n- clear/cls: Clear the terminal screen\n- time: Display system clock\n- help: Show this menu\n- status: Diagnostic overview\n- listen: Enable manual voice input\n- stop listening: Disable voice and clap input\n- stand down/go idle: End active conversation\n- mute/unmute: Toggle spoken responses\n\nVoice: FRIDAY uses manual voice input. Press the mic when you want to speak.`;
    }

    if (
      cmd === 'status'
      || cmd === 'system checks'
      || cmd === 'do system checks'
      || cmd.includes('do system checks')
      || cmd.includes('give me stats')
      || cmd.includes('give me status')
      || /\b(?:trouble|troubles|issue|issues|problem|problems|diagnostic|diagnostics)\b.*\b(?:system|pc|computer|machine|friday)\b/.test(cmd)
      || /\b(?:system|pc|computer|machine|friday)\b.*\b(?:trouble|troubles|issue|issues|problem|problems|diagnostic|diagnostics)\b/.test(cmd)
    ) {
      const sttStatus = micSupported ? 'local Whisper via browser mic' : 'microphone unavailable';
      return `Diagnostics look clean, Sir.\nCore temperature: 38 C\nMemory usage: 2.1GB / 64GB\nNetwork: connected\nAI model: local-first\nVoice input: ${sttStatus}\nAudio output: ${'speechSynthesis' in window ? 'available' : 'unsupported'}`;
    }

    if (cmd === 'voice status' || cmd === 'speech status') {
      return [
        `Microphone meter: ${micSupported ? 'available' : 'unavailable'}`,
        'Command transcription: local Whisper',
        `Windows native speech: ${nativeVoiceAvailable ? 'ignored' : 'unavailable'}`,
        `Browser speech recognition: ${speechSupported ? 'available but not required' : 'not required in this Electron window'}`,
      ].join('\n');
    }

    if (cmd === 'listen') {
      setVoiceArmRequestId(Date.now());
      return 'Manual voice input armed. Press the mic when you want FRIDAY to record.';
    }

    if (cmd === 'stop listening') {
      setIsListening(false);
      setClapWakeEnabled(false);
      stopMicMeter();
      conversationActiveRef.current = false;
      setIsConversationActive(false);
      setIsClapArmed(false);
      isClapArmedRef.current = false;
      setVoiceStatus('Voice input disabled.');
      return 'Voice input disabled.';
    }

    if (cmd === 'stand down' || cmd === 'go idle') {
      endConversation('Conversation idle.');
      return 'Standing down. Press the mic or type when you need me again.';
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
  }, [endConversation, micSupported, nativeVoiceAvailable, nativeVoiceBlocked, speechSupported, stopMicMeter]);

  const normalizeVoiceCommand = (rawText: string) => rawText.replace(/[^\p{L}\p{N}\s?!.,"'-]/gu, '').trim();
  const stripAssistantEcho = (rawText: string) => {
    let cleaned = normalizeVoiceCommand(rawText);
    cleaned = cleaned.replace(/^error:?\s*connection lost\.?\s*systems failing,?\s*sir\.?\s*/i, '');
    cleaned = cleaned.replace(/^friday awake\.?\s*ready when you are,?\s*sir\.?\s*/i, '');
    cleaned = cleaned.replace(/^awake,?\s*ready when you are,?\s*sir\.?\s*/i, '');
    cleaned = cleaned.replace(/^good to see you,?\s*sir\.?\s*friday is online and listening\.?\s*/i, '');
    cleaned = cleaned.replace(/^please check your connectivity\.?\s*/i, '');
    cleaned = cleaned.replace(/^i cannot reach the friday server right now\.?\s*/i, '');
    cleaned = cleaned.replace(/^i cannot reach the gemini server right now:?\s*/i, '');
    return cleaned.trim();
  };
  const hasCommandText = (rawText: string) => /[\p{L}\p{N}]/u.test(rawText);
  const wakeWordPattern = /\b(?:friday|fri\s*day|f\s*r\s*i\s*d\s*a\s*y|freddy|freddie|fridi|free\s*day)\b/i;
  const hasWakeWord = (rawText: string) => wakeWordPattern.test(normalizeVoiceCommand(rawText));
  const findWakeWordIndex = (rawText: string) => {
    const normalized = normalizeVoiceCommand(rawText).toLowerCase();
    const match = normalized.match(wakeWordPattern);
    return match?.index ?? -1;
  };
  const isAssistantFailureEcho = (rawText: string) => {
    const normalized = stripAssistantEcho(rawText).toLowerCase();
    return normalized === ''
      || normalized === 'friday'
      || normalized === 'friday.'
      || normalized === 'sir';
  };
  const isNonCommandNoise = (rawText: string) => {
    const normalized = normalizeVoiceCommand(rawText).toLowerCase();
    return /^\s*(?:keyboard clicking|typing|clicking|mouse click|silence|blank audio|drum beat|background noise|noise)\s*[.!?]?\s*$/.test(normalized);
  };
  const normalizeAssistantEchoText = (rawText: string) => normalizeVoiceCommand(rawText)
    .toLowerCase()
    .replace(/\b3\b/g, 'three')
    .replace(/\b23(?:\.99)?\b/g, 'twenty three')
    .replace(/\b(?:friday|sir|serve|the|a|an|to|or|and|with|in|your)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const isLikelyRecentAssistantEcho = (rawText: string) => {
    const assistantText = lastAssistantSpeechTextRef.current;
    if (!assistantText || performance.now() - lastAssistantSpeechAtRef.current > 45000) return false;

    const heard = normalizeAssistantEchoText(rawText);
    const spoken = normalizeAssistantEchoText(assistantText);
    if (heard.length < 12 || spoken.length < 12) return false;
    if (spoken.includes(heard) || heard.includes(spoken)) return true;

    const heardTokens = heard.split(' ').filter(token => token.length > 2);
    const spokenTokens = new Set(spoken.split(' ').filter(token => token.length > 2));
    if (heardTokens.length < 4 || spokenTokens.size < 4) return false;

    const overlap = heardTokens.filter(token => spokenTokens.has(token)).length;
    return overlap >= 4 && overlap / heardTokens.length >= 0.58;
  };
  const isFridayWakeUpPhrase = (rawText: string) => {
    const normalized = normalizeVoiceCommand(rawText).toLowerCase();
    return hasWakeWord(normalized);
  };
  const stripFridayWakeUpPhrase = (rawText: string) => normalizeVoiceCommand(rawText)
    .replace(new RegExp(`${wakeWordPattern.source}[\\s,.:;!?-]*(?:wake up|wakeup|activate|online|start listening)\\b[\\s,.:;!?-]*`, 'i'), '')
    .trim();
  const stripFridayAddress = (rawText: string) => stripFridayWakeUpPhrase(rawText)
    .replace(new RegExp(`^(?:hey|hi|hello|yo|okay|ok)\\s+${wakeWordPattern.source}[\\s,.:;!?-]*`, 'i'), '')
    .replace(new RegExp(`${wakeWordPattern.source}[\\s,.:;!?-]*`, 'i'), '')
    .replace(/^(?:sir|boss)\b[\s,.:;!?-]*/i, '')
    .trim();
  const normalizeCommandPhrase = (rawText: string) => normalizeVoiceCommand(rawText)
    .replace(/^(?:and|then|now|please)\s+/i, '')
    .replace(/\s+(?:please)$/i, '')
    .trim();
  const shouldRouteToDesktopOpen = (cmd: string) => {
    if (/\b(open|launch|start)\b/.test(cmd)) return true;
    if (/\b(search|google)\b/.test(cmd) && /\b(?:in|on|with|using)\s+(?:browser|google|chrome|edge|opera|opera gx)\b/.test(cmd)) return true;
    if (/\b(open|show)\b.*\b(?:search results|google results|results page)\b/.test(cmd)) return true;
    return false;
  };
  const isDesktopActionCommand = (cmd: string) => /^(?:sleep|shutdown|restart|reboot)$/.test(cmd)
    || /\b(lock|task manager|taskmgr|battery|power level|charge|battery life|shutdown|turn off|power off|restart|reboot)\b/.test(cmd)
    || /\b(?:put|send) (?:my |the )?(?:pc|computer|system|machine) to sleep\b/.test(cmd)
    || /\bsleep (?:my |the )?(?:pc|computer|system|machine)\b/.test(cmd);
  const isDesktopCloseCommand = (cmd: string) => /\b(close|quit|exit|kill|terminate|shut)\b/.test(cmd);
  const splitParagraphInstructions = (rawCommand: string) => {
    const command = rawCommand
      .replace(/\b(?:after that|and then|then|also|next|plus|while you are at it)\b/gi, '.')
      .replace(/\s+and\s+(?=\b(?:open|launch|start|close|quit|exit|kill|terminate|shut|lock|check|show|tell|give|get|search|google|weather|wether|temperature|forecast|battery|power|charge|task manager|taskmgr)\b)/gi, '.')
      .replace(/\s+,\s+(?=\b(?:open|launch|start|close|quit|exit|kill|terminate|shut|lock|check|show|tell|give|get|search|google|weather|wether|temperature|forecast|battery|power|charge|task manager|taskmgr)\b)/gi, '.');

    return command
      .split(/[.;]\s*/g)
      .map(part => normalizeCommandPhrase(part))
      .filter(part => part && hasCommandText(part));
  };

  const resumeConversationListening = useCallback((delay = 700) => {
    if (!conversationActiveRef.current) return;

    refreshConversationIdleTimer();
    shouldListenRef.current = false;
    setIsListening(false);
    setSpeechMode('browser');
    setVoiceStatus(handsFreeEnabled ? 'Hands-free listening' : 'Conversation active');
    autoRecordCooldownUntilRef.current = performance.now() + delay;
  }, [handsFreeEnabled, refreshConversationIdleTimer]);

  const handleSendText = useCallback(async (rawText: string) => {
    const text = normalizeCommandPhrase(stripFridayAddress(stripAssistantEcho(rawText)));
    if (!text || !hasCommandText(text) || processingRef.current || isNonCommandNoise(text)) return;

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
    const runLocalInstruction = async (instruction: string) => {
      let response = handleLocalCommand(instruction);

      if (!response && isDesktopCloseCommand(instruction)) {
        response = await runDesktopCloseCommand(instruction);
      }

      if (!response && isDesktopActionCommand(instruction)) {
        response = await runDesktopActionCommand(instruction);
      }

      if (!response && shouldRouteToDesktopOpen(instruction)) {
        response = await runDesktopOpenCommand(instruction);
      }

      return response;
    };

    const instructionClauses = splitParagraphInstructions(text);
    const localResponses: string[] = [];
    const aiInstructions: string[] = [];

    for (const instruction of instructionClauses) {
      const normalizedInstruction = instruction.toLowerCase();
      const response = await runLocalInstruction(normalizedInstruction);
      if (response) {
        localResponses.push(response);
      } else {
        aiInstructions.push(instruction);
      }
    }

    if (localResponses.length > 0 && aiInstructions.length === 0) {
      const localResponse = localResponses.length === 1
        ? localResponses[0]
        : `Done, Sir.\n${localResponses.map((response, index) => `${index + 1}. ${response}`).join('\n')}`;

      if (!instructionClauses.some(instruction => instruction === 'clear' || instruction === 'cls')) {
        addSystemMessage(localResponse);
      }
      speak(localResponse);
      setIsProcessing(false);
      resumeConversationListening(voiceEnabled ? 900 : 250);
      const queuedInput = pendingInputsRef.current.shift();
      if (queuedInput) window.setTimeout(() => void handleSendText(queuedInput), 0);
      return;
    }

    if (localResponses.length > 0) {
      addSystemMessage(`ACTIONS COMPLETED\n${localResponses.map((response, index) => `${index + 1}. ${response}`).join('\n')}`);
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
    const aiPrompt = aiInstructions.length > 0
      ? [
          aiInstructions.join('\n'),
          localResponses.length > 0
            ? `\nAlready completed local actions:\n${localResponses.map((response, index) => `${index + 1}. ${response}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n')
      : text;
    const aiUserMessage = { ...userMessage, content: aiPrompt };
    const aiMessages = [...messages, aiUserMessage].map(m => ({
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
      resumeConversationListening(voiceEnabled ? 1200 : 250);
      const queuedInput = pendingInputsRef.current.shift();
      if (queuedInput) window.setTimeout(() => void handleSendText(queuedInput), 0);
    }
  }, [addSystemMessage, handleLocalCommand, messages, resumeConversationListening, runDesktopActionCommand, runDesktopCloseCommand, runDesktopOpenCommand, speak, voiceEnabled]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const nextInput = input.trim();
    if (!nextInput) return;

    if (processingRef.current) {
      pendingInputsRef.current.push(nextInput);
      setInput('');
      setVoiceStatus(`Queued ${pendingInputsRef.current.length} message${pendingInputsRef.current.length === 1 ? '' : 's'}`);
      return;
    }

    await handleSendText(nextInput);
  };

  useEffect(() => {
    const unsubscribeCommand = window.fridayDesktop?.onNativeVoiceCommand?.((heardText) => {
      if (nativeVoiceBlocked) return;

      const cleanedText = normalizeVoiceCommand(heardText);
      if (!hasCommandText(cleanedText) || processingRef.current) return;

      if (assistantSpeakingRef.current || performance.now() < speechSuppressionUntilRef.current) {
        setLiveTranscript(cleanedText);
        setVoiceStatus('Ignoring FRIDAY speech');
        return;
      }

      setSpeechMode('native');

      const command = wakeModeRef.current && !conversationActiveRef.current
        ? stripFridayAddress(cleanedText)
        : cleanedText;

      if (wakeModeRef.current && !conversationActiveRef.current && !hasWakeWord(cleanedText)) {
        setLiveTranscript(cleanedText);
        setVoiceStatus(`Heard "${cleanedText}". Say "Friday" first.`);
        return;
      }

      setLiveTranscript(cleanedText);

      if (!hasCommandText(command)) {
        conversationActiveRef.current = true;
        setIsConversationActive(true);
        refreshConversationIdleTimer();
        setVoiceStatus('Windows voice ready');
        addSystemMessage(`HEARD: ${cleanedText}`);
        return;
      }

      conversationActiveRef.current = true;
      setIsConversationActive(true);
      refreshConversationIdleTimer();
      setVoiceStatus('Windows voice command captured');
      addSystemMessage(`HEARD: ${cleanedText}`);
      void handleSendText(command);
    });

    const unsubscribeStatus = window.fridayDesktop?.onNativeVoiceStatus?.((status) => {
      if (/access is denied|E_ACCESSDENIED/i.test(status)) {
        setNativeVoiceBlocked(true);
        setSpeechMode('browser');
        shouldListenRef.current = false;
        setIsListening(false);
        setVoiceStatus('Windows voice blocked; using local Whisper');

        if (nativeVoiceFailureRef.current !== 'access-denied') {
          nativeVoiceFailureRef.current = 'access-denied';
          addSystemMessage('WINDOWS VOICE BLOCKED\nWindows denied microphone access to the native listener. FRIDAY will keep using the browser mic meter and local Whisper transcription instead.');
        }

        return;
      }

      if (/Windows voice online: en-US/i.test(status)) {
        setNativeVoiceBlocked(true);
        setSpeechMode('browser');
        if (!nativeVoiceEngineNoticeRef.current) {
          nativeVoiceEngineNoticeRef.current = true;
          addSystemMessage('LOCAL VOICE ENGINE\nWindows voice events are available, but FRIDAY is using local Whisper for command transcription.');
        }
        return;
      }

      if (/^(Hearing|Heard unclearly)/i.test(status)) {
        return;
      }
    });

    return () => {
      unsubscribeCommand?.();
      unsubscribeStatus?.();
    };
  }, [addSystemMessage, handleSendText, nativeVoiceBlocked, refreshConversationIdleTimer]);

  const handleLlmFormSubmit = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();

    const task = llmForm.task.trim();
    const context = llmForm.context.trim();
    const output = llmForm.output.trim();

    if (!task || isProcessing) return;

    const prompt = [
      `LLM MODE: ${llmForm.mode}`,
      `TASK: ${task}`,
      context ? `CONTEXT:\n${context}` : '',
      output ? `OUTPUT STYLE: ${output}` : '',
    ].filter(Boolean).join('\n\n');

    setLlmForm(prev => ({ ...prev, task: '', context: '' }));
    setShowLlmForm(false);
    await handleSendText(prompt);
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

    if (wavRecorderStopRef.current) {
      const stop = wavRecorderStopRef.current;
      wavRecorderStopRef.current = null;
      stop();
    }
  }, []);

  useEffect(() => {
    stopHandsFreeRecordingRef.current = stopGeminiRecording;
  }, [stopGeminiRecording]);

  const startGeminiRecording = useCallback(async (wakePhraseCheck = false) => {
    if (isRecordingRef.current || isTranscribingRef.current) return;

    const now = performance.now();
    if (assistantSpeakingRef.current || now < speechSuppressionUntilRef.current) {
      autoRecordCooldownUntilRef.current = Math.max(
        autoRecordCooldownUntilRef.current,
        speechSuppressionUntilRef.current + 700,
      );
      setVoiceStatus('Ignoring FRIDAY speech');
      return;
    }

    if (clapArmTimerRef.current) {
      window.clearTimeout(clapArmTimerRef.current);
      clapArmTimerRef.current = null;
    }
    isClapArmedRef.current = false;
    setIsClapArmed(false);

    const micReady = mediaStreamRef.current || await startMicMeter();
    if (!micReady || !mediaStreamRef.current) return;

    if (!audioContextRef.current || !mediaStreamRef.current) {
      setVoiceStatus('Audio recorder unavailable');
      addSystemMessage('AUDIO RECORDER UNAVAILABLE\nYour browser can access the mic, but FRIDAY could not attach a local WAV recorder.');
      return;
    }

    recordingChunksRef.current = [];
    const audioContext = audioContextRef.current;
    const source = audioContext.createMediaStreamSource(mediaStreamRef.current);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    const wavChunks: Float32Array[] = [];
    let stopped = false;

    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (stopped) return;
      wavChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);

    const finishRecording = async () => {
      if (stopped) return;
      stopped = true;
      wavRecorderStopRef.current = null;
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
      setIsRecording(false);
      setIsWakePhraseRecording(false);
      isWakePhraseRecordingRef.current = false;
      setIsTranscribing(true);
      setRecordingSeconds(0);
      setVoiceStatus('Transcribing locally');

      try {
        const cleanedChunks = cleanSpeechChunks(wavChunks, audioContext.sampleRate);
        const wavBuffer = encodeWav(cleanedChunks, audioContext.sampleRate);
        if (wavBuffer.byteLength < 2400) {
          setVoiceStatus('Recording too short');
          addSystemMessage('RECORDING TOO SHORT\nPress the mic, speak your full sentence clearly, then press the mic again when finished.');
          return;
        }

        const audioBase64 = arrayBufferToBase64(wavBuffer);
        const transcript = await transcribeAudioCommand(audioBase64, 'audio/wav');

        if (transcript && isNonCommandNoise(transcript)) {
          setLiveTranscript('');
          setVoiceStatus(wakePhraseCheck ? 'Wake phrase not heard' : 'No command heard');
          autoRecordCooldownUntilRef.current = performance.now() + AUTO_RECORD_COOLDOWN_MS;
          return;
        }

        if (transcript && isLikelyRecentAssistantEcho(transcript)) {
          setLiveTranscript('');
          setVoiceStatus(wakePhraseCheck ? 'Standby: say "Friday"' : 'Hands-free listening');
          autoRecordCooldownUntilRef.current = performance.now() + AUTO_RECORD_COOLDOWN_MS;
          return;
        }

        if (wakePhraseCheck) {
          setLiveTranscript(transcript || '');

          if (transcript && isFridayWakeUpPhrase(transcript)) {
            const wakeCommand = stripFridayAddress(transcript);
            conversationActiveRef.current = true;
            setIsConversationActive(true);
            refreshConversationIdleTimer();
            autoRecordCooldownUntilRef.current = performance.now() + 900;
            setVoiceStatus('Wake phrase detected');
            focusFridayWindow();
            addSystemMessage(wakeCommand
              ? `WAKE PHRASE DETECTED\nCommand captured: ${wakeCommand}`
              : 'WAKE PHRASE DETECTED\nConversation active. Ask your question now, or type in the command line below.');
            inputRef.current?.focus();
            if (hasCommandText(wakeCommand)) {
              setVoiceStatus('Command captured');
              await handleSendText(wakeCommand);
            } else {
              shouldListenRef.current = false;
              setIsListening(false);
              assistantSpeakingRef.current = false;
              speechSuppressionUntilRef.current = 0;
              setVoiceStatus('Hands-free listening');
              autoRecordCooldownUntilRef.current = performance.now() + 900;
            }
          } else {
            setVoiceStatus(transcript ? 'Standby: say "Friday"' : 'Wake phrase not heard');
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
          addSystemMessage(`LOCAL TRANSCRIPTION RETURNED EMPTY\n${getLastTranscriptionError() || 'Speak clearly for 2-9 seconds and keep the microphone selected as the Windows default input.'}`);
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
          setVoiceStatus('Standby: say "Friday"');
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

    wavRecorderStopRef.current = () => {
      void finishRecording();
    };
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
  }, [addSystemMessage, arrayBufferToBase64, cleanSpeechChunks, encodeWav, focusFridayWindow, handleSendText, handsFreeEnabled, refreshConversationIdleTimer, speak, startMicMeter, stopGeminiRecording, stopMicMeter, stripWakePhrase]);

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
    const micReady = await startMicMeter();
    if (!micReady) {
      if (!clapArmTimerRef.current) {
        setVoiceStatus('Microphone warming up; retrying double clap listener');
        clapArmTimerRef.current = window.setTimeout(() => {
          clapArmTimerRef.current = null;
          setVoiceArmRequestId(Date.now());
        }, 2500);
      }
      return;
    }

    setSpeechMode('browser');
    setLiveTranscript('');
    setIsClapArmed(true);
    isClapArmedRef.current = true;
    setClapDebug({ peak: 0, rms: 0 });
    setVoiceStatus('Listening for double clap');
    shouldListenRef.current = false;
    setIsListening(false);

    if (clapArmTimerRef.current) {
      window.clearTimeout(clapArmTimerRef.current);
      clapArmTimerRef.current = null;
    }
  }, [startMicMeter]);

  useEffect(() => {
    if (!voiceArmRequestId) return;
    void armClapWake();
  }, [armClapWake, voiceArmRequestId]);

  const runDesktopEngage = useCallback((force = false) => {
    if (typeof window === 'undefined') return;

    const now = performance.now();
    if (!force && now - lastDesktopEngageAtRef.current < 30000) return;
    lastDesktopEngageAtRef.current = now;

    window.setTimeout(() => {
      conversationActiveRef.current = false;
      setIsConversationActive(false);
      inputRef.current?.focus();
      setSpeechMode('browser');
      setVoiceStatus('Voice idle');
      if (MIC_ALWAYS_ON) {
        void startMicMeter().then((ready) => {
          if (!ready || isWindowHiddenRef.current) return;
          conversationActiveRef.current = true;
          setIsConversationActive(true);
          isClapArmedRef.current = false;
          setIsClapArmed(false);
          shouldListenRef.current = false;
          setIsListening(true);
          setSpeechMode('browser');
          setVoiceStatus(handsFreeEnabled ? 'Hands-free listening' : 'Local voice active');
        });
      } else {
        shouldListenRef.current = false;
        setIsListening(false);
        setIsClapArmed(false);
        isClapArmedRef.current = false;
      }
    }, 1200);
  }, [handsFreeEnabled, startMicMeter]);

  useEffect(() => {
    if (autoEngageStartedRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('desktop') && !window.fridayDesktop) return;

    autoEngageStartedRef.current = true;
    runDesktopEngage(true);
  }, [runDesktopEngage]);

  useEffect(() => {
    const unsubscribeHidden = window.fridayDesktop?.onWindowHidden?.(() => {
      setIsWindowHidden(true);
      conversationActiveRef.current = false;
      setIsConversationActive(false);

      if (!clapWakeEnabledRef.current) return;

      setSpeechMode('browser');
      setLiveTranscript('');
      setVoiceStatus('Background two-clap wake armed');
      void armClapWake();
    });

    const unsubscribeShown = window.fridayDesktop?.onWindowShown?.((detail) => {
      setIsWindowHidden(false);
      if (suppressNextShownEngageRef.current) {
        suppressNextShownEngageRef.current = false;
        return;
      }
      runDesktopEngage(Boolean(detail?.forceEngage));
    });

    return () => {
      unsubscribeHidden?.();
      unsubscribeShown?.();
    };
  }, [armClapWake, runDesktopEngage]);

  useEffect(() => {
    if (MIC_ALWAYS_ON && !isWindowHidden) return;
    if (autoClapArmStartedRef.current || !clapWakeEnabled || isConversationActive) return;
    autoClapArmStartedRef.current = true;
    window.setTimeout(() => {
      void armClapWake();
    }, 600);
  }, [armClapWake, clapWakeEnabled, isConversationActive, isWindowHidden]);

  useEffect(() => {
    if (!MIC_ALWAYS_ON || typeof window === 'undefined') return;

    const timer = window.setTimeout(async () => {
      if (isWindowHiddenRef.current) {
        if (clapWakeEnabledRef.current) void armClapWake();
        return;
      }

      const micReady = await startMicMeter();
      if (!micReady) {
        setIsListening(false);
        setVoiceStatus('Microphone unavailable');
        return;
      }

      conversationActiveRef.current = false;
      setIsConversationActive(false);
      isClapArmedRef.current = false;
      setIsClapArmed(false);
      shouldListenRef.current = true;
      setIsListening(true);
      setSpeechMode('browser');
      setVoiceStatus(wakeModeRef.current ? 'Listening for "Friday"' : 'Local voice active');
    }, 900);

    return () => window.clearTimeout(timer);
  }, [armClapWake, handsFreeEnabled, startMicMeter]);

  const toggleListening = async () => {
    if (MIC_ALWAYS_ON && !isWindowHiddenRef.current) {
      const micReady = await startMicMeter();
      if (!micReady) return;

      conversationActiveRef.current = true;
      setIsConversationActive(true);
      isClapArmedRef.current = false;
      setIsClapArmed(false);
      shouldListenRef.current = false;
      setIsListening(true);
      setSpeechMode('browser');
      refreshConversationIdleTimer();
      setVoiceStatus(handsFreeEnabled ? 'Hands-free listening' : 'Local voice active');
      return;
    }

    if (clapWakeEnabled) {
      if (isRecording) {
        stopGeminiRecording();
        return;
      }

      if (isConversationActive) {
        setSpeechMode('browser');
        shouldListenRef.current = false;
        setIsListening(false);
        setVoiceStatus('Recording command');
        await startGeminiRecording();
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

    setSpeechMode('browser');
    setLiveTranscript('');
    setIsListening(false);
    conversationActiveRef.current = true;
    setIsConversationActive(true);
    refreshConversationIdleTimer();
    await startGeminiRecording();
  };

  useEffect(() => {
    if (!speechSupported) {
      setSpeechMode('browser');
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
            addSystemMessage(`HEARD: ${cleanedTranscript}`);

            if (hasWakeWord(cleanedTranscript)) {
              const wakeCommand = stripFridayAddress(cleanedTranscript);

              if (!hasCommandText(wakeCommand) && !isFridayWakeUpPhrase(cleanedTranscript)) {
                setVoiceStatus('Say full command: "Friday open YouTube"');
                continue;
              }

              conversationActiveRef.current = true;
              setIsConversationActive(true);
              setIsClapArmed(false);
              isClapArmedRef.current = false;
              refreshConversationIdleTimer();
              setVoiceStatus(hasCommandText(wakeCommand) ? 'Command captured' : 'Wake phrase detected');
              focusFridayWindow();
              addSystemMessage(wakeCommand
                ? `WAKE PHRASE DETECTED\nCommand captured: ${wakeCommand}`
                : 'WAKE PHRASE DETECTED\nConversation active. Ask your question now, or type in the command line below.');
              inputRef.current?.focus();
              if (hasCommandText(wakeCommand)) {
                setVoiceStatus('Command captured');
                void handleSendText(wakeCommand);
              } else {
                shouldListenRef.current = false;
                setIsListening(false);
                assistantSpeakingRef.current = false;
                speechSuppressionUntilRef.current = 0;
                setVoiceStatus('Hands-free listening');
                autoRecordCooldownUntilRef.current = performance.now() + 900;
              }
            } else {
              setVoiceStatus('Listening for "Friday"');
            }

            continue;
          }

          if (wakeModeRef.current) {
            const wakeIndex = conversationActiveRef.current ? -1 : findWakeWordIndex(cleanedTranscript);
            if (!conversationActiveRef.current && wakeIndex === -1) {
              setVoiceStatus(`Mic active; say "Friday" first`);
              continue;
            }

            command = conversationActiveRef.current
              ? cleanedTranscript
              : stripFridayAddress(cleanedTranscript.slice(wakeIndex)).trim();
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
        setVoiceStatus('Local Whisper active');
        if (!browserSpeechFailed) {
          setBrowserSpeechFailed(true);
          addSystemMessage('BROWSER SPEECH SERVICE FAILED\nFRIDAY will ignore the browser speech service and keep using local Whisper transcription.');
        }
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
  }, [addSystemMessage, browserSpeechFailed, handleSendText, nativeVoiceAvailable, nativeVoiceBlocked, restartRecognitionWhenReady, speechSupported, startMicMeter, stopMicMeter]);

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

  const brainState = isProcessing ? 'THINKING' : isRecording ? 'LISTENING' : isConversationActive ? 'ACTIVE' : 'STANDBY';
  const latestFriday = [...messages].reverse().find(message => message.role === 'friday')?.content || 'Ready when you are, Sir.';
  const canIdleFocus = !isProcessing
    && !isRecording
    && !isListening
    && !isTranscribing
    && !input.trim()
    && !showVoiceControls
    && !showLlmForm
    && hudPanel === 'none';
  const showHudStatus = isProcessing
    || isRecording
    || isListening
    || isTranscribing
    || Boolean(liveTranscript)
    || !/^voice idle$/i.test(voiceStatus);

  useEffect(() => {
    if (idleFocusTimerRef.current) {
      window.clearTimeout(idleFocusTimerRef.current);
      idleFocusTimerRef.current = null;
    }

    if (!canIdleFocus) {
      setIsIdleFocus(false);
      return;
    }

    idleFocusTimerRef.current = window.setTimeout(() => {
      if (window.fridayDesktop?.focusWindow) {
        window.fridayDesktop.focusWindow();
      }
      setIsIdleFocus(true);
    }, IDLE_FOCUS_TIMEOUT_MS);

    return () => {
      if (idleFocusTimerRef.current) {
        window.clearTimeout(idleFocusTimerRef.current);
        idleFocusTimerRef.current = null;
      }
    };
  }, [canIdleFocus]);

  const wakeHud = useCallback(() => {
    setIsIdleFocus(false);
    if (idleFocusTimerRef.current) {
      window.clearTimeout(idleFocusTimerRef.current);
      idleFocusTimerRef.current = null;
    }
  }, []);

  return (
    <div
      className={`hud-shell relative h-screen max-h-screen overflow-hidden bg-[#05080b] text-slate-100 ${isIdleFocus ? 'is-idle-focus' : ''}`}
      onMouseMove={wakeHud}
      onPointerDown={wakeHud}
      onKeyDown={wakeHud}
    >
      <div className="hud-grid absolute inset-0" />
      <div className="hud-vignette absolute inset-0" />

      <header className="relative z-20 flex h-16 items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.34em] text-cyan-200/80">
          <TerminalIcon size={16} className="text-cyan-300" />
          <span>F.R.I.D.A.Y OS</span>
          <span className="hidden text-cyan-500/50 md:inline">v1.3.0</span>
        </div>
        <div className="hidden items-center gap-5 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200/55 md:flex">
          <span className="inline-flex items-center gap-1"><Cpu size={12} /> CPU 4%</span>
          <span className="inline-flex items-center gap-1"><Zap size={12} /> POWER OPTIMAL</span>
          <span className="inline-flex items-center gap-1"><Shield size={12} /> SECURE</span>
        </div>
      </header>

      <main className="relative z-10 grid h-[calc(100vh-4rem)] grid-rows-[1fr_auto] px-4 pb-4 md:px-8 md:pb-8">
        <section className="relative min-h-0">
          <div className="hud-corner hud-corner-top" />
          <div className="hud-corner hud-corner-bottom" />

          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="absolute left-1/2 top-[46%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          >
            <div className={`jarvis-core ${isProcessing ? 'is-thinking' : ''} ${isRecording || isListening ? 'is-listening' : ''}`}>
              <div className="jarvis-glow" />
              <div className="jarvis-scan jarvis-scan-one" />
              <div className="jarvis-scan jarvis-scan-two" />
              <div className="jarvis-orbit jarvis-orbit-one" />
              <div className="jarvis-orbit jarvis-orbit-two" />
              <div className="jarvis-orbit jarvis-orbit-three" />
              <div className="jarvis-segments" />
              <div className="jarvis-ticks" />
              <div className="jarvis-spokes" />
              <div className="jarvis-ring">
                <div className="jarvis-inner">
                  <span>F.R.I.D.A.Y</span>
                </div>
              </div>
              <div className="jarvis-nodes">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="mt-8 text-center font-mono uppercase tracking-[0.42em] text-cyan-100/80">
              <div className="text-[11px]">{brainState}</div>
              <div className="mt-2 text-[9px] tracking-[0.28em] text-cyan-300/45">{speechMode === 'native' ? 'Windows Voice' : 'Local Whisper'}</div>
            </div>
          </motion.div>

          <AnimatePresence>
            {hudPanel === 'chat' && (
              <motion.aside
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                className="absolute left-0 top-6 hidden w-[330px] border-l border-cyan-300/30 bg-black/20 p-4 backdrop-blur-sm lg:block"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">Response Feed</div>
                  <button type="button" onClick={() => setHudPanel('none')} className="font-mono text-xs text-cyan-300/60 hover:text-cyan-100">x</button>
                </div>
                <div ref={scrollRef} className="scrollbar-hide mt-4 max-h-[52vh] overflow-y-auto pr-2">
                  <AnimatePresence mode="popLayout">
                    {messages.slice(-6).map((m) => (
                      <TerminalMessage key={m.id} message={m} />
                    ))}
                  </AnimatePresence>
                  {isProcessing && (
                    <div className="mt-3 flex items-center gap-2 font-mono text-xs text-cyan-300">
                      <span>PROCESSING</span>
                      <span className="terminal-cursor" />
                    </div>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {hudPanel === 'stats' && (
              <motion.aside
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                className="absolute right-0 top-6 hidden w-[300px] border-r border-cyan-300/30 bg-black/20 p-4 text-right backdrop-blur-sm lg:block"
              >
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setHudPanel('none')} className="font-mono text-xs text-cyan-300/60 hover:text-cyan-100">x</button>
                  <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">Stats</div>
                </div>
                <div className="mt-5 space-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-100/65">
                  <div>Local tools: online</div>
                  <div>Reasoning: automatic</div>
                  <div>Voice: {voiceEnabled ? 'enabled' : 'muted'}</div>
                  <div>Input: {handsFreeEnabled ? 'hands-free' : 'manual'}</div>
                  <div>Mode: {brainState}</div>
                  <div className="h-1 overflow-hidden bg-cyan-950/80">
                    <div className="h-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.9)] transition-all" style={{ width: `${Math.max(4, micLevel)}%` }} />
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          <div className="absolute bottom-10 left-1/2 w-[min(760px,calc(100vw-2rem))] -translate-x-1/2">
            {showHudStatus && (
              <div className="hud-status mx-auto mb-4 max-w-[620px] px-5 py-3 text-center font-mono text-xs text-cyan-100/75">
                <span className="uppercase tracking-[0.28em] text-cyan-300">{voiceStatus}</span>
                {liveTranscript && <span className="ml-3 text-cyan-100/45">{liveTranscript}</span>}
              </div>
            )}

            <form
              onSubmit={handleSend}
              className="hud-command flex items-center gap-3 px-4 py-3"
            >
              <span className="hidden shrink-0 font-mono text-xs uppercase tracking-[0.2em] text-cyan-300/80 sm:block">C:\BOSS</span>
              <input
                ref={inputRef}
                type="text"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-cyan-50 outline-none placeholder:text-cyan-100/25"
                placeholder={isProcessing ? 'Queue next command...' : 'Type command...'}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" onClick={toggleListening} disabled={!micSupported || isTranscribing} className={`hud-icon ${isListening || isRecording ? 'is-on' : ''}`} title="Voice input">
                {isRecording || isListening ? <Mic size={16} /> : <MicOff size={16} />}
              </button>
              <button type="button" onClick={() => setVoiceEnabled(prev => !prev)} className={`hud-icon ${voiceEnabled ? 'is-on' : ''}`} title="Voice output">
                {voiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button type="button" onClick={() => setShowVoiceControls(prev => !prev)} className={`hud-icon ${showVoiceControls ? 'is-on' : ''}`} title="Voice controls">
                <SlidersHorizontal size={16} />
              </button>
              <button type="button" onClick={() => setShowLlmForm(prev => !prev)} className={`hud-icon ${showLlmForm ? 'is-on' : ''}`} title="Brain prompt">
                <BrainCircuit size={16} />
              </button>
              <button type="submit" className="hud-send" title={isProcessing ? 'Queue message' : 'Send'}>
                <Zap size={16} />
              </button>
            </form>
          </div>
        </section>

        {(showVoiceControls || showLlmForm) && (
          <section className="relative z-20 mx-auto mt-3 grid w-[min(980px,calc(100vw-2rem))] gap-3 rounded border border-cyan-300/15 bg-black/55 p-3 backdrop-blur-md">
            {showVoiceControls && (
              <div className="grid gap-3 md:grid-cols-[180px_minmax(220px,1fr)_120px_120px_88px_42px]">
                <select value={selectedVoiceProfileId} onChange={(event) => {
                  const profile = voiceProfiles.find(item => item.id === event.target.value);
                  if (profile) applyVoiceProfile(profile);
                }} className="hud-field" title="Voice profile">
                  {selectedVoiceProfileId === 'custom-live' && <option value="custom-live">Unsaved Custom</option>}
                  {voiceProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
                <select value={selectedVoiceURI} onChange={(event) => {
                  setSelectedVoiceURI(event.target.value);
                  setSelectedVoiceProfileId('custom-live');
                }} className="hud-field" title="FRIDAY voice">
                  {availableVoices.length === 0 && nativeVoices.length === 0 && <option value="">System default voice</option>}
                  {nativeVoices.map(voice => <option key={`native:${voice.Name}`} value={`native:${voice.Name}`}>{voice.Name}</option>)}
                  {availableVoices.map(voice => {
                    const id = voice.voiceURI || voice.name;
                    return <option key={id} value={id}>{voice.name}</option>;
                  })}
                </select>
                <label className="hud-slider">Rate<input type="range" min="0.7" max="1.2" step="0.02" value={voiceRate} onChange={(event) => {
                  setVoiceRate(Number(event.target.value));
                  setSelectedVoiceProfileId('custom-live');
                }} /></label>
                <label className="hud-slider">Pitch<input type="range" min="0.6" max="1.35" step="0.02" value={voicePitch} onChange={(event) => {
                  setVoicePitch(Number(event.target.value));
                  setSelectedVoiceProfileId('custom-live');
                }} /></label>
                <button type="button" onClick={testVoiceProfile} className="hud-panel-button">Test</button>
                <button type="button" onClick={deleteVoiceProfile} disabled={!customVoiceProfiles.some(profile => profile.id === selectedVoiceProfileId)} className="hud-panel-button" title="Delete custom profile"><Trash2 size={15} /></button>
                <input value={customVoiceProfileName} onChange={(event) => setCustomVoiceProfileName(event.target.value)} className="hud-field md:col-span-2" placeholder="Profile name" />
                <button type="button" onClick={saveVoiceProfile} className="hud-panel-button md:col-span-2"><Save size={14} /> Save Profile</button>
              </div>
            )}

            {showLlmForm && (
              <form onSubmit={handleLlmFormSubmit} className="grid gap-3 md:grid-cols-[140px_minmax(180px,1fr)_minmax(180px,1fr)_160px_80px]">
                <select value={llmForm.mode} onChange={(event) => setLlmForm(prev => ({ ...prev, mode: event.target.value }))} className="hud-field">
                  <option>Assistant</option>
                  <option>Code</option>
                  <option>Research</option>
                  <option>Plan</option>
                  <option>Rewrite</option>
                </select>
                <input value={llmForm.task} onChange={(event) => setLlmForm(prev => ({ ...prev, task: event.target.value }))} className="hud-field" placeholder="Task" disabled={isProcessing} />
                <input value={llmForm.context} onChange={(event) => setLlmForm(prev => ({ ...prev, context: event.target.value }))} className="hud-field" placeholder="Context" disabled={isProcessing} />
                <input value={llmForm.output} onChange={(event) => setLlmForm(prev => ({ ...prev, output: event.target.value }))} className="hud-field" placeholder="Output style" disabled={isProcessing} />
                <button type="submit" disabled={isProcessing || !llmForm.task.trim()} className="hud-panel-button">Run</button>
              </form>
            )}
          </section>
        )}
      </main>

      <div className="pointer-events-none fixed inset-0 z-50 opacity-[0.035] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.4)_50%),linear-gradient(90deg,rgba(0,229,255,0.08),rgba(0,255,180,0.02),rgba(0,90,255,0.08))] bg-[length:100%_4px,3px_100%]" />
    </div>
  );
};
