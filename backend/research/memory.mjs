import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createResearchMemory(directory) {
  const valid = id => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid research ID'); return join(directory, `${id}.json`); };
  return {
    async save(record) {
      const target = valid(record.id);
      await mkdir(directory, { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 }); await rename(temporary, target); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
      return record;
    },
    async get(id) {
      try { return JSON.parse(await readFile(valid(id), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async list() {
      let files; try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const result = [];
      for (const file of files.filter(x => /^[a-f0-9-]{36}\.json$/.test(x))) {
        const r = JSON.parse(await readFile(join(directory, file), 'utf8'));
        result.push({ id: r.id, objective: r.objective, status: r.status, createdAt: r.createdAt });
      }
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    },
  };
}
