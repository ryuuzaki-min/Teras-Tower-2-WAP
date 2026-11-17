// ===================================================================
// prepare-android.mjs — menyiapkan proyek Android di GitHub Actions
// -------------------------------------------------------------------
// Folder android/ TIDAK disimpan di repo (agar unggahan lewat HP ringan).
// Workflow menjalankan `npx cap add android`, lalu skrip ini menambahkan:
//   • versionCode/versionName dari variabel lingkungan
//   • tanda tangan rilis dari GitHub Secrets
// Aman dijalankan berulang (idempoten).
// ===================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
