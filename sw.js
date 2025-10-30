// sw.js
const CACHE = 'pwa-v2';
const CORE = ['./', './index.html', './styles.css', './script.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

// نقيّد التعامل للصفحة الرئيسية فقط؛ بقية الطلبات تمر مباشرة للشبكة
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // فقط تنقلات الصفحة الرئيسية
  if (e.request.mode === 'navigate') {
    const isHome = url.pathname === '/' || url.pathname.endsWith('/index.html');
    if (!isHome) return; // اتركها للمتصفح

    e.respondWith(
      (async () => {
        try {
          const res = await fetch(e.request);
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          cache.put('./index.html', copy);
          return res;
        } catch {
          return caches.match('./index.html');
        }
      })()
    );
    return;
  }

  // ملفات أساسية للصفحة الرئيسية فقط
  const isCore = url.origin === location.origin && CORE.some(p => url.pathname.endsWith(p.replace('./','/')));
  if (isCore) {
    e.respondWith(
      caches.match(e.request).then(res =>
        res || fetch(e.request).then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return r;
        })
      )
    );
  }
});

