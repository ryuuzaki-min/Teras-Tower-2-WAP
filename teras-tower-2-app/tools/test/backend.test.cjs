// Uji backend v11: sesi persisten, pencabutan, logout, registrasi, router doPost.
// Jalankan: node tools/test/backend.test.cjs
'use strict';
const path = require('path');
const assert = require('assert');
const { createContext } = require('./gas-mock.cjs');
const CODE = path.join(__dirname, '..', '..', 'gas', 'Code.gs');

const WARGA_HEADERS = ['Username', 'PIN', 'Nama', 'Nomor_WhatsApp', 'Status_Wisma', 'Lantai', 'Unit', 'Role', 'ProfileComplete'];
function freshEnv() {
  return createContext({
    codePath: CODE,
    sheets: {
      WargaBaru: [WARGA_HEADERS],
      Admins: [['Username', 'PIN', 'Keterangan']],
      SystemConfig: [['KEY', 'VALUE']],
      AppInfo: [['Deskripsi', 'Penutup'], ['Halo warga', 'Salam']]
    }
  });
}
function post(env, fn, args) {
  const out = env.ctx.doPost({ postData: { contents: JSON.stringify({ fn: fn, args: args || [] }) } });
  return JSON.parse(out.getContent());
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('Backend v11');

test('registrasi + login dengan "Ingat saya" membuat baris sesi ber-hash', function () {
  const env = freshEnv();
  const reg = env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  assert.strictEqual(reg.success, true, reg.message);
  const login = env.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: true });
  assert.strictEqual(login.success, true, login.message);
  const token = login.user.sessionToken;
  const rows = env.sheets.SesiAplikasi.data;
  assert.strictEqual(rows.length, 2);
  assert.notStrictEqual(rows[1][0], token, 'token mentah tidak boleh tersimpan');
  assert.strictEqual(rows[1][0].length, 64);
  assert.strictEqual(env.sheets.SesiAplikasi.hidden, true);
  assert.strictEqual(login.user.sessionPersistent, true);
  assert.strictEqual(env.lockHeld(), 0);
});

test('sesi "Ingat saya" bertahan setelah cache habis (hari ke-10) dan diperpanjang', function () {
  const env = freshEnv();
  env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const token = env.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: true }).user.sessionToken;
  env.advance(10 * 24 * 3600 * 1000); env.clearCache();
  const s = env.ctx.requireSession_(token, ['resident']);
  assert.strictEqual(s.username, 'budi');
  const expires = new Date(env.sheets.SesiAplikasi.data[1][6]).getTime();
  assert.ok(expires > Date.UTC(2026, 10, 17) + 39 * 24 * 3600 * 1000, 'masa berlaku harus diperpanjang ~30 hari dari hari ke-10');
});

test('sesi "Ingat saya" kedaluwarsa setelah 31 hari tanpa dipakai', function () {
  const env = freshEnv();
  env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const token = env.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: true }).user.sessionToken;
  env.advance(31 * 24 * 3600 * 1000); env.clearCache();
  assert.throws(function () { env.ctx.requireSession_(token, ['resident']); }, /kedaluwarsa/);
});

test('tanpa "Ingat saya": tidak menulis sheet, habis setelah 6 jam', function () {
  const env = freshEnv();
  env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const token = env.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: false }).user.sessionToken;
  assert.ok(!env.sheets.SesiAplikasi, 'sheet sesi tidak perlu dibuat');
  assert.strictEqual(env.ctx.requireSession_(token, ['resident']).username, 'budi');
  env.advance(6 * 3600 * 1000 + 1000);
  assert.throws(function () { env.ctx.requireSession_(token, ['resident']); }, /kedaluwarsa/);
});

test('pencabutan (bumpSessionVersion_) membatalkan sesi persisten', function () {
  const env = freshEnv();
  env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const token = env.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: true }).user.sessionToken;
  env.ctx.bumpSessionVersion_('budi'); env.clearCache();
  assert.throws(function () { env.ctx.requireSession_(token, ['resident']); }, /dicabut/);
});

test('logout menghapus baris sesi dan cache', function () {
  const env = freshEnv();
  env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const token = env.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: true }).user.sessionToken;
  env.ctx.logoutSession(token);
  assert.strictEqual(env.sheets.SesiAplikasi.data.length, 1);
  assert.throws(function () { env.ctx.requireSession_(token, ['resident']); }, /kedaluwarsa/);
  assert.strictEqual(env.lockHeld(), 0);
});

