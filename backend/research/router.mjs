import express from 'express';
import { renderReport } from './report.mjs';
import { isResearchRequest } from '../../shared/conversation-intent.mjs';

export function createResearchRouter(engine, reports) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handle = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'Research operation failed. Existing memory was preserved.' }); } };
  router.get('/', handle(async (_req, res) => res.json({ ok: true, research: await engine.memory.list() })));
  router.post('/', handle(async (req, res) => { const research = await engine.run(req.body); res.json({ ok: true, research, text: renderReport(research) }); }));
  router.get('/:id/pdf-status', handle(async (req, res) => {
    if (!reports || !/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ ok: false, error: 'PDF export unavailable or invalid research ID' });
    if (!await engine.memory.get(req.params.id)) return res.status(404).json({ ok: false, error: 'Research not found' });
    res.json({ ok: true, report: await reports.status(req.params.id) });
  }));
  router.get('/:id/pdf', handle(async (req, res) => {
    if (!reports || !/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ ok: false, error: 'PDF export unavailable or invalid research ID' });
    const research = await engine.memory.get(req.params.id);
    if (!research) return res.status(404).json({ ok: false, error: 'Research not found' });
    const bytes = await reports.export(research);
    res.set('Content-Disposition', `attachment; filename="research-${research.id}.pdf"`);
    res.set('X-Content-Type-Options', 'nosniff'); res.type('application/pdf').send(bytes);
  }));
  router.get('/:id', handle(async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.id)) return res.status(400).json({ ok: false, error: 'Invalid research ID' });
    const research = await engine.memory.get(req.params.id);
    if (!research) return res.status(404).json({ ok: false, error: 'Research not found' });
    if (req.query.format === 'markdown') return res.type('text/markdown').send(renderReport(research));
    res.json({ ok: true, research, text: renderReport(research) });
  }));
  return router;
}

export function researchChat(engine, localGuard) {
  return (req, res, next) => {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const latest = [...messages].reverse().find(m => m?.role === 'user');
    const text = String(latest?.content || '').trim();
    const prefix = /^(?:friday[, :]+)?(?:investigate|research brief(?: on)?|deep research|research)\s+([\s\S]+)/i.exec(text);
    const index = messages.lastIndexOf(latest);
    const previous = messages.slice(0, index).reverse().find(m => m?.role === 'assistant');
    const pending = /Research clarification ID: ([a-f0-9-]{36})/.exec(previous?.content || '');
    const history = /^(?:friday[, :]+)?research history\s*$/i.test(text);
    const recall = /^(?:friday[, :]+)?research report ([a-f0-9-]{36})\s*$/i.exec(text);
    const researchRequest = isResearchRequest(text);
    if (!researchRequest && !pending && !history && !recall) return next();
    return localGuard(req, res, async () => {
      try {
        if (history) return res.json({ ok: true, text: (await engine.memory.list()).map(r => `${r.id} — ${r.objective} (${r.status})`).join('\n') || 'No saved research yet.', provider: 'research' });
        if (recall) {
          const r = await engine.memory.get(recall[1]);
          return res.json({ ok: true, text: r ? renderReport(r) : 'Research report not found.', researchId: r?.id, provider: 'research' });
        }
        let input;
        if (researchRequest) {
          const [objective, ...conditions] = (prefix?.[1] || text).split(/\s+conditions:\s*/i);
          input = { objective, conditions: conditions.join(' ') };
        } else {
          if (/^(cancel|stop|never mind)$/i.test(text)) return res.json({ ok: true, text: 'Research cancelled.', provider: 'research' });
          const prior = await engine.memory.get(pending[1]);
          if (!prior) return res.json({ ok: true, text: 'The earlier research objective could not be found. Please state it again.' });
          input = { objective: prior.objective, conditions: text, parentId: prior.id };
        }
        const research = await engine.run(input);
        res.json({ ok: true, text: renderReport(research), researchId: research.id, provider: 'research', model: 'evidence-pipeline' });
      } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'Research failed. Please retry; saved reports remain available.' }); }
    });
  };
}
