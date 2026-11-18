/* ===================================================================
 * TT2Remote — pengganti google.script.run untuk aplikasi terpasang
 * -------------------------------------------------------------------
 * Di versi web Apps Script, google.script.run disediakan Google. Di APK,
 * iPhone, dan PWA objek itu tidak ada, jadi file ini menyediakan objek
 * dengan antarmuka yang sama:
 *
 *   TT2Remote.createRunner()
 *     .withSuccessHandler(fn)
 *     .withFailureHandler(fn)
 *     .withUserObject(obj)
 *     .namaFungsiServer(arg1, arg2)
 *
 * Setiap pemanggilan dikirim sebagai POST ke doPost di Code.gs dengan body
 * JSON { fn, args }. Content-Type text/plain dipakai agar browser tidak
 * mengirim preflight CORS (Apps Script tidak menjawab OPTIONS).
 *
 * Data publik tertentu (kontak darurat, kontak penting, data referensi)
 * disimpan di perangkat sehingga tetap bisa dibuka saat tidak ada sinyal.
 * Data yang memerlukan sesi login TIDAK pernah disimpan untuk offline.
 * =================================================================== */
(function () {
  'use strict';
  var config = window.TT2_CONFIG || {};
  var endpoint = String(config.apiUrl || '');
  var insideAppsScript = !!(window.google && window.google.script && window.google.script.run);
  var enabled = !!endpoint && !insideAppsScript;

  var REQUEST_TIMEOUT_MS = 90000;
  var OFFLINE_PREFIX = 'tt2-offline:';
  // Hanya fungsi publik tanpa token sesi di argumennya.
  var OFFLINE_CACHEABLE = {
    getBootstrap: true,
    getKontakData: true,
    getNomorDarurat: true,
    getNomorPenting: true,
    getRefData: true,
    getRekapKepuasan: true
  };

  function offlineKey(fn, args) { return OFFLINE_PREFIX + fn + ':' + JSON.stringify(args || []); }
  function saveOffline(fn, args, result) {
    if (!OFFLINE_CACHEABLE[fn]) return;
    try { localStorage.setItem(offlineKey(fn, args), JSON.stringify({ savedAt: Date.now(), result: result })); } catch (ignore) {}
  }
  function readOffline(fn, args) {
    if (!OFFLINE_CACHEABLE[fn]) return null;
    try {
      var raw = localStorage.getItem(offlineKey(fn, args));
      return raw ? JSON.parse(raw) : null;
    } catch (ignore) { return null; }
  }

  function networkError(original) {
    var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    var err = new Error(offline
      ? 'Tidak ada koneksi internet. Periksa sinyal atau Wi-Fi lalu coba lagi.'
      : 'Server tidak dapat dihubungi. Coba lagi beberapa saat lagi.');
    err.isNetworkError = true;
    err.cause = original;
    return err;
  }

  // Memanggil satu fungsi server. Mengembalikan Promise berisi hasil fungsi,
  // atau menolak dengan Error yang pesannya sama dengan yang dilempar server.
  function call(fn, args) {
    if (!endpoint) return Promise.reject(new Error('Alamat server belum diatur (TT2_CONFIG.apiUrl).'));
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] }),
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw networkError(new Error('HTTP ' + response.status));
      return response.json().catch(function () {
        // Apps Script mengembalikan halaman HTML bila deployment tidak bisa diakses publik.
        throw new Error('Jawaban server tidak dikenali. Pastikan Web App dideploy dengan akses "Siapa saja".');
      });
    }, function (err) {
      throw networkError(err);
    }).then(function (payload) {
      if (timer) clearTimeout(timer);
      if (!payload || payload.ok !== true) throw new Error(String(payload && payload.error || 'Kesalahan server.'));
      saveOffline(fn, args, payload.result);
      return payload.result;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function makeRunner(state) {
    return new Proxy({}, {
      get: function (target, property) {
        if (typeof property === 'symbol' || property === 'then') return undefined;
        if (property === 'withSuccessHandler') {
          return function (handler) { return makeRunner({ success: handler, failure: state.failure, userObject: state.userObject }); };
        }
        if (property === 'withFailureHandler') {
          return function (handler) { return makeRunner({ success: state.success, failure: handler, userObject: state.userObject }); };
        }
        if (property === 'withUserObject') {
          return function (obj) { return makeRunner({ success: state.success, failure: state.failure, userObject: obj }); };
        }
        return function () {
          var args = Array.prototype.slice.call(arguments);
          call(String(property), args).then(function (result) {
            if (typeof state.success === 'function') state.success(result, state.userObject);
          }, function (err) {
            if (err && err.isNetworkError) {
              var cached = readOffline(String(property), args);
              if (cached) {
                if (window.TT2Shell && typeof window.TT2Shell.showOfflineNotice === 'function') window.TT2Shell.showOfflineNotice(cached.savedAt);
                if (typeof state.success === 'function') state.success(cached.result, state.userObject);
                return;
              }
            }
            if (typeof state.failure === 'function') state.failure(err, state.userObject);
            else console.error('Permintaan server gagal', property, err);
          });
        };
      }
    });
  }

  window.TT2Remote = {
    enabled: enabled,
    endpoint: endpoint,
    call: call,
    readOffline: readOffline,
    createRunner: function () { return makeRunner({}); }
  };
})();
