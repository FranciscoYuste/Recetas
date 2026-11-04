// Service worker: permite instalar la app y abrirla sin conexión.
// Estrategia "red primero": con internet siempre se sirve la versión nueva;
// sin internet se usa la última copia guardada. Supabase nunca se cachea.
const CACHE = 'recetario-v7';
const SHELL = [
    './',
    './index.html',
    './styles.css',
    './js/main.js',
    './js/config.js',
    './js/util.js',
    './js/state.js',
    './js/api.js',
    './js/ui.js',
    './js/catalogo.js',
    './js/ingredientes.js',
    './js/pasillos.js',
    './js/sugerencias.js',
    './js/semana.js',
    './js/recetas.js',
    './js/nevera.js',
    './js/compra.js',
    './js/ajustes.js',
    './manifest.webmanifest',
    './img/banner.jpg',
    './img/icon-192.png',
    './img/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request, { ignoreSearch: true })
                .then(cached => cached || caches.match('./index.html')))
    );
});
