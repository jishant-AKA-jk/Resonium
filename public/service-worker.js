// Service Worker for background audio support
const CACHE_NAME = 'audio-streamer-v1';

self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  event.waitUntil(self.clients.claim());
});

// Keep service worker alive
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Handle messages from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    // Respond to keep the service worker active
    event.ports[0].postMessage({ type: 'ALIVE' });
  }
});