"""Uji v12 di Chrome headless: notifikasi push (Capacitor tiruan), pengumuman, batas profil.
Pemakaian: python3 -I tools/test/push_e2e.py <folder www> <folder tangkapan layar>
"""
import json, os, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

WWW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
h = functools.partial(SimpleHTTPRequestHandler, directory=WWW); h.log_message = lambda *a: None
srv = ThreadingHTTPServer(('127.0.0.1', 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/' % srv.server_address[1]

# Capacitor tiruan: plugin PushNotifications merekam panggilan dan bisa memicu event.
FAKE_CAP = r"""
window.__push = { calls: [], listeners: {}, permission: 'prompt' };
const P = {
  addListener(name, fn) { (window.__push.listeners[name] = window.__push.listeners[name] || []).push(fn); window.__push.calls.push('addListener:' + name); return Promise.resolve({ remove(){} }); },
  createChannel(opts) { window.__push.calls.push('createChannel:' + opts.id + ':' + opts.importance); return Promise.resolve(); },
  checkPermissions() { window.__push.calls.push('checkPermissions'); return Promise.resolve({ receive: window.__push.permission }); },
  requestPermissions() { window.__push.calls.push('requestPermissions'); window.__push.permission = 'granted'; return Promise.resolve({ receive: 'granted' }); },
  register() { window.__push.calls.push('register'); setTimeout(() => (window.__push.listeners.registration || []).forEach(f => f({ value: 'fcmTOKENabcdefghijklmnopqrstuvwxyz123' })), 50); return Promise.resolve(); }
};
window.__fire = function (name, payload) { (window.__push.listeners[name] || []).forEach(f => f(payload)); };
window.__opened = [];
const AL = { openUrl(o) { window.__opened.push(o.url); return Promise.resolve({ completed: true }); } };
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { PushNotifications: P, AppLauncher: AL } };
"""

state = {'calls': [], 'role': 'resident', 'profileComplete': True, 'pengumuman': None, 'sent': []}
def user():
    return {'username': 'budi', 'name': 'Budi', 'isAdmin': state['role'] != 'resident', 'isSuperAdmin': False,
            'profileComplete': state['profileComplete'], 'sessionToken': 'tok-1',
            'profileDeadline': '' if state['profileComplete'] else '2026-11-24T05:00:00.000Z'}
def answer(fn, args):
    if fn == 'getBootstrap': return {'appInfo': {'Deskripsi': 'x', 'Penutup': ''}, 'systemConfig': {}, 'appUrl': '', 'appVersion': '12'}
    if fn == 'loginWithPin': return {'success': True, 'user': user()}
    if fn == 'getPengumumanTerbaru': return {'success': True, 'pengumuman': state['pengumuman']}
    if fn == 'getPengumumanAdmin': return {'success': True, 'daftar': state['sent'], 'perangkat': 3, 'pushAktif': True}
    if fn == 'sendPengumuman':
        item = {'id': 'P1', 'dikirimPada': '2026-11-17T14:00:00.000Z', 'judul': args[0]['judul'], 'isi': args[0]['isi'], 'oleh': 'budi', 'perangkat': 3}
        state['sent'].insert(0, item)
        return {'success': True, 'perangkat': 3, 'pushAktif': True}
    if fn in ('registerPushToken', 'unregisterPushToken', 'logoutSession'): return {'success': True}
    if fn == 'getRefData': return {'Status_Wisma': ['Penghuni'], 'Lantai': ['12'], 'Unit': ['07']}
    if fn == 'getRekapKepuasan': return {'global': 4.2}
    if fn == 'getResidentNotificationSummary': return {'updates': 0}
    return None
def route(r):
    body = json.loads(r.request.post_data or '{}')
    state['calls'].append(body['fn'])
    r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'result': answer(body['fn'], body.get('args', []))}))

results = []
def check(name, cond, detail=''):
    results.append(bool(cond)); print(('  ✓ ' if cond else '  ✗ ') + name + ('' if cond else '  — ' + str(detail)))

