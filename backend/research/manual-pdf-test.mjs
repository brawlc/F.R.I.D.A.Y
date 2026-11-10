// Explicit manual test only: synthetic public content, no model or experiment calls.
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCommunicationsHub, createDeliveryStore, readConfig } from '../communications/hub.mjs';
import { createReportStore } from './report-store.mjs';
import { createResearchReports } from './report-service.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
dotenv.config({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const config = readConfig();
config.telegram.enabled = false;
const hub = createCommunicationsHub({ config, maxAttempts: 1, store: createDeliveryStore(fileURLToPath(new URL('../../.friday-communications/manual-tests.json', import.meta.url))) });
const store = createReportStore({ workspace: root, directory: process.env.FRIDAY_REPORTS_DIR || fileURLToPath(new URL('../../.friday-reports', import.meta.url)) });
const reports = createResearchReports({ store, hub });
const record = {
  id: randomUUID(), objective: 'FRIDAY PDF delivery trial - synthetic demonstration',
  createdAt: new Date().toISOString(), status: 'insufficient-evidence',
  conditions: 'Harmless public delivery test. No real research, model calls or simulations performed.',
  questions: [{ question: 'Can the report be downloaded and opened without a password?', verification: 'The recipient opens the attachment on their phone.' }],
  findings: [], hypotheses: [], contradictions: [], sources: [], experiments: [],
  uncertainties: ['This test makes no scientific claims. Phone delivery is not confirmed by server acceptance.'],
  usage: { modelCalls: 0, httpAttempts: 0 },
};
const result = await reports.completed(record);
console.log(JSON.stringify({ researchId: record.id, status: result.status, error: result.error || null, attempts: result.attempts ?? 0, receiptMeaning: 'sent means ntfy accepted the notification; phone receipt must be checked separately' }));
if (result.status !== 'sent') process.exitCode = 1;
