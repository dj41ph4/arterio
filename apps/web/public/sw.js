/**
 * Arterio service worker — deliberately minimal.
 *
 * Scope: PWA installability + Web Share Target. NO app-shell caching: the NAS
 * auto-deploys new images via watchtower, and a stale-cache SW would keep
 * serving old assets after an update. Everything goes to the network.
 */
const SHARE_CACHE = 'arterio-share';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Web Share Target: the OS share sheet POSTs the shared photo(s) here.
  // Stash them in the Cache API and bounce to the picker page — an SW can't
  // hold state, and the receiving page runs in a fresh window.
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const files = formData.getAll('images').filter((f) => f && typeof f === 'object');
        const cache = await caches.open(SHARE_CACHE);
        // Previous leftovers would show up as ghost photos in the picker.
        await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
        await Promise.all(
          files.map((file, i) =>
            cache.put(
              `/shared-file-${i}`,
              new Response(file, {
                headers: {
                  'Content-Type': file.type || 'image/jpeg',
                  'X-File-Name': encodeURIComponent(file.name || `photo-${i}.jpg`),
                },
              }),
            ),
          ),
        );
        return Response.redirect(`/share-receive?count=${files.length}`, 303);
      })(),
    );
  }
  // All other requests: straight to the network (no respondWith → default).
});
