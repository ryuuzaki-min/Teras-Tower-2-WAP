// ===================================================================
// build-web.mjs — membuat folder www/ (aplikasi terpasang & PWA) dari
// sumber Apps Script yang SAMA (gas/Index.html, Style.html, JavaScript.html).
//
// Jadi cukup satu sumber: perbaiki fitur di gas/, lalu build ulang. Versi web
// Apps Script tetap dipasang seperti biasa (salin gas/*.gs dan gas/*.html).
//
// Pemakaian:
//   node tools/build-web.mjs            (URL dari app.config.json)
//   TT2_API_URL="https://.../exec" node tools/build-web.mjs   (menimpa URL)
// Variabel opsional:
//   TT2_BUILD_NUMBER  (bawaan 1)  — dipakai sebagai versionCode Android
// Versi aplikasi (versionName) diambil dari package.json.
// ===================================================================
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gas = join(root, 'gas');
const web = join(root, 'web');
const out = join(root, 'www');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// URL Web App: variabel TT2_API_URL (bila diisi) atau app.config.json di repo.
// URL ini bukan rahasia: siapa pun yang membuka APK bisa melihatnya.
const fileConfig = existsSync(join(root, 'app.config.json')) ? JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8')) : {};
const apiUrl = String(process.env.TT2_API_URL || fileConfig.apiUrl || '').trim();
const buildNumber = Number(process.env.TT2_BUILD_NUMBER || 1);
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(apiUrl)) {
  console.error('URL Web App belum diisi (app.config.json atau TT2_API_URL) atau bukan URL Apps Script (.../exec).');
  process.exit(1);
}
if (!Number.isInteger(buildNumber) || buildNumber < 1) {
  console.error('TT2_BUILD_NUMBER harus bilangan bulat >= 1.');
  process.exit(1);
}

function read(name) { return readFileSync(join(gas, name), 'utf8'); }
function replaceOnce(text, search, replacement, label) {
  const count = text.split(search).length - 1;
  if (count !== 1) throw new Error(`Penanda "${label}" ditemukan ${count} kali di Index.html (harus tepat 1).`);
  return text.replace(search, replacement);
}
function unwrap(text, tag) {
  const open = text.indexOf(`<${tag}>`);
  const close = text.lastIndexOf(`</${tag}>`);
  if (open < 0 || close < 0) throw new Error(`Tag <${tag}> tidak ditemukan`);
  return text.slice(open + tag.length + 2, close);
}

// 1. CSS dan JS dipisah dari pembungkus HTML Apps Script.
const css = unwrap(read('Style.html'), 'style');
const js = unwrap(read('JavaScript.html'), 'script');

// 2. Index.html: ganti scriptlet Apps Script dengan versi statis.
let html = read('Index.html');
html = replaceOnce(html, '  <base target="_top">\n', '', 'base target');
html = replaceOnce(html, '<meta name="viewport" content="width=device-width, initial-scale=1">',
  [
    '<meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '  <title>Teras Tower 2</title>',
    '  <meta name="theme-color" content="#0E9CBF">',
    '  <meta name="description" content="Aplikasi warga Tower 2 Wisma Atlet Pademangan">',
    '  <meta name="apple-mobile-web-app-capable" content="yes">',
    '  <meta name="mobile-web-app-capable" content="yes">',
    '  <meta name="apple-mobile-web-app-title" content="Teras T2">',
    '  <meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '  <link rel="manifest" href="manifest.webmanifest">',
    '  <link rel="icon" href="icons/icon-192.png">',
    '  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
  ].join('\n'), 'viewport');
html = replaceOnce(html, "<?!= include('Style'); ?>", '<link rel="stylesheet" href="style.css">', 'include Style');
html = replaceOnce(html, '<?= appInfo.Deskripsi ?>', '<span data-appinfo="Deskripsi"></span>', 'appInfo.Deskripsi');
html = replaceOnce(html, "<?= appInfo.Penutup ? appInfo.Penutup : '' ?>", '<span data-appinfo="Penutup"></span>', 'appInfo.Penutup');
html = html.replace(/  <script>\s*var currentUser = null;[\s\S]*?<\/script>\n/, (block) => {
  if (!block.includes('appVersion')) throw new Error('Blok variabel awal tidak sesuai dugaan.');
  return '  <script src="config.js"></script>\n  <script src="boot-cache.js"></script>\n  <script src="tt2-remote.js"></script>\n';
});
html = replaceOnce(html, "<?!= include('JavaScript'); ?>",
  '<script src="app.js"></script>\n  <script src="app-shell.js"></script>', 'include JavaScript');
html = replaceOnce(html, '<body>\n',
  '<body>\n  <div id="tt2Splash" class="tt2-splash" role="status" aria-live="polite"><div class="tt2-splash-box">' +
  '<img class="tt2-splash-logo" src="icons/logo.png" alt="Teras Tower 2 — Wisma Atlet Pademangan"><div class="tt2-splash-spinner" aria-hidden="true"></div>' +
  '<div class="tt2-splash-text">Menyiapkan aplikasi…</div></div></div>\n', 'body');
if (/<\?/.test(html)) throw new Error('Masih ada scriptlet Apps Script (<? ... ?>) di Index.html hasil build.');
if (!html.includes('config.js')) throw new Error('Blok variabel awal tidak terganti.');

// 3. Tulis www/.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(web, out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'style.css'), css);
writeFileSync(join(out, 'app.js'), js);
writeFileSync(join(out, 'config.js'),
  '// Dibuat otomatis oleh tools/build-web.mjs — jangan disunting manual.\n' +
  'window.TT2_CONFIG = ' + JSON.stringify({ apiUrl, buildVersion: pkg.version, buildNumber }, null, 2) + ';\n');

// 4. Service worker: versi cache berdasarkan isi berkas, agar pembaruan PWA terbaca.
const shellFiles = ['icons/logo.png', 'index.html', 'style.css', 'app.js', 'config.js', 'boot-cache.js', 'tt2-remote.js', 'app-shell.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
for (const f of shellFiles) if (!existsSync(join(out, f))) throw new Error('Berkas wajib tidak ada di www/: ' + f);
const hash = createHash('sha256');
for (const f of shellFiles) hash.update(readFileSync(join(out, f)));
const swPath = join(out, 'sw.js');
const sw = readFileSync(swPath, 'utf8')
  .replace('__CACHE_VERSION__', hash.digest('hex').slice(0, 12))
  .replace('__SHELL_FILES__', JSON.stringify(['./'].concat(shellFiles)));
if (sw.includes('__CACHE_VERSION__') || sw.includes('__SHELL_FILES__')) throw new Error('Penanda sw.js tidak terganti.');
writeFileSync(swPath, sw);

console.log(`www/ siap — versi ${pkg.version} (build ${buildNumber}), API ${apiUrl.replace(/\/s\/(.{6}).*\/exec$/, '/s/$1…/exec')}`);
