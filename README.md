# Teras Tower 2 — Aplikasi Android, iPhone & Web (v12)

Satu sumber kode untuk tiga cara pakai:

| Cara pakai | Dari mana | Dibangun oleh |
| --- | --- | --- |
| Web Apps Script (seperti sekarang) | `gas/` disalin ke proyek Apps Script | Manual (salin + deploy) |
| APK Android | `gas/` → `www/` → `android/` (dibuat otomatis) | GitHub Actions |
| iPhone / PWA | `gas/` → `www/` → GitHub Pages | GitHub Actions |

Fitur cukup diubah di `gas/`. Build aplikasi mengambil berkas yang sama.

## Isi folder

```
gas/                 Code.gs, Index.html, JavaScript.html, Style.html (sumber utama)
web/                 Lapisan aplikasi terpasang: tt2-remote.js, boot-cache.js,
                     app-shell.js, sw.js, manifest, ikon
tools/build-web.mjs  gas/ + web/ -> www/
tools/css-tokens.py  Skrip satu kali yang menerapkan token CSS v11 (sudah dijalankan)
tools/test/          Uji backend (Node), uji ujung-ke-ujung (Chrome headless)
app.config.json      URL Web App Apps Script (/exec)
firebase/            google-services.json (notifikasi push Android)
resources/           Logo + sumber ikon & splash
tools/prepare-android.mjs  Menyiapkan android/ di GitHub Actions
.github/workflows/   build-apk.yml (APK + PWA), bongkar-zip.yml (unggah dari HP)
docs/                Panduan penerapan & laporan
```

## Perintah

```
npm ci
npm test                                   # uji backend (v11 + v12)
npm run build:web                          # URL dari app.config.json
npx cap add android && node tools/prepare-android.mjs && npm run assets && npx cap sync android
npm run icons                              # ikon web & sumber Android dari resources/logo.png
```

Langkah lengkap: `docs/PANDUAN-PENERAPAN.md`.
