const cards = document.getElementById('cards');
function card(title, text) {
  const item = document.createElement('div'); item.className = 'card';
  const heading = document.createElement('strong'); heading.textContent = title;
  const value = document.createElement('span'); value.textContent = text;
  item.append(heading, value); cards.appendChild(item);
}
window.scanPanel.onUpdate(event => {
  document.getElementById('address').textContent = event.url || '';
  document.getElementById('state').textContent = event.state;
  document.getElementById('stage').textContent = event.message;
  document.getElementById('progress').style.width = `${event.progress || 0}%`;
  document.getElementById('stop').disabled = event.state !== 'SCANNING' && event.state !== 'CONNECTING';
  const data = event.snapshot;
  if (!data) return;
  cards.replaceChildren();
  card('Page structure · observed', `${data.title}\nViewport ${data.viewport}\nPage height ${data.documentHeight}px\n${Object.entries(data.counts).map(([key, value]) => `${key}: ${value}`).join(' · ')}`);
  card('Visible building blocks', data.blocks.slice(0, 12).map(b => `${b.tag} · ${b.layout} · ${b.width} × ${b.height}px`).join('\n') || 'No semantic blocks detected in this viewport.');
  card('Typography · computed DOM styles', data.fonts.join('\n') + '\nCanvas-drawn text may use different fonts.');
  card('Text colors · computed styles', data.colors.join('\n'));
  card('Page hierarchy', (data.headings || []).join('\n') || 'No exposed HTML headings.');
  card('Interface controls', (data.controls || []).join(' · ') || 'No exposed labeled controls.');
  const types = {}; data.resources.forEach(r => { types[r.type || 'other'] = (types[r.type || 'other'] || 0) + 1; });
  card('Loaded resources · observed', Object.entries(types).map(([key, value]) => `${key}: ${value}`).join(' · ') + '\n' + data.resources.filter(r => /\.(css|js|glb|gltf|woff2?|mp4)$/i.test(r.path)).slice(0, 10).map(r => r.path).join('\n'));
  card('Technology clues', data.technology.join('\n') || 'No conclusive framework markers.');
  card('Motion', `${data.animations} active DOM/CSS animations observed. Canvas/WebGL animation loops are not included.`);
});
document.getElementById('stop').addEventListener('click', () => window.scanPanel.stop());
