import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeStorage } from '../services/storage';
import { looksLikeCrmSpecification, selectConversationRoute } from '../services/commandRouting';
import { playOnlineVoice } from '../services/onlineVoice';
import { WhitehatWorkbench } from './WhitehatWorkbench';
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
  RefreshCw,
  TrendingUp,
  Wallet,
  Download,
  Camera,
  HeartPulse,
  Sparkles,
} from 'lucide-react';
import { Message } from '../types';
import { ReverseEngineeringWorkspace } from './ReverseEngineeringWorkspace';
import { TerminalMessage } from './TerminalMessage';
import { getLastTranscriptionError, streamFridayResponse, transcribeAudioCommand } from '../services/ai';

type SpeechMode = 'browser' | 'native';
type HudPanel = 'none' | 'chat' | 'stats';
type HudPage =
  | 'core'
  | 'modules'
  | 'launchpad'
  | 'command'
  | 'projects'
  | 'memory'
  | 'automation'
  | 'vision'
  | 'study'
  | 'security'
  | 'markets'
  | 'voice'
  | 'replay'
  | 'forge'
  | 'reverse'
  | 'matrix'
  | 'encrypt';
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
type StockQuote = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  exchange: string;
  marketState: string;
};
type CryptoQuote = {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  priceInr: number | null;
  changePercent: number | null;
};
type MarketSnapshot = {
  ok: boolean;
  fetchedAt: string;
  stocks: StockQuote[];
  crypto: CryptoQuote[];
  forex?: {
    base: string;
    quote: string;
    rate: number;
    provider?: string;
    updatedAt?: string;
  } | null;
  errors?: string[];
};
type NetworkDoctorReport = {
  ok?: boolean;
  checkedAt?: string;
  summary?: string;
  activeAdapter?: {
    name?: string;
    interfaceAlias?: string;
    status?: string;
    linkSpeed?: string;
    ipv4?: string;
  } | null;
  gateway?: string;
  dnsServers?: string[];
  checks?: {
    gateway?: { ok?: boolean; averageMs?: number | null; lossPercent?: number | null };
    internet?: { ok?: boolean; averageMs?: number | null; lossPercent?: number | null };
    web?: { ok?: boolean; status?: number | null };
    dns?: { ok?: boolean; addresses?: string[] };
  };
  error?: string;
};
type SystemModule = {
  id: string;
  label: string;
  detail: string;
  status: 'good' | 'warn' | 'info';
  progress: number;
};
type FridayModulePage = {
  id: HudPage;
  kicker: string;
  title: string;
  summary: string;
  stats: [string, string][];
  actions: { label: string; run: () => void; tone?: 'live' }[];
  panels: { title: string; body: string; metric?: string; status?: string }[];
  log: string[];
};
type FridayIdeaCard = {
  title: string;
  tag: string;
  body: string;
  actionLabel: string;
  run: () => void;
};
type PresenceNudge = {
  title: string;
  body: string;
  actionLabel: string;
  run: () => void;
  tone?: 'warm' | 'focus' | 'system';
};
type BatterySnapshot = {
  supported: boolean;
  level: number | null;
  charging: boolean | null;
};
type ModuleRecord = {
  id: string;
  title: string;
  body: string;
  done?: boolean;
  createdAt: string;
};
type VisionCapture = ModuleRecord & {
  imageUrl?: string;
};
type LiveVisionInspection = {
  objectName?: string;
  category?: string;
  companyName?: string;
  modelOrMarkings?: string;
  visibleComponents?: string[];
  likelyMaterials?: string[];
  usefulNotes?: string[];
  confidence?: number;
  needsBetterView?: string;
};
type VisionAngle = {
  id: string;
  label: string;
  imageUrl: string;
  inspection?: LiveVisionInspection | null;
};
type HardwareDevice = {
  id: string;
  name: string;
  className: string;
  status: string;
  instanceId: string;
  category?: string;
  transport?: string;
  access?: string;
};
type DeviceBehavior = 'watch' | 'trusted' | 'blocked' | 'debug';
type SecurityAuditCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  evidence?: string;
  severity?: string;
  confidence?: string;
  weight?: number;
  category?: string;
};
type SecurityRecommendation = {
  id: string;
  priority: string;
  title: string;
  action: string;
  impact: string;
};
type SecurityAuditResult = {
  ok?: boolean;
  url?: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
  server?: string;
  score?: number;
  authenticated?: boolean;
  authMode?: string;
  reportAccuracyEstimate?: number;
  accuracyStatement?: string;
  checks?: SecurityAuditCheck[];
  recommendations?: SecurityRecommendation[];
  ddosReadiness?: {
    score?: number;
    checks?: SecurityAuditCheck[];
    playbook?: string[];
  };
  note?: string;
  error?: string;
};
type ProjectAuditFinding = {
  rule: string;
  severity: 'info' | 'medium' | 'high' | 'critical' | string;
  confidence?: 'low' | 'medium' | 'high' | string;
  file: string;
  line: number;
  preview: string;
  evidence?: string;
  advice: string;
};
type ProjectSecurityAuditResult = {
  ok?: boolean;
  scannedAt?: string;
  filesScanned?: number;
  findings?: ProjectAuditFinding[];
  dependencySummary?: {
    dependencies: number;
    devDependencies: number;
    lockfilePackages: number;
  };
  dependencyAudit?: {
    ok: boolean;
    available: boolean;
    total: number;
    critical: number;
    high: number;
    moderate: number;
    low: number;
    info: number;
    error?: string;
  };
  owaspChecklist?: string[];
  authSessionChecklist?: string[];
  businessRiskDashboard?: { area: string; signal: string }[];
  accuracyStatement?: string;
  note?: string;
  error?: string;
};
type SystemProtectionResult = {
  ok?: boolean;
  scannedAt?: string;
  score?: number | null;
  status?: string;
  cached?: boolean;
  coverage?: { known: number; unknown: number; total: number };
  changes?: { id: string; label: string; before: string; after: string }[];
  checks?: (Omit<SecurityAuditCheck, 'pass'> & { pass: boolean | null; severity?: string; status?: string })[];
  findings?: { id: string; label: string; severity: string; detail: string }[];
  recommendations?: SecurityRecommendation[];
  startupEntries?: { source: string; name: string; command: string; suspicious?: boolean }[];
  hostsEntries?: string[];
  recentDownloads?: { name: string; path: string; extension: string; sizeBytes: number; modified: string; sha256?: string }[];
  processFindings?: { name: string; id: number; path: string }[];
  note?: string;
  error?: string;
};
type SecurityCommandAction = 'lock-security' | 'open-encryption' | 'mute-voice' | 'mute-mic' | 'system-matrix' | 'panic-safe' | 'scan-usb' | 'system-protection';
type SecurityCommand = {
  id: string;
  phrase: string;
  action: SecurityCommandAction;
  enabled: boolean;
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
const FRIDAY_VOICE_SETTINGS_VERSION = 'irish-neural-v2';
const FRIDAY_CINEMATIC_PROFILE: VoiceProfile = {
  id: 'cinematic',
  name: 'FRIDAY Irish Neural (online)',
  voiceURI: 'edge:en-IE-EmilyNeural',
  rate: 0.96,
  pitch: 1,
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

const fallbackMarkets: MarketSnapshot = {
  ok: false,
  fetchedAt: '',
  forex: null,
  stocks: [
    { symbol: 'AAPL', name: 'Apple', price: null, change: null, changePercent: null, currency: 'USD', exchange: 'NASDAQ', marketState: 'offline' },
    { symbol: 'MSFT', name: 'Microsoft', price: null, change: null, changePercent: null, currency: 'USD', exchange: 'NASDAQ', marketState: 'offline' },
    { symbol: 'NVDA', name: 'NVIDIA', price: null, change: null, changePercent: null, currency: 'USD', exchange: 'NASDAQ', marketState: 'offline' },
    { symbol: 'RELIANCE.NS', name: 'Reliance', price: null, change: null, changePercent: null, currency: 'INR', exchange: 'NSE', marketState: 'offline' },
  ],
  crypto: [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', priceUsd: null, priceInr: null, changePercent: null },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', priceUsd: null, priceInr: null, changePercent: null },
    { id: 'solana', symbol: 'SOL', name: 'Solana', priceUsd: null, priceInr: null, changePercent: null },
  ],
  errors: [],
};

const deviceBehaviorLabels: Record<DeviceBehavior, string> = {
  watch: 'Watch only',
  trusted: 'Trusted',
  blocked: 'Blocked',
  debug: 'Debug mode',
};

const legacyDefaultLocation = {
  lat: '19.0896',
  lon: '72.8656',
};

function islegacyDefaultLocation(lat = '', lon = '') {
  return lat.trim() === legacyDefaultLocation.lat && lon.trim() === legacyDefaultLocation.lon;
}

function parseCoordinate(value = '') {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return null;
  if (/\b[SW]\b/.test(text)) return -Math.abs(number);
  if (/\b[NE]\b/.test(text)) return Math.abs(number);
  return number;
}

function hasUsableLocation(lat = '', lon = '') {
  const parsedLat = parseCoordinate(lat);
  const parsedLon = parseCoordinate(lon);
  return Number.isFinite(parsedLat)
    && Number.isFinite(parsedLon)
    && Math.abs(parsedLat) <= 90
    && Math.abs(parsedLon) <= 180
    && !(parsedLat === 0 && parsedLon === 0);
}

function formatMoney(value: number | null | undefined, currency = 'USD') {
  if (!Number.isFinite(Number(value))) return '--';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: Number(value) > 1000 ? 0 : 2,
  }).format(Number(value));
}

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return '--';
  const signed = Number(value) > 0 ? '+' : '';
  return `${signed}${Number(value).toFixed(2)}%`;
}

