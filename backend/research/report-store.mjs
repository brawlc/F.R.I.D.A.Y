import { mkdir, lstat, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validResearchId, MAX_PDF_BYTES } from './pdf.mjs';
const within = (root, target) => { const rel = relative(root, target); return !rel || (!rel.startsWith('..') && !isAbsolute(rel)); };
export function createReportStore({ directory, workspace, retentionDays = 30, maxReports = 100, now = Date.now }) {
  const root = resolve(directory), base = resolve(workspace);
  const invalid = root === base || ['frontend', 'dist', 'build', 'public', '.git', '.agents', '.codex', '.aws'].some(p => within(resolve(base, p), root)) || dirname(root) === root;
  const days = Math.max(1, Math.min(365, Number(retentionDays) || 30)), count = Math.max(1, Math.min(100, Number(maxReports) || 100));
  let queue = Promise.resolve();
  const serial = fn => { const task = queue.catch(() => {}).then(fn); queue = task; return task; };
  async function checkPath(path) {
    let cursor = resolve(path);
    while (true) { try { if ((await lstat(cursor)).isSymbolicLink()) throw Error('report_symlink_refused'); } catch (e) { if (e.code !== 'ENOENT') throw e; } const parent = dirname(cursor); if (parent === cursor) break; cursor = parent; }
  }
  async function prepare() { if (invalid) throw Error('unsafe_report_directory'); await checkPath(root); await mkdir(root, { recursive: true, mode: 0o700 }); await checkPath(root); }
  const file = (id, ext) => { if (!validResearchId(id)) throw Error('invalid_research_id'); return join(root, `research-${id}.${ext}`); };
  async function atomic(path, data) { await checkPath(path); const temp = join(root, `${randomUUID()}.tmp`); try { await writeFile(temp, data, { flag: 'wx', mode: 0o600 }); await checkPath(path); await rename(temp, path); } finally { await rm(temp, { force: true }); } }
  async function prune(keepId) {
    const byId = new Map();
    for (const name of await readdir(root)) {
      const match = /^research-([a-f0-9-]{36})\.(pdf|json)$/i.exec(name); if (!match || !validResearchId(match[1])) continue;
      const path = join(root, name); await checkPath(path); const info = await lstat(path); if (!info.isFile()) throw Error('invalid_report_file'); byId.set(match[1], { id: match[1], at: Math.max(info.mtimeMs, byId.get(match[1])?.at || 0) });
    }
    const entries = [...byId.values()];
    const keepExists = entries.some(e => e.id === keepId);
    const candidates = entries.filter(e => e.id !== keepId).sort((a, b) => b.at - a.at);
    for (let i = 0; i < candidates.length; i++) if (now() - candidates[i].at > days * 86400000 || i >= count - (keepId ? 1 : 0)) {
      for (const ext of ['pdf', 'json']) { const path = file(candidates[i].id, ext); await checkPath(path); await rm(path, { force: true }); }
    }
    return keepExists;
  }
  return {
    save: (id, bytes, metadata = {}) => serial(async () => { file(id, 'pdf'); if (!Buffer.isBuffer(bytes) || bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('invalid_pdf'); await prepare(); await prune(id); await atomic(file(id, 'pdf'), bytes); await atomic(file(id, 'json'), JSON.stringify({ id, status: 'ready', size: bytes.length, createdAt: new Date(now()).toISOString(), ...metadata })); }),
    status: id => serial(async () => { file(id, 'json'); await prepare(); await prune(); try { await checkPath(file(id, 'json')); return JSON.parse(await readFile(file(id, 'json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { id, status: 'not_generated' }; throw e; } }),
    recordStatus: (id, status) => serial(async () => { file(id, 'json'); await prepare(); await prune(id); await atomic(file(id, 'json'), JSON.stringify({ id, ...status, updatedAt: new Date(now()).toISOString() })); }),
  };
}
