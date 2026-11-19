#!/usr/bin/env python3
"""Pemeriksaan regresi statis Teras Tower 2.
Pakai:  python3 tools/regression_check.py gas
(v17: diperbarui untuk aplikasi APK; berasal dari paket serah terima.)
Butuh: python3 dan node (untuk cek sintaks). Keluar dengan kode 1 jika ada FAIL.
Ini pemeriksaan STATIS: tidak menggantikan uji di Apps Script sungguhan."""
import os, re, subprocess, sys, tempfile
root = sys.argv[1] if len(sys.argv) > 1 else '.'
def rd(n): return open(os.path.join(root, n), encoding='utf-8').read()
src, js, css, idx = rd('Code.gs'), rd('JavaScript.html'), rd('Style.html'), rd('Index.html')
fails, warns = [], []
def ok(c, msg, warn=False):
    if not c: (warns if warn else fails).append(msg)
    print(('  OK   ' if c else ('  WARN ' if warn else '  FAIL ')) + msg)

print('1. Struktur & sintaks')
for name, t in (('Code.gs', src), ('JavaScript.html', js), ('Style.html', css)):
    ok(t.count('{') == t.count('}'), f'brace seimbang {name}')
ok(js.lstrip().startswith('<script>') and js.rstrip().endswith('</script>'), 'JavaScript.html dibungkus <script>')
ok(css.lstrip().startswith('<style>') and css.rstrip().endswith('</style>'), 'Style.html dibungkus <style>')
ok("include('Style')" in idx and "include('JavaScript')" in idx, "Index.html memanggil include('Style') & include('JavaScript')")
def node_check(code, label):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(code); p = f.name
    try:
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        ok(r.returncode == 0, f'sintaks {label}' + ('' if r.returncode == 0 else ': ' + r.stderr.strip()[:200]))
    except FileNotFoundError: ok(False, 'node tidak ditemukan, cek sintaks dilewati', warn=True)
node_check(src, 'Code.gs'); node_check(js.split('<script>', 1)[1].rsplit('</script>', 1)[0], 'JavaScript.html')

print('2. Fungsi publik (RPC) & penjaga')
def body(n):
    m = re.search(r'^function ' + n + r'\(', src, re.M)
    if not m: return ''
    i, d, j = m.start(), 0, src.index('{', m.start())
    for k in range(j, len(src)):
        if src[k] == '{': d += 1
        elif src[k] == '}':
            d -= 1
            if d == 0: return src[i:k+1]
BY_DESIGN = {'doGet', 'include', 'registerUser', 'requestForgotPin', 'loginWithPin', 'getRefData',
             'getRekapKepuasan', 'getKontakData', 'logoutSession', 'validateSession',
             'getBootstrap'}   # v13: data yang sama dengan halaman login
# Fungsi publik yang dijaga dengan cara lain (bukan sesi warga/admin).
OTHER_GUARD = {
    'doPost': ('getApiFunction_(', 'hanya meneruskan ke daftar izin TT2_API_NAMES'),
    'reportApkRelease': ('constantTimeEquals_(', 'dijaga RELEASE_SECRET'),
    'jalankanPembersihanAkunHarian': ('requireTrustedBackgroundCall_(', 'hanya pemicu terjadwal/editor pemilik'),
    'aktifkanOtomatisasiTT2': ('requireTrustedBackgroundCall_(', 'hanya pemicu terjadwal/editor pemilik'),
}
PENDING = set()
for m in re.finditer(r'^function (\w+)\(', src, re.M):
    n = m.group(1)
    if n.endswith('_') or n in BY_DESIGN: continue
    b = body(n)
    if n in OTHER_GUARD:
        needle, why = OTHER_GUARD[n]
        ok(needle in b, f'{n} {why}')
        continue
    guarded = 'requireSession_(' in b or 'requireJelajahAdmin_(' in b or 'requireAgendaAdmin_(' in b
    if n in PENDING: ok(guarded, f'{n} dijaga (temuan terbuka #1)', warn=True)
    else: ok(guarded, f'{n} punya penjaga sesi')
