import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — makes Arterio installable from Chrome (Android/desktop).
 * `share_target` registers the app in the OS share sheet: sharing a photo from
 * the phone's gallery POSTs it to /share-target, which the service worker
 * (public/sw.js) intercepts and hands to the /share-receive page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Arterio — Gestion de collection d\'art',
    short_name: 'Arterio',
    description: 'Professional art collection management.',
    id: '/',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0e16',
    theme_color: '#6366f1',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Collection',
        url: '/fr/collection',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Assistant',
        url: '/fr/dashboard?assistant=1',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
    share_target: {
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        files: [{ name: 'images', accept: ['image/*'] }],
      },
    },
  } as MetadataRoute.Manifest;
}
