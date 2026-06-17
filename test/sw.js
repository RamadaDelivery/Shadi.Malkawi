// ============================================================
// sw.js — Shadi Malkawi Service Worker
// Network-First | Auto-Update on every deploy
// ============================================================

const CACHE_NAME = 'shm-cache-v7';

const SHELL = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './constants.js',
    './firebase-config.js',
    './SHM.png',
    './version.json',
];

// ── Install: skipWaiting فوري بدون انتظار ──────────────────
self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).catch(() => {})
    );
});

// ── Activate: مسح كل الكاش القديم + claim فوري ─────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
            .then(() => {
                // أبلغ كل التبويبات المفتوحة
                self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
                    .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })));
            })
    );
});

// ── Fetch: Network-First للملفات المحلية ────────────────────
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Firebase وGoogle APIs: شبكة فقط بدون كاش
    if (
        url.hostname.includes('firebase') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('wa.me')
    ) return;

    // CDN: cache-first (مكتبات خارجية ثابتة)
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

    // ملفات الموقع: Network-First دايماً — الشبكة تفوز
    e.respondWith(
        fetch(e.request, { cache: 'no-store' })
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
