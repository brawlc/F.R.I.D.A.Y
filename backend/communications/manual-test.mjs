import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCommunicationsHub, createDeliveryStore, readConfig } from './hub.mjs';

dotenv.config({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const config = readConfig();
// This command can only send one ntfy test; never Telegram or automatic retries.
config.telegram.enabled = false;
const briefing = process.argv.includes('--briefing');
const manualStore = createDeliveryStore(fileURLToPath(new URL('../../.friday-communications/manual-tests.json', import.meta.url)));
const liveStore = createDeliveryStore(fileURLToPath(new URL('../../.friday-communications/deliveries.json', import.meta.url)));
let manualHistory = [];
const hub = createCommunicationsHub({ config, maxAttempts: 1,
  store: briefing ? {
    async load() { manualHistory = await manualStore.load(); return [...await liveStore.load(), ...manualHistory]; },
    async save(rows) { await manualStore.save([...manualHistory, rows.at(-1)].slice(-1000)); },
  } : manualStore,
});
const result = await hub.notify({ type: briefing ? 'daily_briefing' : 'notification_test', manualTest: briefing, id: randomUUID(), priority: 'normal' });
console.log(JSON.stringify({ ...result, receiptMeaning: 'sent means ntfy accepted the notification; iPhone display is not verified' }, null, 2));
if (result.status !== 'sent') process.exitCode = 1;
