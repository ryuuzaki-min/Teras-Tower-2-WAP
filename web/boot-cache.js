/* ===================================================================
 * boot-cache.js — pengganti blok <script> berisi scriptlet di Index.html
 * -------------------------------------------------------------------
 * Di versi web, doGet menyisipkan systemConfig/appUrl/appVersion langsung
 * ke halaman. Di aplikasi terpasang, nilai terakhir dari server dibaca dari
 * penyimpanan perangkat supaya tema dan teks langsung tampil tanpa menunggu
 * jaringan. app-shell.js lalu menyegarkannya dari server di latar belakang.
 * Harus dimuat SEBELUM app.js (app.js memanggil applyTheme() saat dimuat).
 * =================================================================== */
var currentUser = null;
var systemConfig = {};
var appUrl = '';
var appVersion = '0';
var TT2_BOOTSTRAP_KEY = 'tt2-bootstrap';
var tt2CachedBootstrap = null;
try {
  tt2CachedBootstrap = JSON.parse(localStorage.getItem(TT2_BOOTSTRAP_KEY) || 'null');
  if (tt2CachedBootstrap) {
    systemConfig = tt2CachedBootstrap.systemConfig || {};
    appUrl = tt2CachedBootstrap.appUrl || '';
    appVersion = tt2CachedBootstrap.appVersion || '0';
  }
} catch (ignore) { tt2CachedBootstrap = null; }
