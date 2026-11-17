"""Satu kali jalan: menerapkan token desain v11 ke gas/Style.html.

Yang dilakukan:
  1. Menambahkan token (warna semantik, ukuran teks, radius, target sentuh) di :root.
  2. Di blok terbaru (Jelajah, Kalender, Perlu Tindakan) mengganti warna hex
     dengan token. Warna teal/hijau-biru aksen diarahkan ke warna tema
     (--color-primary*), sehingga ikut berubah bila admin mengganti tema.
  3. Ukuran huruf 8–9px -> 10px, 10px -> 11px (seluruh berkas).
  4. 100vh diberi cadangan 100dvh (bilah alamat/navigasi HP tidak memotong layar).
  5. Header & tombol kanan atas memperhitungkan area aman (notch/status bar).
  6. Menambahkan blok "v11 sentuh & aplikasi" di akhir.

Pemakaian: python3 -I tools/css-tokens.py gas/Style.html [--report laporan.txt]
Skrip menolak berjalan dua kali (penanda v11 sudah ada).
"""
import colorsys
import re
import sys

path = sys.argv[1]
report_path = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
css = open(path, encoding='utf-8').read()
if 'v11 TOKENS' in css:
    sys.exit('Token v11 sudah diterapkan; tidak dijalankan ulang.')
report = []

TOKENS = """    --bg-image: none;
    /* ===== v11 TOKENS — ubah di sini, berlaku ke seluruh aplikasi ===== */
    --color-surface: #FFFFFF;
    --color-surface-muted: #F2F6F5;
    --color-text-strong: #263F42;
    --color-text: #40585E;
    --color-text-muted: #5F7175;      /* kontras >= 4.5:1 di atas putih */
    --color-border: #DCE9E6;
    --color-danger: #A53E33;
    --color-danger-bg: #FFF2F0;
    --color-danger-border: #EFC9C3;
    --color-warning: #8A5F1A;
    --color-warning-accent: #E5A21A;
    --color-warning-bg: #FFF6E3;
    --color-warning-border: #EFDCB5;
    --color-success: #267A4D;
    --color-success-bg: #E8F6EF;
    --color-success-border: #BFE3D2;
    --fs-2xs: 10px;   /* hanya untuk badge angka */
    --fs-xs: 11px;
    --fs-sm: 12px;
    --fs-md: 14px;
    --fs-lg: 16px;
    --fs-xl: 18px;
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-pill: 999px;
    --tap-min: 44px;  /* target sentuh minimum (pedoman Android 48dp / iOS 44pt) */
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);"""
assert css.count('    --bg-image: none;') == 1
css = css.replace('    --bg-image: none;', TOKENS, 1)


def hls(hexcode):
    h = hexcode[1:]
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    return hue * 360, sat, light


def token_for(hexcode):
    hue, s, l = hls(hexcode)
    if l >= 0.995:
        return '--color-surface'
    if s >= 0.35 and (hue <= 12 or hue >= 350):            # merah: bahaya/ditolak/arsip
        return '--color-danger' if l < 0.6 else ('--color-danger-border' if l < 0.9 else '--color-danger-bg')
    if s >= 0.35 and 15 <= hue <= 46:                       # amber: peringatan/menunggu
        if l < 0.45:
            return '--color-warning'
        if l < 0.78:
            return '--color-warning-accent'
        return '--color-warning-border' if l < 0.9 else '--color-warning-bg'
    if s >= 0.35 and 120 <= hue < 158:                      # hijau: berhasil/terverifikasi
        return '--color-success' if l < 0.5 else ('--color-success-border' if l < 0.9 else '--color-success-bg')
    if s >= 0.35 and 158 <= hue <= 200:                     # teal/biru: aksen -> warna tema
        if l < 0.45:
            return '--color-primary-deep'
        if l < 0.62:
            return '--color-primary'
        if l < 0.77:
            return '--color-primary-soft'
        if l < 0.9:
            return '--color-pastel-300'
        return '--color-pastel-200' if l < 0.955 else '--color-pastel-100'
    # Netral (termasuk netral hangat/kehijauan dengan saturasi rendah)
    if l < 0.30:
        return '--color-text-strong'
    if l < 0.45:
        return '--color-text'
    if l < 0.70:
        return '--color-text-muted'
    if l < 0.915:
        return '--color-border'
    return '--color-surface-muted'


start_marker = '/* Jelajah Sekitar — no-key Google Maps link workflow */'
start = css.index(start_marker)
end = css.rindex('</style>')
block = css[start:end]
counts = {}


def replace_hex(match):
    hexcode = match.group(0)
    token = token_for(hexcode.lower())
    counts.setdefault(token, set()).add(hexcode.lower())
    return 'var(' + token + ')'


