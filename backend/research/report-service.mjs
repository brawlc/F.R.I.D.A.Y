import { generateResearchPdf, createReportAttachment, reportAttachment } from './pdf.mjs';
export function createResearchReports({ store, hub, env = process.env }) {
  const pending = new Map();
  const run = (id, fn) => { if (pending.has(id)) return pending.get(id); const task = fn().finally(() => pending.delete(id)); pending.set(id, task); return task; };
  return {
    status: id => store.status(id),
    async export(record) {
      // Local download is private behind the research API guard; it never triggers an upload.
      const bytes = await generateResearchPdf(record, { env });
      await store.save(record.id, bytes, { encrypted: false, delivery: 'local_export' });
      return bytes;
    },
    completed(record) { return run(record.id, async () => {
      if (!['completed-with-limitations', 'insufficient-evidence'].includes(record.status)) return { status: 'skipped' };
      try {
        if (env.FRIDAY_REPORT_NTFY_ENABLED !== 'true') {
          const bytes = await generateResearchPdf(record, { env });
          await store.save(record.id, bytes, { encrypted: false, delivery: 'disabled' });
          await hub.notify({ type: 'research_completed', id: record.id, priority: 'normal' });
          return { status: 'local_only', reason: 'disabled' };
        }
        const attachment = await createReportAttachment(record, { env });
        await store.save(record.id, reportAttachment(attachment).bytes, { encrypted: false, delivery: 'pending' });
        const delivery = await hub.notify({ type: 'research_completed', id: record.id, attachment, priority: 'normal' });
        await store.recordStatus(record.id, { status: 'ready', encrypted: false, delivery: delivery.status, error: delivery.error || null });
        return delivery;
      } catch {
        await store.recordStatus(record.id, { status: 'failed', error: 'pdf_generation_or_delivery_failed' }).catch(() => {});
        return { status: 'failed', error: 'pdf_generation_or_delivery_failed' };
      }
    }); },
  };
}
