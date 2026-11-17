# Panduan Penerapan v11 — dari Apps Script ke APK

Repo: https://github.com/ryuuzaki-min/Teras-Tower-2-WAP
Web App: URL `/exec` sudah tertulis di `app.config.json`.

Urutan ini penting: Apps Script diperbarui lebih dulu, karena aplikasi memanggil
`doPost` dan `getBootstrap` yang baru ada di v11. Tanpa langkah 1, APK akan
menampilkan "Belum bisa terhubung".

## 1. Perbarui Apps Script (versi web tetap jalan)

1. Buat salinan spreadsheet sebagai cadangan.
2. Di editor Apps Script, ganti isi `Code.gs`, `Index.html`, `JavaScript.html`,
   `Style.html` dengan berkas di folder `gas/`.
3. **Terapkan (Deploy) > Kelola deployment > ikon pensil pada deployment yang dipakai sekarang >
   Versi: Versi baru > Terapkan.** Jangan membuat deployment baru, agar URL `/exec` tetap sama.
4. Pastikan **Jalankan sebagai: Saya** dan **Yang memiliki akses: Siapa saja**.
5. Buka versi web, login sebagai warga dan admin; semua fitur harus berjalan seperti biasa.

Yang berubah di backend:

| Perubahan | Dampak |
| --- | --- |
| Sheet `SesiAplikasi` (tersembunyi) dibuat otomatis | Sesi "Ingat saya" bertahan 30 hari sejak terakhir dipakai. Isinya hanya hash token. Jangan disunting. |
| Tanpa "Ingat saya" | Sesi 6 jam, seperti sebelumnya. |
| Reset PIN / cabut admin | Tetap langsung mengakhiri semua sesi akun itu. |
| Registrasi & lupa PIN maks. 30/jam | Mencegah pembuatan akun massal. |
| SystemConfig `RegistrasiDibuka` = `false` | Menutup pendaftaran akun baru. Kosong = dibuka. |
| SystemConfig `ApkVersiTerbaru`, `ApkTautanUnduh` | Memunculkan pemberitahuan "Versi baru tersedia" di APK lama. |
| `doPost` + `getBootstrap` | Pintu untuk aplikasi. Hanya 70 fungsi di `TT2_API_NAMES` yang bisa dipanggil. |

Bila menambah fungsi server baru yang dipanggil klien, tambahkan namanya di `TT2_API_NAMES`.

## 2. Simpan kunci tanda tangan di GitHub Secrets (sekali)

Repo ini **public**, jadi kunci TIDAK boleh diunggah ke repo (berbeda dengan launcher yang private).

1. Buka berkas `RAHASIA-kunci-APK-TerasTower2.txt`.
2. Di GitHub: **Settings > Secrets and variables > Actions > New repository secret**.
3. Buat 4 secret sesuai nama dan isi di berkas itu: `TT2_KEY_ALIAS`, `TT2_KEYSTORE_PASSWORD`,
   `TT2_KEY_PASSWORD`, `TT2_KEYSTORE_BASE64`.
4. Simpan berkas `.txt` dan `terastower2.keystore` di dua tempat aman. Jangan dibagikan.

## 3. Unggah proyek

### Dari HP (tanpa laptop)

1. **Add file > Create new file**. Di kolom nama ketik `.github/workflows/build-apk.yml`
   (garis miring otomatis membuat folder). Tempel isi berkas `build-apk.yml` dari zip. **Commit changes**.
2. Ulangi untuk `.github/workflows/bongkar-zip.yml`.
3. **Add file > Upload files**, pilih `TerasTower2-unggah.zip` (satu file saja). **Commit changes**.
4. Buka tab **Actions**: "Bongkar zip unggahan" berjalan, lalu otomatis menjalankan "Build APK & PWA".

Isi folder `.github/workflows` tidak bisa diubah lewat zip (aturan keamanan GitHub). Bila
workflow perlu diubah, sunting langsung di github.com.

### Dari komputer

Ekstrak zip proyek, lalu seret seluruh isinya (termasuk folder `.github`) ke **Upload files**.

## 4. Build pertama & GitHub Pages

- Hasil build: tab **Actions > Build APK & PWA > (run terbaru) > Artifacts**.
  Nama berakhiran `-UJI-COBA` berarti secret kunci belum terbaca.
- Versi iPhone: **Settings > Pages > Source: GitHub Actions**, lalu jalankan ulang build.
  Alamatnya `https://ryuuzaki-min.github.io/Teras-Tower-2-WAP/`.

## 5. Rilis ke warga

1. Ubah `version` di `package.json` (mis. `1.0.0`).
2. **Releases > Draft a new release > Choose a tag** `v1.0.0` > **Publish release**.
   Workflow menolak bila tag dan versi berbeda.
3. APK + `.sha256` otomatis terlampir di rilis tersebut.
4. Isi SystemConfig `ApkVersiTerbaru` dan `ApkTautanUnduh` (tautan halaman rilis).
5. Ikuti checklist di dokumen Lynk.id.

## 6. Mengganti logo

Ganti `resources/logo.png` (latar transparan), jalankan `npm run icons` lalu commit
`web/icons/` dan `resources/`. Ikon dan splash Android dibuat ulang otomatis setiap build.

## 7. Tahap berikutnya

- Push notification (butuh Firebase/FCM).
- Versi App Store/TestFlight (butuh akun Apple Developer).
- Token CSS tahap 2 (blok CSS lama) dan mode gelap.