new_block, n_hex = re.subn(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', replace_hex, block)
css = css[:start] + new_block + css[end:]
report.append('Blok Jelajah/Kalender/Perlu Tindakan: %d warna hex diganti token' % n_hex)
for token in sorted(counts):
    report.append('  %-26s <- %s' % (token, ' '.join(sorted(counts[token]))))

# 3. Ukuran huruf minimum
n8 = len(re.findall(r'font-size:\s*(8|9)px', css))
css = re.sub(r'font-size:\s*(8|9)px', 'font-size: var(--fs-2xs)', css)
n10 = len(re.findall(r'font-size:\s*10px', css))
css = re.sub(r'font-size:\s*10px', 'font-size: var(--fs-xs)', css)
report.append('Ukuran huruf: %d aturan 8–9px -> 10px, %d aturan 10px -> 11px' % (n8, n10))

# 4. Tinggi layar dinamis
n_vh = len(re.findall(r'min-height:\s*100vh;', css))
css = re.sub(r'min-height:\s*100vh;', 'min-height: 100vh; min-height: 100dvh;', css)
report.append('100vh diberi cadangan 100dvh: %d aturan' % n_vh)

# 5. Area aman atas
pairs = [
    ('    padding: 14px 24px 12px;\n    z-index: 100;',
     '    padding: calc(14px + var(--safe-top)) 24px 12px;\n    z-index: 100;'),
    ('    position: fixed;\n    top: 14px;',
     '    position: fixed;\n    top: calc(14px + var(--safe-top));'),
    ('#mainScreen { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; padding-top: 76px; }',
     '#mainScreen { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; padding-top: calc(76px + var(--safe-top)); }'),
]
for old, new in pairs:
    assert css.count(old) == 1, old
    css = css.replace(old, new, 1)
report.append('Area aman atas: header, tombol kanan atas, dan jarak konten utama')

APPENDIX = """
  /* ===================================================================
     v11 SENTUH & APLIKASI — target sentuh, layar sentuh, elemen aplikasi
     =================================================================== */
  /* Kartu Menu warga: di layar sentuh tidak ada "hover", jadi keterangan
     ditampilkan langsung di bawah judul, bukan sebagai popup. */
  @media (hover: none) {
    .user-menu-card { min-height: 108px; }
    .user-menu-card-detail { display: block; position: static; margin-top: 4px; padding: 0; border: 0;
      background: transparent; box-shadow: none; color: var(--color-text-muted); font-size: var(--fs-xs); line-height: 1.35; }
  }
  /* Layar sentuh: kontrol utama minimal 44px agar mudah disentuh jari. */
  @media (pointer: coarse) {
    .btn-primary, .btn-secondary, .btn-small, select,
    input[type="text"], input[type="password"], input[type="number"], input[type="tel"],
    input[type="date"], input[type="time"], input[type="search"] { min-height: var(--tap-min); }
    .warga-tab, .warga-filter-menu select, .jelajah-map-link, .jelajah-detail-button { min-height: var(--tap-min); }
    .warga-search-control { height: var(--tap-min); }
    .warga-filter-toggle { flex-basis: var(--tap-min); height: calc(var(--tap-min) - 2px); }
    .banner-admin-actions button { width: var(--tap-min); height: 40px; }
    .account-switcher-btn { min-height: var(--tap-min); }
  }

  /* Layar pembuka aplikasi terpasang (dipakai app-shell.js) */
  .tt2-splash { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: var(--color-pastel-100); }
  .tt2-splash-box { width: min(360px, 100%); text-align: center; }
  .tt2-splash-brand { color: var(--color-primary-deep); font-size: 22px; font-weight: 800; letter-spacing: 2px; }
  .tt2-splash-title { margin-bottom: 8px; color: var(--color-text-strong); font-size: var(--fs-xl); font-weight: 700; }
  .tt2-splash-text { margin: 10px 0 18px; color: var(--color-text-muted); font-size: var(--fs-md); line-height: 1.5; }
  .tt2-splash-spinner { width: 34px; height: 34px; margin: 18px auto 0; border: 3px solid var(--color-pastel-300);
    border-top-color: var(--color-primary); border-radius: 50%; animation: tt2spin 0.9s linear infinite; }
  @keyframes tt2spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .tt2-splash-spinner { animation: none; } }

  /* Pemberitahuan versi APK baru */
  .tt2-update-banner { position: fixed; z-index: 3200; left: 50%; transform: translateX(-50%);
    top: calc(8px + var(--safe-top)); width: min(560px, calc(100% - 16px)); display: flex; align-items: stretch;
    border: 1px solid var(--color-warning-border); border-radius: var(--radius-md); background: var(--color-warning-bg);
    box-shadow: 0 6px 20px rgba(0,0,0,0.12); overflow: hidden; }
  .tt2-update-text { flex: 1; min-height: var(--tap-min); padding: 10px 12px; border: 0; background: transparent;
    color: var(--color-warning); font: inherit; font-size: var(--fs-sm); font-weight: 700; text-align: left; cursor: pointer; }
  .tt2-update-close { flex: 0 0 var(--tap-min); border: 0; border-left: 1px solid var(--color-warning-border);
    background: transparent; color: var(--color-warning); font-size: var(--fs-lg); cursor: pointer; }

  /* Pemberitahuan data tersimpan saat offline */
  .tt2-offline-note { position: fixed; z-index: 3100; left: 50%; transform: translateX(-50%);
    bottom: calc(92px + var(--safe-bottom)); width: min(480px, calc(100% - 24px)); padding: 10px 14px;
    border-radius: var(--radius-md); background: var(--color-text-strong); color: var(--color-surface);
    font-size: var(--fs-sm); text-align: center; box-shadow: 0 6px 20px rgba(0,0,0,0.18); }
"""
end = css.rindex('</style>')
css = css[:end] + APPENDIX + css[end:]

open(path, 'w', encoding='utf-8').write(css)
print('\n'.join(report))
if report_path:
    open(report_path, 'w', encoding='utf-8').write('\n'.join(report) + '\n')
