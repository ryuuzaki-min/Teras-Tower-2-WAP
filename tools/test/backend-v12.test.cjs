// Uji backend v12: pembersihan akun, token push, pengiriman FCM, pengumuman.
// Jalankan: node tools/test/backend-v12.test.cjs
'use strict';
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { createContext } = require('./gas-mock.cjs');
const CODE = path.join(__dirname, '..', '..', 'gas', 'Code.gs');
const DAY = 24 * 3600 * 1000;
const START = Date.UTC(2026, 10, 17, 5, 0, 0);

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = {
  project_id: 'teras-tower-2-cd033', client_email: 'fcm@teras-tower-2-cd033.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token'
};
const WARGA_HEADERS = ['Username', 'PIN', 'Nama', 'Nomor_WhatsApp', 'Status_Wisma', 'Lantai', 'Unit', 'Role', 'ProfileComplete'];

// Server FCM palsu: token "mati..." dianggap tidak terdaftar.
function fakeHttp(url, params) {
  if (url.indexOf('oauth2.googleapis.com/token') >= 0) {
    const jwt = params.payload.assertion.split('.');
    const verified = crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), publicKey, Buffer.from(jwt[2], 'base64url'));
    const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
    if (!verified || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging' || claims.iss !== SERVICE_ACCOUNT.client_email) {
      return { code: 400, body: '{"error":"invalid_grant"}' };
    }
    return { code: 200, body: JSON.stringify({ access_token: 'ya29.uji', expires_in: 3600 }) };
  }
  if (url.indexOf('fcm.googleapis.com/v1/projects/teras-tower-2-cd033/messages:send') >= 0) {
    if (params.headers.Authorization !== 'Bearer ya29.uji') return { code: 401, body: '{}' };
    const msg = JSON.parse(params.payload).message;
    if (/^mati/.test(msg.token)) return { code: 404, body: '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' };
    return { code: 200, body: '{"name":"projects/x/messages/1"}' };
  }
  return { code: 500, body: 'unexpected ' + url };
}

function env(opts) {
  opts = opts || {};
  const e = createContext({
    codePath: CODE, now: START, maps: opts.maps,
    http: function (url, params) { return (opts.http && opts.http(url, params)) || fakeHttp(url, params); },
    sheets: {
      WargaBaru: [WARGA_HEADERS].concat(opts.warga || []),
      Admins: [['Username', 'PIN', 'Keterangan']].concat(opts.admins || []),
      SystemConfig: [['KEY', 'VALUE']].concat(opts.config || []),
      AppInfo: [['Deskripsi', 'Penutup'], ['x', 'y']]
    }
  });
  if (opts.fcm !== false) e.props.FCM_SERVICE_ACCOUNT = JSON.stringify(SERVICE_ACCOUNT);
  return e;
}
function fcmSends(e) { return e.http.calls.filter(function (c) { return c.url.indexOf('messages:send') >= 0; }); }
function sentTo(e) { return fcmSends(e).map(function (c) { return JSON.parse(c.params.payload).message.token; }).sort(); }
function login(e, u, pin) { return e.ctx.loginWithPin({ username: u, pin: pin || '123456', remember: true }).user.sessionToken; }
function wargaRow(e, u) { return e.sheets.WargaBaru.data.find(function (r) { return r[0] === u; }); }
function col(e, name) { return e.sheets.WargaBaru.data[0].indexOf(name); }
const TOKEN = function (s) { return s + 'abcdefghijklmnopqrstuvwxyz0123456789'; };

// Objek dari konteks vm berbeda prototipe; bandingkan isinya lewat JSON.
function deq(a, b, m) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m); }
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
console.log('Backend v12');

test('registrasi mencatat TerdaftarPada', function () {
  const e = env();
  e.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const v = wargaRow(e, 'budi')[col(e, 'TerdaftarPada')];
  assert.ok(v instanceof Date || !isNaN(new Date(v).getTime()), String(v));
  assert.strictEqual(new Date(v).getTime(), START);
});

test('login akun belum lengkap membawa batas waktu 7 hari', function () {
  const e = env();
  e.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const user = e.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: false }).user;
  assert.strictEqual(user.profileComplete, false);
  assert.strictEqual(new Date(user.profileDeadline).getTime(), START + 7 * DAY);
});

test('pembersihan: hari ke-8 dihapus+diarsip, lengkap/admin/tanpa-tanggal aman', function () {
  const e = env({ admins: [['adminx', 'h', 'Admin']] });
  ['lama', 'lengkap', 'adminx', 'baru'].forEach(function (u) { e.ctx.registerUser({ username: u, pin: '123456', pinConfirm: '123456' }); });
  wargaRow(e, 'lengkap')[col(e, 'ProfileComplete')] = 'true';
  e.sheets.WargaBaru.data.push(['tanpatanggal', 'h', '', '', '', '', '', 'user', 'false']);
  e.advance(8 * DAY);
  e.ctx.registerUser({ username: 'kemarin', pin: '123456', pinConfirm: '123456' });
  const r = e.ctx.jalankanPembersihanAkunHarian();
  deq(r.deleted.sort(), ['baru', 'lama']);
  assert.strictEqual(r.stamped, 1);
  const left = e.sheets.WargaBaru.data.slice(1).map(function (x) { return x[0]; }).sort();
  deq(left, ['adminx', 'kemarin', 'lengkap', 'tanpatanggal']);
  const archive = e.sheets.ArsipAkunDihapus.data;
  assert.strictEqual(archive.length, 3);
  assert.ok(archive.slice(1).every(function (row) { return /7 hari/.test(row[1]) && row[3].length === 64 || row[3]; }));
  assert.strictEqual(archive[0][2], 'Username');
  assert.strictEqual(e.ArsipHidden = e.sheets.ArsipAkunDihapus.hidden, true);
  assert.strictEqual(e.lockHeld(), 0);
});

