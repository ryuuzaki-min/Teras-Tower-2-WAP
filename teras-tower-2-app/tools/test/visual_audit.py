"""Tangkapan layar audit tampilan (warga & admin) dengan data contoh.
Pemakaian: python3 -I tools/test/visual_audit.py <folder www> <folder keluaran> [#WARNA_TEMA]
"""
import json, os, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

WWW, OUT = sys.argv[1], sys.argv[2]
THEME = sys.argv[3] if len(sys.argv) > 3 else '#19B786'
os.makedirs(OUT, exist_ok=True)
h = functools.partial(SimpleHTTPRequestHandler, directory=WWW); h.log_message = lambda *a: None
srv = ThreadingHTTPServer(('127.0.0.1', 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/' % srv.server_address[1]
BANNER = BASE + 'audit-banner.svg'
with open(os.path.join(WWW, 'audit-banner.svg'), 'w') as f:
    f.write('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="#1d8f6c"/>'
            '<text x="80" y="420" font-family="sans-serif" font-size="96" fill="#fff">Banner contoh (gambar admin)</text></svg>')

ROLE = {'admin': False}
def user():
    return {'username': 'budi', 'name': 'Koordinator Gedung' if ROLE['admin'] else 'Budi Santoso', 'isAdmin': ROLE['admin'], 'isSuperAdmin': False,
            'profileComplete': True, 'sessionToken': 't', 'statusWisma': 'Penghuni BAST', 'lantai': '12', 'unit': '07', 'nomorWhatsApp': '081234567890'}
def answer(fn, args):
    return {
        'getBootstrap': {'appInfo': {'Deskripsi': 'Ruang aspirasi dan layanan warga Tower 2 Wisma Atlet Pademangan.', 'Penutup': 'Pengurus Tower 2'},
                         'systemConfig': {'PrimaryColor': THEME, 'BannerList': json.dumps([{'url': BANNER, 'aktif': True}, {'url': BANNER, 'aktif': True}])},
                         'appUrl': '', 'appVersion': 'v2026-8N-CR.T2-01.2.3'},
        'loginWithPin': {'success': True, 'user': user()},
        'validateSession': {'valid': True},
        'getAppClock': {'epochMs': 1763390000000},
        'getResidentNotificationSummary': {'updates': 2},
        'getPengumumanTerbaru': {'success': True, 'pengumuman': {'judul': 'Air mati sementara', 'isi': 'Air mati Kamis pukul 10.00–14.00 untuk perbaikan pompa.', 'dikirimPada': '2026-11-17T13:00:00Z'}},
        'getRekapKepuasan': {'global': 4.3, 'jumlahResponden': 37},
        'getMyKepuasanThisWeek': [],
        'getKontakData': {'nomorPenting': [{'Nama': 'Pengelola Gedung', 'Nomor': '0215550100', 'Kategori': 'Pengelola'}],
                          'nomorDarurat': [{'Nama': 'Ambulans', 'Nomor': '118', 'Kategori': 'Umum'}, {'Nama': 'Pemadam Kebakaran', 'Nomor': '113', 'Kategori': 'Umum'},
                                           {'Nama': 'Polsek Pademangan', 'Nomor': '0216400000', 'Kategori': 'Keamanan'}]},
        'getRefData': {'Status_Wisma': ['Penghuni BAST', 'Penyewa'], 'Jenis_Aspirasi': ['Pengaduan', 'Masukan/Kritik'], 'Kategori': ['Kebersihan', 'Keamanan', 'Fasilitas'],
                       'LokasiMasalah': ['Area umum', 'Lantai', 'Unit'], 'Lantai': [str(i) for i in range(3, 25)], 'Unit': ['%02d' % i for i in range(1, 46)]},
        'getNotificationSummary': {'aspirasi': 3, 'warga': 1},
        'getPendingWork': {'aspirasi': [], 'resetPin': []},
    }.get(fn)
def route(r):
    b = json.loads(r.request.post_data or '{}')
    r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'result': answer(b['fn'], b.get('args', []))}))

shots = []
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def session(admin):
        ROLE['admin'] = admin
        c = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        c.route('https://script.google.com/**', route)
        pg = c.new_page(); pg.goto(BASE); pg.wait_for_selector('#loginScreen', state='visible'); pg.wait_for_timeout(300)
        return c, pg
    def snap(pg, name, full=False):
        path = os.path.join(OUT, name + '.png'); pg.screenshot(path=path, full_page=full); shots.append(path)

    c, pg = session(False)
    snap(pg, '01-login')
    pg.fill('#loginUsername', 'budi'); pg.fill('#loginPin', '123456'); pg.click('#btnLogin')
    pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(1200)
    snap(pg, '02-beranda-warga', True)
    for name, page in (('03-menu-warga', 'menuUser'), ('04-kontak-darurat', 'kontakDarurat'), ('05-form-aspirasi', 'form'), ('06-profil', 'profil'), ('07-notifikasi-warga', 'notifikasi')):
        pg.evaluate("navigateTo('%s')" % page); pg.wait_for_timeout(700); snap(pg, name, True)
    c.close()
    c, pg = session(True)
    pg.fill('#loginUsername', 'admin'); pg.fill('#loginPin', '123456'); pg.click('#btnLogin')
    pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(1200)
    snap(pg, '08-beranda-admin', True)
    for name, page in (('09-kartu-pengelolaan', 'kartuPengelolaan'), ('10-kirim-pengumuman', 'kelolaPengumuman')):
        pg.evaluate("navigateTo('%s')" % page); pg.wait_for_timeout(700); snap(pg, name, True)
    c.close(); br.close()
srv.shutdown()
os.remove(os.path.join(WWW, 'audit-banner.svg'))
print('\n'.join(shots))
