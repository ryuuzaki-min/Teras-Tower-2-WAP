// ===================================================================
// prepare-android.mjs — menyiapkan proyek Android di GitHub Actions
// -------------------------------------------------------------------
// Folder android/ TIDAK disimpan di repo (agar unggahan lewat HP ringan).
// Workflow menjalankan `npx cap add android`, lalu skrip ini menambahkan:
//   • versionCode/versionName dari variabel lingkungan
//   • tanda tangan rilis dari GitHub Secrets
//   • firebase/google-services.json -> android/app (notifikasi push, v12)
//   • ikon notifikasi monokrom ic_stat_tt2 (v12)
// Aman dijalankan berulang (idempoten).
// ===================================================================
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gradlePath = join(root, 'android', 'app', 'build.gradle');
if (!existsSync(gradlePath)) {
  console.error('android/app/build.gradle tidak ada. Jalankan `npx cap add android` dulu.');
  process.exit(1);
}
let gradle = readFileSync(gradlePath, 'utf8');
const MARK = '// TT2: dipersiapkan oleh tools/prepare-android.mjs';

if (!gradle.includes(MARK)) {
  const versionPattern = /versionCode \d+\s*\n\s*versionName "[^"]*"/;
  if (!versionPattern.test(gradle)) throw new Error('Baris versionCode/versionName bawaan tidak ditemukan di build.gradle.');
  gradle = gradle.replace(versionPattern,
    'versionCode((System.getenv("TT2_BUILD_NUMBER") ?: "1").toInteger())\n' +
    '        versionName(System.getenv("TT2_VERSION_NAME") ?: "1.0.0")');

  const buildTypes = '    buildTypes {\n        release {\n';
  if (gradle.split(buildTypes).length !== 2) throw new Error('Blok buildTypes { release { bawaan tidak ditemukan.');
  gradle = gradle.replace(buildTypes,
    '    ' + MARK + '\n' +
    '    // Kunci yang SAMA wajib dipakai setiap versi. Nilai datang dari GitHub Secrets.\n' +
    '    signingConfigs {\n' +
    '        release {\n' +
    '            if (System.getenv("TT2_KEYSTORE_PATH")) {\n' +
    '                storeFile file(System.getenv("TT2_KEYSTORE_PATH"))\n' +
    '                storePassword System.getenv("TT2_KEYSTORE_PASSWORD")\n' +
    '                keyAlias System.getenv("TT2_KEY_ALIAS")\n' +
    '                keyPassword System.getenv("TT2_KEY_PASSWORD")\n' +
    '            }\n' +
    '        }\n' +
    '    }\n' +
    buildTypes +
    '            if (System.getenv("TT2_KEYSTORE_PATH")) {\n' +
    '                signingConfig signingConfigs.release\n' +
    '            }\n');
  writeFileSync(gradlePath, gradle);
  console.log('build.gradle: versi & tanda tangan rilis ditambahkan.');
} else {
  console.log('build.gradle sudah dipersiapkan sebelumnya.');
}

// v12: konfigurasi Firebase untuk notifikasi push.
const servicesSource = join(root, 'firebase', 'google-services.json');
if (existsSync(servicesSource)) {
  const services = JSON.parse(readFileSync(servicesSource, 'utf8'));
  const appId = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8')).appId;
  const packages = (services.client || []).map((c) => c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name);
  if (!packages.includes(appId)) throw new Error(`google-services.json bukan untuk paket ${appId} (isi: ${packages.join(', ')}).`);
  copyFileSync(servicesSource, join(root, 'android', 'app', 'google-services.json'));
  console.log('google-services.json disalin (proyek ' + services.project_info.project_id + ').');
} else {
  console.log('firebase/google-services.json tidak ada: APK dibuat tanpa notifikasi push.');
}

// v12: ikon kecil notifikasi (vektor putih: tiga gedung). Android mewarnainya sendiri.
const drawableDir = join(root, 'android', 'app', 'src', 'main', 'res', 'drawable');
mkdirSync(drawableDir, { recursive: true });
writeFileSync(join(drawableDir, 'ic_stat_tt2.xml'), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF"
        android:pathData="M9,3h6v18h-6z M3,8h5v13h-5z M16,8h5v13h-5z M2,21h20v1.5h-20z"/>
</vector>
`);
console.log('Ikon notifikasi ic_stat_tt2 ditulis.');

// v16: izin lokasi untuk tombol "Pakai lokasi saya" di Jelajah Sekitar.
// Capacitor meneruskan permintaan lokasi WebView ke dialog izin Android bila izin ini ada di manifest.
const manifestPath = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, 'utf8');
  const perms = ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'];
  const missing = perms.filter((p) => !manifest.includes(`android:name="${p}"`));
  if (missing.length) {
    manifest = manifest.replace(/<application\b/, missing.map((p) => `<uses-permission android:name="${p}" />`).join('\n    ') + '\n    <application');
    writeFileSync(manifestPath, manifest);
    console.log('Izin lokasi ditambahkan ke AndroidManifest.xml');
  }

  // v17: matikan cadangan otomatis Android. Token sesi tersimpan di penyimpanan WebView;
  // bila ikut dicadangkan ke Google Drive/pindah HP, sesi bisa berpindah ke perangkat lain.
  manifest = readFileSync(manifestPath, 'utf8');
  const before = manifest;
  if (/android:allowBackup="[^"]*"/.test(manifest)) manifest = manifest.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
  else manifest = manifest.replace(/<application\b/, '<application android:allowBackup="false"');
  // Lalu lintas HTTP polos tidak diizinkan (semua server memakai HTTPS).
  if (/android:usesCleartextTraffic="[^"]*"/.test(manifest)) manifest = manifest.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="false"');
  else manifest = manifest.replace(/<application\b/, '<application android:usesCleartextTraffic="false"');
  if (manifest !== before) { writeFileSync(manifestPath, manifest); console.log('allowBackup dan cleartext dimatikan di AndroidManifest.xml'); }
}
