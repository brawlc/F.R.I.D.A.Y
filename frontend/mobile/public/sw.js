const CACHE='friday-mobile-shell-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/mobile/','/mobile/icon-192.png','/mobile/manifest.webmanifest']))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('friday-mobile-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  // Never cache APIs, PDFs, passkey flows, sessions, or authenticated response data.
  if(event.request.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith('/mobile/')||u.search)return;
  if(!(u.pathname==='/mobile/'||u.pathname.startsWith('/mobile/assets/')||u.pathname.endsWith('.png')||u.pathname.endsWith('.webmanifest')))return;
  event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}return r;}).catch(()=>caches.match(event.request)));
});
