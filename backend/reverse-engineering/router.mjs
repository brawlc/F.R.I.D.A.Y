import express from 'express';
import { RE_API_VERSION } from './constants.mjs';
import { errorPayload, validateArtifactUpload, validateId, validateJobRequest, validateWebsiteRequest, validateWebsiteStudioRequest, ReverseEngineeringError } from './schemas.mjs';
import { ReverseEngineeringService } from './service.mjs';
import { analyzeAuthorizedWebsite } from './web.mjs';
import { createStudioProject, listStudioProjects, readStudioProject, editStudioFile, exportStudioZip, prepareStudioHandoff, proposeStudioEdit, updateStudioSources } from './studio-workspace.mjs';
import { requireLocalDefense } from '../security/defense.mjs';

function sendError(res, error) {
  const payload = errorPayload(error);
  res.status(error?.status || 500).json(payload);
}

function respond(res, body, status = 200) {
  res.status(status).json({ ok: true, apiVersion: RE_API_VERSION, ...body });
}

export function createReverseEngineeringRouter({ service = new ReverseEngineeringService(), generateWebsite } = {}) {
  const router = express.Router();
  let editing = 0;
  router.use('/website-studio', requireLocalDefense);
  router.use('/website-studio', (req, res, next) => {
    if (req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ ok: false, error: 'Website Studio requires a same-origin request.' });
    next();
  });
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-FRIDAY-RE-API-Version', RE_API_VERSION);
    res.setHeader('X-FRIDAY-RE-Authorization', 'operator-asserted');
    next();
  });

  router.get('/health', async (_req, res) => {
    try {
      const capabilities = await service.capabilities();
      respond(res, {
        service: 'friday-reverse-engineering',
        status: 'online',
        profiles: capabilities.profiles.map(profile => ({ id: profile.id, available: profile.available })),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/capabilities', async (req, res) => {
    try {
      respond(res, { capabilities: await service.capabilities({ refresh: req.query.refresh === 'true' }) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/artifacts', async (req, res) => {
    try {
      const upload = validateArtifactUpload(req.body);
      const artifact = await service.ingestArtifact(upload);
      respond(res, { artifact }, 201);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/websites/analyze/stream', async (req, res) => {
    let request;
    try { request = validateWebsiteRequest(req.body); }
    catch (error) { sendError(res, error); return; }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const emit = event => {
      if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const analysis = await analyzeAuthorizedWebsite(request, progress => emit({ type: 'progress', ...progress }));
      emit({ type: 'result', analysis });
    } catch (error) {
      emit({ type: 'error', ...errorPayload(error) });
    } finally { res.end(); }
  });

  router.post('/websites/analyze', async (req, res) => {
    try {
      const request = validateWebsiteRequest(req.body);
      const analysis = await analyzeAuthorizedWebsite(request);
      respond(res, { analysis });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/website-studio/projects', async (req, res) => {
    try {
      const request = validateWebsiteStudioRequest(req.body);
      if (!request.originalDesignConfirmation) {
        throw new ReverseEngineeringError('Confirm that FRIDAY should create an original design inspired only by high-level public cues, without copying branding, content, assets, or code.', { status: 403, code: 'original_design_confirmation_required' });
      }
      const analysis = await analyzeAuthorizedWebsite(request);
      const project = await createStudioProject({ ...request, referenceUrl: request.url, analysis, generate: generateWebsite });
      respond(res, { project, referenceObservation: analysis });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/website-studio/projects', async (_req, res) => {
    try { respond(res, { projects: await listStudioProjects() }); } catch (error) { sendError(res, error); }
  });
  router.get('/website-studio/projects/:id', async (req, res) => {
    try { respond(res, { project: await readStudioProject(req.params.id) }); } catch (error) { sendError(res, error); }
  });
  router.post('/website-studio/projects/:id/handoff', async (req, res) => {
    try { respond(res, await prepareStudioHandoff(req.params.id)); } catch (error) { sendError(res, error); }
  });
  router.put('/website-studio/projects/:id/file', async (req, res) => {
    try { respond(res, await editStudioFile(req.params.id, req.body || {})); } catch (error) { sendError(res, error); }
  });
  router.post('/website-studio/projects/:id/propose-edit', async (req, res) => {
    if (editing >= 2) return res.status(429).json({ ok: false, error: 'Two AI edits are already running.' });
    if (req.body?.confirmed !== true) return res.status(403).json({ ok: false, error: 'Confirm sending these project sources to the configured AI provider.' });
    editing++;
    try { respond(res, await proposeStudioEdit(req.params.id, req.body || {}, generateWebsite)); }
    catch (error) { sendError(res, error); }
    finally { editing--; }
  });
  router.put('/website-studio/projects/:id/sources', async (req, res) => {
    try { respond(res, await updateStudioSources(req.params.id, req.body || {})); } catch (error) { sendError(res, error); }
  });
  router.get('/website-studio/projects/:id/export', async (req, res) => {
    try {
      const archive = await exportStudioZip(req.params.id);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
      res.send(archive.bytes);
    } catch (error) { sendError(res, error); }
  });

  router.get('/artifacts/:artifactId', async (req, res) => {
    try {
      const artifactId = validateId(req.params.artifactId, 'art', 'artifactId');
      respond(res, { artifact: await service.getArtifact(artifactId) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/jobs', async (_req, res) => {
    try {
      respond(res, { jobs: await service.getJobs() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/jobs', async (req, res) => {
    try {
      const request = validateJobRequest(req.body);
      const job = await service.submitJob(request);
      respond(res, { job }, 202);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/jobs/:jobId', async (req, res) => {
    try {
      const jobId = validateId(req.params.jobId, 'job', 'jobId');
      respond(res, { job: await service.getJob(jobId) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/jobs/:jobId/cancel', async (req, res) => {
    try {
      const jobId = validateId(req.params.jobId, 'job', 'jobId');
      respond(res, { job: await service.cancelJob(jobId) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/jobs/:jobId/report', async (req, res) => {
    try {
      const jobId = validateId(req.params.jobId, 'job', 'jobId');
      const format = req.query.format === 'markdown' ? 'markdown' : 'json';
      const report = await service.getReport(jobId, format);
      if (format === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="friday-re-report-${jobId}.md"`);
        res.status(200).send(report);
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="friday-re-report-${jobId}.json"`);
      res.status(200).send(report);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
