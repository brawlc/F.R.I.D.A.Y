import { readFile } from 'node:fs/promises';
const project = JSON.parse(await readFile(new URL('../../../work/studio-live-result.json', import.meta.url), 'utf8'));
const base = `http://127.0.0.1:3000/api/reverse-engineering/v1/website-studio/projects/${project.id}`;
const opened = await (await fetch(base)).json();
const source = opened.project.files['styles.css'];
const content = source.content.replace(/--bg:[^;]+/, '--bg:#091421').replace(/--text:[^;]+/, '--text:#f0f8ff').replace(/--accent:[^;]+/, '--accent:#f0cf85');
const saved = await fetch(`${base}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'styles.css', content, expectedHash: source.hash }) });
console.log(saved.status, await saved.text());
