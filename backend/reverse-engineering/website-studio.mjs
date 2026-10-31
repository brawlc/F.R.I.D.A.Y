import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { ReverseEngineeringError } from './schemas.mjs';

function safeProjectName(value) {
  const source = String(value || '').trim().toLowerCase();
  const slug = source
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!slug || slug.length < 2) {
    throw new ReverseEngineeringError('Project name must contain at least two letters or numbers.', { code: 'invalid_project_name' });
  }
  return slug;
}

function outputRoot() {
  const configured = String(process.env.FRIDAY_WEBSITE_STUDIO_OUTPUT_DIR || '').trim();
  return resolve(configured || join(process.env.USERPROFILE || homedir(), 'Downloads'));
}

function ensureInside(root, candidate) {
  const result = relative(root, candidate);
  return result && !result.startsWith('..') && !result.includes(':');
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function projectFiles({ projectName, brandName, referenceUrl, styleBrief, signals }) {
  const displayName = String(brandName || projectName)
    .replace(/[^a-zA-Z0-9 &.'-]/g, '')
    .trim()
    .slice(0, 70) || projectName;
  const safeStyleBrief = String(styleBrief || 'Confident, clear, modern, and product-focused.')
    .replace(/[<>]/g, '')
    .slice(0, 500);
  const signalNames = signals.map(signal => signal.name).filter(Boolean).slice(0, 8);
  const signalComment = signalNames.length ? signalNames.join(', ') : 'No framework-specific client marker was used';

  return {
    'package.json': json({
      name: projectName,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { '@vitejs/plugin-react': '^5.0.4', vite: '^6.2.3', react: '^19.0.1', 'react-dom': '^19.0.1' },
      devDependencies: {},
    }),
    'index.html': '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>' + displayName + '</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n',
    'src/main.jsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport './styles.css';\n\nconst features = [\n  ['Clear value', 'Explain the benefit in one calm, specific sentence.'],\n  ['Practical flow', 'Guide people from interest to action without friction.'],\n  ['Editable system', 'Swap sections, copy, colors, and calls to action freely.'],\n];\n\nfunction App() {\n  return (\n    <main>\n      <nav className=\"nav shell\"><a className=\"brand\" href=\"#top\">" + displayName + "</a><div><a href=\"#features\">Features</a><a href=\"#contact\">Contact</a><a className=\"nav-cta\" href=\"#contact\">Get started</a></div></nav>\n      <section id=\"top\" className=\"hero shell\"><div><p className=\"eyebrow\">Built for your next move</p><h1>Make the complicated part feel beautifully simple.</h1><p className=\"lede\">A polished, original starting point for a product, service, or creative business. Make it yours in <code>src/main.jsx</code>.</p><div className=\"actions\"><a className=\"button primary\" href=\"#contact\">Start a conversation</a><a className=\"button secondary\" href=\"#features\">Explore the system</a></div></div><aside className=\"hero-card\"><span>01 / SIGNAL</span><strong>Purposeful design, ready for your content.</strong><p>Replace this panel with a product visual, dashboard preview, photo, or customer proof.</p></aside></section>\n      <section id=\"features\" className=\"shell section\"><p className=\"eyebrow\">How it works</p><h2>A flexible structure with room to grow.</h2><div className=\"cards\">{features.map(([title, body], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>\n      <section id=\"contact\" className=\"shell close\"><div><p className=\"eyebrow\">Ready when you are</p><h2>Turn a good first impression into a useful next step.</h2></div><a className=\"button primary\" href=\"mailto:hello@example.com\">Contact us</a></section>\n    </main>\n  );\n}\n\ncreateRoot(document.getElementById('root')).render(<App />);\n",
    'src/styles.css': "@import url('https://fonts.googleapis.com/css2?family=DM+Mono&family=Manrope:wght@400;500;600;700;800&display=swap');\n:root { color: #eff8ff; background: #07111e; font-family: Manrope, system-ui, sans-serif; } * { box-sizing: border-box; } html { scroll-behavior: smooth; } body { margin: 0; background: radial-gradient(circle at 80% 4%, #1c5c76 0, transparent 29rem), #07111e; } a { color: inherit; text-decoration: none; } .shell { width: min(1120px, calc(100% - 2.5rem)); margin: auto; } .nav { display:flex; align-items:center; justify-content:space-between; padding:1.6rem 0; } .brand { font-weight:800; letter-spacing:-.04em; font-size:1.2rem; } .nav div { display:flex; align-items:center; gap:1.25rem; font-size:.86rem; color:#c0d5e4; } .nav-cta,.button { border-radius:999px; padding:.78rem 1.15rem; transition:.2s ease; } .nav-cta,.primary { background:#cdf3e7; color:#0b2021; font-weight:800; } .hero { min-height:70vh; display:grid; grid-template-columns:1.25fr .75fr; align-items:center; gap:4rem; padding:5rem 0 7rem; } .eyebrow { color:#89e9d3; text-transform:uppercase; letter-spacing:.16em; font: .73rem 'DM Mono', monospace; } h1,h2,h3,p { margin-top:0; } h1 { max-width:12ch; font-size:clamp(3rem,7vw,6.5rem); line-height:.97; letter-spacing:-.075em; } h2 { font-size:clamp(2rem,4vw,4rem); max-width:15ch; line-height:1; letter-spacing:-.06em; } .lede { max-width:38rem; color:#b9cfdd; line-height:1.7; } code { color:#89e9d3; } .actions { display:flex; gap:.8rem; flex-wrap:wrap; margin-top:2rem; } .secondary { border:1px solid #5e7e93; color:#e8f5fa; } .button:hover,.nav-cta:hover { transform:translateY(-2px); filter:brightness(1.06); } .hero-card { padding:2rem; min-height:20rem; display:flex; flex-direction:column; justify-content:end; border:1px solid #6594a9; background:linear-gradient(150deg,rgba(104,216,190,.19),rgba(10,22,37,.78)); box-shadow: 24px 24px 0 rgba(137,233,211,.1); } .hero-card span, article span { font: .72rem 'DM Mono', monospace; color:#89e9d3; } .hero-card strong { margin-top:1rem; font-size:1.8rem; line-height:1.1; letter-spacing:-.05em; } .hero-card p,article p { margin:1rem 0 0; color:#b9cfdd; line-height:1.6; } .section { padding:5rem 0 7rem; } .cards { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; margin-top:3rem; } article { border-top:1px solid #5e7e93; padding:1.4rem 0; } article h3 { margin:1.2rem 0 .3rem; font-size:1.35rem; } .close { border-top:1px solid #5e7e93; padding:4rem 0 6rem; display:flex; align-items:end; justify-content:space-between; gap:2rem; } @media(max-width:720px) { .nav div a:not(.nav-cta) { display:none; } .hero { grid-template-columns:1fr; gap:2rem; padding:3rem 0 5rem; } .cards { grid-template-columns:1fr; } .close { display:block; } .close .button { display:inline-block; margin-top:1rem; } }\n",
    'README.md': `# ${displayName}\n\nThis is an original, editable Vite + React starter generated by FRIDAY Website Studio. It uses high-level public design signals from ${referenceUrl} only; it does not copy site text, branding, images, source code, protected assets, private routes, or backend behavior.\n\n## Run it\n\n\`\`\`powershell\nnpm install\nnpm run dev\n\`\`\`\n\nOpen the shown local URL, then edit:\n\n- \`src/main.jsx\` — content and sections\n- \`src/styles.css\` — visual system and responsive layout\n\n## Direction used\n\n${safeStyleBrief}\n\nObserved reference signals: ${signalComment}. These signals are design cues, not copied implementation details.\n`,
  };
}

export async function createWebsiteStudioProject({ projectName, brandName, referenceUrl, styleBrief, analysis }) {
  const root = outputRoot();
  const slug = safeProjectName(projectName);
  const projectPath = resolve(root, slug);
  if (!ensureInside(root, projectPath)) {
    throw new ReverseEngineeringError('Generated project path escaped the configured output folder.', { code: 'invalid_project_path' });
  }
  if (existsSync(projectPath)) {
    throw new ReverseEngineeringError(`A project named "${slug}" already exists in the output folder. Choose a new project name.`, { status: 409, code: 'project_exists' });
  }
  const files = projectFiles({
    projectName: slug,
    brandName,
    referenceUrl,
    styleBrief,
    signals: analysis?.toolReportedFindings?.frameworkSignals || [],
  });
  await mkdir(join(projectPath, 'src'), { recursive: true, mode: 0o700 });
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const filePath = join(projectPath, relativePath);
    await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
  }));
  return {
    projectName: slug,
    projectPath,
    files: Object.keys(files),
    nextSteps: ['Open the folder in VS Code.', 'Run npm install.', 'Run npm run dev.', 'Edit src/main.jsx and src/styles.css to make it yours.'],
    generatedAt: new Date().toISOString(),
    sourcePolicy: 'Original starter generated from high-level public design cues only; no reference-page assets, copy, branding, source code, or backend behavior were copied.',
  };
}
