const CACHE_NAME = 'licitasaas-cache-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Intentionally minimal payload so we don't block install.
      // In a real scenario we'd cache index.html, JS bundles, fonts.
      return cache.addAll([
        '/',
        '/index.html',
        '/manifest.json'
      ]).catch(e => {
        console.warn('Failed to cache assets', e);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // basic network-first strategy for dynamic, cache-first for static
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === location.origin && url.pathname.match(/\.(js|css|woff2|png|svg)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          return response;
        });
      })
    );
  } else {
    // API calls or HTML: network first
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
