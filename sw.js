const CACHE_NAME = 'streamer-pwa-v25';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/input.css',
    '/script.js',
    '/manifest.json',
    '/download.html',
    '/download.js',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/Material3.png'
];

// Install Event - Cache Static Assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching app shell & static assets');
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

// Activate Event - Clean Up Old Caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event - Cache-First for static assets, Network-First for API/audio
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // For audio stream requests or API endpoints, use Network-First strategy
    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.mp3') || url.hostname.includes('jamendo') || url.hostname.includes('github') || url.hostname.includes('jsdelivr')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(event.request);
            })
        );
        return;
    }

    // Cache-First for static UI shell assets
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            });
        })
    );
});
