// sw.js
const CACHE = 'pwa-v3';
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
    // كاش للصور: يعمل مع صور Supabase وكل الامتدادات الشائعة
  const isSupabaseImage = /\/storage\/v1\/object\/public\//.test(url.pathname) && url.host.includes('supabase.co');
  const isGenericImage  = e.request.destination === 'image' || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(url.pathname);

  if (isSupabaseImage || isGenericImage) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(e.request);
        if (cached) return cached;

        try {
          const res = await fetch(e.request);
          // حتى لو كانت الاستجابة opaque (no-cors) يمكن تخزينها
          cache.put(e.request, res.clone()).catch(()=>{});
          return res;
        } catch {
          // صورة بديلة خفيفة عند عدم توفر الشبكة والكاش
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560">
            <rect width="100%" height="100%" fill="#f3f4f6"/>
            <text x="50%" y="50%" font-size="28" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">
              صورة غير متاحة (أوفلاين)
            </text>
          </svg>`;
          return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
        }
      })()
    );
    return;
  }

});
