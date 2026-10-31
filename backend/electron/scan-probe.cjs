// Runs in an isolated JavaScript world, with no Node or desktop bridge.
function inspectRenderedPage(fraction, active) {
  const key = '__fridayScanOverlay';
  let host = document.getElementById(key);
  if (!host) {
    host = document.createElement('div');
    host.id = key;
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot;
  root.replaceChildren();
  const style = document.createElement('style');
  style.textContent = '@keyframes sweep{from{top:0}to{top:100%}}.beam{position:absolute;left:0;right:0;height:50px;border-top:2px solid #6ee7f9;background:linear-gradient(#6ee7f933,transparent);animation:sweep 3s linear infinite}.box{position:absolute;border:1px solid #6ee7f9;background:#6ee7f909}.label{position:absolute;top:0;left:0;background:#071525;color:#d1faff;font:12px/1.5 monospace;padding:3px 7px;max-width:220px}@media(prefers-reduced-motion:reduce){.beam{animation:none;top:50%}}';
  root.appendChild(style);
  if (active) { const beam = document.createElement('div'); beam.className = 'beam'; root.appendChild(beam); }
  if (fraction !== null) window.scrollTo({ top: Math.max(0, document.documentElement.scrollHeight - innerHeight) * fraction, behavior: 'instant' });
  // Include open shadow DOM: web-component sites otherwise appear empty even
  // while their canvas and interface are visibly rendered.
  const roots = [document];
  let scannedNodes = 0;
  for (let i = 0; i < roots.length && roots.length < 150 && scannedNodes < 10000; i += 1) {
    for (const element of roots[i].querySelectorAll('*')) {
      if (++scannedNodes > 10000) break;
      if (element.id !== key && element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  const query = selector => roots.flatMap(scope => Array.from(scope.querySelectorAll(selector))).filter(e => e.id !== key);
  const elements = query('header,nav,main,section,article,footer,canvas,video,h1,form,[role="navigation"],[role="main"]').slice(0, 180);
  const blocks = [];
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 15 || rect.bottom < 0 || rect.top > innerHeight) continue;
    const css = getComputedStyle(element);
    if (css.visibility === 'hidden' || css.display === 'none') continue;
    const label = element.tagName.toLowerCase();
    blocks.push({ tag: label, width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.left), y: Math.round(rect.top), layout: css.display, position: css.position, gap: css.gap, borderRadius: css.borderRadius });
    if (blocks.length <= 12) {
      const box = document.createElement('div'); box.className = 'box';
      box.style.cssText = `left:${Math.max(0, rect.left)}px;top:${Math.max(0, rect.top)}px;width:${Math.min(rect.width, innerWidth)}px;height:${Math.min(rect.height, innerHeight)}px`;
      const caption = document.createElement('span'); caption.className = 'label'; caption.textContent = `${label} · ${css.display} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      box.appendChild(caption); root.appendChild(box);
    }
  }
  const sampled = query('body,h1,h2,p,a,button,section,header,span').slice(0, 250);
  const fonts = [...new Set(sampled.map(e => getComputedStyle(e).fontFamily))].slice(0, 8);
  const colors = [...new Set(sampled.map(e => getComputedStyle(e).color))].slice(0, 8);
  const backgrounds = [...new Set(sampled.map(e => getComputedStyle(e).backgroundColor))].filter(value => value !== 'rgba(0, 0, 0, 0)').slice(0, 8);
  const headings = query('h1,h2,h3').slice(0, 20).map(e => (e.textContent || '').trim().slice(0, 200));
  const controls = query('button,a,summary,[role="tab"]').slice(0, 30).map(e => (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 100)).filter(Boolean);
  const resources = performance.getEntriesByType('resource').slice(0, 500).map(entry => {
    let pathname = ''; try { pathname = new URL(entry.name).pathname; } catch {}
    return { type: entry.initiatorType, path: pathname.slice(0, 180), duration: Math.round(entry.duration) };
  });
  const counts = {};
  for (const tag of ['section','nav','header','footer','canvas','video','img','form','button','iframe']) counts[tag] = query(tag).length;
  const technology = [];
  if (roots.length > 1) technology.push(`${roots.length - 1} open shadow roots observed: web-component structure`);
  const scripts = Array.from(document.scripts).map(e => e.src).join(' ');
  if (scripts.includes('/_next/')) technology.push('Next.js: /_next/ script paths observed');
  if (scripts.includes('/_nuxt/')) technology.push('Nuxt: /_nuxt/ script paths observed');
  if (document.querySelector('[data-reactroot]')) technology.push('React: data-reactroot attribute observed');
  if (document.querySelector('[ng-version]')) technology.push('Angular: ng-version attribute observed');
  if (counts.canvas) technology.push('Canvas rendering observed; WebGL/3D engine is not confirmed');
  if (resources.some(r => /\.(glb|gltf)(?:$|\?)/i.test(r.path))) technology.push('glTF/GLB 3D model asset requested');
  const pageAnimations = document.getAnimations().filter(animation => animation.effect?.target?.getRootNode() !== root);
  const motion = pageAnimations.slice(0, 20).map(animation => {
    const timing = animation.effect?.getTiming() || {};
    return { target: animation.effect?.target?.tagName?.toLowerCase() || 'unknown', duration: timing.duration, delay: timing.delay, easing: timing.easing, iterations: Number.isFinite(timing.iterations) ? timing.iterations : 'infinite', playState: animation.playState };
  });
  return { title: document.title.slice(0, 160), url: location.origin + location.pathname, sampledAt: new Date().toISOString(), blocks, fonts, colors, backgrounds, headings, controls, resources, counts, technology, animations: pageAnimations.length, motion, documentHeight: document.documentElement.scrollHeight, scrollY, viewport: `${innerWidth} × ${innerHeight}` };
}
module.exports = { inspectRenderedPage };
