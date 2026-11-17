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
4. SystemConfig `ApkVersiTerbaru`/`ApkTautanUnduh` dan notifikasi "versi baru" diisi otomatis
   oleh workflow (bagian 8). Tidak perlu diisi manual.
5. Ikuti checklist di dokumen Lynk.id.

Nama tag harus `v` + versi, tanpa titik di antaranya: `v1.1.0` benar, `v.1.1.0` ditolak.

## 6. Mengganti logo

Ganti `resources/logo.png` (latar transparan), jalankan `npm run icons` lalu commit
`web/icons/` dan `resources/`. Ikon dan splash Android dibuat ulang otomatis setiap build.

## 7. Pembaruan v12 — notifikasi push & pembersihan akun

Urutan wajib:

1. **Apps Script:** ganti 4 berkas dengan isi folder `gas/` (v12).
2. **Kunci Firebase (rahasia):** Firebase Console > ikon gerigi > Project settings > tab
   **Service accounts** > **Generate new private key**. Buka file JSON yang terunduh, salin SELURUH isinya.
   Di editor Apps Script: **Project Settings** (gerigi kiri) > **Script Properties** > **Add script property**:
   - Property: `FCM_SERVICE_ACCOUNT`
   - Value: tempel seluruh isi JSON tadi
   Simpan. Jangan kirim file ini ke chat, repo, atau grup.
3. **Aktifkan otomatisasi:** di editor, pilih fungsi `aktifkanOtomatisasiTT2` di menu atas lalu
   klik **Jalankan**. Setujui izin baru (layanan eksternal & pemicu). Log eksekusi harus berbunyi
   `... Notifikasi push: tersambung ke proyek teras-tower-2-cd033.`
4. **Deploy:** Kelola deployment > Edit > **Versi baru** > Terapkan (URL tetap).
5. **APK 1.1.0:** unggah zip pembaruan seperti biasa, lalu buat rilis bertag `v1.1.0`.
   Warga memasang APK 1.1.0 di atas versi lama dan mengizinkan notifikasi saat diminta.

### Notifikasi yang dikirim

| Kejadian | Penerima | Ketuk membuka |
| --- | --- | --- |
| Aspirasi baru masuk | Semua admin | Kelola Aspirasi |
| Status aspirasi berubah (Dibaca/Diselesaikan/Ditolak) | Warga pengirim | Riwayat Saya |
| Agenda baru dibuat / usulan agenda disetujui | Semua | Kalender Kerja |
| Pengumuman dari Kartu Pengelolaan > Kirim Pengumuman | Semua | Beranda |
| Pengingat hari ke-5 profil belum lengkap | Warga tersebut | Profil |

Pengumuman juga tampil di Beranda selama 3 hari, untuk warga tanpa APK. Batas 10 pengumuman per jam.
Teks notifikasi aspirasi dibuat umum (tanpa nama/isi) karena tampil di layar kunci.

### Pembersihan akun

- Setiap hari ±02.00 WIB: akun warga dengan profil belum lengkap 7 hari setelah daftar dihapus.
- Admin/SuperAdmin dan akun berprofil lengkap tidak pernah disentuh.
- Akun lama tanpa tanggal daftar diberi tanggal saat pembersihan pertama, jadi tetap mendapat 7 hari.
- Akun yang dihapus disalin utuh ke sheet tersembunyi `ArsipAkunDihapus` (bisa dipulihkan manual).
- Saat login, warga berprofil belum lengkap melihat tanggal batasnya.
- SystemConfig `PembersihanAkun`: `aktif` (bawaan), `uji` (hanya dicatat di log, tidak menghapus), `mati`.
  Bila ingin melihat dulu siapa yang akan terhapus, isi `uji` selama seminggu, cek Log Pengelolaan
  (aksi `CLEANUP_UJI`), lalu ubah ke `aktif`.

Sheet baru (dibuat otomatis): `PushTokens` (tersembunyi), `Pengumuman`, `ArsipAkunDihapus` (tersembunyi).

## 8. Pembaruan v13 — rilis otomatis & satu tautan unduhan

**Tautan unduhan tetap (selamanya, selalu versi terbaru):**
`https://github.com/ryuuzaki-min/Teras-Tower-2-WAP/releases/latest/download/TerasTower2.apk`

Setiap rilis bertag `vX.Y.Z` kini otomatis:
1. melampirkan `TerasTower2.apk` (nama tetap) selain file bernomor versi;
2. menulis `ApkVersiTerbaru` dan `ApkTautanUnduh` di SystemConfig;
3. mengirim notifikasi "Versi baru Teras Tower 2" ke semua HP Android, warga dan admin.
   Ketuk notifikasi = langsung mengunduh APK. Spanduk di dalam aplikasi tetap muncul
   untuk yang menolak notifikasi.

Pengaturan sekali (kata sandi rilis ada di berkas RAHASIA):
1. Apps Script > Project Settings > Script Properties > tambah `RELEASE_SECRET`.
2. GitHub > Settings > Secrets and variables > Actions > New repository secret `TT2_RELEASE_SECRET`,
   isi SAMA dengan langkah 1.
3. Ganti `.github/workflows/build-apk.yml` dengan versi v13 (edit di github.com, tempel seluruh isi).
4. Ganti 4 berkas Apps Script dengan `gas/` v13, lalu deploy **Versi baru**.

GitHub tidak memegang akun Google siapa pun; ia hanya tahu kata sandi rilis. Kata sandi itu hanya
bisa mencatat versi yang lebih baru dan tidak bisa mengubah tautan unduhan.

## 9. Serah terima bila pengelola berganti

Tidak ada yang perlu menyerahkan email atau kata sandi pribadinya. Setiap layanan bisa
memindahkan kepemilikan ke akun lain:

| Layanan | Cara memindahkan |
| --- | --- |
| Spreadsheet + Apps Script | Bagikan spreadsheet ke akun baru sebagai Editor, lalu **Bagikan > (nama akun baru) > Transfer kepemilikan**. Apps Script yang terikat ikut pindah, termasuk Script Properties. |
| Pemicu & deployment | Pemicu milik akun lama berhenti saat aksesnya dicabut. Akun baru menjalankan `aktifkanOtomatisasiTT2` dan men-deploy versi baru. Bila URL `/exec` berubah, perbarui `app.config.json` lalu rilis APK baru. |
| GitHub | Repo > Settings > **Transfer ownership** ke akun/organisasi baru. Periksa tab Secrets; isi ulang dari berkas RAHASIA bila kosong. Perbarui `APK_DOWNLOAD_URL` di Code.gs dan tautan Lynk.id bila nama pemilik berubah. |
| Firebase | Project settings > **Users and permissions** > tambah akun baru sebagai Owner. |
| Kunci APK | Serahkan `terastower2.keystore` dan berkas RAHASIA lewat jalur aman (flashdisk / Drive akun pengurus). |

Saran: buat sekarang satu akun Google dan satu akun GitHub khusus "Pengurus Tower 2", pindahkan
semuanya ke sana, dan pakai akun pribadi hanya sebagai admin tambahan. Serah terima berikutnya
cukup mengganti siapa yang memegang akun pengurus itu.

## 10. Tahap berikutnya

- Notifikasi push untuk versi iPhone/PWA (Web Push, iOS 16.4+).
- Versi App Store/TestFlight (butuh akun Apple Developer).
- Token CSS tahap 2 (blok CSS lama) dan mode gelap.
