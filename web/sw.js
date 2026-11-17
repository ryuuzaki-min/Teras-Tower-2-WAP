/* Service worker versi PWA (iPhone / peramban). Tidak dipakai di APK.
 * Menyimpan kerangka aplikasi agar terbuka cepat dan tetap tampil saat sinyal
 * lemah. Data dari server (POST ke Apps Script) tidak pernah disimpan di sini.
 * Versi cache dan daftar berkas diisi otomatis oleh tools/build-web.mjs. */
'use strict';
const CACHE = 'tt2-shell-__CACHE_VERSION__';
const SHELL = __SHELL_FILES__;

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('tt2-shell-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Halaman: coba jaringan dulu (agar versi baru cepat terpakai), cadangan dari cache.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(function (response) {
      const copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put('./', copy); });
      return response;
    }).catch(function () { return caches.match('./'); }));
    return;
  }
  // Berkas kerangka: dari cache dulu, lalu jaringan.
  event.respondWith(caches.match(request).then(function (cached) { return cached || fetch(request); }));
});
