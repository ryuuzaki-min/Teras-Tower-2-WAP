"""Tangkapan layar SEMUA halaman (warga & admin) untuk audit tampilan.
Pemakaian: python3 -I tools/test/audit_all.py <folder www> <folder keluaran> [#WARNA_TEMA]
Data contoh dibuat seadanya: halaman yang datanya kosong menampilkan keadaan kosongnya.
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

ADMIN = {'v': False}
REC = lambda i, nama, kat, jenis, tags, rating, n, alamat, ver: {
    'id': 'r%d' % i, 'timestamp': '1%d Nov 2026' % i, 'namaPengirim': 'Sari', 'kategori': kat, 'jenis': jenis, 'namaLokasi': nama,
    'tautanMaps': 'https://maps.app.goo.gl/abc%d' % i, 'alamat': alamat, 'keterangan': 'Porsi besar, buka sampai malam.', 'tags': tags,
    'verified': ver, 'ratingAverage': rating, 'ratingCount': n, 'featuredComment': 'Enak dan murah, cocok untuk keluarga.' if n else '',
    'featuredCommentName': 'Budi', 'featuredCommentRating': 5 if n else 0,
    'lat': [-6.1301, -6.1360, -6.1410, -6.1290][i % 4], 'lng': [106.8402, 106.8350, 106.8460, 106.8395][i % 4],
    'jamBuka': '10.00 – 22.00' if i == 1 else '', 'harga': [0, 2, 1, 0][i % 4], 'createdMs': 1763300000000 + i * 86400000,
    'mine': i == 3, 'favorited': i == 1}
JELAJAH = {'success': True, 'tower': {'lat': -6.1330, 'lng': 106.8400}, 'priceLabels': ['', '< Rp15 rb', 'Rp15–30 rb', 'Rp30–50 rb', 'Rp50–100 rb', '> Rp100 rb'],
           'reportReasons': ['Tutup permanen', 'Lokasi salah', 'Info tidak sesuai', 'Lainnya'], 'categories': ['Kuliner', 'Jasa', 'Fasilitas Umum', 'Kesehatan'],
           'allCategories': ['Kuliner', 'Jasa', 'Fasilitas Umum', 'Kesehatan', 'Belanja'],
           'categoryActiveByName': {'Belanja': False},
           'typesByCategory': {'Kuliner': ['Bakso', 'Kopi', 'Nasi Padang', 'Sate'], 'Jasa': ['Bengkel Motor', 'Laundry'], 'Fasilitas Umum': ['Taman Bermain'], 'Kesehatan': ['Apotek', 'Klinik']},
           'allTypesByCategory': {'Kuliner': ['Bakso', 'Kopi', 'Nasi Padang', 'Sate'], 'Jasa': ['Bengkel Motor', 'Laundry'], 'Fasilitas Umum': ['Taman Bermain'], 'Kesehatan': ['Apotek', 'Klinik'], 'Belanja': ['Pasar']},
           'typeActiveByCategory': {}, 'categoryIcons': {'Kuliner': '🍽️', 'Jasa': '🛠️', 'Fasilitas Umum': '🏞️', 'Kesehatan': '🏥', 'Belanja': '🛒'},
           'typeIconsByCategory': {}, 'iconOptions': ['📍', '🍽️'],
           'recommendations': [REC(1, 'Bakso Pak Kumis', 'Kuliner', 'Bakso', 'murah, porsi besar', 4.6, 12, 'Ruko depan gerbang utama', True),
                               REC(2, 'Bakso Solo Mas Joko', 'Kuliner', 'Bakso', 'kuah segar', 4.1, 5, 'Jl. Pademangan Raya', False),
                               REC(3, 'Bakso Urat 88', 'Kuliner', 'Bakso', '', 0, 0, '', False),
                               REC(4, 'Laundry Kilat 24', 'Jasa', 'Laundry', 'antar jemput', 4.5, 9, 'Jl. Pademangan IV', True),
                               REC(5, 'Apotek Sehat Pademangan', 'Kesehatan', 'Apotek', '24 jam', 0, 0, '', False)]}
REVIEWS = {'success': True, 'recommendation': JELAJAH['recommendations'][0], 'ratingAverage': 4.6, 'ratingCount': 12,
           'comments': [{'nama': 'Budi', 'rating': 5, 'komentar': 'Enak dan murah, cocok untuk keluarga.', 'tanggal': '17 Nov 2026'},
                        {'nama': 'Rina', 'rating': 4, 'komentar': 'Antre saat jam makan siang.', 'tanggal': '16 Nov 2026'}], 'ownReview': None}

def user():
    return {'username': 'budi', 'name': 'Koordinator Gedung' if ADMIN['v'] else 'Budi Santoso', 'isAdmin': ADMIN['v'], 'isSuperAdmin': ADMIN['v'],
            'profileComplete': True, 'sessionToken': 't', 'statusWisma': 'Penghuni BAST', 'lantai': '12', 'unit': '07', 'nomorWhatsApp': '081234567890'}
def answer(fn, args):
    table = {
        'getBootstrap': {'appInfo': {'Deskripsi': 'Ruang aspirasi dan layanan warga Tower 2 Wisma Atlet Pademangan.', 'Penutup': 'Pengurus Tower 2'},
                         'systemConfig': {'PrimaryColor': THEME}, 'appUrl': '', 'appVersion': 'v2026-8N-CR.T2-01.3.0'},
        'loginWithPin': {'success': True, 'user': user()}, 'validateSession': {'valid': True},
        'getResidentNotificationSummary': {'updates': 1}, 'getNotificationSummary': {'aspirasi': 2, 'kepuasan': 1, 'kapasitas': {'level': 'waspada', 'percent': 78.4, 'usedCells': 7840000, 'limitCells': 10000000, 'largest': 'Data Aspirasi'}},
        'getPengumumanTerbaru': {'success': True, 'pengumuman': None},
        'getRekapKepuasan': {'global': 4.3, 'jumlahResponden': 37}, 'getMyKepuasanThisWeek': [],
        'getKontakData': {'nomorPenting': [{'Nama': 'Pengelola Gedung', 'Nomor': '0215550100', 'Kategori': 'Pengelola'}, {'Nama': 'Satpam Tower 2', 'Nomor': '081200001111', 'Kategori': 'Keamanan'}, {'Nama': 'Teknisi Lift', 'Nomor': '081200002222', 'Kategori': ''}],
                          'nomorDarurat': [{'Nama': 'Ambulans', 'Nomor': '118', 'Kategori': 'Umum'}, {'Nama': 'Pemadam Kebakaran', 'Nomor': '113', 'Kategori': 'Umum'}]},
        'getNomorPenting': [{'Nama': 'Pengelola Gedung', 'Nomor': '0215550100', 'Kategori': 'Pengelola'}],
        'getNomorDarurat': [{'Nama': 'Ambulans', 'Nomor': '118', 'Kategori': 'Umum'}],
        'getRefData': {'Status_Wisma': ['Penghuni BAST', 'Penyewa'], 'Jenis_Aspirasi': ['Pengaduan', 'Masukan/Kritik'], 'Kategori': ['Kebersihan', 'Keamanan', 'Fasilitas'],
                       'LokasiMasalah': ['Area umum', 'Lantai', 'Unit'], 'Lantai': [str(i) for i in range(3, 25)], 'Unit': ['%02d' % i for i in range(1, 46)]},
        'getJelajahSekitar': JELAJAH, 'getJelajahReviews': REVIEWS,
        'searchJelajahPlaces': {'success': True, 'results': [{'nama': 'Bakso Pak Kumis', 'alamat': 'Jl. Pademangan Raya No.12, Jakarta Utara', 'lat': -6.1301, 'lng': 106.8402, 'placeId': 'P1', 'tempat': True, 'jarak': 350},
                                                              {'nama': 'Bakso Kumis Cabang Ancol', 'alamat': 'Jl. Lodan Raya', 'lat': -6.1260, 'lng': 106.8300, 'placeId': 'P2', 'tempat': True, 'jarak': 1300}]},
        'getKelolaJelajah': dict(JELAJAH, recommendations=[dict(r, statusVerifikasi='Terverifikasi' if r['verified'] else 'Menunggu', statusRekomendasi='Aktif', username='sari') for r in JELAJAH['recommendations']], categories=JELAJAH['allCategories'], typesByCategory=JELAJAH['allTypesByCategory'],
                                 reports=[{'id': 'LAP-1', 'recommendationId': 'r2', 'namaLokasi': 'Bakso Solo Mas Joko', 'alasan': 'Tutup permanen', 'catatan': 'Sudah pindah ke ruko sebelah', 'pelapor': 'Rina', 'tanggal': '18 Nov 2026'}], missingCoords=3), 'getPengumumanAdmin': {'success': True, 'daftar': [], 'perangkat': 12, 'pushAktif': True},
        'getAppClock': {'epochMs': 1763390000000},
        'getAgendaCalendar': {'success': True, 'year': 2026, 'month': 12, 'events': [], 'isAdmin': ADMIN['v'], 'serverToday': '2026-12-18',
                              'holidays': [{'date': '2026-12-22', 'name': 'Hari Ibu', 'type': 'peringatan'}, {'date': '2026-12-24', 'name': 'Cuti Bersama Natal', 'type': 'libur'}, {'date': '2026-12-25', 'name': 'Hari Raya Natal', 'type': 'libur'},
                                            {'date': '2026-12-01', 'name': 'Hari AIDS Sedunia', 'type': 'internasional'}, {'date': '2026-12-03', 'name': 'Hari Penyandang Disabilitas Internasional', 'type': 'internasional'}, {'date': '2026-12-10', 'name': 'Hari Hak Asasi Manusia', 'type': 'internasional'}]},
        'getFaq': {'success': True, 'canEdit': ADMIN['v'], 'editableRoles': ['warga', 'admin', 'super'] if ADMIN['v'] else ['warga'], 'items': [
            {'id': 'bawaan-1', 'bagian': 'Mengenal aplikasi', 'peran': 'warga', 'pertanyaan': 'Apa itu Teras Tower 2?', 'jawaban': 'Aplikasi warga Tower 2.', 'urutan': 1},
            {'id': 'bawaan-2', 'bagian': 'Mengenal aplikasi', 'peran': 'warga', 'pertanyaan': 'Apa saja isi menu bawah?', 'jawaban': 'Kontak Darurat, Aspirasi, Menu.', 'urutan': 2},
            {'id': 'bawaan-3', 'bagian': 'Akun & masuk', 'peran': 'warga', 'pertanyaan': 'Saya lupa PIN. Apa yang harus dilakukan?', 'jawaban': 'Tekan Lupa PIN.', 'urutan': 3}] + ([
            {'id': 'bawaan-4', 'bagian': 'Untuk Admin', 'peran': 'admin', 'pertanyaan': 'Bagaimana mereset PIN warga?', 'jawaban': 'Kelola Warga.', 'urutan': 4},
            {'id': 'bawaan-5', 'bagian': 'Untuk Super Admin', 'peran': 'super', 'pertanyaan': 'Apa isi Kelola Aplikasi?', 'jawaban': 'Empat tab.', 'urutan': 5}] if ADMIN['v'] else [])},
        'getStorageInfo': {'level': 'waspada', 'percent': 78.4, 'usedCells': 7840000, 'limitCells': 10000000, 'freeCells': 2160000, 'checkedAt': '18 November 2026', 'largest': 'Data Aspirasi',
                           'sheets': [{'name': 'Data Aspirasi', 'dataRows': 4210, 'columns': 30, 'rowsAvailable': 73800}, {'name': 'WargaBaru', 'dataRows': 312, 'columns': 22, 'rowsAvailable': 98800}, {'name': 'Kepuasan', 'dataRows': 1800, 'columns': 8, 'rowsAvailable': 270100}]},
    }
    if fn in table: return table[fn]
    return {'success': True, 'data': [], 'items': [], 'rows': [], 'list': []}
import base64
LEAFLET_DIR = '/tmp/lf/package/dist'
TILE = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48+cPAAWQAsfBeZ/rAAAAAElFTkSuQmCC')
def route_static(r):
    url = r.request.url
    if 'unpkg.com/leaflet' in url:
        name = url.split('/dist/')[1].split('?')[0]
        path = os.path.join(LEAFLET_DIR, name)
        if os.path.exists(path):
            r.fulfill(status=200, body=open(path, 'rb').read(), content_type='text/css' if name.endswith('.css') else 'application/javascript', headers={'Access-Control-Allow-Origin': '*'}); return
        r.fulfill(status=404, body=b''); return
    r.fulfill(status=200, body=TILE, content_type='image/png', headers={'Access-Control-Allow-Origin': '*'})
def route(r):
    b = json.loads(r.request.post_data or '{}')
    r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'result': answer(b['fn'], b.get('args', []))}))

RESIDENT = ['beranda', 'menuUser', 'form', 'riwayat', 'notifikasi', 'kontakDarurat', 'kontakPenting', 'kepuasan', 'kalenderKerja', 'jelajahSekitar', 'profil', 'feedback', 'kartuPribadi']
ADMINP = ['admin', 'kartuPengelolaan', 'kelolaWarga', 'kelolaAdmin', 'kelolaAgenda', 'kelolaJelajah', 'kelolaKepuasan', 'kelolaNomorDarurat', 'kelolaNomorPenting', 'kelolaPengumuman', 'logPengelolaan', 'customized', 'diagnostics']
errors = []
with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for admin, pages in ((False, RESIDENT), (True, ADMINP)):
        ADMIN['v'] = admin
        c = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        c.route('https://script.google.com/**', route)
        c.route('https://unpkg.com/**', route_static); c.route('https://tile.openstreetmap.org/**', route_static); c.route('https://*.basemaps.cartocdn.com/**', route_static)
        pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector('#loginScreen', state='visible')
        pg.fill('#loginUsername', 'budi'); pg.fill('#loginPin', '123456'); pg.click('#btnLogin')
        pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(900)
        for i, page in enumerate(pages):
            pg.evaluate("document.querySelectorAll('#appDialogOverlay,.jelajah-modal-overlay').forEach(e=>e.remove())")
            pg.evaluate("navigateTo('%s')" % page); pg.wait_for_timeout(900)
            name = ('A' if admin else 'W') + '%02d-%s' % (i + 1, page)
            pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=True)
            if page == 'jelajahSekitar':
                pg.click('.jl-cat >> nth=0'); pg.wait_for_timeout(300)
                pg.screenshot(path=os.path.join(OUT, name + '-2-hasil.png'), full_page=True)
                pg.click('.jl-card >> nth=0'); pg.wait_for_timeout(900)
                pg.screenshot(path=os.path.join(OUT, name + '-3-detail.png'))
                pg.evaluate("document.querySelectorAll('.jelajah-modal-overlay').forEach(e=>e.remove())")
                pg.evaluate("startJelajahNew()"); pg.wait_for_timeout(700)
                pg.fill('#jelajahPlaceQuery', 'bakso pak kumis'); pg.click('.jl-search-btn'); pg.wait_for_timeout(400)
                pg.click('.jl-place >> nth=0'); pg.wait_for_timeout(400)
                pg.screenshot(path=os.path.join(OUT, name + '-4-lokasi.png'), full_page=True)
                pg.click('#jelajahPickNext'); pg.wait_for_timeout(300)
                pg.screenshot(path=os.path.join(OUT, name + '-5-info.png'), full_page=True)
            if page == 'kelolaJelajah':
                pg.evaluate("setKelolaJelajahTab('laporan')"); pg.wait_for_timeout(300)
                pg.screenshot(path=os.path.join(OUT, name + '-2-laporan.png'), full_page=True)
                pg.evaluate("setKelolaJelajahTab('pengaturan')"); pg.wait_for_timeout(900)
                pg.screenshot(path=os.path.join(OUT, name + '-3-pengaturan.png'), full_page=True)
        c.close()
    br.close()
srv.shutdown()
print('errors:', errors[:5])
print(len(os.listdir(OUT)), 'tangkapan')
