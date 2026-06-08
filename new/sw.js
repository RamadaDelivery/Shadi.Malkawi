// ============================================================
// sw.js — Jawaher Service Worker
// Caches app shell for offline use
// ============================================================

const CACHE_NAME = 'jawaher-v1';

// App shell files to cache
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

// ── Install: cache app shell ──────────────────────────────
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            // Cache what we can; ignore failures for CDN assets
            return Promise.allSettled(SHELL.map(url => cache.add(url).catch(() => {})));
        }).then(() => self.skipWaiting())
    );
});

// ── Activate: clean old caches ────────────────────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: cache-first for shell, network-first for Firebase ─
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Let Firebase / Google APIs go through the network always
    if (
        url.hostname.includes('firebase') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('wa.me')
    ) {
        return; // default browser behavior (network)
    }

    // For app shell: cache-first, then network fallback
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(response => {
                // Cache successful GET responses
                if (e.request.method === 'GET' && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return response;
            }).catch(() => {
                // Offline fallback for navigation requests
                if (e.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
