import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createMemoryStore(path) {
  let queue = Promise.resolve();
  const sanitize = value => ({ facts: Array.isArray(value?.facts) ? value.facts.filter(item => typeof item === 'string' && item.trim()).slice(-80) : [], updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : '' });
  async function read() {
    try { return sanitize(JSON.parse(await readFile(path, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return sanitize(null); throw new Error('Saved memory could not be read. The existing file has been preserved.'); }
  }
  function update(transform) {
    const task = queue.catch(() => {}).then(async () => {
      const next = sanitize(await transform(await read()));
      next.updatedAt = new Date().toISOString();
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
      return next;
    });
    queue = task;
    return task;
  }
  return { read, update };
}
