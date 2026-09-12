const CACHE_VERSION = 'my-library-v1';
const PRECACHE_URLS = [
    './',
    'index.html',
    'styles.css',
    'app.js',
    'manifest.json',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Never intercept calls to the Supabase API - always go to the network so
// sync stays live and errors surface normally instead of being masked by a cache.
function isApiRequest(url) {
    return url.hostname.endsWith('.supabase.co');
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET' || isApiRequest(url)) {
        return;
    }

    event.respondWith(
        fetch(request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request).then((cached) => cached || caches.match('index.html')))
    );
});
