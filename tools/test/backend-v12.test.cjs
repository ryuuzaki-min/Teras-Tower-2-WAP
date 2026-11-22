// Uji backend v12: pembersihan akun, token push, pengiriman FCM, pengumuman.
// Jalankan: node tools/test/backend-v12.test.cjs
'use strict';
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { createContext, FORMULA_HITS } = require('./gas-mock.cjs');
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
  // v18: SystemConfig di-cache 60 detik; ketikan langsung di Sheets berlaku setelah itu.
  e.advance(61 * 1000);
  assert.strictEqual(e.ctx.jalankanPembersihanAkunHarian().mode, 'mati');
  assert.ok(wargaRow(e, 'lama'));
});

test('aktifkanOtomatisasiTT2: satu pemicu harian 02.00 WIB, aman dijalankan ulang', function () {
  const e = env();
  e.ctx.aktifkanOtomatisasiTT2();
  const msg = e.ctx.aktifkanOtomatisasiTT2();
  assert.strictEqual(e.triggers.length, 2, 'pembersihan harian + pengingat agenda (v20)');
  deq(e.triggers[0].spec, { handler: 'jalankanPembersihanAkunHarian', everyDays: 1, atHour: 2, tz: 'Asia/Jakarta' });
  deq(e.triggers[1].spec, { handler: 'kirimPengingatAgendaHarian', everyDays: 1, atHour: 17, tz: 'Asia/Jakarta' });
  assert.ok(/17\.00/.test(msg), msg);
  assert.ok(/tersambung ke proyek teras-tower-2-cd033/.test(msg), msg);
});