test('pembersihan: akun lama tanpa tanggal mendapat 7 hari penuh sejak pertama tercatat', function () {
  const e = env();
  e.sheets.WargaBaru.data.push(['lama', 'h', '', '', '', '', '', 'user', 'false']);
  e.ctx.jalankanPembersihanAkunHarian();
  e.advance(6 * DAY); deq(e.ctx.jalankanPembersihanAkunHarian().deleted, []);
  e.advance(1 * DAY + 1000); deq(e.ctx.jalankanPembersihanAkunHarian().deleted, ['lama']);
});

test('pembersihan menghapus sesi & token push akun yang dihapus', function () {
  const e = env();
  e.ctx.registerUser({ username: 'lama', pin: '123456', pinConfirm: '123456' });
  const tok = login(e, 'lama');
  e.ctx.registerPushToken({ sessionToken: tok, token: TOKEN('hp1'), platform: 'android' });
  e.advance(8 * DAY);
  e.ctx.jalankanPembersihanAkunHarian();
  assert.strictEqual(e.sheets.PushTokens.data.length, 1);
  e.clearCache();
  assert.throws(function () { e.ctx.requireSession_(tok, ['resident']); }, /dicabut|kedaluwarsa/);
});

test('pengingat hari ke-5: notifikasi sekali, dikirim setelah kunci dilepas', function () {
  const e = env();
  e.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  e.ctx.registerPushToken({ sessionToken: login(e, 'budi'), token: TOKEN('hpbudi'), platform: 'android' });
  e.advance(5 * DAY + 1000);
  const r1 = e.ctx.jalankanPembersihanAkunHarian();
  assert.strictEqual(r1.reminded, 1);
  const sends = fcmSends(e);
  assert.strictEqual(sends.length, 1);
  const msg = JSON.parse(sends[0].params.payload).message;
  assert.strictEqual(msg.data.page, 'profil');
  assert.ok(/24\/11\/2026/.test(msg.notification.body), msg.notification.body);
  const lockDuringSend = e.http.lockAtCall[e.http.calls.indexOf(sends[0])];
  assert.strictEqual(lockDuringSend, 0, 'FCM dipanggil saat kunci masih dipegang');
  e.advance(1000);
  assert.strictEqual(e.ctx.jalankanPembersihanAkunHarian().reminded, 0);
  assert.strictEqual(fcmSends(e).length, 1);
});

test('mode uji: tidak menghapus, hanya mencatat; mode mati: tidak menyentuh apa pun', function () {
  const e = env({ config: [['PembersihanAkun', 'uji']] });
  e.ctx.registerUser({ username: 'lama', pin: '123456', pinConfirm: '123456' });
  e.advance(8 * DAY);
  const r = e.ctx.jalankanPembersihanAkunHarian();
  deq(r.wouldDelete, ['lama']);
  deq(r.deleted, []);
  assert.ok(wargaRow(e, 'lama'));
  e.sheets.SystemConfig.data[1][1] = 'mati';
  assert.strictEqual(e.ctx.jalankanPembersihanAkunHarian().mode, 'mati');
  assert.ok(wargaRow(e, 'lama'));
});

test('aktifkanOtomatisasiTT2: satu pemicu harian 02.00 WIB, aman dijalankan ulang', function () {
  const e = env();
  e.ctx.aktifkanOtomatisasiTT2();
  const msg = e.ctx.aktifkanOtomatisasiTT2();
  assert.strictEqual(e.triggers.length, 1);
  deq(e.triggers[0].spec, { handler: 'jalankanPembersihanAkunHarian', everyDays: 1, atHour: 2, tz: 'Asia/Jakarta' });
  assert.ok(/tersambung ke proyek teras-tower-2-cd033/.test(msg), msg);
});

test('fungsi pemicu & pengaturan tidak bisa dipanggil lewat doPost', function () {
  const e = env();
  ['jalankanPembersihanAkunHarian', 'aktifkanOtomatisasiTT2', 'flushPushQueue_', 'queuePush_'].forEach(function (fn) {
    const out = JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify({ fn: fn, args: [] }) } }).getContent());
    assert.strictEqual(out.error, 'Fungsi tidak dikenal.', fn);
  });
});

test('token push: daftar, pindah akun, maks 5 per akun, hapus hanya milik sendiri', function () {
  const e = env();
  ['budi', 'sari'].forEach(function (u) { e.ctx.registerUser({ username: u, pin: '123456', pinConfirm: '123456' }); });
  const tb = login(e, 'budi'), ts = login(e, 'sari');
  for (let i = 0; i < 7; i++) e.ctx.registerPushToken({ sessionToken: tb, token: TOKEN('b' + i), platform: 'android' });
  assert.strictEqual(e.ctx.readPushTokens_().length, 5);
  deq(e.ctx.readPushTokens_().map(function (t) { return t.token.slice(0, 2); }), ['b2', 'b3', 'b4', 'b5', 'b6']);
  e.ctx.registerPushToken({ sessionToken: ts, token: TOKEN('b6'), platform: 'android' });
  assert.strictEqual(e.ctx.readPushTokens_().filter(function (t) { return t.token === TOKEN('b6'); })[0].username, 'sari');
  e.ctx.unregisterPushToken({ sessionToken: tb, token: TOKEN('b6') });
  assert.ok(e.ctx.readPushTokens_().some(function (t) { return t.token === TOKEN('b6'); }), 'budi tidak boleh menghapus token milik sari');
  e.ctx.unregisterPushToken({ sessionToken: ts, token: TOKEN('b6') });
  assert.ok(!e.ctx.readPushTokens_().some(function (t) { return t.token === TOKEN('b6'); }));
  assert.throws(function () { e.ctx.registerPushToken({ sessionToken: tb, token: 'pendek' }); }, /tidak valid/);
  assert.throws(function () { e.ctx.registerPushToken({ sessionToken: 'palsu', token: TOKEN('x') }); }, /kedaluwarsa/);
});

