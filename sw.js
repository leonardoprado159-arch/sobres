// Responde al instante con la copia guardada, la actualiza por detrás y avisa a la app si cambió.
const CACHE = 'whiplash-v4';
const EXTERNOS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

const huella = (r) => r ? (r.headers.get('etag') || r.headers.get('last-modified') || '') : '';
async function avisar() {
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of cs) c.postMessage({ tipo: 'actualizada' });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const propio = url.origin === location.origin;
  if (!propio && !EXTERNOS.includes(url.hostname)) return; // los datos nunca se guardan aquí
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const guardada = await c.match(e.request);
    // lo propio se pide siempre fresco al servidor, sin pasar por la caché del navegador
    const pedido = propio ? fetch(url.href, { cache: 'no-cache' }) : fetch(e.request);
    const red = pedido.then(async (r) => {
      if (r && (r.ok || r.type === 'opaque')) {
        const antes = huella(guardada), ahora = huella(r);
        await c.put(e.request, r.clone());
        if (propio && guardada && antes && ahora && antes !== ahora) avisar();
      }
      return r;
    }).catch(() => guardada);
    if (guardada) { e.waitUntil(red); return guardada; }
    return red;
  }));
});
