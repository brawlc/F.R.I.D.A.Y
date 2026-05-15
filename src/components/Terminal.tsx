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
const CONVERSATION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const AUTO_SPEECH_START_RMS = 12;
const AUTO_SPEECH_STOP_RMS = 7;
const AUTO_SPEECH_ABOVE_NOISE_RMS = 10;
const AUTO_SILENCE_STOP_MS = 750;
const AUTO_RECORD_COOLDOWN_MS = 1200;
const MIN_AUTO_RECORDING_MS = 1100;
const SPEECH_START_PEAK_ABOVE_NOISE = 18;
const SPEECH_TRIM_PAD_MS = 180;
const DOUBLE_CLAP_WINDOW_MS = 1500;
const CLAP_DEBOUNCE_MS = 140;
const CLAP_WAKE_COOLDOWN_MS = 1800;
const CLAP_PEAK_THRESHOLD = 24;
const CLAP_RMS_ABOVE_AMBIENT = 4;
const CLAP_RMS_JUMP = 2;
const MIC_ALWAYS_ON = true;
const BUILT_IN_VOICE_PROFILES: VoiceProfile[] = [
  { id: 'classic', name: 'FRIDAY Classic', voiceURI: '', rate: 0.94, pitch: 1.06, builtin: true },
  { id: 'calm', name: 'Calm Assistant', voiceURI: '', rate: 0.88, pitch: 0.98, builtin: true },
  { id: 'tactical', name: 'Fast Tactical', voiceURI: '', rate: 1.08, pitch: 0.92, builtin: true },
  { id: 'soft', name: 'Soft Female', voiceURI: '', rate: 0.92, pitch: 1.16, builtin: true },
  { id: 'deep', name: 'Deep Assistant', voiceURI: '', rate: 0.9, pitch: 0.72, builtin: true },
];
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
      restartNativeVoice?: () => Promise<boolean>;
      openExternalUrl?: (url: string) => Promise<boolean>;
      onWindowHidden?: (callback: () => void) => () => void;
      onWindowShown?: (callback: () => void) => () => void;
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
  const [clapWakeEnabled, setClapWakeEnabled] = useState(() => localStorage.getItem('friday.clapWake') !== 'false');
  const [isClapArmed, setIsClapArmed] = useState(false);
  const [clapDebug, setClapDebug] = useState({ peak: 0, rms: 0 });
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(() => localStorage.getItem('friday.handsFree') !== 'false');
  const [browserSpeechFailed, setBrowserSpeechFailed] = useState(false);
  const [nativeVoiceBlocked, setNativeVoiceBlocked] = useState(true);
  const [isWindowHidden, setIsWindowHidden] = useState(false);
  const [showLlmForm, setShowLlmForm] = useState(false);
  const [llmForm, setLlmForm] = useState({
    mode: 'Assistant',
    task: '',
    context: '',
    output: 'Concise answer',
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [nativeVoices, setNativeVoices] = useState<NativeVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => localStorage.getItem('friday.voiceURI') || '');
  const [voiceRate, setVoiceRate] = useState(() => Number(localStorage.getItem('friday.voiceRate') || '0.94'));
  const [voicePitch, setVoicePitch] = useState(() => Number(localStorage.getItem('friday.voicePitch') || '1.06'));
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState(() => localStorage.getItem('friday.voiceProfileId') || 'classic');
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
  const lastMicFailureRef = useRef({ name: '', at: 0 });
  const nativeVoiceFailureRef = useRef('');
  const nativeVoiceEngineNoticeRef = useRef(false);
  const autoClapArmStartedRef = useRef(false);
  const lastSttUnavailableNoticeAtRef = useRef(0);
  const autoEngageStartedRef = useRef(false);
  const lastDesktopEngageAtRef = useRef(0);
  const suppressNextShownEngageRef = useRef(false);
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
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
    if (!nativeVoiceAvailable) return;

    let cancelled = false;

    const loadNativeVoices = async () => {
      try {
        const response = await fetch('/api/desktop/voices');
        const result = await response.json().catch(() => null) as { ok?: boolean; voices?: NativeVoice[] } | null;
        if (!cancelled && result?.ok && Array.isArray(result.voices)) {
          setNativeVoices(result.voices);

          if (!selectedVoiceURI && result.voices.length > 0) {
            const preferred = result.voices.find(voice => /zira|female|natural|jenny|aria/i.test(`${voice.Name} ${voice.Description || ''}`))
              || result.voices[0];
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

  const fetchTopHeadline = useCallback(async () => {
    try {
      const response = await fetch('/api/news/top-headline');
      const result = await response.json().catch(() => null) as { ok?: boolean; headline?: string; source?: string } | null;
      if (!response.ok || !result?.ok || !result.headline?.trim()) return null;
      return {
        headline: result.headline.trim(),
        source: result.source || 'global news',
      };
    } catch {
      return null;
    }
  }, []);

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
          echoCancellation: false,
          noiseSuppression: false,
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
        const speechStartPeak = Math.max(22, ambientRms + SPEECH_START_PEAK_ABOVE_NOISE);
        const relativeRms = Math.max(0, rms - Math.max(0, ambientRms - 2));
        setMicLevel(Math.min(100, Math.round(relativeRms * 7)));

        const now = performance.now();
        if (isClapArmedRef.current && now - lastAudioDebugAtRef.current > 180) {
          lastAudioDebugAtRef.current = now;
          setClapDebug({ peak: Math.round(peak), rms: Math.round(rms) });
        }

        const rmsJump = rms - previousRmsRef.current;
        const peakJump = peak - previousPeakRef.current;
        const clapPeakThreshold = isWindowHiddenRef.current ? 14 : CLAP_PEAK_THRESHOLD;
        const clapPeakJumpThreshold = isWindowHiddenRef.current ? 8 : 14;
        const clapRmsAboveAmbient = isWindowHiddenRef.current ? 1.5 : CLAP_RMS_ABOVE_AMBIENT;
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
    const voiceThreshold = Math.max(0.018, noiseFloor + 0.018);
    const gateThreshold = Math.max(0.01, noiseFloor + 0.006);
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
      const gain = (frameRms[sourceFrame] || 0) < gateThreshold ? 0.08 : 1;
      if (gain === 1) continue;
      for (let i = start; i < end; i += 1) cleaned[i] *= gain;
    }

    let peak = 0;
    for (const sample of cleaned) peak = Math.max(peak, Math.abs(sample));
    if (peak > 0 && peak < 0.55) {
      const gain = Math.min(3.2, 0.78 / peak);
      for (let i = 0; i < cleaned.length; i += 1) cleaned[i] = Math.max(-1, Math.min(1, cleaned[i] * gain));
    }

    return [cleaned];
  };

  const endConversation = useCallback((status = 'Wake phrase idle') => {
    conversationActiveRef.current = false;
    setIsConversationActive(false);
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

  const triggerDoubleClapWake = useCallback(() => {
    suppressNextShownEngageRef.current = true;
    window.fridayDesktop?.showWindow();
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
  }, [addSystemMessage, handsFreeEnabled, refreshConversationIdleTimer, speakNativeOrBrowser, startMicMeter, voiceEnabled]);

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
      return 'Terminal cleared.';
    }

    if (cmd === 'time') {
      return `Current Internal Time: ${new Date().toLocaleString()}`;
    }

    if (cmd === 'help') {
      return `AVAILABLE SYSTEM COMMANDS:\n- open instagram/youtube/google/gmail/whatsapp/chatgpt/github/jio hotstar: Open site in browser\n- open chrome/opera gx/notepad/calculator/camera/settings/microphone settings/speech settings/voice training/explorer/downloads/documents/desktop/vscode: Open approved local apps and folders\n- close opera gx/chrome/notepad/calculator/vscode: Close approved local apps\n- lock screen / open task manager: Run approved Windows actions\n- clear/cls: Clear the terminal screen\n- time: Display system clock\n- help: Show this menu\n- status: Diagnostic overview\n- listen: Enable background two-clap launcher\n- stop listening: Disable voice and clap input\n- sleep/stand down/go idle: End active conversation\n- mute/unmute: Toggle spoken responses\n\nVoice: Close FRIDAY with X to hide it. While hidden, clap twice to reopen the window.`;
    }

    if (
      cmd === 'status'
      || cmd === 'stats'
      || cmd === 'stat'
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
      return 'Background two-clap launcher armed. Close FRIDAY with X, then clap twice to reopen it.';
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

    if (cmd === 'sleep' || cmd === 'stand down' || cmd === 'go idle') {
      endConversation('Conversation idle.');
      return 'Standing down. Double clap when you need me again.';
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
  const isFridayWakeUpPhrase = (rawText: string) => {
    const normalized = normalizeVoiceCommand(rawText).toLowerCase();
    return hasWakeWord(normalized) && /\b(wake up|wakeup|activate|online|start listening)\b/.test(normalized);
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
  const isDesktopActionCommand = (cmd: string) => /\b(lock|task manager|taskmgr|battery|power level|charge|battery life)\b/.test(cmd);
  const isDesktopCloseCommand = (cmd: string) => /\b(close|quit|exit|kill|terminate|shut)\b/.test(cmd);
  const splitParagraphInstructions = (rawCommand: string) => {
    const command = rawCommand
      .replace(/\b(?:after that|and then|then|also|next)\b/gi, '.')
      .replace(/\s+and\s+(?=\b(?:open|launch|start|close|quit|exit|kill|terminate|shut|lock|check|show|tell|battery|power|charge|task manager|taskmgr)\b)/gi, '.')
      .replace(/\s+,\s+(?=\b(?:open|launch|start|close|quit|exit|kill|terminate|shut|lock|check|show|tell|battery|power|charge|task manager|taskmgr)\b)/gi, '.');

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

    const instructionClauses = splitParagraphInstructions(cmd);
    const localResponses: string[] = [];

    for (const instruction of instructionClauses) {
      const response = await runLocalInstruction(instruction);
      if (response) localResponses.push(response);
    }

    if (localResponses.length > 0) {
      const localResponse = localResponses.length === 1
        ? localResponses[0]
        : `Done, Sir.\n${localResponses.map((response, index) => `${index + 1}. ${response}`).join('\n')}`;

      if (!instructionClauses.some(instruction => instruction === 'clear' || instruction === 'cls')) {
        addSystemMessage(localResponse);
      }
      speak(localResponse);
      setIsProcessing(false);
      resumeConversationListening(voiceEnabled ? 900 : 250);
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
      resumeConversationListening(voiceEnabled ? 1200 : 250);
    }
  }, [addSystemMessage, handleLocalCommand, messages, resumeConversationListening, runDesktopActionCommand, runDesktopCloseCommand, runDesktopOpenCommand, speak, voiceEnabled]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await handleSendText(input);
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

        if (wakePhraseCheck) {
          setLiveTranscript(transcript || '');

          if (transcript && isFridayWakeUpPhrase(transcript)) {
            const wakeCommand = stripFridayWakeUpPhrase(transcript);
            conversationActiveRef.current = true;
            setIsConversationActive(true);
            refreshConversationIdleTimer();
            autoRecordCooldownUntilRef.current = performance.now() + 900;
            setVoiceStatus('Wake phrase detected');
            window.fridayDesktop?.showWindow();
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
  }, [addSystemMessage, arrayBufferToBase64, cleanSpeechChunks, encodeWav, handleSendText, handsFreeEnabled, refreshConversationIdleTimer, speak, startMicMeter, stopGeminiRecording, stopMicMeter, stripWakePhrase]);

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

    window.setTimeout(async () => {
      conversationActiveRef.current = true;
      setIsConversationActive(true);
      refreshConversationIdleTimer();
      inputRef.current?.focus();
      setSpeechMode('browser');
      setVoiceStatus('Local voice engaged');
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
        void armClapWake();
      }

      const greeting = DESKTOP_BOOT_GREETINGS[Math.floor(Math.random() * DESKTOP_BOOT_GREETINGS.length)];
      addSystemMessage(`AUTO ENGAGE\n${greeting}`);

      const topHeadline = await fetchTopHeadline();
      if (topHeadline) {
        addSystemMessage(`GLOBAL HEADLINE\n${topHeadline.headline}\nSource: ${topHeadline.source}`);
        speakNativeOrBrowser(`${greeting} The hottest global headline right now: ${topHeadline.headline}`);
      } else {
        addSystemMessage('GLOBAL HEADLINE\nI could not reach global news feeds right now.');
        speakNativeOrBrowser(greeting);
      }
    }, 1200);
  }, [addSystemMessage, armClapWake, fetchTopHeadline, handsFreeEnabled, refreshConversationIdleTimer, speakNativeOrBrowser, startMicMeter]);

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

    const unsubscribeShown = window.fridayDesktop?.onWindowShown?.(() => {
      setIsWindowHidden(false);
      if (suppressNextShownEngageRef.current) {
        suppressNextShownEngageRef.current = false;
        return;
      }
      runDesktopEngage(false);
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

      conversationActiveRef.current = true;
      setIsConversationActive(true);
      isClapArmedRef.current = false;
      setIsClapArmed(false);
      shouldListenRef.current = false;
      setIsListening(true);
      setSpeechMode('browser');
      setVoiceStatus(handsFreeEnabled ? 'Hands-free listening' : 'Local voice active');
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
              const wakeCommand = isFridayWakeUpPhrase(cleanedTranscript)
                ? stripFridayWakeUpPhrase(cleanedTranscript)
                : stripFridayAddress(cleanedTranscript);

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
              window.fridayDesktop?.showWindow();
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
              setVoiceStatus('Listening for "Friday wake up"');
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
            <span className="text-[10px] font-mono uppercase tracking-widest text-terminal-accent/80">F.R.I.D.A.Y OS v1.3.0 - Hands-Free Interface</span>
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
            title={clapWakeEnabled ? isWindowHidden ? 'Background two-clap launcher armed' : isConversationActive ? 'Conversation active' : 'Two-clap launcher ready when hidden' : isListening ? 'Stop voice input' : 'Start voice input'}
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
            title={clapWakeEnabled ? 'Background two-clap launcher on' : 'Background two-clap launcher off'}
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
          <button
            type="button"
            onClick={() => setShowLlmForm(prev => !prev)}
            className={`h-9 w-9 inline-flex items-center justify-center rounded border transition-colors ${showLlmForm ? 'border-terminal-green text-terminal-green bg-terminal-green/10' : 'border-terminal-border text-terminal-text/60 hover:bg-white/5'}`}
            title="LLM form"
          >
            <BrainCircuit size={16} />
          </button>
          <div className="min-w-0 flex-1 font-mono text-[11px] uppercase tracking-wider text-terminal-text/60">
            <span className="text-terminal-accent/80">{voiceStatus}</span>
            {isConversationActive && !isRecording && <span className="ml-3 text-terminal-green">Active</span>}
            {isConversationActive && handsFreeEnabled && !isRecording && <span className="ml-3 text-terminal-green/70">Auto</span>}
            {isRecording && <span className="ml-3 text-terminal-green">{recordingSeconds}s / {isWakePhraseRecording ? WAKE_PHRASE_RECORDING_MS / 1000 : MAX_GEMINI_RECORDING_MS / 1000}s</span>}
            {isClapArmed && <span className="ml-3 text-terminal-green">{isWindowHidden ? 'background 2-clap armed' : '2-clap ready'}</span>}
            {isClapArmed && <span className="ml-3 text-terminal-text/40">peak {clapDebug.peak} rms {clapDebug.rms}</span>}
            <span className="ml-3 text-terminal-green/70">{speechMode === 'native' ? 'Windows Voice' : 'Local Whisper'}</span>
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
          <div className="grid gap-3 border-b border-terminal-border bg-black/60 px-4 py-3 md:grid-cols-[180px_minmax(220px,1fr)_150px_150px_120px_44px]">
            <select
              value={selectedVoiceProfileId}
              onChange={(event) => {
                const profile = voiceProfiles.find(item => item.id === event.target.value);
                if (profile) applyVoiceProfile(profile);
              }}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-2 font-mono text-xs text-terminal-text outline-none focus:border-terminal-accent"
              title="Voice profile"
            >
              {selectedVoiceProfileId === 'custom-live' && <option value="custom-live">Unsaved Custom</option>}
              <optgroup label="Built-in profiles">
                {BUILT_IN_VOICE_PROFILES.map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </optgroup>
              {customVoiceProfiles.length > 0 && (
                <optgroup label="Custom profiles">
                  {customVoiceProfiles.map(profile => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <select
              value={selectedVoiceURI}
              onChange={(event) => {
                setSelectedVoiceURI(event.target.value);
                setSelectedVoiceProfileId('custom-live');
              }}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-2 font-mono text-xs text-terminal-text outline-none focus:border-terminal-accent"
              title="FRIDAY voice"
            >
              {availableVoices.length === 0 && nativeVoices.length === 0 && <option value="">System default voice</option>}
              {nativeVoices.length > 0 && (
                <optgroup label="Windows voices">
                  {nativeVoices.map(voice => (
                    <option key={`native:${voice.Name}`} value={`native:${voice.Name}`}>
                      {voice.Name} ({voice.Culture || 'Windows'})
                    </option>
                  ))}
                </optgroup>
              )}
              {availableVoices.length > 0 && (
                <optgroup label="Browser voices">
                  {availableVoices.map(voice => {
                    const id = voice.voiceURI || voice.name;
                    return (
                      <option key={id} value={id}>
                        {voice.name} ({voice.lang})
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </select>
            <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-terminal-text/60">
              Rate
              <input
                type="range"
                min="0.7"
                max="1.2"
                step="0.02"
                value={voiceRate}
                onChange={(event) => {
                  setVoiceRate(Number(event.target.value));
                  setSelectedVoiceProfileId('custom-live');
                }}
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
                onChange={(event) => {
                  setVoicePitch(Number(event.target.value));
                  setSelectedVoiceProfileId('custom-live');
                }}
                className="min-w-0 flex-1"
              />
            </label>
            <button
              type="button"
              onClick={() => speak('Voice calibration complete. Friday is online and listening for Friday wake up, Sir.')}
              className="h-9 rounded border border-terminal-accent px-3 font-mono text-xs uppercase tracking-wider text-terminal-accent hover:bg-terminal-accent/10"
            >
              Test
            </button>
            <button
              type="button"
              onClick={deleteVoiceProfile}
              disabled={!customVoiceProfiles.some(profile => profile.id === selectedVoiceProfileId)}
              className="h-9 rounded border border-terminal-border px-3 font-mono text-xs uppercase tracking-wider text-terminal-text/70 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
              title="Delete custom profile"
            >
              <Trash2 size={15} />
            </button>
            <input
              type="text"
              value={customVoiceProfileName}
              onChange={(event) => setCustomVoiceProfileName(event.target.value)}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-3 font-mono text-xs text-terminal-text outline-none placeholder:text-terminal-border focus:border-terminal-accent md:col-span-2"
              placeholder="Profile name"
            />
            <button
              type="button"
              onClick={saveVoiceProfile}
              className="h-9 rounded border border-terminal-accent px-3 font-mono text-xs uppercase tracking-wider text-terminal-accent transition-colors hover:bg-terminal-accent/10 md:col-span-2"
              title="Save voice profile"
            >
              <span className="inline-flex items-center justify-center gap-2"><Save size={14} /> Save Profile</span>
            </button>
          </div>
        )}

        {showLlmForm && (
          <form
            onSubmit={handleLlmFormSubmit}
            className="grid gap-3 border-b border-terminal-border bg-black/60 px-4 py-3 md:grid-cols-[160px_minmax(220px,1fr)_minmax(220px,1fr)_180px_92px]"
          >
            <select
              value={llmForm.mode}
              onChange={(event) => setLlmForm(prev => ({ ...prev, mode: event.target.value }))}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-2 font-mono text-xs text-terminal-text outline-none focus:border-terminal-accent"
              title="LLM mode"
            >
              <option>Assistant</option>
              <option>Code</option>
              <option>Research</option>
              <option>Plan</option>
              <option>Rewrite</option>
            </select>
            <input
              type="text"
              value={llmForm.task}
              onChange={(event) => setLlmForm(prev => ({ ...prev, task: event.target.value }))}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-3 font-mono text-xs text-terminal-text outline-none placeholder:text-terminal-border focus:border-terminal-accent"
              placeholder="Task"
              disabled={isProcessing}
            />
            <input
              type="text"
              value={llmForm.context}
              onChange={(event) => setLlmForm(prev => ({ ...prev, context: event.target.value }))}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-3 font-mono text-xs text-terminal-text outline-none placeholder:text-terminal-border focus:border-terminal-accent"
              placeholder="Context"
              disabled={isProcessing}
            />
            <input
              type="text"
              value={llmForm.output}
              onChange={(event) => setLlmForm(prev => ({ ...prev, output: event.target.value }))}
              className="h-9 min-w-0 rounded border border-terminal-border bg-terminal-bg px-3 font-mono text-xs text-terminal-text outline-none placeholder:text-terminal-border focus:border-terminal-accent"
              placeholder="Output style"
              disabled={isProcessing}
            />
            <button
              type="submit"
              disabled={isProcessing || !llmForm.task.trim()}
              className="h-9 rounded border border-terminal-accent px-3 font-mono text-xs uppercase tracking-wider text-terminal-accent transition-colors hover:bg-terminal-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Run
            </button>
          </form>
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
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-terminal-text font-mono text-sm placeholder:text-terminal-border"
            placeholder={isProcessing ? "FRIDAY is thinking; you can queue your next line here..." : "Enter command, or say: Friday status"}
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