test('penerima: semua / admin / akun tertentu; token mati dibuang', function () {
  const e = env({ admins: [['pengurus', 'h', 'Admin']] });
  ['budi', 'sari', 'pengurus'].forEach(function (u) { e.ctx.registerUser({ username: u, pin: '123456', pinConfirm: '123456' }); });
  e.ctx.registerPushToken({ sessionToken: login(e, 'budi'), token: TOKEN('hpbudi') });
  e.ctx.registerPushToken({ sessionToken: login(e, 'sari'), token: TOKEN('matisari') });
  e.ctx.registerPushToken({ sessionToken: login(e, 'pengurus'), token: TOKEN('hpadmin') });
  e.ctx.withScriptLock_(function () { e.ctx.queuePush_({ admins: true }, { title: 'a', body: 'b', page: 'admin' }); });
  deq(sentTo(e), [TOKEN('hpadmin')]);
  e.http.calls.length = 0;
  e.ctx.queuePush_({ usernames: ['BUDI'] }, { title: 'a', body: 'b' });
  deq(sentTo(e), [TOKEN('hpbudi')]);
  e.http.calls.length = 0;
  e.ctx.queuePush_({ all: true }, { title: 'a', body: 'b' });
  deq(sentTo(e), [TOKEN('hpadmin'), TOKEN('hpbudi'), TOKEN('matisari')].sort());
  assert.ok(!e.ctx.readPushTokens_().some(function (t) { return t.token === TOKEN('matisari'); }), 'token tidak terdaftar harus dihapus');
  const msg = JSON.parse(fcmSends(e)[0].params.payload).message;
  assert.strictEqual(msg.android.notification.channel_id, 'tt2_umum');
  assert.strictEqual(e.lockHeld(), 0);
});

test('tanpa FCM_SERVICE_ACCOUNT: aksi tetap berhasil, tidak ada panggilan jaringan', function () {
  const e = env({ fcm: false });
  e.ctx.registerUser({ username: 'pengurus', pin: '123456', pinConfirm: '123456' });
  e.sheets.Admins.data.push(['pengurus', 'h', 'Admin']);
  const tok = login(e, 'pengurus');
  e.ctx.registerPushToken({ sessionToken: tok, token: TOKEN('hp') });
  const r = e.ctx.sendPengumuman({ sessionToken: tok, judul: 'Air mati', isi: 'Air mati pukul 10.00 sampai 14.00.' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.pushAktif, false);
  assert.strictEqual(e.http.calls.length, 0);
});

test('Firebase error (token akses ditolak) tidak menggagalkan pengumuman', function () {
  const e = env();
  e.props.FCM_SERVICE_ACCOUNT = JSON.stringify(Object.assign({}, SERVICE_ACCOUNT, { client_email: 'salah@x.iam.gserviceaccount.com' }));
  e.sheets.ErrorLog = undefined;
  e.ctx.registerUser({ username: 'pengurus', pin: '123456', pinConfirm: '123456' });
  e.sheets.Admins.data.push(['pengurus', 'h', 'Admin']);
  const tok = login(e, 'pengurus');
  e.ctx.registerPushToken({ sessionToken: tok, token: TOKEN('hp') });
  const r = e.ctx.sendPengumuman({ sessionToken: tok, judul: 'Air mati', isi: 'Air mati pukul 10.00.' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(fcmSends(e).length, 0);
  assert.strictEqual(e.lockHeld(), 0);
});

test('pengumuman: hanya admin, tampil di Beranda 3 hari, batas 10/jam', function () {
  const e = env();
  ['pengurus', 'budi'].forEach(function (u) { e.ctx.registerUser({ username: u, pin: '123456', pinConfirm: '123456' }); });
  e.sheets.Admins.data.push(['pengurus', 'h', 'Admin']);
  const ta = login(e, 'pengurus'), tw = login(e, 'budi');
  e.ctx.registerPushToken({ sessionToken: tw, token: TOKEN('hpbudi') });
  assert.throws(function () { e.ctx.sendPengumuman({ sessionToken: tw, judul: 'Hai', isi: 'Isi pengumuman' }); }, /tidak memiliki akses/);
  const r = e.ctx.sendPengumuman({ sessionToken: ta, judul: 'Lift B diperbaiki', isi: 'Lift B tidak beroperasi hari ini.' });
  assert.strictEqual(r.success, true); assert.strictEqual(r.perangkat, 1);
  const msg = JSON.parse(fcmSends(e)[0].params.payload).message;
  assert.strictEqual(msg.notification.title, '📢 Lift B diperbaiki');
  assert.strictEqual(e.ctx.getPengumumanTerbaru(tw).pengumuman.judul, 'Lift B diperbaiki');
  assert.strictEqual(e.ctx.getPengumumanAdmin(ta).daftar.length, 1);
  assert.throws(function () { e.ctx.getPengumumanAdmin(tw); }, /tidak memiliki akses/);
  e.advance(3 * DAY + 1000); e.clearCache();
  assert.strictEqual(e.ctx.getPengumumanTerbaru(login(e, 'budi')).pengumuman, null);
  const ta2 = login(e, 'pengurus');
  for (let i = 0; i < 10; i++) assert.strictEqual(e.ctx.sendPengumuman({ sessionToken: ta2, judul: 'Uji ' + i, isi: 'Isi pengumuman' }).success, true);
  assert.ok(/Batas 10/.test(e.ctx.sendPengumuman({ sessionToken: ta2, judul: 'Uji 11', isi: 'Isi pengumuman' }).message));
  assert.strictEqual(e.ctx.sendPengumuman({ sessionToken: ta2, judul: 'x', isi: 'Isi pengumuman' }).success, false);
});

test('API baru terdaftar di doPost', function () {
  const e = env();
  ['registerPushToken', 'unregisterPushToken', 'sendPengumuman', 'getPengumumanTerbaru', 'getPengumumanAdmin'].forEach(function (fn) {
    const out = JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify({ fn: fn, args: [{}] }) } }).getContent());
    assert.notStrictEqual(out.error, 'Fungsi tidak dikenal.', fn);
  });
});

