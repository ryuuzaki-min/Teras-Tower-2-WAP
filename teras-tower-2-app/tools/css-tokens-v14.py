"""Satu kali jalan: token warna tahap 2 (v14) untuk gas/Style.html.

1. Token bawaan yang lolos kontras: --color-primary-deep (teks) dan --color-primary-strong
   (latar tombol dengan teks putih). applyTheme() menghitung ulang keduanya dari warna admin.
2. Tombol/tab berlatar warna tema dengan teks putih memakai --color-primary-strong.
3. Warna hex di CSS lama (sebelum blok Jelajah) diganti token SESUAI KONTEKS:
   - properti teks (color)       -> token teks yang lolos kontras
   - properti latar (background)  -> token latar
   - properti garis (border)      -> token garis
   Warna biru informasi (hue 200-260) dan nilai yang tidak cocok kategori mana pun dibiarkan.

Pemakaian: python3 -I tools/css-tokens-v14.py gas/Style.html [--report laporan.txt]
"""
import colorsys
import re
import sys

path = sys.argv[1]
report_path = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
css = open(path, encoding='utf-8').read()
if '--color-primary-strong' in css:
    sys.exit('Token v14 sudah diterapkan; tidak dijalankan ulang.')
report = []

# 1. Token bawaan (dihitung untuk warna bawaan #27CCF5 dengan rumus yang sama seperti applyTheme)
old = '    --color-primary-deep: #0E9CBF;\n'
assert css.count(old) == 1
css = css.replace(old, '    --color-primary-deep: #187C95;    /* teks tema, kontras >= 4,8:1 (dihitung ulang applyTheme) */\n'
                       '    --color-primary-strong: #187E98;  /* latar tombol + teks putih, kontras >= 4,5:1 */\n')

# 2. Latar tombol/tab bertulisan putih
strong_rules = ['.btn-primary', '.kepuasan-link', '.radio-option.selected', '.status-tab.active', '.jelajah-tab.active']
count_strong = 0
def strongify(match):
    global count_strong
    selector, decl = match.group(1), match.group(2)
    if selector.strip() in strong_rules and re.search(r'background(-color)?\s*:\s*var\(--color-primary\)', decl):
        count_strong += 1
        decl = re.sub(r'(background(?:-color)?\s*:\s*)var\(--color-primary\)', r'\1var(--color-primary-strong)', decl)
    return selector + '{' + decl + '}'
css = re.sub(r'([^{}]+)\{([^{}]*)\}', strongify, css)
report.append('Latar tombol/tab teks putih -> --color-primary-strong: %d aturan' % count_strong)


def hls(hexcode):
    h = hexcode[1:]
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    return hue * 360, sat, light


def family(hexcode):
    hue, s, l = hls(hexcode)
    if s < 0.35:
        return 'neutral', l
    if hue <= 12 or hue >= 350:
        return 'red', l
    if 15 <= hue <= 46:
        return 'amber', l
    if 120 <= hue < 158:
        return 'green', l
    if 158 <= hue <= 200:
        return 'teal', l
    return 'other', l   # biru informasi dll.: dibiarkan


def token(prop, hexcode):
    fam, l = family(hexcode)
    hue, sat, _ = hls(hexcode)
    # Teks abu-kebiruan gelap (saturasi rendah-sedang) tetap teks netral, bukan warna tema;
    # teks biru informasi (hue > 190) dibiarkan biru.
    if prop in ('color', 'fill', 'stroke') and fam == 'teal' and (sat < 0.5 or hue > 190):
        if hue > 190 and sat >= 0.5:
            return None
        fam = 'neutral'
    if prop in ('color', 'fill', 'stroke'):
        if fam == 'neutral':
            if l >= 0.99:
                return None                      # teks putih di atas warna: dibiarkan
            return '--color-text-strong' if l < 0.30 else '--color-text' if l < 0.45 else '--color-text-muted'
        dark = {'red': ('--color-danger', 0.6), 'amber': ('--color-warning', 0.5), 'green': ('--color-success', 0.5), 'teal': ('--color-primary-deep', 0.5)}
        if fam in dark and l < dark[fam][1]:
            return dark[fam][0]
        return None
    if prop.startswith('background'):
        if fam == 'neutral':
            return '--color-surface' if l >= 0.995 else '--color-surface-muted' if l >= 0.9 else None
        if fam == 'red':
            return '--color-danger-bg' if l >= 0.9 else '--color-danger' if l < 0.6 else None
        if fam == 'amber':
            return '--color-warning-bg' if l >= 0.9 else None
        if fam == 'green':
            return '--color-success-bg' if l >= 0.9 else '--color-success' if l < 0.5 else None
        if fam == 'teal':
            return '--color-pastel-100' if l >= 0.955 else '--color-pastel-200' if l >= 0.9 else '--color-pastel-300' if l >= 0.75 else '--color-primary-deep' if l < 0.45 else None
        return None
    if prop.startswith('border') or prop.startswith('outline'):
        if fam == 'neutral':
            if l >= 0.99:
                return None                      # garis putih (cincin lencana dll.): dibiarkan
            return '--color-border' if l >= 0.75 else None
        light = {'red': '--color-danger-border', 'amber': '--color-warning-border', 'green': '--color-success-border', 'teal': '--color-pastel-300'}
        darkb = {'red': '--color-danger', 'green': '--color-success', 'teal': '--color-primary-deep'}
        if fam in light and l >= 0.75:
            return light[fam]
        if fam in darkb and l < 0.5:
            return darkb[fam]
        return None
    return None


start = css.index('/* ===== v11 TOKENS')
start = css.index('}', start)
end = css.index('/* Jelajah Sekitar — no-key Google Maps link workflow */')
block = css[start:end]
changes = {}
kept = {}


def map_decl(match):
    prop, value = match.group(1).lower(), match.group(2)
    def swap(hm):
        hexcode = hm.group(0).lower()
        tok = token(prop, hexcode)
        if tok:
            changes.setdefault(prop.split('-')[0] + ':' + tok, set()).add(hexcode)
            return 'var(' + tok + ')'
        kept.setdefault(prop, set()).add(hexcode)
        return hm.group(0)
    return match.group(1) + ':' + re.sub(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b', swap, value)


new_block = re.sub(r'([a-zA-Z-]+)\s*:([^;{}]+)', map_decl, block)
css = css[:start] + new_block + css[end:]
total = sum(len(v) for v in changes.values())
report.append('CSS lama: warna diganti token sesuai konteks (%d warna berbeda):' % total)
for key in sorted(changes):
    report.append('  %-34s <- %s' % (key, ' '.join(sorted(changes[key]))))
report.append('Dibiarkan (sengaja): ' + '; '.join('%s: %s' % (k, ' '.join(sorted(v))) for k, v in sorted(kept.items())))

open(path, 'w', encoding='utf-8').write(css)
print('\n'.join(report))
if report_path:
    open(report_path, 'w', encoding='utf-8').write('\n'.join(report) + '\n')
