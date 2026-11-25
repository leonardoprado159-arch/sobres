// Responde al instante con la copia guardada, la actualiza por detrás y avisa a la app si cambió.
const CACHE = 'whiplash-v5';
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
    let guardada = await c.match(e.request);
    // una copia "opaca" no sirve para un pedido que exige leer la respuesta (los scripts con huella): se ignora
    if (guardada && guardada.type === 'opaque' && e.request.mode === 'cors') guardada = undefined;
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

// ---------- avisos al teléfono ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Whiplash', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Whiplash', {
    body: d.body || '', icon: 'icon-180.png', badge: 'icon-180.png', tag: d.tag, data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