test('teks tanggal agenda untuk notifikasi', function () {
  const e = env();
  assert.strictEqual(e.ctx.formatAgendaDateForPush_('2026-11-20', '19:30'), '20/11/2026 pukul 19:30');
  assert.strictEqual(e.ctx.formatAgendaDateForPush_('2026-11-20', ''), '20/11/2026');
});

test('tindak lanjut aspirasi: pengirim dikabari hanya saat status berubah', function () {
  const e = env({ admins: [['pengurus', 'h', 'Admin']] });
  ['pengurus', 'budi', 'sari'].forEach(function (u) { e.ctx.registerUser({ username: u, pin: '123456', pinConfirm: '123456' }); });
  e.sheets['Data Aspirasi'] = undefined;
  const ss = e.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const data = ss.insertSheet('Data Aspirasi');
  data.appendRow(['ID', 'Timestamp', 'Username', 'Sudah_Ditindaklanjuti']);
  data.appendRow(['A1', new Date(START), 'budi', 'Belum']);
  const ta = login(e, 'pengurus');
  e.ctx.registerPushToken({ sessionToken: login(e, 'budi'), token: TOKEN('hpbudi') });
  e.ctx.registerPushToken({ sessionToken: login(e, 'sari'), token: TOKEN('hpsari') });
  const r = e.ctx.updateTindakLanjut({ sessionToken: ta, id: 'A1', status: 'Diselesaikan', catatan: 'Sudah dibersihkan' });
  assert.strictEqual(r.success, true, r.message);
  deq(sentTo(e), [TOKEN('hpbudi')]);
  const msg = JSON.parse(fcmSends(e)[0].params.payload).message;
  assert.strictEqual(msg.data.page, 'riwayat');
  assert.ok(/diselesaikan/.test(msg.notification.body));
  const again = e.ctx.updateTindakLanjut({ sessionToken: ta, id: 'A1', status: 'Diselesaikan', catatan: 'Catatan diperbarui' });
  assert.strictEqual(again.success, true, again.message);
  assert.strictEqual(fcmSends(e).length, 1, 'status sama tidak boleh mengirim notifikasi lagi');
  assert.strictEqual(e.lockHeld(), 0);
});

test('v13 laporan rilis: sandi, versi naik, SystemConfig, notifikasi ke semua HP Android', function () {
  const e = env({ admins: [['pengurus', 'h', 'Admin']] });
  ['pengurus', 'budi'].forEach(function (u) { e.ctx.registerUser({ username: u, pin: '123456', pinConfirm: '123456' }); });
  e.ctx.registerPushToken({ sessionToken: login(e, 'budi'), token: TOKEN('hpbudi'), platform: 'android' });
  e.ctx.registerPushToken({ sessionToken: login(e, 'pengurus'), token: TOKEN('hpadmin'), platform: 'android' });
  e.ctx.registerPushToken({ sessionToken: login(e, 'budi'), token: TOKEN('iphonebudi'), platform: 'ios' });
  const call = function (args) { return JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify({ fn: 'reportApkRelease', args: [args] }) } }).getContent()); };
  assert.ok(/RELEASE_SECRET belum diatur/.test(call({ secret: 'x', version: '1.1.1' }).result.message));
  e.props.RELEASE_SECRET = 'rahasia-rilis-uji-0123456789abcdef';
  assert.strictEqual(call({ secret: 'salah', version: '1.1.1' }).result.success, false);
  assert.strictEqual(call({ secret: 'rahasia-rilis-uji-0123456789abcdef', version: '1.1' }).result.success, false);
  const ok = call({ secret: 'rahasia-rilis-uji-0123456789abcdef', version: '1.1.1', url: 'https://jahat.example/apk' }).result;
  assert.strictEqual(ok.success, true); assert.strictEqual(ok.changed, true);
  const cfg = e.ctx.getSystemConfig_();
  assert.strictEqual(cfg.ApkVersiTerbaru, '1.1.1');
  assert.strictEqual(cfg.ApkTautanUnduh, 'https://github.com/ryuuzaki-min/Teras-Tower-2-WAP/releases/latest/download/TerasTower2.apk');
  deq(sentTo(e), [TOKEN('hpadmin'), TOKEN('hpbudi')]);
  const msg = JSON.parse(fcmSends(e)[0].params.payload).message;
  assert.strictEqual(msg.data.url, cfg.ApkTautanUnduh, 'tautan dari pemanggil harus diabaikan');
  assert.ok(/1\.1\.1/.test(msg.notification.body));
  const n = fcmSends(e).length;
  const same = call({ secret: 'rahasia-rilis-uji-0123456789abcdef', version: '1.1.1' }).result;
  assert.strictEqual(same.changed, false);
  assert.strictEqual(call({ secret: 'rahasia-rilis-uji-0123456789abcdef', version: '1.0.9' }).result.changed, false);
  assert.strictEqual(fcmSends(e).length, n, 'versi sama/lebih lama tidak boleh mengirim notifikasi lagi');
  assert.strictEqual(call({ secret: 'rahasia-rilis-uji-0123456789abcdef', version: '1.10.0' }).result.changed, true, '1.10.0 > 1.1.1');
  assert.strictEqual(e.lockHeld(), 0);
});