test('fungsi pemicu & pengaturan tidak bisa dipanggil lewat doPost', function () {
  const e = env();
  ['jalankanPembersihanAkunHarian', 'aktifkanOtomatisasiTT2', 'kirimPengingatAgendaHarian', 'flushPushQueue_', 'queuePush_'].forEach(function (fn) {
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

// ---------------- v17 Keamanan ----------------
test('v17: fungsi latar hanya dari pemicu terjadwal atau editor pemilik', function () {
  const e = env();
  // editor oleh pemilik
  assert.ok(/Pemicu pembersihan harian aktif/.test(e.ctx.aktifkanOtomatisasiTT2()));
  const trig = e.triggers[0];
  // pengunjung web anonim (google.script.run) ditolak
  e.setActiveEmail('');
  assert.throws(function () { e.ctx.jalankanPembersihanAkunHarian(); }, /pemicu terjadwal atau pemilik/);
  assert.throws(function () { e.ctx.aktifkanOtomatisasiTT2(); }, /pemicu terjadwal atau pemilik/);
  assert.throws(function () { e.ctx.jalankanPembersihanAkunHarian({ triggerUid: 'tebak-tebakan' }); }, /pemicu terjadwal/, 'ID pemicu palsu ditolak');
  assert.throws(function () { e.ctx.kirimPengingatAgendaHarian(); }, /pemicu terjadwal atau pemilik/, 'pengingat agenda juga dijaga');
  assert.strictEqual(e.triggers.length, 2, 'pemicu tidak dibuat ulang oleh orang luar');
  // pemicu terjadwal asli lolos
  const r = e.ctx.jalankanPembersihanAkunHarian({ triggerUid: trig.getUniqueId() });
  assert.ok(r && Array.isArray(r.deleted));
  // orang lain yang login Google (bukan pemilik) juga ditolak
  e.setActiveEmail('orang.lain@gmail.com');
  assert.throws(function () { e.ctx.jalankanPembersihanAkunHarian(); });
  const log = e.sheets.AuditLog && e.sheets.AuditLog.data.map(function (row) { return row.join('|'); }).join('\n');
  assert.ok(/PANGGILAN_DITOLAK/.test(log || ''), 'percobaan tercatat di AuditLog');
});

test('v17: daftar nomor untuk halaman Kelola butuh sesi admin; warga tetap lewat getKontakData', function () {
  const e = jelajahEnv();
  e.sheets.NomorPenting = undefined;
  const ctx = e.ctx;
  ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet('NomorPenting');
  ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet('NomorDarurat');
  e.sheets.NomorPenting.data.push(['Nama', 'Nomor'], ['Pengelola', '0215550100']);
  e.sheets.NomorDarurat.data.push(['Nama', 'Nomor'], ['Ambulans', '118']);
  assert.throws(function () { ctx.getNomorPenting(); }, 'tanpa token ditolak');
  assert.throws(function () { ctx.getNomorDarurat(login(e, 'budi')); }, 'warga ditolak');
  assert.strictEqual(ctx.getNomorPenting(login(e, 'admin1'))[0].Nomor, '0215550100');
  assert.strictEqual(ctx.getNomorDarurat(login(e, 'admin1'))[0].Nomor, '118');
  const kontak = ctx.getKontakData();
  assert.strictEqual(kontak.nomorPenting.length, 1); assert.strictEqual(kontak.nomorDarurat.length, 1);
});

test('v17 Jelajah: duplikat ditolak di server (PlaceId, nomor telepon, nama + lokasi)', function () {
  const e = jelajahEnv();
  const tb = login(e, 'budi'), ts = login(e, 'sari'), ta = login(e, 'admin1');
  e.ctx.getJelajahSekitar(tb);
  const base = { kategori: 'Restoran', jenis: 'Bakso' };
  function kirim(token, extra) { return e.ctx.submitJelajahRecommendation(Object.assign({ sessionToken: token }, base, extra)); }
  let r = kirim(tb, { namaLokasi: 'Bakso Pak Kumis', lat: -6.1301, lng: 106.8402, placeId: 'PLACE123', keterangan: 'Pesan antar WA 0812-3456-7890' });
  assert.strictEqual(r.success, true, r.message);
  const firstId = r.id;
  // 1. PlaceId sama, nama beda
  r = kirim(ts, { namaLokasi: 'Warung Bakso Kumis', lat: -6.1305, lng: 106.8405, placeId: 'PLACE123' });
  assert.strictEqual(r.success, false); assert.strictEqual(r.duplicate.id, firstId); assert.ok(/lokasi Google yang sama/.test(r.message), r.message);
  // 2. nomor telepon sama walau ditulis beda format dan tempat jauh
  r = kirim(ts, { namaLokasi: 'Bakso Cabang Baru', lat: -6.2000, lng: 106.9000, alamat: 'Hubungi +62 812 3456 7890' });
  assert.strictEqual(r.success, false); assert.ok(/nomor telepon yang sama \(081234567890\)/.test(r.message), r.message);
  // 3. nama mirip dan berdekatan (< 300 m)
  r = kirim(ts, { namaLokasi: 'bakso pak kumis!', lat: -6.1310, lng: 106.8410 });
  assert.strictEqual(r.success, false); assert.ok(/nama yang sama di lokasi berdekatan/.test(r.message), r.message);
  // admin juga tidak bisa membuat duplikat
  assert.strictEqual(kirim(ta, { namaLokasi: 'Bakso Pak Kumis', lat: -6.1302, lng: 106.8401 }).success, false);
  // boleh: nama sama tapi jauh (cabang lain), titik sama tapi nama beda (kios lain di gedung yang sama)
  assert.strictEqual(kirim(ts, { namaLokasi: 'Bakso Pak Kumis', lat: -6.2200, lng: 106.8000 }).success, true, 'cabang jauh boleh');
  assert.strictEqual(kirim(ts, { namaLokasi: 'Es Teh Manis Bu Ani', lat: -6.1301, lng: 106.8402 }).success, true, 'kios lain di titik sama boleh');
  // harga, jam, nomor pendek seperti 118, atau tahun tidak dianggap telepon
  assert.strictEqual(kirim(ts, { namaLokasi: 'Sate Madura', lat: -6.1500, lng: 106.8600, keterangan: 'Rp15.000-30.000, jam 10.00-22.00' }).success, true);
  assert.strictEqual(kirim(tb, { namaLokasi: 'Soto Betawi', lat: -6.1600, lng: 106.8700, harga: 2, keterangan: 'Rp15.000-30.000' }).success, true, 'harga sama bukan duplikat');
  assert.strictEqual(kirim(ts, { namaLokasi: 'Mie Ayam 2024', lat: -6.1400, lng: 106.8500, keterangan: 'Buka sejak 2019, telp darurat 118' }).success, true);
  // ubah: tidak bentrok dengan dirinya sendiri, tetapi bentrok dengan yang lain
  r = e.ctx.updateJelajahRecommendation(Object.assign({ sessionToken: tb, id: firstId }, base, { namaLokasi: 'Bakso Pak Kumis', lat: -6.1301, lng: 106.8402, placeId: 'PLACE123', harga: 2 }));
  assert.strictEqual(r.success, true, r.message);
  r = e.ctx.updateJelajahRecommendation(Object.assign({ sessionToken: tb, id: firstId }, base, { namaLokasi: 'Es Teh Manis Bu Ani', lat: -6.1301, lng: 106.8402 }));
  assert.strictEqual(r.success, false, 'mengubah jadi tempat lain yang sudah ada ditolak');
  // setelah diarsipkan admin, tempat yang sama boleh dikirim ulang
  assert.strictEqual(e.ctx.setJelajahRecommendationDeleted({ sessionToken: ta, recommendationId: firstId, deleted: true }).success, true);
  assert.strictEqual(kirim(ts, { namaLokasi: 'Bakso Pak Kumis', lat: -6.1301, lng: 106.8402, placeId: 'PLACE123' }).success, true, 'arsip tidak dihitung');
});

// ---------------- v18 ----------------
function addSheet(e, name, rows) {
  e.ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet(name);
  rows.forEach(function (r) { e.sheets[name].data.push(r); });
}

test('v18 A8 simulasi: isi berawalan = + - @ tidak pernah menjadi rumus di sheet mana pun', function () {
  // (tidak dikosongkan: mencakup semua uji sebelumnya juga)
  const e = jelajahEnv({ config: [['PembersihanAkun', 'aktif']] });
  addSheet(e, 'RefData', [['Status_Wisma', 'Kategori'], ['Penyewa', 'Kebersihan'], ['Penghuni BAST', '']]);
  const evil = '=HYPERLINK("http://jahat.example","klik")';
  // registrasi + profil
  e.ctx.registerUser({ username: 'dina', pin: '123456', pinConfirm: '123456' });
  const td = login(e, 'dina');
  let r = e.ctx.updateProfile({ sessionToken: td, nama: evil, nomorWhatsApp: '081234567890', statusWisma: 'Penyewa', lantai: '', unit: '' });
  assert.strictEqual(r.success, true, r.message);
  // Jelajah: rekomendasi, ulasan, laporan
  e.ctx.getJelajahSekitar(td);
  r = e.ctx.submitJelajahRecommendation({ sessionToken: td, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: '+cmd|calc', lat: -6.13, lng: 106.84, keterangan: '-2+3 enak', alamat: '@SUM(1,2)', jamBuka: '=NOW()' });
  assert.strictEqual(r.success, true, r.message);
  const recId = r.id;
  assert.strictEqual(e.ctx.submitJelajahReview({ sessionToken: login(e, 'budi'), recommendationId: recId, rating: 5, comment: '=IMPORTXML("x","y")' }).success, true);
  e.ctx.submitJelajahReport({ sessionToken: login(e, 'sari'), recommendationId: recId, alasan: 'Sudah tutup', catatan: '@catatan' });
  // masukan aplikasi
  e.ctx.submitAppFeedback({ sessionToken: td, nama: evil, kategori: 'Lainnya', masukan: '=1+1 tolong perbaiki ya' });
  // agenda: buat lalu ubah (jalur baca-ubah-tulis baris utuh)
  const ta = login(e, 'admin1');
  r = e.ctx.saveAgenda({ sessionToken: ta, date: '2026-12-01', startTime: '09:00', endTime: '10:00', title: '-Kerja bakti', location: '+Lobi', detail: '=bawa sapu' });
  assert.strictEqual(r.success, true, r.message);
  const agendaId = r.id || (e.sheets.AgendaTower2 && e.sheets.AgendaTower2.data[1][0]);
  r = e.ctx.saveAgenda({ sessionToken: ta, id: agendaId, date: '2026-12-01', startTime: '09:00', endTime: '11:00', title: '-Kerja bakti', location: '+Lobi', detail: '=bawa sapu' });
  assert.strictEqual(r.success, true, r.message);
  // pembersihan otomatis menyalin baris ke arsip
  e.ctx.registerUser({ username: 'lupa', pin: '123456', pinConfirm: '123456' });
  const lupaRow = wargaRow(e, 'lupa'); lupaRow[col(e, 'Nama')] = '=IMPORTRANGE("x","y")';
  e.advance(8 * DAY);
  e.ctx.jalankanPembersihanAkunHarian();
  // hapus akun mandiri (scrub per sel)
  r = e.ctx.deleteMyAccount({ sessionToken: login(e, 'dina'), pin: '123456', konfirmasi: 'HAPUS' });
  assert.strictEqual(r.success, true, r.message);
  assert.deepStrictEqual(FORMULA_HITS.map(function (h) { return h.sheet + ': ' + h.value; }), [], 'tidak boleh ada teks yang menjadi rumus');
});

test('v18: hapus akun mandiri menghapus data pribadi dan menganonimkan isi yang dibagikan', function () {
  const e = jelajahEnv();
  addSheet(e, 'RefData', [['Status_Wisma'], ['Penyewa']]);
  addSheet(e, 'Data Aspirasi', [['ID', 'Timestamp', 'Username', 'Email_Pengisi', 'Nama', 'Status_Wisma', 'Lantai', 'Unit', 'Nomor_WhatsApp', 'Detail_Aspirasi'],
    ['a1', new Date(), 'budi', 'budi', 'Budi', 'Penghuni', '03', '0301', '628120000', 'Lampu mati'],
    ['a2', new Date(), 'sari', 'sari', 'Sari', 'Penghuni', '04', '0402', '628130000', 'Air bocor']]);
  const tb = login(e, 'budi');
  e.ctx.getJelajahSekitar(tb);
  const rec = e.ctx.submitJelajahRecommendation({ sessionToken: tb, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'Bakso Budi', lat: -6.13, lng: 106.84 });
  e.ctx.toggleJelajahFavorite({ sessionToken: tb, recommendationId: rec.id });
  e.ctx.submitJelajahReview({ sessionToken: tb, recommendationId: rec.id, rating: 4, comment: 'Enak' });
  // ditolak: konfirmasi salah, PIN salah, admin
  assert.strictEqual(e.ctx.deleteMyAccount({ sessionToken: tb, pin: '123456', konfirmasi: 'hapus dong' }).success, false);
  assert.strictEqual(e.ctx.deleteMyAccount({ sessionToken: tb, pin: '000000', konfirmasi: 'HAPUS' }).success, false);
  assert.ok(wargaRow(e, 'budi'), 'PIN salah tidak menghapus');
  assert.strictEqual(e.ctx.deleteMyAccount({ sessionToken: login(e, 'admin1'), pin: '123456', konfirmasi: 'HAPUS' }).success, false, 'admin tidak bisa hapus diri');
  // berhasil
  const r = e.ctx.deleteMyAccount({ sessionToken: tb, pin: '123456', konfirmasi: 'hapus' });
  assert.strictEqual(r.success, true, r.message);
  assert.ok(!wargaRow(e, 'budi'), 'baris akun hilang');
  assert.throws(function () { e.ctx.getJelajahSekitar(tb); }, /Sesi/, 'sesi lama tidak berlaku');
  assert.strictEqual(e.ctx.loginWithPin({ username: 'budi', pin: '123456' }).success, false, 'tidak bisa login lagi');
  const asp = e.sheets['Data Aspirasi'].data;
  assert.deepStrictEqual(asp[1].slice(2, 7).concat(asp[1][9]), ['', '', 'Warga B. (akun dihapus)', 'Penghuni', '03', 'Lampu mati'], 'aspirasi tetap, nama jadi inisial');
  assert.ok(/^enc:[0-9a-f]{16}$/.test(asp[1][8]), 'nomor WA tersandi: ' + asp[1][8]);
  assert.ok(/^enc:[0-9a-f]{16}$/.test(asp[1][7]), 'unit tersandi');
  assert.ok(String(asp[1][8]).indexOf('628120000') < 0 && asp[1][7] !== '0301');
  assert.strictEqual(e.ctx.sealPersonalValue_('0812-3456-7890', 'wa'), e.ctx.sealPersonalValue_('6281234567890', 'wa'), 'nomor sama -> sandi sama');
  assert.strictEqual(asp[2][4], 'Sari', 'aspirasi warga lain tidak tersentuh');
  const recRow = e.sheets.JelajahRekomendasi.data.find(function (row) { return row[0] === rec.id; });
  assert.strictEqual(recRow[2], ''); assert.strictEqual(recRow[3], 'Warga (akun dihapus)');
  assert.ok(!e.sheets.JelajahFavorit.data.slice(1).some(function (row) { return row[0] === 'budi'; }), 'simpanan dihapus');
  const arsip = e.sheets.ArsipAkunDihapus.data;
  const last = arsip[arsip.length - 1];
  assert.strictEqual(last[1], 'Dihapus sendiri oleh pemilik akun');
  assert.ok(last.indexOf('Budi') < 0 && last.indexOf('0812') < 0, 'arsip tidak menyimpan nama/WA');
  assert.strictEqual(e.ctx.nameInitials_('budi santoso wijaya kusuma'), 'B.S.W.');
  // tempatnya tetap ada untuk warga lain, tanpa nama
  const list = e.ctx.getJelajahSekitar(login(e, 'sari')).recommendations;
  assert.strictEqual(list.find(function (x) { return x.id === rec.id; }).namaPengirim, 'Warga Tower 2');
});

test('v18 A3: warga lain melihat jenis warga, admin melihat nama asli di Kelola Jelajah', function () {
  const e = jelajahEnv();
  const tb = login(e, 'budi'), ta = login(e, 'admin1');
  e.ctx.getJelajahSekitar(tb);
  const rec = e.ctx.submitJelajahRecommendation({ sessionToken: tb, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'Mie Ayam Gang', lat: -6.13, lng: 106.84 });
  e.ctx.submitJelajahReview({ sessionToken: ta, recommendationId: rec.id, rating: 5, comment: 'Mantap' });
  const viewSari = e.ctx.getJelajahSekitar(login(e, 'sari')).recommendations.find(function (x) { return x.id === rec.id; });
  assert.strictEqual(viewSari.namaPengirim, 'Penghuni');
  assert.strictEqual(viewSari.featuredCommentName, 'Pengurus Tower 2');
  const detail = e.ctx.getJelajahRecommendationDetail ? e.ctx.getJelajahRecommendationDetail(login(e, 'sari'), rec.id) : null;
  if (detail) assert.ok(detail.comments.every(function (c) { return c.nama !== 'Admin' && c.nama !== 'admin1'; }));
  const adminView = e.ctx.getKelolaJelajah(ta).recommendations.find(function (x) { return x.id === rec.id; });
  assert.strictEqual(adminView.namaPengirim, 'Budi', 'admin tetap melihat nama asli');
});

test('v18 A5: notifikasi tercatat di LogNotifikasi; admin tidak melihat notifikasi pribadi', function () {
  const e = env({ warga: [['budi', '123456', 'Budi', '0812', 'Penyewa', '', '', 'user', 'true']], admins: [['admin1', '123456', 'Admin']] });
  e.ctx.registerPushToken({ sessionToken: login(e, 'admin1'), token: TOKEN('adm'), platform: 'android' });
  e.ctx.registerPushToken({ sessionToken: login(e, 'budi'), token: TOKEN('bud'), platform: 'android' });
  e.ctx.queuePush_({ admins: true }, { title: 'Aspirasi baru masuk', body: 'Kategori: Kebersihan', page: 'admin', tag: 'aspirasi-x' });
  e.ctx.queuePush_({ usernames: ['budi'] }, { title: 'Aspirasi Anda diperbarui', body: 'Selesai', page: 'riwayat' });
  const logRows = e.sheets.LogNotifikasi.data;
  assert.strictEqual(logRows.length, 3);
  assert.strictEqual(logRows[1][1], 'admin'); assert.strictEqual(logRows[1][7], 1, 'terkirim ke 1 perangkat admin');
  const sent = e.http.calls ? e.http.calls : null;
  const adminLog = e.ctx.getNotificationLog(login(e, 'admin1'));
  assert.strictEqual(adminLog.items.length, 1, 'admin hanya melihat notifikasi admin/semua');
  assert.throws(function () { e.ctx.getNotificationLog(login(e, 'budi')); });
});

test('v18 A4: bulatan Aspirasi = aspirasi baru yang belum ditangani; hilang di semua admin begitu satu admin menindaklanjuti', function () {
  const e = env({ admins: [['admin1', '123456', 'Admin Satu'], ['admin2', '123456', 'Admin Dua']] });
  addSheet(e, 'Data Aspirasi', [['ID', 'Timestamp', 'Username', 'Kategori', 'Detail_Aspirasi', 'StatusAspirasi', 'Sudah_Ditindaklanjuti', 'DibacaAdmin']]);
  const t1 = login(e, 'admin1'), t2 = login(e, 'admin2');
  e.ctx.registerPushToken({ sessionToken: t2, token: TOKEN('adm2'), platform: 'android' });
  assert.strictEqual(e.ctx.getNotificationSummary(t2).aspirasi, 0, 'kunjungan pertama menetapkan titik awal');
  e.ctx.getNotificationSummary(t1);
  e.advance(60 * 1000);
  e.sheets['Data Aspirasi'].data.push(['a1', new Date(START + 61000), 'budi', 'Kebersihan', 'Sampah menumpuk', 'Baru', 'Belum', 'Belum Dibaca'],
    ['a2', new Date(START + 61000), 'sari', 'Keamanan', 'Pintu rusak', 'Baru', 'Belum', 'Belum Dibaca']);
  e.advance(31 * 1000);
  assert.strictEqual(e.ctx.getNotificationSummary(t2).aspirasi, 2);
  assert.strictEqual(e.ctx.getNotificationSummary(t1).aspirasi, 2);
  // admin1 menindaklanjuti a1 -> langsung hilang di admin2 (cache dikosongkan untuk semua admin)
  e.http.calls.length = 0;
  assert.strictEqual(e.ctx.updateTindakLanjut({ sessionToken: t1, id: 'a1', status: 'Dibaca', catatan: 'Sedang dicek' }).success, true);
  assert.strictEqual(e.ctx.getNotificationSummary(t2).aspirasi, 1, 'yang sudah ditangani admin lain tidak dihitung');
  const sends = fcmSends(e).map(function (c) { return JSON.parse(c.params.payload).message; });
  const handled = sends.find(function (m) { return m.notification.title === 'Aspirasi sudah ditangani'; });
  assert.ok(handled, 'admin lain dikabari');
  assert.strictEqual(handled.android.notification.tag, 'aspirasi-a1', 'mengganti notifikasi lama di HP admin lain');
  const sendCall = fcmSends(e)[0];
  assert.strictEqual(e.http.lockAtCall[e.http.calls.indexOf(sendCall)], 0, 'dikirim setelah kunci dilepas');
  // mengubah catatan lagi tidak membuat aspirasi muncul sebagai "baru"
  e.advance(31 * 1000);
  e.ctx.updateTindakLanjut({ sessionToken: t1, id: 'a1', status: 'Diselesaikan', catatan: 'Beres' });
  assert.strictEqual(e.ctx.getNotificationSummary(t2).aspirasi, 1);
  // admin2 membuka halaman Aspirasi -> sudah dibaca, bulatan hilang
  e.ctx.markNotificationSeen(t2, 'aspirasi');
  assert.strictEqual(e.ctx.getNotificationSummary(t2).aspirasi, 0);
  assert.strictEqual(e.ctx.getNotificationSummary(t1).aspirasi, 1, 'admin1 belum membuka halaman, a2 masih baru');
});

test('v18 A6: Log Pengelolaan memuat aksi baru dan kategori sistem hanya untuk Super Admin', function () {
  const e = jelajahEnv();
  const ta = login(e, 'admin1');
  e.ctx.getJelajahSekitar(ta);
  e.ctx.submitJelajahRecommendation({ sessionToken: ta, kategori: 'Restoran', jenis: 'Bakso', namaLokasi: 'Soto Pojok', lat: -6.13, lng: 106.84 });
  const jl = e.ctx.getManagementLog(ta, 'jelajah');
  assert.ok(jl.data.some(function (x) { return x.action === 'SUBMIT_JELAJAH_RECOMMENDATION'; }));
  assert.strictEqual(e.ctx.getManagementLog(ta, 'akun').authorized, false);
  assert.strictEqual(e.ctx.getManagementLog(ta, 'logSystem').authorized, false);
});

test('v18 A7: daftar admin di-cache, tetapi pencabutan admin lewat aplikasi berlaku seketika', function () {
  const e = env({ admins: [['admin1', '123456', 'A']], warga: [['admin1', '123456', 'A', '', 'Penyewa', '', '', 'user', 'true']] });
  const ta = login(e, 'admin1');
  assert.strictEqual(e.ctx.isAdminUsername_('admin1'), true);
  e.ctx.bumpSessionVersion_('admin1');
  e.sheets.Admins.data.splice(1, 1);
  assert.strictEqual(e.ctx.isAdminUsername_('admin1'), false, 'cache dikosongkan saat sesi admin dicabut');
  assert.throws(function () { e.ctx.getNotificationSummary(ta); });
});

test('v18 A11: Super Admin tidak bisa "turun" jadi admin/warga, dan ID aspirasi diperbaiki otomatis', function () {
  const e = env({ admins: [['boss', '654321', 'nyasar']], warga: [['boss', '654321', 'Boss', '', 'Penyewa', '', '', 'user', 'true']] });
  e.props.SUPER_ADMIN_USERNAME = 'boss';
  e.props.SUPER_ADMIN_PIN_HASH = e.ctx.makePinHash_('123456');
  const ok = e.ctx.loginWithPin({ username: 'boss', pin: '123456' });
  assert.strictEqual(ok.user.isSuperAdmin, true);
  const wrong = e.ctx.loginWithPin({ username: 'boss', pin: '654321' });
  assert.strictEqual(wrong.success, false, 'PIN baris Admins/WargaBaru tidak boleh membuat Super Admin masuk sebagai admin/warga');
  assert.strictEqual(e.ctx.registerUser({ username: 'BOSS', pin: '111111', pinConfirm: '111111' }).success, false);
  assert.strictEqual(e.ctx.addAdmin({ sessionToken: ok.user.sessionToken, username: 'boss', pin: '222222' }).success, false);
  // ID kosong dan kembar diperbaiki pemicu harian
  addSheet(e, 'Data Aspirasi', [['ID', 'Timestamp', 'Kategori'], ['X1', new Date(), 'A'], ['', new Date(), 'B'], ['X1', new Date(), 'C'], ['', '', '']]);
  const fixed = e.ctx.repairAspirasiIds_();
  deq(fixed, { kosong: 1, kembar: 1 });
  const ids = e.sheets['Data Aspirasi'].data.slice(1, 4).map(function (r) { return r[0]; });
  assert.strictEqual(new Set(ids).size, 3); assert.strictEqual(ids[0], 'X1');
  assert.ok(/^A[0-9A-F]{9}$/.test(ids[1]));
  assert.strictEqual(e.sheets['Data Aspirasi'].data[4][0], '', 'baris kosong dibiarkan');
});

// ---------------- v19 ----------------
function papanEnv() {
  const e = jelajahEnv();
  addSheet(e, 'Data Aspirasi', [['ID', 'Timestamp', 'Username', 'Nama', 'Unit', 'Nomor_WhatsApp', 'Kategori', 'Detail_Aspirasi', 'StatusAspirasi', 'Sudah_Ditindaklanjuti'],
    ['A1', new Date(START - 2 * DAY), 'budi', 'Budi Santoso', '1207', '6281234567890', 'Lift', 'Lift B berhenti di lantai 12, anak saya takut', 'Baru', 'Belum'],
    ['A2', new Date(START - DAY), 'sari', 'Sari', '0402', '6281300000000', 'Kebersihan', 'Sampah menumpuk', 'Baru', 'Belum']]);
  return e;
}

test('v19 Papan: hanya aspirasi yang dipilih admin tampil, tanpa data pribadi; "Saya juga" dan sembunyikan oleh pelapor', function () {
  const e = papanEnv();
  const ta = login(e, 'admin1'), tb = login(e, 'budi'), ts = login(e, 'sari');
  assert.strictEqual(e.ctx.getPapanTindakLanjut(ts).items.length, 0, 'belum ada yang dipublikasikan');
  // validasi admin
  assert.strictEqual(e.ctx.setAspirasiPublik({ sessionToken: ta, id: 'A1', publik: true, judul: 'Lift B sering berhenti', lokasi: 'Lift' }).success, false, 'wajib konfirmasi privasi');
  assert.strictEqual(e.ctx.setAspirasiPublik({ sessionToken: ta, id: 'A1', publik: true, judul: 'Hubungi 081234567890', lokasi: 'Lift', konfirmasiPrivasi: true }).success, false, 'nomor telepon ditolak');
  assert.throws(function () { e.ctx.setAspirasiPublik({ sessionToken: tb, id: 'A1', publik: true, judul: 'Lift B', konfirmasiPrivasi: true }); }, 'warga tidak bisa mempublikasikan');
  e.http.calls.length = 0;
  let r = e.ctx.setAspirasiPublik({ sessionToken: ta, id: 'A1', publik: true, judul: 'Lift B sering berhenti mendadak', lokasi: 'Lift', catatan: '', konfirmasiPrivasi: true });
  assert.strictEqual(r.success, true, r.message);
  const pushed = fcmSends(e).length + (e.sheets.LogNotifikasi ? e.sheets.LogNotifikasi.data.filter(function (x) { return x[3] === 'Aspirasi Anda tampil di Papan Tindak Lanjut'; }).length : 0);
  assert.ok(pushed >= 1, 'pelapor dikabari');
  const board = e.ctx.getPapanTindakLanjut(ts);
  assert.strictEqual(board.items.length, 1);
  const json = JSON.stringify(board);
  ['Budi', '1207', '628123', 'anak saya', 'budi'].forEach(function (secret) { assert.ok(json.indexOf(secret) < 0, 'tidak boleh bocor: ' + secret); });
  assert.strictEqual(board.items[0].statusLabel, 'Menunggu dibaca pengurus');
  assert.strictEqual(board.stats.masuk >= 2, true);
  // tindak lanjut -> linimasa
  e.advance(2 * 3600 * 1000);
  assert.strictEqual(e.ctx.updateTindakLanjut({ sessionToken: ta, id: 'A1', status: 'Dibaca', catatan: 'Dicek' }).success, true);
  let detail = e.ctx.getPapanDetail(ts, 'A1').item;
  assert.strictEqual(detail.step, 2); assert.ok(detail.timeline[1].waktu, 'waktu dibaca tercatat');
  e.ctx.setAspirasiPublik({ sessionToken: ta, id: 'A1', publik: true, judul: 'Lift B sering berhenti mendadak', lokasi: 'Lift', catatan: 'Teknisi datang Rabu', konfirmasiPrivasi: true });
  assert.strictEqual(e.ctx.getPapanDetail(ts, 'A1').item.step, 3);
  assert.ok(e.ctx.getPapanTindakLanjut(ts).stats.rataTanggapJam > 0);
  // Saya juga
  assert.strictEqual(e.ctx.toggleAspirasiDukungan({ sessionToken: tb, id: 'A1' }).success, false, 'pelapor tidak mendukung miliknya');
  r = e.ctx.toggleAspirasiDukungan({ sessionToken: ts, id: 'A1' });
  assert.deepStrictEqual([r.didukung, r.dukungan], [true, 1]);
  assert.strictEqual(e.ctx.getPapanTindakLanjut(ts).items[0].didukung, true);
  r = e.ctx.toggleAspirasiDukungan({ sessionToken: ts, id: 'A1' });
  assert.deepStrictEqual([r.didukung, r.dukungan], [false, 0]);
  assert.strictEqual(e.ctx.toggleAspirasiDukungan({ sessionToken: ts, id: 'A2' }).success, false, 'yang tidak publik tidak bisa didukung');
  // selesai
  e.ctx.updateTindakLanjut({ sessionToken: ta, id: 'A1', status: 'Diselesaikan', catatan: 'Beres' });
  detail = e.ctx.getPapanDetail(ts, 'A1').item;
  assert.strictEqual(detail.step, 4); assert.strictEqual(detail.statusLabel, 'Selesai');
  // pelapor menyembunyikan
  assert.strictEqual(e.ctx.hideMyAspirasiFromPapan({ sessionToken: ts, id: 'A1' }).success, false, 'bukan pelapor');
  assert.strictEqual(e.ctx.getRiwayatSaya('budi', tb)[0].tampilDiPapan, true);
  assert.strictEqual(e.ctx.hideMyAspirasiFromPapan({ sessionToken: tb, id: 'A1' }).success, true);
  assert.strictEqual(e.ctx.getPapanTindakLanjut(ts).items.length, 0);
  assert.strictEqual(e.ctx.getPapanDetail(ts, 'A1').success, false);
});

test('v19 Apresiasi: langsung tampil, label jenis warga, hapus oleh penulis/admin saja, batas harian', function () {
  const e = jelajahEnv();
  const tb = login(e, 'budi'), ts = login(e, 'sari'), ta = login(e, 'admin1');
  assert.strictEqual(e.ctx.submitApresiasi({ sessionToken: tb, untuk: 'Hacker', pesan: 'Terima kasih' }).success, false);
  assert.strictEqual(e.ctx.submitApresiasi({ sessionToken: tb, untuk: 'Keamanan', pesan: 'Telp 081234567890 ya' }).success, false);
  let r = e.ctx.submitApresiasi({ sessionToken: tb, untuk: 'Keamanan', untukDetail: 'Pak satpam malam', pesan: '=HYPERLINK("x") terima kasih sudah bantu bawa belanjaan' });
  assert.strictEqual(r.success, true, r.message);
  const id = r.id;
  let list = e.ctx.getApresiasi(ts).items;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].dari, 'Penghuni'); assert.strictEqual(list[0].bisaHapus, false);
  assert.strictEqual(e.ctx.getApresiasi(tb).items[0].milikSaya, true);
  assert.strictEqual(e.ctx.getApresiasi(ta).items[0].bisaHapus, true);
  r = e.ctx.toggleApresiasiDukungan({ sessionToken: ts, id: id });
  assert.deepStrictEqual([r.didukung, r.dukungan], [true, 1]);
  assert.strictEqual(e.ctx.deleteApresiasi({ sessionToken: ts, id: id }).success, false, 'warga lain tidak bisa hapus');
  assert.strictEqual(e.ctx.deleteApresiasi({ sessionToken: tb, id: id }).success, true, 'penulis bisa hapus');
  assert.strictEqual(e.ctx.getApresiasi(ts).items.length, 0);
  r = e.ctx.submitApresiasi({ sessionToken: ts, untuk: 'Kebersihan', pesan: 'Lorong selalu bersih' });
  assert.strictEqual(e.ctx.deleteApresiasi({ sessionToken: ta, id: r.id }).success, true, 'admin bisa moderasi');
  for (let i = 0; i < 4; i++) assert.strictEqual(e.ctx.submitApresiasi({ sessionToken: ts, untuk: 'Teknisi', pesan: 'Terima kasih ke-' + i }).success, true);
  assert.strictEqual(e.ctx.submitApresiasi({ sessionToken: ts, untuk: 'Teknisi', pesan: 'Satu lagi ya' }).success, false, 'batas 5 per hari');
  assert.strictEqual(e.ctx.getManagementLog(ta, 'papan').data.filter(function (x) { return x.action === 'DELETE_APRESIASI'; }).length, 1, 'admin biasa hanya melihat aksinya sendiri');
});

test('v19 A12: usulan agenda — tanggal lampau ditolak, admin dan pengusul dikabari, masuk bulatan dan Perlu Tindakan', function () {
  const e = env({ warga: [['budi', '123456', 'Budi', '0812', 'Penyewa', '', '', 'user', 'true']], admins: [['admin1', '123456', 'A'], ['admin2', '123456', 'B']] });
  const tb = login(e, 'budi'), t1 = login(e, 'admin1'), t2 = login(e, 'admin2');
  ['adm1', 'adm2', 'bud'].forEach(function (k, i) { e.ctx.registerPushToken({ sessionToken: [t1, t2, tb][i], token: TOKEN(k), platform: 'android' }); });
  e.ctx.getNotificationSummary(t2);
  e.advance(60 * 1000);
  assert.strictEqual(e.ctx.submitAgendaProposal({ sessionToken: tb, title: 'Kerja bakti', date: '2026-11-10', startTime: '08:00' }).success, false, 'tanggal lampau');
  e.http.calls.length = 0;
  const r = e.ctx.submitAgendaProposal({ sessionToken: tb, title: 'Kerja bakti lantai 12', date: '2026-11-29', startTime: '08:00', location: 'Lobi' });
  assert.strictEqual(r.success, true, r.message);
  let msgs = fcmSends(e).map(function (c) { return JSON.parse(c.params.payload).message; });
  assert.strictEqual(msgs.filter(function (m) { return m.notification.title === 'Usulan agenda baru'; }).length, 2, 'dua admin dikabari');
  e.advance(31 * 1000);
  assert.strictEqual(e.ctx.getNotificationSummary(t2).agendaUsulan, 1);
  const pending = e.ctx.getPendingWork(t2);
  assert.strictEqual(pending.agendaUsulan.total, 1); assert.strictEqual(pending.agendaUsulan.items[0].judul, 'Kerja bakti lantai 12');
  e.http.calls.length = 0;
  assert.strictEqual(e.ctx.reviewAgendaProposal({ sessionToken: t1, id: r.id, decision: 'reject', note: 'Bentrok dengan fogging' }).success, true);
  msgs = fcmSends(e).map(function (c) { return { m: JSON.parse(c.params.payload).message, token: JSON.parse(c.params.payload).message.token }; });
  const toBudi = msgs.filter(function (x) { return x.token === TOKEN('bud'); }).map(function (x) { return x.m.notification; });
  assert.strictEqual(toBudi.length, 1); assert.ok(/belum disetujui/.test(toBudi[0].title) && /fogging/.test(toBudi[0].body));
  assert.ok(msgs.some(function (x) { return x.token === TOKEN('adm2') && x.m.android.notification.tag === 'agenda-usulan-' + r.id; }), 'notifikasi admin lain diganti');
  assert.strictEqual(e.ctx.getNotificationSummary(t2).agendaUsulan, 0, 'hilang setelah diperiksa admin lain');
});

test('v19: penulisan baris warga dibatalkan bila baris bergeser', function () {
  const e = env({ warga: [['budi', '123456', 'Budi', '0812', 'Penyewa', '', '', 'user', 'true'], ['sari', '123456', 'Sari', '0813', 'Penyewa', '', '', 'user', 'true']] });
  const sheet = e.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('WargaBaru');
  assert.doesNotThrow(function () { e.ctx.assertRowOwner_(sheet, 2, 0, 'budi'); });
  e.sheets.WargaBaru.data.splice(1, 1); // baris 2 kini milik sari
  assert.throws(function () { e.ctx.assertRowOwner_(sheet, 2, 0, 'budi'); }, /Muat ulang/);
});

test('v19 retensi: log lama dipangkas, aspirasi >3 tahun dianonimkan, apresiasi terhapus dibuang', function () {
  const e = papanEnv();
  const old = new Date(START - 4 * 365 * DAY), recent = new Date(START - 10 * DAY);
  e.sheets['Data Aspirasi'].data.push(['A9', old, 'lama', 'Lama Sekali', '0909', '6281111111111', 'Lift', 'Lama', 'Diselesaikan', 'Sudah']);
  addSheet(e, 'AuditLog', [['Timestamp', 'Action', 'Actor', 'Target', 'Detail'], [new Date(START - 400 * DAY), 'X', 'a', '', ''], [recent, 'Y', 'a', '', '']]);
  addSheet(e, 'Apresiasi', [['ID', 'CreatedAt', 'Username', 'Untuk', 'UntukDetail', 'Pesan', 'Status', 'DihapusOleh', 'DihapusPada'],
    ['P1', old, 'budi', 'Teknisi', '', 'x', 'Dihapus', 'budi', new Date(START - 100 * DAY)], ['P2', recent, 'budi', 'Teknisi', '', 'y', 'Aktif', '', '']]);
  const rep = e.ctx.applyDataRetention_();
  assert.strictEqual(rep.auditLog, 1); assert.strictEqual(rep.apresiasiDihapus, 1); assert.strictEqual(rep.aspirasi, 1);
  const row = e.sheets['Data Aspirasi'].data.find(function (r) { return r[0] === 'A9'; });
  assert.strictEqual(row[3], 'Warga L.S. (diarsipkan)'); assert.strictEqual(row[2], '');
  assert.ok(/^enc:/.test(row[4]) && /^enc:/.test(row[5]));
  assert.strictEqual(e.sheets['Data Aspirasi'].data.find(function (r) { return r[0] === 'A1'; })[3], 'Budi Santoso', 'aspirasi baru tidak tersentuh');
  assert.strictEqual(e.ctx.applyDataRetention_().aspirasi, 0, 'tidak diproses dua kali');
});

test('v19 FAQ: entri fitur baru ditambahkan sekali ke FAQ yang sudah ada tanpa menimpa isi', function () {
  const e = env({});
  e.props.FAQ_SEEDED = '1';
  addSheet(e, 'FAQ', [['ID', 'Bagian', 'Peran', 'Pertanyaan', 'Jawaban', 'Urutan', 'UpdatedAt', 'UpdatedBy'],
    ['FAQ-001', 'Umum', 'warga', 'Pertanyaan buatan admin', 'Jawaban admin', 10, new Date(), 'admin1'],
    ['FAQ-002', 'Dinding Apresiasi', 'warga', 'Apa itu Dinding Apresiasi?', 'Versi admin sendiri', 20, new Date(), 'admin1']]);
  e.ctx.ensureFaqSheet_();
  const rows = e.sheets.FAQ.data;
  assert.strictEqual(rows[1][4], 'Jawaban admin', 'isi lama tetap');
  assert.strictEqual(rows.filter(function (r) { return r[3] === 'Apa itu Dinding Apresiasi?'; }).length, 1, 'pertanyaan yang sudah ada tidak digandakan');
  assert.strictEqual(rows.length, 3 + 7 + 3, '7 entri v19 (1 sudah ada) + 3 entri v20');
  e.ctx.ensureFaqSheet_();
  assert.strictEqual(e.sheets.FAQ.data.length, 13, 'hanya sekali');
});

test('v20 FAQ: instalasi yang sudah v19 hanya mendapat entri v20, lewat pemicu harian', function () {
  const e = env({});
  e.props.FAQ_SEEDED = '1'; e.props.FAQ_V19 = '1';
  addSheet(e, 'FAQ', [['ID', 'Bagian', 'Peran', 'Pertanyaan', 'Jawaban', 'Urutan', 'UpdatedAt', 'UpdatedBy'],
    ['FAQ-001', 'Umum', 'warga', 'Pertanyaan buatan admin', 'Jawaban admin', 10, new Date(), 'admin1']]);
  const rep = e.ctx.jalankanPembersihanAkunHarian();
  assert.strictEqual(rep.faqBaru, true);
  const rows = e.sheets.FAQ.data;
  assert.strictEqual(rows.length, 2 + 3);
  assert.ok(rows.some(function (r) { return r[0] === 'FAQ-V20-01' && /17\.00/.test(r[4]); }));
  assert.strictEqual(e.props.FAQ_V20, '1');
  assert.ok(!e.ctx.jalankanPembersihanAkunHarian().faqBaru, 'tidak diulang');
});

test('v20 A12: kejadian agenda mingguan dan bulanan (tanggal 31 dilewati di bulan pendek)', function () {
  const e = env({});
  const occ = function (row, a, b) { return e.ctx.agendaOccurrences_(row, a, b).join(','); };
  assert.strictEqual(occ({ Tanggal: '2026-12-01', Ulang: 'mingguan', UlangSampai: '2026-12-29' }, '2026-11-01', '2027-01-31'), '2026-12-01,2026-12-08,2026-12-15,2026-12-22,2026-12-29');
  assert.strictEqual(occ({ Tanggal: '2027-01-31', Ulang: 'bulanan', UlangSampai: '2027-06-30' }, '2027-01-01', '2027-12-31'), '2027-01-31,2027-03-31,2027-05-31');
  assert.strictEqual(occ({ Tanggal: '2026-12-01', Ulang: 'mingguan', UlangSampai: '2027-03-01' }, '2027-01-01', '2027-01-31'), '2027-01-05,2027-01-12,2027-01-19,2027-01-26', 'hanya di rentang yang diminta');
  assert.strictEqual(occ({ Tanggal: '2026-12-01', Ulang: '', UlangSampai: '' }, '2026-12-01', '2026-12-31'), '2026-12-01', 'agenda biasa tetap satu');
  assert.strictEqual(occ({ Tanggal: '2026-12-01', Ulang: 'tahunan', UlangSampai: '2027-12-01' }, '2026-12-01', '2027-12-31'), '2026-12-01', 'mode asing diabaikan');
});

test('v20 A12: simpan agenda berulang — validasi, kalender bulan berikutnya, kelola, ubah seri', function () {
  const e = env({ warga: [['budi', '123456', 'Budi', '0812', 'Penyewa', '', '', 'user', 'true']], admins: [['admin1', '123456', 'A']] });
  const ta = login(e, 'admin1'), tb = login(e, 'budi');
  const base = { sessionToken: ta, date: '2026-12-02', startTime: '19:00', endTime: '20:00', title: 'Ronda malam', location: 'Pos satpam', detail: '' };
  const save = function (extra) { return e.ctx.saveAgenda(Object.assign({}, base, extra)); };
  assert.strictEqual(save({ repeat: 'mingguan' }).success, false, 'tanggal akhir wajib');
  assert.strictEqual(save({ repeat: 'mingguan', repeatUntil: '2026-12-01' }).success, false, 'akhir sebelum mulai ditolak');
  assert.strictEqual(save({ repeat: 'mingguan', repeatUntil: '2028-01-01' }).success, false, 'lebih dari 1 tahun ditolak');
  assert.strictEqual(save({ repeat: 'harian', repeatUntil: '2026-12-31' }).success, false, 'mode asing ditolak');
  const r = save({ repeat: 'mingguan', repeatUntil: '2027-01-27' });
  assert.strictEqual(r.success, true, r.message);
  const id = r.id || e.sheets.AgendaTower2.data[1][0];
  const dec = e.ctx.getAgendaCalendar(tb, 2026, 12).events.filter(function (ev) { return ev.title === 'Ronda malam'; });
  assert.strictEqual(dec.map(function (ev) { return ev.date; }).join(','), '2026-12-02,2026-12-09,2026-12-16,2026-12-23,2026-12-30');
  assert.ok(dec.every(function (ev) { return ev.id === id && ev.seriesDate === '2026-12-02' && ev.repeat === 'mingguan'; }));
  assert.ok(/^Setiap minggu s\.d\. /.test(dec[0].repeatLabel), dec[0].repeatLabel);
  const jan = e.ctx.getAgendaCalendar(tb, 2027, 1).events.filter(function (ev) { return ev.title === 'Ronda malam'; });
  assert.strictEqual(jan.map(function (ev) { return ev.date; }).join(','), '2027-01-06,2027-01-13,2027-01-20,2027-01-27', 'kejadian berlanjut ke bulan berikutnya');
  assert.strictEqual(e.ctx.getAgendaCalendar(tb, 2027, 2).events.filter(function (ev) { return ev.title === 'Ronda malam'; }).length, 0, 'berhenti setelah tanggal akhir');
  const mgmt = e.ctx.getAgendaManagementData(ta);
  const item = mgmt.agenda.find(function (x) { return x.id === id; });
  assert.ok(item, 'muncul di kelola agenda'); assert.strictEqual(item.repeat, 'mingguan'); assert.strictEqual(item.repeatUntil, '2027-01-27');
  // ubah seri menjadi tidak berulang: cache Januari ikut dibersihkan
  const r2 = save({ id: id, repeat: '', repeatUntil: '' });
  assert.strictEqual(r2.success, true, r2.message);
  assert.strictEqual(e.ctx.getAgendaCalendar(tb, 2027, 1).events.filter(function (ev) { return ev.title === 'Ronda malam'; }).length, 0, 'kejadian Januari hilang setelah seri diubah');
  assert.strictEqual(e.ctx.getAgendaCalendar(tb, 2026, 12).events.filter(function (ev) { return ev.title === 'Ronda malam'; }).length, 1);
});

test('v20 A12: pengingat agenda H-1 — penjaga pemicu, satu/banyak agenda, seri berulang, tanpa duplikat', function () {
  const e = env({ warga: [['budi', '123456', 'Budi', '0812', 'Penyewa', '', '', 'user', 'true']], admins: [['admin1', '123456', 'A']] });
  const ta = login(e, 'admin1'), tb = login(e, 'budi');
  e.ctx.registerPushToken({ sessionToken: tb, token: TOKEN('bud'), platform: 'android' });
  e.ctx.registerPushToken({ sessionToken: ta, token: TOKEN('adm'), platform: 'android' });
  // pemicu: dibuat sekali, tidak digandakan
  assert.strictEqual(e.ctx.ensureAgendaReminderTrigger_(false), true);
  assert.strictEqual(e.ctx.ensureAgendaReminderTrigger_(false), false);
  const trig = e.ctx.ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'kirimPengingatAgendaHarian'; });
  assert.strictEqual(trig.length, 1); assert.strictEqual(trig[0].spec.atHour, 17); assert.strictEqual(trig[0].spec.tz, 'Asia/Jakarta');
  // panggilan dari luar (pengunjung web) ditolak
  const e2 = createContext({ codePath: CODE, now: START, activeEmail: '', sheets: { SystemConfig: [['KEY', 'VALUE']], Admins: [['Username', 'PIN', 'Keterangan']], WargaBaru: [WARGA_HEADERS] } });
  assert.throws(function () { e2.ctx.kirimPengingatAgendaHarian({ triggerUid: 'palsu' }); }, /pemicu terjadwal/);
  // tidak ada agenda besok -> tidak mengirim apa pun
  e.http.calls.length = 0;
  assert.strictEqual(e.ctx.kirimPengingatAgendaHarian({ triggerUid: trig[0].getUniqueId() }).status, 'tidak ada agenda');
  assert.strictEqual(fcmSends(e).length, 0);
  // satu agenda besok (18 Nov 2026)
  e.advance(DAY); // sekarang 18 Nov -> besok 19 Nov
  assert.strictEqual(e.ctx.saveAgenda({ sessionToken: ta, date: '2026-11-19', startTime: '08:00', endTime: '', title: 'Fogging', location: 'Lantai 1-5', detail: '' }).success, true);
  e.http.calls.length = 0;
  let res = e.ctx.kirimPengingatAgendaHarian({ triggerUid: trig[0].getUniqueId() });
  assert.strictEqual(res.status, 'terkirim', JSON.stringify(res));
  let msgs = fcmSends(e).map(function (c) { return JSON.parse(c.params.payload).message; });
  assert.strictEqual(msgs.map(function (m) { return m.token; }).sort().join(','), [TOKEN('adm'), TOKEN('bud')].sort().join(','), 'semua warga dan admin');
  assert.strictEqual(msgs[0].notification.title, 'Besok: Fogging');
  assert.ok(/Lantai 1-5/.test(msgs[0].notification.body), msgs[0].notification.body);
  assert.strictEqual(msgs[0].android.notification.tag, 'agenda-besok-2026-11-19');
  e.http.calls.length = 0;
  assert.strictEqual(e.ctx.kirimPengingatAgendaHarian({ triggerUid: trig[0].getUniqueId() }).status, 'sudah dikirim');
  assert.strictEqual(fcmSends(e).length, 0, 'dijalankan dua kali tidak menggandakan');
  // banyak agenda, termasuk kejadian ke-2 dari seri mingguan (mulai 13 Nov)
  e.advance(7 * DAY); // 25 Nov -> besok 26 Nov
  e.sheets.AgendaTower2.data.push(['AG-LAMA', new Date(), 'admin1', '2026-11-12', '09:00', '', 'Senam pagi', 'Lapangan', '', 'Aktif']);
  const hdr = e.sheets.AgendaTower2.data[0];
  const lama = e.sheets.AgendaTower2.data[e.sheets.AgendaTower2.data.length - 1];
  const setCol = function (name, v) { const i = hdr.indexOf(name); assert.ok(i >= 0, 'kolom ' + name); lama[i] = v; };
  setCol('ID', 'AG-LAMA'); setCol('Tanggal', '2026-11-12'); setCol('JamMulai', '06:30'); setCol('Judul', 'Senam pagi'); setCol('Ulang', 'mingguan'); setCol('UlangSampai', '2026-12-31');
  if (hdr.indexOf('StatusAgenda') >= 0) setCol('StatusAgenda', 'Aktif');
  assert.strictEqual(e.ctx.saveAgenda({ sessionToken: ta, date: '2026-11-26', startTime: '19:30', endTime: '', title: 'Rapat warga', location: 'Aula', detail: '' }).success, true);
  e.http.calls.length = 0;
  res = e.ctx.kirimPengingatAgendaHarian({ triggerUid: trig[0].getUniqueId() });
  assert.strictEqual(res.jumlah, 2, JSON.stringify(res));
  msgs = fcmSends(e).map(function (c) { return JSON.parse(c.params.payload).message; });
  assert.strictEqual(msgs[0].notification.title, 'Besok ada 2 agenda Tower 2');
  assert.ok(/Senam pagi \(06:30\), Rapat warga \(19:30\)/.test(msgs[0].notification.body), msgs[0].notification.body);
  // agenda nonaktif tidak diingatkan
  assert.strictEqual(e.ctx.getSheetData_('AuditLog').filter(function (r) { return r.Action === 'PENGINGAT_AGENDA'; }).length, 2);
});

test('v20 A12: pemicu harian memasang pengingat bila belum ada', function () {
  const e = env({});
  const rep = e.ctx.jalankanPembersihanAkunHarian();
  const trig = e.ctx.ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'kirimPengingatAgendaHarian'; });
  assert.strictEqual(trig.length, 1, JSON.stringify(rep));
  e.ctx.jalankanPembersihanAkunHarian();
  assert.strictEqual(e.ctx.ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'kirimPengingatAgendaHarian'; }).length, 1, 'tidak digandakan');
});

test('v19 A8 menyeluruh: tidak ada teks yang menjadi rumus di semua uji di atas', function () {
  assert.deepStrictEqual(FORMULA_HITS.map(function (h) { return h.sheet + ': ' + h.value; }), []);
});

console.log('\n' + passed + ' uji backend v12 lulus');