MUST_PRIVATE = ['createSessionUser', 'verifySuperAdmin', 'getKepuasanData', 'setPinForAccount', 'upsertSystemConfigValue',
    'loginRateKey', 'isLoginRateLimited', 'recordLoginFailure', 'clearLoginFailures', 'getNotificationLastSeen',
    'setNotificationLastSeen', 'hashPin', 'makePinHash', 'verifyStoredPin', 'requireSession', 'validateString',
    'validateFilePayload', 'migrateAspirasiStatus8L', 'migrateFloorUnit8O', 'writeApplicationError', 'pruneErrorLog',
    'isAdminUsername', 'isSuperAdmin', 'sheetText', 'requireJelajahAdmin', 'getSheetData', 'getSheet', 'withScriptLock', 'writeAuditLog',
    # v12–v17
    'getFcmAccessToken', 'getFcmConfig', 'queuePush', 'flushPushQueue', 'runAccountCleanup', 'isTrustedBackgroundCall',
    'requireTrustedBackgroundCall', 'findJelajahDuplicate', 'getNomorPentingData', 'getNomorDaruratData', 'takeGeocodeBudget']
wl = re.search(r'const TT2_API_NAMES = \[([\s\S]*?)\];', src)
wl = wl.group(1) if wl else ''
for fn in ('jalankanPembersihanAkunHarian', 'aktifkanOtomatisasiTT2', 'include', 'doGet', 'doPost'):
    ok("'" + fn + "'" not in wl, f'{fn} tidak ada di daftar izin API (doPost)')
for fn in MUST_PRIVATE:
    ok(not re.search(r'^function ' + fn + r'\(', src, re.M), f'{fn} tidak publik (harus berakhiran _)')

print('3. Konfigurasi & perbaikan keamanan yang harus tetap ada')
ok('ALLOWALL' not in src, 'tidak ada XFrameOptionsMode.ALLOWALL')
ok('validateImageSignature_' in src, 'validasi magic bytes upload')
ok(src.count('withScriptLock_') >= 20, f'lock tulis (ditemukan {src.count("withScriptLock_")})')
ok('PIN_HASH_PEPPER' in src, 'pepper PIN (Script Properties)')
ok('bumpSessionVersion_' in src, 'pencabutan sesi (authVersion)')
ok('getPendingWork' in src and 'pendingWorkHTML' in js, 'Perlu Tindakan terpasang')
ok('Manajemen User' in js, 'grup kartu pengelolaan terpasang')
ok('Cegah CSV' in js, 'proteksi CSV formula injection')
ok('safeHttpUrl' in js, 'safeHttpUrl untuk link dari Sheet')
ok('escapeAttr(JSON.stringify(' in js, 'argumen handler inline memakai JSON.stringify+escapeAttr')
ok(not re.search(r'[^a-zA-Z_.]alert\(|[^a-zA-Z_.]confirm\(', js), 'tidak ada alert()/confirm() mentah')


print('4. Aplikasi Android (v17)')
prep_path = os.path.join(root, '..', 'tools', 'prepare-android.mjs')
if os.path.exists(prep_path):
    prep = open(prep_path, encoding='utf-8').read()
    ok('android:allowBackup="false"' in prep, 'cadangan otomatis Android dimatikan (allowBackup=false)')
    ok('android:usesCleartextTraffic="false"' in prep, 'lalu lintas HTTP polos dimatikan')
cap_path = os.path.join(root, '..', 'capacitor.config.json')
if os.path.exists(cap_path):
    cap = open(cap_path, encoding='utf-8').read()
    ok('"allowMixedContent": false' in cap, 'mixed content dimatikan')
    ok('"webContentsDebuggingEnabled": false' in cap, 'debug WebView dimatikan')

print()
print(f'Ringkasan: {len(fails)} FAIL, {len(warns)} WARN')
sys.exit(1 if fails else 0)
