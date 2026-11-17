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
    codePath: CODE, now: START, http: fakeHttp,
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

console.log('\n' + passed + ' uji backend v12 lulus');