test('v14: versi yang telanjur jadi TANGGAL di sheet tidak memblokir rilis & spanduk', function () {
  const e = env({ config: [['ApkVersiTerbaru', new Date(Date.UTC(2000, 1, 1))], ['ApkTautanUnduh', 'https://github.com/x']] });
  e.props.RELEASE_SECRET = 'rahasia-rilis-uji-0123456789abcdef';
  assert.strictEqual(e.ctx.getBootstrap().systemConfig.ApkVersiTerbaru, '', 'tanggal tidak boleh dikirim sebagai versi');
  const call = function (v) { return JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify({ fn: 'reportApkRelease', args: [{ secret: 'rahasia-rilis-uji-0123456789abcdef', version: v }] }) } }).getContent()).result; };
  assert.strictEqual(call('1.2.1').changed, true, 'rilis harus tetap tercatat');
  const boot = e.ctx.getBootstrap().systemConfig;
  assert.strictEqual(boot.ApkVersiTerbaru, '1.2.1');
  assert.strictEqual(boot.ApkTautanUnduh, 'https://github.com/ryuuzaki-min/Teras-Tower-2-WAP/releases/latest/download/TerasTower2.apk');
  assert.strictEqual(e.props.APK_LATEST_VERSION, '1.2.1');
  assert.strictEqual(e.ctx.getSystemConfig_().ApkVersiTerbaru, '1.2.1', 'sheet menyimpan teks');
  assert.strictEqual(call('1.2.1').changed, false);
});

test('v15: kapasitas spreadsheet - peringatan 75%/90% dikirim sekali per tingkat', function () {
  const e = env({ warga: [['admin1', '123456', 'Admin', '0812', 'Penghuni', '3', '01', 'admin', 'Ya']], admins: [['admin1', '123456', '']] });
  e.ctx.registerPushToken({ sessionToken: login(e, 'admin1'), token: TOKEN('hpadmin'), platform: 'android' });
  let cap = e.ctx.checkSpreadsheetCapacity_();
  assert.strictEqual(cap.level, 'ok'); assert.strictEqual(fcmSends(e).length, 0);
  e.sheets.WargaBaru.maxRows = 300000; // 300rb x 26 = 7,8 juta sel
  cap = e.ctx.checkSpreadsheetCapacity_();
  assert.strictEqual(cap.level, 'waspada'); assert.strictEqual(cap.largest, 'WargaBaru');
  assert.strictEqual(fcmSends(e).length, 1, 'admin dikabari saat masuk 75%');
  e.ctx.checkSpreadsheetCapacity_();
  assert.strictEqual(fcmSends(e).length, 1, 'tidak berulang pada tingkat yang sama');
  e.sheets.WargaBaru.maxRows = 360000;
  assert.strictEqual(e.ctx.checkSpreadsheetCapacity_().level, 'kritis');
  assert.strictEqual(fcmSends(e).length, 2, 'dikabari lagi saat 90%');
  const sum = e.ctx.getNotificationSummary(login(e, 'admin1'));
  assert.strictEqual(sum.kapasitas.level, 'kritis');
});

test('v15: hari libur Google + koreksi manual sheet HariLibur', function () {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261225\r\nSUMMARY:Hari Raya Natal\r\nDESCRIPTION:Hari libur nasional\r\nEND:VEVENT\r\n' +
    'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261112\r\nSUMMARY:Hari Ayah\r\nDESCRIPTION:Hari peringatan\\nUntuk menyembunyikan\r\nEND:VEVENT\r\n' +
    'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261110\r\nSUMMARY:Hari Pahlawan\r\nDESCRIPTION:Hari peringatan\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const e = createContext({ codePath: CODE, now: START,
    http: function (url) { return url.indexOf('calendar.google.com') >= 0 ? { code: 200, body: ics } : { code: 500, body: '' }; },
    sheets: { WargaBaru: [WARGA_HEADERS, ['budi', '123456', 'Budi', '0812', 'Penghuni', '3', '01', 'resident', 'Ya']], Admins: [['Username', 'PIN', 'Keterangan']], SystemConfig: [['KEY', 'VALUE']], AppInfo: [['Deskripsi', 'Penutup'], ['x', 'y']],
      HariLibur: [['Tanggal', 'Nama', 'Jenis'], ['2026-11-10', '', 'Hapus'], ['2026-11-20', 'Cuti bersama uji', 'Libur']] } });
  const token = login(e, 'budi');
  const nov = e.ctx.getAgendaCalendar(token, 2026, 11).holidays;
  deq(nov, [{ date: '2026-11-12', name: 'Hari Ayah', type: 'peringatan' }, { date: '2026-11-14', name: 'Hari Diabetes Sedunia', type: 'internasional' },
    { date: '2026-11-19', name: 'Hari Toilet Sedunia', type: 'internasional' }, { date: '2026-11-20', name: 'Cuti bersama uji', type: 'libur' }]);
  // 20 Nov (Hari Anak Sedunia) tidak muncul karena tanggal itu sudah libur; 10 Nov dihapus manual.
  const dec = e.ctx.getAgendaCalendar(token, 2026, 12).holidays;
  deq(dec.filter(function (x) { return x.type === 'libur'; }), [{ date: '2026-12-25', name: 'Hari Raya Natal', type: 'libur' }]);
  deq(dec.filter(function (x) { return x.type === 'internasional'; }).map(function (x) { return x.date; }), ['2026-12-01', '2026-12-03', '2026-12-05', '2026-12-10']);
  assert.strictEqual(e.http.calls.filter(function (c) { return c.url.indexOf('calendar.google.com') >= 0; }).length, 1, 'ICS diambil sekali lalu dari cache');
});

