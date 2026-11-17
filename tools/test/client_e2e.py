"""Uji ujung-ke-ujung build www/ di Chrome headless dengan backend tiruan.

Semua POST ke script.google.com dicegat dan dijawab tiruan, sehingga yang
diuji adalah jalur aplikasi terpasang: bootstrap, login, sesi, navigasi Back,
sesi kedaluwarsa, dan data offline. Tangkapan layar disimpan untuk diperiksa.

Pemakaian: python3 -I tools/test/client_e2e.py <folder www> <folder keluaran>
"""
import json
import os
import sys
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

WWW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

handler = functools.partial(SimpleHTTPRequestHandler, directory=WWW)
handler.log_message = lambda *a: None
server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/' % server.server_address[1]

state = {'calls': [], 'expire': False, 'offline': False}
USER = {'username': 'budi', 'name': 'Budi Santoso', 'isAdmin': False, 'isSuperAdmin': False,
        'statusWisma': 'Penghuni BAST', 'lantai': '12', 'unit': '1207', 'nomorWhatsApp': '6281234567890',
        'profileComplete': True, 'sessionToken': 'tok-123', 'sessionPersistent': True}
BOOT = {'appInfo': {'Deskripsi': 'Selamat datang warga Tower 2 (uji).', 'Penutup': 'Pengurus Tower 2'},
        'systemConfig': {}, 'appUrl': 'https://script.google.com/macros/s/AKfycbTEST_example-123/exec',
        'appVersion': 'uji-11', 'serverTime': 0}


def answer(fn, args):
    if state['expire'] and fn not in ('getBootstrap', 'loginWithPin', 'validateSession', 'logoutSession'):
        return {'ok': False, 'error': 'Sesi kedaluwarsa. Silakan login kembali.'}
    table = {
        'getBootstrap': BOOT,
        'loginWithPin': {'success': True, 'user': USER},
        'validateSession': {'valid': True, 'username': 'budi', 'role': 'resident'},
        'logoutSession': {'success': True},
        'getAppClock': {'epochMs': 1763355600000, 'timeZone': 'Asia/Jakarta', 'today': '2026-11-17'},
        'getResidentNotificationSummary': {'updates': 0},
        'getKontakData': {'nomorPenting': [{'Nama': 'Pengelola Gedung', 'Nomor': '0215550100'}],
                          'nomorDarurat': [{'Nama': 'Ambulans', 'Nomor': '118', 'Kategori': 'Umum'}, {'Nama': 'Pemadam', 'Nomor': '113', 'Kategori': 'Umum'},
                                         {'Nama': 'RSUD Pademangan', 'Nomor': '0216400000', 'Kategori': 'Rumah Sakit'}]},
        'getRefData': {'Status_Wisma': ['Penghuni BAST'], 'Jenis_Aspirasi': ['Pengaduan', 'Masukan/Kritik'],
                       'Kategori': ['Kebersihan', 'Keamanan'], 'LokasiMasalah': ['Area umum', 'Lantai', 'Unit', 'Tidak diketahui'],
                       'Lantai': [str(i) for i in range(3, 25)], 'Unit': ['%02d' % i for i in range(1, 46)]},
        'getRekapKepuasan': {'global': 4.2, 'jumlahResponden': 12},
        'getMyKepuasanThisWeek': [],
        'getAgendaCalendar': {'events': []},
    }
    return {'ok': True, 'result': table.get(fn, None)}


def route_api(route):
    if state['offline']:
        route.abort('internetdisconnected')
        return
    body = json.loads(route.request.post_data or '{}')
    state['calls'].append(body)
    route.fulfill(status=200, content_type='application/json', body=json.dumps(answer(body.get('fn'), body.get('args'))))


