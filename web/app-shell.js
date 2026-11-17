/* ===================================================================
 * app-shell.js — lapisan aplikasi terpasang (APK / iPhone / PWA)
 * -------------------------------------------------------------------
 * Dimuat SETELAH app.js. Tugasnya:
 *  1. Menunda inisialisasi asli (window.onload dari app.js) sampai data awal
 *     (getBootstrap) tersedia — dari cache perangkat bila ada, agar cepat.
 *  2. Menyegarkan tema/teks dari server di latar belakang.
 *  3. Di aplikasi Android/iOS (Capacitor): membuka WhatsApp, Google Maps, dan
 *     tautan luar di aplikasi/peramban HP, bukan di dalam aplikasi.
 *  4. Memberi tahu bila ada versi APK baru (SystemConfig: ApkVersiTerbaru,
 *     ApkTautanUnduh).
 *  5. Mendaftarkan service worker untuk versi PWA (iPhone / peramban).
 * =================================================================== */
(function () {
  'use strict';
  var config = window.TT2_CONFIG || {};
  var startOriginalApp = window.onload;
  window.onload = null;

  var cap = window.Capacitor;
  var isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  var platform = isNative && typeof cap.getPlatform === 'function' ? cap.getPlatform() : 'web';
  function plugin(name) { return cap && cap.Plugins ? cap.Plugins[name] : null; }

  // -----------------------------------------------------------------
  // Tautan luar
  // -----------------------------------------------------------------
  function openExternal(url) {
    url = String(url || '');
    if (!/^(https?:|mailto:|tel:)/i.test(url)) return;
    if (!isNative) { window.location.href = url; return; }
    var launcher = plugin('AppLauncher');
    var browser = plugin('Browser');
    var tryBrowser = function () {
      if (browser && browser.open) return browser.open({ url: url }).catch(function () { window.location.href = url; });
      window.location.href = url;
    };
    // AppLauncher membuka WhatsApp / Google Maps langsung bila terpasang.
    if (launcher && launcher.openUrl) launcher.openUrl({ url: url }).catch(tryBrowser);
    else tryBrowser();
  }

  if (isNative) {
    // window.open tidak didukung WebView. Ganti dengan objek tiruan yang meneruskan
    // alamat ke openExternal. Alur "Reset PIN + WhatsApp" membuka jendela kosong
    // dulu lalu mengisi location.href setelah server menjawab; keduanya didukung.
    window.open = function (url) {
      var href = '';
      var fake = {
        closed: false,
        close: function () { fake.closed = true; },
        focus: function () {},
        document: { title: '', body: { textContent: '' } },
        location: {}
      };
      Object.defineProperty(fake.location, 'href', {
        get: function () { return href; },
        set: function (value) { href = String(value || ''); if (!fake.closed) openExternal(href); }
      });
      if (url && url !== 'about:blank') openExternal(url);
      return fake;
    };
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;
      var href = link.getAttribute('href') || '';
      var external = link.target === '_blank' || /^(mailto:|tel:)/i.test(href) || /^https?:\/\/(wa\.me|api\.whatsapp\.com|maps\.app\.goo\.gl|(www\.)?google\.[a-z.]+\/maps)/i.test(href);
      if (!external || link.hasAttribute('download')) return;
      event.preventDefault();
      openExternal(link.href);
    }, true);
  }

  // -----------------------------------------------------------------
  // Data awal (bootstrap)
  // -----------------------------------------------------------------
  function fillAppInfo(bootstrap) {
    var info = (bootstrap && bootstrap.appInfo) || {};
    document.querySelectorAll('[data-appinfo]').forEach(function (el) {
      el.textContent = String(info[el.getAttribute('data-appinfo')] || '');
    });
  }
  function applyBootstrap(bootstrap) {
    if (!bootstrap) return;
    systemConfig = bootstrap.systemConfig || {};
    appUrl = bootstrap.appUrl || '';
    appVersion = bootstrap.appVersion || '0';
    try { if (typeof applyTheme === 'function') applyTheme(); } catch (ignore) {}
    fillAppInfo(bootstrap);
  }
  function saveBootstrap(bootstrap) {
    try { localStorage.setItem(TT2_BOOTSTRAP_KEY, JSON.stringify(bootstrap)); } catch (ignore) {}
  }

  var started = false;
  function startApp() {
    if (started) return;
    started = true;
    var splash = document.getElementById('tt2Splash');
    if (splash) splash.remove();
    if (typeof startOriginalApp === 'function') startOriginalApp.call(window);
    hideNativeSplash();
  }
  function hideNativeSplash() {
    var splashPlugin = plugin('SplashScreen');
    if (splashPlugin && splashPlugin.hide) splashPlugin.hide().catch(function () {});
  }

  function showStartupError(message) {
    hideNativeSplash();
    var splash = document.getElementById('tt2Splash');
    if (!splash) return;
    splash.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'tt2-splash-box';
    var title = document.createElement('div');
    title.className = 'tt2-splash-title';
    title.textContent = 'Belum bisa terhubung';
    var text = document.createElement('div');
    text.className = 'tt2-splash-text';
    text.textContent = message + ' Saat pertama kali dibuka, aplikasi memerlukan koneksi internet.';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-primary';
    retry.textContent = 'Coba lagi';
    retry.onclick = function () { window.location.reload(); };
    box.appendChild(title); box.appendChild(text); box.appendChild(retry); splash.appendChild(box);
  }

  // -----------------------------------------------------------------
  // Cek versi APK
  // -----------------------------------------------------------------
  function compareVersions(a, b) {
    var pa = String(a || '0').split('.').map(Number);
    var pb = String(b || '0').split('.').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }
  function checkForApkUpdate() {
    if (platform !== 'android') return;
    var latest = String(systemConfig.ApkVersiTerbaru || '').trim();
    var link = String(systemConfig.ApkTautanUnduh || '').trim();
    if (!latest || !/^https:\/\//i.test(link) || compareVersions(latest, config.buildVersion) <= 0) return;
    try { if (sessionStorage.getItem('tt2-update-dismissed') === latest) return; } catch (ignore) {}
    if (document.getElementById('tt2UpdateBanner')) return;
    var banner = document.createElement('div');
    banner.id = 'tt2UpdateBanner';
    banner.className = 'tt2-update-banner';
    banner.setAttribute('role', 'status');
    var text = document.createElement('button');
    text.type = 'button';
    text.className = 'tt2-update-text';
    text.textContent = '⬆️ Versi ' + latest + ' tersedia (Anda memakai ' + config.buildVersion + '). Ketuk untuk mengunduh.';
    text.onclick = function () { openExternal(link); };
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'tt2-update-close';
    close.setAttribute('aria-label', 'Tutup pemberitahuan pembaruan');
    close.textContent = '✕';
    close.onclick = function () {
      banner.remove();
      try { sessionStorage.setItem('tt2-update-dismissed', latest); } catch (ignore) {}
    };
    banner.appendChild(text); banner.appendChild(close);
    document.body.appendChild(banner);
  }

  // -----------------------------------------------------------------
  // Pemberitahuan mode offline (dipanggil tt2-remote.js)
  // -----------------------------------------------------------------
  var offlineNoticeShown = false;
  function showOfflineNotice(savedAt) {
    if (offlineNoticeShown) return;
    offlineNoticeShown = true;
    var note = document.createElement('div');
    note.className = 'tt2-offline-note';
    note.setAttribute('role', 'status');
    var when = savedAt ? new Date(savedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    note.textContent = '📴 Tidak ada koneksi. Menampilkan data tersimpan' + (when ? ' (' + when + ')' : '') + '.';
    document.body.appendChild(note);
    setTimeout(function () { note.remove(); offlineNoticeShown = false; }, 6000);
  }

  window.TT2Shell = {
    isNative: isNative,
    platform: platform,
    openExternal: openExternal,
    showOfflineNotice: showOfflineNotice,
    exitApp: function () {
      var appPlugin = plugin('App');
      if (appPlugin && appPlugin.exitApp) appPlugin.exitApp();
    }
  };

  // -----------------------------------------------------------------
  // Service worker (PWA saja; di APK berkas sudah ada di dalam aplikasi)
  // -----------------------------------------------------------------
  if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('Service worker gagal didaftarkan', err); });
    });
  }

  // -----------------------------------------------------------------
  // Urutan mulai
  // -----------------------------------------------------------------
  window.addEventListener('load', function () {
    if (!window.TT2Remote || !window.TT2Remote.enabled) {
      showStartupError('Alamat server belum diatur di build aplikasi.');
      return;
    }
    var cached = window.tt2CachedBootstrap;
    if (cached) {
      applyBootstrap(cached);
      startApp();
    }
    window.TT2Remote.call('getBootstrap', []).then(function (fresh) {
      saveBootstrap(fresh);
      applyBootstrap(fresh);
      startApp();
      checkForApkUpdate();
    }, function (err) {
      if (!cached) showStartupError(String(err && err.message || 'Server tidak dapat dihubungi.'));
    });
  });
})();