test('v15: kalender tetap jalan saat kalender Google gagal diambil', function () {
  const e = env({ warga: [['budi', '123456', 'Budi', '0812', 'Penghuni', '3', '01', 'resident', 'Ya']] });
  const r = e.ctx.getAgendaCalendar(login(e, 'budi'), 2026, 12);
  assert.strictEqual(r.success, true);
  assert.ok(r.holidays.every(function (x) { return x.type === 'internasional'; }), 'hanya hari internasional bawaan');
});

test('v15: nomor penting menyimpan kategori di kolom baru tanpa mengganggu kolom lain', function () {
  const e = env({ warga: [['admin1', '123456', 'Admin', '0812', 'Penghuni', '3', '01', 'admin', 'Ya']], admins: [['admin1', '123456', '']] });
  const ss = e.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const np = ss.insertSheet('NomorPenting'); np.appendRow(['Nama', 'Nomor', 'UpdatedAt']); np.appendRow(['Lama', '0811', 'x']);
  const r = e.ctx.saveNomorPenting({ sessionToken: login(e, 'admin1'), data: [{ nama: 'Satpam', nomor: '0812', kategori: 'Keamanan' }, { nama: 'Ojek', nomor: '0813', kategori: 'aneh' }] });
  assert.strictEqual(r.success, true, r.message);
  deq(np.data[0], ['Nama', 'Nomor', 'UpdatedAt', 'Kategori']);
  assert.strictEqual(np.data[1][3], 'Keamanan'); assert.strictEqual(np.data[2][3], 'Lainnya');
  assert.strictEqual(e.lockHeld(), 0);
});

test('v15: Penyimpanan Data - perkiraan baris per sheet, khusus Super Admin', function () {
  const e = env({ warga: [['boss', '123456', 'Boss', '0812', 'Penghuni', '3', '01', 'admin', 'Ya'], ['budi', '123456', 'Budi', '0812', 'Penghuni', '3', '01', 'resident', 'Ya']],
    admins: [['boss', '123456', 'superadmin']] });
  const budiToken = login(e, 'budi');
  assert.throws(function () { e.ctx.getStorageInfo(budiToken); }, 'warga tidak boleh');
  const realSession = e.ctx.requireSession_;
  e.ctx.requireSession_ = function (token, roles) { assert.deepStrictEqual(Array.from(roles), ['super_admin']); return { username: 'boss', role: 'super_admin' }; };
  const info = e.ctx.getStorageInfo('token-super');
  e.ctx.requireSession_ = realSession;
  const w = info.sheets.filter(function (x) { return x.name === 'WargaBaru'; })[0];
  assert.strictEqual(w.dataRows, 2);
  assert.strictEqual(w.rowsAvailable, (1000 - 3) + Math.floor(info.freeCells / 26));
  assert.ok(info.checkedAt && info.percent > 0);
});

test('v15: FAQ - isi bawaan, disalin ke sheet saat diubah pertama kali, hak per peran', function () {
  const e = env({ warga: [['admin1', '123456', 'Admin', '0812', 'Penghuni', '3', '01', 'admin', 'Ya'], ['budi', '123456', 'Budi', '0812', 'Penghuni', '3', '01', 'resident', 'Ya']], admins: [['admin1', '123456', '']] });
  const tWarga = login(e, 'budi'), tAdmin = login(e, 'admin1');
  const warga = e.ctx.getFaq(tWarga);
  assert.ok(warga.items.length > 30 && warga.items.every(function (x) { return x.peran === 'warga'; }), 'warga hanya melihat FAQ umum');
  assert.strictEqual(warga.canEdit, false);
  assert.throws(function () { e.ctx.saveFaqItem({ sessionToken: tWarga, bagian: 'X', peran: 'warga', pertanyaan: 'Pertanyaan?', jawaban: 'Jawaban.' }); });
  const admin = e.ctx.getFaq(tAdmin);
  assert.ok(admin.items.some(function (x) { return x.peran === 'admin'; }) && !admin.items.some(function (x) { return x.peran === 'super'; }));
  assert.strictEqual(e.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('FAQ'), null, 'belum ada sheet sebelum diubah');
  // ubah item bawaan -> isi bawaan disalin, item berubah
  const first = admin.items[0];
  let r = e.ctx.saveFaqItem({ sessionToken: tAdmin, id: first.id, bagian: first.bagian, peran: 'warga', pertanyaan: 'Apa itu aplikasi Teras?', jawaban: 'Aplikasi warga Tower 2.' });
  assert.strictEqual(r.success, true, r.message);
  const sheet = e.sheets.FAQ; assert.ok(sheet && sheet.data.length - 1 === e.ctx.faqDefaultItems_().length, 'semua isi bawaan tersalin');
  assert.strictEqual(e.ctx.getFaq(tWarga).items[0].pertanyaan, 'Apa itu aplikasi Teras?');
  // admin tidak boleh membuat FAQ khusus super admin
  r = e.ctx.saveFaqItem({ sessionToken: tAdmin, bagian: 'Rahasia', peran: 'super', pertanyaan: 'Pertanyaan super?', jawaban: 'Jawaban super.' });
  assert.strictEqual(r.success, false);
  // tambah, geser, hapus
  r = e.ctx.saveFaqItem({ sessionToken: tAdmin, bagian: 'Akun & masuk', peran: 'warga', pertanyaan: 'Bisakah dua HP satu akun?', jawaban: 'Bisa, masuk dengan username yang sama.' });
  assert.strictEqual(r.success, true, r.message);
  let akun = e.ctx.getFaq(tWarga).items.filter(function (x) { return x.bagian === 'Akun & masuk'; });
  assert.strictEqual(akun[akun.length - 1].id, r.id, 'item baru di akhir bagiannya');
  assert.strictEqual(e.ctx.moveFaqItem({ sessionToken: tAdmin, id: r.id, direction: -1 }).success, true);
  akun = e.ctx.getFaq(tWarga).items.filter(function (x) { return x.bagian === 'Akun & masuk'; });
  assert.strictEqual(akun[akun.length - 2].id, r.id, 'naik satu');
  assert.strictEqual(e.ctx.deleteFaqItem({ sessionToken: tAdmin, id: r.id }).success, true);
  assert.ok(!e.ctx.getFaq(tWarga).items.some(function (x) { return x.id === r.id; }));
  assert.strictEqual(e.lockHeld(), 0);
});