def login(pg):
    pg.goto(BASE); pg.wait_for_selector('#loginScreen', state='visible')
    pg.fill('#loginUsername', 'budi'); pg.fill('#loginPin', '123456'); pg.click('#btnLogin')

print('v12 di Chrome headless')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def ctx():
        c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        c.add_init_script(FAKE_CAP); c.route('https://script.google.com/**', route); return c
    errors = []

    # 1. Warga: izin -> register -> token ke server; pengumuman di Beranda
    state['pengumuman'] = {'id': 'P0', 'dikirimPada': '2026-11-17T13:00:00.000Z', 'judul': 'Air mati sementara',
                           'isi': 'Air mati pukul 10.00–14.00 untuk perbaikan pompa.', 'oleh': 'pengurus', 'perangkat': 40}
    c = ctx(); pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    login(pg); pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(1200)
    calls = pg.evaluate('window.__push.calls')
    check('listener push dipasang saat aplikasi dibuka', 'addListener:pushNotificationActionPerformed' in calls)
    check('kanal notifikasi dibuat (penting)', 'createChannel:tt2_umum:4' in calls, calls)
    check('izin diminta lalu perangkat didaftarkan', calls.index('requestPermissions') < calls.index('register'), calls)
    check('token dikirim ke server', 'registerPushToken' in state['calls'], state['calls'])
    check('kartu pengumuman tampil di Beranda', 'Air mati sementara' in pg.inner_text('#homePengumuman'))
    pg.screenshot(path=os.path.join(OUT, 'v12-01-beranda-pengumuman.png'))

    # 2. Notifikasi datang saat aplikasi dibuka -> pesan di dalam aplikasi
    pg.evaluate("window.__fire('pushNotificationReceived', { title: 'Agenda baru Tower 2', body: 'Kerja bakti — 20/11/2026' })")
    pg.wait_for_timeout(300)
    check('notifikasi saat aplikasi terbuka tampil di dalam aplikasi', 'Kerja bakti' in (pg.inner_text('#appDialogOverlay') if pg.locator('#appDialogOverlay').count() else ''))
    pg.evaluate("document.querySelectorAll('#appDialogOverlay').forEach(e => e.remove())")

    # 3. Ketuk notifikasi -> buka halaman tujuan
    pg.evaluate("window.__fire('pushNotificationActionPerformed', { notification: { data: { page: 'riwayat' } } })")
    pg.wait_for_timeout(400)
    check('ketuk notifikasi membuka Riwayat Saya', pg.evaluate('currentPage') == 'riwayat', pg.evaluate('currentPage'))

    # 3b. Notifikasi versi baru membawa tautan -> buka unduhan, bukan halaman
    apk = 'https://github.com/ryuuzaki-min/Teras-Tower-2-WAP/releases/latest/download/TerasTower2.apk'
    pg.evaluate("window.__fire('pushNotificationActionPerformed', { notification: { data: { page: 'beranda', url: '%s' } } })" % apk)
    pg.wait_for_timeout(300)
    check('ketuk notifikasi versi baru membuka tautan unduhan APK', pg.evaluate('window.__opened') == [apk] and pg.evaluate('currentPage') == 'riwayat', pg.evaluate('window.__opened'))

    # 4. Logout: token dilepas SEBELUM sesi diakhiri
    state['calls'].clear()
    pg.evaluate('logoutApp()'); pg.wait_for_timeout(200)
    pg.click('#appDialogOverlay .app-dialog-confirm') if pg.locator('#appDialogOverlay .app-dialog-confirm').count() else pg.locator('#appDialogOverlay button').last.click()
    pg.wait_for_timeout(600)
    seq = [x for x in state['calls'] if x in ('unregisterPushToken', 'logoutSession')]
    check('logout: unregisterPushToken lalu logoutSession', seq == ['unregisterPushToken', 'logoutSession'], seq)
    c.close()

    # 5. Ketuk notifikasi saat aplikasi tertutup (sebelum login) -> dibuka setelah login
    c = ctx(); pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('#loginScreen', state='visible')
    pg.evaluate("window.__fire('pushNotificationActionPerformed', { notification: { data: { page: 'kalenderKerja' } } })")
    pg.fill('#loginUsername', 'budi'); pg.fill('#loginPin', '123456'); pg.click('#btnLogin')
    pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(1600)
    check('notifikasi diketuk sebelum login: halaman dibuka setelah login', pg.evaluate('currentPage') == 'kalenderKerja', pg.evaluate('currentPage'))
    c.close()

    # 6. Izin ditolak -> tidak register, aplikasi tetap jalan
    c = ctx(); c.add_init_script("window.__push && (window.__push.permission = 'denied')"); pg = c.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    state['calls'].clear()
    login(pg); pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(1000)
    check('izin ditolak: tidak mendaftar, tanpa error', 'register' not in pg.evaluate('window.__push.calls') and 'registerPushToken' not in state['calls'])
    c.close()

    # 7. Admin: halaman Kirim Pengumuman
    state['role'] = 'admin'; state['sent'] = []
    c = ctx(); pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    login(pg); pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(600)
    pg.evaluate("navigateTo('kartuPengelolaan')"); pg.wait_for_timeout(300)
    check('kartu "Kirim Pengumuman" ada di Kartu Pengelolaan', 'Kirim Pengumuman' in pg.inner_text('#pageContent'))
    pg.evaluate("navigateTo('kelolaPengumuman')"); pg.wait_for_timeout(400)
    pg.fill('#pengumumanJudul', 'Lift B diperbaiki'); pg.fill('#pengumumanIsi', 'Lift B tidak beroperasi hari ini pukul 09.00–15.00.')
    check('penghitung karakter berjalan', pg.inner_text('#pengumumanJudulCount') == '17', pg.inner_text('#pengumumanJudulCount'))
    pg.click('#pengumumanKirim'); pg.wait_for_timeout(200)
    check('konfirmasi sebelum mengirim', 'tidak bisa ditarik kembali' in pg.inner_text('#appDialogOverlay'))
    pg.locator('#appDialogOverlay button').last.click(); pg.wait_for_timeout(600)
    check('pengumuman terkirim & muncul di riwayat', 'Lift B diperbaiki' in pg.inner_text('#pengumumanDaftar'), pg.inner_text('#pengumumanDaftar')[:100])
    pg.evaluate("document.querySelectorAll('#appDialogOverlay').forEach(e => e.remove())")
    pg.screenshot(path=os.path.join(OUT, 'v12-02-kirim-pengumuman.png'), full_page=True)
    c.close()

    # 8. Warga biasa tidak bisa membuka halaman admin
    state['role'] = 'resident'
    c = ctx(); pg = c.new_page(); login(pg); pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(500)
    pg.evaluate("navigateTo('kelolaPengumuman')"); pg.wait_for_timeout(300)
    check('warga diarahkan ke Beranda dari halaman admin', pg.evaluate('currentPage') == 'beranda')
    c.close()

    # 9. Profil belum lengkap -> batas waktu ditampilkan
    state['profileComplete'] = False
    c = ctx(); pg = c.new_page(); login(pg); pg.wait_for_selector('#profileScreen', state='visible'); pg.wait_for_timeout(400)
    text = pg.inner_text('#appDialogOverlay') if pg.locator('#appDialogOverlay').count() else ''
    check('profil belum lengkap: batas waktu & peringatan hapus otomatis', '24 November 2026' in text and 'dihapus otomatis' in text, text)
    pg.screenshot(path=os.path.join(OUT, 'v12-03-batas-profil.png'))
    c.close()

    check('tidak ada error JavaScript', not errors, errors[:3])
    b.close()
srv.shutdown()
print('\n%d/%d uji v12 klien lulus' % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
