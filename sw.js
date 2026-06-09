// ============================================================
// sw.js — Jawaher Service Worker
// ============================================================

const CACHE_NAME = 'malkawi-v160';

const SHELL = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './constants.js',
    './firebase-config.js',
    'https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&display=swap',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js',
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

// ── Activate: مسح الكاش القديم ──────────────────────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// ── Fetch: Network-First (يتحقق من السيرفر دايماً) ──────────
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Firebase وGoogle APIs: شبكة فقط بدون تدخل
    if (
        url.hostname.includes('firebase') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('wa.me')
    ) return;

    // CDN assets (fonts, icons, xlsx): cache-first لأنها ما بتتغير
    if (
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com')
    ) {
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetch(e.request))
        );
        return;
    }

    // ملفات الموقع (app.js, index.html, style.css...): Network-First
    // → يجرب السيرفر أولاً → إذا نجح يحدّث الكاش → إذا فشل يرجع الكاش
    e.respondWith(
        fetch(e.request)
            .then(response => {
                if (e.request.method === 'GET' && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(e.request).then(cached => {
                if (cached) return cached;
                if (e.request.mode === 'navigate') return caches.match('./index.html');
            }))
    );
});
