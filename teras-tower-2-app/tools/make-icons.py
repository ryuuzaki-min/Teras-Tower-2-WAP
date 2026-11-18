"""Membuat semua ikon & splash dari resources/logo.png (latar transparan).
Pemakaian: python3 -I tools/make-icons.py <folder proyek>
Lalu jalankan `npm run assets` untuk ikon/splash Android (dilakukan juga di workflow)."""
import sys
from PIL import Image
root = sys.argv[1]
logo = Image.open(f'{root}/resources/logo.png').convert('RGBA')
WHITE, LIGHT, DARK = (255, 255, 255), (243, 253, 255), (11, 42, 51)

def place(size, scale, bg=None):
    canvas = Image.new('RGBA', (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    w = int(size * scale); h = int(w * logo.height / logo.width)
    if h > size * scale:
        h = int(size * scale); w = int(h * logo.width / logo.height)
    img = logo.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(img, ((size - w) // 2, (size - h) // 2))
    return canvas

# Web / PWA
place(1024, 0.90, WHITE).resize((192, 192), Image.LANCZOS).save(f'{root}/web/icons/icon-192.png')
place(1024, 0.90, WHITE).resize((512, 512), Image.LANCZOS).save(f'{root}/web/icons/icon-512.png')
place(1024, 0.66, WHITE).resize((512, 512), Image.LANCZOS).save(f'{root}/web/icons/icon-maskable-512.png')
place(1024, 0.86, WHITE).convert('RGB').resize((180, 180), Image.LANCZOS).save(f'{root}/web/icons/apple-touch-icon.png')
logo.resize((480, int(480 * logo.height / logo.width)), Image.LANCZOS).save(f'{root}/web/icons/logo.png')
# Sumber @capacitor/assets (Android)
place(1024, 0.90, WHITE).convert('RGB').save(f'{root}/resources/icon-only.png')
place(1024, 0.62).save(f'{root}/resources/icon-foreground.png')          # zona aman ikon adaptif ±66%
Image.new('RGB', (1024, 1024), WHITE).save(f'{root}/resources/icon-background.png')
place(2732, 0.34, LIGHT).convert('RGB').save(f'{root}/resources/splash.png')
place(2732, 0.34, DARK).convert('RGB').save(f'{root}/resources/splash-dark.png')
print('ikon & splash dibuat dari resources/logo.png')