// ---------------- v16 Jelajah ----------------
function jelajahEnv(extra) {
  extra = extra || {};
  return env(Object.assign({
    warga: [['admin1', '123456', 'Admin', '0812', 'Penghuni', '3', '01', 'admin', 'Ya'], ['budi', '123456', 'Budi', '0812', 'Penghuni', '3', '01', 'resident', 'Ya'], ['sari', '123456', 'Sari', '0813', 'Penghuni', '4', '02', 'resident', 'Ya']],
    admins: [['admin1', '123456', '']]
  }, extra));
}
const BAKSO_GEO = { status: 'OK', results: [{ formatted_address: 'Bakso Pak Kumis, Jl. Pademangan Raya No.12, Jakarta Utara, Indonesia', place_id: 'PLACE123', types: ['restaurant', 'establishment', 'point_of_interest'],
  address_components: [{ long_name: 'Bakso Pak Kumis' }], geometry: { location: { lat: -6.1301, lng: 106.8402 } } },
  { formatted_address: 'Jl. Kumis, Bekasi, Indonesia', place_id: 'P2', types: ['route'], address_components: [{ long_name: 'Jalan Kumis' }], geometry: { location: { lat: -6.30, lng: 107.0 } } },
  { formatted_address: 'Paris, France', place_id: 'P3', types: ['locality'], address_components: [{ long_name: 'Paris' }], geometry: { location: { lat: 48.85, lng: 2.35 } } }] };

test('v16 Jelajah: cari lokasi di aplikasi - hasil di luar Jabodetabek dibuang, cache & kuota', function () {
  const e = jelajahEnv({ maps: { geocode: function () { return BAKSO_GEO; } } });
  const t = login(e, 'budi');
  let r = e.ctx.searchJelajahPlaces({ sessionToken: t, query: 'ba' });
  assert.strictEqual(r.success, false, 'minimal 3 huruf');
  r = e.ctx.searchJelajahPlaces({ sessionToken: t, query: 'bakso pak kumis' });
  assert.strictEqual(r.success, true, r.message);
  assert.strictEqual(r.results.length, 2, 'Paris dibuang');
  deq(r.results[0], { nama: 'Bakso Pak Kumis', alamat: 'Jl. Pademangan Raya No.12, Jakarta Utara', lat: -6.1301, lng: 106.8402, placeId: 'PLACE123', tempat: true, jarak: null });
  assert.strictEqual(e.ctx.__geoCalls[0], 'bakso pak kumis, Jakarta');
  e.ctx.searchJelajahPlaces({ sessionToken: t, query: 'Bakso Pak Kumis' });
  assert.strictEqual(e.ctx.__geoCalls.length, 1, 'query sama diambil dari cache');
  // titik Tower 2 diatur -> ada jarak & urut terdekat
  const ta = login(e, 'admin1');
  assert.strictEqual(e.ctx.setJelajahTowerLocation({ sessionToken: ta, lat: 48, lng: 2 }).success, false, 'di luar wilayah');
  assert.strictEqual(e.ctx.setJelajahTowerLocation({ sessionToken: ta, lat: -6.1330, lng: 106.8400 }).success, true);
  r = e.ctx.searchJelajahPlaces({ sessionToken: t, query: 'bakso pak kumis' });
  assert.ok(r.results[0].jarak > 300 && r.results[0].jarak < 350, 'jarak ' + r.results[0].jarak);
  // kuota per akun
  for (let i = 0; i < 40; i++) e.ctx.searchJelajahPlaces({ sessionToken: t, query: 'tempat ' + i });
  r = e.ctx.searchJelajahPlaces({ sessionToken: t, query: 'tempat baru sekali' });
  assert.strictEqual(r.success, false); assert.ok(/terlalu sering/.test(r.message));
});
test('v16 Jelajah: hanya admin yang boleh mengatur titik Tower 2', function () {
  const e = jelajahEnv();
  assert.throws(function () { e.ctx.setJelajahTowerLocation({ sessionToken: login(e, 'budi'), lat: -6.13, lng: 106.84 }); });
  assert.strictEqual(e.ctx.getJelajahSekitar(login(e, 'budi')).tower, null, 'belum diatur -> tanpa jarak');
});

