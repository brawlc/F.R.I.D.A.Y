import { readFile, writeFile } from 'node:fs/promises';
const renderedScan = JSON.parse(await readFile(new URL('../../../work/latest-rendered-scan.json', import.meta.url), 'utf8'));
const payload = {
  url: 'https://igloo.inc', projectName: `friday-studio-demo-${Date.now()}`, brandName: 'FRIDAY Studio',
  styleBrief: 'Create an original immersive dark portfolio with cyan and gold accents based on the observed fullscreen canvas composition. Use an original animated procedural canvas scene, clear brand and menu overlays, working project filters and project-detail dialog. Include responsive mobile navigation, pause-motion button and a local demo contact form. Use DOM text for readable typography. No external libraries.',
  originalDesignConfirmation: true,
  authorization: { confirmed: true, scope: 'Operator requested public-reference website generation and editable source export.' },
  renderedScan: { url: renderedScan.url, snapshots: renderedScan.snapshots.map(s => ({ ...s, resources: undefined })) },
};
console.log('BUILD_STARTED');
const response = await fetch('http://127.0.0.1:3000/api/reverse-engineering/v1/website-studio/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(240000) });
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(JSON.stringify(result));
await writeFile(new URL('../../../work/studio-live-result.json', import.meta.url), JSON.stringify(result.project, null, 2));
console.log(JSON.stringify({ id: result.project.id, generation: result.project.generation, warning: result.project.warning, previewUrl: result.project.previewUrl, projectPath: result.project.projectPath }));