test('requireSession_ dari dalam kunci tidak memicu kunci bersarang', function () {
  const env = freshEnv();
  env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  const token = env.ctx.loginWithPin({ username: 'budi', pin: '123456', remember: true }).user.sessionToken;
  env.advance(31 * 24 * 3600 * 1000); env.clearCache();
  env.ctx.withScriptLock_(function () {
    assert.throws(function () { env.ctx.requireSession_(token, ['resident']); }, /kedaluwarsa/);
  });
});

test('token palsu ditolak', function () {
  const env = freshEnv();
  assert.throws(function () { env.ctx.requireSession_('palsu', ['resident']); }, /kedaluwarsa/);
  assert.throws(function () { env.ctx.requireSession_('', ['resident']); }, /tidak ditemukan/);
});

test('registrasi ditutup lewat SystemConfig RegistrasiDibuka=false', function () {
  const env = freshEnv();
  env.sheets.SystemConfig.data.push(['RegistrasiDibuka', 'false']);
  const r = env.ctx.registerUser({ username: 'budi', pin: '123456', pinConfirm: '123456' });
  assert.strictEqual(r.success, false);
  assert.ok(/ditutup/.test(r.message));
  assert.strictEqual(env.sheets.WargaBaru.data.length, 1);
});

test('batas 30 registrasi per jam, terbuka lagi jam berikutnya', function () {
  const env = freshEnv();
  for (let i = 0; i < 30; i++) assert.strictEqual(env.ctx.registerUser({ username: 'w' + i + 'x', pin: '123456', pinConfirm: '123456' }).success, true);
  const blocked = env.ctx.registerUser({ username: 'w99x', pin: '123456', pinConfirm: '123456' });
  assert.strictEqual(blocked.success, false);
  assert.ok(/Terlalu banyak/.test(blocked.message));
  env.advance(3600 * 1000);
  assert.strictEqual(env.ctx.registerUser({ username: 'w99x', pin: '123456', pinConfirm: '123456' }).success, true);
});

test('doPost: memanggil fungsi yang diizinkan dan meneruskan argumen', function () {
  const env = freshEnv();
  post(env, 'registerUser', [{ username: 'sari', pin: '654321', pinConfirm: '654321' }]);
  const r = post(env, 'loginWithPin', [{ username: 'sari', pin: '654321', remember: true }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.result.success, true);
  const v = post(env, 'validateSession', [r.result.user.sessionToken]);
  assert.deepStrictEqual(v, { ok: true, result: { valid: true, username: 'sari', role: 'resident' } });
});

test('doPost: menolak fungsi privat, doGet, dan nama asing', function () {
  const env = freshEnv();
  ['requireSession_', 'setupSuperAdminCredentials_', 'doGet', 'doPost', 'include', 'constructor', '__proto__', 'eval'].forEach(function (name) {
    const r = post(env, name, []);
    assert.strictEqual(r.ok, false, name);
    assert.strictEqual(r.error, 'Fungsi tidak dikenal.');
  });
});

test('doPost: error yang dilempar diteruskan sebagai pesan (seperti google.script.run)', function () {
  const env = freshEnv();
  const r = post(env, 'getPendingWork', ['token-palsu']);
  assert.strictEqual(r.ok, false);
  assert.ok(/Sesi kedaluwarsa/.test(r.error), r.error);
});

test('doPost: body rusak ditangani', function () {
  const env = freshEnv();
  const out = JSON.parse(env.ctx.doPost({ postData: { contents: '{bukan json' } }).getContent());
  assert.deepStrictEqual(out, { ok: false, error: 'Permintaan tidak valid.' });
  const empty = JSON.parse(env.ctx.doPost({}).getContent());
  assert.strictEqual(empty.ok, false);
});

test('getBootstrap: hanya Deskripsi/Penutup + config + versi', function () {
  const env = freshEnv();
  env.sheets.SystemConfig.data.push(['ThemeColor', '#27CCF5']);
  const r = post(env, 'getBootstrap', []);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.result.appInfo, { Deskripsi: 'Halo warga', Penutup: 'Salam' });
  assert.strictEqual(r.result.systemConfig.ThemeColor, '#27CCF5');
  assert.strictEqual(r.result.appUrl, 'https://script.google.com/macros/s/TEST/exec');
});

console.log('\n' + passed + ' uji backend lulus');