test('v16 Jelajah: kirim dengan titik peta (tanpa tautan), ubah oleh pengirim saja, favorit, laporan', function () {
  const e = jelajahEnv();
  const tb = login(e, 'budi'), ts = login(e, 'sari'), ta = login(e, 'admin1');
  e.ctx.getJelajahSekitar(tb); // membuat sheet katalog bawaan
  let r = e.ctx.submitJelajahRecommendation({ sessionToken: tb, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'Bakso Pak Kumis', lat: -6.1301, lng: 106.8402, placeId: 'PLACE123', harga: 2, jamBuka: '10.00 – 22.00', tags: ['murah', 'buka malam', 'murah'] });
  assert.strictEqual(r.success, true, r.message);
  const id = r.id;
  let list = e.ctx.getJelajahSekitar(tb).recommendations;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].lat, -6.1301); assert.strictEqual(list[0].harga, 2); assert.strictEqual(list[0].jamBuka, '10.00 – 22.00');
  assert.strictEqual(list[0].tags, 'murah, buka malam', 'tag ganda dibuang');
  assert.ok(list[0].tautanMaps.indexOf('https://www.google.com/maps/search/?api=1&query=Bakso%20Pak%20Kumis&query_place_id=PLACE123') === 0, list[0].tautanMaps);
  assert.strictEqual(list[0].mine, true);
  assert.strictEqual(e.ctx.getJelajahSekitar(ts).recommendations[0].mine, false);
  // validasi
  assert.strictEqual(e.ctx.submitJelajahRecommendation({ sessionToken: tb, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'X' }).success, false, 'tanpa lokasi ditolak');
  assert.strictEqual(e.ctx.submitJelajahRecommendation({ sessionToken: tb, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'X', lat: 48, lng: 2 }).success, false, 'di luar wilayah');
  assert.strictEqual(e.ctx.submitJelajahRecommendation({ sessionToken: tb, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'X', lat: -6.13, lng: 106.84, harga: 6 }).success, false, 'harga 1-5');
  // ubah
  const edit = { id: id, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'Bakso Pak Kumis Asli', lat: -6.1302, lng: 106.8403, harga: 3 };
  assert.strictEqual(e.ctx.updateJelajahRecommendation(Object.assign({ sessionToken: ts }, edit)).success, false, 'warga lain tidak boleh');
  r = e.ctx.updateJelajahRecommendation(Object.assign({ sessionToken: tb }, edit));
  assert.strictEqual(r.success, true, r.message);
  list = e.ctx.getJelajahSekitar(tb).recommendations;
  assert.strictEqual(list[0].namaLokasi, 'Bakso Pak Kumis Asli'); assert.strictEqual(list[0].harga, 3); assert.strictEqual(list[0].lat, -6.1302);
  assert.strictEqual(e.ctx.updateJelajahRecommendation(Object.assign({ sessionToken: ta }, edit)).success, true, 'admin boleh');
  // favorit
  assert.strictEqual(e.ctx.toggleJelajahFavorite({ sessionToken: ts, recommendationId: id }).favorited, true);
  assert.strictEqual(e.ctx.getJelajahSekitar(ts).recommendations[0].favorited, true);
  assert.strictEqual(e.ctx.getJelajahSekitar(tb).recommendations[0].favorited, false, 'favorit per akun');
  assert.strictEqual(e.ctx.toggleJelajahFavorite({ sessionToken: ts, recommendationId: id }).favorited, false);
  // laporan -> push admin, sekali per akun sampai ditinjau
  e.ctx.registerPushToken({ sessionToken: ta, token: TOKEN('hpadmin'), platform: 'android' });
  const before = fcmSends(e).length;
  r = e.ctx.submitJelajahReport({ sessionToken: ts, recommendationId: id, alasan: 'Tutup permanen', catatan: 'Sudah pindah' });
  assert.strictEqual(r.success, true, r.message);
  assert.strictEqual(fcmSends(e).length, before + 1, 'admin dikabari');
  assert.strictEqual(e.ctx.submitJelajahReport({ sessionToken: ts, recommendationId: id, alasan: 'Tutup permanen' }).success, false, 'tidak dobel');
  assert.strictEqual(e.ctx.submitJelajahReport({ sessionToken: ts, recommendationId: id, alasan: 'Alasan aneh' }).success, false);
  const kelola = e.ctx.getKelolaJelajah(ta);
  assert.strictEqual(kelola.reports.length, 1); assert.strictEqual(kelola.reports[0].namaLokasi, 'Bakso Pak Kumis Asli');
  assert.strictEqual(e.ctx.resolveJelajahReport({ sessionToken: ta, id: kelola.reports[0].id }).success, true);
  assert.strictEqual(e.ctx.getKelolaJelajah(ta).reports.length, 0);
  assert.strictEqual(e.lockHeld(), 0);
});

test('v16 Jelajah: data lama dilengkapi titiknya dari tautan Maps (termasuk tautan pendek)', function () {
  const e = jelajahEnv({ http: function (url) {
    if (url === 'https://maps.app.goo.gl/abc123') return { code: 302, body: '', headers: { Location: 'https://www.google.com/maps/place/Warung/@-6.1250,106.8450,17z/data=!3d-6.1251!4d106.8451' } };
    if (url === 'https://maps.app.goo.gl/rusak') return { code: 404, body: '' };
    return null;
  } });
  const ta = login(e, 'admin1');
  e.ctx.getJelajahSekitar(ta);
  const sheet = e.ctx.getJelajahRecommendationSheet_();
  const headers = sheet.data[0];
  function oldRow(id, url) { const row = headers.map(function () { return ''; }); row[0] = id; row[1] = new Date(); row[2] = 'budi'; row[4] = 'Restoran'; row[5] = 'Bakso'; row[6] = 'Lama ' + id; row[7] = url; row[14] = 'Aktif'; sheet.appendRow(row); }
  oldRow('a', 'https://maps.app.goo.gl/abc123');
  oldRow('b', 'https://www.google.com/maps?q=-6.1400,106.8300');
  oldRow('c', 'https://maps.app.goo.gl/rusak');
  assert.strictEqual(e.ctx.getKelolaJelajah(ta).missingCoords, 3);
  const r = e.ctx.fillJelajahCoordinates(ta);
  deq(r.report, { filled: 2, failed: 1, remaining: 0 });
  const list = e.ctx.getJelajahSekitar(ta).recommendations;
  const byId = {}; list.forEach(function (x) { byId[x.id] = x; });
  assert.strictEqual(byId.a.lat, -6.1251, 'pakai !3d!4d yang lebih tepat'); assert.strictEqual(byId.b.lng, 106.83); assert.strictEqual(byId.c.lat, null);
  const again = e.ctx.fillJelajahCoordinates(ta).report;
  deq(again, { filled: 0, failed: 0, remaining: 0 }, 'yang gagal tidak dicoba terus');
});

console.log('\n' + passed + ' uji backend v12 lulus');
