// Unregister script — replaces the old service worker to clean up caches
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell all clients to reload so they get fresh assets
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UNREGISTERED' }));
        });
      })
  );
});
// No fetch handler — passes everything through to network