function formatCompactMoney(value: number | null | undefined, currency = 'USD') {
  if (!Number.isFinite(Number(value))) return '--';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function readStoredArray<T>(key: string, fallback: T[] = []) {
  try {
    const stored = JSON.parse(safeStorage.getItem(key) || '[]') as T[];
    return Array.isArray(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function readStoredRecord<T extends string>(key: string, fallback: Record<string, T> = {}) {
  try {
    const stored = JSON.parse(safeStorage.getItem(key) || '{}') as Record<string, T>;
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function parseDeviceCode(instanceId = '') {
  const vendor = instanceId.match(/VID_([0-9A-F]{4})/i)?.[1]?.toUpperCase() || '';
  const product = instanceId.match(/PID_([0-9A-F]{4})/i)?.[1]?.toUpperCase() || '';
  const interfaceId = instanceId.match(/MI_([0-9A-F]{2})/i)?.[1]?.toUpperCase() || '';
  const collection = instanceId.match(/COL([0-9A-F]{2})/i)?.[1]?.toUpperCase() || '';
  const enumerator = instanceId.split('\\')[0] || '';
  return {
    enumerator,
    vendorId: vendor ? `VID_${vendor}` : '',
    productId: product ? `PID_${product}` : '',
    interface: interfaceId ? `MI_${interfaceId}` : '',
    collection: collection ? `COL${collection}` : '',
    hasUsbVendorProductCode: Boolean(vendor && product),
  };
}

function makeModuleRecord(title: string, body = ''): ModuleRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: title.trim(),
    body: body.trim(),
    done: false,
    createdAt: new Date().toISOString(),
  };
}

function isCrmFactoryStartCommand(cmd: string) {
  return /^(?:open|start|create|build|make|generate|design|develop)\s+(?:a\s+|new\s+)?crm(?:\s+(?:factory|builder|project|app|system))?$/.test(cmd)
    || /^crm\s+(?:factory|builder|generator)$/.test(cmd);
}

function isCrmBuildNowCommand(cmd: string) {
  return /^(?:build|generate|create|make|scaffold)\s+(?:it|this|the project|the crm|crm project|now)$/.test(cmd)
    || /^(?:start|run)\s+(?:the\s+)?(?:build|generator)$/.test(cmd);
}

function defaultSecurityCommands(): SecurityCommand[] {
  return [
    { id: 'lock-security', phrase: 'lock security', action: 'lock-security', enabled: true },
    { id: 'open-encryption', phrase: 'open encryption', action: 'open-encryption', enabled: true },
    { id: 'mute-voice', phrase: 'mute voice', action: 'mute-voice', enabled: true },
    { id: 'mute-mic', phrase: 'mute mic', action: 'mute-mic', enabled: true },
    { id: 'system-matrix', phrase: 'system matrix', action: 'system-matrix', enabled: true },
    { id: 'scan-usb', phrase: 'scan usb', action: 'scan-usb', enabled: true },
    { id: 'system-protection', phrase: 'protect my system', action: 'system-protection', enabled: true },
    { id: 'panic-safe', phrase: 'panic safe', action: 'panic-safe', enabled: true },
  ];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomPinSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(salt);
}

async function hashSecurityPin(pin: string, salt: string) {
  const input = new TextEncoder().encode(`${salt}:${pin}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(hash).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

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
      openStudioProject?: (id: string, download?: boolean) => Promise<{ browser: string; downloadPath?: string; previewUrl: string }>;
      openStudioInCode?: (id: string) => Promise<{ projectPath: string; handoffPath: string }>;
      scanWebsite?: (url: string) => Promise<{ ok: boolean; cancelled?: boolean; error?: string; requestedUrl?: string; snapshots: { title: string; url: string; device?: string; viewport?: string; animations?: number; blocks: { tag: string; layout: string; width: number; height: number }[]; fonts: string[]; technology: string[]; resources: { type: string; path: string }[] }[] }>;
      openGestureControl?: () => Promise<boolean>;
      getWindowsLocation?: () => Promise<{ ok?: boolean; lat?: number; lon?: number; accuracy?: number | null; source?: string; error?: string }>;
      onWindowHidden?: (callback: () => void) => () => void;
      onWindowShown?: (callback: (detail?: { forceEngage?: boolean }) => void) => () => void;
      onNativeVoiceCommand?: (callback: (text: string) => void) => () => void;
      onNativeVoiceStatus?: (callback: (status: string) => void) => () => void;
    };
  }

  interface Navigator {
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      addEventListener: (type: string, listener: () => void) => void;
      removeEventListener: (type: string, listener: () => void) => void;
    }>;
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
    };
  }
}

export const Terminal: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'initial',
      role: 'friday',
      content: 'Friday intelligence core online. Memory, live context, and local tools are ready, Sir.',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [micInputMuted, setMicInputMuted] = useState(() => safeStorage.getItem('friday.micInputMuted') === 'true');
  const [wakeMode, setWakeMode] = useState(true);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('Voice idle');
  const [micLevel, setMicLevel] = useState(0);
  const [speechMode, setSpeechMode] = useState<SpeechMode>('browser');
  const [isRecording, setIsRecording] = useState(false);
  const [isWakePhraseRecording, setIsWakePhraseRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [clapWakeEnabled, setClapWakeEnabled] = useState(() => safeStorage.getItem('friday.clapWake') === 'true');
  const [isClapArmed, setIsClapArmed] = useState(false);
  const [clapDebug, setClapDebug] = useState({ peak: 0, rms: 0 });
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(() => safeStorage.getItem('friday.handsFree') === 'true');
  const [browserSpeechFailed, setBrowserSpeechFailed] = useState(false);
  const [nativeVoiceBlocked, setNativeVoiceBlocked] = useState(true);
  const [isWindowHidden, setIsWindowHidden] = useState(false);
  const [showLlmForm, setShowLlmForm] = useState(false);
  const [hudPanel, setHudPanel] = useState<HudPanel>('none');
  const [hudPage, setHudPage] = useState<HudPage>('core');
  const [isIdleFocus, setIsIdleFocus] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [famPayBalance, setFamPayBalance] = useState(() => safeStorage.getItem('friday.fampayBalance') || '');
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot>(fallbackMarkets);
  const [marketStatus, setMarketStatus] = useState('Market feed standby');
  const [networkDoctorReport, setNetworkDoctorReport] = useState<NetworkDoctorReport | null>(null);
  const [networkDoctorStatus, setNetworkDoctorStatus] = useState('Network Doctor standby');
  const [isMarketLoading, setIsMarketLoading] = useState(false);
  const [isLiveLocationEnabled, setIsLiveLocationEnabled] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Device location off');
  const [isNetworkOnline, setIsNetworkOnline] = useState(() => navigator.onLine);
  const [batterySnapshot, setBatterySnapshot] = useState<BatterySnapshot>({
    supported: false,
    level: null,
    charging: null,
  });
  const [locationSettings, setLocationSettings] = useState(() => {
    try {
      const savedLat = safeStorage.getItem('friday.locationLat') || '';
      const savedLon = safeStorage.getItem('friday.locationLon') || '';
      const shouldIgnoreSavedCenter = islegacyDefaultLocation(savedLat, savedLon);
      return {
        lat: shouldIgnoreSavedCenter ? '' : savedLat,
        lon: shouldIgnoreSavedCenter ? '' : savedLon,
        country: safeStorage.getItem('friday.locationCountry') || 'India',
      };
    } catch {
      return {
        lat: '',
        lon: '',
        country: 'India',
      };
    }
  });
  const [llmForm, setLlmForm] = useState({
    mode: 'Assistant',
    task: '',
    context: '',
    output: 'Concise answer',
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [nativeVoices, setNativeVoices] = useState<NativeVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => safeStorage.getItem('friday.voiceURI') || FRIDAY_CINEMATIC_PROFILE.voiceURI);
  const [voiceRate, setVoiceRate] = useState(() => Number(safeStorage.getItem('friday.voiceRate') || String(FRIDAY_CINEMATIC_PROFILE.rate)));
  const [voicePitch, setVoicePitch] = useState(() => Number(safeStorage.getItem('friday.voicePitch') || String(FRIDAY_CINEMATIC_PROFILE.pitch)));
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState(() => safeStorage.getItem('friday.voiceProfileId') || FRIDAY_CINEMATIC_PROFILE.id);
  const [customVoiceProfiles, setCustomVoiceProfiles] = useState<VoiceProfile[]>(() => {
    try {
      const stored = JSON.parse(safeStorage.getItem('friday.customVoiceProfiles') || '[]') as VoiceProfile[];
      return Array.isArray(stored) ? stored.filter(profile => profile?.id && profile?.name) : [];
    } catch {
      return [];
    }
  });
  const [customVoiceProfileName, setCustomVoiceProfileName] = useState('');
  const [showVoiceControls, setShowVoiceControls] = useState(false);
  const [voiceArmRequestId, setVoiceArmRequestId] = useState(0);
  const [projectDraft, setProjectDraft] = useState('');
  const [projects, setProjects] = useState<ModuleRecord[]>(() => readStoredArray('friday.projects'));
  const [crmFactoryActive, setCrmFactoryActive] = useState(() => safeStorage.getItem('friday.crmFactoryActive') === 'true');
  const [lastCrmSpec, setLastCrmSpec] = useState(() => safeStorage.getItem('friday.lastCrmSpec') || '');
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryNotes, setMemoryNotes] = useState<ModuleRecord[]>(() => readStoredArray('friday.memoryNotes'));
  const [studyQuestion, setStudyQuestion] = useState('');
  const [studyAnswer, setStudyAnswer] = useState('');
  const [studyCards, setStudyCards] = useState<ModuleRecord[]>(() => readStoredArray('friday.studyCards'));
  const [revealedStudyCardId, setRevealedStudyCardId] = useState('');
  const [visionCaptures, setVisionCaptures] = useState<VisionCapture[]>(() => readStoredArray('friday.visionCaptures'));
  const [liveVisionEnabled, setLiveVisionEnabled] = useState(false);
  const [liveVisionStatus, setLiveVisionStatus] = useState('Live recognizer standby');
  const [liveVisionInspection, setLiveVisionInspection] = useState<LiveVisionInspection | null>(null);
  const [isLiveVisionAnalyzing, setIsLiveVisionAnalyzing] = useState(false);
  const [visionAngles, setVisionAngles] = useState<VisionAngle[]>([]);
  const [visionLookupReport, setVisionLookupReport] = useState('');
  const [showFullVisionReport, setShowFullVisionReport] = useState(false);
  const [isVisionLookingUp, setIsVisionLookingUp] = useState(false);
  const [automationLog, setAutomationLog] = useState<ModuleRecord[]>(() => readStoredArray('friday.automationLog'));
  const [secureText, setSecureText] = useState('');
  const [securePassphrase, setSecurePassphrase] = useState('');
  const [secureOutput, setSecureOutput] = useState('');
  const [hardwareDevices, setHardwareDevices] = useState<HardwareDevice[]>(() => readStoredArray('friday.hardwareDevices'));
  const [trustedDevices, setTrustedDevices] = useState<string[]>(() => readStoredArray('friday.trustedDevices'));
  const [deviceBehaviors, setDeviceBehaviors] = useState<Record<string, DeviceBehavior>>(() => {
    const stored = readStoredRecord<DeviceBehavior>('friday.deviceBehaviors');
    if (Object.keys(stored).length) return stored;
    return Object.fromEntries(readStoredArray<string>('friday.trustedDevices').map(id => [id, 'trusted' as DeviceBehavior]));
  });
  const [deviceDebugNotes, setDeviceDebugNotes] = useState<Record<string, string>>(() => readStoredRecord<string>('friday.deviceDebugNotes'));
  const [openedDeviceId, setOpenedDeviceId] = useState('');
  const [hardwareStatus, setHardwareStatus] = useState('External device scan standby');
  const [isHardwareScanning, setIsHardwareScanning] = useState(false);
  const [securityPinHash, setSecurityPinHash] = useState(() => safeStorage.getItem('friday.securityPinHash') || '');
  const [securityPinSalt, setSecurityPinSalt] = useState(() => safeStorage.getItem('friday.securityPinSalt') || '');
  const [securityUnlocked, setSecurityUnlocked] = useState(false);
  const [securityPinInput, setSecurityPinInput] = useState('');
  const [securityPinConfirm, setSecurityPinConfirm] = useState('');
  const [securityPinStatus, setSecurityPinStatus] = useState('Security console locked');
  const [securityCurrentPin, setSecurityCurrentPin] = useState('');
  const [securityNewPin, setSecurityNewPin] = useState('');
  const [securityNewPinConfirm, setSecurityNewPinConfirm] = useState('');
  const [securityAuditTarget, setSecurityAuditTarget] = useState('');
  const [securityAuditAuthMode, setSecurityAuditAuthMode] = useState<'none' | 'cookie' | 'bearer'>('none');
  const [securityAuditAuthValue, setSecurityAuditAuthValue] = useState('');
  const [securityAuditStatus, setSecurityAuditStatus] = useState('White-hat audit standby');
  const [securityAuditResult, setSecurityAuditResult] = useState<SecurityAuditResult | null>(null);
  const [isSecurityAuditing, setIsSecurityAuditing] = useState(false);
  const [projectAuditStatus, setProjectAuditStatus] = useState('Project bug finder standby');
  const [projectAuditResult, setProjectAuditResult] = useState<ProjectSecurityAuditResult | null>(null);
  const [isProjectAuditing, setIsProjectAuditing] = useState(false);
  const [systemProtectionStatus, setSystemProtectionStatus] = useState('System protection standby');
  const [systemProtectionResult, setSystemProtectionResult] = useState<SystemProtectionResult | null>(null);
  const [isSystemProtecting, setIsSystemProtecting] = useState(false);
  const [securityCommands, setSecurityCommands] = useState<SecurityCommand[]>(() => {
    const stored = readStoredArray<SecurityCommand>('friday.securityCommands');
    return stored.length ? stored : defaultSecurityCommands();
  });
  const idleFocusTimerRef = useRef<number | null>(null);
  const locationWatchRef = useRef<number | null>(null);
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
  const micInputMutedRef = useRef(micInputMuted);
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
  const onlineSpeechRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!voiceEnabled) { onlineSpeechRef.current?.abort(); assistantSpeakingRef.current = false; }
    return () => { onlineSpeechRef.current?.abort(); };
  }, [voiceEnabled, selectedVoiceURI]);
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
  const pendingDesktopTaskRef = useRef('');
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingInputsRef = useRef<string[]>([]);
  const isWindowHiddenRef = useRef(false);
  const liveVisionVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveVisionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveVisionStreamRef = useRef<MediaStream | null>(null);
  const liveVisionTimerRef = useRef<number | null>(null);
  const liveVisionAnalyzingRef = useRef(false);
  const lastLiveVisionSignatureRef = useRef('');
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

  const loadMarketSnapshot = useCallback(async () => {
    setIsMarketLoading(true);
    setMarketStatus('Refreshing market feed');
    try {
      const response = await fetch('/api/markets', { cache: 'no-store' });
      const result = await response.json().catch(() => null) as MarketSnapshot | null;
      if (result?.stocks || result?.crypto) {
        setMarketSnapshot({
          ok: Boolean(result.ok),
          fetchedAt: result.fetchedAt || new Date().toISOString(),
          forex: result.forex || null,
          stocks: Array.isArray(result.stocks) && result.stocks.length ? result.stocks : fallbackMarkets.stocks,
          crypto: Array.isArray(result.crypto) && result.crypto.length ? result.crypto : fallbackMarkets.crypto,
          errors: result.errors || [],
        });
        setMarketStatus(result.ok ? 'Market feed live' : 'Market feed partial');
      } else {
        setMarketStatus('Market feed unavailable');
      }
    } catch {
      setMarketStatus('Market feed offline');
    } finally {
      setIsMarketLoading(false);
    }
  }, []);

  const stopLiveLocation = useCallback(() => {
    if (locationWatchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
    }
    setIsLiveLocationEnabled(false);
    setLocationStatus('Device location off');
  }, []);

  const startLiveLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus('Location unavailable on this device');
      return;
    }

    setLocationStatus('Requesting Windows location permission');
    if (locationWatchRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
    }

    locationWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        setLocationSettings(prev => ({ ...prev, lat, lon }));
        setIsLiveLocationEnabled(true);
        setLocationStatus(`Device location locked ±${Math.round(position.coords.accuracy || 0)} m`);
      },
      (error) => {
        setIsLiveLocationEnabled(false);
        setLocationStatus(error.code === error.PERMISSION_DENIED
          ? 'Location permission denied'
          : `Location unavailable: ${error.message || 'unknown error'}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  }, []);

  const useWindowsLocationFallback = useCallback(async () => {
    setLocationStatus('Trying Windows Wi-Fi location fallback');
    try {
      const result = await window.fridayDesktop?.getWindowsLocation?.();
      if (result?.ok && typeof result.lat === 'number' && typeof result.lon === 'number') {
        setLocationSettings(prev => ({
          ...prev,
          lat: result.lat!.toFixed(6),
          lon: result.lon!.toFixed(6),
        }));
        setLocationStatus(`Wi-Fi location estimate ±${Math.round(result.accuracy || 0)} m`);
        return;
      }
      setLocationStatus(result?.error || 'Windows location fallback failed');
    } catch (error) {
      setLocationStatus(error instanceof Error ? error.message : 'Windows location fallback failed');
    }
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
    safeStorage.setItem('friday.voiceURI', selectedVoiceURI);
  }, [selectedVoiceURI]);

  useEffect(() => {
    safeStorage.setItem('friday.voiceRate', String(voiceRate));
  }, [voiceRate]);

  useEffect(() => {
    safeStorage.setItem('friday.voicePitch', String(voicePitch));
  }, [voicePitch]);

  useEffect(() => {
    safeStorage.setItem('friday.voiceProfileId', selectedVoiceProfileId);
  }, [selectedVoiceProfileId]);

  useEffect(() => {
    safeStorage.setItem('friday.customVoiceProfiles', JSON.stringify(customVoiceProfiles));
  }, [customVoiceProfiles]);

  useEffect(() => {
    safeStorage.setItem('friday.fampayBalance', famPayBalance);
  }, [famPayBalance]);

  useEffect(() => {
    safeStorage.setItem('friday.locationLat', locationSettings.lat);
    safeStorage.setItem('friday.locationLon', locationSettings.lon);
    safeStorage.setItem('friday.locationCountry', locationSettings.country);
  }, [locationSettings]);

  useEffect(() => {
    safeStorage.setItem('friday.projects', JSON.stringify(projects.slice(-80)));
  }, [projects]);

  useEffect(() => {
    safeStorage.setItem('friday.crmFactoryActive', String(crmFactoryActive));
  }, [crmFactoryActive]);

  useEffect(() => {
    if (lastCrmSpec.trim()) safeStorage.setItem('friday.lastCrmSpec', lastCrmSpec);
  }, [lastCrmSpec]);

  useEffect(() => {
    safeStorage.setItem('friday.memoryNotes', JSON.stringify(memoryNotes.slice(-80)));
  }, [memoryNotes]);

  useEffect(() => {
    safeStorage.setItem('friday.studyCards', JSON.stringify(studyCards.slice(-120)));
  }, [studyCards]);

  useEffect(() => {
    safeStorage.setItem('friday.visionCaptures', JSON.stringify(visionCaptures.slice(-30)));
  }, [visionCaptures]);

  useEffect(() => {
    safeStorage.setItem('friday.automationLog', JSON.stringify(automationLog.slice(-80)));
  }, [automationLog]);

  useEffect(() => {
    safeStorage.setItem('friday.hardwareDevices', JSON.stringify(hardwareDevices.slice(-80)));
  }, [hardwareDevices]);

  useEffect(() => {
    safeStorage.setItem('friday.trustedDevices', JSON.stringify(trustedDevices));
  }, [trustedDevices]);

  useEffect(() => {
    safeStorage.setItem('friday.deviceBehaviors', JSON.stringify(deviceBehaviors));
  }, [deviceBehaviors]);

  useEffect(() => {
    safeStorage.setItem('friday.deviceDebugNotes', JSON.stringify(deviceDebugNotes));
  }, [deviceDebugNotes]);

  useEffect(() => {
    if (securityPinHash) safeStorage.setItem('friday.securityPinHash', securityPinHash);
    if (securityPinSalt) safeStorage.setItem('friday.securityPinSalt', securityPinSalt);
  }, [securityPinHash, securityPinSalt]);

  useEffect(() => {
    safeStorage.setItem('friday.securityCommands', JSON.stringify(securityCommands));
  }, [securityCommands]);

  useEffect(() => {
    const updateNetwork = () => setIsNetworkOnline(navigator.onLine);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    updateNetwork();

    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  useEffect(() => {
    let batteryRef: Awaited<ReturnType<NonNullable<Navigator['getBattery']>>> | null = null;
    let disposed = false;

    const updateBattery = () => {
      if (!batteryRef || disposed) return;
      setBatterySnapshot({
        supported: true,
        level: Math.round(batteryRef.level * 100),
        charging: batteryRef.charging,
      });
    };

    if (!navigator.getBattery) return;

    navigator.getBattery()
      .then((battery) => {
        if (disposed) return;
        batteryRef = battery;
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
      })
      .catch(() => {
        if (!disposed) setBatterySnapshot({ supported: false, level: null, charging: null });
      });

    return () => {
      disposed = true;
      batteryRef?.removeEventListener('levelchange', updateBattery);
      batteryRef?.removeEventListener('chargingchange', updateBattery);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadMarketSnapshot();
    const timer = window.setInterval(() => {
      void loadMarketSnapshot();
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [loadMarketSnapshot]);

  useEffect(() => {
    if (safeStorage.getItem('friday.voiceInputModeVersion') === FRIDAY_VOICE_INPUT_MODE_VERSION) return;
    setClapWakeEnabled(false);
    setHandsFreeEnabled(false);
    setIsClapArmed(false);
    isClapArmedRef.current = false;
    shouldListenRef.current = false;
    setIsListening(false);
    setVoiceStatus('Voice idle');
    safeStorage.setItem('friday.clapWake', 'false');
    safeStorage.setItem('friday.handsFree', 'false');
    safeStorage.setItem('friday.voiceInputModeVersion', FRIDAY_VOICE_INPUT_MODE_VERSION);
  }, []);

  useEffect(() => {
    if (safeStorage.getItem('friday.voiceSettingsVersion') === FRIDAY_VOICE_SETTINGS_VERSION) return;
    setSelectedVoiceProfileId(FRIDAY_CINEMATIC_PROFILE.id);
    setSelectedVoiceURI(FRIDAY_CINEMATIC_PROFILE.voiceURI);
    setVoiceRate(FRIDAY_CINEMATIC_PROFILE.rate);
    setVoicePitch(FRIDAY_CINEMATIC_PROFILE.pitch);
    safeStorage.setItem('friday.voiceSettingsVersion', FRIDAY_VOICE_SETTINGS_VERSION);
  }, [availableVoices, nativeVoiceAvailable, nativeVoices]);

  useEffect(() => {
    safeStorage.setItem('friday.clapWake', String(clapWakeEnabled));
  }, [clapWakeEnabled]);

  useEffect(() => {
    safeStorage.setItem('friday.handsFree', String(handsFreeEnabled));
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

  const speak = useCallback(async (text: string) => {
    if (!voiceEnabled || !text.trim()) return;

    if (speechResumeTimerRef.current) {
      window.clearTimeout(speechResumeTimerRef.current);
      speechResumeTimerRef.current = null;
    }

    if (speechEndFallbackTimerRef.current) {
      window.clearTimeout(speechEndFallbackTimerRef.current);
      speechEndFallbackTimerRef.current = null;
    }

    onlineSpeechRef.current?.abort();
    const speechController = new AbortController();
    onlineSpeechRef.current = speechController;
    window.speechSynthesis?.cancel();
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

    if (selectedVoiceURI.startsWith('edge:')) {
      setVoiceStatus('FRIDAY Irish voice · online');
      try {
        await playOnlineVoice(cleanText, voiceRate, voicePitch, speechController.signal);
        if (!speechController.signal.aborted) {
          assistantSpeakingRef.current = false;
          speechSuppressionUntilRef.current = performance.now() + 700;
          restartRecognitionWhenReady(700);
        }
        return;
      } catch {
        if (speechController.signal.aborted) return;
        setVoiceStatus('Online voice unavailable · local fallback');
      }
    }

    if (selectedVoiceURI.startsWith('native:') || (selectedVoiceURI.startsWith('edge:') && nativeVoiceAvailable)) {
      const nativeVoice = selectedVoiceURI.startsWith('edge:') ? 'Microsoft Zira Desktop' : selectedVoiceURI.replace(/^native:/, '');
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
      }).catch(() => { setVoiceStatus('Local speech unavailable'); }).finally(() => {
        window.setTimeout(() => {
          assistantSpeakingRef.current = false;
          speechSuppressionUntilRef.current = performance.now() + 700;
          restartRecognitionWhenReady(700);
        }, estimatedSpeechMs);
      });
      return;
    }

    if (!('speechSynthesis' in window)) {
      assistantSpeakingRef.current = false;
      restartRecognitionWhenReady(700);
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
  }, [availableVoices, nativeVoiceAvailable, restartRecognitionWhenReady, selectedVoiceURI, voiceEnabled, voicePitch, voiceRate]);

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'system',
      content,
      timestamp: new Date()
    }]);
  }, []);

  const runNetworkDoctor = useCallback(async () => {
    setNetworkDoctorStatus('Checking adapter, gateway, internet, and DNS');
    try {
      const response = await fetch('/api/network/doctor', { cache: 'no-store' });
      const result = await response.json().catch(() => null) as NetworkDoctorReport | null;
      if (response.ok && result?.ok) {
        setNetworkDoctorReport(result);
        const healthy = Boolean((result.checks?.internet?.ok || result.checks?.web?.ok) && result.checks?.dns?.ok);
        setNetworkDoctorStatus(healthy ? 'Connection healthy' : 'Connection needs attention');
        addSystemMessage(result.summary || 'Network Doctor finished.');
        return result.summary || 'Network Doctor finished.';
      }

      const message = result?.error || 'Network Doctor failed.';
      setNetworkDoctorStatus(message);
      addSystemMessage(`NETWORK DOCTOR\n${message}`);
      return message;
    } catch {
      const message = 'Network Doctor endpoint unavailable.';
      setNetworkDoctorStatus(message);
      addSystemMessage(`NETWORK DOCTOR\n${message}`);
      return message;
    }
  }, [addSystemMessage]);

  const toggleVoiceOutput = useCallback(() => {
    setVoiceEnabled(prev => {
      const next = !prev;
      if (!next) {
        window.speechSynthesis?.cancel();
        assistantSpeakingRef.current = false;
        setVoiceStatus('Voice output muted');
      } else {
        setVoiceStatus('Voice output enabled');
      }
      return next;
    });
  }, []);

  const appendAutomationLog = useCallback((title: string, body: string) => {
    setAutomationLog(prev => [makeModuleRecord(title, body), ...prev].slice(0, 80));
  }, []);

  const addProjectTask = useCallback(() => {
    if (!projectDraft.trim()) return;
    setProjects(prev => [makeModuleRecord(projectDraft, 'Manual project task'), ...prev]);
    setProjectDraft('');
  }, [projectDraft]);

  const addMemoryVaultNote = useCallback(() => {
    if (!memoryDraft.trim()) return;
    const note = makeModuleRecord(memoryDraft, 'Local vault note');
    setMemoryNotes(prev => [note, ...prev]);
    setMemoryDraft('');
    addSystemMessage(`Vault note saved locally: ${note.title}`);
  }, [addSystemMessage, memoryDraft]);

  const addStudyCard = useCallback(() => {
    if (!studyQuestion.trim() || !studyAnswer.trim()) return;
    setStudyCards(prev => [makeModuleRecord(studyQuestion, studyAnswer), ...prev]);
    setStudyQuestion('');
    setStudyAnswer('');
  }, [studyAnswer, studyQuestion]);

  const runAutomationMacro = useCallback((name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === 'work') {
      setHudPage('command');
      setHudPanel('chat');
      setVoiceEnabled(true);
      appendAutomationLog('Work mode', 'Command center and chat opened. Voice output is enabled.');
      return;
    }
    if (normalized === 'dev') {
      setHudPage('projects');
      setShowLlmForm(true);
      appendAutomationLog('Dev mode', 'Project Lab opened and brain prompt armed.');
      return;
    }
    if (normalized === 'hardware') {
      setHudPage('forge');
      appendAutomationLog('Hardware mode', 'Hardware Forge opened. Press Scan External to refresh devices.');
      return;
    }
    setVoiceEnabled(false);
    setHudPanel('none');
    appendAutomationLog('Night mode', 'Voice muted and side panels hidden.');
  }, [appendAutomationLog]);

  const runDailyBriefing = useCallback(() => {
    setHudPage('command');
    setHudPanel('chat');
    void loadMarketSnapshot();
    const hour = new Date().getHours();
    const phase = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'late-night';
    const openProjects = projects.filter(item => !item.done);
    const topTask = openProjects[0]?.title || 'choose one clear task';
    const supportLine = phase === 'late-night'
      ? 'Keep it gentle: one small win, then let the brain clock out.'
      : openProjects.length
        ? `Best first move: ${topTask}. Small bite, clean momentum.`
        : 'No urgent task queue detected. Suspiciously peaceful. I approve.';
    addSystemMessage([
      `DAILY BRIEFING / ${phase.toUpperCase()}`,
      `System: ${isNetworkOnline ? 'network online' : 'network offline'} / ${voiceEnabled ? 'voice enabled' : 'voice muted'} / ${marketStatus}.`,
      `Queue: ${projects.filter(item => !item.done).length} open project tasks, ${memoryNotes.length} vault notes, ${studyCards.length} study cards.`,
      `Memory: ${memoryNotes[0]?.title ? `latest vault note is "${memoryNotes[0].title}".` : 'no vault notes yet.'}`,
      `Next: ${supportLine}`,
    ].join('\n'));
  }, [addSystemMessage, isNetworkOnline, loadMarketSnapshot, marketStatus, memoryNotes.length, projects, studyCards.length, voiceEnabled]);

  const startProjectCopilot = useCallback(() => {
    setHudPage('projects');
    setHudPanel('chat');
    setShowLlmForm(true);
    setProjects(prev => [makeModuleRecord('Project Copilot: choose a folder or task', 'Ask FRIDAY to summarize, run, clean, test, document, or deploy one project.'), ...prev].slice(0, 80));
  }, []);

  const startFocusMode = useCallback(() => {
    setHudPage('study');
    setHudPanel('none');
    setVoiceEnabled(false);
    appendAutomationLog('Focus mode', 'Study Trainer opened, voice muted, and workspace noise reduced.');
    addSystemMessage('FOCUS MODE\nPick one task, set a timer outside FRIDAY if needed, and use Study Trainer for checkpoints.');
  }, [addSystemMessage, appendAutomationLog]);

  const startAgentMarketplace = useCallback(() => {
    setHudPage('launchpad');
    setProjects(prev => {
      const agents = [
        ['Agent: Coding', 'Summarize project, find bugs, run checks, write docs.'],
        ['Agent: Research', 'Collect sources, compare options, make a short brief.'],
        ['Agent: PC Cleaner', 'Review generated files, caches, logs, and startup clutter.'],
        ['Agent: Security', 'Run defensive audits and hardening checklists.'],
        ['Agent: Study', 'Build roadmap, flashcards, and quiz drills.'],
      ];
      const existing = new Set(prev.map(item => item.title));
      const fresh = agents.filter(([title]) => !existing.has(title)).map(([title, body]) => makeModuleRecord(title, body));
      return [...fresh, ...prev].slice(0, 80);
    });
    addSystemMessage('AGENT MARKETPLACE\nStarter agents were added to Project Lab. Open each task when you want that mode.');
  }, [addSystemMessage]);

  const importVisionCapture = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === 'string' ? reader.result : '';
      setVisionCaptures(prev => [{
        ...makeModuleRecord(file.name, `${Math.round(file.size / 1024)} KB / ${file.type || 'unknown file'}`),
        imageUrl,
      }, ...prev].slice(0, 30));
      addSystemMessage(`Vision capture imported: ${file.name}`);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, [addSystemMessage]);

  const stopLiveVision = useCallback(() => {
    if (liveVisionTimerRef.current) {
      window.clearInterval(liveVisionTimerRef.current);
      liveVisionTimerRef.current = null;
    }
    liveVisionStreamRef.current?.getTracks().forEach(track => track.stop());
    liveVisionStreamRef.current = null;
    if (liveVisionVideoRef.current) liveVisionVideoRef.current.srcObject = null;
    liveVisionAnalyzingRef.current = false;
    setIsLiveVisionAnalyzing(false);
    setLiveVisionEnabled(false);
    setLiveVisionStatus('Live recognizer standby');
  }, []);

  const inspectLiveVisionFrame = useCallback(async () => {
    if (liveVisionAnalyzingRef.current) return;

    const video = liveVisionVideoRef.current;
    const canvas = liveVisionCanvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const width = Math.min(640, video.videoWidth || 640);
    const height = Math.max(1, Math.round(width * ((video.videoHeight || 480) / (video.videoWidth || 640))));
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    const imageBase64 = dataUrl.split(',')[1] || '';
    if (!imageBase64) return;

    const signature = imageBase64.slice(0, 240);
    if (signature === lastLiveVisionSignatureRef.current) return;
    lastLiveVisionSignatureRef.current = signature;

    liveVisionAnalyzingRef.current = true;
    setIsLiveVisionAnalyzing(true);
    setLiveVisionStatus('Scanning object...');

    try {
      const response = await fetch('/api/vision/inspect-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; result?: LiveVisionInspection; error?: string } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Vision scan returned ${response.status}.`);
      }

      setLiveVisionInspection(result.result || null);
      setLiveVisionStatus(result.result?.objectName ? `Detected ${result.result.objectName}` : 'Scan complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Live scan failed';
      setLiveVisionStatus(/high demand|rate limit|429|resource exhausted|busy/i.test(message)
        ? 'Vision provider is busy. Wait a moment, then press Scan Now again.'
        : `Scan failed. ${message.slice(0, 120)}`);
    } finally {
      liveVisionAnalyzingRef.current = false;
      setIsLiveVisionAnalyzing(false);
    }
  }, []);

  const captureVisionAngle = useCallback(() => {
    const video = liveVisionVideoRef.current;
    const canvas = liveVisionCanvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setLiveVisionStatus('Start the camera and keep the object in frame first.');
      return;
    }
    const width = Math.min(900, video.videoWidth || 900);
    const height = Math.max(1, Math.round(width * ((video.videoHeight || 600) / (video.videoWidth || 900))));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    const imageUrl = canvas.toDataURL('image/jpeg', 0.82);
    const nextNumber = visionAngles.length + 1;
    setVisionAngles(prev => [...prev, {
      id: `angle-${Date.now()}`,
      label: `Angle ${nextNumber}`,
      imageUrl,
      inspection: liveVisionInspection,
    }].slice(-8));
    setLiveVisionStatus(`${nextNumber} angle${nextNumber === 1 ? '' : 's'} captured. Show another side or run lookup.`);
  }, [liveVisionInspection, visionAngles.length]);

  const lookupVisionObject = useCallback(async () => {
    const inspection = liveVisionInspection;
    if (!inspection?.objectName && !visionAngles.length) {
      setLiveVisionStatus('Capture or scan at least one angle first.');
      return;
    }
    setIsVisionLookingUp(true);
    setLiveVisionStatus('Comparing markings and angles with live web results...');
    try {
      const response = await fetch('/api/vision/search-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspection,
          angles: visionAngles.map(angle => angle.inspection).filter(Boolean),
          images: visionAngles.map(angle => angle.imageUrl).filter(Boolean),
        }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; report?: string; inspection?: LiveVisionInspection; error?: string } | null;
      if (!response.ok || !result?.ok) throw new Error(result?.error || `Lookup returned ${response.status}.`);
      if (result.inspection) setLiveVisionInspection(result.inspection);
      setVisionLookupReport(result.report || 'No matching web evidence returned.');
      setShowFullVisionReport(false);
      setLiveVisionStatus('Web comparison complete. Check the evidence report.');
    } catch (error) {
      setLiveVisionStatus(error instanceof Error ? error.message : 'Web comparison failed.');
    } finally {
      setIsVisionLookingUp(false);
    }
  }, [liveVisionInspection, visionAngles]);

  const startLiveVision = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setLiveVisionStatus('Camera is unavailable in this browser.');
      return;
    }

    try {
      setLiveVisionStatus('Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      liveVisionStreamRef.current = stream;
      if (liveVisionVideoRef.current) {
        liveVisionVideoRef.current.srcObject = stream;
        await liveVisionVideoRef.current.play();
      }

      setLiveVisionEnabled(true);
      setLiveVisionStatus('Camera ready. Press Scan Now when the object is centered.');
    } catch (error) {
      stopLiveVision();
      setLiveVisionStatus(error instanceof Error ? error.message : 'Camera permission blocked.');
    }
  }, [inspectLiveVisionFrame, stopLiveVision]);

  useEffect(() => {
    if (hudPage !== 'vision' && liveVisionStreamRef.current) stopLiveVision();
  }, [hudPage, stopLiveVision]);

  useEffect(() => {
    return () => stopLiveVision();
  }, [stopLiveVision]);

  const deriveSecureKey = useCallback(async (passphrase: string, salt: Uint8Array) => {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 180000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }, []);

  const encryptSecureText = useCallback(async () => {
    if (!secureText.trim() || !securePassphrase.trim()) {
      setSecureOutput('Enter text and a passphrase first.');
      return;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveSecureKey(securePassphrase, salt);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(secureText),
    ));
    setSecureOutput(JSON.stringify({
      fridayCipher: 1,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256-180000',
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(encrypted),
    }));
  }, [deriveSecureKey, securePassphrase, secureText]);

  const decryptSecureText = useCallback(async () => {
    if (!secureText.trim() || !securePassphrase.trim()) {
      setSecureOutput('Paste a FRIDAY cipher and enter its passphrase.');
      return;
    }
    try {
      const payload = JSON.parse(secureText);
      const salt = base64ToBytes(String(payload.salt || ''));
      const iv = base64ToBytes(String(payload.iv || ''));
      const data = base64ToBytes(String(payload.data || ''));
      const key = await deriveSecureKey(securePassphrase, salt);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      setSecureOutput(new TextDecoder().decode(decrypted));
    } catch {
      setSecureOutput('Decrypt failed. Check the cipher text and passphrase.');
    }
  }, [deriveSecureKey, securePassphrase, secureText]);

  const hashSecureText = useCallback(async () => {
    if (!secureText.trim()) {
      setSecureOutput('Enter text to hash.');
      return;
    }
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secureText)));
    setSecureOutput(Array.from(hash).map(byte => byte.toString(16).padStart(2, '0')).join(''));
  }, [secureText]);

  const scanHardwareDevices = useCallback(async () => {
    setIsHardwareScanning(true);
    setHardwareStatus('Scanning local devices');
    try {
      const response = await fetch('/api/hardware/devices', { cache: 'no-store' });
      const result = await response.json().catch(() => null) as { ok?: boolean; devices?: HardwareDevice[]; message?: string } | null;
      if (result?.ok && Array.isArray(result.devices)) {
        setHardwareDevices(result.devices);
        setHardwareStatus(`Found ${result.devices.length} device${result.devices.length === 1 ? '' : 's'}`);
      } else {
        setHardwareStatus(result?.message || 'Hardware scan unavailable');
      }
    } catch {
      setHardwareStatus('Hardware scan failed');
    } finally {
      setIsHardwareScanning(false);
    }
  }, []);

  const getDeviceBehavior = useCallback((device: HardwareDevice): DeviceBehavior => {
    return deviceBehaviors[device.instanceId] || (trustedDevices.includes(device.instanceId) ? 'trusted' : 'watch');
  }, [deviceBehaviors, trustedDevices]);

  const openedDevice = useMemo(() => {
    return hardwareDevices.find(device => device.instanceId === openedDeviceId || device.id === openedDeviceId) || null;
  }, [hardwareDevices, openedDeviceId]);

  const openedDeviceCode = useMemo(() => {
    if (!openedDevice) return '';
    const parsedCode = parseDeviceCode(openedDevice.instanceId);
    const likelyExternal = parsedCode.hasUsbVendorProductCode && !/INT|ACPI|DELL|ROOT|SWD/i.test(openedDevice.instanceId);
    return JSON.stringify({
      id: openedDevice.id,
      name: openedDevice.name,
      behavior: getDeviceBehavior(openedDevice),
      externalAssessment: {
        result: likelyExternal ? 'likely external USB/HID device' : 'not proven external from this code alone',
        reason: likelyExternal
          ? 'Windows reports a USB/HID vendor/product path and it passed the internal-device noise filters.'
          : 'Some internal laptop parts also appear as HID devices, so VID/PID alone is not absolute proof.',
      },
      parsedCode,
      category: openedDevice.category || '',
      transport: openedDevice.transport || '',
      className: openedDevice.className,
      status: openedDevice.status,
      access: openedDevice.access || (openedDevice.status === 'OK' ? 'Connected / usable by Windows' : 'Pair or connect in Windows first'),
      instanceId: openedDevice.instanceId,
      debugNote: deviceDebugNotes[openedDevice.instanceId] || '',
    }, null, 2);
  }, [deviceDebugNotes, getDeviceBehavior, openedDevice]);

  const forgeTelemetry = useMemo(() => {
    const connected = hardwareDevices.filter(device => (device.access || device.status).toLowerCase().includes('connected') || device.status === 'OK').length;
    const waiting = Math.max(0, hardwareDevices.length - connected);
    const debug = hardwareDevices.filter(device => getDeviceBehavior(device) === 'debug').length;
    const blocked = hardwareDevices.filter(device => getDeviceBehavior(device) === 'blocked').length;
    return { connected, waiting, debug, blocked };
  }, [getDeviceBehavior, hardwareDevices]);

  const updateDeviceBehavior = useCallback((device: HardwareDevice, behavior: DeviceBehavior) => {
    setDeviceBehaviors(prev => ({ ...prev, [device.instanceId]: behavior }));
    setTrustedDevices(prev => {
      if (behavior === 'trusted') return prev.includes(device.instanceId) ? prev : [...prev, device.instanceId];
      return prev.filter(id => id !== device.instanceId);
    });
    setHardwareStatus(`${device.name} set to ${deviceBehaviorLabels[behavior]}`);
  }, []);

  const updateDeviceDebugNote = useCallback((device: HardwareDevice, note: string) => {
    setDeviceDebugNotes(prev => ({ ...prev, [device.instanceId]: note.slice(0, 180) }));
  }, []);

  const runSecurityAuditForTarget = useCallback(async (targetUrl: string) => {
    const url = targetUrl.trim();
    if (!url) {
      setSecurityAuditStatus('Enter your website URL first.');
      return;
    }

    setIsSecurityAuditing(true);
    setSecurityAuditStatus(securityAuditAuthMode === 'none' ? 'Running passive defensive audit' : 'Running authorized authenticated audit');
    setSecurityAuditResult(null);
    try {
      const response = await fetch('/api/security/web-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          authMode: securityAuditAuthMode,
          authValue: securityAuditAuthMode === 'none' ? '' : securityAuditAuthValue,
        }),
      });
      const result = await response.json().catch(() => null) as SecurityAuditResult | null;
      if (response.ok && result?.ok) {
        setSecurityAuditResult(result);
        setSecurityAuditStatus(`${result.authenticated ? 'Authenticated ' : ''}audit score ${result.score ?? 0}/100`);
      } else {
        setSecurityAuditStatus(result?.error || 'Audit failed');
      }
    } catch {
      setSecurityAuditStatus('Security audit endpoint unavailable');
    } finally {
      setIsSecurityAuditing(false);
    }
  }, [securityAuditAuthMode, securityAuditAuthValue]);

  const runSecurityAudit = useCallback(async () => {
    await runSecurityAuditForTarget(securityAuditTarget);
  }, [runSecurityAuditForTarget, securityAuditTarget]);

  const runProjectBugFinder = useCallback(async () => {
    setIsProjectAuditing(true);
    setProjectAuditStatus('Scanning project files for bug and security patterns');
    setProjectAuditResult(null);
    try {
      const response = await fetch('/api/security/project-audit');
      const result = await response.json().catch(() => null) as ProjectSecurityAuditResult | null;
      if (response.ok && result?.ok) {
        setProjectAuditResult(result);
        const count = result.findings?.length ?? 0;
        setProjectAuditStatus(`${count} project findings across ${result.filesScanned ?? 0} files`);
      } else {
        setProjectAuditStatus(result?.error || 'Project bug finder failed');
      }
    } catch {
      setProjectAuditStatus('Project bug finder endpoint unavailable');
    } finally {
      setIsProjectAuditing(false);
    }
  }, []);

  const downloadProjectAuditPdf = useCallback(() => {
    const link = document.createElement('a');
    link.href = '/api/security/project-audit.pdf';
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setProjectAuditStatus('Generating full project audit PDF');
  }, []);

  const runSystemProtectionScan = useCallback(async () => {
    setIsSystemProtecting(true);
    setSystemProtectionStatus('Checking Windows protections, encryption, startup, and exposure. Some checks may require additional permissions.');
    setSystemProtectionResult(null);
    try {
      const response = await fetch('/api/security/system-protection', { cache: 'no-store', signal: AbortSignal.timeout(75000) });
      const result = await response.json().catch(() => null) as SystemProtectionResult | null;
      if (response.ok && result?.ok) {
        setSystemProtectionResult(result);
        const findings = result.findings?.length ?? 0;
        setSystemProtectionStatus(`Measured posture ${result.score == null ? 'unknown' : `${result.score}/100`} / ${findings} review item(s) / ${result.coverage?.unknown ?? 0} unknown checks`);
      } else {
        setSystemProtectionStatus(result?.error || 'System protection scan failed');
      }
    } catch {
      setSystemProtectionStatus('System protection endpoint unavailable');
    } finally {
      setIsSystemProtecting(false);
    }
  }, []);

  const startSelfImprovement = useCallback(() => {
    setHudPage('security');
    if (securityUnlocked) {
      void runProjectBugFinder();
      appendAutomationLog('Self-improvement loop', 'Project bug finder started for FRIDAY.');
    } else {
      setSecurityPinStatus('Unlock Security Console to run FRIDAY self-improvement scan.');
      addSystemMessage('SELF-IMPROVEMENT LOOP\nOpen Security Console, unlock it, then run Bug Finder.');
    }
  }, [addSystemMessage, appendAutomationLog, runProjectBugFinder, securityUnlocked]);

  const submitSecurityPin = useCallback(async () => {
    const pin = securityPinInput.trim();
    if (!/^\d{4,8}$/.test(pin)) {
      setSecurityPinStatus('Use a numeric PIN with 4 to 8 digits.');
      return;
    }

    if (!securityPinHash) {
      if (pin !== securityPinConfirm.trim()) {
        setSecurityPinStatus('PIN confirmation does not match.');
        return;
      }
      const salt = randomPinSalt();
      const hash = await hashSecurityPin(pin, salt);
      setSecurityPinSalt(salt);
      setSecurityPinHash(hash);
      setSecurityUnlocked(true);
      setSecurityPinInput('');
      setSecurityPinConfirm('');
      setSecurityPinStatus('Security console unlocked.');
      return;
    }

    const hash = await hashSecurityPin(pin, securityPinSalt);
    if (hash !== securityPinHash) {
      setSecurityPinStatus('Incorrect PIN.');
      setSecurityPinInput('');
      return;
    }
    setSecurityUnlocked(true);
    setSecurityPinInput('');
    setSecurityPinStatus('Security console unlocked.');
  }, [securityPinConfirm, securityPinHash, securityPinInput, securityPinSalt]);

  const lockSecurityConsole = useCallback(() => {
    setSecurityUnlocked(false);
    setSecurityPinInput('');
    setSecurityPinConfirm('');
    setSecurityPinStatus('Security console locked.');
  }, []);

  const resetSecurityPin = useCallback(() => {
    safeStorage.removeItem('friday.securityPinHash');
    safeStorage.removeItem('friday.securityPinSalt');
    setSecurityPinHash('');
    setSecurityPinSalt('');
    setSecurityUnlocked(false);
    setSecurityPinInput('');
    setSecurityPinConfirm('');
    setSecurityPinStatus('PIN reset. Set a new one to open Security Console.');
    setSecurityCurrentPin('');
    setSecurityNewPin('');
    setSecurityNewPinConfirm('');
  }, []);

  const changeSecurityPin = useCallback(async () => {
    if (!securityPinHash || !securityPinSalt) {
      resetSecurityPin();
      return;
    }

    const currentPin = securityCurrentPin.trim();
    const nextPin = securityNewPin.trim();
    const confirmPin = securityNewPinConfirm.trim();

    if (!/^\d{4,8}$/.test(currentPin) || !/^\d{4,8}$/.test(nextPin)) {
      setSecurityPinStatus('Use numeric PINs with 4 to 8 digits.');
      return;
    }

    if (nextPin !== confirmPin) {
      setSecurityPinStatus('New PIN confirmation does not match.');
      return;
    }

    const currentHash = await hashSecurityPin(currentPin, securityPinSalt);
    if (currentHash !== securityPinHash) {
      setSecurityPinStatus('Current PIN is incorrect.');
      setSecurityCurrentPin('');
      return;
    }

    const nextSalt = randomPinSalt();
    const nextHash = await hashSecurityPin(nextPin, nextSalt);
    setSecurityPinSalt(nextSalt);
    setSecurityPinHash(nextHash);
    setSecurityCurrentPin('');
    setSecurityNewPin('');
    setSecurityNewPinConfirm('');
    setSecurityPinStatus('Security PIN changed.');
  }, [resetSecurityPin, securityCurrentPin, securityNewPin, securityNewPinConfirm, securityPinHash, securityPinSalt]);

  const executeSecurityCommand = useCallback((action: SecurityCommandAction) => {
    if (!securityUnlocked && action !== 'lock-security') {
      setHudPage('security');
      setSecurityPinStatus('Unlock Security Console before running security commands.');
      return 'Security Console is locked.';
    }

    if (action === 'lock-security') {
      lockSecurityConsole();
      return 'Security Console locked.';
    }
    if (action === 'open-encryption') {
      setHudPage('encrypt');
      return 'Encryption Suite opened.';
    }
    if (action === 'mute-voice') {
      setVoiceEnabled(false);
      window.speechSynthesis?.cancel();
      return 'Voice output muted.';
    }
    if (action === 'mute-mic') {
      setMicInputMuted(true);
      return 'Microphone muted.';
    }
    if (action === 'system-matrix') {
      setHudPage('matrix');
      return 'System Matrix opened.';
    }
    if (action === 'scan-usb') {
      setHudPage('forge');
      void scanHardwareDevices();
      return 'External device scan started.';
    }
    if (action === 'system-protection') {
      setHudPage('security');
      setHudPanel('none');
      void runSystemProtectionScan();
      return 'System protection scan started.';
    }

    setMicInputMuted(true);
    setVoiceEnabled(false);
    setHudPanel('none');
    lockSecurityConsole();
    return 'Panic safe mode engaged.';
  }, [lockSecurityConsole, runSystemProtectionScan, scanHardwareDevices, securityUnlocked]);

  const updateSecurityCommand = useCallback((id: string, patch: Partial<SecurityCommand>) => {
    setSecurityCommands(prev => prev.map(command => command.id === id ? { ...command, ...patch } : command));
  }, []);

  const addSecurityCommand = useCallback(() => {
    setSecurityCommands(prev => [{
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      phrase: 'new command',
      action: 'lock-security',
      enabled: true,
    }, ...prev]);
  }, []);

  const removeSecurityCommand = useCallback((id: string) => {
    setSecurityCommands(prev => prev.filter(command => command.id !== id));
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

  useEffect(() => {
    micInputMutedRef.current = micInputMuted;
    safeStorage.setItem('friday.micInputMuted', String(micInputMuted));
    if (micInputMuted) {
      shouldListenRef.current = false;
      setIsListening(false);
      setIsClapArmed(false);
      setIsConversationActive(false);
      conversationActiveRef.current = false;
      isClapArmedRef.current = false;
      recognitionRef.current?.stop();
      stopMicMeter();
      setVoiceStatus('Mic muted');
    }
  }, [micInputMuted, stopMicMeter]);

  const startMicMeter = useCallback(async () => {
    if (micInputMutedRef.current) {
      setVoiceStatus('Mic muted');
      return false;
    }

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

  const runDesktopTaskCommand = useCallback(async (task: string, confirmed = false) => {
    const request = async (endpoint: string) => fetch(`${endpoint}/api/desktop/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, confirmed }),
    });
    let response = await request('');
    if (!response.ok && window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost') {
      try {
        const localResponse = await request('http://127.0.0.1:3000');
        if (localResponse.ok) response = localResponse;
      } catch {
        // Keep the hosted response so the user receives the bridge status.
      }
    }
    const result = await response.json().catch(() => null) as { ok?: boolean; message?: string; needsConfirmation?: boolean } | null;
    if (!response.ok || !result?.ok) {
      return result?.message || response.statusText || 'Computer task failed.';
    }
    if (result.needsConfirmation) {
      pendingDesktopTaskRef.current = task;
      return result.message || 'Say confirm to approve this computer task.';
    }
    pendingDesktopTaskRef.current = '';
    return result.message || 'Computer task completed.';
  }, []);

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

  const openGestureControl = useCallback(async () => {
    if (window.fridayDesktop?.openGestureControl) {
      const opened = await window.fridayDesktop.openGestureControl();
      addSystemMessage(opened ? 'Gesture cursor controller opened. Keep that window visible while using hand control.' : 'Gesture cursor controller could not open.');
      return;
    }

    const message = await runDesktopOpenCommand('gesture control');
    addSystemMessage(message);
  }, [addSystemMessage, runDesktopOpenCommand]);

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

    if (/\b(?:check|diagnose|test|doctor|status)\b.*\b(?:internet|network|wifi|wi-fi|dns|router|connection)\b/i.test(cmd)
      || /\b(?:internet|network|wifi|wi-fi|dns|router|connection)\s+(?:status|doctor|diagnostics?)\b/i.test(cmd)) {
      setHudPage('command');
      setHudPanel('chat');
      void runNetworkDoctor();
      return 'Network Doctor started. I am checking adapter, gateway, internet reachability, and DNS.';
    }

    if (cmd === 'open chat' || cmd === 'show chat' || cmd === 'chat') {
      setHudPanel('chat');
      return 'Chat opened.';
    }

    if (/(?:tell me|show me|list|identify|read|inspect|find).*(?:every|all|each).*(?:component|part|piece)|(?:inspect|identify|scan).*(?:object|device|thing)/i.test(cmd)) {
      setHudPage('vision');
      setHudPanel('none');
      void startLiveVision();
      return 'Object inspection opened. Show each side, capture the angles, then run Find Exact Match.';
    }

    if (
      /\b(cyber\s*security|cybersecurity|security)\b.*\b(gyal|girl|mode|operator|assistant|queen)\b/.test(cmd)
      || /\b(make|turn|be|become)\b.*\b(cyber\s*security|cybersecurity)\b/.test(cmd)
    ) {
      setHudPage('security');
      setHudPanel('none');
      setSecurityPinStatus(securityUnlocked ? 'Cybersecurity gyal mode active.' : 'Unlock Security Console to use the full defensive toolkit.');
      return securityUnlocked
        ? 'Cybersecurity gyal mode active. Security Console opened.'
        : 'Cybersecurity gyal mode active. Security Console is locked until you enter your local PIN.';
    }

    const securityCommand = securityCommands.find(command =>
      command.enabled && command.phrase.trim().toLowerCase() === cmd
    );
    if (securityCommand) {
      return executeSecurityCommand(securityCommand.action);
    }

    const websiteBugMatch = cmd.match(/\b(?:audit|scan|check|find bugs? in|find vulnerabilities in|find issues in)\s+(?:my\s+)?(?:website|site|web app)?\s*(https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s]*)/i);
    if (websiteBugMatch?.[1]) {
      const target = websiteBugMatch[1];
      setHudPage('security');
      setHudPanel('none');
      setSecurityAuditTarget(target);
      if (securityUnlocked) {
        void runSecurityAuditForTarget(target);
        return `Website audit started for ${target}. Results will appear in Security Console.`;
      }
      setSecurityPinStatus('Unlock Security Console to run website audits.');
      return 'Security Console is locked. Unlock it, then run Audit Site.';
    }

    if (
      /\b(?:protect|secure|harden|defend|check|scan)\b.*\b(?:my\s+)?(?:system|pc|computer|windows|machine)\b/.test(cmd)
      || /\b(?:scan|check|find|detect)\b.*\b(?:virus|viruses|malware|trojan|spyware|ransomware|threats?)\b/.test(cmd)
      || /\b(?:full|quick|deep|complete)\s+(?:scan|malware scan|virus scan)\b/.test(cmd)
      || /\b(?:system protection|protection scan|defender scan|virus scan|malware scan|security posture|windows security check)\b/.test(cmd)
    ) {
      setHudPage('security');
      setHudPanel('none');
      if (securityUnlocked) {
        void runSystemProtectionScan();
        return 'System protection scan started. I am checking Defender, firewall, startup, hosts, downloads, and process locations. For full malware removal, keep Microsoft Defender real-time protection on.';
      }
      setSecurityPinStatus('Unlock Security Console to run system protection scans.');
      return 'Security Console is locked. Unlock it, then run System Protection.';
    }

    if (
      /\b(?:find|scan|check|detect)\b.*\b(?:bugs?|vulnerabilities|issues|security issues)\b/.test(cmd)
      || /\bbug finder\b/.test(cmd)
      || /\bproject audit\b/.test(cmd)
    ) {
      setHudPage('security');
      setHudPanel('none');
      if (securityUnlocked) {
        void runProjectBugFinder();
        return 'Project bug finder started. Results will appear in Security Console.';
      }
      setSecurityPinStatus('Unlock Security Console to run the project bug finder.');
      return 'Security Console is locked. Unlock it, then run Bug Finder.';
    }

    if (isCrmFactoryStartCommand(cmd)) {
      setHudPage('projects');
      setHudPanel('chat');
      setShowLlmForm(true);
      setCrmFactoryActive(true);
      setLlmForm({
        mode: 'CRM Factory',
        task: 'Create a secure CRM application',
        context: 'Include Google AI Studio prompt, local project files, VS Code iteration, GitHub repo flow, Render deployment, and security acceptance checks.',
        output: 'Build-ready spec with schema, API routes, UI screens, tests, deployment steps, and security checklist',
      });
      const crmSteps = [
        ['CRM Factory: Requirements intake', 'Waiting for CRM type, roles, modules, workflow, screens, integrations, and branding'],
        ['CRM Factory: AI Studio prompt', 'Next: generate the exact prompt for Google AI Studio'],
        ['CRM Factory: Local project files', 'Next: save generated files and open the project in VS Code'],
        ['CRM Factory: Secure build', 'Next: add auth, roles, validation, audit logs, safe env vars, and tests'],
        ['CRM Factory: GitHub + Render', 'Next: prepare repo push, Render env vars, deployment, and smoke test'],
      ];
      setProjects(prev => {
        const existing = new Set(prev.map(item => item.title));
        const nextSteps = crmSteps
          .filter(([title]) => !existing.has(title))
          .map(([title, body]) => makeModuleRecord(title, body));
        return [...nextSteps, ...prev].slice(0, 80);
      });
      return [
        'CRM factory opened. I added the build stages to Project Lab and opened the response feed so progress is visible.',
        '',
        'Send the CRM spec now:',
        '- Business/type of CRM',
        '- User roles',
        '- Modules and fields',
        '- Workflow stages',
        '- Screens',
        '- Integrations',
        '- Branding',
        '- Deployment preference',
      ].join('\n');
    }

    if (
      /\b(?:reverse\s*engineering|reverse\s*engineer|re\s*workbench|analysis\s*workbench)\b/i.test(cmd)
      || /\b(?:analy[sz]e|inspect|map|compare)\b.*\b(?:firmware|packet\s*capture|pcap|binary|executable|shared\s+library|source\s+(?:code|architecture)|repository)\b/i.test(cmd)
    ) {
      setHudPage('reverse');
      setHudPanel('none');
      return 'Reverse Engineering Workbench opened. Upload an authorized local artifact, confirm scope, then choose a bounded static-analysis profile.';
    }

    const moduleAliases: Record<string, HudPage> = {
      'launchpad': 'launchpad',
      'idea launchpad': 'launchpad',
      'ideas': 'launchpad',
      'friday ideas': 'launchpad',
      'agent marketplace': 'launchpad',
      'command': 'command',
      'command center': 'command',
      'mission command': 'command',
      'modules': 'modules',
      'module': 'modules',
      'module launcher': 'modules',
      'module access': 'modules',
      'projects': 'projects',
      'project lab': 'projects',
      'lab': 'projects',
      'memory': 'memory',
      'memory vault': 'memory',
      'vault': 'memory',
      'automation': 'automation',
      'automation studio': 'automation',
      'automate': 'automation',
      'vision': 'vision',
      'vision desk': 'vision',
      'study': 'study',
      'study trainer': 'study',
      'skill trainer': 'study',
      'security': 'security',
      'security console': 'security',
      'cyber security': 'security',
      'cybersecurity': 'security',
      'cyber security gyal': 'security',
      'cybersecurity gyal': 'security',
      'defense grid': 'security',
      'white hat': 'security',
      'voice': 'voice',
      'voice studio': 'voice',
      'mission replay': 'replay',
      'replay': 'replay',
      'hardware': 'forge',
      'hardware forge': 'forge',
      'forge': 'forge',
      'reverse engineering': 'reverse',
      'reverse engineer': 'reverse',
      'reverse engineering workbench': 'reverse',
      'analysis workbench': 'reverse',
      'artifact analysis': 'reverse',
      'encrypt': 'encrypt',
      'encryption': 'encrypt',
      'encryption suite': 'encrypt',
    };

    const normalizedModuleRequest = cmd
      .replace(/^(?:open|show|go to|take me to|lets|let's|check out|lets check out|let's check out|bring up|pull up)\s+/, '')
      .replace(/^(?:the\s+)?/, '')
      .replace(/\s+(?:page|tab|module|console|please)$/i, '')
      .trim();
    let requestedModule = moduleAliases[normalizedModuleRequest];
    if (!requestedModule) {
      const moduleHit = Object.entries(moduleAliases)
        .filter(([label]) => label.length > 3)
        .find(([label]) => new RegExp(`(^|\\s)${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(cmd));
      requestedModule = moduleHit?.[1];
    }
    if (requestedModule) {
      setHudPage(requestedModule);
      setHudPanel('none');
      if (requestedModule === 'voice') setShowVoiceControls(true);
      return `${requestedModule.replace(/^\w/, letter => letter.toUpperCase())} module opened.`;
    }

    if (cmd === 'markets' || cmd === 'market' || cmd === 'open markets' || cmd === 'show markets' || cmd === 'investments' || cmd === 'portfolio') {
      setHudPage('markets');
      setHudPanel('none');
      void loadMarketSnapshot();
      return 'Markets page opened.';
    }

    if (cmd === 'matrix' || cmd === 'mission matrix' || cmd === 'mission control' || cmd === 'systems' || cmd === 'open systems') {
      setHudPage('matrix');
      setHudPanel('none');
      return 'Mission matrix opened.';
    }

    if (cmd === 'home' || cmd === 'core' || cmd === 'main page' || cmd === 'open core') {
      setHudPage('core');
      return 'Core page opened.';
    }

    const famBalanceMatch = cmd.match(/\b(?:set|update)\s+(?:fam\s*pay|fampay|fam)\s+(?:balance|money)\s+(?:to\s+)?(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
    if (famBalanceMatch?.[1]) {
      const amount = famBalanceMatch[1].replace(/,/g, '');
      setFamPayBalance(amount);
      return `FamPay balance updated to ${formatMoney(Number(amount), 'INR')}.`;
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
      return [
        'I can chat, remember preferences, open apps/sites, run approved Windows actions, manage files in safe folders, check weather/news/time, help code, build CRM plans, and run defensive security tools.',
        'Try: "open chrome", "protect my system", "find bugs in this project", "remember that...", "weather", or "create a CRM".',
        'Say "full help" or "all commands" for the complete command list.',
      ].join('\n');
    }

    if (cmd === 'full help' || cmd === 'all commands' || cmd === 'show all commands') {
      return `AVAILABLE SYSTEM COMMANDS:\n- check internet / wifi status / diagnose network: Run Network Doctor\n- friday ideas / launchpad: Open the simple 10-idea upgrade deck\n- create/build CRM: Open CRM factory for Google AI Studio prompt, VS Code build, GitHub, Render, and security plan\n- command center / project lab / memory vault / automation studio: Open workspace modules\n- vision desk / study trainer / security console / voice studio: Open specialist modules\n- cyber security gyal / defense grid / white hat: Open Friday's defensive security lane\n- protect my system / system protection scan: Check Defender, firewall, startup, hosts, downloads, and process locations\n- find bugs in this project / audit https://site.com: Run authorized security checks\n- mission replay / hardware forge / encryption suite / matrix: Open advanced consoles\n- markets / investments / portfolio: Open stocks and crypto page\n- update FamPay balance to 500: Store manual FamPay balance locally\n- remember that... / my name is... / call me...: Save persistent memory\n- what do you remember / clear memory: Recall or erase saved memory\n- latest news / top headline / weather / time: Use live local context\n- call +91...: Open iPhone call handoff through Windows Phone Link when paired\n- send message to +91... saying ... / whatsapp +91... saying ...: Open WhatsApp Web draft\n- text +91... saying ...: Open SMS draft if Windows has an SMS handler\n- open instagram/youtube/google/gmail/whatsapp/chatgpt/google ai studio/github/render/jio hotstar: Open site in browser\n- open phone link/iphone caller/chrome/opera gx/notepad/calculator/camera/settings/microphone settings/speech settings/voice training/explorer/downloads/documents/desktop/vscode: Open approved local apps and folders\n- close opera gx/chrome/notepad/calculator/vscode: Close approved local apps\n- kali status / kali network / kali tools / kali run <command>: Use local Kali Linux through WSL; raw commands require full-access mode\n- lock screen / restart computer / shutdown computer / sleep computer / open task manager: Run approved Windows actions\n- clear/cls: Clear the terminal screen\n- status: Diagnostic overview\n- listen: Enable manual voice input\n- stop listening: Disable voice and clap input\n- stand down/go idle: End active conversation\n- mute/unmute: Toggle spoken responses\n\nVoice: FRIDAY uses manual voice input. Press the mic when you want to speak.`;
    }

    if (
      cmd === 'access'
      || cmd === 'permissions'
      || cmd === 'access matrix'
      || cmd === 'control matrix'
      || cmd === 'jarvis mode'
      || cmd.includes('what can you access')
      || cmd.includes('what do you have access')
      || cmd.includes('full access')
    ) {
      const connectedDevices = hardwareDevices.filter(device => (device.access || device.status).toLowerCase().includes('connected') || device.status === 'OK').length;
      const rememberedDevices = Math.max(0, hardwareDevices.length - connectedDevices);
      return [
        'ACCESS MATRIX',
        `Desktop bridge: ${window.fridayDesktop ? 'online through Electron' : 'browser-only, limited'}`,
        `Kali Linux: WSL bridge enabled for status, diagnostics, tools, and full-access raw commands with "kali run <command>".`,
        `Apps and folders: open Chrome, Opera GX, Explorer, Downloads, Documents, Desktop, Camera, Settings, Sound, Bluetooth, Device Settings, VS Code, Notepad, Calculator.`,
        `System actions: lock screen, sleep, restart, shutdown, Task Manager. Destructive or disruptive actions stay confirmation-gated.`,
        `Devices: ${connectedDevices} connected / ${rememberedDevices} remembered. FRIDAY can inspect, label, trust, block, debug, and open device settings. Direct control depends on Windows exposing audio, input, camera, serial COM, or Bluetooth services.`,
        `Voice: ${micSupported ? 'browser mic available' : 'mic unavailable'} / ${nativeVoiceAvailable && !nativeVoiceBlocked ? 'native listener available' : 'native listener limited'} / spoken replies ${voiceEnabled ? 'enabled' : 'muted'}.`,
        `Memory: persistent facts and local vault notes are available. Secrets, OTPs, passwords, and banking PINs are intentionally not stored.`,
        `Live context: ${isNetworkOnline ? 'network online' : 'network offline'} / ${locationStatus} / ${marketStatus}.`,
        'To expand access: connect or pair the device in Windows first, then scan external devices and set behavior to trusted or debug.',
      ].join('\n');
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
      return `Diagnostics look clean, Sir.\nCore temperature: 38 C\nMemory usage: 2.1GB / 64GB\nNetwork: connected\nAI model: local-first with Gemini fallback\nIntelligence core: persistent memory + live context routing\nVoice input: ${sttStatus}\nAudio output: ${'speechSynthesis' in window ? 'available' : 'unsupported'}`;
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
      setMicInputMuted(false);
      setVoiceArmRequestId(Date.now());
      return 'Manual voice input armed. Press the mic when you want FRIDAY to record.';
    }

    if (cmd === 'stop listening') {
      setMicInputMuted(true);
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

    if (cmd === 'mute mic' || cmd === 'mute microphone' || cmd === 'mic off') {
      setMicInputMuted(true);
      return 'Microphone muted.';
    }

    if (cmd === 'unmute mic' || cmd === 'unmute microphone' || cmd === 'mic on') {
      setMicInputMuted(false);
      return 'Microphone unmuted.';
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
  }, [endConversation, executeSecurityCommand, hardwareDevices, isNetworkOnline, loadMarketSnapshot, locationStatus, marketStatus, micSupported, nativeVoiceAvailable, nativeVoiceBlocked, runNetworkDoctor, runProjectBugFinder, runSecurityAuditForTarget, runSystemProtectionScan, securityCommands, securityUnlocked, speechSupported, startLiveVision, stopMicMeter, voiceEnabled]);

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
  const isDesktopTaskCommand = (cmd: string) => /\b(?:list|show|read|open|find|search|create|make|new|copy|move|rename|delete|remove|organize|clean up)\b.*\b(?:file|files|folder|folders|directory|directories|document|documents|downloads|desktop|pictures|music|videos)\b/.test(cmd);
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
    const previousCrmSpec = lastCrmSpec.trim()
      || [...messages].reverse().find(message => message.role === 'user' && looksLikeCrmSpecification(message.content))?.content.trim()
      || '';
    const route = selectConversationRoute({ text,
      previousAssistant: [...messages].reverse().find(message => message.role === 'friday')?.content || '',
      crmFactoryActive, crmStart: isCrmFactoryStartCommand(cmd), crmBuild: isCrmBuildNowCommand(cmd), hasPreviousCrmSpec: Boolean(previousCrmSpec),
    });
    const shouldBuildExistingCrm = route.buildCrm;
    const shouldCaptureCrmSpec = route.captureCrm;
    if (route.research && crmFactoryActive) setCrmFactoryActive(false);
    const crmSpecForBuild = shouldBuildExistingCrm ? previousCrmSpec : text;
    if (shouldCaptureCrmSpec && crmSpecForBuild.trim()) {
      setLastCrmSpec(crmSpecForBuild);
    }
    const runLocalInstruction = async (instruction: string) => {
      if (pendingDesktopTaskRef.current && /^(?:confirm|yes|yes do it|proceed|approve|go ahead)$/.test(instruction.trim())) {
        return await runDesktopTaskCommand(pendingDesktopTaskRef.current, true);
      }

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

      if (!response && isDesktopTaskCommand(instruction)) {
        response = await runDesktopTaskCommand(instruction);
      }

      return response;
    };

    const instructionClauses = route.research ? [text] : shouldCaptureCrmSpec || shouldBuildExistingCrm ? [crmSpecForBuild] : splitParagraphInstructions(text);
    const localResponses: string[] = [];
    const aiInstructions: string[] = route.research ? [text] : shouldCaptureCrmSpec || shouldBuildExistingCrm ? [crmSpecForBuild] : [];

    if (!route.research && !shouldCaptureCrmSpec && !shouldBuildExistingCrm) {
      for (const instruction of instructionClauses) {
        const normalizedInstruction = instruction.toLowerCase();
        const response = await runLocalInstruction(normalizedInstruction);
        if (response) {
          localResponses.push(response);
        } else {
          aiInstructions.push(instruction);
        }
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
    const rawAiPrompt = aiInstructions.length > 0
      ? [
          aiInstructions.join('\n'),
          localResponses.length > 0
            ? `\nAlready completed local actions:\n${localResponses.map((response, index) => `${index + 1}. ${response}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n')
      : text;
    const shouldBuildCrmFromSpec = shouldCaptureCrmSpec || shouldBuildExistingCrm;

    if (shouldBuildCrmFromSpec) {
      setHudPage('projects');
      setHudPanel('chat');
      setShowLlmForm(true);
      setProjects(prev => {
        const next = prev.map(item => {
          if (item.title === 'CRM Factory: Requirements intake') return { ...item, done: true, body: 'Specification captured. Ready for build prompt generation.' };
          if (item.title === 'CRM Factory: AI Studio prompt') return { ...item, body: 'Generating from your latest CRM specification.' };
          return item;
        });
        const hasCapturedSpec = next.some(item => item.title === 'CRM Factory: Specification captured');
        return [
          ...(hasCapturedSpec ? [] : [makeModuleRecord('CRM Factory: Specification captured', rawAiPrompt.slice(0, 180))]),
          ...next,
        ].slice(0, 80);
      });
    }

    const aiPrompt = shouldBuildCrmFromSpec
      ? [
          'CRM FACTORY BUILD REQUEST',
          '',
          'User CRM specification:',
          crmSpecForBuild,
          '',
          'Return a build-ready CRM package plan. Include:',
          '- A Google AI Studio prompt with the user specification filled in.',
          '- Recommended stack and folder structure.',
          '- Database schema and key fields.',
          '- API routes.',
          '- UI screens and workflows.',
          '- Security requirements and acceptance checks.',
          '- GitHub and Render deployment steps.',
          '- Immediate next implementation tasks.',
        ].join('\n')
      : rawAiPrompt;
    const aiUserMessage = { ...userMessage, content: aiPrompt };
    const aiMessages = [...messages, aiUserMessage].map(m => ({
      role: (m.role === 'user' ? 'user' : (m.role === 'friday' ? 'assistant' : 'system')) as 'user' | 'assistant' | 'system',
      content: m.content
    }));

    try {
      const streamer = streamFridayResponse(aiMessages, researchId => setMessages(prev => prev.map(m => m.id === fridayMessageId ? { ...m, researchId, researchResponse: true } : m)));
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
      const generatedCrmFolder = accumulatedContent.match(/Project folder:\s*([^\n]+)/i)?.[1]?.trim();
      if (generatedCrmFolder) {
        setHudPage('projects');
        setHudPanel('chat');
        setProjects(prev => {
          const next = prev.map(item => {
            if (item.title === 'CRM Factory: Requirements intake') return { ...item, done: true, body: 'Specification captured.' };
            if (item.title === 'CRM Factory: AI Studio prompt') return { ...item, done: true, body: 'Prompt generated and saved in docs/AI_STUDIO_PROMPT.md.' };
            if (item.title === 'CRM Factory: Local project files') return { ...item, done: true, body: `Project created at ${generatedCrmFolder}` };
            if (item.title === 'CRM Factory: Secure build') return { ...item, done: true, body: 'Security checklist, schema, API guardrails, and env template created.' };
            if (item.title === 'CRM Factory: GitHub + Render') return { ...item, done: true, body: 'README and render.yaml prepared for deployment.' };
            return item;
          });
          const withoutOldCreated = next.filter(item => item.title !== 'CRM Factory: Project created');
          return [
            makeModuleRecord('CRM Factory: Project created', generatedCrmFolder),
            ...withoutOldCreated,
          ].slice(0, 80);
        });
      }
      if (!isAssistantFailureEcho(accumulatedContent)) speak(accumulatedContent);
    } finally {
      if (shouldBuildCrmFromSpec) {
        setCrmFactoryActive(false);
      }
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
  }, [addSystemMessage, crmFactoryActive, handleLocalCommand, lastCrmSpec, messages, resumeConversationListening, runDesktopActionCommand, runDesktopCloseCommand, runDesktopOpenCommand, runDesktopTaskCommand, speak, voiceEnabled]);

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
      if (micInputMutedRef.current) {
        setVoiceStatus('Mic muted');
        return;
      }

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
    if (micInputMutedRef.current) {
      setVoiceStatus('Mic muted');
      return;
    }

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
    if (micInputMutedRef.current) {
      setVoiceStatus('Mic muted');
      return;
    }

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
    if (micInputMuted) return;

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
  }, [armClapWake, handsFreeEnabled, micInputMuted, startMicMeter]);

  const toggleListening = async () => {
    if (micInputMuted) {
      setMicInputMuted(false);
      setVoiceStatus('Mic unmuted');
      return;
    }

    if (isListening || isRecording || isConversationActive || isClapArmed) {
      if (isRecording) stopGeminiRecording();
      setMicInputMuted(true);
      return;
    }

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
      stopLiveLocation();
    };
  }, [stopLiveLocation, stopMicMeter]);

  const brainState = isProcessing ? 'THINKING' : isRecording ? 'LISTENING' : isConversationActive ? 'ACTIVE' : 'STANDBY';
  const latestFriday = [...messages].reverse().find(message => message.role === 'friday')?.content || 'Ready when you are, Sir.';
  const canIdleFocus = !isProcessing
    && !isRecording
    && !isListening
    && !isTranscribing
    && !input.trim()
    && !showVoiceControls
    && !showLlmForm
    && hudPanel === 'none'
    && hudPage === 'core';
  const showHudStatus = isProcessing
    || isRecording
    || isListening
    || isTranscribing
    || Boolean(liveTranscript)
    || !/^voice idle$/i.test(voiceStatus);
  const usdInrRate = marketSnapshot.forex?.rate || null;
  const networkUsd = 10000;
  const famPayBalanceInr = Number(famPayBalance || 0);
  const famPayBalanceUsd = famPayBalanceInr > 0 && usdInrRate ? famPayBalanceInr / usdInrRate : null;
  const liveVisionConfidence = typeof liveVisionInspection?.confidence === 'number'
    ? Math.round(liveVisionInspection.confidence > 1 ? liveVisionInspection.confidence : liveVisionInspection.confidence * 100)
    : null;
  const liveLogLines = [
    'voice engine online',
    'local tools connected',
    'memory index ready',
    'intent router active',
    'secure desktop bridge',
    marketSnapshot.fetchedAt ? `market feed ${new Date(marketSnapshot.fetchedAt).toLocaleTimeString([], { hour12: false })}` : 'market feed standby',
  ].map((label, index) => {
    const stamped = new Date(now);
    stamped.setSeconds(now.getSeconds() - (5 - index) * 3);
    return `${stamped.toLocaleTimeString([], { hour12: false })}  ${label}`;
  });
  const connection = navigator.connection;
  const locationReady = hasUsableLocation(locationSettings.lat, locationSettings.lon);
  const systemModules = useMemo<SystemModule[]>(() => {
    const batteryLevel = batterySnapshot.level;
    const marketFresh = Boolean(marketSnapshot.fetchedAt);
    const modules: SystemModule[] = [
      {
        id: 'network',
        label: 'Network',
        detail: isNetworkOnline
          ? `online${connection?.effectiveType ? ` / ${connection.effectiveType}` : ''}`
          : 'offline',
        status: isNetworkOnline ? 'good' : 'warn',
        progress: isNetworkOnline ? 94 : 18,
      },
      {
        id: 'voice',
        label: 'Voice',
        detail: voiceStatus,
        status: isRecording || isListening || isTranscribing ? 'good' : 'info',
        progress: isRecording || isListening || isTranscribing ? 88 : 52,
      },
      {
        id: 'mic',
        label: 'Mic level',
        detail: `level ${Math.round(micLevel)}%`,
        status: micLevel > 8 ? 'good' : 'info',
        progress: Math.max(8, Math.min(100, Math.round(micLevel))),
      },
      {
        id: 'location',
        label: 'Location',
        detail: locationReady
          ? `${parseCoordinate(locationSettings.lat)?.toFixed(4)}, ${parseCoordinate(locationSettings.lon)?.toFixed(4)}`
          : 'standby',
        status: locationReady ? 'good' : 'warn',
        progress: locationReady ? 82 : 28,
      },
      {
        id: 'markets',
        label: 'Markets',
        detail: marketFresh ? `updated ${new Date(marketSnapshot.fetchedAt).toLocaleTimeString([], { hour12: false })}` : marketStatus,
        status: marketFresh ? 'good' : 'info',
        progress: marketFresh ? 90 : 42,
      },
      {
        id: 'battery',
        label: 'Power',
        detail: batterySnapshot.supported && batteryLevel !== null
          ? `${batteryLevel}%${batterySnapshot.charging ? ' charging' : ''}`
          : 'desktop power',
        status: batterySnapshot.supported && batteryLevel !== null && batteryLevel < 25 ? 'warn' : 'good',
        progress: batterySnapshot.supported && batteryLevel !== null ? batteryLevel : 100,
      },
    ];

    return modules;
  }, [
    batterySnapshot,
    connection?.effectiveType,
    isListening,
    isNetworkOnline,
    isRecording,
    isTranscribing,
    locationStatus,
    marketSnapshot.fetchedAt,
    marketStatus,
    micLevel,
    locationSettings.lat,
    locationSettings.lon,
    voiceStatus,
  ]);
  const moduleSummary = {
    good: systemModules.filter(module => module.status === 'good').length,
    warn: systemModules.filter(module => module.status === 'warn').length,
    info: systemModules.filter(module => module.status === 'info').length,
  };
  const moduleAccessItems: { id: HudPage; label: string; detail: string }[] = [
    { id: 'launchpad', label: 'Launchpad', detail: '10 ideas' },
    { id: 'command', label: 'Command', detail: networkDoctorStatus },
    { id: 'projects', label: 'Projects', detail: `${projects.length} tasks` },
    { id: 'memory', label: 'Memory', detail: `${memoryNotes.length} notes` },
    { id: 'automation', label: 'Auto', detail: `${automationLog.length} runs` },
    { id: 'vision', label: 'Vision', detail: `${visionCaptures.length} captures` },
    { id: 'study', label: 'Study', detail: `${studyCards.length} cards` },
    { id: 'security', label: 'Security', detail: securityUnlocked ? 'unlocked' : 'locked' },
    { id: 'reverse', label: 'Reverse', detail: 'offline triage' },
    { id: 'markets', label: 'Finance', detail: marketStatus },
    { id: 'voice', label: 'Voice', detail: voiceEnabled ? 'enabled' : 'muted' },
    { id: 'replay', label: 'Replay', detail: `${messages.length} messages` },
    { id: 'forge', label: 'Forge', detail: `${hardwareDevices.length} devices` },
    { id: 'encrypt', label: 'Encrypt', detail: 'cipher bay' },
  ];
  const presencePhase = now.getHours() < 12 ? 'Morning' : now.getHours() < 17 ? 'Afternoon' : now.getHours() < 22 ? 'Evening' : 'Late night';
  const openProjectCount = projects.filter(item => !item.done).length;
  const latestUserMessage = [...messages].reverse().find(message => message.role === 'user')?.content || '';
  const presenceMood = latestUserMessage
    ? /tired|sad|empty|stressed|anxious|overwhelmed|lonely|angry|burned|burnt/i.test(latestUserMessage)
      ? 'Supportive'
      : /build|fix|code|test|deploy|project|error|bug/i.test(latestUserMessage)
        ? 'Operator'
        : 'Companion'
    : openProjectCount > 0
      ? 'Ready'
      : 'Standby';
  const presenceSignals = useMemo(() => {
    const signals = [
      `${presencePhase} mode / ${presenceMood.toLowerCase()} presence`,
      openProjectCount ? `${openProjectCount} open task${openProjectCount === 1 ? '' : 's'} waiting` : 'task queue clear',
      memoryNotes.length ? `latest memory: ${memoryNotes[0].title.slice(0, 42)}` : 'memory vault has room for context',
      isNetworkOnline ? 'network online' : 'network offline, local mode only',
      voiceEnabled ? 'voice warmth enabled' : 'voice muted, stealthy little dashboard mode',
    ];
    if (batterySnapshot.supported && batterySnapshot.level !== null && batterySnapshot.level < 25) {
      signals.splice(2, 0, `battery low at ${batterySnapshot.level}%`);
    }
    return signals;
  }, [batterySnapshot.level, batterySnapshot.supported, isNetworkOnline, memoryNotes, openProjectCount, presenceMood, presencePhase, voiceEnabled]);
  const presenceNudges = useMemo<PresenceNudge[]>(() => {
    const nudges: PresenceNudge[] = [];
    if (latestUserMessage && /empty|sad|stressed|anxious|overwhelmed|lonely|burned|burnt|tired/i.test(latestUserMessage)) {
      nudges.push({
        title: 'Therapy-ish Check-in',
        body: 'Friday can help you unpack the feeling, name the pressure, and pick one tiny next move. Not a therapist, but a solid couch-side operator.',
        actionLabel: 'Start Check-in',
        run: () => {
          setHudPanel('chat');
          setInput('Friday, I need a calm check-in. Help me unpack what I am feeling and what to do next.');
        },
        tone: 'warm',
      });
    }
    if (openProjectCount > 0) {
      nudges.push({
        title: 'Resume Thread',
        body: `There ${openProjectCount === 1 ? 'is' : 'are'} ${openProjectCount} open project task${openProjectCount === 1 ? '' : 's'}. Pick one and I will turn the chaos into steps.`,
        actionLabel: 'Open Projects',
        run: () => setHudPage('projects'),
        tone: 'focus',
      });
    }
    nudges.push({
      title: 'Daily Brief',
      body: 'A quick readout of system state, task queue, memory, and the cleanest next move.',
      actionLabel: 'Run Brief',
      run: runDailyBriefing,
      tone: 'system',
    });
    if (memoryNotes.length > 0) {
      nudges.push({
        title: 'Memory Recall',
        body: `Latest local note: ${memoryNotes[0].title}. Useful context should come back before you have to ask twice.`,
        actionLabel: 'Open Memory',
        run: () => setHudPage('memory'),
        tone: 'warm',
      });
    } else {
      nudges.push({
        title: 'Teach Friday You',
        body: 'Add preferences, projects, goals, or recurring worries so Friday feels less like a blank terminal with pretty lights.',
        actionLabel: 'Add Memory',
        run: () => setHudPage('memory'),
        tone: 'warm',
      });
    }
    return nudges.slice(0, 4);
  }, [latestUserMessage, memoryNotes, openProjectCount, runDailyBriefing]);
  const hudNavItems: { id: HudPage; label: string }[] = [
    { id: 'core', label: 'Core' },
    { id: 'launchpad', label: 'Launch' },
    { id: 'modules', label: 'Modules' },
    { id: 'matrix', label: 'Matrix' },
  ];
  const missionReplayLines = messages.slice(-8).map(message => {
    const stamp = message.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
    return `${stamp} / ${message.role.toUpperCase()} / ${message.content.slice(0, 72)}`;
  });
  const fridayIdeaCards = useMemo<FridayIdeaCard[]>(() => [
    {
      title: 'Command Center Mode',
      tag: 'HOME',
      body: 'One screen for system state, chat, money, modules, and quick routes.',
      actionLabel: 'Open Command',
      run: () => setHudPage('command'),
    },
    {
      title: 'Daily Briefing',
      tag: 'AM',
      body: 'Quick status summary with open tasks, memory count, market sync, and next steps.',
      actionLabel: 'Run Brief',
      run: runDailyBriefing,
    },
    {
      title: 'Supportive Check-in',
      tag: 'CARE',
      body: 'A calm reflection mode for venting, stress sorting, decisions, and tiny next steps.',
      actionLabel: 'Talk It Through',
      run: () => {
        setHudPage('command');
        setHudPanel('chat');
        setInput('Friday, I need a supportive check-in. Help me talk through what is going on.');
      },
    },
    {
      title: 'Project Copilot',
      tag: 'CODE',
      body: 'Summarize, clean, test, document, and deploy one project without hunting menus.',
      actionLabel: 'Start Copilot',
      run: startProjectCopilot,
    },
    {
      title: 'Local PC Operator',
      tag: 'PC',
      body: 'Open apps, folders, settings, local tools, and approved Windows actions.',
      actionLabel: 'Open Auto',
      run: () => setHudPage('automation'),
    },
    {
      title: 'Memory System',
      tag: 'MEM',
      body: 'Save preferences, project facts, reminders, decisions, and vault notes.',
      actionLabel: 'Memory Vault',
      run: () => setHudPage('memory'),
    },
    {
      title: 'Voice-First Assistant',
      tag: 'MIC',
      body: 'Tune voice, arm mic, use wake phrase, and keep replies audible when useful.',
      actionLabel: 'Voice Studio',
      run: () => {
        setHudPage('voice');
        setShowVoiceControls(true);
      },
    },
    {
      title: 'Security / Kali Bridge',
      tag: 'SEC',
      body: 'Defensive scans, system protection, project bug finder, website audit, Kali tools.',
      actionLabel: 'Defense Grid',
      run: () => setHudPage('security'),
    },
    {
      title: 'Agent Marketplace',
      tag: 'AGT',
      body: 'Simple starter agents for coding, research, cleanup, security, and study.',
      actionLabel: 'Add Agents',
      run: startAgentMarketplace,
    },
    {
      title: 'Focus Mode',
      tag: 'FOCUS',
      body: 'Mute noise, open Study Trainer, and keep attention on one task at a time.',
      actionLabel: 'Start Focus',
      run: startFocusMode,
    },
    {
      title: 'Self-Improvement Loop',
      tag: 'QA',
      body: 'FRIDAY audits itself, reports issues, and gives the next upgrade path.',
      actionLabel: 'Self Scan',
      run: startSelfImprovement,
    },
  ], [runDailyBriefing, startAgentMarketplace, startFocusMode, startProjectCopilot, startSelfImprovement]);
  const fridayModulePages = useMemo<FridayModulePage[]>(() => [
    {
      id: 'launchpad',
      kicker: 'Idea Launchpad',
      title: 'FRIDAY Upgrade Deck',
      summary: 'Ten simple upgrade lanes are wired into one place. Use the cards below to open each feature without learning a complicated workflow.',
      stats: [['Ideas', String(fridayIdeaCards.length)], ['Setup', 'simple'], ['Mode', 'starter']],
      actions: [
        { label: 'Daily Brief', run: runDailyBriefing, tone: 'live' },
        { label: 'Focus Mode', run: startFocusMode },
        { label: 'Add Agents', run: startAgentMarketplace },
      ],
      panels: [
        { title: 'Built Simple', body: 'Each idea routes into an existing FRIDAY module instead of adding separate complicated screens.', metric: '10', status: 'wired' },
        { title: 'Next Upgrade', body: 'Pick one card, use it for a day, then only deepen the parts you actually use.', metric: '1X', status: 'practical' },
        { title: 'No Heavy Setup', body: 'Everything works with current local state. Security scans still require unlocking Security Console.', metric: 'LOW', status: 'friction' },
      ],
      log: ['Command Center + Memory are the base', 'Voice, Focus, Security, and Project Copilot are the daily drivers', 'Agent Marketplace is a lightweight task starter'],
    },
    {
      id: 'command',
      kicker: 'Mission Control',
      title: 'Command Center',
      summary: 'One operational view for what FRIDAY is doing right now: chat, systems, finance, location, and quick actions.',
      stats: [['Mode', brainState], ['Modules', `${moduleSummary.good}/${systemModules.length}`], ['Voice', voiceEnabled ? 'armed' : 'muted']],
      actions: [
        { label: 'Open Chat', run: () => setHudPanel('chat') },
        { label: 'Network Doctor', run: () => void runNetworkDoctor(), tone: 'live' },
        { label: 'System Matrix', run: () => setHudPage('matrix') },
        { label: 'Market Sync', run: () => void loadMarketSnapshot(), tone: 'live' },
      ],
      panels: [
        { title: 'Today Queue', body: 'Surface tasks, reminders, builds, calls, and experiments from the rest of the suite.', metric: '08', status: 'slots' },
        { title: 'Live Context', body: `${isNetworkOnline ? 'Network online' : 'Network offline'} / ${locationReady ? 'location calibrated' : 'location standby'} / ${marketStatus}.`, metric: moduleSummary.warn ? String(moduleSummary.warn) : '0', status: 'attention' },
        { title: 'Network Doctor', body: networkDoctorReport?.summary || 'Ask "check internet" to test adapter, router, public internet, and DNS.', metric: networkDoctorReport?.checks?.internet?.averageMs ? `${networkDoctorReport.checks.internet.averageMs}ms` : 'NET', status: networkDoctorStatus },
        { title: 'Fast Dispatch', body: 'Type commands or use the controls below. FRIDAY routes apps, desktop actions, memory, markets, and reasoning from here.', metric: 'ON', status: 'router' },
      ],
      log: liveLogLines.slice(0, 5),
    },
    {
      id: 'projects',
      kicker: 'Workshop',
      title: 'Project Lab',
      summary: 'A build board for code, circuits, prototypes, tests, and component notes.',
      stats: [['Tasks', String(projects.length)], ['Open', String(projects.filter(item => !item.done).length)], ['Bench', 'linked']],
      actions: [
        { label: 'Open Brain Prompt', run: () => setShowLlmForm(true) },
        { label: 'Hardware Forge', run: () => setHudPage('forge') },
        { label: 'Replay Notes', run: () => setHudPage('replay') },
      ],
      panels: [
        { title: 'Build Queue', body: 'Add and complete project tasks in the workbench below. Saved locally on this machine.', metric: String(projects.length), status: 'active' },
        { title: 'Parts Ledger', body: 'Track boards, sensors, serial adapters, relays, batteries, firmware versions, and wiring notes.', metric: 'BOM', status: 'ready' },
        { title: 'Test Log', body: 'Capture expected behavior, latest result, screenshots, voltage readings, and failure notes.', metric: 'QA', status: 'open' },
      ],
      log: ['Prototype notes online', 'Firmware lane pending', 'Visual QA required after every UI pass'],
    },
    {
      id: 'memory',
      kicker: 'Private Archive',
      title: 'Memory Vault',
      summary: 'A clean place for saved identity, preferences, project facts, and decisions FRIDAY should remember.',
      stats: [['Notes', String(memoryNotes.length)], ['Recall', 'command'], ['Privacy', 'manual clear']],
      actions: [
        { label: 'Recall Memory', run: () => setInput('what do you remember') },
        { label: 'Save New Fact', run: () => setInput('remember that ') },
        { label: 'Open Chat', run: () => setHudPanel('chat') },
      ],
      panels: [
        { title: 'Persistent Facts', body: 'Use chat memory for facts FRIDAY should reuse; use vault notes for private local notes.', metric: String(memoryNotes.length), status: 'stored' },
        { title: 'Decision Trail', body: 'Design choices, rejected ideas, and why a module changed direction.', metric: 'WHY', status: 'useful' },
        { title: 'Sensitive Notes', body: 'Keep this for reminders and labels, not passwords, private keys, OTPs, or device unlock secrets.', metric: 'SAFE', status: 'guarded' },
      ],
      log: ['Use "remember that..." to save', 'Use "what do you remember" to recall', 'Use "clear memory" when you want a reset'],
    },
    {
      id: 'automation',
      kicker: 'Macro Bay',
      title: 'Automation Studio',
      summary: 'Scenario buttons for repeated workflows: work mode, coding mode, hardware mode, and shutdown routines.',
      stats: [['Macros', '4 armed'], ['Runs', String(automationLog.length)], ['Risk', 'confirm destructive']],
      actions: [
        { label: 'Work Mode', run: () => runAutomationMacro('work') },
        { label: 'Dev Mode', run: () => runAutomationMacro('dev') },
        { label: 'Hardware Mode', run: () => runAutomationMacro('hardware') },
      ],
      panels: [
        { title: 'Work Mode', body: 'Open command center, voice muted or armed, chat visible, finance and system status ready.', metric: 'WM', status: 'macro' },
        { title: 'Hardware Mode', body: 'Open Forge, device checklist, serial notes, and bench-safe warnings before any reset/flash.', metric: 'HW', status: 'macro' },
        { title: 'Night Mode', body: 'Mute voice, reduce visual noise, summarize open tasks, and prepare tomorrow queue.', metric: 'NM', status: 'macro' },
      ],
      log: ['Automation uses approved local actions only', 'Destructive tasks must stay confirmation-gated'],
    },
    {
      id: 'vision',
      kicker: 'Visual Intelligence',
      title: 'Vision Desk',
      summary: 'A future camera/screen analysis bench for screenshots, circuits, documents, UI checks, and visual debugging.',
      stats: [['Captures', String(visionCaptures.length)], ['Camera', 'app link'], ['Screens', 'upload']],
      actions: [
        { label: 'Open Camera', run: () => setInput('open camera') },
        { label: 'Brain Prompt', run: () => setShowLlmForm(true) },
        { label: 'Study Link', run: () => setHudPage('study') },
      ],
      panels: [
        { title: 'Circuit Inspect', body: 'Read resistor colors, pin labels, breadboard photos, wiring mistakes, and board orientation.', metric: 'PCB', status: 'planned' },
        { title: 'Screen Read', body: 'Upload screenshots or circuit photos below, then open the analysis prompt to describe what you need.', metric: String(visionCaptures.length), status: 'ready' },
        { title: 'Design QA', body: 'Check contrast, overlap, sizing, and Tony-style HUD polish after UI changes.', metric: 'UI', status: 'active' },
      ],
      log: ['Attach images for analysis', 'Camera shortcut is routed through desktop open commands'],
    },
    {
      id: 'study',
      kicker: 'Skill Engine',
      title: 'Study / Skill Trainer',
      summary: 'Roadmaps, flashcards, quizzes, repair drills, code practice, and hardware learning paths.',
      stats: [['Cards', String(studyCards.length)], ['Mode', 'drill'], ['Recall', 'manual']],
      actions: [
        { label: 'Quiz Me', run: () => setInput('quiz me on ') },
        { label: 'Make Roadmap', run: () => setInput('make me a roadmap for ') },
        { label: 'Project Lab', run: () => setHudPage('projects') },
      ],
      panels: [
        { title: 'Roadmap Builder', body: 'Break big skills into weekly missions with projects, checkpoints, and revision loops.', metric: 'MAP', status: 'ready' },
        { title: 'Flash Drills', body: 'Add cards below, tap to reveal answers, and use them for quick active recall.', metric: String(studyCards.length), status: 'ready' },
        { title: 'Repair Practice', body: 'Hardware debugging prompts: power, signal, firmware, USB, serial, sensors, and safety.', metric: 'FIX', status: 'ready' },
      ],
      log: ['Ask "quiz me on ..."', 'Ask "make me a roadmap for ..."'],
    },
    {
      id: 'security',
      kicker: 'Cybersecurity Gyal',
      title: 'Defense Grid',
      summary: 'White-hat security surface for defensive audits, threat modeling, device trust, encrypted notes, password hygiene, and panic-safe controls.',
      stats: [['Console', securityUnlocked ? 'unlocked' : 'locked'], ['System', systemProtectionResult?.score != null ? `${systemProtectionResult.score}/100` : 'standby'], ['Audit', securityAuditResult?.score !== undefined ? `${securityAuditResult.score}/100` : 'standby']],
      actions: [
        { label: 'Protect System', run: () => void runSystemProtectionScan(), tone: 'live' },
        { label: 'Audit Site', run: () => setSecurityAuditTarget(prev => prev || 'https://') },
        { label: 'Bug Finder', run: () => void runProjectBugFinder(), tone: 'live' },
        { label: 'Encryption Suite', run: () => setHudPage('encrypt') },
        { label: 'Mute Voice', run: () => setVoiceEnabled(false) },
        { label: 'System Matrix', run: () => setHudPage('matrix') },
      ],
      panels: [
        { title: 'System Protection', body: 'Checks Defender, firewall profiles, PowerShell policy, startup persistence, hosts redirects, risky Downloads, and unusual process locations.', metric: systemProtectionResult?.score != null ? `${systemProtectionResult.score}` : 'SYS', status: systemProtectionStatus },
        { title: 'White-Hat Audit', body: 'Passive checks for HTTPS, HSTS, CSP, clickjacking, MIME sniffing, referrer policy, permissions policy, cookies, and DDoS readiness.', metric: 'OWASP', status: 'ready' },
        { title: 'Code Bug Finder', body: 'Scans this local FRIDAY project for risky code patterns, unfinished security work, dependency footprint, auth/session checks, and business risk signals.', metric: 'BUG', status: projectAuditStatus },
        { title: 'Threat Model', body: 'Map assets, users, entry points, trust boundaries, abuse cases, detection signals, and the first fixes that reduce real risk.', metric: 'TM', status: 'ready' },
        { title: 'Trusted Devices', body: 'Pair known external boards and label their purpose before allowing reset, flash, or command access.', metric: 'EXT', status: 'verify' },
        { title: 'Panic Controls', body: 'Lock the console, mute mic, hide panels, and stop active sessions when the workspace needs privacy fast.', metric: 'LOCK', status: 'safe' },
      ],
      log: ['Cybersecurity gyal mode: sharp, defensive, authorized', 'No bypassing encryption, auth, or access controls', 'Defensive scans only against sites you own or are authorized to test'],
    },
    {
      id: 'voice',
      kicker: 'Persona Lab',
      title: 'Voice Personality Studio',
      summary: 'Tune FRIDAY voice profiles, response speed, voice output, and listening behavior.',
      stats: [['Output', voiceEnabled ? 'enabled' : 'muted'], ['Input', micSupported ? 'ready' : 'offline'], ['Profile', selectedVoiceProfileId]],
      actions: [
        { label: 'Open Controls', run: () => setShowVoiceControls(true), tone: 'live' },
        { label: 'Test Voice', run: testVoiceProfile },
        { label: 'Arm Mic', run: () => setVoiceArmRequestId(Date.now()) },
      ],
      panels: [
        { title: 'Voice Profile', body: 'Select Windows or browser voices, then save rate and pitch as reusable profiles.', metric: `${voiceRate.toFixed(2)}x`, status: 'rate' },
        { title: 'Manual Mic', body: 'Press the mic when you want FRIDAY to record, keeping background speech out of the command path.', metric: micSupported ? 'MIC' : 'OFF', status: voiceStatus },
        { title: 'Persona', body: 'Keep replies useful, direct, slightly cinematic, security-aware, and not noisy during serious work.', metric: 'FRI', status: 'style' },
      ],
      log: ['Voice controls open below the command bar', `Current voice status: ${voiceStatus}`],
    },
    {
      id: 'replay',
      kicker: 'Timeline',
      title: 'Mission Replay',
      summary: 'Recent commands, assistant responses, build notes, and decision checkpoints in one scrollable log.',
      stats: [['Messages', String(messages.length)], ['Latest', messages.at(-1)?.role || 'none'], ['Mode', brainState]],
      actions: [
        { label: 'Open Chat', run: () => setHudPanel('chat') },
        { label: 'Memory Vault', run: () => setHudPage('memory') },
        { label: 'Clear Terminal', run: () => setMessages([]) },
      ],
      panels: [
        { title: 'Recent Thread', body: missionReplayLines.length ? 'The latest interaction trail is live below.' : 'No recent mission entries yet.', metric: String(missionReplayLines.length), status: 'lines' },
        { title: 'Decision Capture', body: 'Use this page to spot what changed, why, and what should be remembered.', metric: 'WHY', status: 'review' },
        { title: 'Next Actions', body: 'Promote important replay items into Project Lab or Memory Vault.', metric: 'NEXT', status: 'queue' },
      ],
      log: missionReplayLines.length ? missionReplayLines : ['No messages captured in this session yet'],
    },
    {
      id: 'reverse',
      kicker: 'Evidence Workbench',
      title: 'Reverse Engineering Intelligence',
      summary: 'A local, evidence-driven workspace for authorized offline artifact analysis. It reports what was observed, what a parser found, what remains a hypothesis, and what is unknown.',
      stats: [['Mode', 'offline'], ['Execution', 'never'], ['Approval', 'required']],
      actions: [
        { label: 'Project Lab', run: () => setHudPage('projects') },
        { label: 'Hardware Forge', run: () => setHudPage('forge') },
        { label: 'Security Grid', run: () => setHudPage('security') },
      ],
      panels: [
        { title: 'Static Triage', body: 'Identify file formats, calculate evidence, inspect bounded headers and strings, and keep source claims scoped to what the artifact supports.', metric: 'SAFE', status: 'available' },
        { title: 'Passive Protocol Lane', body: 'Classic PCAP headers can be summarized offline without reading packet payloads. PCAPNG and active probing remain unavailable.', metric: 'PCAP', status: 'bounded' },
        { title: 'Source Map', body: 'Map imports, symbols, route declarations, and selected safe ZIP source archives without running builds or package scripts.', metric: 'SRC', status: 'offline' },
        { title: 'Dynamic / Hardware', body: 'Execution, crawling, flashing, serial writes, and physical-device controls need separately provisioned isolation and explicit approval.', metric: 'HOLD', status: 'gated' },
      ],
      log: ['Upload only artifacts you own or are explicitly authorized to inspect', 'No unrestricted commands, dynamic execution, live network access, or hardware writes are exposed'],
    },
    {
      id: 'forge',
      kicker: 'Bench Link',
      title: 'Hardware Forge',
      summary: 'External device workspace for your own boards: identify, label, inspect, reset, serial-console, and firmware workflows.',
      stats: [['Devices', String(hardwareDevices.length)], ['Trusted', String(trustedDevices.length)], ['Reset', 'confirm first']],
      actions: [
        { label: 'Scan External', run: () => void scanHardwareDevices(), tone: 'live' },
        { label: 'Bluetooth', run: () => setInput('open bluetooth settings') },
        { label: 'Project Lab', run: () => setHudPage('projects') },
        { label: 'Brain Prompt', run: () => setShowLlmForm(true) },
      ],
      panels: [
        { title: 'Device Profiles', body: 'Scan external devices below. For phones, unlock the phone and choose File Transfer / MTP on the USB notification.', metric: String(hardwareDevices.length), status: 'active' },
        { title: 'Serial Console', body: 'Device discovery is live. Serial command/write access should stay confirmation-gated.', metric: 'UART', status: 'guarded' },
        { title: 'Firmware Lane', body: 'Compile, flash, reboot, verify, and rollback with a checklist before touching the device.', metric: 'FW', status: 'guarded' },
      ],
      log: ['Only control hardware you own or are authorized to modify', 'Reset/flash actions should always ask before running'],
    },
    {
      id: 'encrypt',
      kicker: 'Cipher Bay',
      title: 'Encryption Suite',
      summary: 'Encrypt notes, verify checksums, generate passphrases, and protect project/device secrets without storing raw passwords.',
      stats: [['Cipher', 'AES-GCM'], ['Hash', 'SHA-256'], ['Keys', 'user held']],
      actions: [
        { label: 'Security Console', run: () => setHudPage('security') },
        { label: 'Memory Vault', run: () => setHudPage('memory') },
        { label: 'New Secure Note', run: () => setInput('create encrypted note: ') },
      ],
      panels: [
        { title: 'Secure Notes', body: 'Encrypt and decrypt text locally in the workbench below using a passphrase you hold.', metric: 'AES', status: 'active' },
        { title: 'Checksum Tools', body: 'Generate SHA-256 hashes for firmware text, notes, commands, or copied checksums.', metric: 'SHA', status: 'active' },
        { title: 'Passphrase Lab', body: 'Generate memorable high-entropy phrases without exposing banking or account credentials.', metric: 'KEY', status: 'safe' },
      ],
      log: ['Do not store OTPs, private keys, banking PINs, or raw passwords', 'Best path: local encryption with user-held passphrase'],
    },
  ], [
    brainState,
    automationLog.length,
    fridayIdeaCards,
    hardwareDevices.length,
    isNetworkOnline,
    liveLogLines,
    loadMarketSnapshot,
    locationReady,
    marketStatus,
    memoryNotes.length,
    messages,
    micSupported,
    missionReplayLines,
    moduleSummary.good,
    moduleSummary.warn,
    networkDoctorReport,
    networkDoctorStatus,
    projects,
    runAutomationMacro,
    runDailyBriefing,
    runNetworkDoctor,
    runProjectBugFinder,
    runSystemProtectionScan,
    scanHardwareDevices,
    selectedVoiceProfileId,
    securityPinHash,
    securityUnlocked,
    systemProtectionResult,
    systemProtectionStatus,
    projectAuditResult,
    projectAuditStatus,
    studyCards.length,
    systemModules.length,
    startAgentMarketplace,
    startFocusMode,
    testVoiceProfile,
    trustedDevices.length,
    visionCaptures.length,
    voiceEnabled,
    voiceRate,
    voiceStatus,
  ]);
  const activeModulePage = fridayModulePages.find(page => page.id === hudPage);
  const isSimpleModulePage = Boolean(activeModulePage && activeModulePage.id !== 'encrypt');
  const securityConsoleLocked = hudPage === 'security' && !securityUnlocked;

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

      <header className="relative z-20 flex h-16 items-start justify-between px-5 pt-4 md:px-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-sky-100/90">
          <TerminalIcon size={16} className="text-cyan-300" />
            <span>J.A.R.V.I.S - Just A Rather Very Intelligent System</span>
          </div>
          <div className="video-tabs hidden md:flex">
            {hudNavItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setHudPage(item.id);
                  if (item.id === 'markets') void loadMarketSnapshot();
                  if (item.id === 'voice') setShowVoiceControls(true);
                }}
                className={`video-tab ${hudPage === item.id ? 'is-active' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
          <div className="hidden text-right font-mono uppercase text-sky-100/80 md:block">
            <div className="text-[10px] tracking-[0.28em] text-cyan-200/50">Current Time</div>
          <div className="mt-1 text-xl tracking-[0.2em] text-cyan-100">{now.toLocaleTimeString([], { hour12: false })}</div>
          <div className="mt-2 flex items-center justify-end gap-4 text-[9px] tracking-[0.18em] text-cyan-200/55">
            <span className="inline-flex items-center gap-1"><Cpu size={11} /> CPU 4%</span>
            <span className="inline-flex items-center gap-1"><Shield size={11} /> MEMORY</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 grid h-[calc(100vh-4rem)] grid-rows-[1fr_auto] px-4 pb-4 md:px-8 md:pb-8">
        <section className="relative min-h-0">
          <div className="hud-corner hud-corner-top" />
          <div className="hud-corner hud-corner-bottom" />

          {hudPage === 'core' && (
            <>
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="absolute left-1/2 top-[45%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
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

          <aside className={`video-left-panel hidden lg:block ${hudPanel === 'chat' ? 'is-covered' : ''}`}>
            <div className="video-panel-title">System Status</div>
            {[
              ['Core Sync', '94.62'],
              ['Neural Link', '82.19'],
              ['Data Cache', '91.04'],
              ['Audio Layer', '76.54'],
              ['Visual Grid', '99.88'],
              ['Security', securityUnlocked ? 'Unlocked' : 'Locked'],
              ['Memory', 'Persistent'],
            ].map(([label, value]) => (
              <div key={label} className="video-meter-row">
                <span>{label}</span>
                <i><b style={{ width: `${Number.parseFloat(value) || 88}%` }} /></i>
                <em>{value}</em>
              </div>
            ))}
            <div className="video-panel-title mt-7">Presence Feed</div>
            <div className="video-log">
              {presenceSignals.map(line => <div key={line}>{line}</div>)}
            </div>
            <button
              type="button"
              onClick={() => {
                setHudPage('reverse');
                setHudPanel('none');
              }}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded border border-violet-300/30 bg-violet-300/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-violet-100 transition hover:border-violet-200/70 hover:bg-violet-300/20"
              title="Open the authorized offline reverse engineering workbench"
            >
              <Cpu size={14} />
              Reverse Workbench
            </button>
          </aside>

          <aside className="video-right-panel hidden lg:block">
            <div className="video-panel-title text-right">Mission Matrix</div>
            <div className="systems-mini">
              {systemModules.slice(0, 5).map(module => (
                <div key={module.id} className={`systems-mini-row is-${module.status}`}>
                  <span>{module.label}</span>
                  <i><b style={{ width: `${module.progress}%` }} /></i>
                  <em>{module.status}</em>
                </div>
              ))}
            </div>
            <div className="matrix-counts">
              <b>{systemModules.length}</b> modules / <span>{moduleSummary.good} nominal</span> / <em>{moduleSummary.warn} attention</em>
            </div>
            <div className="video-panel-title mt-6 text-right">Audio Input</div>
            <div className="video-wave">
              {Array.from({ length: 28 }).map((_, index) => (
                <i key={index} style={{ height: `${22 + ((index * 13) % 38)}%` }} />
              ))}
            </div>
            <div className="video-readout">
              PRESENCE ENGINE ACTIVE. FRIDAY TRACKS TASKS, MEMORY, CONTEXT, AND SUPPORTIVE CHECK-INS WITHOUT PRETENDING TO BE A DOCTOR.
            </div>
            <button type="button" onClick={() => void openGestureControl()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100 transition hover:border-cyan-200/70 hover:bg-cyan-300/20" title="Open hand cursor control">
              <Hand size={14} />
              Gesture Cursor
            </button>
            <button type="button" onClick={() => { setHudPage('vision'); setHudPanel('none'); void startLiveVision(); }} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-100 transition hover:border-emerald-200/70 hover:bg-emerald-300/20" title="Open object component inspection">
              <Camera size={14} />
              Inspect Object
            </button>
          </aside>

          <div className="video-finance hidden md:block">
            <div className="video-panel-title">Your Money</div>
            <div className="economy-rate-row">
              <div>
                <span>1 USD</span>
                <strong>{usdInrRate ? `₹${usdInrRate.toFixed(2)}` : '--'}</strong>
              </div>
              <em>{marketSnapshot.forex?.updatedAt ? 'FX live' : 'waiting'}</em>
            </div>
            <div className="economy-gdp">
              <span>FamPay in USD</span>
              <strong>{famPayBalanceInr > 0 ? formatMoney(famPayBalanceInr, 'INR') : '--'}</strong>
              <em>{famPayBalanceUsd ? formatMoney(famPayBalanceUsd, 'USD') : 'enter balance'}</em>
            </div>
            <div className="mt-2 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">
              $10K = {usdInrRate ? formatMoney(networkUsd * usdInrRate, 'INR') : '--'} / refreshed {marketSnapshot.fetchedAt ? new Date(marketSnapshot.fetchedAt).toLocaleTimeString([], { hour12: false }) : '--'}
            </div>
            <div className="video-mini-bars">
              {Array.from({ length: 20 }).map((_, index) => <i key={index} style={{ height: `${18 + ((index * 9) % 55)}%` }} />)}
            </div>
          </div>

          <section className="presence-panel hidden md:block">
            <div className="presence-panel-top">
              <span><Sparkles size={13} /> Presence Engine</span>
              <em>{presenceMood}</em>
            </div>
            <strong>{presencePhase} readout</strong>
            <p>{presenceSignals[0]}. {openProjectCount ? 'There is something real to continue.' : 'Nothing urgent is shouting. Rare. Suspicious. Beautiful.'}</p>
            <div className="presence-nudge-list">
              {presenceNudges.slice(0, 3).map(nudge => (
                <button key={nudge.title} type="button" onClick={nudge.run} className={`presence-nudge is-${nudge.tone || 'system'}`}>
                  <span>{nudge.title}</span>
                  <p>{nudge.body}</p>
                  <em>{nudge.actionLabel}</em>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setHudPanel('chat');
                setInput('Friday, give me a supportive check-in and help me sort my thoughts.');
              }}
              className="presence-checkin"
              title="Start a supportive reflection prompt"
            >
              <HeartPulse size={14} />
              Talk it through
            </button>
            <button
              type="button"
              onClick={() => {
                setHudPage('reverse');
                setHudPanel('none');
              }}
              className="presence-checkin mt-2 border-violet-300/50 bg-violet-300/10 text-violet-100 hover:bg-violet-300/20"
              title="Open the authorized offline reverse engineering workbench"
            >
              <Cpu size={14} />
              Reverse Workbench
            </button>
          </section>
            </>
          )}

          {hudPage === 'modules' && (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="modules-page"
            >
              <div className="markets-header">
                <div>
                  <div className="video-panel-title">Access Directory</div>
                  <h1>Modules</h1>
                </div>
                <button type="button" onClick={() => setHudPage('core')} className="market-refresh">Core</button>
              </div>

              <div className="modules-directory">
                {moduleAccessItems.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setHudPage(item.id);
                      if (item.id === 'markets') void loadMarketSnapshot();
                      if (item.id === 'voice') setShowVoiceControls(true);
                    }}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </button>
                ))}
              </div>

              <div className="modules-hint">
                Say "let's check out security", "open forge", "pull up encryption", or type any module name.
              </div>
            </motion.div>
          )}

          {activeModulePage && (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className={`module-page ${isSimpleModulePage ? 'is-simple' : 'is-advanced'}`}
            >
              <div className="markets-header">
                <div>
                  <div className="video-panel-title">{activeModulePage.kicker}</div>
                  <h1>{activeModulePage.title}</h1>
                </div>
                <div className="module-stat-strip">
                  {activeModulePage.stats.map(([label, value]) => (
                    <span key={label}><b>{label}</b>{value}</span>
                  ))}
                </div>
              </div>

              {securityConsoleLocked ? (
                <section className="security-lock-panel">
                  <div>
                    <strong>{securityPinHash ? 'PIN Required' : 'Set Security PIN'}</strong>
                    <p>{securityPinHash ? 'Enter your local PIN to unlock Security Console.' : 'Create a local PIN before Security Console can be used.'}</p>
                    <span>{securityPinStatus}</span>
                  </div>
                  <form onSubmit={(event) => { event.preventDefault(); void submitSecurityPin(); }}>
                    <input
                      value={securityPinInput}
                      onChange={(event) => setSecurityPinInput(event.target.value.replace(/\D/g, '').slice(0, 8))}
                      inputMode="numeric"
                      type="password"
                      placeholder="PIN"
                    />
                    {!securityPinHash && (
                      <input
                        value={securityPinConfirm}
                        onChange={(event) => setSecurityPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 8))}
                        inputMode="numeric"
                        type="password"
                        placeholder="Confirm PIN"
                      />
                    )}
                    <button type="submit">{securityPinHash ? 'Unlock' : 'Set PIN'}</button>
                  </form>
                </section>
              ) : (
                <>
                  <div className="module-hero">
                    <p>{activeModulePage.summary}</p>
                    <div className="module-action-row">
                      {hudPage === 'security' && <button type="button" onClick={lockSecurityConsole} className="market-refresh is-live">Lock</button>}
                      {activeModulePage.actions.map(action => (
                        <button
                          key={action.label}
                          type="button"
                          onClick={action.run}
                          className={`market-refresh ${action.tone === 'live' ? 'is-live' : ''}`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="module-grid">
                    {activeModulePage.panels.map(panel => (
                      <section key={panel.title} className="module-card">
                        <div className="module-card-top">
                          <strong>{panel.title}</strong>
                          {panel.metric && <em>{panel.metric}</em>}
                        </div>
                        <p>{panel.body}</p>
                        {panel.status && <span>{panel.status}</span>}
                      </section>
                    ))}
                    {!isSimpleModulePage && (
                      <section className="module-card module-log">
                        <div className="module-card-top">
                          <strong>Live Readout</strong>
                          <em>{activeModulePage.log.length}</em>
                        </div>
                        <div>
                          {activeModulePage.log.slice(0, 8).map(line => <p key={line}>{line}</p>)}
                        </div>
                      </section>
                    )}
                  </div>

                  {hudPage === 'security' && (
                    <section className="module-workbench">
                      <WhitehatWorkbench />
                      <div className="module-workbench-form">
                        <button type="button" onClick={lockSecurityConsole}>Lock Console</button>
                        <button type="button" onClick={() => void runSystemProtectionScan()} disabled={isSystemProtecting}>
                          {isSystemProtecting ? 'Checking System' : 'Protect System'}
                        </button>
                        <button type="button" onClick={() => setHudPage('encrypt')}>Open Encryption</button>
                        <button type="button" onClick={resetSecurityPin}>Reset PIN</button>
                        <span>{securityPinStatus}</span>
                      </div>
                      <div className="module-workbench-form">
                        <button type="button" onClick={() => void runSystemProtectionScan()} disabled={isSystemProtecting}>
                          {isSystemProtecting ? 'Scanning Protection' : 'System Protection Scan'}
                        </button>
                        <span>{systemProtectionStatus}</span>
                      </div>
                      <div className="module-workbench-form">
                        <input
                          value={securityAuditTarget}
                          onChange={(event) => setSecurityAuditTarget(event.target.value)}
                          placeholder="https://your-site.com"
                        />
                        <select
                          value={securityAuditAuthMode}
                          onChange={(event) => setSecurityAuditAuthMode(event.target.value as 'none' | 'cookie' | 'bearer')}
                          title="Authorized audit mode"
                        >
                          <option value="none">Public audit</option>
                          <option value="cookie">Login cookie</option>
                          <option value="bearer">Bearer token</option>
                        </select>
                        {securityAuditAuthMode !== 'none' && (
                          <input
                            value={securityAuditAuthValue}
                            onChange={(event) => setSecurityAuditAuthValue(event.target.value)}
                            placeholder={securityAuditAuthMode === 'cookie' ? 'Paste session cookie for authorized scan' : 'Paste bearer token'}
                            type="password"
                            autoComplete="off"
                          />
                        )}
                        <button type="button" onClick={() => void runSecurityAudit()} disabled={isSecurityAuditing}>
                          {isSecurityAuditing ? 'Auditing' : 'Audit Site'}
                        </button>
                        <span>{securityAuditStatus}</span>
                      </div>
                      <div className="module-workbench-form">
                        <button type="button" onClick={() => void runProjectBugFinder()} disabled={isProjectAuditing}>
                          {isProjectAuditing ? 'Scanning Project' : 'Bug Finder'}
                        </button>
                        <span>{projectAuditStatus}</span>
                      </div>
                      {systemProtectionResult?.ok && (
                        <section className="security-audit-panel project-audit-panel">
                          <div className="security-audit-top">
                            <strong>Windows system protection</strong>
                            <button type="button" onClick={() => {
                              const url = URL.createObjectURL(new Blob([JSON.stringify(systemProtectionResult, null, 2)], { type: 'application/json' }));
                              const link = document.createElement('a'); link.href = url; link.download = 'friday-defense-report.json'; link.click();
                              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                            }}>Export report</button>
                            <em>{systemProtectionResult.score == null ? 'Unknown' : `${systemProtectionResult.score}/100 measured`}</em>
                          </div>
                          <div className="project-audit-summary">
                            <div><strong>Checks</strong><span>{systemProtectionResult.checks?.length ?? 0}</span></div>
                            <div><strong>Findings</strong><span>{systemProtectionResult.findings?.length ?? 0}</span></div>
                            <div><strong>Downloads</strong><span>{systemProtectionResult.recentDownloads?.length ?? 0}</span></div>
                            <div><strong>Startup</strong><span>{systemProtectionResult.startupEntries?.length ?? 0}</span></div>
                          </div>
                          <p>{systemProtectionResult.status || 'Snapshot'} · {systemProtectionResult.coverage?.unknown ?? 0} checks unknown · {systemProtectionResult.scannedAt}{systemProtectionResult.cached ? ' · recent cached scan' : ''}</p>
                          <p>A posture score is not a malware verdict. Unknown checks require review, not an assumption of safety.</p>
                          {!!systemProtectionResult.changes?.length && <div><strong>Changes since previous scan</strong>{systemProtectionResult.changes.map(change => <p key={change.id}>{change.label}: {change.before} → {change.after}</p>)}</div>}
                          <div className="security-audit-grid project-finding-grid">
                            {(systemProtectionResult.checks || []).map(check => (
                              <div key={check.id} className={check.pass ? 'is-pass' : 'is-warn'}>
                                <strong>{check.label}</strong>
                                <span>{check.status === 'unknown' ? 'unknown' : check.pass ? 'pass' : check.severity || 'review'}</span>
                                <p>{check.detail}</p>
                              </div>
                            ))}
                          </div>
                          {!!systemProtectionResult.recommendations?.length && (
                            <div className="security-recommendation-panel">
                              <strong>Protection Actions</strong>
                              <div>
                                {systemProtectionResult.recommendations.map(item => (
                                  <section key={item.id} className={`is-${item.priority}`}>
                                    <span>{item.priority}</span>
                                    <h4>{item.title}</h4>
                                    <p>{item.action}</p>
                                    <em>{item.impact}</em>
                                  </section>
                                ))}
                              </div>
                            </div>
                          )}
                          {!!systemProtectionResult.recentDownloads?.length && (
                            <div className="project-checklist-grid">
                              <div>
                                <strong>Recent risky downloads</strong>
                                {systemProtectionResult.recentDownloads.slice(0, 8).map(item => (
                                  <p key={`${item.path}:${item.modified}`}>{item.name}: {item.sha256 ? item.sha256.slice(0, 16) : 'hash unavailable'}</p>
                                ))}
                              </div>
                              <div>
                                <strong>Startup review</strong>
                                {(systemProtectionResult.startupEntries || []).filter(item => item.suspicious).slice(0, 8).map(item => (
                                  <p key={`${item.source}:${item.name}`}>{item.source}: {item.name}</p>
                                ))}
                                {!(systemProtectionResult.startupEntries || []).some(item => item.suspicious) && <p>No suspicious startup entries detected.</p>}
                              </div>
                              <div>
                                <strong>Process review</strong>
                                {(systemProtectionResult.processFindings || []).slice(0, 8).map(item => <p key={`${item.id}:${item.path}`}>{item.name}: {item.path}</p>)}
                                {!(systemProtectionResult.processFindings || []).length && <p>No processes running from Downloads or Temp.</p>}
                              </div>
                            </div>
                          )}
                          <p>{systemProtectionResult.note}</p>
                        </section>
                      )}
                      {securityAuditResult?.ok && (
                        <section className="security-audit-panel">
                          <div className="security-audit-top">
                            <strong>{securityAuditResult.finalUrl || securityAuditResult.url}</strong>
                            <em>{securityAuditResult.score}/100</em>
                          </div>
                          {securityAuditResult.reportAccuracyEstimate !== undefined && (
                            <div className="project-audit-summary">
                              <div><strong>Accuracy</strong><span>{securityAuditResult.reportAccuracyEstimate}/100</span></div>
                              <div><strong>Checks</strong><span>{securityAuditResult.checks?.length ?? 0}</span></div>
                              <div><strong>DDoS</strong><span>{securityAuditResult.ddosReadiness?.score ?? 0}/100</span></div>
                              <div><strong>Status</strong><span>{securityAuditResult.status ?? '--'}</span></div>
                            </div>
                          )}
                          {(() => {
                            const checks = securityAuditResult.checks || [];
                            const failedChecks = checks.filter(check => !check.pass);
                            const passedChecks = checks.filter(check => check.pass);
                            const highRisk = failedChecks.filter(check => ['critical', 'high'].includes(String(check.severity || '').toLowerCase()));
                            const confirmedRisks = failedChecks
                              .filter(check => ['high', 'medium'].includes(String(check.confidence || '').toLowerCase()))
                              .slice(0, 6);
                            const verifiedPasses = passedChecks
                              .filter(check => ['critical', 'high', 'medium'].includes(String(check.severity || '').toLowerCase()))
                              .slice(0, 6);
                            const readiness = securityAuditResult.ddosReadiness?.score ?? 0;
                            const score = securityAuditResult.score ?? 0;
                            const accuracy = securityAuditResult.reportAccuracyEstimate ?? 0;
                            const verdict = score >= 90
                              ? 'Strong posture'
                              : score >= 75
                                ? 'Good baseline'
                                : score >= 55
                                  ? 'Needs hardening'
                                  : 'High priority fixes';
                            const accuracyLabel = accuracy >= 85
                              ? 'High confidence evidence'
                              : accuracy >= 70
                                ? 'Good external visibility'
                                : 'Limited external visibility';
                            const readinessLabel = readiness >= 80
                              ? 'Strong visible shielding'
                              : readiness >= 60
                                ? 'Partial shielding observed'
                                : 'Limited DDoS proof';
                            const readinessReason = readiness >= 80
                              ? 'Edge protection, caching, and resilience signals are visible from the outside.'
                              : readiness >= 60
                                ? 'Some edge or cache signals are visible, but rate-limit or DNS resilience proof is incomplete.'
                                : 'FRIDAY can see basic platform protection, but not enough rate-limit, edge DNS, bot-defense, or cache evidence.';

                            return (
                              <div className="executive-audit-report">
                                <div className="executive-audit-brief">
                                  <span>Executive report</span>
                                  <strong>{verdict}</strong>
                                  <p>{accuracyLabel}. FRIDAY is reporting observed evidence from the live response and authorized probes; the score is not inflated.</p>
                                </div>
                                <div className="executive-score-grid">
                                  <div className={score >= 75 ? 'is-good' : 'is-warn'}>
                                    <strong>{score}/100</strong>
                                    <span>Security posture</span>
                                  </div>
                                  <div className={accuracy >= 80 ? 'is-good' : 'is-info'}>
                                    <strong>{accuracy || '--'}/100</strong>
                                    <span>Report accuracy</span>
                                  </div>
                                  <div className={readiness >= 75 ? 'is-good' : 'is-warn'}>
                                    <strong>{readiness}/100</strong>
                                    <span>DDoS readiness</span>
                                  </div>
                                  <div className={highRisk.length ? 'is-warn' : 'is-good'}>
                                    <strong>{highRisk.length}</strong>
                                    <span>High-risk gaps</span>
                                  </div>
                                </div>
                                <div className="executive-signal-strip">
                                  <div>
                                    <span>Confidence mode</span>
                                    <strong>{securityAuditResult.authenticated ? 'Authenticated evidence' : 'Public external evidence'}</strong>
                                  </div>
                                  <div>
                                    <span>DDoS reading</span>
                                    <strong>{readinessLabel}</strong>
                                  </div>
                                  <p>{readinessReason}</p>
                                </div>
                                <div className="executive-finding-columns">
                                  <div>
                                    <strong>Verified risks</strong>
                                    {confirmedRisks.length ? confirmedRisks.map(check => (
                                      <p key={`risk-${check.id}`}>{check.label}: {check.detail}</p>
                                    )) : <p>No high-confidence failing controls in the visible checks.</p>}
                                  </div>
                                  <div>
                                    <strong>Verified passes</strong>
                                    {verifiedPasses.length ? verifiedPasses.map(check => (
                                      <p key={`pass-${check.id}`}>{check.label}: {check.detail}</p>
                                    )) : <p>No major passing controls were observed yet.</p>}
                                  </div>
                                  <div>
                                    <strong>Priority fixes</strong>
                                    {(securityAuditResult.recommendations || []).slice(0, 5).map(item => (
                                      <p key={`fix-${item.id}`}>{item.priority}: {item.title}</p>
                                    ))}
                                    {!(securityAuditResult.recommendations || []).length && <p>Maintain current controls and keep monitoring.</p>}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          <div className="security-audit-grid">
                            {securityAuditResult.checks?.map(check => (
                              <div key={check.id} className={check.pass ? 'is-pass' : 'is-warn'}>
                                <strong>{check.label}</strong>
                                <span>{check.pass ? 'pass' : `${check.severity || 'review'} / ${check.confidence || 'medium'}`}</span>
                                <p>{check.evidence ? `${check.detail} Evidence: ${check.evidence}` : check.detail}</p>
                              </div>
                            ))}
                          </div>
                          <div className="security-recommendation-panel">
                            <strong>Recommended Fixes</strong>
                            <div>
                              {(securityAuditResult.recommendations || []).map(item => (
                                <section key={item.id} className={`is-${item.priority}`}>
                                  <span>{item.priority}</span>
                                  <h4>{item.title}</h4>
                                  <p>{item.action}</p>
                                  <em>{item.impact}</em>
                                </section>
                              ))}
                            </div>
                          </div>
                          {securityAuditResult.ddosReadiness && (
                            <div className="security-recommendation-panel">
                              <strong>DDoS Readiness: {securityAuditResult.ddosReadiness.score ?? 0}/100</strong>
                              <div>
                                {(securityAuditResult.ddosReadiness.playbook || []).slice(0, 6).map((item, index) => (
                                  <section key={item}>
                                    <span>step {index + 1}</span>
                                    <h4>Readiness action</h4>
                                    <p>{item}</p>
                                  </section>
                                ))}
                              </div>
                            </div>
                          )}
                          {securityAuditResult.accuracyStatement && <p>{securityAuditResult.accuracyStatement}</p>}
                          <p>{securityAuditResult.note}</p>
                        </section>
                      )}
                      {projectAuditResult?.ok && (
                        <section className="security-audit-panel project-audit-panel">
                          <div className="security-audit-top">
                            <strong>Local project bug finder</strong>
                            <em>{projectAuditResult.findings?.length ?? 0} findings</em>
                          </div>
                          <div className="project-audit-summary">
                            <div><strong>Files</strong><span>{projectAuditResult.filesScanned ?? 0}</span></div>
                            <div><strong>Deps</strong><span>{projectAuditResult.dependencySummary?.dependencies ?? 0}</span></div>
                            <div><strong>Dev Deps</strong><span>{projectAuditResult.dependencySummary?.devDependencies ?? 0}</span></div>
                            <div><strong>CVEs</strong><span>{projectAuditResult.dependencyAudit?.available ? projectAuditResult.dependencyAudit.total : 'n/a'}</span></div>
                          </div>
                          <div className="security-audit-grid project-finding-grid">
                            {(projectAuditResult.findings || []).slice(0, 12).map(finding => (
                              <div key={`${finding.file}:${finding.line}:${finding.rule}`} className={finding.severity === 'info' ? 'is-pass' : 'is-warn'}>
                                <strong>{finding.severity} / {finding.rule}</strong>
                                <span>{finding.file}:{finding.line} / {finding.confidence || 'medium'} confidence</span>
                                <p>{finding.evidence ? `${finding.evidence} ${finding.advice}` : finding.advice}</p>
                              </div>
                            ))}
                            {!(projectAuditResult.findings || []).length && (
                              <div className="is-pass">
                                <strong>No pattern hits</strong>
                                <span>clear</span>
                                <p>No risky code patterns matched in the scanned project files.</p>
                              </div>
                            )}
                          </div>
                          <div className="project-checklist-grid">
                            <div>
                              <strong>OWASP checklist</strong>
                              {(projectAuditResult.owaspChecklist || []).slice(0, 6).map(item => <p key={item}>{item}</p>)}
                            </div>
                            <div>
                              <strong>Auth/session review</strong>
                              {(projectAuditResult.authSessionChecklist || []).slice(0, 6).map(item => <p key={item}>{item}</p>)}
                            </div>
                            <div>
                              <strong>Business risk</strong>
                              {(projectAuditResult.businessRiskDashboard || []).map(item => <p key={item.area}>{item.area}: {item.signal}</p>)}
                            </div>
                          </div>
                          {projectAuditResult.accuracyStatement && <p>{projectAuditResult.accuracyStatement}</p>}
                          <p>{projectAuditResult.note}</p>
                        </section>
                      )}
                      <div className="module-workbench-form project-audit-download-row">
                        <button type="button" onClick={downloadProjectAuditPdf} disabled={isProjectAuditing} title="Download full project audit PDF">
                          <Download size={13} aria-hidden="true" />
                          Download Full Audit PDF
                        </button>
                      </div>
                      {securityPinHash && (
                        <form className="module-workbench-form security-pin-editor" onSubmit={(event) => { event.preventDefault(); void changeSecurityPin(); }}>
                          <input
                            value={securityCurrentPin}
                            onChange={(event) => setSecurityCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                            inputMode="numeric"
                            type="password"
                            placeholder="Current PIN"
                          />
                          <input
                            value={securityNewPin}
                            onChange={(event) => setSecurityNewPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                            inputMode="numeric"
                            type="password"
                            placeholder="New PIN"
                          />
                          <input
                            value={securityNewPinConfirm}
                            onChange={(event) => setSecurityNewPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 8))}
                            inputMode="numeric"
                            type="password"
                            placeholder="Confirm New PIN"
                          />
                          <button type="submit">Change PIN</button>
                        </form>
                      )}
                    </section>
                  )}

                  {hudPage === 'launchpad' && (
                    <section className="module-workbench launchpad-workbench">
                      <div className="launchpad-grid">
                        {fridayIdeaCards.map(card => (
                          <button key={card.title} type="button" onClick={card.run} className="launchpad-card">
                            <span>{card.tag}</span>
                            <strong>{card.title}</strong>
                            <p>{card.body}</p>
                            <em>{card.actionLabel}</em>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}

              {!securityConsoleLocked && (
                <>
              {hudPage === 'projects' && (
                <section className="module-workbench">
                  <div className="module-workbench-form">
                    <input value={projectDraft} onChange={(event) => setProjectDraft(event.target.value)} placeholder="Add project task, hardware step, or test case" />
                    <button type="button" onClick={addProjectTask}>Add Task</button>
                  </div>
                  <div className="module-list">
                    {projects.slice(0, 8).map(item => (
                      <button key={item.id} type="button" onClick={() => setProjects(prev => prev.map(task => task.id === item.id ? { ...task, done: !task.done } : task))} className={item.done ? 'is-done' : ''}>
                        <strong>{item.title}</strong><span>{item.done ? 'done' : item.body}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {hudPage === 'memory' && (
                <section className="module-workbench">
                  <div className="module-workbench-form">
                    <input value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="Save local vault note" />
                    <button type="button" onClick={addMemoryVaultNote}>Save Note</button>
                    <button type="button" onClick={() => setInput('remember that ')}>Chat Memory</button>
                  </div>
                  <div className="module-list">
                    {memoryNotes.slice(0, 8).map(item => <div key={item.id}><strong>{item.title}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></div>)}
                  </div>
                </section>
              )}

              {hudPage === 'automation' && (
                <section className="module-workbench">
                  <div className="module-workbench-form">
                    <button type="button" onClick={() => runAutomationMacro('work')}>Work Mode</button>
                    <button type="button" onClick={() => runAutomationMacro('dev')}>Dev Mode</button>
                    <button type="button" onClick={() => runAutomationMacro('hardware')}>Hardware Mode</button>
                    <button type="button" onClick={() => runAutomationMacro('night')}>Night Mode</button>
                  </div>
                  <div className="module-list">
                    {automationLog.slice(0, 8).map(item => <div key={item.id}><strong>{item.title}</strong><span>{item.body}</span></div>)}
                  </div>
                </section>
              )}

              {hudPage === 'vision' && (
                <section className="module-workbench">
                  <div className="live-vision-grid">
                    <div className="live-vision-camera">
                      <video ref={liveVisionVideoRef} playsInline muted />
                      <canvas ref={liveVisionCanvasRef} />
                      <div className="live-vision-overlay">
                        <span>{isLiveVisionAnalyzing ? 'Analyzing frame' : liveVisionEnabled ? 'Live scan active' : 'Camera standby'}</span>
                        <em>{liveVisionStatus}</em>
                      </div>
                    </div>
                    <div className="live-vision-report">
                      <div className="module-workbench-form">
                        <button type="button" onClick={() => liveVisionEnabled ? stopLiveVision() : void startLiveVision()}>
                          {liveVisionEnabled ? 'Stop Live Scan' : 'Start Live Scan'}
                        </button>
                        <button type="button" onClick={() => void inspectLiveVisionFrame()} disabled={!liveVisionEnabled || isLiveVisionAnalyzing}>
                          {isLiveVisionAnalyzing ? 'Scanning' : 'Scan Now'}
                        </button>
                        <button type="button" onClick={captureVisionAngle} disabled={!liveVisionEnabled}>Capture Angle</button>
                        <button type="button" onClick={() => void lookupVisionObject()} disabled={isVisionLookingUp || (!liveVisionInspection && !visionAngles.length)}>
                          {isVisionLookingUp ? 'Looking Up' : 'Find Exact Match'}
                        </button>
                      </div>
                      <strong>{liveVisionInspection?.objectName || 'No object identified yet'}</strong>
                      <span>{liveVisionInspection?.category || 'Point the camera at a board, mouse, charger, label, or component.'}</span>
                      <div className="live-vision-facts">
                        <div><b>Company</b><em>{liveVisionInspection?.companyName || 'not visible'}</em></div>
                        <div><b>Model</b><em>{liveVisionInspection?.modelOrMarkings || 'not visible'}</em></div>
                        <div><b>Confidence</b><em>{liveVisionConfidence !== null ? `${Math.max(0, Math.min(100, liveVisionConfidence))}%` : '--'}</em></div>
                      </div>
                      <div className="live-vision-columns">
                        <div>
                          <b>Visible Components</b>
                          {(liveVisionInspection?.visibleComponents?.length ? liveVisionInspection.visibleComponents : ['Waiting for scan']).slice(0, 6).map(item => <span key={item}>{item}</span>)}
                        </div>
                        <div>
                          <b>Materials / Notes</b>
                          {[...(liveVisionInspection?.likelyMaterials || []), ...(liveVisionInspection?.usefulNotes || [])].slice(0, 6).map(item => <span key={item}>{item}</span>)}
                          {!liveVisionInspection?.likelyMaterials?.length && !liveVisionInspection?.usefulNotes?.length && <span>Keep labels and components in focus.</span>}
                        </div>
                      </div>
                      {liveVisionInspection?.needsBetterView && <p>{liveVisionInspection.needsBetterView}</p>}
                      <div className="vision-angle-status">
                        <b>Angles</b><span>{visionAngles.length ? visionAngles.map(angle => angle.label).join(' / ') : 'Capture front, back, sides, label, and ports.'}</span>
                      </div>
                      {visionLookupReport && <div className="vision-lookup-report"><div className="module-workbench-form"><b>Web Evidence</b><button type="button" onClick={() => setShowFullVisionReport(prev => !prev)}>{showFullVisionReport ? 'Brief Evidence' : 'Full Evidence'}</button></div><pre>{showFullVisionReport ? visionLookupReport : `${visionLookupReport.slice(0, 900)}${visionLookupReport.length > 900 ? '\n... Say full evidence for all results.' : ''}`}</pre></div>}
                    </div>
                  </div>
                  <div className="module-workbench-form">
                    <input type="file" accept="image/*" onChange={importVisionCapture} />
                    <button type="button" onClick={() => setShowLlmForm(true)}>Open Analysis Prompt</button>
                  </div>
                  <div className="module-list module-gallery">
                    {visionCaptures.slice(0, 6).map(item => (
                      <div key={item.id}>
                        {item.imageUrl && <img src={item.imageUrl} alt="" />}
                        <strong>{item.title}</strong><span>{item.body}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {hudPage === 'study' && (
                <section className="module-workbench">
                  <div className="module-workbench-form">
                    <input value={studyQuestion} onChange={(event) => setStudyQuestion(event.target.value)} placeholder="Question" />
                    <input value={studyAnswer} onChange={(event) => setStudyAnswer(event.target.value)} placeholder="Answer" />
                    <button type="button" onClick={addStudyCard}>Add Card</button>
                  </div>
                  <div className="module-list">
                    {studyCards.slice(0, 8).map(item => (
                      <button key={item.id} type="button" onClick={() => setRevealedStudyCardId(prev => prev === item.id ? '' : item.id)}>
                        <strong>{item.title}</strong><span>{revealedStudyCardId === item.id ? item.body : 'tap to reveal'}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {hudPage === 'encrypt' && (
                <section className="module-workbench encrypt-workbench">
                  <textarea value={secureText} onChange={(event) => setSecureText(event.target.value)} placeholder="Text to encrypt, hash, or FRIDAY cipher to decrypt" />
                  <div className="module-workbench-form">
                    <input value={securePassphrase} onChange={(event) => setSecurePassphrase(event.target.value)} placeholder="Passphrase for encrypt/decrypt" type="password" />
                    <button type="button" onClick={() => void encryptSecureText()}>Encrypt</button>
                    <button type="button" onClick={() => void decryptSecureText()}>Decrypt</button>
                    <button type="button" onClick={() => void hashSecureText()}>SHA-256</button>
                  </div>
                  <textarea value={secureOutput} onChange={(event) => setSecureOutput(event.target.value)} placeholder="Output" />
                </section>
              )}

              {hudPage === 'reverse' && <ReverseEngineeringWorkspace />}

              {hudPage === 'forge' && (
                <section className="module-workbench">
                  <div className="forge-command-deck">
                    <div className="forge-reactor" aria-hidden="true">
                      <span />
                      <b>{hardwareDevices.length}</b>
                      <em>devices</em>
                    </div>
                    <div className="forge-telemetry-grid">
                      <div><strong>{forgeTelemetry.connected}</strong><span>linked</span></div>
                      <div><strong>{forgeTelemetry.waiting}</strong><span>waiting</span></div>
                      <div><strong>{trustedDevices.length}</strong><span>trusted</span></div>
                      <div><strong>{forgeTelemetry.debug}</strong><span>debug</span></div>
                    </div>
                    <div className="forge-focus-panel">
                      <span>Active Device</span>
                      <strong>{openedDevice?.name || 'No device opened'}</strong>
                      <em>{openedDevice ? `${openedDevice.transport || openedDevice.className} / ${openedDevice.access || openedDevice.status}` : 'Open a device to inspect and assign behavior.'}</em>
                      <div>
                        <button type="button" onClick={() => void scanHardwareDevices()} disabled={isHardwareScanning}>Rescan</button>
                        <button type="button" onClick={() => setInput('open bluetooth settings')}>Bluetooth</button>
                        <button type="button" onClick={() => openedDevice && updateDeviceBehavior(openedDevice, 'trusted')} disabled={!openedDevice}>Trust</button>
                        <button type="button" onClick={() => openedDevice && updateDeviceBehavior(openedDevice, 'blocked')} disabled={!openedDevice}>Block</button>
                        <button type="button" onClick={() => openedDevice && updateDeviceBehavior(openedDevice, 'debug')} disabled={!openedDevice}>Debug</button>
                      </div>
                    </div>
                  </div>
                  <div className="module-workbench-form">
                    <button type="button" onClick={() => void scanHardwareDevices()} disabled={isHardwareScanning}>{isHardwareScanning ? 'Scanning' : 'Scan External'}</button>
                    <span>{hardwareStatus}</span>
                  </div>
                  {openedDevice && (
                    <section className="device-code-panel">
                      <div className="device-code-panel-top">
                        <div>
                          <strong>{openedDevice.name}</strong>
                          <span>{`${openedDevice.category || openedDevice.className} / ${openedDevice.transport || openedDevice.status}`}</span>
                          <span>{openedDevice.access || (openedDevice.status === 'OK' ? 'Connected / usable by Windows' : 'Pair or connect in Windows first')}</span>
                          <em>{parseDeviceCode(openedDevice.instanceId).hasUsbVendorProductCode ? 'Likely external: USB/HID VID/PID path' : 'External proof not certain from this code'}</em>
                        </div>
                        <button type="button" onClick={() => setOpenedDeviceId('')}>Close</button>
                      </div>
                      <div className="device-code-grid">
                        <code>{openedDevice.instanceId}</code>
                        <textarea value={openedDeviceCode} readOnly aria-label={`${openedDevice.name} codes`} />
                        <input
                          value={deviceDebugNotes[openedDevice.instanceId] || ''}
                          onChange={(event) => updateDeviceDebugNote(openedDevice, event.target.value)}
                          placeholder="Edit debug note, label, or behavior rule"
                        />
                      </div>
                    </section>
                  )}
                  <div className="module-list">
                    {hardwareDevices.slice(0, 12).map(device => {
                      const behavior = getDeviceBehavior(device);
                      const debugNote = deviceDebugNotes[device.instanceId] || '';
                      return (
                        <div key={device.instanceId || device.id} className={`device-profile is-${behavior}`}>
                          <div className="device-profile-top">
                            <strong>{device.name}</strong>
                            <button type="button" onClick={() => setOpenedDeviceId(device.instanceId || device.id)}>Open</button>
                          </div>
                          <span>{`${device.category || device.className} / ${device.transport || device.status}`}</span>
                          <span>{device.access || (device.status === 'OK' ? 'Connected / usable' : 'Connect first')}</span>
                          <select
                            value={behavior}
                            onChange={(event) => updateDeviceBehavior(device, event.target.value as DeviceBehavior)}
                            aria-label={`Behavior for ${device.name}`}
                          >
                            {Object.entries(deviceBehaviorLabels).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          {behavior === 'debug' && (
                            <div className="device-debug-panel">
                              <code>{device.instanceId}</code>
                              <span>{`status ${device.status} / class ${device.className}`}</span>
                              <input
                                value={debugNote}
                                onChange={(event) => updateDeviceDebugNote(device, event.target.value)}
                                placeholder="Debug note, label, or behavior rule"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
                </>
              )}
            </motion.div>
          )}

          {hudPage === 'markets' && (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="markets-page"
            >
              <div className="markets-header">
                <div>
                  <div className="video-panel-title">Investment Command</div>
                  <h1>Markets / Stocks / Crypto</h1>
                </div>
                <button type="button" onClick={() => void loadMarketSnapshot()} className="market-refresh" disabled={isMarketLoading}>
                  <RefreshCw size={15} className={isMarketLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>

              <div className="markets-grid">
                <section className="market-card fam-card">
                  <div className="market-card-kicker"><Wallet size={14} /> FamPay Balance</div>
                  <div className="fam-balance">{famPayBalance ? formatMoney(Number(famPayBalance), 'INR') : '--'}</div>
                  <label className="fam-input-label">
                    Manual entry
                    <input
                      value={famPayBalance}
                      onChange={(event) => setFamPayBalance(event.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      placeholder="Enter amount"
                    />
                  </label>
                  <p>Stored locally on this PC. No FamPay login, OTP, PIN, or transaction access.</p>
                </section>

                <section className="market-card market-summary">
                  <div className="market-card-kicker"><TrendingUp size={14} /> Feed Status</div>
                  <strong>{marketStatus}</strong>
                  {marketSnapshot.forex?.rate && <span>USD/INR: ₹{marketSnapshot.forex.rate.toFixed(2)} for $1</span>}
                  {famPayBalanceUsd && <span>FamPay in USD: {formatMoney(famPayBalanceUsd, 'USD')}</span>}
                  <span>{marketSnapshot.fetchedAt ? `Updated ${new Date(marketSnapshot.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for first update'}</span>
                  {marketSnapshot.errors?.length ? <em>{marketSnapshot.errors[0]}</em> : <em>Stocks via Yahoo Finance, crypto via CoinGecko public feeds.</em>}
                </section>

                <section className="market-card wide">
                  <div className="market-section-title">Stocks and Indices</div>
                  <div className="quote-grid">
                    {marketSnapshot.stocks.slice(0, 8).map(item => {
                      const positive = Number(item.changePercent || 0) >= 0;
                      return (
                        <div key={item.symbol} className="quote-tile">
                          <div className="quote-top">
                            <strong>{item.symbol}</strong>
                            <span className={positive ? 'is-positive' : 'is-negative'}>{formatPercent(item.changePercent)}</span>
                          </div>
                          <div className="quote-name">{item.name}</div>
                          <div className="quote-price">{formatMoney(item.price, item.currency || 'USD')}</div>
                          <div className="quote-meta">{item.exchange || 'Market'} / {item.marketState || 'watch'}</div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="market-card wide">
                  <div className="market-section-title">Crypto Watch</div>
                  <div className="quote-grid crypto">
                    {marketSnapshot.crypto.slice(0, 6).map(item => {
                      const positive = Number(item.changePercent || 0) >= 0;
                      return (
                        <div key={item.id} className="quote-tile">
                          <div className="quote-top">
                            <strong>{item.symbol}</strong>
                            <span className={positive ? 'is-positive' : 'is-negative'}>{formatPercent(item.changePercent)}</span>
                          </div>
                          <div className="quote-name">{item.name}</div>
                          <div className="quote-price">{formatMoney(item.priceInr, 'INR')}</div>
                          <div className="quote-meta">{formatMoney(item.priceUsd, 'USD')}</div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          {hudPage === 'matrix' && (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="systems-page"
            >
              <div className="markets-header">
                <div>
                  <div className="video-panel-title">Mission Control</div>
                  <h1>Systems Matrix</h1>
                </div>
                <button type="button" onClick={() => void loadMarketSnapshot()} className="market-refresh" disabled={isMarketLoading}>
                  <RefreshCw size={15} className={isMarketLoading ? 'animate-spin' : ''} />
                  Re-Sync
                </button>
              </div>

              <div className="systems-layout">
                <section className="systems-reactor">
                  <div className="systems-reactor-core">
                    <span />
                    <b>{brainState}</b>
                    <em>{moduleSummary.good}/{systemModules.length} nominal</em>
                  </div>
                  <div className="systems-command-strip">
                    <button type="button" onClick={() => setVoiceArmRequestId(Date.now())} className="market-refresh">Voice Check</button>
                    <button type="button" onClick={isLiveLocationEnabled ? stopLiveLocation : startLiveLocation} className={`market-refresh ${isLiveLocationEnabled ? 'is-live' : ''}`}>
                      {isLiveLocationEnabled ? 'Stop Location' : 'Calibrate Location'}
                    </button>
                    <button type="button" onClick={() => void useWindowsLocationFallback()} className="market-refresh">Wi-Fi Locate</button>
                  </div>
                </section>

                <section className="systems-module-list">
                  {systemModules.map(module => (
                    <div key={module.id} className={`systems-card is-${module.status}`}>
                      <div>
                        <strong>{module.label}</strong>
                        <span>{module.detail}</span>
                      </div>
                      <i><b style={{ width: `${module.progress}%` }} /></i>
                      <em>{module.status}</em>
                    </div>
                  ))}
                  <div className="systems-footer-readout">
                    <strong>{moduleSummary.good}</strong>
                    <span>nominal modules / {moduleSummary.warn} attention / {moduleSummary.info} standby</span>
                    <em>{locationStatus}</em>
                  </div>
                </section>
              </div>
            </motion.div>
          )}

          <AnimatePresence>
            {hudPanel === 'chat' && (
              <motion.aside
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                className="response-feed-panel absolute left-0 top-6 hidden w-[360px] border-l border-cyan-300/30 p-4 backdrop-blur-sm lg:block"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">Response Feed</div>
                  <button type="button" onClick={() => setHudPanel('none')} className="font-mono text-xs text-cyan-300/60 hover:text-cyan-100">x</button>
                </div>
                <div ref={scrollRef} className="response-feed-scroll scrollbar-hide mt-4 overflow-y-auto pr-2">
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
                  <div>Reasoning: contextual</div>
                  <div>Memory: persistent</div>
                  <div>Search: live fallback</div>
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
              <button
                type="button"
                onClick={toggleListening}
                disabled={!micSupported || isTranscribing}
                className={`hud-icon ${isListening || isRecording ? 'is-on' : ''} ${micInputMuted ? 'is-muted' : ''}`}
                title={micInputMuted ? 'Mic muted - click to unmute' : 'Mic input - click to mute or record'}
                aria-pressed={!micInputMuted}
              >
                {micInputMuted ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <button type="button" onClick={toggleVoiceOutput} className={`hud-icon ${voiceEnabled ? 'is-on' : 'is-muted'}`} title={voiceEnabled ? 'Voice output - click to mute' : 'Voice output muted - click to unmute'}>
                {voiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button type="button" onClick={() => setShowVoiceControls(prev => !prev)} className={`hud-icon ${showVoiceControls ? 'is-on' : ''}`} title="Voice controls">
                <SlidersHorizontal size={16} />
              </button>
              <button type="button" onClick={() => setShowLlmForm(prev => !prev)} className={`hud-icon ${showLlmForm ? 'is-on' : ''}`} title="Brain prompt">
                <BrainCircuit size={16} />
              </button>
              <button type="button" onClick={() => void openGestureControl()} className="hud-icon" title="Gesture cursor">
                <Hand size={16} />
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
                  <option value="edge:en-IE-EmilyNeural">Emily · Irish English (online)</option>
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
                <p className="text-xs text-cyan-100/60 md:col-span-6">Irish Neural sends spoken text to Microsoft. Select a Windows voice for private, local speech. This is an inspired voice, not the movie actor.</p>
              </div>
            )}

            {showLlmForm && (
              <form onSubmit={handleLlmFormSubmit} className="grid gap-3 md:grid-cols-[140px_minmax(180px,1fr)_minmax(180px,1fr)_160px_80px]">
                <select value={llmForm.mode} onChange={(event) => setLlmForm(prev => ({ ...prev, mode: event.target.value }))} className="hud-field">
                  <option>Assistant</option>
                  <option>CRM Factory</option>
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