results = []
def check(name, condition, detail=''):
    results.append((name, bool(condition), detail))
    print(('  ✓ ' if condition else '  ✗ ') + name + ('' if condition else '  — ' + str(detail)))


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    context.route('https://script.google.com/**', route_api)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

    print('Klien (www/) di Chrome headless')
    page.goto(BASE)
    page.wait_for_selector('#loginScreen', state='visible')
    page.wait_for_timeout(300)
    check('splash hilang & layar login tampil', page.locator('#tt2Splash').count() == 0)
    check('teks Deskripsi dari bootstrap terisi', 'uji' in page.inner_text('.prolog-text'))
    check('TT2Remote aktif (bukan google.script.run)', page.evaluate('window.TT2Remote.enabled === true'))
    check('riwayat navigasi aktif di aplikasi', page.evaluate('appHistory.enabled === true'))
    page.screenshot(path=os.path.join(OUT, '01-login.png'))

    page.evaluate("document.documentElement.style.setProperty('--safe-area-inset-top', '30px')")
    check('area aman Android (Capacitor) menggeser header', page.evaluate("getComputedStyle(document.querySelector('.app-header')).paddingTop") == '44px',
          page.evaluate("getComputedStyle(document.querySelector('.app-header')).paddingTop"))
    page.evaluate("document.documentElement.style.removeProperty('--safe-area-inset-top')")
    page.fill('#loginUsername', 'budi')
    page.fill('#loginPin', '123456')
    page.click('#btnLogin')
    page.wait_for_selector('#mainScreen', state='visible')
    page.wait_for_timeout(500)
    login_calls = [c for c in state['calls'] if c['fn'] == 'loginWithPin']
    check('login mengirim remember:true ke server', login_calls and login_calls[-1]['args'][0].get('remember') is True, login_calls)
    check('sesi tersimpan di localStorage (Ingat saya)', page.evaluate("!!localStorage.getItem('teras_tower_user')"))
    page.screenshot(path=os.path.join(OUT, '02-beranda.png'))

    page.click('#bottomNavUser [data-page="kontakDarurat"]')
    page.wait_for_timeout(500)
    check('pindah ke Kontak Darurat', page.evaluate('currentPage') == 'kontakDarurat')
    page.screenshot(path=os.path.join(OUT, '03-kontak-darurat.png'))
    page.click('#bottomNavUser [data-page="menuUser"]')
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(OUT, '04-menu.png'))
    check('kartu Menu menampilkan keterangan di layar sentuh',
          page.evaluate("(() => { const el = document.querySelector('.user-menu-card-detail'); return !!el && getComputedStyle(el).display !== 'none'; })()"))

    page.go_back()
    page.wait_for_timeout(400)
    check('Back: Menu -> Kontak Darurat', page.evaluate('currentPage') == 'kontakDarurat', page.evaluate('currentPage'))
    page.go_back()
    page.wait_for_timeout(400)
    check('Back: Kontak Darurat -> Beranda', page.evaluate('currentPage') == 'beranda', page.evaluate('currentPage'))

    page.click('#bottomNavUser [data-page="kontakDarurat"]')
    page.wait_for_timeout(400)
    page.evaluate("showAppNotice('Uji dialog', 'success')")
    page.go_back()
    page.wait_for_timeout(400)
    check('Back saat dialog terbuka: dialog tertutup, halaman tetap',
          page.locator('#appDialogOverlay').count() == 0 and page.evaluate('currentPage') == 'kontakDarurat')
    page.go_back()
    page.wait_for_timeout(400)
    check('Back berikutnya kembali ke Beranda', page.evaluate('currentPage') == 'beranda', page.evaluate('currentPage'))

    # Data offline: Kontak Darurat sudah pernah dimuat -> tetap tampil tanpa sinyal.
    state['offline'] = True
    page.click('#bottomNavUser [data-page="kontakDarurat"]')
    page.wait_for_timeout(700)
    text = page.inner_text('#pageContent')
    check('offline: Kontak Darurat tampil dari data tersimpan', 'Ambulans' in text, text[:120])
    check('offline: pemberitahuan data tersimpan muncul', page.locator('.tt2-offline-note').count() == 1)
    page.screenshot(path=os.path.join(OUT, '05-offline-kontak.png'))
    state['offline'] = False
    page.wait_for_timeout(200)

    # Sesi kedaluwarsa di tengah pemakaian -> kembali ke login dengan pesan jelas.
    state['expire'] = True
    page.click('#bottomNavUser [data-page="menuUser"]')
    page.evaluate("navigateTo('riwayat')")
    page.wait_for_timeout(700)
    check('sesi kedaluwarsa: kembali ke layar login', page.locator('#loginScreen').is_visible())
    check('sesi kedaluwarsa: pesan "Sesi Anda sudah berakhir"', 'sudah berakhir' in (page.inner_text('#appDialogOverlay') if page.locator('#appDialogOverlay').count() else ''))
    check('sesi kedaluwarsa: sesi lokal dihapus', page.evaluate("localStorage.getItem('teras_tower_user') === null"))
    page.screenshot(path=os.path.join(OUT, '06-sesi-berakhir.png'))
    state['expire'] = False

    # Buka ulang aplikasi tanpa jaringan tapi dengan bootstrap tersimpan -> tetap terbuka cepat.
    state['offline'] = True
    page.reload()
    page.wait_for_selector('#loginScreen', state='visible', timeout=5000)
    check('buka ulang tanpa sinyal: layar login tetap tampil dari cache', page.locator('#tt2Splash').count() == 0)
    state['offline'] = False

    # Halaman pertama kali dibuka tanpa sinyal dan tanpa cache -> pesan jelas + tombol Coba lagi.
    fresh = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
    fresh.route('https://script.google.com/**', lambda r: r.abort('internetdisconnected'))
    pg2 = fresh.new_page()
    pg2.goto(BASE)
    pg2.wait_for_timeout(1200)
    splash = pg2.inner_text('#tt2Splash') if pg2.locator('#tt2Splash').count() else ''
    check('pertama kali tanpa sinyal: pesan "Belum bisa terhubung"', 'Belum bisa terhubung' in splash, splash)
    pg2.screenshot(path=os.path.join(OUT, '07-pertama-offline.png'))

    # Log yang memang diharapkan: koneksi diputus sengaja, dan handler bawaan yang
    # mencatat penolakan sesi kedaluwarsa (skenario uji). Selain itu = error sungguhan.
    expected = ('internetdisconnected', 'ERR_INTERNET_DISCONNECTED', 'Failed to load resource', 'Sesi kedaluwarsa', 'Permintaan server gagal')
    real_errors = [e for e in errors if not any(x in e for x in expected)]
    check('tidak ada error JavaScript', not real_errors, real_errors[:5])
    browser.close()

server.shutdown()
failed = [r for r in results if not r[1]]
print('\n%d/%d uji klien lulus' % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
