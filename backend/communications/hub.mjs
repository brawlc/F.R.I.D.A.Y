import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isPublicBriefing } from '../briefing/public-report.mjs';
import { reportAttachment, MAX_PDF_BYTES } from '../research/pdf.mjs';

export const ROUTES = Object.freeze({
  notification_test: 'ntfy', daily_briefing: 'ntfy', f1_update: 'ntfy', spacex_update: 'ntfy', aerospace_research: 'ntfy', robotics_research: 'ntfy', ai_update: 'ntfy', software_update: 'ntfy', project_progress: 'ntfy', research_completed: 'ntfy', research_discovery: 'ntfy', task_completed: 'ntfy', reminder: 'ntfy', general_notification: 'ntfy', worker_disconnected: 'ntfy', automation_failure: 'ntfy', pending_approval: 'ntfy', service_recovery: 'ntfy',
  suspicious_activity: 'ntfy', malware_detection: 'ntfy', ransomware_detection: 'ntfy', unauthorized_login: 'ntfy', unusual_network_activity: 'ntfy', critical_security_incident: 'ntfy', security_recovery_report: 'ntfy', sentinel_report: 'ntfy',
});
export const SECURITY_TYPES = new Set(['suspicious_activity','malware_detection','ransomware_detection','unauthorized_login','unusual_network_activity','critical_security_incident','security_recovery_report','sentinel_report']);
const labels = Object.fromEntries(Object.keys(ROUTES).map(k => [k, k.replaceAll('_', ' ')]));
const behaviors = {
  posture_check: 'A read-only security posture check requires review. This is not proof of malware.',
  project_audit: 'A project security audit reported findings requiring review.',
  suspicious_activity: 'The detector reported suspicious activity requiring review.',
  malware_detection: 'The detector reported malware detection.', ransomware_detection: 'The detector reported ransomware detection.',
  unauthorized_login: 'The detector reported an unauthorized login attempt.', unusual_network_activity: 'The detector reported unusual network activity.',
  critical_security_incident: 'The detector reported a critical security incident.', security_recovery_report: 'The detector supplied a recovery status report.',
  sentinel_report: 'A SENTINEL security report is available locally.',
};
export function readConfig(env = process.env) {
  return {
    ntfy: { enabled: env.FRIDAY_NTFY_ENABLED === 'true', url: env.FRIDAY_NTFY_SERVER || env.FRIDAY_NTFY_URL || 'https://ntfy.sh', topic: env.FRIDAY_NTFY_TOPIC || '', token: env.FRIDAY_NTFY_TOKEN || '', securityTopic: env.FRIDAY_NTFY_SECURITY_TOPIC || '', accessControlled: env.FRIDAY_NTFY_ACL_VERIFIED === 'true' },
    telegram: { enabled: env.FRIDAY_TELEGRAM_ENABLED === 'true', token: env.FRIDAY_TELEGRAM_BOT_TOKEN || '', chatId: env.FRIDAY_TELEGRAM_CHAT_ID || '' },
    dailyEnabled: env.FRIDAY_DAILY_BRIEFING_ENABLED === 'true', device: env.FRIDAY_NOTIFICATION_DEVICE || 'FRIDAY device',
  };
}
export function createDeliveryStore(path) {
  let queue = Promise.resolve();
  return {
    async load() { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } },
    save(rows) {
      const json = JSON.stringify(rows);
      const task = queue.catch(() => {}).then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, json, { mode: 0o600 }); await rename(`${path}.tmp`, path);
      }); queue = task; return task;
    },
  };
}
const hash = s => createHash('sha256').update(s).digest('hex');
export function createCommunicationsHub({ config = readConfig(), fetchImpl = fetch, store, now = Date.now, sleep = ms => delay(ms), timeoutMs = 5000, maxAttempts = 3 } = {}) {
  const attemptLimit = Number.isInteger(maxAttempts) ? Math.max(1, Math.min(3, maxAttempts)) : 3;
  let records = [], storageError = false;
  const pending = new Map();
  const ready = (async () => {
    if (!store) return;
    try { const saved = await store.load(); if (!Array.isArray(saved)) throw Error(); records = saved.slice(-1000); }
    catch { storageError = true; }
  })();
  const redact = value => {
    let s = String(value || '').replace(/[\r\n]/g, ' ');
    for (const secret of [config.ntfy.token, config.telegram.token, config.telegram.chatId]) if (secret) s = s.replaceAll(secret, '[redacted]');
    return s.replace(/(?:password|token|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, '[redacted]').replace(/\b(?:sk-|ghp_)[\w-]+/g, '[redacted]').slice(0, 120);
  };
  async function record(row) {
    records.push(row); records = records.slice(-1000);
    if (store && !storageError) try { await store.save(records); } catch { storageError = true; }
    return row;
  }
  function validConfig(channel) {
    const c = config[channel];
    if (!c.enabled) return 'disabled';
    if (channel === 'telegram') return /^\d+:[\w-]+$/.test(c.token) && /^[1-9]\d*$/.test(c.chatId) ? null : 'missing_or_invalid_credentials';
    try { const u = new URL(c.url); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') return 'invalid_configuration'; } catch { return 'invalid_configuration'; }
    if (!c.token || c.accessControlled !== true) return 'authenticated_topic_acl_required';
    return /^[\w-]{1,100}$/.test(c.topic) ? null : 'missing_or_invalid_credentials';
  }
  async function request(url, body, headers = {}) {
    try {
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.ok === false) {
        const status = json?.error_code || response.status;
        const retryAfter = Number(json?.parameters?.retry_after || response.headers.get('retry-after') || 0);
        return { ok: false, error: `provider_${status}`, retry: status === 429 || status >= 500, retryAfter };
      }
      return { ok: true, json };
    } catch { return { ok: false, error: 'network_or_timeout', retry: false, retryAfter: 0 }; }
  }
  function message(event, channel) {
    if (channel === 'ntfy') {
      if (SECURITY_TYPES.has(event.type)) return `FRIDAY security alert (${event.severity}). Open the private command center to review. Containment is not confirmed by this notification.`;
      if (event.type === 'notification_test') return 'PROJECT FRIDAY notification test. This is a harmless test of your general notifications. No action is needed.';
      if (event.type === 'daily_briefing') {
        if (isPublicBriefing(event.publicBriefing)) return event.publicBriefing.text;
        const counts = Object.keys(ROUTES).filter(t => ROUTES[t] === 'ntfy' && t !== 'daily_briefing').map(type => {
          const count = records.filter(r => r.type === type && r.status === 'sent' && now() - Date.parse(r.at) < 86400000).length;
          return `${labels[type]}: ${count}`;
        });
        const date = new Date(now()).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
        return `${event.manualTest === true ? 'Manual test' : '09:15 IST'} daily activity briefing — ${date} (last 24 hours).\n${counts.join('\n')}\nCounts reflect delivered updates, not new external news research. Open FRIDAY for available local reports.`;
      }
      // Public topics only ever receive fixed category text, never caller content.
      return `FRIDAY ${labels[event.type]}. Open FRIDAY for details.`;
    }
    const confirmed = event.containment?.confirmed === true && Number.isFinite(Date.parse(event.containment?.confirmedAt)) && typeof event.containment?.evidenceId === 'string' && event.containment.evidenceId.trim();
    const status = confirmed && ['contained', 'recovered'].includes(event.containment?.status)
      ? `${event.containment.status} (confirmed by the local detector at ${new Date(event.containment.confirmedAt).toISOString()})`
      : event.containment?.status === 'not_performed' ? 'Not performed; monitoring is read-only.' : 'Unknown / unconfirmed. No successful containment is claimed.';
    return ['SENTINEL security notification', `Threat severity: ${event.severity}`, `Detection timestamp: ${event.detectedAt || 'Unknown (not supplied by detector)'}`, `Affected device: ${redact(config.device)}`,
      `Observed behavior: ${behaviors[event.behaviorCode] || behaviors[event.type] || behaviors.suspicious_activity}`, `Actual containment status: ${status}`,
      'Recommended next action: Review the local security report and verify the finding. Use the existing approval workflow before any containment or recovery action.'].join('\n');
  }
  async function deliver(event, channel, key) {
    if (event.attachment) return deliverPdf(event, channel, key);
    const deliveryLimit = isPublicBriefing(event.publicBriefing) ? 1 : attemptLimit;
    const row = { key, type: event.type, channel, severity: event.severity, at: new Date(now()).toISOString(), attempts: 0, status: 'pending' };
    const unavailable = validConfig(channel) || (SECURITY_TYPES.has(event.type) && (!/^[\w-]{1,100}$/.test(config.ntfy.securityTopic || '') || config.ntfy.securityTopic === config.ntfy.topic) ? 'separate_security_topic_required' : null);
    if (unavailable || storageError) return record({ ...row, status: unavailable === 'disabled' ? 'disabled' : 'failed', error: unavailable || 'delivery_store_unavailable' });
    const topic = SECURITY_TYPES.has(event.type) ? config.ntfy.securityTopic : config.ntfy.topic;
    await record({ ...row });
    if (storageError) return { ...row, status: 'failed', error: 'delivery_store_unavailable' };
    const text = message(event, channel);
    let failure;
    for (let attempt = 1; attempt <= deliveryLimit; attempt++) {
      row.attempts = attempt;
      if (channel === 'telegram') {
        const base = `https://api.telegram.org/bot${config.telegram.token}`;
        const verified = await request(`${base}/getChat`, { chat_id: config.telegram.chatId });
        if (!verified.ok) failure = verified;
        else if (verified.json?.result?.type !== 'private' || String(verified.json.result.id) !== config.telegram.chatId) failure = { error: 'unauthorized_chat', retry: false };
        else {
          const response = await request(`${base}/sendMessage`, { chat_id: config.telegram.chatId, text, disable_notification: false, protect_content: true });
          if (response.ok && response.json?.ok === true && response.json?.result?.message_id && String(response.json.result.chat?.id) === config.telegram.chatId) return record({ ...row, status: 'sent' });
          failure = response.ok ? { error: 'invalid_provider_acknowledgement', retry: false } : response;
        }
      } else {
        const response = await request(`${config.ntfy.url.replace(/\/$/, '')}/`, { topic, title: 'FRIDAY', message: text, priority: SECURITY_TYPES.has(event.type) ? (event.severity === 'critical' ? 5 : event.severity === 'high' ? 4 : 3) : event.priority === 'low' ? 2 : 3 }, config.ntfy.token ? { Authorization: `Bearer ${config.ntfy.token}` } : {});
        if (response.ok && response.json?.id && response.json?.topic === topic) return record({ ...row, status: 'sent', providerMessageId: String(response.json.id).slice(0, 100) });
        failure = response.ok ? { error: 'invalid_provider_acknowledgement', retry: false } : response;
      }
      if (!failure.retry || attempt === deliveryLimit || !Number.isFinite(failure.retryAfter) || failure.retryAfter > 5) break;
      await sleep(Math.max(attempt * 250, (failure.retryAfter || 0) * 1000));
    }
    return record({ ...row, status: ['network_or_timeout','invalid_provider_acknowledgement'].includes(failure.error) ? 'delivery_unknown_no_resend' : 'failed', error: failure.error });
  }
  async function deliverPdf(event, channel, key) {
    const pdf = reportAttachment(event.attachment);
    const row = { key, type: event.type, channel, at: new Date(now()).toISOString(), attempts: 0, status: 'pending', attachment: true };
    if (channel !== 'ntfy' || event.type !== 'research_completed' || !pdf || pdf.bytes.length > MAX_PDF_BYTES) return record({ ...row, status: 'rejected', error: 'untrusted_attachment' });
    const unavailable = validConfig(channel);
    if (unavailable || storageError) return record({ ...row, status: unavailable === 'disabled' ? 'disabled' : 'failed', error: unavailable || 'delivery_store_unavailable' });
    // Persist before network work. An uncertain upload or notification is never automatically replayed.
    await record(row);
    if (storageError) return { ...row, status: 'failed', error: 'delivery_store_unavailable' };
    try {
      const origin = new URL(config.ntfy.url).origin;
      const auth = config.ntfy.token ? { Authorization: `Bearer ${config.ntfy.token}` } : {};
      // A staging topic stores the PDF without notifying subscribers to the everyday topic.
      // Then one final message supplies both the native attachment and its phone-accessible click URL.
      const uploadTopic = `friday-files-${hash(event.id).slice(0, 24)}`;
      row.attempts = 1;
      const uploaded = await fetchImpl(`${origin}/${uploadTopic}`, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { ...auth, 'Content-Type': 'application/pdf', Filename: pdf.filename, 'X-Firebase': 'no', 'X-Cache': 'no', Title: 'Research report' }, body: pdf.bytes });
      const result = await uploaded.json().catch(() => null);
      if (!uploaded.ok) return record({ ...row, status: 'failed', error: `attachment_provider_${uploaded.status}` });
      const attachment = result?.attachment;
      const url = new URL(attachment?.url);
      if (!result?.id || result.topic !== uploadTopic || url.origin !== origin || !/^\/file\/[a-zA-Z0-9._-]+$/.test(url.pathname) || url.search || url.hash || url.username || url.password || attachment.size !== pdf.bytes.length || attachment.type !== 'application/pdf' || !Number.isFinite(attachment.expires) || attachment.expires * 1000 <= now()) throw Error('Invalid acknowledgement');
      row.attempts = 2;
      const delivered = await request(`${origin}/`, { topic: config.ntfy.topic, title: 'FRIDAY research PDF', message: 'Your research report is ready. Tap to open the PDF. Download before the attachment expires.', priority: 3, attach: url.href, filename: pdf.filename, click: url.href, actions: [{ action: 'view', label: 'Open PDF', url: url.href }] }, auth);
      if (delivered.ok && delivered.json?.id && delivered.json.topic === config.ntfy.topic) return record({ ...row, status: 'sent', providerMessageId: String(delivered.json.id).slice(0, 100), attachmentExpiresAt: new Date(attachment.expires * 1000).toISOString() });
      return record({ ...row, status: 'delivery_unknown_no_resend', error: delivered.error || 'invalid_provider_acknowledgement' });
    } catch { return record({ ...row, status: 'delivery_unknown_no_resend', error: 'attachment_upload_or_acknowledgement_failed' }); }
  }
  return {
    async notify(input) {
      await ready;
      if (!Object.hasOwn(ROUTES, input?.type)) return { status: 'rejected', error: 'unknown_event_type', attempts: 0 };
      const channel = ROUTES[input.type];
      const event = { ...input, severity: ['low', 'medium', 'high', 'critical'].includes(input.severity) ? input.severity : input.type === 'critical_security_incident' ? 'critical' : 'medium', detectedAt: Number.isFinite(Date.parse(input.detectedAt)) ? new Date(input.detectedAt).toISOString() : null };
      const key = hash(JSON.stringify([channel, input.type, input.id || '', event.severity, input.behaviorCode || '', input.containment || null, ...(input.attachment ? ['research-pdf'] : [])]));
      if (pending.has(key)) return pending.get(key);
      {
        const previous = [...records].reverse().find(r => r.key === key);
        if (previous && ['pending', 'sent', 'delivery_unknown_no_resend'].includes(previous.status)) return { key, channel, status: previous.status === 'sent' ? 'deduplicated' : 'delivery_unknown_no_resend', attempts: 0 };
      }
      if (records.some(r => r.key === key && r.status === 'sent' && now() - Date.parse(r.at) < 86400000)) return { key, channel, status: 'deduplicated', attempts: 0 };
      const task = deliver(event, channel, key).finally(() => pending.delete(key)); pending.set(key, task); return task;
    },
    async status() { await ready; return { channels: { ntfy: { enabled: config.ntfy.enabled, problem: validConfig('ntfy') }, telegram: { enabled: false, problem: 'friday_delivery_disabled', outboundOnly: true } }, storageError, deliveries: records.slice(-100) }; },
  };
}
