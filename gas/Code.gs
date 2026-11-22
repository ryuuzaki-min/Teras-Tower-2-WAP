// ===================================================================
// TERAS TOWER 2 - Backend Apps Script (v19 - PAPAN TINDAK LANJUT, DINDING APRESIASI, AGENDA TAHAP 1, RETENSI DATA, PRIVASI)
// ===================================================================

// SUPER ADMIN CREDENTIALS
// Credentials are configured once with setupSuperAdminCredentials_(username, pin)
// and stored as a salted SHA-256 hash in Script Properties. Never hardcode them here.
const PROP_SUPER_ADMIN_USERNAME = 'SUPER_ADMIN_USERNAME';
const PROP_SUPER_ADMIN_PIN_HASH = 'SUPER_ADMIN_PIN_HASH';
const PROP_SUPER_ADMIN_PIN_SALT = 'SUPER_ADMIN_PIN_SALT';
const PROP_PIN_HASH_PEPPER = 'PIN_HASH_PEPPER';
const SESSION_SCHEMA_VERSION = 'TT2-auth-hardening-v1';
const AUDIT_SHEET = 'AuditLog';

const SHEET_DATA = 'Data Aspirasi';
const SHEET_REFDATA = 'RefData';
const SHEET_ADMINS = 'Admins';
const SHEET_APPINFO = 'AppInfo';
const SHEET_SYSTEMCONFIG = 'SystemConfig';
const SHEET_WARGA = 'WargaBaru';
const SHEET_NOMORPENTING = 'NomorPenting';
const SHEET_NOMORDARURAT = 'NomorDarurat';
const SHEET_KEPUASAN = 'Kepuasan';
const SHEET_RESETREQUESTS = 'ResetPinRequests';
const SHEET_APPFEEDBACK = 'AppFeedback';
const SHEET_JELAJAH = 'JelajahRekomendasi';
const SHEET_JELAJAH_KATEGORI = 'JelajahKategori';
const SHEET_JELAJAH_JENIS = 'JelajahJenis';
const SHEET_JELAJAH_ULASAN = 'JelajahUlasan';
const SHEET_AGENDA = 'AgendaTower2';
const SHEET_AGENDA_PROPOSALS = 'UsulanAgenda';
const FLOOR_MIN_8O = 3;
const FLOOR_MAX_8O = 24;
const UNIT_SUFFIX_MIN_8O = 1;
const UNIT_SUFFIX_MAX_8O = 45;
const KATEGORI_KEPUASAN = ['Pengelola Gedung', 'Pengelola Parkir', 'Pengelola Food Court', 'Paguyuban'];
const BANNER_MAX = 5;
const ASPIRATION_STATUSES_8L = ['Baru', 'Dibaca', 'Diselesaikan', 'Ditolak'];
const ASPIRATION_PRIORITIES_8L = ['Sangat Tinggi', 'Tinggi', 'Rendah'];
const ASPIRATION_LOCATION_TYPES = ['Area umum', 'Lantai', 'Unit', 'Tidak diketahui'];
const BANNER_FOLDER = 'Teras Tower 2 - Banners';
const BANNER_CONFIG_KEY = 'BannerList';
const DRIVE_FOLDER_PROPERTY_BY_NAME = {
  'Teras Tower 2 - Bukti Pengaduan': 'FOLDER_EVIDENCE_ID',
  'Teras Tower 2 - Foto Tindak Lanjut': 'FOLDER_FOLLOWUP_ID',
  'Teras Tower 2 - Banners': 'FOLDER_BANNER_ID',
  'Teras Tower 2 - Background Images': 'FOLDER_BACKGROUND_ID'
};

// ===================================================================
// SECURITY HELPERS
// ===================================================================
function legacyHashPin_(pin, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(pin) + String(salt),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function getPinHashPepper_() {
  const props = PropertiesService.getScriptProperties();
  let pepper = props.getProperty(PROP_PIN_HASH_PEPPER);
  if (pepper) return pepper;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    pepper = props.getProperty(PROP_PIN_HASH_PEPPER);
    if (!pepper) {
      pepper = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty(PROP_PIN_HASH_PEPPER, pepper);
    }
    return pepper;
  } finally { lock.releaseLock(); }
}

function hashPin_(pin, salt) {
  const bytes = Utilities.computeHmacSha256Signature(
    String(pin) + '$' + String(salt), getPinHashPepper_(), Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

const PIN_HASH_PREFIX = 'hmac256$';
const LEGACY_PIN_HASH_PREFIX = 'sha256$';
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 600;
function makePinHash_(pin) { const salt = Utilities.getUuid(); return PIN_HASH_PREFIX + salt + '$' + hashPin_(pin, salt); }
function verifyStoredPin_(pin, stored) {
  const value = String(stored == null ? '' : stored);
  if (value.indexOf(PIN_HASH_PREFIX) === 0) {
    const parts = value.split('$');
    return parts.length === 3 && hashPin_(pin, parts[1]) === parts[2];
  }
  if (value.indexOf(LEGACY_PIN_HASH_PREFIX) === 0) {
    const parts = value.split('$');
    return parts.length === 3 && legacyHashPin_(pin, parts[1]) === parts[2];
  }
  return value === String(pin);
}
function makeNumericPin_() {
  // Ambil 20 bit dari UUID dan tolak nilai di luar rentang 000000-999999
  // agar distribusi enam digit tidak bias oleh operasi modulo sederhana.
  for (let attempt = 0; attempt < 10; attempt++) {
    const hex = Utilities.getUuid().replace(/-/g, '').substring(0, 5);
    const value = parseInt(hex, 16);
    if (value < 1000000) return ('000000' + value).slice(-6);
  }
  throw new Error('Generator PIN tidak dapat menghasilkan nilai aman.');
}
function upgradePlainPin_(sheetName, username, pin) { const sheet = getSheet_(sheetName); if (!sheet) return; const values = sheet.getDataRange().getValues(); const headers = values[0]; const uc = headers.indexOf('Username'); const pc = headers.indexOf('PIN'); if (uc < 0 || pc < 0) return; for (let i=1;i<values.length;i++) if (String(values[i][uc]||'').toLowerCase() === String(username).toLowerCase() && String(values[i][pc]||'').indexOf(PIN_HASH_PREFIX)!==0) { sheet.getRange(i+1,pc+1).setValue(makePinHash_(pin)); return; } }
function setPinForAccount_(sheetName, username, pin) { const sheet=getSheet_(sheetName); if(!sheet)return false; const values=sheet.getDataRange().getValues(); const headers=values[0]; const uc=headers.indexOf('Username'); const pc=headers.indexOf('PIN'); if(uc<0||pc<0)return false; for(let i=1;i<values.length;i++) if(String(values[i][uc]||'').toLowerCase()===String(username).toLowerCase()){sheet.getRange(i+1,pc+1).setValue(makePinHash_(pin));bumpSessionVersion_(username);return true;} return false; }
function loginRateKey_(username) { return 'login-fail:' + String(username || '').toLowerCase(); }
function isLoginRateLimited_(username) { return Number(CacheService.getScriptCache().get(loginRateKey_(username)) || 0) >= LOGIN_MAX_FAILURES; }
function recordLoginFailure_(username) { const cache=CacheService.getScriptCache(); const key=loginRateKey_(username); cache.put(key,String(Number(cache.get(key)||0)+1),LOGIN_LOCK_SECONDS); }
function clearLoginFailures_(username) { CacheService.getScriptCache().remove(loginRateKey_(username)); }

function setupSuperAdminCredentials_(username, pin) {
  username = String(username || '').trim();
  pin = String(pin || '').trim();
  if (!username || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    throw new Error('Username dan PIN 6 digit wajib diisi.');
  }
  const encodedPin = makePinHash_(pin);
  const props = PropertiesService.getScriptProperties();
  const previousUsername = props.getProperty(PROP_SUPER_ADMIN_USERNAME) || '';
  props.setProperties({
    [PROP_SUPER_ADMIN_USERNAME]: username,
    [PROP_SUPER_ADMIN_PIN_HASH]: encodedPin,
    [PROP_SUPER_ADMIN_PIN_SALT]: ''
  }, true);
  if (previousUsername) bumpSessionVersion_(previousUsername);
  bumpSessionVersion_(username);
  return 'Credential Super Admin tersimpan memakai HMAC-SHA-256 bergaram. Hapus atau nonaktifkan fungsi setup setelah konfigurasi.';
}

function getSuperAdminConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    username: props.getProperty(PROP_SUPER_ADMIN_USERNAME) || '',
    pinHash: props.getProperty(PROP_SUPER_ADMIN_PIN_HASH) || '',
    pinSalt: props.getProperty(PROP_SUPER_ADMIN_PIN_SALT) || ''
  };
}

function isReservedSuperAdminUsername_(username) {
  const su = String(getSuperAdminConfig_().username || '').trim().toLowerCase();
  return !!su && String(username || '').trim().toLowerCase() === su;
}

function verifySuperAdmin_(username, pin) {
  const config = getSuperAdminConfig_();
  if (!config.username || !config.pinHash || String(username).toLowerCase() !== config.username.toLowerCase()) return false;
  if (config.pinHash.indexOf(PIN_HASH_PREFIX) === 0) return verifyStoredPin_(pin, config.pinHash);
  // Compatibility with the prior Script Properties format (plain SHA-256 + separate salt).
  return !!config.pinSalt && legacyHashPin_(pin, config.pinSalt) === config.pinHash;
}

function sessionVersionKey_(username) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(username || '').toLowerCase(), Utilities.Charset.UTF_8);
  const digest = bytes.map(function (b) { const v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
  return 'SESSION_VERSION_' + digest;
}
function getSessionVersion_(username) {
  return Number(PropertiesService.getScriptProperties().getProperty(sessionVersionKey_(username)) || 0);
}
function bumpSessionVersion_(username) {
  if (!username) return;
  invalidateSmallSheetCache_(['admins']);
  const key = sessionVersionKey_(username);
  const props = PropertiesService.getScriptProperties();
  props.setProperty(key, String(Number(props.getProperty(key) || 0) + 1));
}

// ===================================================================
// SESI PERSISTEN (v11 — persiapan aplikasi Android/iOS)
// -------------------------------------------------------------------
// Sebelumnya sesi hanya ada di CacheService (maks. 6 jam), sehingga
// "Ingat saya" tetap meminta login ulang. Sekarang:
//   • Tanpa "Ingat saya": sesi hanya di cache, berlaku 6 jam (sama seperti dulu).
//   • Dengan "Ingat saya": sesi juga dicatat di sheet SesiAplikasi dan berlaku
//     30 hari sejak terakhir dipakai (diperpanjang otomatis, paling sering 1x/hari).
//   • Sheet hanya menyimpan HASH SHA-256 dari token, bukan tokennya. Orang yang
//     bisa membuka spreadsheet tidak bisa memakai isi sheet untuk masuk.
//   • Pencabutan sesi lama tetap memakai authVersion (bumpSessionVersion_):
//     reset PIN / cabut admin langsung membatalkan semua sesi akun tersebut.
// ===================================================================
const SHEET_SESSIONS = 'SesiAplikasi';
const SESSION_HEADERS = ['TokenHash', 'Username', 'Role', 'AuthVersion', 'SchemaVersion', 'CreatedAt', 'ExpiresAt', 'LastSeenAt'];
const SESSION_CACHE_SECONDS = 21600;                    // batas maksimum CacheService (6 jam)
const SESSION_SHORT_MS = SESSION_CACHE_SECONDS * 1000;  // sesi tanpa "Ingat saya"
const SESSION_LONG_MS = 30 * 24 * 60 * 60 * 1000;       // sesi "Ingat saya": 30 hari
const SESSION_TOUCH_MS = 24 * 60 * 60 * 1000;           // perpanjang masa berlaku paling sering 1x/hari

function sessionTokenHash_(token) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'tt2-session:' + String(token || ''), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function getSessionSheet_(createIfMissing) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_SESSIONS);
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(SHEET_SESSIONS);
    sheet.getRange(1, 1, 1, SESSION_HEADERS.length).setValues([SESSION_HEADERS]);
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (ignore) {}
  }
  return sheet;
}

// Mencari baris sesi berdasarkan hash token. Mengembalikan { rowNumber, values } atau null.
function findPersistentSessionRow_(sheet, tokenHash) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const cell = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(tokenHash).matchEntireCell(true).findNext();
  if (!cell) return null;
  const rowNumber = cell.getRow();
  return { rowNumber: rowNumber, values: sheet.getRange(rowNumber, 1, 1, SESSION_HEADERS.length).getValues()[0] };
}

// Menghapus sesi persisten yang sudah lewat masa berlakunya. Dipanggil sesekali saat login.
function pruneExpiredSessions_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;
  const now = Date.now();
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SESSION_HEADERS.length).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const expires = new Date(values[i][6]).getTime();
    if (!expires || expires < now) sheet.deleteRow(i + 2);
  }
}

function createSessionUser_(user, remember) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const now = Date.now();
  const persistent = remember === true;
  const session = {
    username: user.username,
    role: user.isSuperAdmin_ ? 'super_admin' : (user.isAdmin ? 'admin' : 'resident'),
    authVersion: getSessionVersion_(user.username),
    schemaVersion: SESSION_SCHEMA_VERSION,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + (persistent ? SESSION_LONG_MS : SESSION_SHORT_MS),
    persistent: persistent
  };
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(session), SESSION_CACHE_SECONDS);
  if (persistent) {
    try {
      withScriptLock_(function () {
        const sheet = getSessionSheet_(true);
        sheet.appendRow([sessionTokenHash_(token), sheetText_(session.username), session.role, session.authVersion,
          session.schemaVersion, new Date(now), new Date(session.expiresAt), new Date(now)]);
        if (Math.random() < 0.1) pruneExpiredSessions_(sheet);
      });
    } catch (err) {
      // Sesi tetap berlaku 6 jam lewat cache walaupun pencatatan sheet gagal.
      writeApplicationError_('createSessionUser_', err, session.username);
      session.persistent = false;
      session.expiresAt = now + SESSION_SHORT_MS;
      CacheService.getScriptCache().put('session:' + token, JSON.stringify(session), SESSION_CACHE_SECONDS);
    }
  }
  user.sessionToken = token;
  user.sessionExpiresAt = session.expiresAt;
  user.sessionPersistent = session.persistent;
  // Public flags are kept for the frontend; the server-side role remains authoritative.
  user.isAdmin = session.role === 'admin' || session.role === 'super_admin';
  user.isSuperAdmin = session.role === 'super_admin';
  return user;
}

// Dipanggil saat sesi tidak ada di cache: cari di sheet, perpanjang bila perlu,
// lalu simpan lagi ke cache supaya permintaan berikutnya tidak membaca sheet.
function loadPersistentSession_(token) {
  const sheet = getSessionSheet_(false);
  if (!sheet) return null;
  const tokenHash = sessionTokenHash_(token);
  const found = findPersistentSessionRow_(sheet, tokenHash);
  if (!found) return null;
  const row = found.values;
  const now = Date.now();
  let expiresAt = new Date(row[6]).getTime();
  const lastSeen = new Date(row[7]).getTime() || 0;
  // Jangan memakai withScriptLock_ di sini: requireSession_ bisa dipanggil dari
  // dalam callback yang sudah memegang kunci, dan kunci Apps Script tidak bersarang.
  // Baris kedaluwarsa dibersihkan oleh pruneExpiredSessions_ saat login berikutnya.
  if (!expiresAt || expiresAt < now) return null;
  if (now - lastSeen > SESSION_TOUCH_MS) {
    expiresAt = now + SESSION_LONG_MS;
    try { sheet.getRange(found.rowNumber, 7, 1, 2).setValues([[new Date(expiresAt), new Date(now)]]); } catch (ignore) {}
  }
  const session = {
    username: String(row[1] || ''),
    role: String(row[2] || ''),
    authVersion: Number(row[3] || 0),
    schemaVersion: String(row[4] || ''),
    createdAt: new Date(row[5]).toISOString(),
    expiresAt: expiresAt,
    persistent: true
  };
  const ttl = Math.max(60, Math.min(SESSION_CACHE_SECONDS, Math.floor((expiresAt - now) / 1000)));
  CacheService.getScriptCache().put('session:' + String(token), JSON.stringify(session), ttl);
  return session;
}

function requireSession_(token, roles) {
  if (!token) throw new Error('Sesi tidak ditemukan. Silakan login kembali.');
  const raw = CacheService.getScriptCache().get('session:' + String(token));
  let session = raw ? JSON.parse(raw) : loadPersistentSession_(token);
  if (session && session.expiresAt && Number(session.expiresAt) < Date.now()) session = null;
  if (!session) throw new Error('Sesi kedaluwarsa. Silakan login kembali.');
  if (session.schemaVersion !== SESSION_SCHEMA_VERSION) throw new Error('Sesi lama tidak lagi berlaku. Silakan login kembali.');
  if (Number(session.authVersion || 0) !== getSessionVersion_(session.username)) throw new Error('Sesi telah dicabut. Silakan login kembali.');
  if (session.role === 'admin' && !isAdminUsername_(session.username)) throw new Error('Hak Admin sudah dicabut. Silakan login kembali.');
  if (roles && roles.indexOf(session.role) < 0) throw new Error('Anda tidak memiliki akses.');
  return session;
}

function logoutSession(token) {
  if (!token) return { success: true };
  CacheService.getScriptCache().remove('session:' + String(token));
  try {
    const sheet = getSessionSheet_(false);
    if (sheet) withScriptLock_(function () {
      const found = findPersistentSessionRow_(sheet, sessionTokenHash_(token));
      if (found) sheet.deleteRow(found.rowNumber);
    });
  } catch (err) { writeApplicationError_('logoutSession', err, ''); }
  return { success: true };
}

function validateSession(token) {
  try {
    const session = requireSession_(token, ['resident', 'admin', 'super_admin']);
    return { valid: true, username: session.username, role: session.role };
  } catch (err) {
    return { valid: false };
  }
}

function validateString_(value, name, min, max) {
  const text = String(value == null ? '' : value).trim();
  if (text.length < min || text.length > max) throw new Error(name + ' harus ' + min + '-' + max + ' karakter.');
  return text;
}

// WhatsApp is stored as a phone number, not hashed. Accept common Indonesian
// entry formats and return canonical digits for validation/storage.
function normalizeWhatsAppNumber_(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || /[•●*xX]/.test(raw) || !/^\+?[0-9\s().-]+$/.test(raw)) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.indexOf('00') === 0) digits = digits.substring(2);
  if (digits.indexOf('0') === 0) digits = '62' + digits.substring(1);
  else if (digits.indexOf('62') !== 0 && digits.indexOf('8') === 0) digits = '62' + digits;
  return /^62[0-9]{8,11}$/.test(digits) ? digits : '';
}

// Prefix apostrophe for strings that Google Sheets could parse as formulas.
// The apostrophe is a text marker in Sheets and prevents execution of formulas
// submitted through forms while preserving the displayed text.
function sheetText_(value) {
  const text = String(value == null ? '' : value);
  return /^[\u0000-\u0020]*[=+\-@]/.test(text) ? "'" + text : text;
}

// v18 (A8): untuk nilai yang DIBACA dari sheet lalu ditulis ulang. getValues() tidak
// mengembalikan apostrof pelindung, jadi teks harus dilindungi lagi; angka/tanggal dibiarkan.
function sheetTextKeep_(value) {
  return typeof value === 'string' ? sheetText_(value) : value;
}

function floorOptions8O_() {
  const values = [];
  for (let i = FLOOR_MIN_8O; i <= FLOOR_MAX_8O; i++) values.push(('0' + i).slice(-2));
  return values;
}
function unitSuffixOptions8O_() {
  const values = [];
  for (let i = UNIT_SUFFIX_MIN_8O; i <= UNIT_SUFFIX_MAX_8O; i++) values.push(('0' + i).slice(-2));
  return values;
}
function normalizeFloorUnit8O_(floorValue, unitValue, statusWisma) {
  const rawFloor = String(floorValue == null ? '' : floorValue).trim();
  const rawUnit = String(unitValue == null ? '' : unitValue).trim();
  if (!rawFloor && !rawUnit) {
    if (statusWisma === 'Penghuni BAST') return { ok: false, reason: 'Lantai dan unit kosong untuk Penghuni BAST.' };
    return { ok: true, floor: '', suffix: '', unit: '', inferred: false };
  }
  let floor = rawFloor.replace(/^0+/, '') ? parseInt(rawFloor, 10) : 0;
  let floorText = '';
  if (floor >= FLOOR_MIN_8O && floor <= FLOOR_MAX_8O && /^\d{1,2}$/.test(rawFloor)) floorText = ('0' + floor).slice(-2);
  if (rawFloor && !floorText) return { ok: false, reason: 'Lantai harus 03–24.' };
  const unitDigits = rawUnit.replace(/[-/\s]/g, '');
  if (!/^\d{1,4}$/.test(unitDigits)) return { ok: false, reason: 'Format unit bukan angka 1–4 digit.' };
  let suffixText = '';
  let inferred = false;
  if (unitDigits.length === 4) {
    const unitFloor = unitDigits.substring(0, 2);
    const unitSuffix = parseInt(unitDigits.substring(2), 10);
    if (unitSuffix < UNIT_SUFFIX_MIN_8O || unitSuffix > UNIT_SUFFIX_MAX_8O) return { ok: false, reason: 'Nomor unit harus berakhiran 01–45.' };
    if (!floorText) { floorText = unitFloor; inferred = true; }
    if (unitFloor !== floorText) return { ok: false, reason: 'Awalan unit tidak sama dengan nomor lantai.' };
    suffixText = ('0' + unitSuffix).slice(-2);
  } else if (unitDigits.length === 3) {
    const unitFloor = ('0' + unitDigits.substring(0, 1)).slice(-2);
    const unitSuffix = parseInt(unitDigits.substring(1), 10);
    if (unitSuffix < UNIT_SUFFIX_MIN_8O || unitSuffix > UNIT_SUFFIX_MAX_8O) return { ok: false, reason: 'Nomor unit harus berakhiran 01–45.' };
    if (!floorText) { floorText = unitFloor; inferred = true; }
    if (unitFloor !== floorText) return { ok: false, reason: 'Awalan unit tidak sama dengan nomor lantai.' };
    suffixText = ('0' + unitSuffix).slice(-2);
  } else {
    if (!floorText) return { ok: false, reason: 'Lantai wajib diisi untuk unit dua digit.' };
    const suffix = parseInt(unitDigits, 10);
    if (suffix < UNIT_SUFFIX_MIN_8O || suffix > UNIT_SUFFIX_MAX_8O) return { ok: false, reason: 'Nomor unit harus 01–45.' };
    suffixText = ('0' + suffix).slice(-2);
  }
  const floorNumber = parseInt(floorText, 10);
  if (floorNumber < FLOOR_MIN_8O || floorNumber > FLOOR_MAX_8O) return { ok: false, reason: 'Lantai harus 03–24.' };
  return { ok: true, floor: floorText, suffix: suffixText, unit: floorText + suffixText, inferred: inferred || rawUnit.length !== 4 || rawUnit !== floorText + suffixText };
}
function validateFloorUnit8O_(statusWisma, floorValue, unitValue) {
  const floor = String(floorValue == null ? '' : floorValue).trim();
  const unit = String(unitValue == null ? '' : unitValue).trim();
  if (statusWisma !== 'Penghuni BAST' && (floor || unit)) throw new Error('Lantai dan unit hanya diisi untuk Penghuni BAST.');
  const normalized = normalizeFloorUnit8O_(floor, unit, statusWisma);
  if (!normalized.ok) throw new Error(normalized.reason);
  return normalized;
}
function getFloorUnitAnomaly8O_(row) {
  if (!String(row.Status_Wisma || '').trim()) return { normalized: { ok: false }, reason: 'Status di Wisma kosong.' };
  const normalized = normalizeFloorUnit8O_(row.Lantai, row.Unit, row.Status_Wisma);
  if (!normalized.ok) return { normalized: normalized, reason: normalized.reason };
  return { normalized: normalized, reason: '' };
}
function getWargaFloorUnitAnomalies_() {
  return getSheetData_(SHEET_WARGA).map(function (row) {
    const anomaly = getFloorUnitAnomaly8O_(row);
    return anomaly.reason ? { username: String(row.Username || ''), nama: String(row.Nama || ''), reason: anomaly.reason } : null;
  }).filter(Boolean);
}

function validateImageSignature_(fileObj) {
  const mime = String(fileObj.mimeType || '').toLowerCase();
  const bytes = Utilities.base64Decode(String(fileObj.base64 || '').replace(/^data:[^,]+,/, ''));
  const startsWith = function (sig) {
    return sig.every(function (value, index) { return (bytes[index] & 0xFF) === value; });
  };
  let valid = false;
  if (mime === 'image/jpeg') valid = startsWith([0xFF, 0xD8, 0xFF]);
  else if (mime === 'image/png') valid = startsWith([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  else if (mime === 'image/webp') {
    valid = startsWith([0x52, 0x49, 0x46, 0x46]) &&
      (bytes[8] & 0xFF) === 0x57 && (bytes[9] & 0xFF) === 0x45 && (bytes[10] & 0xFF) === 0x42 && (bytes[11] & 0xFF) === 0x50;
  }
  if (!valid) throw new Error('Isi file tidak cocok dengan tipe gambar yang diklaim.');
}

function validateFilePayload_(fileObj, required) {
  if (!fileObj) {
    if (required) throw new Error('File bukti wajib diisi.');
    return;
  }
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.indexOf(String(fileObj.mimeType || '').toLowerCase()) < 0) throw new Error('Bukti harus berupa JPG, PNG, atau WebP.');
  if (!fileObj.base64 || String(fileObj.base64).length > 7 * 1024 * 1024) throw new Error('Ukuran bukti terlalu besar atau tidak valid. Maksimal sekitar 5 MB.');
  validateString_(fileObj.fileName, 'Nama file', 1, 120);
  validateImageSignature_(fileObj);
}

// v12: notifikasi yang diantrekan di dalam kunci (queuePush_) dikirim SETELAH
// kunci dilepas, supaya permintaan HTTP ke Firebase tidak menahan warga lain.
let SCRIPT_LOCK_DEPTH_ = 0;
function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  SCRIPT_LOCK_DEPTH_++;
  try { return callback(); } finally {
    SCRIPT_LOCK_DEPTH_--;
    lock.releaseLock();
    if (SCRIPT_LOCK_DEPTH_ === 0) flushPushQueue_();
  }
}

function writeAuditLog_(action, actor, target, detail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(AUDIT_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(AUDIT_SHEET);
      sheet.appendRow(['Timestamp', 'Action', 'Actor', 'Target', 'Detail']);
    }
    sheet.appendRow([new Date(), sheetText_(action), sheetText_(actor), sheetText_(target), sheetText_(String(detail || '').substring(0, 2000))]);
  } catch (err) {
    console.error('Audit log gagal: ' + err.message);
  }
}

function getManagementLog(sessionToken, category) {
  const session = requireSession_(sessionToken, ['admin', 'super_admin']);
  if (session.role === 'admin' && !isAdminUsername_(session.username)) return { authorized: false, data: [] };
  const categories = {
    warga: ['UPDATE_WARGA', 'DELETE_WARGA', 'ACTIVATE_ADMIN', 'DEACTIVATE_ADMIN'],
    pin: ['RESET_PIN', 'REQUEST_RESET_PIN', 'PROCESS_RESET_PIN'],
    aspirasi: ['SUBMIT_ASPIRASI', 'UPDATE_TINDAK_LANJUT'],
    kepuasan: ['UPDATE_KEPUASAN'],
    agenda: ['SUBMIT_AGENDA_PROPOSAL', 'APPROVE_AGENDA_PROPOSAL', 'REJECT_AGENDA_PROPOSAL', 'CREATE_TOWER_AGENDA', 'UPDATE_TOWER_AGENDA', 'ARCHIVE_TOWER_AGENDA', 'RESTORE_TOWER_AGENDA'],
    nomorPenting: ['UPDATE_NOMOR_PENTING'],
    nomorDarurat: ['UPDATE_NOMOR_DARURAT'],
    admin: ['ADD_ADMIN', 'REMOVE_ADMIN', 'UPDATE_ADMIN_PROFILE', 'UPDATE_SUPER_ADMIN_PROFILE'],
    aplikasi: ['UPDATE_THEME', 'UPDATE_BANNERS', 'UPDATE_APP_FEEDBACK', 'KIRIM_PENGUMUMAN', 'RILIS_APK'],
    faq: ['ADD_FAQ', 'UPDATE_FAQ', 'DELETE_FAQ', 'MOVE_FAQ'],
    // v18: kategori yang sebelumnya tidak tampil di tab mana pun.
    jelajah: ['SUBMIT_JELAJAH_RECOMMENDATION', 'UPDATE_JELAJAH_RECOMMENDATION', 'VERIFY_JELAJAH_RECOMMENDATION', 'UPSERT_JELAJAH_REVIEW',
      'MODERATE_JELAJAH_COMMENT', 'REPORT_JELAJAH', 'RESOLVE_JELAJAH_REPORT', 'ADD_JELAJAH_CATEGORY', 'UPDATE_JELAJAH_CATEGORY',
      'ADD_JELAJAH_TYPE', 'UPDATE_JELAJAH_TYPE', 'SET_TOWER_LOCATION', 'FILL_JELAJAH_COORDINATES', 'HIDE_JELAJAH_RECOMMENDATION', 'RESTORE_JELAJAH_RECOMMENDATION'],
    papan: ['PUBLISH_ASPIRASI', 'UNPUBLISH_ASPIRASI', 'SUBMIT_APRESIASI', 'DELETE_APRESIASI'],
    akun: ['REGISTER', 'CLEANUP_HAPUS_AKUN', 'CLEANUP_UJI', 'DELETE_OWN_ACCOUNT', 'DELETE_OWN_ACCOUNT_FAILED'],
    logSystem: ['LOGIN_FAILED', 'MARK_ERROR_LOG_SEEN', 'PANGGILAN_DITOLAK', 'LAPORAN_RILIS_DITOLAK', 'PERBAIKI_ID_ASPIRASI', 'RETENSI_DATA']
  };
  // Kategori yang hanya untuk Super Admin (berisi aktivitas pihak lain/sistem).
  const superOnly = { admin: true, aplikasi: true, akun: true, logSystem: true };
  if (session.role !== 'super_admin' && superOnly[category]) return { authorized: false, data: [] };
  const allowed = categories[category] || Object.keys(categories).reduce(function (all, key) { return all.concat(categories[key]); }, []);
  const sheet = getSheet_(AUDIT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { authorized: true, data: [] };
  // v18 (A7): baca paling banyak MANAGEMENT_LOG_SCAN_ROWS baris terakhir, bukan seluruh log.
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const startRow = Math.max(2, lastRow - MANAGEMENT_LOG_SCAN_ROWS + 1);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, headers.length).getValues();
  const col = {}; headers.forEach(function (h, i) { col[h] = i; });
  const me = String(session.username || '').toLowerCase();
  const rows = [];
  for (let i = values.length - 1; i >= 0 && rows.length < 300; i--) {
    const row = values[i];
    const action = String(row[col.Action] || '');
    if (allowed.indexOf(action) < 0) continue;
    if (session.role !== 'super_admin' && String(row[col.Actor] || '').toLowerCase() !== me) continue;
    rows.push({ timestamp: formatTanggal_(row[col.Timestamp]), action: action, actor: row[col.Actor] || '', target: row[col.Target] || '', detail: row[col.Detail] || '' });
  }
  return { authorized: true, data: rows };
}
const MANAGEMENT_LOG_SCAN_ROWS = 5000;

function writeApplicationError_(area, err, actor) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('ErrorLog');
    pruneErrorLog_(sheet);
    if (!sheet) {
      sheet = ss.insertSheet('ErrorLog');
      sheet.appendRow(['Timestamp', 'Area', 'Actor', 'Message']);
    }
    const raw = err && err.message ? err.message : String(err || 'Unknown error');
    const message = raw.replace(/sessionToken[^,\s]*/gi, 'sessionToken=[redacted]').replace(/pin\s*[:=]\s*\d+/gi, 'PIN=[redacted]').substring(0, 500);
    sheet.appendRow([new Date(), String(area || 'unknown'), String(actor || '').substring(0, 100), message]);
  } catch (logErr) {
    console.error('Error log gagal: ' + logErr.message);
  }
}
const ERROR_LOG_RETENTION_DAYS = 60;
function pruneErrorLog_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;
  const cutoff = new Date().getTime() - ERROR_LOG_RETENTION_DAYS * 86400000;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(4, sheet.getLastColumn())).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const stamp = notificationDate_(values[i][0]);
    if (stamp > 0 && stamp < cutoff) sheet.deleteRow(i + 2);
  }
}
function getErrorLogSummary(sessionToken, periodDays) {
  const session = requireSession_(sessionToken, ['super_admin']);
  const sheet = getSheet_('ErrorLog');
  if (!sheet) return { total: 0, last24: 0, last7: 0, last30: 0, unread: 0, rows: [], retentionDays: ERROR_LOG_RETENTION_DAYS };
  pruneErrorLog_(sheet);
  const rows = getSheetData_('ErrorLog');
  const now = new Date().getTime();
  const lastSeen = getNotificationLastSeen_(session.username, 'errorLog');
  const days = Math.max(1, Math.min(Number(periodDays) || 30, ERROR_LOG_RETENTION_DAYS));
  const filtered = rows.filter(function (row) { return now - notificationDate_(row.Timestamp) <= days * 86400000; });
  return {
    total: filtered.length,
    last24: rows.filter(function (row) { return now - notificationDate_(row.Timestamp) <= 86400000; }).length,
    last7: rows.filter(function (row) { return now - notificationDate_(row.Timestamp) <= 7 * 86400000; }).length,
    last30: rows.filter(function (row) { return now - notificationDate_(row.Timestamp) <= 30 * 86400000; }).length,
    unread: lastSeen === null ? 0 : rows.filter(function (row) { return notificationDate_(row.Timestamp) > lastSeen; }).length,
    retentionDays: ERROR_LOG_RETENTION_DAYS,
    rows: filtered.slice(-100).reverse().map(function (row) {
      return { timestamp: formatTanggal_(row.Timestamp), area: String(row.Area || ''), actor: String(row.Actor || ''), message: String(row.Message || '').substring(0, 500) };
    })
  };
}
function markErrorLogSeen(sessionToken) {
  const session = requireSession_(sessionToken, ['super_admin']);
  setNotificationLastSeen_(session.username, 'errorLog');
  return { success: true };
}
// v15: Google Sheets membatasi 10 juta sel per berkas (termasuk baris/kolom kosong
// yang sudah dibuat). Hitungan memakai ukuran grid tiap sheet.
const SPREADSHEET_CELL_LIMIT = 10000000;
function getSpreadsheetCapacity_() {
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  let used = 0, largest = '', largestCells = 0;
  const list = sheets.map(function (sheet) {
    const maxRows = sheet.getMaxRows(), maxCols = sheet.getMaxColumns();
    const cells = maxRows * maxCols;
    used += cells;
    if (cells > largestCells) { largestCells = cells; largest = sheet.getName(); }
    return { name: sheet.getName(), dataRows: Math.max(sheet.getLastRow() - 1, 0), maxRows: maxRows, columns: maxCols, cells: cells, emptyRows: Math.max(maxRows - sheet.getLastRow(), 0) };
  });
  const free = Math.max(SPREADSHEET_CELL_LIMIT - used, 0);
  // Perkiraan baris baru yang masih muat: baris kosong yang sudah ada + sisa sel dibagi jumlah kolom sheet.
  list.forEach(function (item) { item.rowsAvailable = item.emptyRows + Math.floor(free / Math.max(item.columns, 1)); });
  list.sort(function (a, b) { return b.cells - a.cells; });
  const percent = Math.round(used / SPREADSHEET_CELL_LIMIT * 1000) / 10;
  return { usedCells: used, limitCells: SPREADSHEET_CELL_LIMIT, freeCells: free, percent: percent, largest: largest, largestCells: largestCells, sheets: list,
    level: percent >= 90 ? 'kritis' : (percent >= 75 ? 'waspada' : 'ok') };
}
// Halaman Kelola Aplikasi > Penyimpanan Data (Super Admin).
function getStorageInfo(sessionToken) {
  requireSession_(sessionToken, ['super_admin']);
  const cap = getSpreadsheetCapacity_();
  try { CacheService.getScriptCache().put('sheet-capacity-v1', JSON.stringify(cap), 21600); } catch (ignore) {}
  cap.checkedAt = formatTanggal_(new Date());
  return cap;
}
function getSpreadsheetCapacityCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sheet-capacity-v1');
  if (cached) { try { return JSON.parse(cached); } catch (ignore) {} }
  const value = getSpreadsheetCapacity_();
  try { cache.put('sheet-capacity-v1', JSON.stringify(value), 21600); } catch (ignore) {}
  return value;
}
// Dipanggil pemicu harian: kirim push ke admin saat kapasitas melewati 75% / 90%,
// sekali per tingkat (tidak berulang setiap hari).
function checkSpreadsheetCapacity_() {
  const cap = getSpreadsheetCapacity_();
  try { CacheService.getScriptCache().put('sheet-capacity-v1', JSON.stringify(cap), 21600); } catch (ignore) {}
  const props = PropertiesService.getScriptProperties();
  const lastLevel = props.getProperty('CAPACITY_ALERT_LEVEL') || 'ok';
  if (cap.level !== lastLevel) {
    props.setProperty('CAPACITY_ALERT_LEVEL', cap.level);
    if (cap.level !== 'ok' && (lastLevel === 'ok' || cap.level === 'kritis')) {
      queuePush_({ admins: true }, {
        title: cap.level === 'kritis' ? 'Penyimpanan data hampir penuh' : 'Penyimpanan data mulai penuh',
        body: 'Spreadsheet Teras Tower 2 sudah terpakai ' + cap.percent + '%. Buka Notifikasi untuk rinciannya.',
        page: 'notifikasi'
      });
    }
  }
  return cap;
}

function getDatabaseHealth(sessionToken) {
  requireSession_(sessionToken, ['super_admin']);
  const expected = [
    { name: SHEET_DATA, required: ['ID', 'Timestamp', 'Username', 'Detail_Aspirasi', 'StatusAspirasi', 'DibacaAdmin', 'StatusUpdatedAt', 'StatusUpdatedBy', 'CatatanPenolakan', 'Prioritas', 'Catatan_Tindak_Lanjut', 'Tanggal_Tindak_Lanjut', 'Foto_Tindak_Lanjut', 'Lokasi_Masalah', 'Lokasi_Masalah_Detail'], anyRequired: [['Admin_Penangan', 'Admin_Tindak_Lanjut']] },
    { name: SHEET_WARGA, required: ['Username', 'PIN', 'Nama'] },
    { name: SHEET_ADMINS, required: ['Username', 'PIN'] },
    { name: SHEET_REFDATA, required: [] },
    { name: SHEET_APPINFO, required: [] },
    { name: SHEET_SYSTEMCONFIG, required: [] },
    { name: SHEET_KEPUASAN, required: ['Timestamp'] },
    { name: SHEET_APPFEEDBACK, required: ['Timestamp', 'Username', 'Kategori', 'Masukan', 'Status', 'Dibaca'] }
  ];
  const checks = expected.map(function (item) {
    const sheet = getSheet_(item.name);
    if (!sheet) return { name: item.name, status: 'missing', missing: item.required };
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
    const missing = item.required.filter(function (header) { return headers.indexOf(header) < 0; });
    (item.anyRequired || []).forEach(function (options) { if (!options.some(function (header) { return headers.indexOf(header) >= 0; })) missing.push(options.join(' atau ')); });
    return { name: item.name, status: missing.length ? 'warning' : 'ok', missing: missing, rows: Math.max(sheet.getLastRow() - 1, 0) };
  });
  let capacity = null;
  try { capacity = getSpreadsheetCapacity_(); } catch (ignore) {}
  return { checkedAt: formatTanggal_(new Date()), ok: checks.filter(function (x) { return x.status === 'ok'; }).length, warnings: checks.filter(function (x) { return x.status !== 'ok'; }).length, checks: checks, capacity: capacity };
}

// ===================================================================
// APP VERSION
// Google Apps Script tidak mengekspos nomor versi deployment melalui ScriptApp.
// Nilai APP_VERSION disimpan di Script Properties dan diperbarui saat deployment.
// ===================================================================
function getAppVersion_() {
  return PropertiesService.getScriptProperties().getProperty('APP_VERSION') || 'dev';
}

// ===================================================================
// ENTRY POINT
// ===================================================================
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appInfo = getAppInfoData_();
  // v18: versi rilis GitHub terbaru ikut dikirim agar versi web tampil sama dengan APK.
  const webConfig = getSystemConfig_();
  const latestApk = getLatestApkInfo_();
  webConfig.ApkVersiTerbaru = latestApk.version;
  webConfig.ApkTautanUnduh = latestApk.url;
  template.systemConfig = webConfig;
  template.appUrl = ScriptApp.getService().getUrl();
  template.appVersion = getAppVersion_();

  return template.evaluate()
    .setTitle('Teras Tower 2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ===================================================================
// API UNTUK APLIKASI ANDROID/iOS/PWA (v11)
// -------------------------------------------------------------------
// Versi web Apps Script tetap memakai doGet + google.script.run seperti biasa.
// Aplikasi terpasang (APK, iPhone, PWA) memanggil doPost lewat fetch dengan
// body JSON { fn: "namaFungsi", args: [...] } dan Content-Type text/plain
// (agar tidak memicu preflight CORS yang tidak didukung Apps Script).
//
// Hanya fungsi di TT2_API yang bisa dipanggil — persis 69 fungsi yang sudah
// dipanggil klien lewat google.script.run, ditambah getBootstrap. Fungsi
// berakhiran garis bawah (_) tidak pernah bisa dipanggil dari luar.
// Pemeriksaan sesi & peran tetap dilakukan di dalam masing-masing fungsi.
// Bila menambah fitur baru yang dipanggil klien, tambahkan namanya di sini.
// ===================================================================
const TT2_API_NAMES = [
  'getApresiasi', 'submitApresiasi', 'deleteApresiasi', 'toggleApresiasiDukungan',
  'getPapanTindakLanjut', 'getPapanDetail', 'setAspirasiPublik', 'hideMyAspirasiFromPapan', 'toggleAspirasiDukungan',
  'getNotificationLog',
  'deleteMyAccount',
  'getBootstrap',
  'logoutSession', 'validateSession', 'getManagementLog', 'getErrorLogSummary', 'markErrorLogSeen', 'getDatabaseHealth',
  'registerUser', 'requestForgotPin', 'loginWithPin', 'updateProfile', 'getProfile', 'getAllWarga',
  'getJelajahSekitar', 'submitJelajahRecommendation', 'submitJelajahReview', 'getJelajahReviews', 'getKelolaJelajah',
  'addJelajahCategory', 'addJelajahType', 'updateJelajahCategory', 'updateJelajahType', 'setJelajahCategoryActive',
  'setJelajahTypeActive', 'setJelajahRecommendationDeleted', 'setJelajahVerification', 'getJelajahReviewsAdmin',
  'setJelajahCommentVisibility', 'toggleAdminFromWarga', 'updateWargaByAdmin', 'deleteWarga', 'resetPin',
  'getPendingWork', 'getNotificationSummary', 'markNotificationSeen', 'markAllNotificationsSeen',
  'getResidentNotificationSummary', 'getMyAppFeedback', 'markResidentNotificationSeen', 'getRefData', 'submitAspirasi',
  'getRiwayatSaya', 'getFollowupPhoto', 'getSemuaAspirasi', 'updateTindakLanjut', 'getNomorPenting', 'getNomorDarurat',
  'saveNomorPenting', 'saveNomorDarurat', 'getAllAdmins', 'addAdmin', 'removeAdmin', 'updateSystemConfig', 'saveBanners',
  'submitAppFeedback', 'getAppFeedback', 'markAppFeedbackSeen', 'updateAppFeedback', 'getRekapKepuasan',
  'getMyKepuasanThisWeek', 'submitKepuasan', 'getAllKepuasanAdmin', 'getKontakData', 'getAppClock', 'getAgendaCalendar',
  'saveAgenda', 'setAgendaActive', 'submitAgendaProposal', 'getAgendaManagementData', 'reviewAgendaProposal',
  // v12
  'registerPushToken', 'unregisterPushToken', 'sendPengumuman', 'getPengumumanTerbaru', 'getPengumumanAdmin',
  // v13: dipanggil workflow GitHub (dijaga RELEASE_SECRET, bukan sesi)
  'reportApkRelease',
  // v15
  'getStorageInfo', 'getFaq', 'saveFaqItem', 'deleteFaqItem', 'moveFaqItem',
  // v16 Jelajah
  'searchJelajahPlaces', 'reverseJelajahLocation', 'updateJelajahRecommendation', 'toggleJelajahFavorite',
  'submitJelajahReport', 'resolveJelajahReport', 'setJelajahTowerLocation', 'fillJelajahCoordinates'
];

// Peta nama -> fungsi dibuat saat dipanggil, sehingga urutan deklarasi tidak berpengaruh.
function getApiFunction_(name) {
  if (TT2_API_NAMES.indexOf(name) < 0) return null;
  const fn = globalThis[name];
  return typeof fn === 'function' ? fn : null;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let request;
  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'Permintaan tidak valid.' });
  }
  const name = String(request && request.fn || '');
  const fn = getApiFunction_(name);
  if (!fn) return jsonOutput_({ ok: false, error: 'Fungsi tidak dikenal.' });
  const args = Array.isArray(request.args) ? request.args : [];
  try {
    const result = fn.apply(null, args);
    return jsonOutput_({ ok: true, result: result === undefined ? null : result });
  } catch (err) {
    // Sama seperti google.script.run: pesan error diteruskan ke failure handler klien.
    return jsonOutput_({ ok: false, error: String(err && err.message || err || 'Kesalahan server.') });
  }
}

// Data awal yang pada versi web disisipkan doGet ke template Index.html.
// Isinya sama dengan yang sudah terlihat oleh siapa pun yang membuka halaman login.
function getBootstrap() {
  const appInfo = getAppInfoData_();
  const systemConfig = getSystemConfig_();
  // v14: versi APK terbaru selalu dikirim sebagai teks yang valid (lihat normalizeVersion_).
  const apk = getLatestApkInfo_();
  systemConfig.ApkVersiTerbaru = apk.version;
  systemConfig.ApkTautanUnduh = apk.url;
  return {
    appInfo: { Deskripsi: appInfo.Deskripsi || '', Penutup: appInfo.Penutup || '' },
    systemConfig: systemConfig,
    appUrl: ScriptApp.getService().getUrl(),
    appVersion: getAppVersion_(),
    serverTime: Date.now()
  };
}

// ===================================================================
// AUTH: REGISTER
// ===================================================================
// -------------------------------------------------------------------
// PEMBATASAN REGISTRASI & LUPA PIN (v11)
// • SystemConfig KEY "RegistrasiDibuka" = "false" menutup pendaftaran akun baru.
//   Kosong / tidak ada / nilai lain = dibuka (perilaku lama).
// • Batas global per jam memakai CacheService (bucket per jam, kedaluwarsa otomatis).
// -------------------------------------------------------------------
const REGISTER_MAX_PER_HOUR = 30;
const FORGOT_PIN_MAX_PER_HOUR = 30;

function isRegistrationOpen_() {
  const raw = getSystemConfig_().RegistrasiDibuka;
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  return !(value === 'false' || value === 'tidak' || value === 'tutup' || value === '0');
}
function hourlyBucketKey_(name) {
  return 'hourly:' + name + ':' + Math.floor(Date.now() / 3600000);
}
function isHourlyLimitReached_(name, max) {
  return Number(CacheService.getScriptCache().get(hourlyBucketKey_(name)) || 0) >= max;
}
// Panggil dari dalam withScriptLock_ agar penambahan hitungan tidak saling menimpa.
function countHourlyEvent_(name) {
  const cache = CacheService.getScriptCache();
  const key = hourlyBucketKey_(name);
  cache.put(key, String(Number(cache.get(key) || 0) + 1), 3700);
}

function registerUser(payload) {
  try {
    const username = payload.username.trim().toLowerCase();
    const pin = payload.pin.trim();
    const pinConfirm = payload.pinConfirm.trim();

    if (!username || !pin || !pinConfirm) {
      return { success: false, message: 'Semua field wajib diisi.' };
    }
    if (username.length < 3) {
      return { success: false, message: 'Username minimal 3 karakter.' };
    }
    if (isReservedSuperAdminUsername_(username)) {
      return { success: false, message: 'Username sudah digunakan.' };
    }
    if (!/^[a-z0-9_]+$/.test(username)) {
      return { success: false, message: 'Username hanya boleh huruf kecil, angka, dan underscore (_).' };
    }
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      return { success: false, message: 'PIN harus 6 digit angka.' };
    }
    if (pin !== pinConfirm) {
      return { success: false, message: 'PIN dan konfirmasi PIN tidak cocok.' };
    }

    if (!isRegistrationOpen_()) {
      return { success: false, message: 'Pendaftaran akun baru sedang ditutup. Silakan hubungi pengurus Tower 2.' };
    }
    const pinHash = makePinHash_(pin);
    return withScriptLock_(function () {
      // Batas global: aplikasi terpasang di HP warga, jadi alamat backend tidak lagi
      // tersembunyi. Batas ini mencegah pembuatan akun massal oleh skrip.
      if (isHourlyLimitReached_('register', REGISTER_MAX_PER_HOUR)) {
        return { success: false, message: 'Terlalu banyak pendaftaran dalam satu jam terakhir. Silakan coba lagi nanti.' };
      }
      const wargaData = getSheetData_(SHEET_WARGA);
      if (wargaData.some(function(row) { return String(row.Username || '').toLowerCase() === username; })) {
        return { success: false, message: 'Username sudah terdaftar. Silakan pilih username lain.' };
      }

      const sheet = getSheet_(SHEET_WARGA);
      sheet.appendRow([
        sheetText_(username), pinHash, '', '', '', '', '', 'user', 'false'
      ]);
      // v12: tanggal daftar, dasar pembersihan otomatis akun yang tidak dilengkapi.
      sheet.getRange(sheet.getLastRow(), ensureSheetColumn_(sheet, WARGA_REGISTERED_COL)).setValue(new Date());
      countHourlyEvent_('register');
      writeAuditLog_('REGISTER', username, username, 'new_account');

      return { success: true, message: 'Akun berhasil dibuat! Silakan login.' };
    });
  } catch (err) {
    return { success: false, message: 'Terjadi kesalahan: ' + err.message };
  }
}

function requestForgotPin(payload) {
  try {
    const username = String(payload && payload.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,80}$/.test(username)) return { success: false, message: 'Username tidak valid.' };
    return withScriptLock_(function () {
      const cooldownKey = 'forgot-pin:' + username;
      const cache = CacheService.getScriptCache();
      if (cache.get(cooldownKey)) return { success: true, message: 'Jika username terdaftar, permintaan reset akan dicatat. Silakan hubungi admin untuk proses selanjutnya.' };
      if (isHourlyLimitReached_('forgot-pin', FORGOT_PIN_MAX_PER_HOUR)) {
        return { success: false, message: 'Terlalu banyak permintaan reset PIN dalam satu jam terakhir. Silakan coba lagi nanti atau hubungi admin.' };
      }
      countHourlyEvent_('forgot-pin');
      let sheet = getSheet_(SHEET_RESETREQUESTS);
      if (!sheet) {
        sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_RESETREQUESTS);
        sheet.appendRow(['RequestID', 'Timestamp', 'Username', 'Nama', 'Status', 'ProcessedAt', 'ProcessedBy']);
      }
      const warga = getSheetData_(SHEET_WARGA).find(function (row) { return String(row.Username || '').toLowerCase() === username; });
      const admins = getSheetData_(SHEET_ADMINS).find(function (row) { return String(row.Username || '').toLowerCase() === username; });
      const found = warga || admins;
      const displayName = found ? (found.Nama || found.Keterangan || found.Username || username) : username;
      const rows = getSheetData_(SHEET_RESETREQUESTS);
      const duplicate = rows.some(function (row) { return String(row.Username || '').toLowerCase() === username && String(row.Status || '') === 'Menunggu'; });
      if (found && !duplicate) sheet.appendRow([Utilities.getUuid().substring(0, 8), new Date(), sheetText_(username), sheetText_(displayName), 'Menunggu', '', '']);
      if (found) writeAuditLog_('REQUEST_RESET_PIN', username, username, duplicate ? 'duplicate_pending' : 'new_request');
      if (found && !duplicate) invalidateAdminNotificationCaches_();
      cache.put(cooldownKey, '1', 120);
      return { success: true, message: 'Jika username terdaftar, permintaan reset akan dicatat. Silakan hubungi admin untuk proses selanjutnya.' };
    });
  } catch (err) { return { success: false, message: 'Permintaan reset tidak dapat diproses.' }; }
}

// ===================================================================
// AUTH: LOGIN
// ===================================================================
function loginWithPin(payload) {
  try {
    const username = payload.username.trim().toLowerCase();
    const pin = payload.pin.trim();
    // "Ingat saya" dari layar login: true -> sesi 30 hari, false -> 6 jam.
    const remember = payload.remember === true;

    if (!username || !pin) {
      return { success: false, message: 'Username dan PIN wajib diisi.' };
    }
    if (isLoginRateLimited_(username)) return { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 10 menit.' };

    // Cek Super Admin dari salted hash di Script Properties.
    const superAdmin = getSuperAdminConfig_();
    if (verifySuperAdmin_(username, pin)) {
      clearLoginFailures_(username);
      return {
        success: true,
        user: createSessionUser_({
          username: superAdmin.username,
          name: superAdmin.username,
          isAdmin: true,
          isSuperAdmin_: true,
          profileComplete: true
        }, remember)
      };
    }
    // v18 (A11): username Super Admin hanya boleh masuk sebagai Super Admin. Dulu, bila
    // username yang sama juga ada di Admins/WargaBaru, PIN lain bisa membuatnya masuk
    // sebagai admin/warga biasa sehingga "role SuperAdmin hilang".
    if (superAdmin.username && username === String(superAdmin.username).toLowerCase()) {
      recordLoginFailure_(username);
      writeAuditLog_('LOGIN_FAILED', username, username, 'PIN Super Admin salah');
      return { success: false, message: 'Username atau PIN salah.' };
    }

    // Cek di sheet Admins (Username, PIN, Keterangan)
    const adminsData = getSheetData_(SHEET_ADMINS);
    const adminMatch = adminsData.find(function (row) {
      return row.Username && String(row.Username).toLowerCase() === username && verifyStoredPin_(pin, row.PIN);
    });

    if (adminMatch) {
      clearLoginFailures_(username);
      upgradePlainPin_(SHEET_ADMINS, adminMatch.Username, pin);
      return {
        success: true,
        user: createSessionUser_({
          username: adminMatch.Username,
          name: adminMatch.Keterangan || adminMatch.Username,
          isAdmin: true,
          isSuperAdmin_: false,
          profileComplete: true
        }, remember)
      };
    }

    // Cek di sheet Warga
    const wargaData = getSheetData_(SHEET_WARGA);
    const user = wargaData.find(function(row) {
      return String(row.Username || '').toLowerCase() === username;
    });

    if (!user || !verifyStoredPin_(pin, user.PIN)) {
      recordLoginFailure_(username);
      writeAuditLog_('LOGIN_FAILED', username, username, 'invalid_credentials');
      return { success: false, message: 'Username atau PIN salah.' };
    }
    clearLoginFailures_(username);
    upgradePlainPin_(SHEET_WARGA, user.Username, pin);

    const isAdmin = isAdminUsername_(username);

    return {
      success: true,
      user: createSessionUser_({
        username: user.Username,
        name: user.Nama || user.Username,
        isAdmin: isAdmin,
        isSuperAdmin_: false,
        statusWisma: user.Status_Wisma || '',
        lantai: user.Lantai || '',
        unit: user.Unit || '',
        nomorWhatsApp: user.Nomor_WhatsApp || '',
        profileComplete: user.ProfileComplete === 'true' || user.ProfileComplete === true,
        profileDeadline: getProfileDeadline_(user)
      }, remember)
    };
  } catch (err) {
    return { success: false, message: 'Terjadi kesalahan: ' + err.message };
  }
}

// ===================================================================
// AUTH: PROFILE
// ===================================================================
// v18: dibungkus kunci tulis. Fungsi ini mencari nomor baris lalu menulis ke baris itu;
// tanpa kunci, penghapusan baris oleh proses lain di antaranya bisa menggeser target.
function updateProfile(payload) {
  try {
    return withScriptLock_(function () { return updateProfileUnlocked_(payload); });
  } catch (err) {
    writeApplicationError_('updateProfile', err, 'sistem');
    return { success: false, message: 'Server sedang sibuk. Coba lagi sebentar.' };
  }
}

function updateProfileUnlocked_(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  payload.username = session.username;
  payload.adminUsername = session.username;
  try {
    const nama = validateString_(payload.nama, 'Nama', 1, 120);
    const rawWhatsApp = String(payload.nomorWhatsApp || '').trim();
    const nomorWhatsApp = rawWhatsApp ? normalizeWhatsAppNumber_(rawWhatsApp) : '';
    if (rawWhatsApp && !nomorWhatsApp) throw new Error('Format WhatsApp tidak valid. Gunakan 08…, 8…, 62… atau +62…; jangan gunakan nomor yang disamarkan.');

    // Admin and Super Admin do not have a resident profile in WargaBaru.
    // Persist the editable display name for regular admins; Super Admin identity
    // remains controlled by Script Properties and is not written to a sheet.
    if (session.role !== 'resident') {
      if (session.role === 'admin') {
        const adminSheet = getSheet_(SHEET_ADMINS);
        const adminValues = adminSheet.getDataRange().getValues();
        const adminHeaders = adminValues[0];
        const adminUsernameCol = adminHeaders.indexOf('Username');
        const adminDescriptionCol = adminHeaders.indexOf('Keterangan');
        if (adminUsernameCol >= 0 && adminDescriptionCol >= 0) {
          for (let i = 1; i < adminValues.length; i++) {
            if (String(adminValues[i][adminUsernameCol] || '').toLowerCase() === session.username.toLowerCase()) {
              adminSheet.getRange(i + 1, adminDescriptionCol + 1).setValue(sheetText_(nama));
              writeAuditLog_('UPDATE_ADMIN_PROFILE', session.username, session.username, 'display_name');
              return { success: true };
            }
          }
        }
        return { success: false, message: 'Akun admin tidak ditemukan.' };
      }
      writeAuditLog_('UPDATE_SUPER_ADMIN_PROFILE', session.username, session.username, 'display_name_local_only');
      return { success: true };
    }

    const statusWisma = validateString_(payload.statusWisma, 'Status di Wisma', 1, 80);
    const refStatuses = getRefData().Status_Wisma || [];
    if (refStatuses.length && refStatuses.indexOf(statusWisma) < 0) throw new Error('Status di Wisma tidak tersedia pada RefData.');
    const lantai = String(payload.lantai || '').trim();
    const unit = String(payload.unit || '').trim();
    const normalizedFloorUnit = validateFloorUnit8O_(statusWisma, lantai, unit);

    const sheet = getSheet_(SHEET_WARGA);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const usernameCol = headers.indexOf('Username');
    const namaCol = headers.indexOf('Nama');
    const statusCol = headers.indexOf('Status_Wisma');
    const lantaiCol = headers.indexOf('Lantai');
    const unitCol = headers.indexOf('Unit');
    const waCol = headers.indexOf('Nomor_WhatsApp');
    const profileCol = headers.indexOf('ProfileComplete');

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][usernameCol]).toLowerCase() === session.username.toLowerCase()) {
        assertRowOwner_(sheet, i + 1, usernameCol, session.username);
        sheet.getRange(i + 1, namaCol + 1).setValue(sheetText_(nama));
        sheet.getRange(i + 1, statusCol + 1).setValue(sheetText_(statusWisma));
        sheet.getRange(i + 1, lantaiCol + 1).setValue(normalizedFloorUnit.floor);
        sheet.getRange(i + 1, unitCol + 1).setValue(normalizedFloorUnit.unit);
        sheet.getRange(i + 1, waCol + 1).setValue(sheetText_(nomorWhatsApp));
        sheet.getRange(i + 1, profileCol + 1).setValue('true');
        return { success: true };
      }
    }
    return { success: false, message: 'User tidak ditemukan.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getProfile(username, sessionToken) {
  try {
    const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
    username = session.role === 'resident' ? session.username : String(username || '').trim();
    if (!username) return { success: false, message: 'Username warga tidak valid.' };
    const wargaData = getSheetData_(SHEET_WARGA);
    const user = wargaData.find(function(row) {
      return String(row.Username || '').toLowerCase() === username.toLowerCase();
    });
    if (!user) return { success: false, message: 'User tidak ditemukan.' };
    return {
      success: true,
      profile: {
        username: user.Username,
        name: user.Nama || '',
        statusWisma: user.Status_Wisma || '',
        lantai: user.Lantai || '',
        unit: user.Unit || '',
        nomorWhatsApp: user.Nomor_WhatsApp || ''
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ===================================================================
// KELOLA WARGA (Admin & SuperAdmin)
// ===================================================================
function getWargaAttentionReasons_(row, pendingPinReset, accountOnlyAdmin, floorUnitCheck) {
  const reasons = [];
  if (pendingPinReset) reasons.push('Permintaan reset PIN menunggu');
  if (accountOnlyAdmin) return reasons;
  if (!(row.ProfileComplete === true || String(row.ProfileComplete || '').toLowerCase() === 'true')) reasons.push('Profil belum lengkap');
  if (!String(row.Nama || '').trim()) reasons.push('Nama belum diisi');
  if (!normalizeWhatsAppNumber_(row.Nomor_WhatsApp)) reasons.push('Nomor WhatsApp kosong/tidak valid');
  const floorUnit = floorUnitCheck || getFloorUnitAnomaly8O_(row);
  if (floorUnit.reason) reasons.push('Data hunian: ' + floorUnit.reason);
  return reasons;
}

function getAllWarga(requesterUsername, sessionToken) {
  const requester = requireSession_(sessionToken, ['admin', 'super_admin']);
  requesterUsername = requester.username;
  if (requester.role === 'admin' && !isAdminUsername_(requesterUsername)) return { authorized: false, data: [] };
  const wargaSheet = getSheet_(SHEET_WARGA);
  if (!wargaSheet || wargaSheet.getLastColumn() < 1) return { authorized: true, data: [] };
  const data = getSheetData_(SHEET_WARGA);
  const adminData = getSheetData_(SHEET_ADMINS);
  const adminNames = adminData.map(function (row) { return String(row.Username || '').toLowerCase(); });
  const pendingResetNames = {};
  const resetSheet = getSheet_(SHEET_RESETREQUESTS);
  if (resetSheet) getSheetData_(SHEET_RESETREQUESTS).forEach(function (row) {
    if (String(row.Status || '') === 'Menunggu') pendingResetNames[String(row.Username || '').toLowerCase()] = true;
  });
  // Never send PIN values to the browser, even to an authorized admin UI.
  const safeData = data.filter(function (row) { return !isSuperAdmin_(String(row.Username || '')); }).map(function (row) {
    const floorUnitCheck = getFloorUnitAnomaly8O_(row);
    const pendingPinReset = !!pendingResetNames[String(row.Username || '').toLowerCase()];
    const attentionReasons = getWargaAttentionReasons_(row, pendingPinReset, false, floorUnitCheck);
    return {
      Username: row.Username || '',
      Nama: row.Nama || '',
      Status_Wisma: row.Status_Wisma || '',
      Lantai: row.Lantai || '',
      Unit: row.Unit || '',
      Nomor_WhatsApp: row.Nomor_WhatsApp || '',
      Role: row.Role || '',
      ProfileComplete: row.ProfileComplete || '',
      IsAdmin: adminNames.indexOf(String(row.Username || '').toLowerCase()) >= 0,
      IsSuperAdmin: false,
      AccountOnlyAdmin: false,
      PendingPinReset: pendingPinReset,
      DataAnomaly: !!floorUnitCheck.reason,
      DataAnomalyReason: floorUnitCheck.reason,
      NeedsAttention: attentionReasons.length > 0,
      AttentionReasons: attentionReasons
    };
  });
  const residentNames = {};
  safeData.forEach(function (row) { residentNames[String(row.Username || '').toLowerCase()] = true; });
  adminData.forEach(function (row) {
    const username = String(row.Username || '').trim();
    if (!username || isSuperAdmin_(username) || residentNames[username.toLowerCase()]) return;
    const pendingPinReset = !!pendingResetNames[username.toLowerCase()];
    const attentionReasons = getWargaAttentionReasons_({}, pendingPinReset, true);
    safeData.push({ Username: username, Nama: row.Keterangan || '', Status_Wisma: '', Lantai: '', Unit: '', Nomor_WhatsApp: '', Role: 'admin', ProfileComplete: '', IsAdmin: true, IsSuperAdmin: false, AccountOnlyAdmin: true, PendingPinReset: pendingPinReset, DataAnomaly: false, DataAnomalyReason: '', NeedsAttention: attentionReasons.length > 0, AttentionReasons: attentionReasons });
  });
  return { authorized: true, data: safeData };
}

function ensureJelajahHeaders_(sheet, requiredHeaders) {
  if (!sheet) throw new Error('Sheet Jelajah tidak tersedia.');
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) { return String(value || '').trim(); });
  if (!headers[0]) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }
  requiredHeaders.forEach(function (header) {
    if (headers.indexOf(header) < 0) {
      const column = sheet.getLastColumn() + 1;
      sheet.getRange(1, column).setValue(header);
      headers.push(header);
    }
  });
}
function getJelajahIconOptions_() {
  return ['🍽️', '🛠️', '🌳', '👮', '🏥', '🛒', '💊', '☕', '🚗', '🏦', '🏪', '🏫', '🐾', '🚌', '🏨', '🎬', '📍', '⚽', '🛍️', '💇', '🏋️', '🎨', '📚', '🧺'];
}
function defaultJelajahCategoryIcon_(category) {
  const name = String(category || '').toLowerCase();
  if (name.indexOf('restoran') >= 0 || name.indexOf('makan') >= 0 || name.indexOf('kuliner') >= 0) return '🍽️';
  if (name.indexOf('bengkel') >= 0 || name.indexOf('servis') >= 0) return '🛠️';
  if (name.indexOf('taman') >= 0 || name.indexOf('hiburan') >= 0) return '🌳';
  if (name.indexOf('polisi') >= 0) return '👮';
  if (name.indexOf('apotek') >= 0 || name.indexOf('farmasi') >= 0 || name.indexOf('klinik') >= 0) return '💊';
  if (name.indexOf('rumah sakit') >= 0 || name.indexOf('kesehatan') >= 0) return '🏥';
  if (name.indexOf('kopi') >= 0 || name.indexOf('kafe') >= 0) return '☕';
  if (name.indexOf('toko') >= 0 || name.indexOf('belanja') >= 0) return '🛒';
  return '📍';
}
function isAllowedJelajahIcon_(icon) {
  const value = String(icon || '').trim();
  if (!value || value.length > 16) return false;
  try { return /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{S}\uFE0F\u200D\u20E3]+$/u.test(value); }
  catch (err) { return getJelajahIconOptions_().indexOf(value) >= 0; }
}
function isJelajahCatalogActive_(value) {
  if (value === false || value === 0) return false;
  const normalized = String(value == null ? '' : value).trim().toUpperCase();
  return !['FALSE', '0', 'TIDAK', 'NO', 'NONAKTIF', 'INACTIVE', 'DISABLED'].includes(normalized);
}
function getJelajahCategorySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_JELAJAH_KATEGORI);
  const isNew = !sheet;
  if (!sheet) sheet = ss.insertSheet(SHEET_JELAJAH_KATEGORI);
  ensureJelajahHeaders_(sheet, ['Kategori', 'Ikon', 'Aktif']);
  if (isNew || sheet.getLastRow() < 2) {
    if (sheet.getLastRow() < 2) sheet.getRange(2, 1, 4, 2).setValues([['Restoran', '🍽️'], ['Bengkel', '🛠️'], ['Taman/Tempat Hiburan', '🌳'], ['Kantor Polisi', '👮']]);
  }
  return sheet;
}
function getJelajahTypeSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_JELAJAH_JENIS);
  const isNew = !sheet;
  if (!sheet) sheet = ss.insertSheet(SHEET_JELAJAH_JENIS);
  ensureJelajahHeaders_(sheet, ['Kategori', 'Jenis', 'Aktif', 'Ikon']);
  if (isNew || sheet.getLastRow() < 2) {
    if (sheet.getLastRow() < 2) {
      sheet.getRange(2, 1, 21, 3).setValues([
        ['Restoran', 'Bakso', true], ['Restoran', 'Mie Ayam', true], ['Restoran', 'Nasi Padang', true], ['Restoran', 'Sate', true], ['Restoran', 'Seafood', true], ['Restoran', 'Kopi/Kafe', true],
        ['Bengkel', 'Servis Motor', true], ['Bengkel', 'Servis Mobil', true], ['Bengkel', 'Tambal Ban', true], ['Bengkel', 'Servis AC', true],
        ['Taman/Tempat Hiburan', 'Taman', true], ['Taman/Tempat Hiburan', 'Taman Bermain Anak', true], ['Taman/Tempat Hiburan', 'Tempat Olahraga', true], ['Taman/Tempat Hiburan', 'Bioskop', true], ['Taman/Tempat Hiburan', 'Pusat Hiburan', true],
        ['Kantor Polisi', 'Polsek', true], ['Kantor Polisi', 'Polres', true], ['Kantor Polisi', 'Pos Polisi', true], ['Kantor Polisi', 'Layanan Pengaduan', true], ['Kantor Polisi', 'Layanan SIM', true], ['Kantor Polisi', 'Layanan SKCK', true]
      ]);
    }
  }
  return sheet;
}
function getJelajahRecommendationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_JELAJAH);
  if (!sheet) sheet = ss.insertSheet(SHEET_JELAJAH);
  ensureJelajahHeaders_(sheet, JELAJAH_REC_HEADERS);
  return sheet;
}
function getJelajahReviewSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_JELAJAH_ULASAN);
  if (!sheet) sheet = ss.insertSheet(SHEET_JELAJAH_ULASAN);
  ensureJelajahHeaders_(sheet, ['ID', 'RecommendationID', 'Username', 'NamaPengulas', 'Rating', 'Komentar', 'StatusKomentar', 'CreatedAt', 'UpdatedAt']);
  return sheet;
}
function isAllowedGoogleMapsUrl_(value) {
  const url = String(value || '').trim();
  if (!url || url.length > 1000) return false;
  const match = url.match(/^https:\/\/([^\/?#]+)(\/[^?#]*)?/i);
  if (!match) return false;
  let host = String(match[1] || '').toLowerCase();
  if (host.endsWith(':443')) host = host.slice(0, -4);
  if (host.indexOf(':') >= 0) return false;
  const path = String(match[2] || '/').toLowerCase();
  if (host === 'maps.app.goo.gl') return path !== '/' && path.length > 1;
  if (host === 'maps.google.com' || host === 'maps.google.co.id') return path !== '/' || url.indexOf('?') >= 0;
  if (host === 'goo.gl') return path.indexOf('/maps/') === 0 || path === '/maps';
  if (host === 'google.com' || host === 'www.google.com' || host === 'google.co.id' || host === 'www.google.co.id') return path.indexOf('/maps') === 0;
  return false;
}
function getJelajahCatalog_() {
  getJelajahCategorySheet_();
  getJelajahTypeSheet_();
  const categoryRows = getSheetData_(SHEET_JELAJAH_KATEGORI);
  const allCategories = categoryRows.map(function (row) { return String(row.Kategori || '').trim(); }).filter(function (item, index, all) { return !!item && all.indexOf(item) === index; });
  const categoryActiveByName = {};
  const categoryIcons = {};
  allCategories.forEach(function (category) {
    Object.defineProperty(categoryActiveByName, category, { value: true, writable: true, enumerable: true, configurable: true });
    Object.defineProperty(categoryIcons, category, { value: defaultJelajahCategoryIcon_(category), writable: true, enumerable: true, configurable: true });
  });
  categoryRows.forEach(function (row) {
    const category = String(row.Kategori || '').trim();
    if (!category || !Object.prototype.hasOwnProperty.call(categoryActiveByName, category)) return;
    Object.defineProperty(categoryActiveByName, category, { value: isJelajahCatalogActive_(row.Aktif), writable: true, enumerable: true, configurable: true });
    const icon = String(row.Ikon || '').trim();
    if (isAllowedJelajahIcon_(icon)) Object.defineProperty(categoryIcons, category, { value: icon, writable: true, enumerable: true, configurable: true });
  });
  const activeCategories = allCategories.filter(function (category) { return categoryActiveByName[category] !== false; });
  const allTypesByCategory = {};
  const typeIconsByCategory = {};
  const typeActiveByCategory = {};
  const typesByCategory = {};
  allCategories.forEach(function (category) {
    Object.defineProperty(allTypesByCategory, category, { value: [], writable: true, enumerable: true, configurable: true });
    Object.defineProperty(typeIconsByCategory, category, { value: {}, writable: true, enumerable: true, configurable: true });
    Object.defineProperty(typeActiveByCategory, category, { value: {}, writable: true, enumerable: true, configurable: true });
  });
  activeCategories.forEach(function (category) { Object.defineProperty(typesByCategory, category, { value: [], writable: true, enumerable: true, configurable: true }); });
  const typeRows = getSheetData_(SHEET_JELAJAH_JENIS);
  typeRows.forEach(function (row) {
    const category = String(row.Kategori || '').trim();
    const type = String(row.Jenis || '').trim();
    if (!type || !Object.prototype.hasOwnProperty.call(allTypesByCategory, category)) return;
    const active = isJelajahCatalogActive_(row.Aktif);
    if (allTypesByCategory[category].indexOf(type) < 0) allTypesByCategory[category].push(type);
    Object.defineProperty(typeActiveByCategory[category], type, { value: active, writable: true, enumerable: true, configurable: true });
    const typeIcon = String(row.Ikon || '').trim();
    if (isAllowedJelajahIcon_(typeIcon)) Object.defineProperty(typeIconsByCategory[category], type, { value: typeIcon, writable: true, enumerable: true, configurable: true });
    if (active && Object.prototype.hasOwnProperty.call(typesByCategory, category) && typesByCategory[category].indexOf(type) < 0) typesByCategory[category].push(type);
  });
  Object.keys(allTypesByCategory).forEach(function (category) { allTypesByCategory[category].sort(); });
  Object.keys(typesByCategory).forEach(function (category) { typesByCategory[category].sort(); });
  return { categories: activeCategories, allCategories: allCategories, categoryActiveByName: categoryActiveByName, typesByCategory: typesByCategory, allTypesByCategory: allTypesByCategory, typeActiveByCategory: typeActiveByCategory, categoryIcons: categoryIcons, typeIconsByCategory: typeIconsByCategory, iconOptions: getJelajahIconOptions_() };
}
// v18 (A3): warga lain hanya melihat JENIS warga (Status_Wisma), bukan nama.
// Nama asli tetap tersimpan di sheet dan tampil untuk admin di Kelola Jelajah.
function jelajahPublicLabeler_() {
  const status = {};
  try {
    getSheetData_(SHEET_WARGA).forEach(function (row) {
      const u = String(row.Username || '').trim().toLowerCase();
      if (u) status[u] = String(row.Status_Wisma || '').trim();
    });
  } catch (ignore) {}
  const admins = getAdminUsernameSet_();
  return function (username) {
    const u = String(username || '').trim().toLowerCase();
    if (u && admins[u]) return 'Pengurus Tower 2';
    return status[u] || 'Warga Tower 2';
  };
}

function getJelajahReviewSummary_(reviewRows, labelOf) {
  const summary = {};
  reviewRows.forEach(function (row) {
    const recId = String(row.RecommendationID || '');
    const score = Number(row.Rating);
    if (!recId || score < 1 || score > 5 || Math.floor(score) !== score) return;
    if (!summary[recId]) summary[recId] = { total: 0, sum: 0, latestComment: null };
    summary[recId].total++;
    summary[recId].sum += score;
    const comment = String(row.Komentar || '').trim();
    const visible = String(row.StatusKomentar || 'Tampil') !== 'Disembunyikan';
    const stamp = new Date(row.UpdatedAt || row.CreatedAt || 0).getTime() || 0;
    if (comment && visible && (!summary[recId].latestComment || stamp >= summary[recId].latestComment._stamp)) {
      summary[recId].latestComment = { text: comment, name: labelOf ? labelOf(row.Username) : String(row.NamaPengulas || 'Warga'), rating: score, _stamp: stamp };
    }
  });
  Object.keys(summary).forEach(function (id) {
    summary[id].average = summary[id].total ? Math.round(summary[id].sum / summary[id].total * 10) / 10 : 0;
    if (summary[id].latestComment) delete summary[id].latestComment._stamp;
  });
  return summary;
}
function getJelajahRecommendationRows_() {
  getJelajahRecommendationSheet_();
  return getSheetData_(SHEET_JELAJAH);
}
function buildJelajahRecommendationPublic_(row, summary, labelOf) {
  const id = String(row.ID || '');
  const score = summary[id] || { total: 0, sum: 0, average: 0, latestComment: null };
  return {
    id: id, timestamp: row.Timestamp ? formatTanggal_(row.Timestamp) : '',
    namaPengirim: labelOf ? labelOf(row.Username) : String(row.NamaPengirim || ''), kategori: String(row.Kategori || ''), jenis: String(row.Jenis || ''),
    namaLokasi: String(row.NamaLokasi || ''), tautanMaps: String(row.TautanMaps || ''), alamat: String(row.Alamat || ''),
    keterangan: String(row.Keterangan || ''), tags: String(row.Tagging || ''),
    verified: String(row.StatusVerifikasi || '') === 'Terverifikasi',
    lat: (function () { const c = parseJelajahCoordinate_(row.Lat, row.Lng); return c ? c.lat : null; })(),
    lng: (function () { const c = parseJelajahCoordinate_(row.Lat, row.Lng); return c ? c.lng : null; })(),
    jamBuka: String(row.JamBuka || ''), harga: Number(row.Harga) >= 1 && Number(row.Harga) <= 5 ? Number(row.Harga) : 0,
    createdMs: row.Timestamp ? new Date(row.Timestamp).getTime() || 0 : 0,
    ratingAverage: score.average || 0, ratingCount: score.total || 0,
    featuredComment: score.latestComment ? score.latestComment.text : '',
    featuredCommentName: score.latestComment ? score.latestComment.name : '', featuredCommentRating: score.latestComment ? score.latestComment.rating : 0
  };
}
function getJelajahSekitar(sessionToken) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  withScriptLock_(function () { getJelajahCategorySheet_(); getJelajahTypeSheet_(); getJelajahRecommendationSheet_(); getJelajahReviewSheet_(); });
  const catalog = getJelajahCatalog_();
  const reviews = getSheetData_(SHEET_JELAJAH_ULASAN);
  const labelOf = jelajahPublicLabeler_();
  const summary = getJelajahReviewSummary_(reviews, labelOf);
  const me = String(session.username || '').toLowerCase();
  getJelajahFavoriteSheet_();
  const favorites = getSheetData_(SHEET_JELAJAH_FAVORIT).filter(function (row) { return String(row.Username || '').toLowerCase() === me; }).map(function (row) { return String(row.RecommendationID); });
  const recommendations = getJelajahRecommendationRows_().filter(function (row) { return String(row.StatusRekomendasi || 'Aktif') !== 'Dihapus'; })
    .map(function (row) {
      const item = buildJelajahRecommendationPublic_(row, summary, labelOf);
      item.mine = String(row.Username || '').toLowerCase() === me;
      item.favorited = favorites.indexOf(item.id) >= 0;
      return item;
    }).reverse();
  return { success: true, tower: getJelajahTowerLocation_(), priceLabels: JELAJAH_PRICE_LABELS, reportReasons: JELAJAH_REPORT_REASONS, canManage: session.role !== 'resident', categories: catalog.categories, allCategories: catalog.allCategories, categoryActiveByName: catalog.categoryActiveByName, typesByCategory: catalog.typesByCategory, allTypesByCategory: catalog.allTypesByCategory, typeActiveByCategory: catalog.typeActiveByCategory, categoryIcons: catalog.categoryIcons, typeIconsByCategory: catalog.typeIconsByCategory, iconOptions: catalog.iconOptions, recommendations: recommendations };
}
// -------------------------------------------------------------------
// v17 — CEK DUPLIKAT REKOMENDASI JELAJAH (di server, berlaku untuk semua peran)
// Ditolak bila tempat aktif lain:
//   1. punya PlaceId Google yang sama, atau
//   2. memuat nomor telepon yang sama (dibaca dari alamat, jam buka, atau keterangan), atau
//   3. namanya sama/mirip DAN titiknya berjarak < JELAJAH_DUPLICATE_RADIUS_M
//      (atau salah satunya belum punya titik).
// Nama saja tidak cukup (cabang waralaba di tempat lain tetap boleh), dan titik saja
// tidak cukup (beberapa kios bisa berada di satu gedung/food court).
// Rekomendasi yang diarsipkan (Dihapus) tidak dihitung.
// -------------------------------------------------------------------
const JELAJAH_DUPLICATE_RADIUS_M = 300;

function jelajahNameKey_(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function jelajahNamesMatch_(a, b) {
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0);
}

// Nomor Indonesia: 08xx, +628xx, 628xx, atau nomor kantor 021-xxxx. Hasil dinormalkan ke 62xxxxxxxx.
function jelajahPhoneNumbers_(text) {
  const out = [];
  const matches = String(text || '').match(/(?<![0-9.,])(?:\+?62[ .\-]?|\(?0)[1-9][0-9 ().\-]{6,16}[0-9]/g) || [];
  matches.forEach(function (raw) {
    let digits = raw.replace(/[^0-9]/g, '');
    if (digits.charAt(0) === '0') digits = '62' + digits.substring(1);
    if (digits.length >= 9 && digits.length <= 15 && out.indexOf(digits) < 0) out.push(digits);
  });
  return out;
}

function jelajahPhoneLabel_(digits) {
  return '0' + String(digits).substring(2);
}

function findJelajahDuplicate_(input, ignoreId) {
  const nameKey = jelajahNameKey_(input.namaLokasi);
  const phones = jelajahPhoneNumbers_([input.alamat, input.jamBuka, input.keterangan].join(' '));
  const placeId = String(input.placeId || '').trim();
  const placeIdUsable = placeId && placeId !== 'tidak-ditemukan';
  const rows = getJelajahRecommendationRows_();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id = String(row.ID || '');
    if (!id || id === ignoreId || String(row.StatusRekomendasi || 'Aktif') === 'Dihapus') continue;
    const name = String(row.NamaLokasi || '');
    if (placeIdUsable && String(row.PlaceId || '').trim() === placeId) {
      return { id: id, namaLokasi: name, reason: 'lokasi Google yang sama' };
    }
    if (phones.length) {
      const rowPhones = jelajahPhoneNumbers_([row.Alamat, row.JamBuka, row.Keterangan].join(' '));
      const shared = phones.filter(function (p) { return rowPhones.indexOf(p) >= 0; })[0];
      if (shared) return { id: id, namaLokasi: name, reason: 'nomor telepon yang sama (' + jelajahPhoneLabel_(shared) + ')' };
    }
    if (jelajahNamesMatch_(nameKey, jelajahNameKey_(name))) {
      const rowCoord = parseJelajahCoordinate_(row.Lat, row.Lng);
      if (!input.coord || !rowCoord) return { id: id, namaLokasi: name, reason: 'nama yang sama' };
      if (haversineMeters_(input.coord, rowCoord) < JELAJAH_DUPLICATE_RADIUS_M) return { id: id, namaLokasi: name, reason: 'nama yang sama di lokasi berdekatan' };
    }
  }
  return null;
}

function jelajahDuplicateResponse_(dup) {
  return {
    success: false,
    duplicate: { id: dup.id, namaLokasi: dup.namaLokasi },
    message: '"' + dup.namaLokasi + '" sudah ada di Jelajah Sekitar (' + dup.reason + '). Beri ulasan di tempat itu bila sama, atau ubah nama/titiknya bila memang tempat berbeda.'
  };
}

function submitJelajahRecommendation(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  payload = payload || {};
  let input;
  try { input = readJelajahRecommendationInput_(payload); } catch (err) { return { success: false, message: err.message }; }
  try {
    const senderName = jelajahSenderName_(session.username);
    return withScriptLock_(function () {
      const catalog = getJelajahCatalog_();
      if (catalog.categories.indexOf(input.kategori) < 0 || (catalog.typesByCategory[input.kategori] || []).indexOf(input.jenis) < 0) return { success: false, message: 'Kategori atau jenis sudah tidak tersedia. Muat ulang halaman dan pilih kembali.' };
      const dup = findJelajahDuplicate_(input, '');
      if (dup) return jelajahDuplicateResponse_(dup);
      const id = Utilities.getUuid();
      const record = jelajahRecordFromInput_(input);
      record.ID = id; record.Timestamp = new Date(); record.Username = sheetText_(session.username); record.NamaPengirim = sheetText_(senderName);
      record.StatusVerifikasi = 'Menunggu'; record.StatusRekomendasi = 'Aktif';
      appendRowByHeaders_(getJelajahRecommendationSheet_(), record);
      writeAuditLog_('SUBMIT_JELAJAH_RECOMMENDATION', session.username, id, 'category=' + input.kategori);
      return { success: true, id: id, message: 'Rekomendasi berhasil disimpan dan langsung tersedia untuk warga.' };
    });
  } catch (err) {
    writeApplicationError_('submitJelajahRecommendation', err, session.username);
    return { success: false, message: 'Rekomendasi belum tersimpan. Coba lagi sebentar.' };
  }
}
function submitJelajahReview(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  payload = payload || {};
  const recommendationId = String(payload.recommendationId || '').trim();
  const rating = Number(payload.rating);
  const comment = String(payload.comment || '').trim();
  if (!recommendationId) return { success: false, message: 'Rekomendasi tidak valid.' };
  if (rating < 1 || rating > 5 || Math.floor(rating) !== rating) return { success: false, message: 'Pilih rating 1 sampai 5 bintang.' };
  if (comment.length > 500) return { success: false, message: 'Komentar maksimal 500 karakter.' };
  try {
    const resident = getSheetData_(SHEET_WARGA).find(function (row) { return String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase(); });
    const reviewerName = String(resident && resident.Nama || session.username);
    return withScriptLock_(function () {
      const recRows = getJelajahRecommendationRows_();
      const targetRecommendation = recRows.find(function (row) { return String(row.ID || '') === recommendationId; });
      if (!targetRecommendation || String(targetRecommendation.StatusRekomendasi || 'Aktif') === 'Dihapus') return { success: false, message: 'Rekomendasi tidak ditemukan atau sedang diarsipkan.' };
      const sheet = getJelajahReviewSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0].map(function (h) { return String(h || ''); });
      const index = {};
      headers.forEach(function (h, i) { index[h] = i; });
      let rowIndex = -1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][index.RecommendationID] || '') === recommendationId && String(values[i][index.Username] || '').toLowerCase() === String(session.username).toLowerCase()) { rowIndex = i; break; }
      }
      const now = new Date();
      if (rowIndex >= 0) {
        const sheetRow = rowIndex + 1;
        sheet.getRange(sheetRow, index.Rating + 1).setValue(rating);
        sheet.getRange(sheetRow, index.Komentar + 1).setValue(sheetText_(comment));
        sheet.getRange(sheetRow, index.NamaPengulas + 1).setValue(sheetText_(reviewerName));
        sheet.getRange(sheetRow, index.UpdatedAt + 1).setValue(now);
      } else {
        sheet.appendRow([Utilities.getUuid(), recommendationId, sheetText_(session.username), sheetText_(reviewerName), rating, sheetText_(comment), 'Tampil', now, now]);
      }
      writeAuditLog_('UPSERT_JELAJAH_REVIEW', session.username, recommendationId, 'rating=' + rating);
      return { success: true, message: 'Rating dan komentar berhasil disimpan.' };
    });
  } catch (err) { writeApplicationError_('submitJelajahReview', err, session.username); return { success: false, message: 'Rating belum tersimpan. Coba lagi.' }; }
}
function getJelajahReviews(recommendationId, sessionToken) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const id = String(recommendationId || '').trim();
  const rec = getJelajahRecommendationRows_().find(function (row) { return String(row.ID || '') === id; });
  if (!rec || String(rec.StatusRekomendasi || 'Aktif') === 'Dihapus') return { success: false, message: 'Rekomendasi tidak ditemukan atau sedang diarsipkan.' };
  getJelajahReviewSheet_();
  const rows = getSheetData_(SHEET_JELAJAH_ULASAN).filter(function (row) { return String(row.RecommendationID || '') === id; });
  const labelOf = jelajahPublicLabeler_();
  const summary = getJelajahReviewSummary_(rows, labelOf)[id] || { total: 0, sum: 0, average: 0 };
  const own = rows.find(function (row) { return String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase(); });
  const comments = rows.filter(function (row) { return String(row.Komentar || '').trim() && String(row.StatusKomentar || 'Tampil') !== 'Disembunyikan'; })
    .sort(function (a, b) { return new Date(b.UpdatedAt || b.CreatedAt || 0).getTime() - new Date(a.UpdatedAt || a.CreatedAt || 0).getTime(); })
    .slice(0, 100).map(function (row) { return { nama: labelOf(row.Username), rating: Number(row.Rating) || 0, komentar: String(row.Komentar || ''), tanggal: row.UpdatedAt || row.CreatedAt ? formatTanggal_(row.UpdatedAt || row.CreatedAt) : '' }; });
  return { success: true, recommendation: buildJelajahRecommendationPublic_(rec, (function () { const obj = {}; obj[id] = summary; return obj; })(), labelOf), ratingAverage: summary.average || 0, ratingCount: summary.total || 0, ownReview: own ? { rating: Number(own.Rating) || 0, comment: String(own.Komentar || ''), commentHidden: String(own.StatusKomentar || '') === 'Disembunyikan' } : null, comments: comments };
}
function requireJelajahAdmin_(token) {
  const session = requireSession_(token, ['admin', 'super_admin']);
  if (!isAdminUsername_(session.username)) throw new Error('Anda tidak memiliki akses Admin.');
  return session;
}
function getKelolaJelajah(sessionToken) {
  const session = requireJelajahAdmin_(sessionToken);
  withScriptLock_(function () { getJelajahCategorySheet_(); getJelajahTypeSheet_(); getJelajahRecommendationSheet_(); getJelajahReviewSheet_(); });
  const catalog = getJelajahCatalog_();
  const reviews = getSheetData_(SHEET_JELAJAH_ULASAN);
  const summary = getJelajahReviewSummary_(reviews);
  const recommendations = getJelajahRecommendationRows_().map(function (row) {
    const item = buildJelajahRecommendationPublic_(row, summary);
    item.username = String(row.Username || ''); item.statusVerifikasi = String(row.StatusVerifikasi || 'Menunggu'); item.verifikasiOleh = String(row.VerifikasiOleh || '');
    item.statusRekomendasi = String(row.StatusRekomendasi || 'Aktif');
    return item;
  }).reverse();
  getJelajahReportSheet_();
  const recNames = {};
  recommendations.forEach(function (r) { recNames[r.id] = r.namaLokasi; });
  const reports = getSheetData_(SHEET_JELAJAH_LAPORAN).filter(function (row) { return String(row.Status || 'Baru') === 'Baru'; }).map(function (row) {
    return { id: String(row.ID), recommendationId: String(row.RecommendationID), namaLokasi: recNames[String(row.RecommendationID)] || '(sudah dihapus)', alasan: String(row.Alasan || ''), catatan: String(row.Catatan || ''), pelapor: String(row.NamaPelapor || row.Username || ''), tanggal: row.CreatedAt ? formatTanggal_(row.CreatedAt) : '' };
  }).reverse();
  const missingCoords = recommendations.filter(function (r) { return r.statusRekomendasi !== 'Dihapus' && (r.lat === null || r.lng === null); }).length;
  return { success: true, actor: session.username, reports: reports, tower: getJelajahTowerLocation_(), missingCoords: missingCoords, categories: catalog.allCategories, typesByCategory: catalog.allTypesByCategory, categoryActiveByName: catalog.categoryActiveByName, typeActiveByCategory: catalog.typeActiveByCategory, categoryIcons: catalog.categoryIcons, typeIconsByCategory: catalog.typeIconsByCategory, iconOptions: catalog.iconOptions, recommendations: recommendations };
}
function addJelajahCategory(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const category = String(payload && payload.category || '').trim();
  const icon = String(payload && payload.icon || '').trim() || defaultJelajahCategoryIcon_(category);
  if (category.length < 2 || category.length > 60) return { success: false, message: 'Nama kategori harus 2–60 karakter.' };
  if (!isAllowedJelajahIcon_(icon)) return { success: false, message: 'Masukkan satu emoji atau simbol yang valid (maksimal 16 karakter).' }
  try {
    return withScriptLock_(function () {
      const sheet = getJelajahCategorySheet_();
      const all = getSheetData_(SHEET_JELAJAH_KATEGORI);
      if (all.some(function (row) { return String(row.Kategori || '').trim().toLowerCase() === category.toLowerCase(); })) return { success: false, message: 'Kategori itu sudah ada.' };
      const categoryHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
      const newCategoryRow = Array(categoryHeaders.length).fill('');
      newCategoryRow[categoryHeaders.indexOf('Kategori')] = sheetText_(category);
      newCategoryRow[categoryHeaders.indexOf('Ikon')] = icon;
      newCategoryRow[categoryHeaders.indexOf('Aktif')] = true;
      sheet.appendRow(newCategoryRow);
      writeAuditLog_('ADD_JELAJAH_CATEGORY', session.username, category, '');
      return { success: true, message: 'Kategori berhasil ditambahkan.' };
    });
  } catch (err) { return { success: false, message: 'Kategori belum tersimpan: ' + err.message }; }
}
function addJelajahType(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const category = String(payload && payload.category || '').trim();
  const type = String(payload && payload.type || '').trim();
  const icon = String(payload && payload.icon || '').trim() || defaultJelajahCategoryIcon_(category);
  if (!category || type.length < 2 || type.length > 80) return { success: false, message: 'Pilih kategori dan isi jenis 2–80 karakter.' };
  if (!isAllowedJelajahIcon_(icon)) return { success: false, message: 'Masukkan satu emoji atau simbol yang valid (maksimal 16 karakter).' };
  try {
    return withScriptLock_(function () {
      const catalog = getJelajahCatalog_();
      if (catalog.categories.indexOf(category) < 0) return { success: false, message: 'Kategori tidak ditemukan atau sedang dinonaktifkan.' };
      if ((catalog.typesByCategory[category] || []).some(function (item) { return item.toLowerCase() === type.toLowerCase(); })) return { success: false, message: 'Jenis tersebut sudah ada pada kategori ini.' };
      const sheet = getJelajahTypeSheet_();
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
      const row = Array(headers.length).fill('');
      row[headers.indexOf('Kategori')] = sheetText_(category);
      row[headers.indexOf('Jenis')] = sheetText_(type);
      row[headers.indexOf('Aktif')] = true;
      row[headers.indexOf('Ikon')] = icon;
      sheet.appendRow(row);
      writeAuditLog_('ADD_JELAJAH_TYPE', session.username, category + ' / ' + type, 'icon=' + icon);
      return { success: true, message: 'Jenis berhasil ditambahkan.' };
    });
  } catch (err) { return { success: false, message: 'Jenis belum tersimpan: ' + err.message }; }
}

function updateJelajahCategory(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const oldCategory = String(payload && payload.oldCategory || '').trim();
  const newCategory = String(payload && payload.category || '').trim();
  const icon = String(payload && payload.icon || '').trim();
  if (!oldCategory || newCategory.length < 2 || newCategory.length > 60) return { success: false, message: 'Nama kategori harus 2–60 karakter.' };
  try {
    return withScriptLock_(function () {
      const categorySheet = getJelajahCategorySheet_();
      const categoryRows = categorySheet.getDataRange().getValues();
      const categoryHeaders = categoryRows[0].map(function (value) { return String(value || '').trim(); });
      const categoryCol = categoryHeaders.indexOf('Kategori');
      const iconCol = categoryHeaders.indexOf('Ikon');
      if (categoryCol < 0) return { success: false, message: 'Kolom kategori tidak ditemukan.' };
      let found = false;
      for (let i = 1; i < categoryRows.length; i++) {
        const current = String(categoryRows[i][categoryCol] || '').trim();
        if (current.toLowerCase() === oldCategory.toLowerCase()) found = true;
        if (current.toLowerCase() === newCategory.toLowerCase() && current.toLowerCase() !== oldCategory.toLowerCase()) return { success: false, message: 'Nama kategori itu sudah digunakan.' };
      }
      if (!found) return { success: false, message: 'Kategori yang akan diedit tidak ditemukan.' };
      if (icon && !isAllowedJelajahIcon_(icon)) return { success: false, message: 'Masukkan satu emoji atau simbol yang valid (maksimal 16 karakter).' }
      const oldExact = categoryRows.slice(1).map(function (row) { return String(row[categoryCol] || '').trim(); }).find(function (value) { return value.toLowerCase() === oldCategory.toLowerCase(); });
      const safeNew = sheetText_(newCategory);
      for (let i = 1; i < categoryRows.length; i++) {
        if (String(categoryRows[i][categoryCol] || '').trim() === oldExact) {
          categorySheet.getRange(i + 1, categoryCol + 1).setValue(safeNew);
          if (icon && iconCol >= 0) categorySheet.getRange(i + 1, iconCol + 1).setValue(icon);
        }
      }
      const typeSheet = getJelajahTypeSheet_();
      const typeRows = typeSheet.getDataRange().getValues();
      const typeHeaders = typeRows[0].map(function (value) { return String(value || '').trim(); });
      const typeCategoryCol = typeHeaders.indexOf('Kategori');
      if (typeCategoryCol >= 0) {
        for (let i = 1; i < typeRows.length; i++) {
          if (String(typeRows[i][typeCategoryCol] || '').trim() === oldExact) typeSheet.getRange(i + 1, typeCategoryCol + 1).setValue(safeNew);
        }
      }
      const recommendationSheet = getJelajahRecommendationSheet_();
      const recommendationRows = recommendationSheet.getDataRange().getValues();
      const recommendationHeaders = recommendationRows[0].map(function (value) { return String(value || '').trim(); });
      const recommendationCategoryCol = recommendationHeaders.indexOf('Kategori');
      if (recommendationCategoryCol >= 0) {
        for (let i = 1; i < recommendationRows.length; i++) {
          if (String(recommendationRows[i][recommendationCategoryCol] || '').trim() === oldExact) recommendationSheet.getRange(i + 1, recommendationCategoryCol + 1).setValue(safeNew);
        }
      }
      writeAuditLog_('UPDATE_JELAJAH_CATEGORY', session.username, oldExact, 'new=' + newCategory);
      return { success: true, message: 'Nama kategori diperbarui. Jenis dan rekomendasi lama ikut disesuaikan.' };
    });
  } catch (err) { return { success: false, message: 'Kategori belum diperbarui: ' + err.message }; }
}
function updateJelajahType(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const category = String(payload && payload.category || '').trim();
  const oldType = String(payload && payload.oldType || '').trim();
  const newType = String(payload && payload.type || '').trim();
  const icon = String(payload && payload.icon || '').trim();
  if (!category || !oldType || newType.length < 2 || newType.length > 80) return { success: false, message: 'Nama jenis harus 2–80 karakter.' };
  if (icon && !isAllowedJelajahIcon_(icon)) return { success: false, message: 'Masukkan satu emoji atau simbol yang valid (maksimal 16 karakter).' };
  try {
    return withScriptLock_(function () {
      const catalog = getJelajahCatalog_();
      const actualCategory = catalog.allCategories.find(function (item) { return item.toLowerCase() === category.toLowerCase(); });
      if (!actualCategory) return { success: false, message: 'Kategori tidak ditemukan.' };
      const availableTypes = catalog.allTypesByCategory[actualCategory] || [];
      const actualType = availableTypes.find(function (item) { return item.toLowerCase() === oldType.toLowerCase(); });
      if (!actualType) return { success: false, message: 'Jenis yang akan diedit tidak ditemukan atau sudah tidak aktif.' };
      if (availableTypes.some(function (item) { return item.toLowerCase() === newType.toLowerCase() && item.toLowerCase() !== actualType.toLowerCase(); })) return { success: false, message: 'Jenis itu sudah ada pada kategori ini.' };
      const typeSheet = getJelajahTypeSheet_();
      const typeRows = typeSheet.getDataRange().getValues();
      const typeHeaders = typeRows[0].map(function (value) { return String(value || '').trim(); });
      const typeCategoryCol = typeHeaders.indexOf('Kategori');
      const typeNameCol = typeHeaders.indexOf('Jenis');
      const typeIconCol = typeHeaders.indexOf('Ikon');
      let changed = false;
      for (let i = 1; i < typeRows.length; i++) {
        if (String(typeRows[i][typeCategoryCol] || '').trim() === actualCategory && String(typeRows[i][typeNameCol] || '').trim() === actualType) {
          typeSheet.getRange(i + 1, typeNameCol + 1).setValue(sheetText_(newType));
          if (icon && typeIconCol >= 0) typeSheet.getRange(i + 1, typeIconCol + 1).setValue(icon);
          changed = true;
        }
      }
      if (!changed) return { success: false, message: 'Jenis yang akan diedit tidak ditemukan.' };
      const recommendationSheet = getJelajahRecommendationSheet_();
      const recommendationRows = recommendationSheet.getDataRange().getValues();
      const recommendationHeaders = recommendationRows[0].map(function (value) { return String(value || '').trim(); });
      const recCategoryCol = recommendationHeaders.indexOf('Kategori');
      const recTypeCol = recommendationHeaders.indexOf('Jenis');
      if (recCategoryCol >= 0 && recTypeCol >= 0) {
        for (let i = 1; i < recommendationRows.length; i++) {
          if (String(recommendationRows[i][recCategoryCol] || '').trim() === actualCategory && String(recommendationRows[i][recTypeCol] || '').trim() === actualType) recommendationSheet.getRange(i + 1, recTypeCol + 1).setValue(sheetText_(newType));
        }
      }
      writeAuditLog_('UPDATE_JELAJAH_TYPE', session.username, actualCategory + ' / ' + actualType, 'new=' + newType);
      return { success: true, message: 'Jenis diperbarui. Rekomendasi lama ikut disesuaikan.' };
    });
  } catch (err) { return { success: false, message: 'Jenis belum diperbarui: ' + err.message }; }
}
function setJelajahCategoryActive(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const category = String(payload && payload.category || '').trim();
  const active = payload && payload.active === true;
  if (!category) return { success: false, message: 'Kategori tidak valid.' };
  try {
    return withScriptLock_(function () {
      const sheet = getJelajahCategorySheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0].map(function (h) { return String(h || '').trim(); });
      const categoryCol = headers.indexOf('Kategori'); const activeCol = headers.indexOf('Aktif');
      if (categoryCol < 0 || activeCol < 0) return { success: false, message: 'Kolom status kategori tidak tersedia.' };
      let changed = 0;
      for (let i = 1; i < values.length; i++) if (String(values[i][categoryCol] || '').trim().toLowerCase() === category.toLowerCase()) { sheet.getRange(i + 1, activeCol + 1).setValue(active); changed++; }
      if (!changed) return { success: false, message: 'Kategori tidak ditemukan.' };
      writeAuditLog_(active ? 'ENABLE_JELAJAH_CATEGORY' : 'DISABLE_JELAJAH_CATEGORY', session.username, category, 'history=preserved');
      return { success: true, message: active ? 'Kategori diaktifkan kembali. Jenis yang masih aktif tersedia untuk rekomendasi baru.' : 'Kategori dinonaktifkan. Kategori tersembunyi dari pilihan baru; rekomendasi dan ulasan lama tetap tersimpan dan tampil.' };
    });
  } catch (err) { return { success: false, message: 'Status kategori belum berubah: ' + err.message }; }
}
function setJelajahTypeActive(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const category = String(payload && payload.category || '').trim();
  const type = String(payload && payload.type || '').trim();
  const active = payload && payload.active === true;
  if (!category || !type) return { success: false, message: 'Kategori atau jenis tidak valid.' };
  try {
    return withScriptLock_(function () {
      const catalog = getJelajahCatalog_();
      const actualCategory = catalog.allCategories.find(function (item) { return item.toLowerCase() === category.toLowerCase(); });
      if (!actualCategory) return { success: false, message: 'Kategori tidak ditemukan.' };
      const actualType = (catalog.allTypesByCategory[actualCategory] || []).find(function (item) { return item.toLowerCase() === type.toLowerCase(); });
      if (!actualType) return { success: false, message: 'Jenis tidak ditemukan.' };
      const sheet = getJelajahTypeSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0].map(function (h) { return String(h || '').trim(); });
      const categoryCol = headers.indexOf('Kategori'); const typeCol = headers.indexOf('Jenis'); const activeCol = headers.indexOf('Aktif');
      if (categoryCol < 0 || typeCol < 0 || activeCol < 0) return { success: false, message: 'Kolom status jenis tidak tersedia.' };
      let changed = 0;
      for (let i = 1; i < values.length; i++) if (String(values[i][categoryCol] || '').trim() === actualCategory && String(values[i][typeCol] || '').trim() === actualType) { sheet.getRange(i + 1, activeCol + 1).setValue(active); changed++; }
      if (!changed) return { success: false, message: 'Jenis tidak ditemukan.' };
      writeAuditLog_(active ? 'ENABLE_JELAJAH_TYPE' : 'DISABLE_JELAJAH_TYPE', session.username, actualCategory + ' / ' + actualType, 'history=preserved');
      return { success: true, message: active ? (catalog.categoryActiveByName[actualCategory] ? 'Jenis diaktifkan kembali dan tersedia untuk rekomendasi baru.' : 'Jenis diaktifkan kembali, tetapi tetap tersembunyi sampai kategorinya diaktifkan.') : 'Jenis dinonaktifkan dari pilihan baru; rekomendasi dan ulasan lama tetap tersimpan dan tampil.' };
    });
  } catch (err) { return { success: false, message: 'Status jenis belum berubah: ' + err.message }; }
}

function setJelajahRecommendationDeleted(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const id = String(payload && payload.recommendationId || '').trim();
  const deleted = payload && payload.deleted === true;
  if (!id || (payload.deleted !== true && payload.deleted !== false)) return { success: false, message: 'Rekomendasi atau status tidak valid.' };
  try {
    return withScriptLock_(function () {
      const sheet = getJelajahRecommendationSheet_();
      const values = sheet.getDataRange().getValues();
      if (!values.length) return { success: false, message: 'Rekomendasi tidak ditemukan.' };
      const headers = values[0].map(function (h) { return String(h || '').trim(); });
      const idCol = headers.indexOf('ID');
      const statusCol = headers.indexOf('StatusRekomendasi');
      if (idCol < 0 || statusCol < 0) return { success: false, message: 'Kolom status rekomendasi tidak tersedia.' };
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idCol] || '') !== id) continue;
        sheet.getRange(i + 1, statusCol + 1).setValue(deleted ? 'Dihapus' : 'Aktif');
        writeAuditLog_(deleted ? 'HIDE_JELAJAH_RECOMMENDATION' : 'RESTORE_JELAJAH_RECOMMENDATION', session.username, id, 'reviews=preserved');
        return { success: true, message: deleted ? 'Rekomendasi disembunyikan dari tampilan warga. Riwayat rating dan komentar tetap tersimpan.' : 'Rekomendasi dipulihkan dan ditampilkan kembali kepada warga.' };
      }
      return { success: false, message: 'Rekomendasi tidak ditemukan.' };
    });
  } catch (err) {
    writeApplicationError_('setJelajahRecommendationDeleted', err, session.username);
    return { success: false, message: 'Status rekomendasi belum berubah. Coba lagi.' };
  }
}

function setJelajahVerification(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const id = String(payload && payload.recommendationId || '').trim();
  const verified = !!(payload && payload.verified);
  if (!id) return { success: false, message: 'Rekomendasi tidak valid.' };
  try {
    return withScriptLock_(function () {
      const sheet = getJelajahRecommendationSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0].map(function (h) { return String(h || ''); });
      const idCol = headers.indexOf('ID') + 1;
      const statusCol = headers.indexOf('StatusVerifikasi') + 1;
      const byCol = headers.indexOf('VerifikasiOleh') + 1;
      const dateCol = headers.indexOf('TanggalVerifikasi') + 1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idCol - 1] || '') !== id) continue;
        sheet.getRange(i + 1, statusCol).setValue(verified ? 'Terverifikasi' : 'Menunggu');
        sheet.getRange(i + 1, byCol).setValue(verified ? sheetText_(session.username) : '');
        sheet.getRange(i + 1, dateCol).setValue(verified ? new Date() : '');
        writeAuditLog_('VERIFY_JELAJAH_RECOMMENDATION', session.username, id, verified ? 'Terverifikasi' : 'Menunggu');
        return { success: true, message: verified ? 'Rekomendasi ditandai terverifikasi.' : 'Status verifikasi dikembalikan ke Menunggu.' };
      }
      return { success: false, message: 'Rekomendasi tidak ditemukan.' };
    });
  } catch (err) { return { success: false, message: 'Status verifikasi belum diperbarui.' }; }
}
function getJelajahReviewsAdmin(recommendationId, sessionToken) {
  requireJelajahAdmin_(sessionToken);
  const id = String(recommendationId || '').trim();
  const rec = getJelajahRecommendationRows_().find(function (row) { return String(row.ID || '') === id; });
  if (!rec) return { success: false, message: 'Rekomendasi tidak ditemukan.' };
  getJelajahReviewSheet_();
  const rows = getSheetData_(SHEET_JELAJAH_ULASAN).filter(function (row) { return String(row.RecommendationID || '') === id; })
    .sort(function (a, b) { return new Date(b.UpdatedAt || b.CreatedAt || 0).getTime() - new Date(a.UpdatedAt || a.CreatedAt || 0).getTime(); })
    .map(function (row) { return { id: String(row.ID || ''), nama: String(row.NamaPengulas || row.Username || 'Warga'), rating: Number(row.Rating) || 0, komentar: String(row.Komentar || ''), hidden: String(row.StatusKomentar || '') === 'Disembunyikan', tanggal: row.UpdatedAt || row.CreatedAt ? formatTanggal_(row.UpdatedAt || row.CreatedAt) : '' }; });
  return { success: true, reviews: rows };
}
function setJelajahCommentVisibility(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const reviewId = String(payload && payload.reviewId || '').trim();
  const visible = !!(payload && payload.visible);
  if (!reviewId) return { success: false, message: 'Komentar tidak valid.' };
  try {
    return withScriptLock_(function () {
      const sheet = getJelajahReviewSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0].map(function (h) { return String(h || ''); });
      const idCol = headers.indexOf('ID') + 1;
      const commentCol = headers.indexOf('Komentar') + 1;
      const statusCol = headers.indexOf('StatusKomentar') + 1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idCol - 1] || '') !== reviewId) continue;
        if (!String(values[i][commentCol - 1] || '').trim()) return { success: false, message: 'Ulasan ini tidak memiliki komentar.' };
        sheet.getRange(i + 1, statusCol).setValue(visible ? 'Tampil' : 'Disembunyikan');
        writeAuditLog_('MODERATE_JELAJAH_COMMENT', session.username, reviewId, visible ? 'Tampil' : 'Disembunyikan');
        return { success: true, message: visible ? 'Komentar ditampilkan kembali.' : 'Komentar disembunyikan; rating tetap dihitung.' };
      }
      return { success: false, message: 'Komentar tidak ditemukan.' };
    });
  } catch (err) { return { success: false, message: 'Status komentar belum diperbarui.' }; }
}

function toggleAdminFromWarga(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['super_admin']);
  const actor = session.username;
  const username = String(payload && payload.username || '').trim();
  if (!isSuperAdmin_(actor)) return { success: false, message: 'Hanya SuperAdmin yang dapat mengubah status Admin.' };
  if (!username) return { success: false, message: 'Username warga tidak valid.' };
  if (username.toLowerCase() === actor.toLowerCase() || isReservedSuperAdminUsername_(username)) return { success: false, message: 'SuperAdmin tidak perlu diaktifkan sebagai Admin.' };
  try {
    return withScriptLock_(function () {
      const wargaSheet = getSheet_(SHEET_WARGA);
      const wargaValues = wargaSheet.getDataRange().getValues();
      const wargaHeaders = wargaValues[0] || [];
      const wargaUsernameCol = wargaHeaders.indexOf('Username');
      const wargaPinCol = wargaHeaders.indexOf('PIN');
      const wargaRow = wargaValues.find(function (row, index) { return index > 0 && String(row[wargaUsernameCol] || '').toLowerCase() === username.toLowerCase(); });
      if (!wargaRow) return { success: false, message: 'Warga tidak ditemukan.' };
      const adminSheet = getSheet_(SHEET_ADMINS);
      if (!adminSheet) return { success: false, message: 'Sheet Admins belum tersedia.' };
      const adminValues = adminSheet.getDataRange().getValues();
      const headers = adminValues[0] || [];
      const usernameCol = headers.indexOf('Username');
      let rowIndex = -1;
      for (let i = 1; i < adminValues.length; i++) if (String(adminValues[i][usernameCol] || '').toLowerCase() === username.toLowerCase()) { rowIndex = i + 1; break; }
      if (rowIndex > 0) {
        adminSheet.deleteRow(rowIndex);
        bumpSessionVersion_(username);
        writeAuditLog_('DEACTIVATE_ADMIN', actor, username, 'Dari Kelola Warga');
        return { success: true, isAdmin: false, message: 'Status Admin dinonaktifkan.' };
      }
      const pinCol = headers.indexOf('PIN');
      if (pinCol < 0 || wargaPinCol < 0 || !wargaRow[wargaPinCol]) return { success: false, message: 'PIN warga tidak ditemukan.' };
      const newRow = headers.map(function (header) {
        if (header === 'Username') return username;
        if (header === 'PIN') return wargaRow[wargaPinCol];
        if (header === 'Keterangan') return String(wargaRow[wargaHeaders.indexOf('Nama')] || 'Admin');
        return '';
      });
      adminSheet.appendRow(newRow);
      bumpSessionVersion_(username);
      writeAuditLog_('ACTIVATE_ADMIN', actor, username, 'Dari Kelola Warga');
      return { success: true, isAdmin: true, message: 'Warga diangkat menjadi Admin.' };
    });
  } catch (err) { return { success: false, message: err.message }; }
}

// v18: dibungkus kunci tulis. Fungsi ini mencari nomor baris lalu menulis ke baris itu;
// tanpa kunci, penghapusan baris oleh proses lain di antaranya bisa menggeser target.
function updateWargaByAdmin(payload) {
  try {
    return withScriptLock_(function () { return updateWargaByAdminUnlocked_(payload); });
  } catch (err) {
    writeApplicationError_('updateWargaByAdmin', err, 'sistem');
    return { success: false, message: 'Server sedang sibuk. Coba lagi sebentar.' };
  }
}

function updateWargaByAdminUnlocked_(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  payload.adminUsername = session.username;
  const targetUsername = String(payload && payload.username || '').trim();
  if (!isAdminUsername_(payload.adminUsername)) {
    return { success: false, message: 'Anda tidak memiliki akses.' };
  }
  if (!targetUsername) return { success: false, message: 'Username warga tidak valid.' };
  try {
    const nama = validateString_(payload.nama, 'Nama', 1, 120);
    const statusWisma = validateString_(payload.statusWisma, 'Status di Wisma', 1, 80);
    const lantai = String(payload.lantai || '').trim();
    const unit = String(payload.unit || '').trim();
    const normalizedFloorUnit = validateFloorUnit8O_(statusWisma, lantai, unit);
    const refStatus = getRefData().Status_Wisma || [];
    if (refStatus.length && refStatus.indexOf(statusWisma) < 0) throw new Error('Status di Wisma tidak tersedia pada RefData.');
    const sheet = getSheet_(SHEET_WARGA);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const usernameCol = headers.indexOf('Username');
    const namaCol = headers.indexOf('Nama');
    const statusCol = headers.indexOf('Status_Wisma');
    const lantaiCol = headers.indexOf('Lantai');
    const unitCol = headers.indexOf('Unit');

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][usernameCol]).toLowerCase() === targetUsername.toLowerCase()) {
        assertRowOwner_(sheet, i + 1, usernameCol, targetUsername);
        if (namaCol >= 0) sheet.getRange(i + 1, namaCol + 1).setValue(sheetText_(nama));
        if (statusCol >= 0) sheet.getRange(i + 1, statusCol + 1).setValue(sheetText_(statusWisma));
        if (lantaiCol >= 0) sheet.getRange(i + 1, lantaiCol + 1).setValue(normalizedFloorUnit.floor);
        if (unitCol >= 0) sheet.getRange(i + 1, unitCol + 1).setValue(normalizedFloorUnit.unit);
        writeAuditLog_('UPDATE_WARGA', payload.adminUsername, targetUsername, 'Verifikasi nama/status/lantai/unit');
        return { success: true };
      }
    }
    return { success: false, message: 'User tidak ditemukan.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// v18: dibungkus kunci tulis. Fungsi ini mencari nomor baris lalu menulis ke baris itu;
// tanpa kunci, penghapusan baris oleh proses lain di antaranya bisa menggeser target.
function deleteWarga(payload) {
  try {
    return withScriptLock_(function () { return deleteWargaUnlocked_(payload); });
  } catch (err) {
    writeApplicationError_('deleteWarga', err, 'sistem');
    return { success: false, message: 'Server sedang sibuk. Coba lagi sebentar.' };
  }
}

function deleteWargaUnlocked_(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  payload.adminUsername = session.username;
  if (!isAdminUsername_(payload.adminUsername)) {
    return { success: false, message: 'Anda tidak memiliki akses.' };
  }
  try {
    const sheet = getSheet_(SHEET_WARGA);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const usernameCol = headers.indexOf('Username');
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][usernameCol]).toLowerCase() === payload.username.toLowerCase()) {
        assertRowOwner_(sheet, i + 1, usernameCol, payload.username);
        sheet.deleteRow(i + 1);
        bumpSessionVersion_(payload.username);
        removePushTokensForUser_(payload.username);
        writeAuditLog_('DELETE_WARGA', payload.adminUsername, payload.username, '');
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function resetPin(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  const adminUsername = session.username;
  if (!isAdminUsername_(adminUsername)) return { success: false, message: 'Anda tidak memiliki akses.' };
  const username = String(payload && payload.username || '').trim();
  if (!username) return { success: false, message: 'Username tidak valid.' };
  try {
    const newPin = makeNumericPin_();
    const newHash = makePinHash_(newPin);
    return withScriptLock_(function () {
      const wargaSheet = getSheet_(SHEET_WARGA);
      const wargaValues = wargaSheet.getDataRange().getValues();
      const wargaHeaders = wargaValues[0] || [];
      const wargaUserCol = wargaHeaders.indexOf('Username');
      const wargaPinCol = wargaHeaders.indexOf('PIN');
      let found = false;
      if (wargaUserCol >= 0 && wargaPinCol >= 0) {
        for (let i = 1; i < wargaValues.length; i++) {
          if (String(wargaValues[i][wargaUserCol] || '').toLowerCase() === username.toLowerCase()) {
            wargaSheet.getRange(i + 1, wargaPinCol + 1).setValue(newHash);
            found = true;
            break;
          }
        }
      }
      // A promoted resident has a mirrored PIN row in Admins. Keep both hashes in sync;
      // admin-only accounts can also be reset from the same UI.
      const adminSheet = getSheet_(SHEET_ADMINS);
      if (adminSheet) {
        const adminValues = adminSheet.getDataRange().getValues();
        const adminHeaders = adminValues[0] || [];
        const adminUserCol = adminHeaders.indexOf('Username');
        const adminPinCol = adminHeaders.indexOf('PIN');
        if (adminUserCol >= 0 && adminPinCol >= 0) {
          for (let i = 1; i < adminValues.length; i++) {
            if (String(adminValues[i][adminUserCol] || '').toLowerCase() === username.toLowerCase()) {
              adminSheet.getRange(i + 1, adminPinCol + 1).setValue(newHash);
              found = true;
              break;
            }
          }
        }
      }
      if (!found) return { success: false, message: 'Username tidak ditemukan.' };
      completePendingResetRequests_(username, adminUsername);
      bumpSessionVersion_(username);
      writeAuditLog_('RESET_PIN', adminUsername, username, 'PIN diganti; sesi sebelumnya dicabut');
      invalidateAdminNotificationCaches_();
      return { success: true, pin: newPin, message: 'PIN baru: ' + newPin };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ===================================================================
// HELPER
// ===================================================================
function completePendingResetRequests_(username, processedBy) {
  const sheet = getSheet_(SHEET_RESETREQUESTS);
  if (!sheet) return;
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const usernameCol = headers.indexOf('Username');
  const statusCol = headers.indexOf('Status');
  const processedAtCol = headers.indexOf('ProcessedAt');
  const processedByCol = headers.indexOf('ProcessedBy');
  if (usernameCol < 0 || statusCol < 0) return;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][usernameCol] || '').toLowerCase() === String(username || '').toLowerCase() && String(values[i][statusCol] || '') === 'Menunggu') {
      sheet.getRange(i + 1, statusCol + 1).setValue('Selesai');
      if (processedAtCol >= 0) sheet.getRange(i + 1, processedAtCol + 1).setValue(new Date());
      if (processedByCol >= 0) sheet.getRange(i + 1, processedByCol + 1).setValue(processedBy || '');
    }
  }
}

function getSheet_(sheetName) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}

function getNotificationStateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('NotificationState');
  if (!sheet) {
    sheet = ss.insertSheet('NotificationState');
    sheet.appendRow(['Username', 'Menu', 'LastSeenAt']);
  }
  return sheet;
}
function notificationDate_(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return isNaN(time) ? 0 : time;
}
function getNotificationLastSeen_(username, menu) {
  const sheet = getNotificationStateSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').toLowerCase() === String(username || '').toLowerCase() && String(values[i][1] || '') === menu) return notificationDate_(values[i][2]);
  }
  return null;
}
function setNotificationLastSeen_(username, menu) {
  const sheet = getNotificationStateSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').toLowerCase() === String(username || '').toLowerCase() && String(values[i][1] || '') === menu) {
      sheet.getRange(i + 1, 3).setValue(new Date());
      return;
    }
  }
  sheet.appendRow([username, menu, new Date()]);
}
function countNewNotificationRows_(rows, lastSeen, dateFields) {
  if (lastSeen === null) return 0;
  return rows.filter(function (row) {
    return dateFields.some(function (field) { return notificationDate_(row[field]) > lastSeen; });
  }).length;
}
function notificationSummaryCacheKey_(username) {
  return 'notification-summary:' + String(username || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '_').substring(0, 80);
}
function invalidateNotificationSummaryCache_(username) {
  if (username) CacheService.getScriptCache().remove(notificationSummaryCacheKey_(username));
}
function aspirationStatusOf_(row) {
  const raw = String(row.StatusAspirasi || '');
  if (['Baru', 'Dibaca', 'Diselesaikan', 'Ditolak'].indexOf(raw) >= 0) return raw;
  return String(row.Sudah_Ditindaklanjuti || 'Belum') === 'Sudah' ? 'Diselesaikan' : 'Dibaca';
}

// v18: kosongkan ringkasan notifikasi SEMUA admin (bukan hanya yang mengubah), agar
// tindakan satu admin langsung terlihat di admin lain dan Super Admin.
function invalidateAdminNotificationCaches_() {
  try {
    const cache = CacheService.getScriptCache();
    const keys = ['pending-work-v1:super', 'pending-work-v1:admin'];
    Object.keys(getAdminUsernameSet_()).forEach(function (name) { if (name) keys.push(notificationSummaryCacheKey_(name)); });
    cache.removeAll(keys);
  } catch (err) {
    writeApplicationError_('invalidateAdminNotificationCaches_', err, 'sistem');
  }
}

function getPendingWork(sessionToken) {
  const session = requireSession_(sessionToken, ['admin', 'super_admin']);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pending-work-v1:' + (session.role === 'super_admin' ? 'super' : 'admin');
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignore) { cache.remove(cacheKey); }
  }

  const now = Date.now();
  const limit = 15;
  function ageDays(value) {
    const timestamp = notificationDate_(value);
    return timestamp ? Math.max(0, Math.floor((now - timestamp) / 86400000)) : 0;
  }
  function pack(items) {
    items.sort(function (a, b) { return (b.rank - a.rank) || (b.ageDays - a.ageDays); });
    return {
      total: items.length,
      items: items.slice(0, limit).map(function (item) {
        const safeItem = {};
        Object.keys(item).forEach(function (key) { if (key !== 'rank') safeItem[key] = item[key]; });
        return safeItem;
      })
    };
  }

  try {
    const aspirasi = [];
    const aspirasiSheet = getSheet_(SHEET_DATA);
    (aspirasiSheet ? getSheetData_(SHEET_DATA) : []).forEach(function (row) {
      if (!row.ID) return;
      const rawStatus = String(row.StatusAspirasi || '');
      const status = ['Baru', 'Dibaca', 'Diselesaikan', 'Ditolak'].indexOf(rawStatus) >= 0
        ? rawStatus
        : (String(row.Sudah_Ditindaklanjuti || 'Belum') === 'Sudah' ? 'Diselesaikan' : 'Dibaca');
      if (status !== 'Baru' && status !== 'Dibaca') return;
      const priority = String(row.Prioritas || '');
      aspirasi.push({
        id: String(row.ID), jenis: String(row.Jenis_Aspirasi || ''), kategori: String(row.Kategori || ''),
        status: status, prioritas: priority, ageDays: ageDays(row.Timestamp),
        rank: priority === 'Sangat Tinggi' || priority === 'Tinggi' ? 1 : 0
      });
    });

    const resetPin = [];
    const resetSheet = getSheet_(SHEET_RESETREQUESTS);
    if (resetSheet) {
      const wargaNames = {};
      const wargaSheet = getSheet_(SHEET_WARGA);
      (wargaSheet ? getSheetData_(SHEET_WARGA) : []).forEach(function (row) {
        const username = String(row.Username || '').toLowerCase();
        if (username) wargaNames[username] = String(row.Nama || '');
      });
      getSheetData_(SHEET_RESETREQUESTS).forEach(function (row) {
        if (String(row.Status || '') !== 'Menunggu') return;
        const username = String(row.Username || '').trim();
        if (!username) return;
        resetPin.push({ username: username, nama: wargaNames[username.toLowerCase()] || '', ageDays: ageDays(row.Timestamp), rank: 0 });
      });
    }

    const feedback = [];
    if (session.role === 'super_admin') {
      const feedbackSheet = getSheet_(SHEET_APPFEEDBACK);
      if (feedbackSheet) getSheetData_(SHEET_APPFEEDBACK).forEach(function (row) {
        if (!row.Masukan || String(row.Status || 'Baru') !== 'Baru') return;
        feedback.push({ username: String(row.Username || ''), kategori: String(row.Kategori || ''), ageDays: ageDays(row.Timestamp), rank: 0 });
      });
    }

    const agendaUsulan = [];
    if (getSheet_(SHEET_AGENDA_PROPOSALS)) getSheetData_(SHEET_AGENDA_PROPOSALS).forEach(function (row) {
      if (!row.ID || String(row.Status || '') !== 'Menunggu Verifikasi') return;
      agendaUsulan.push({ id: String(row.ID), judul: String(row.Judul || ''), tanggal: agendaDateKey_(row.Tanggal), ageDays: ageDays(row.Timestamp), rank: 0 });
    });
    const result = { aspirasi: pack(aspirasi), resetPin: pack(resetPin), feedback: pack(feedback), agendaUsulan: pack(agendaUsulan) };
    cache.put(cacheKey, JSON.stringify(result), 30);
    return result;
  } catch (err) {
    writeApplicationError_('getPendingWork', err, session.username);
    return { error: true, aspirasi: { total: 0, items: [] }, resetPin: { total: 0, items: [] }, feedback: { total: 0, items: [] } };
  }
}
function getNotificationSummary(sessionToken) {
  let actor = '';
  try {
    const session = requireSession_(sessionToken, ['admin', 'super_admin']);
    actor = session.username;
    const username = session.username;
    const cached = CacheService.getScriptCache().get(notificationSummaryCacheKey_(username));
    if (cached) {
      try { return JSON.parse(cached); } catch (ignore) { invalidateNotificationSummaryCache_(username); }
    }
    const now = new Date().getTime();
    const result = { aspirasi: 0, kepuasan: 0, warga: 0, admin: 0, nomorPenting: 0, nomorDarurat: 0, resetPin: 0, anomaliWarga: 0, agendaUsulan: 0 };
    result.anomaliWarga = getWargaFloorUnitAnomalies_().length;
  const aspirasiSheet = getSheet_(SHEET_DATA);
  if (aspirasiSheet) {
    const aspirasiRows = getSheetData_(SHEET_DATA);
    result.aspirasiTotal = aspirasiRows.length;
    result.aspirasiSudahSelesai = aspirasiRows.filter(function (row) { return String(row.Sudah_Ditindaklanjuti || 'Belum') === 'Sudah'; }).length;
    result.aspirasiBelumSelesai = aspirasiRows.filter(function (row) {
      return String(row.Sudah_Ditindaklanjuti || 'Belum') !== 'Sudah';
    }).length;
    result.aspirasiPrioritasTinggi = aspirasiRows.filter(function (row) {
      if (String(row.Sudah_Ditindaklanjuti || 'Belum') === 'Sudah') return false;
      if (String(row.Prioritas || '') === 'Tinggi') return true;
      const created = notificationDate_(row.Timestamp);
      return created > 0 && (now - created) >= 7 * 86400000;
    }).length;
  }
  // v18 (A4): bulatan Aspirasi = aspirasi BARU (masuk setelah admin ini terakhir membuka
  // halaman Aspirasi) yang statusnya masih Baru. Begitu admin mana pun menindaklanjuti,
  // statusnya berubah dan bulatan hilang untuk semua admin. Perubahan tindak lanjut
  // tidak lagi dihitung sebagai "baru".
  if (aspirasiSheet) {
    const aspirasiLastSeen = getNotificationLastSeen_(username, 'aspirasi');
    if (aspirasiLastSeen === null) setNotificationLastSeen_(username, 'aspirasi');
    else result.aspirasi = getSheetData_(SHEET_DATA).filter(function (row) {
      return aspirationStatusOf_(row) === 'Baru' && notificationDate_(row.Timestamp) > aspirasiLastSeen;
    }).length;
  }
  // v19: usulan agenda menunggu, dengan aturan yang sama seperti aspirasi (A4).
  if (getSheet_(SHEET_AGENDA_PROPOSALS)) {
    // Belum pernah membuka Kelola Agenda: semua usulan yang masih menunggu dihitung.
    const agendaLastSeen = getNotificationLastSeen_(username, 'agendaUsulan') || 0;
    result.agendaUsulan = getSheetData_(SHEET_AGENDA_PROPOSALS).filter(function (row) {
      return String(row.Status || '') === 'Menunggu Verifikasi' && notificationDate_(row.Timestamp) > agendaLastSeen;
    }).length;
  }
  const sources = [
    ['kepuasan', SHEET_KEPUASAN, ['Timestamp']],
    ['warga', SHEET_WARGA, ['CreatedAt', 'ProfileUpdatedAt']],
    ['admin', SHEET_ADMINS, ['CreatedAt', 'UpdatedAt']],
    ['nomorPenting', SHEET_NOMORPENTING, ['CreatedAt', 'UpdatedAt']],
    ['nomorDarurat', SHEET_NOMORDARURAT, ['CreatedAt', 'UpdatedAt']]
  ];
  sources.forEach(function (source) {
    const menu = source[0];
    const sheet = getSheet_(source[1]);
    if (!sheet) return;
    const lastSeen = getNotificationLastSeen_(username, menu);
    if (lastSeen === null) { setNotificationLastSeen_(username, menu); return; }
    result[menu] = countNewNotificationRows_(getSheetData_(source[1]), lastSeen, source[2]);
  });
  const resetSheet = getSheet_(SHEET_RESETREQUESTS);
  if (resetSheet) {
    const resetLastSeen = getNotificationLastSeen_(username, 'resetPin');
    if (resetLastSeen === null) {
      setNotificationLastSeen_(username, 'resetPin');
    } else {
      result.resetPin = getSheetData_(SHEET_RESETREQUESTS).filter(function (row) {
        return String(row.Status || '') === 'Menunggu' && notificationDate_(row.Timestamp) > resetLastSeen;
      }).length;
    }
  }
    try { const cap = getSpreadsheetCapacityCached_(); result.kapasitas = { level: cap.level, percent: cap.percent, usedCells: cap.usedCells, limitCells: cap.limitCells, largest: cap.largest }; } catch (ignore) {}
    result.generatedAt = now;
    CacheService.getScriptCache().put(notificationSummaryCacheKey_(username), JSON.stringify(result), 30);
    return result;
  } catch (err) {
    writeApplicationError_('getNotificationSummary', err, actor);
    throw err;
  }
}
function markNotificationSeen(sessionToken, menu) {
  const session = requireSession_(sessionToken, ['admin', 'super_admin']);
  const allowed = ['aspirasi', 'kepuasan', 'warga', 'admin', 'nomorPenting', 'nomorDarurat', 'resetPin', 'residentAspirasi', 'agendaUsulan'];
  if (allowed.indexOf(String(menu || '')) < 0) return { success: false, message: 'Menu notifikasi tidak valid.' };
  setNotificationLastSeen_(session.username, String(menu));
  invalidateNotificationSummaryCache_(session.username);
  return { success: true };
}
function markAllNotificationsSeen(sessionToken) {
  const session = requireSession_(sessionToken, ['admin', 'super_admin']);
  ['aspirasi', 'kepuasan', 'warga', 'admin', 'nomorPenting', 'nomorDarurat', 'resetPin', 'agendaUsulan'].forEach(function (menu) {
    setNotificationLastSeen_(session.username, menu);
  });
  invalidateNotificationSummaryCache_(session.username);
  return { success: true };
}
function getResidentNotificationSummary(sessionToken) {
  const session = requireSession_(sessionToken, ['resident']);
  const username = session.username;
  const lastSeen = getNotificationLastSeen_(username, 'residentAspirasi');
  if (lastSeen === null) {
    setNotificationLastSeen_(username, 'residentAspirasi');
    return { updates: 0 };
  }
  const rows = getSheetData_(SHEET_DATA).filter(function (row) {
    const owner = String(row.Email_Pengisi || row.Username || row.Username_Pengisi || '').toLowerCase();
    return owner === String(username || '').toLowerCase();
  });
  const aspirationUpdates = rows.filter(function (row) {
    return Math.max(notificationDate_(row.LastUpdatedAt), notificationDate_(row.UpdatedAt), notificationDate_(row.Tanggal_Tindak_Lanjut)) > lastSeen;
  }).length;
  let feedbackUpdates = 0;
  const feedbackSheet = getSheet_(SHEET_APPFEEDBACK);
  if (feedbackSheet) {
    feedbackUpdates = getSheetData_(SHEET_APPFEEDBACK).filter(function (row) {
      return String(row.Username || '').toLowerCase() === String(username || '').toLowerCase() &&
        notificationDate_(row.UpdatedAt || row.Timestamp) > lastSeen;
    }).length;
  }
  return { updates: aspirationUpdates + feedbackUpdates, aspirationUpdates: aspirationUpdates, feedbackUpdates: feedbackUpdates };
}
function getMyAppFeedback(sessionToken) {
  const session = requireSession_(sessionToken, ['resident']);
  getAppFeedbackSheet_();
  const rows = getSheetData_(SHEET_APPFEEDBACK);
  return rows.filter(function (row) {
    return String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase();
  }).map(function (row) {
    return {
      timestamp: formatTanggal_(row.Timestamp),
      kategori: String(row.Kategori || ''),
      masukan: String(row.Masukan || ''),
      status: String(row.Status || 'Baru'),
      catatanAdmin: String(row['Catatan Admin'] || ''),
      updatedAt: formatTanggal_(row.UpdatedAt || row.Timestamp)
    };
  }).reverse();
}
function markResidentNotificationSeen(sessionToken) {
  const session = requireSession_(sessionToken, ['resident']);
  setNotificationLastSeen_(session.username, 'residentAspirasi');
  return { success: true };
}

function getSheetData_(sheetName) {
  const sheet = getSheet_(sheetName);

  if (!sheet) {
    throw new Error('Sheet "' + sheetName + '" tidak ditemukan. Pastikan sudah dibuat di Google Sheets dengan nama persis sama.');
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1);
  return rows
    .filter(function (row) { return row.some(function (cell) { return cell !== ''; }); })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (header, i) { obj[header] = row[i]; });
      return obj;
    });
}
// (v19: definisi ganda ensureSheetColumn_ dihapus; yang berlaku ada di bawah.)
function ensureAspirasiBookColumns_() {
  return withScriptLock_(function () {
    const sheet = getSheet_(SHEET_DATA);
    if (!sheet) throw new Error('Sheet Data Aspirasi tidak ditemukan.');
    ensureSheetColumn_(sheet, 'Lokasi_Masalah');
    ensureSheetColumn_(sheet, 'Lokasi_Masalah_Detail');
    PAPAN_COLUMNS.forEach(function (header) { ensureSheetColumn_(sheet, header); });
    return true;
  });
}

function isAdminUsername_(username) {
  if (!username) return false;
  if (username.toLowerCase() === String(getSuperAdminConfig_().username).toLowerCase()) return true;
  return getAdminUsernamesCached_().indexOf(username.toLowerCase()) >= 0;
}

// -------------------------------------------------------------------
// v18 (A7) — CACHE SHEET KECIL (60 detik)
// Admins (hanya daftar username), SystemConfig, RefData, dan AppInfo dibaca di
// hampir setiap permintaan. Cache dikosongkan otomatis saat aplikasi mengubahnya
// (bumpSessionVersion_ untuk perubahan admin, upsertSystemConfigValue_ untuk config).
// Perubahan yang diketik langsung di Google Sheets berlaku paling lambat 60 detik.
// -------------------------------------------------------------------
const SMALL_SHEET_CACHE_SECONDS = 60;
const SMALL_SHEET_CACHE_PREFIX = 'sheetcache:v1:';

function getCachedJson_(key, producer) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(SMALL_SHEET_CACHE_PREFIX + key);
  if (raw) { try { return JSON.parse(raw); } catch (ignore) {} }
  const value = producer();
  try {
    const json = JSON.stringify(value);
    if (json.length < 90000) cache.put(SMALL_SHEET_CACHE_PREFIX + key, json, SMALL_SHEET_CACHE_SECONDS);
  } catch (ignore) {}
  return value;
}

function invalidateSmallSheetCache_(keys) {
  try { CacheService.getScriptCache().removeAll((keys || ['admins', 'systemConfig', 'refData', 'appInfo']).map(function (k) { return SMALL_SHEET_CACHE_PREFIX + k; })); } catch (ignore) {}
}

function getAdminUsernamesCached_() {
  return getCachedJson_('admins', function () {
    if (!getSheet_(SHEET_ADMINS)) return [];
    return getSheetData_(SHEET_ADMINS).map(function (row) { return String(row.Username || '').trim().toLowerCase(); }).filter(Boolean);
  });
}

function isSuperAdmin_(username) {
  return !!username && username.toLowerCase() === String(getSuperAdminConfig_().username).toLowerCase();
}

function getAppInfoData_() {
  return getCachedJson_('appInfo', function () { return getSheetData_(SHEET_APPINFO)[0] || {}; });
}

function getSystemConfig_() {
  try {
    // Salinan baru setiap panggilan: pemanggil boleh menambah kunci (mis. ApkVersiTerbaru).
    return Object.assign({}, getCachedJson_('systemConfig', function () {
      const config = {};
      getSheetData_(SHEET_SYSTEMCONFIG).forEach(function (row) { config[row.KEY] = row.VALUE; });
      return config;
    }));
  } catch (e) { return {}; }
}

// ===================================================================
// REF DATA
// ===================================================================
function getRefData() {
  const data = getCachedJson_('refData', function () { return getSheetData_(SHEET_REFDATA); });
  const columns = ['Status_Wisma', 'Lantai', 'Unit', 'Jenis_Aspirasi', 'Kategori', 'Status_Tindak_Lanjut'];
  const result = {};
  columns.forEach(function (col) {
    const values = data
      .map(function (row) { return row[col]; })
      .filter(function (v) { return v !== '' && v !== undefined && v !== null; });
    result[col] = values;
  });
  result.LokasiMasalah = ASPIRATION_LOCATION_TYPES.slice();
  result.Lantai = floorOptions8O_();
  result.Unit = unitSuffixOptions8O_();
  return result;
}

function migrateFloorUnit8O_() {
  return withScriptLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const report = { success: true, backups: [], migrated: 0, alreadyValid: 0, anomalies: [] };
    [SHEET_WARGA, SHEET_DATA].forEach(function (sheetName) {
      const sheet = getSheet_(sheetName);
      if (!sheet || sheet.getLastRow() < 2) return;
      const backup = sheet.copyTo(ss);
      const backupName = sheetName + '_Backup_8O_' + stamp;
      backup.setName(backupName.substring(0, 99));
      report.backups.push(backup.getName());
      const range = sheet.getDataRange();
      const values = range.getValues();
      const headers = values[0] || [];
      const usernameCol = headers.indexOf('Username');
      const namaCol = headers.indexOf('Nama');
      const statusCol = headers.indexOf('Status_Wisma');
      const lantaiCol = headers.indexOf('Lantai');
      const unitCol = headers.indexOf('Unit');
      if (lantaiCol < 0 || unitCol < 0) return;
      for (let i = 1; i < values.length; i++) {
        const username = usernameCol >= 0 ? String(values[i][usernameCol] || '') : '';
        const nama = namaCol >= 0 ? String(values[i][namaCol] || '') : '';
        const status = statusCol >= 0 ? String(values[i][statusCol] || '') : '';
        const normalized = normalizeFloorUnit8O_(values[i][lantaiCol], values[i][unitCol], status);
        if (!normalized.ok) {
          report.anomalies.push({ sheet: sheetName, row: i + 1, username: username, nama: nama, reason: normalized.reason });
          continue;
        }
        const oldFloor = String(values[i][lantaiCol] == null ? '' : values[i][lantaiCol]).trim();
        const oldUnit = String(values[i][unitCol] == null ? '' : values[i][unitCol]).trim();
        if (oldFloor === normalized.floor && oldUnit === normalized.unit) report.alreadyValid++;
        else {
          sheet.getRange(i + 1, lantaiCol + 1).setValue(normalized.floor);
          sheet.getRange(i + 1, unitCol + 1).setValue(normalized.unit);
          report.migrated++;
        }
      }
    });
    const log = ss.getSheetByName('FloorUnitMigrationLog') || ss.insertSheet('FloorUnitMigrationLog');
    if (log.getLastRow() < 1) log.appendRow(['Timestamp', 'Sheet', 'Row', 'Username', 'Nama', 'Reason']);
    report.anomalies.forEach(function (item) { log.appendRow([new Date(), item.sheet, item.row, item.username, item.nama, item.reason]); });
    writeAuditLog_('MIGRATE_FLOOR_UNIT_8O', 'SYSTEM', 'WargaBaru/Data Aspirasi', 'migrated=' + report.migrated + ', anomalies=' + report.anomalies.length);
    report.message = 'Migrasi selesai. Data anomali tidak diubah dan perlu diverifikasi Admin.';
    return report;
  });
}

// ===================================================================
// FORM ASPIRASI
// ===================================================================
function migrateAspirasiStatus8L_() {
  return withScriptLock_(function () {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheet_(SHEET_DATA);
  if (!sheet) throw new Error('Sheet Data Aspirasi tidak ditemukan.');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const backup = sheet.copyTo(ss);
  backup.setName('Data Aspirasi_Backup_8L_' + stamp);
  const required = ['StatusAspirasi', 'DibacaAdmin', 'StatusUpdatedAt', 'StatusUpdatedBy', 'CatatanPenolakan', 'Prioritas', 'Lokasi_Masalah', 'Lokasi_Masalah_Detail'];
  required.forEach(function (h) { ensureSheetColumn_(sheet, h); });
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = {}; headers.forEach(function (h, i) { col[h] = i; });
  let migrated = 0;
  for (let i = 1; i < values.length; i++) {
    if (!values[i].some(function (v) { return v !== ''; })) continue;
    const oldStatus = String(values[i][col.Sudah_Ditindaklanjuti] || 'Belum');
    const current = String(values[i][col.StatusAspirasi] || '');
    if (!current) sheet.getRange(i + 1, col.StatusAspirasi + 1).setValue(oldStatus === 'Sudah' ? 'Diselesaikan' : 'Dibaca');
    if (!String(values[i][col.DibacaAdmin] || '')) sheet.getRange(i + 1, col.DibacaAdmin + 1).setValue('Sudah Dibaca');
    if (!String(values[i][col.Prioritas] || '') && String(values[i][col.Jenis_Aspirasi] || '') === 'Pengaduan') sheet.getRange(i + 1, col.Prioritas + 1).setValue('Rendah');
    migrated++;
  }
  return { success: true, backupSheet: backup.getName(), migrated: migrated, message: 'Migrasi Tahap 8L selesai. Backup dibuat.' };  });
}

function submitAspirasi(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident']);
  payload = payload || {};
  const username = session.username;
  try {
    const profile = getSheetData_(SHEET_WARGA).find(function (row) {
      return String(row.Username || '').toLowerCase() === String(username || '').toLowerCase();
    });
    if (!profile || !(profile.ProfileComplete === true || String(profile.ProfileComplete || '').toLowerCase() === 'true')) {
      throw new Error('Profil warga belum lengkap. Lengkapi profil sebelum mengirim aspirasi.');
    }
    const nama = validateString_(profile.Nama, 'Nama profil', 1, 120);
    const statusWisma = validateString_(profile.Status_Wisma, 'Status di Wisma', 1, 80);
    const normalizedFloorUnit = validateFloorUnit8O_(statusWisma, profile.Lantai, profile.Unit);
    const nomorWhatsApp = normalizeWhatsAppNumber_(profile.Nomor_WhatsApp);
    if (!nomorWhatsApp) throw new Error('Nomor WhatsApp pada profil tidak valid. Gunakan 08…, 8…, 62… atau +62…, lalu perbarui Profil Saya.');

    const jenis = validateString_(payload.jenisAspirasi, 'Jenis aspirasi', 1, 30);
    if (['Masukan', 'Kritik', 'Pengaduan'].indexOf(jenis) < 0) throw new Error('Jenis aspirasi tidak valid.');
    const kategori = validateString_(payload.kategori, 'Kategori', 1, 120);
    const categories = getRefData().Kategori || [];
    if (categories.length && categories.indexOf(kategori) < 0) throw new Error('Kategori tidak tersedia pada RefData.');
    const detail = validateString_(payload.detailAspirasi, 'Detail aspirasi', 10, 5000);
    const issueLocation = String(payload.lokasiMasalah || '').trim();
    const issueLocationDetail = String(payload.lokasiMasalahDetail || '').trim();
    if (issueLocation && ASPIRATION_LOCATION_TYPES.indexOf(issueLocation) < 0) throw new Error('Jenis lokasi masalah tidak valid.');
    if (issueLocationDetail.length > 160) throw new Error('Rincian lokasi masalah maksimal 160 karakter.');
    if (issueLocationDetail && !issueLocation) throw new Error('Pilih jenis lokasi masalah terlebih dahulu.');
    if (jenis === 'Pengaduan' && !issueLocation) throw new Error('Pilih jenis lokasi masalah atau pilih Tidak diketahui.');
    const priority = String(payload.prioritas || '').trim();
    if (jenis === 'Pengaduan' && ASPIRATION_PRIORITIES_8L.indexOf(priority) < 0) throw new Error('Prioritas wajib dipilih untuk Pengaduan.');
    if (jenis !== 'Pengaduan' && priority) throw new Error('Prioritas hanya berlaku untuk Pengaduan.');
    const kesediaan = String(payload.kesediaanSwadaya || '').trim();
    if (['Ya', 'Tidak'].indexOf(kesediaan) < 0) throw new Error('Kesediaan swadaya tidak valid.');
    validateFilePayload_(payload.bukti, false);

    ensureAspirasiBookColumns_();

    return withScriptLock_(function () {
      const sheet = getSheet_(SHEET_DATA);
      // v18 (A11): ID selalu teks. ID heksadesimal seperti "12e45678" atau "00012345"
      // bisa diubah Sheets menjadi angka sehingga pencarian ID gagal ("Data tidak ditemukan").
      const id = 'A' + Utilities.getUuid().replace(/-/g, '').substring(0, 9).toUpperCase();
      const timestamp = new Date();
      let buktiLink = '';
      if (payload.bukti) buktiLink = uploadBuktiToDrive_(payload.bukti, id);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      const rowValues = {
        ID: id, Timestamp: timestamp, Username: sheetText_(username), Email_Pengisi: sheetText_(username),
        Nama: sheetText_(nama), Status_Wisma: sheetText_(statusWisma),
        Lantai: normalizedFloorUnit.floor, Unit: normalizedFloorUnit.unit,
        Nomor_WhatsApp: sheetText_(nomorWhatsApp), Jenis_Aspirasi: sheetText_(jenis),
        Kategori: sheetText_(kategori), Detail_Aspirasi: sheetText_(detail), Bukti_Pengaduan: buktiLink,
        Lokasi_Masalah: sheetText_(issueLocation), Lokasi_Masalah_Detail: sheetText_(issueLocationDetail),
        Kesediaan_Swadaya: sheetText_(kesediaan), Sudah_Ditindaklanjuti: 'Belum',
        StatusAspirasi: 'Baru', DibacaAdmin: 'Belum Dibaca', StatusUpdatedAt: timestamp,
        StatusUpdatedBy: '', CatatanPenolakan: '', Prioritas: priority
      };
      sheet.appendRow(headers.map(function (header) { return Object.prototype.hasOwnProperty.call(rowValues, header) ? rowValues[header] : ''; }));
      writeAuditLog_('SUBMIT_ASPIRASI', username, id, kategori);
      // v12: notifikasi ke admin. Isi dibuat umum (tanpa nama warga) karena tampil di layar kunci.
      queuePush_({ admins: true }, { title: 'Aspirasi baru masuk', body: 'Kategori: ' + kategori + '. Ketuk untuk menindaklanjuti.', page: 'admin', tag: 'aspirasi-' + id });
      invalidateAdminNotificationCaches_();
      return { success: true, id: id };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}
function uploadBuktiToDrive_(bukti, id) {
  return uploadFileToDrive_(bukti, id, 'Teras Tower 2 - Bukti Pengaduan');
}

function getManagedDriveFolder_(folderName) {
  const propertyKey = DRIVE_FOLDER_PROPERTY_BY_NAME[folderName];
  const props = PropertiesService.getScriptProperties();
  const storedId = propertyKey ? props.getProperty(propertyKey) : '';
  if (storedId) {
    try { return DriveApp.getFolderById(storedId); } catch (err) { props.deleteProperty(propertyKey); }
  }
  const existing = DriveApp.getFoldersByName(folderName);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(folderName);
  if (propertyKey) props.setProperty(propertyKey, folder.getId());
  return folder;
}

function uploadFileToDrive_(fileObj, id, folderName) {
  const folder = getManagedDriveFolder_(folderName);
  const decoded = Utilities.base64Decode(fileObj.base64);
  const blob = Utilities.newBlob(decoded, fileObj.mimeType, id + '_' + fileObj.fileName);
  const file = folder.createFile(blob);
  return file.getUrl();
}

// ===================================================================
// RIWAYAT
// ===================================================================
function getRiwayatSaya(username, sessionToken) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  username = session.username;
  const data = getSheetData_(SHEET_DATA);
  return data
    .filter(function (row) {
      // Backward-compatible lookup: older sheets use Email_Pengisi while
      // newer versions may use Username for the same logical owner field.
      const owner = String(row.Email_Pengisi || row.Username || row.Username_Pengisi || '').toLowerCase();
      return owner === String(username || '').toLowerCase();
    })
    .sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); })
    .map(function (row) {
      return {
        id: row.ID,
        timestamp: formatTanggal_(row.Timestamp),
        jenisAspirasi: row.Jenis_Aspirasi,
        kategori: row.Kategori,
        detailAspirasi: row.Detail_Aspirasi,
        lokasiMasalah: String(row.Lokasi_Masalah || ''),
        lokasiMasalahDetail: String(row.Lokasi_Masalah_Detail || ''),
        kesediaanSwadaya: row.Kesediaan_Swadaya || '',
        sudahDitindaklanjuti: row.Sudah_Ditindaklanjuti || 'Belum',
        statusAspirasi: ['Baru', 'Dibaca', 'Diselesaikan', 'Ditolak'].indexOf(String(row.StatusAspirasi || '')) >= 0 ? String(row.StatusAspirasi) : (String(row.Sudah_Ditindaklanjuti || 'Belum') === 'Sudah' ? 'Diselesaikan' : 'Dibaca'),
        tampilDiPapan: String(row.Publik || '') === 'Ya',
        prioritas: row.Prioritas || '',
        catatanPenolakan: row.CatatanPenolakan || '',
        catatanTindakLanjut: row.Catatan_Tindak_Lanjut || '',
        tanggalTindakLanjut: row.Tanggal_Tindak_Lanjut ? formatTanggal_(row.Tanggal_Tindak_Lanjut) : '',
        fotoTindakLanjut: !!String(row.Foto_Tindak_Lanjut || '').trim(),
        lastUpdatedAt: row.LastUpdatedAt ? formatTanggal_(row.LastUpdatedAt) : '',
        lastUpdatedBy: row.LastUpdatedBy || '',
        lastUpdateType: row.LastUpdateType || ''
      };
    });
}

function getFollowupPhoto(sessionToken, aspirationId) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const targetId = String(aspirationId || '').trim();
  if (!targetId) throw new Error('ID aspirasi tidak valid.');
  const rows = getSheetData_(SHEET_DATA);
  const row = rows.find(function (item) { return String(item.ID || '').trim() === targetId; });
  if (!row) throw new Error('Aspirasi tidak ditemukan.');
  const owner = String(row.Email_Pengisi || row.Username || row.Username_Pengisi || '').toLowerCase();
  if (session.role === 'resident' && owner !== String(session.username || '').toLowerCase()) {
    throw new Error('Anda tidak memiliki akses ke foto ini.');
  }
  const storedUrl = String(row.Foto_Tindak_Lanjut || '').trim();
  const fileIdMatch = storedUrl.match(/[-\w]{25,}/);
  if (!fileIdMatch) throw new Error('Foto tindak lanjut tidak tersedia.');
  const file = DriveApp.getFileById(fileIdMatch[0]);
  const blob = file.getBlob();
  const mime = String(blob.getContentType() || '').toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) throw new Error('Tipe foto tidak didukung.');
  const bytes = blob.getBytes();
  if (bytes.length > 6 * 1024 * 1024) throw new Error('Foto terlalu besar untuk ditampilkan.');
  return { success: true, mimeType: mime, base64: Utilities.base64Encode(bytes) };
}

function formatTanggal_(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return String(dateValue);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'd MMMM yyyy');
}
function formatTanggalISO_(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  return isNaN(date.getTime()) ? '' : Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

// ===================================================================
// DASHBOARD ADMIN
// ===================================================================
function getSemuaAspirasi(requesterUsername, sessionToken) {
  requireSession_(sessionToken, ['admin', 'super_admin']);
  const requester = requireSession_(sessionToken, ['admin', 'super_admin']);
  requesterUsername = requester.username;
  if (!isAdminUsername_(requesterUsername)) {
    return { authorized: false, data: [] };
  }
  ensureAspirasiBookColumns_();
  const data = getSheetData_(SHEET_DATA);
  const mapped = data.map(function (row) {
    return {
      id: row.ID,
      timestamp: formatTanggal_(row.Timestamp),
      nama: row.Nama,
      statusWisma: row.Status_Wisma,
      lantai: row.Lantai,
      unit: row.Unit,
      nomorWhatsApp: row.Nomor_WhatsApp,
      jenisAspirasi: row.Jenis_Aspirasi,
      kategori: row.Kategori,
      detailAspirasi: row.Detail_Aspirasi,
      lokasiMasalah: String(row.Lokasi_Masalah || ''),
      lokasiMasalahDetail: String(row.Lokasi_Masalah_Detail || ''),
      buktiPengaduan: row.Bukti_Pengaduan || '',
      kesediaanSwadaya: row.Kesediaan_Swadaya || '',
      sudahDitindaklanjuti: row.Sudah_Ditindaklanjuti || 'Belum',
      catatanTindakLanjut: row.Catatan_Tindak_Lanjut || '',
      fotoTindakLanjut: !!String(row.Foto_Tindak_Lanjut || '').trim(),
      adminPenangan: row.Admin_Penangan || row.Admin_Tindak_Lanjut || '',
      statusAspirasi: ['Baru', 'Dibaca', 'Diselesaikan', 'Ditolak'].indexOf(String(row.StatusAspirasi || '')) >= 0 ? String(row.StatusAspirasi) : (String(row.Sudah_Ditindaklanjuti || 'Belum') === 'Sudah' ? 'Diselesaikan' : 'Dibaca'),
      catatanPenolakan: row.CatatanPenolakan || '',
      lastUpdatedAt: row.LastUpdatedAt ? formatTanggal_(row.LastUpdatedAt) : '',
      lastUpdatedBy: row.LastUpdatedBy || '',
      lastUpdateType: row.LastUpdateType || '',
      publik: String(row.Publik || '') === 'Ya',
      judulPublik: String(row.JudulPublik || ''),
      lokasiPublik: String(row.LokasiPublik || ''),
      catatanPublik: String(row.CatatanPublik || ''),
      tanggalISO: formatTanggalISO_(row.Timestamp),
      prioritas: row.Prioritas || ''
    };
  });
  const now = new Date();
  mapped.forEach(function (item) {
    if (!item.prioritas) {
      const created = item.tanggalISO ? new Date(item.tanggalISO) : null;
      const ageDays = created && !isNaN(created.getTime()) ? Math.floor((now - created) / 86400000) : 0;
      item.prioritas = item.jenisAspirasi === 'Pengaduan' ? 'Rendah' : (item.sudahDitindaklanjuti !== 'Sudah' && ageDays >= 7 ? 'Tinggi' : 'Normal');
    }
  });
  mapped.sort(function (a, b) {
    if (a.sudahDitindaklanjuti !== b.sudahDitindaklanjuti) {
      return a.sudahDitindaklanjuti === 'Sudah' ? 1 : -1;
    }
    return 0;
  });
  const summary = { total: mapped.length, baru: 0, dibaca: 0, diselesaikan: 0, ditolak: 0, belum: 0, sudah: 0, prioritasTinggi: 0, kategori: {} };
  mapped.forEach(function (item) {
    summary[item.statusAspirasi === 'Diselesaikan' ? 'diselesaikan' : item.statusAspirasi === 'Ditolak' ? 'ditolak' : item.statusAspirasi === 'Baru' ? 'baru' : 'dibaca']++;
    if (item.sudahDitindaklanjuti === 'Sudah') summary.sudah++; else summary.belum++;
    if (item.prioritas === 'Sangat Tinggi' || item.prioritas === 'Tinggi') summary.prioritasTinggi++;
    const key = item.kategori || 'Tanpa kategori';
    summary.kategori[key] = (summary.kategori[key] || 0) + 1;
  });
  return { authorized: true, data: mapped, summary: summary };
}

function updateTindakLanjut(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  payload.username = session.username;
  payload.adminUsername = session.username;
  if (!isAdminUsername_(payload.adminUsername)) {
    return { success: false, message: 'Anda tidak memiliki akses admin.' };
  }
  const targetId = String(payload && payload.id != null ? payload.id : '').trim();
  if (!targetId) return { success: false, message: 'ID data tidak valid.' };
  // v18: withScriptLock_ (bukan kunci manual) agar notifikasi push dikirim SETELAH kunci dilepas.
  try {
    return withScriptLock_(function () {
      const sheet = getSheet_(SHEET_DATA);
      const values = sheet.getDataRange().getValues();
      let headers = values[0];
      const idCol = headers.indexOf('ID');
      const statusCol = headers.indexOf('Sudah_Ditindaklanjuti');
      const status8Col = ensureSheetColumn_(sheet, 'StatusAspirasi');
      const readCol = ensureSheetColumn_(sheet, 'DibacaAdmin');
      const statusUpdatedCol = ensureSheetColumn_(sheet, 'StatusUpdatedAt');
      const statusUpdatedByCol = ensureSheetColumn_(sheet, 'StatusUpdatedBy');
      const rejectionCol = ensureSheetColumn_(sheet, 'CatatanPenolakan');
      const catatanColNumber = ensureSheetColumn_(sheet, 'Catatan_Tindak_Lanjut');
      const tanggalColNumber = ensureSheetColumn_(sheet, 'Tanggal_Tindak_Lanjut');
      const fotoTlColNumber = ensureSheetColumn_(sheet, 'Foto_Tindak_Lanjut');
      const adminColNumber = headers.indexOf('Admin_Penangan') >= 0
        ? headers.indexOf('Admin_Penangan') + 1
        : headers.indexOf('Admin_Tindak_Lanjut') >= 0
          ? headers.indexOf('Admin_Tindak_Lanjut') + 1
          : ensureSheetColumn_(sheet, 'Admin_Penangan');
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const lastUpdatedCol = ensureSheetColumn_(sheet, 'LastUpdatedAt');
      const lastUpdatedByCol = ensureSheetColumn_(sheet, 'LastUpdatedBy');
      const lastUpdateTypeCol = ensureSheetColumn_(sheet, 'LastUpdateType');

      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idCol] == null ? '' : values[i][idCol]).trim() === targetId) {
          const previousStatus = String(values[i][statusCol] || 'Belum');
          const nextStatus = String(payload.status || 'Dibaca');
          if (['Diselesaikan', 'Ditolak', 'Dibaca'].indexOf(nextStatus) < 0) return { success: false, message: 'Status tindak lanjut tidak valid.' };
          if (nextStatus === 'Ditolak' && !String(payload.catatan || '').trim()) return { success: false, message: 'Catatan wajib diisi jika aspirasi Ditolak.' };
          const status8 = nextStatus === 'Diselesaikan' ? 'Diselesaikan' : nextStatus === 'Ditolak' ? 'Ditolak' : 'Dibaca';
          const updateType = previousStatus !== nextStatus
            ? 'Status ' + previousStatus + ' menjadi ' + nextStatus
            : (String(payload.catatan || '').trim() ? 'Catatan tindak lanjut diperbarui' : 'Data tindak lanjut diperbarui');
          sheet.getRange(i + 1, statusCol + 1).setValue(nextStatus === 'Diselesaikan' ? 'Sudah' : 'Belum');
          sheet.getRange(i + 1, status8Col).setValue(status8);
          sheet.getRange(i + 1, readCol).setValue('Sudah Dibaca');
          sheet.getRange(i + 1, statusUpdatedCol).setValue(new Date());
          sheet.getRange(i + 1, statusUpdatedByCol).setValue(payload.adminUsername);
          if (rejectionCol > 0) sheet.getRange(i + 1, rejectionCol).setValue(nextStatus === 'Ditolak' ? sheetText_(String(payload.catatan || '')) : '');
          sheet.getRange(i + 1, catatanColNumber).setValue(sheetText_(payload.catatan));
          sheet.getRange(i + 1, tanggalColNumber).setValue(nextStatus === 'Diselesaikan' ? new Date() : '');
          if (adminColNumber > 0) sheet.getRange(i + 1, adminColNumber).setValue(nextStatus === 'Diselesaikan' ? payload.adminUsername : '');
          if (payload.foto) {
            validateFilePayload_(payload.foto, false);
            const fotoLink = uploadFileToDrive_(payload.foto, targetId + '_TL', 'Teras Tower 2 - Foto Tindak Lanjut');
            sheet.getRange(i + 1, fotoTlColNumber).setValue(fotoLink);
          }
          sheet.getRange(i + 1, lastUpdatedCol).setValue(new Date());
          sheet.getRange(i + 1, lastUpdatedByCol).setValue(payload.adminUsername);
          sheet.getRange(i + 1, lastUpdateTypeCol).setValue(updateType);
          // v19: waktu untuk linimasa Papan Tindak Lanjut dan rata-rata waktu tanggap.
          const dibacaPadaCol = ensureSheetColumn_(sheet, 'DibacaPada');
          const selesaiPadaCol = ensureSheetColumn_(sheet, 'SelesaiPada');
          if (!values[i][dibacaPadaCol - 1]) sheet.getRange(i + 1, dibacaPadaCol).setValue(new Date());
          if (status8 === 'Diselesaikan') { if (!values[i][selesaiPadaCol - 1]) sheet.getRange(i + 1, selesaiPadaCol).setValue(new Date()); }
          else if (values[i][selesaiPadaCol - 1]) sheet.getRange(i + 1, selesaiPadaCol).setValue('');
          invalidatePapanCache_();
          writeAuditLog_('UPDATE_TINDAK_LANJUT', payload.adminUsername, targetId, updateType);
          // v12: kabari warga pengirim hanya bila statusnya benar-benar berubah.
          const ownerCol = headers.indexOf('Username');
          const owner = ownerCol >= 0 ? String(values[i][ownerCol] || '').trim() : '';
          // Bandingkan dengan StatusAspirasi lama (bukan kolom Sudah/Belum), dibaca sebelum diubah.
          const previousStatus8 = String(values[i][status8Col - 1] || '').trim();
          if (owner && previousStatus8 !== status8) {
            const pushBody = nextStatus === 'Diselesaikan' ? 'Aspirasi Anda telah diselesaikan pengurus.'
              : nextStatus === 'Ditolak' ? 'Aspirasi Anda tidak dapat ditindaklanjuti. Ketuk untuk melihat catatan pengurus.'
              : 'Aspirasi Anda sudah dibaca pengurus.';
            queuePush_({ usernames: [owner] }, { title: 'Aspirasi Anda diperbarui', body: pushBody, page: 'riwayat' });
          }
          // v18: kabari admin lain bahwa aspirasi BARU ini sudah ditangani. Memakai tag yang
          // sama dengan notifikasi "Aspirasi baru masuk", sehingga di HP admin lain notifikasi
          // lama diganti (bukan ditambah).
          if (previousStatus8 === 'Baru' && status8 !== 'Baru') {
            const kategoriCol = headers.indexOf('Kategori');
            queuePush_({ admins: true, excludeUsernames: [session.username] }, {
              title: 'Aspirasi sudah ditangani',
              body: (kategoriCol >= 0 ? String(values[i][kategoriCol] || '') + ' · ' : '') + status8 + ' oleh ' + session.username,
              page: 'admin', tag: 'aspirasi-' + targetId
            });
          }
          invalidateAdminNotificationCaches_();
          return { success: true };
        }
      }
      // v18 (A11): catat agar penyebabnya bisa ditelusuri, dan beri tahu admin langkahnya.
      writeApplicationError_('updateTindakLanjut', new Error('ID aspirasi tidak ditemukan: ' + targetId + ' (kolom ID ' + (idCol >= 0 ? 'ada' : 'TIDAK ADA') + ', ' + (values.length - 1) + ' baris)'), session.username);
      return { success: false, notFound: true, message: 'Data tidak ditemukan. Daftar aspirasi dimuat ulang; coba lagi. Bila tetap gagal, laporkan ID ' + targetId + ' ke Super Admin.' };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// v18 (A11): dijalankan pemicu harian. Mengisi ID aspirasi yang kosong dan mengganti ID
// kembar (mis. baris yang disalin manual di Sheets) agar tindak lanjut tidak salah baris
// atau gagal dengan "Data tidak ditemukan".
function repairAspirasiIds_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DATA);
  if (!sheet || sheet.getLastRow() < 2) return { kosong: 0, kembar: 0 };
  const values = sheet.getDataRange().getValues();
  const idCol = values[0].map(String).indexOf('ID');
  if (idCol < 0) return { kosong: 0, kembar: 0, catatan: 'kolom ID tidak ada' };
  const seen = {};
  const fixed = { kosong: 0, kembar: 0 };
  for (let i = 1; i < values.length; i++) {
    const rowHasData = values[i].some(function (v, c) { return c !== idCol && String(v == null ? '' : v).trim() !== ''; });
    if (!rowHasData) continue;
    const id = String(values[i][idCol] == null ? '' : values[i][idCol]).trim();
    if (id && !seen[id]) { seen[id] = true; continue; }
    const fresh = 'A' + Utilities.getUuid().replace(/-/g, '').substring(0, 9).toUpperCase();
    sheet.getRange(i + 1, idCol + 1).setValue(fresh);
    seen[fresh] = true;
    if (id) fixed.kembar++; else fixed.kosong++;
  }
  if (fixed.kosong || fixed.kembar) writeAuditLog_('PERBAIKI_ID_ASPIRASI', 'sistem', SHEET_DATA, JSON.stringify(fixed));
  return fixed;
}

// ===================================================================
// NOMOR PENTING & DARURAT
// ===================================================================
// v17: versi publik hanya untuk halaman Kelola (admin). Warga membaca lewat getKontakData.
function getNomorPentingData_() { return getSheetData_(SHEET_NOMORPENTING); }
function getNomorPenting(sessionToken) {
  requireSession_(sessionToken, ['admin', 'super_admin']);
  return getNomorPentingData_();
}
// v15: pastikan sheet punya kolom berjudul `header`; kembalikan nomor kolomnya (1-based).
function ensureSheetColumn_(sheet, header) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const found = headers.indexOf(header);
  if (found >= 0) return found + 1;
  const col = headers.join('') === '' ? 1 : lastCol + 1;
  sheet.getRange(1, col).setValue(header);
  return col;
}
function getNomorDaruratData_() { return getSheetData_(SHEET_NOMORDARURAT); }
function getNomorDarurat(sessionToken) {
  requireSession_(sessionToken, ['admin', 'super_admin']);
  return getNomorDaruratData_();
}

function saveNomorPenting(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  if (!isAdminUsername_(session.username)) return { success: false, message: 'Anda tidak memiliki akses admin.' };
  try {
    const input = Array.isArray(payload && payload.data) ? payload.data : [];
    if (input.length > 100) throw new Error('Maksimal 100 nomor penting.');
    const kategoriAllowed = ['Pengelola', 'Keamanan', 'Lainnya'];
    const rows = input.map(function (item) {
      return [sheetText_(validateString_(item && item.nama, 'Nama kontak', 1, 120)), sheetText_(validateString_(item && item.nomor, 'Nomor kontak', 1, 250))];
    });
    const kategori = input.map(function (item) {
      const value = String(item && item.kategori || 'Lainnya');
      return [kategoriAllowed.indexOf(value) >= 0 ? value : 'Lainnya'];
    });
    return withScriptLock_(function () {
      const sheet = getSheet_(SHEET_NOMORPENTING);
      const kategoriCol = ensureSheetColumn_(sheet, 'Kategori');
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) { sheet.getRange(2, 1, lastRow - 1, 2).clearContent(); sheet.getRange(2, kategoriCol, lastRow - 1, 1).clearContent(); }
      if (rows.length) { sheet.getRange(2, 1, rows.length, 2).setValues(rows); sheet.getRange(2, kategoriCol, rows.length, 1).setValues(kategori); }
      writeAuditLog_('UPDATE_NOMOR_PENTING', session.username, SHEET_NOMORPENTING, 'rows=' + rows.length);
      return { success: true };
    });
  } catch (err) { return { success: false, message: err.message }; }
}

function saveNomorDarurat(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  if (!isAdminUsername_(session.username)) return { success: false, message: 'Anda tidak memiliki akses admin.' };
  try {
    const input = Array.isArray(payload && payload.data) ? payload.data : [];
    if (input.length > 100) throw new Error('Maksimal 100 nomor darurat.');
    const rows = input.map(function (item) {
      const kategori = validateString_(item && item.kategori, 'Kategori kontak', 1, 80);
      return [sheetText_(kategori), sheetText_(validateString_(item && item.nama, 'Nama kontak', 1, 120)), sheetText_(validateString_(item && item.nomor, 'Nomor kontak', 1, 250))];
    });
    return withScriptLock_(function () {
      const sheet = getSheet_(SHEET_NOMORDARURAT);
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
      if (rows.length) sheet.getRange(2, 1, rows.length, 3).setValues(rows);
      writeAuditLog_('UPDATE_NOMOR_DARURAT', session.username, SHEET_NOMORDARURAT, 'rows=' + rows.length);
      return { success: true };
    });
  } catch (err) { return { success: false, message: err.message }; }
}

// ===================================================================
// KELOLA ADMIN (HANYA SUPERADMIN)
// ===================================================================
function getAllAdmins(requesterUsername, sessionToken) {
  const requester = requireSession_(sessionToken, ['super_admin']);
  requesterUsername = requester.username;
  if (!isSuperAdmin_(requesterUsername)) {
    return { authorized: false, data: [] };
  }
  const data = getSheetData_(SHEET_ADMINS);
  // The admin-management page only needs identity and description, not PINs.
  const safeData = data.filter(function (row) { return !isSuperAdmin_(String(row.Username || '')); }).map(function (row) {
    return { Username: row.Username || '', Keterangan: row.Keterangan || '' };
  });
  return { authorized: true, data: safeData };
}

function addAdmin(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['super_admin']);
  payload.adminUsername = session.username;
  if (!isSuperAdmin_(payload.adminUsername)) {
    return { success: false, message: 'Hanya SuperAdmin yang dapat menambah admin.' };
  }
  const username = String(payload.username || '').trim().toLowerCase();
  const pin = String(payload.pin || '').trim();
  const keterangan = String(payload.keterangan || '').trim();

  if (!/^[a-z0-9][a-z0-9_.@+-]{2,79}$/.test(username)) return { success: false, message: 'Username Admin tidak valid.' };
  if (isReservedSuperAdminUsername_(username)) return { success: false, message: 'Username ini milik Super Admin dan tidak bisa dijadikan Admin.' };
  if (keterangan.length > 120) return { success: false, message: 'Keterangan maksimal 120 karakter.' };
  if (!username || !pin) {
    return { success: false, message: 'Username/Email dan PIN wajib diisi.' };
  }
  if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return { success: false, message: 'PIN harus 6 digit angka.' };
  }

  try {
    const pinHash = makePinHash_(pin);
    return withScriptLock_(function () {
      const existing = getSheetData_(SHEET_ADMINS);
      if (existing.some(function (row) { return row.Username && String(row.Username).toLowerCase() === username.toLowerCase(); })) {
        return { success: false, message: 'Username tersebut sudah terdaftar sebagai admin.' };
      }
      const sheet = getSheet_(SHEET_ADMINS);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const newRow = headers.map(function (h) {
        if (h === 'Username') return sheetText_(username);
        if (h === 'PIN') return pinHash;
        if (h === 'Keterangan') return sheetText_(keterangan);
        return '';
      });
      sheet.appendRow(newRow);
      bumpSessionVersion_(username);
      writeAuditLog_('ADD_ADMIN', payload.adminUsername, username, keterangan);
      return { success: true };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function removeAdmin(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['super_admin']);
  const adminUsername = session.username;
  if (!isSuperAdmin_(adminUsername)) return { success: false, message: 'Hanya SuperAdmin yang dapat menghapus admin.' };
  const target = String(payload && payload.username || '').trim();
  if (!target) return { success: false, message: 'Username admin tidak valid.' };
  try {
    return withScriptLock_(function () {
      const sheet = getSheet_(SHEET_ADMINS);
      const values = sheet.getDataRange().getValues();
      const headers = values[0] || [];
      const usernameCol = headers.indexOf('Username');
      if (usernameCol < 0) return { success: false, message: 'Kolom Username tidak ditemukan.' };
      let removed = false;
      for (let i = values.length - 1; i >= 1; i--) {
        if (String(values[i][usernameCol] || '').toLowerCase() === target.toLowerCase()) {
          sheet.deleteRow(i + 1);
          removed = true;
        }
      }
      if (removed) {
        bumpSessionVersion_(target);
        writeAuditLog_('REMOVE_ADMIN', adminUsername, target, 'Dari Kelola Admin; sesi dicabut');
      }
      return { success: true, removed: removed };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ===================================================================
// KUSTOMISASI (FIXED - with bgImage upload support)
// ===================================================================
function updateSystemConfig(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  if (!isAdminUsername_(session.username)) {
    return { success: false, message: 'Anda tidak memiliki akses admin.' };
  }
  try {
    return withScriptLock_(function () {
      const cfg = payload.config || {};

      // Upload background image (jika ada) -> file publik agar bisa dipakai sebagai gambar
      let bgImageUrl = '';
      if (payload.bgImage) {
        validateFilePayload_(payload.bgImage, true);
        bgImageUrl = uploadPublicImage_(payload.bgImage, 'bg_' + Date.now(), 'Teras Tower 2 - Background Images');
        cfg.BackgroundImage = bgImageUrl;
      }

      const color = String(cfg.PrimaryColor || '').trim();
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Warna utama harus berformat #RRGGBB.');
      const bg = String(cfg.BackgroundImage || '').trim();
      if (bg && !/^https:\/\/[^\s"'()<>\\]+$/i.test(bg)) {
        throw new Error('URL background harus diawali https:// dan tidak boleh mengandung spasi atau tanda kutip.');
      }

      // upsert: baris dibuat otomatis kalau belum ada di sheet SystemConfig
      if (color) upsertSystemConfigValue_('PrimaryColor', color);
      upsertSystemConfigValue_('BackgroundImage', bg);
      writeAuditLog_('UPDATE_THEME', session.username, 'SystemConfig', 'Warna/background diperbarui');

      const result = { success: true };
      if (bgImageUrl) result.bgImageUrl = bgImageUrl;
      return result;
    });
  } catch (err) {
    writeApplicationError_('updateSystemConfig', err, session.username);
    return { success: false, message: err.message };
  }
}

// ===================================================================
// BANNER CAROUSEL (Beranda)
// Disimpan sebagai JSON di SystemConfig, key = BannerList
// ===================================================================
function uploadPublicImage_(fileObj, id, folderName) {
  const folder = getManagedDriveFolder_(folderName);
  const decoded = Utilities.base64Decode(fileObj.base64);
  const blob = Utilities.newBlob(decoded, fileObj.mimeType, id + '_' + fileObj.fileName);
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    file.setTrashed(true);
    throw new Error('Drive tidak mengizinkan berbagi publik untuk banner (kebijakan akun/Workspace).');
  }
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

function upsertSystemConfigValue_(key, value) {
  invalidateSmallSheetCache_(['systemConfig']);
  const sheet = getSheet_(SHEET_SYSTEMCONFIG);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const keyCol = headers.indexOf('KEY');
  const valCol = headers.indexOf('VALUE');
  if (keyCol < 0 || valCol < 0) throw new Error('Sheet SystemConfig harus memiliki kolom KEY dan VALUE.');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][keyCol]) === key) { sheet.getRange(i + 1, valCol + 1).setValue(value); invalidateSmallSheetCache_(['systemConfig']); return; }
  }
  const row = new Array(headers.length).fill('');
  row[keyCol] = key;
  row[valCol] = value;
  sheet.appendRow(row);
  invalidateSmallSheetCache_(['systemConfig']);
}

function saveBanners(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  if (!isAdminUsername_(session.username)) return { success: false, message: 'Anda tidak memiliki akses admin.' };
  try {
    return withScriptLock_(function () {
      const items = Array.isArray(payload.banners) ? payload.banners : [];
      if (items.length > BANNER_MAX) throw new Error('Maksimal ' + BANNER_MAX + ' banner.');
      const saved = items.map(function (item, i) {
        let url = String(item.url || '');
        const id = 'b' + Date.now().toString(36) + i;
        if (item.upload) {
          validateFilePayload_(item.upload, true);
          url = uploadPublicImage_(item.upload, id, BANNER_FOLDER);
        } else if (!/^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]+$/.test(url)) {
          throw new Error('URL banner ke-' + (i + 1) + ' tidak valid.');
        }
        const link = String(item.link || '').trim();
        if (link && !/^https?:\/\/[^\s<>"'\\]+$/i.test(link)) {
          throw new Error('Link banner ke-' + (i + 1) + ' harus diawali http:// atau https://');
        }
        return { id: id, url: url, link: link.substring(0, 500), aktif: item.aktif !== false };
      });
      const json = JSON.stringify(saved);
      upsertSystemConfigValue_(BANNER_CONFIG_KEY, json);
      writeAuditLog_('UPDATE_BANNERS', session.username, 'SystemConfig', saved.length + ' banner');
      return { success: true, bannerList: json };
    });
  } catch (err) {
    writeApplicationError_('saveBanners', err, session.username);
    return { success: false, message: err.message };
  }
}

// ===================================================================
// MASUKAN PENGEMBANGAN APLIKASI
// ===================================================================
function getAppFeedbackSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_APPFEEDBACK);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_APPFEEDBACK);
    sheet.appendRow(['Timestamp', 'Username', 'Nama', 'Kategori', 'Masukan', 'Status', 'Catatan Admin', 'UpdatedAt', 'UpdatedBy', 'Dibaca']);
  } else {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
    if (headers.indexOf('Dibaca') < 0) {
      const readCol = lastColumn + 1;
      sheet.getRange(1, readCol).setValue('Dibaca');
      if (sheet.getLastRow() > 1) sheet.getRange(2, readCol, sheet.getLastRow() - 1, 1).setValue('Sudah Dibaca');
    }
  }
  return sheet;
}

// v18: dibungkus kunci tulis. Fungsi ini mencari nomor baris lalu menulis ke baris itu;
// tanpa kunci, penghapusan baris oleh proses lain di antaranya bisa menggeser target.
function submitAppFeedback(payload) {
  try {
    return withScriptLock_(function () { return submitAppFeedbackUnlocked_(payload); });
  } catch (err) {
    writeApplicationError_('submitAppFeedback', err, 'sistem');
    return { success: false, message: 'Server sedang sibuk. Coba lagi sebentar.' };
  }
}

function submitAppFeedbackUnlocked_(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident']);
  const kategori = validateString_(payload && payload.kategori, 'Kategori', 1, 40);
  const masukan = validateString_(payload && payload.masukan, 'Masukan', 10, 1000);
  const nama = String(payload && payload.nama || '').trim().substring(0, 120);
  const sheet = getAppFeedbackSheet_();
  sheet.appendRow([new Date(), sheetText_(session.username), sheetText_(nama), sheetText_(kategori), sheetText_(masukan), 'Dipertimbangkan', '', new Date(), sheetText_(session.username), 'Belum Dibaca']);
  return { success: true };
}

function getAppFeedback(sessionToken) {
  const session = requireSession_(sessionToken, ['super_admin']);
  const sheet = getAppFeedbackSheet_();
  const rows = getSheetData_(SHEET_APPFEEDBACK);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const readCol = headers.indexOf('Dibaca');
  const data = rows.map(function (row, index) {
    const unread = String(row.Dibaca || 'Belum Dibaca') !== 'Sudah Dibaca';
    return {
      timestamp: formatTanggal_(row.Timestamp),
      username: String(row.Username || ''),
      nama: String(row.Nama || ''),
      kategori: String(row.Kategori || ''),
      masukan: String(row.Masukan || ''),
      status: String(row.Status || 'Dipertimbangkan'),
      catatanAdmin: String(row['Catatan Admin'] || ''),
      unread: unread,
      rowNumber: index + 2
    };
  });
  return { authorized: true, data: data.reverse() };
}

// v18: dibungkus kunci tulis. Fungsi ini mencari nomor baris lalu menulis ke baris itu;
// tanpa kunci, penghapusan baris oleh proses lain di antaranya bisa menggeser target.
function markAppFeedbackSeen(sessionToken) {
  try {
    return withScriptLock_(function () { return markAppFeedbackSeenUnlocked_(sessionToken); });
  } catch (err) {
    writeApplicationError_('markAppFeedbackSeen', err, 'sistem');
    return { success: false, message: 'Server sedang sibuk. Coba lagi sebentar.' };
  }
}

function markAppFeedbackSeenUnlocked_(sessionToken) {
  requireSession_(sessionToken, ['super_admin']);
  const sheet = getAppFeedbackSheet_();
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  const readCol = headers.indexOf('Dibaca');
  const rows = Math.max(0, sheet.getLastRow() - 1);
  if (readCol >= 0 && rows > 0) sheet.getRange(2, readCol + 1, rows, 1).setValues(Array.from({ length: rows }, function () { return ['Sudah Dibaca']; }));
  return { success: true, marked: rows };
}

function updateAppFeedback(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['super_admin']);
  const rowNumber = Number(payload && payload.rowNumber);
  const status = validateString_(payload && payload.status, 'Status', 1, 30);
  const catatan = sheetText_(String(payload && payload.catatanAdmin || '').trim().substring(0, 500));
  if (!Number.isInteger(rowNumber) || rowNumber < 2) return { success: false, message: 'Baris masukan tidak valid.' };
  return withScriptLock_(function () {
    const sheet = getAppFeedbackSheet_();
    if (rowNumber > sheet.getLastRow()) return { success: false, message: 'Masukan tidak ditemukan.' };
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const usernameCol = headers.indexOf('Username');
    const feedbackOwner = usernameCol >= 0 ? String(sheet.getRange(rowNumber, usernameCol + 1).getValue() || '') : '';
    if (['Dipertimbangkan', 'Diterapkan', 'Ditolak'].indexOf(status) < 0) return { success: false, message: 'Status masukan tidak valid.' };
    const statusCol = headers.indexOf('Status');
    const noteCol = headers.indexOf('Catatan Admin');
    const updatedAtCol = headers.indexOf('UpdatedAt');
    const updatedByCol = headers.indexOf('UpdatedBy');
    if (statusCol < 0 || noteCol < 0) return { success: false, message: 'Struktur sheet AppFeedback belum lengkap.' };
    sheet.getRange(rowNumber, statusCol + 1).setValue(status);
    sheet.getRange(rowNumber, noteCol + 1).setValue(catatan);
    if (updatedAtCol >= 0) sheet.getRange(rowNumber, updatedAtCol + 1).setValue(new Date());
    if (updatedByCol >= 0) sheet.getRange(rowNumber, updatedByCol + 1).setValue(session.username);
    writeAuditLog_('UPDATE_APP_FEEDBACK', session.username, String(rowNumber), status);
    invalidateNotificationSummaryCache_(feedbackOwner);
    invalidateAdminNotificationCaches_();
    return { success: true };
  });
}

// ===================================================================
// KEPUASAN LAYANAN (NEW)
// ===================================================================

function getMingguIni_() {
  const now = new Date();
  const day = now.getDay(); // 0=Minggu, 1=Senin...
  const diff = now.getDate() - day;
  const mingguStart = new Date(now);
  mingguStart.setDate(diff);
  mingguStart.setHours(0, 0, 0, 0);
  return mingguStart;
}

function isSameMinggu_(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  const day1 = d1.getDay();
  const day2 = d2.getDay();
  const start1 = new Date(d1);
  start1.setDate(d1.getDate() - day1);
  const start2 = new Date(d2);
  start2.setDate(d2.getDate() - day2);
  return start1.getTime() === start2.getTime();
}

function getKepuasanData_() {
  try {
    return getSheetData_(SHEET_KEPUASAN);
  } catch (e) {
    return [];
  }
}

function getRekapKepuasan() {
  const data = getKepuasanData_();
  const result = {};
  KATEGORI_KEPUASAN.forEach(function (kat) {
    const items = data.filter(function (row) { return row.Kategori === kat; });
    const total = items.reduce(function (sum, row) { return sum + (Number(row.Skor) || 0); }, 0);
    result[kat] = items.length > 0 ? total / items.length : 0;
  });
  // Rata-rata global
  const allSkor = data.map(function (row) { return Number(row.Skor) || 0; });
  result.global = allSkor.length > 0 ? allSkor.reduce(function (a, b) { return a + b; }, 0) / allSkor.length : 0;
  result.jumlahResponden = [...new Set(data.map(function (row) { return row.Username; }))].length;
  return result;
}

function getMyKepuasanThisWeek(username, sessionToken) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  username = session.username;
  const data = getKepuasanData_();
  const now = new Date();
  return data.filter(function (row) {
    return String(row.Username || '').toLowerCase() === username.toLowerCase() &&
      isSameMinggu_(row.TimeStamp, now);
  }).map(function (row) { return row.Kategori; });
}

function submitKepuasan(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  try {
    const kategori = String(payload && payload.kategori || '').trim();
    const skor = Number(payload && payload.skor);
    const komentar = String(payload && payload.komentar || '').trim();
    if (KATEGORI_KEPUASAN.indexOf(kategori) < 0) throw new Error('Kategori kepuasan tidak valid.');
    if (!Number.isFinite(skor) || skor < 0 || skor > 100) throw new Error('Skor harus antara 0-100.');
    if (komentar.length > 1000) throw new Error('Komentar maksimal 1000 karakter.');
    return withScriptLock_(function () {
      const alreadySubmitted = getKepuasanData_().some(function (row) {
        return String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase() &&
          row.Kategori === kategori && isSameMinggu_(row.TimeStamp, new Date());
      });
      if (alreadySubmitted) return { success: false, message: 'Anda sudah memberikan penilaian untuk ' + kategori + ' minggu ini. Silakan coba lagi minggu depan.' };
      const sheet = getSheet_(SHEET_KEPUASAN);
      sheet.appendRow([new Date(), sheetText_(session.username), sheetText_(kategori), skor, sheetText_(komentar)]);
      if (session.role !== 'resident') writeAuditLog_('UPDATE_KEPUASAN', session.username, kategori, 'Penilaian kepuasan diperbarui');
      return { success: true };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}
function getAllKepuasanAdmin(requesterUsername, sessionToken) {
  const requester = requireSession_(sessionToken, ['admin', 'super_admin']);
  requesterUsername = requester.username;
  if (!isAdminUsername_(requesterUsername)) {
    return { authorized: false, data: [], rekap: {} };
  }
  const data = getKepuasanData_();
  const rekap = getRekapKepuasan();
  // Masking nama: huruf pertama + bintang + huruf terakhir
  const masked = data.map(function (row) {
    const name = String(row.Username || '');
    let maskedName = name;
    if (name.length > 2) {
      maskedName = name.charAt(0) + '*'.repeat(name.length - 2) + name.charAt(name.length - 1);
    } else if (name.length === 2) {
      maskedName = name.charAt(0) + '*';
    }
    return {
      timestamp: formatTanggal_(row.TimeStamp),
      username: maskedName,
      kategori: row.Kategori,
      skor: Number(row.Skor) || 0,
      skorSkala5: ((Number(row.Skor) || 0) / 20).toFixed(2),
      komentar: row.Komentar || ''
    };
  });
  return { authorized: true, data: masked, rekap: rekap };
}

// ===================================================================
// TEST
// ===================================================================
function testKoneksi_() {
  Logger.log('--- Test AppInfo ---');
  Logger.log(getSheetData_(SHEET_APPINFO));
  Logger.log('--- Test RefData ---');
  Logger.log(getSheetData_(SHEET_REFDATA));
  Logger.log('--- Test Admins ---');
  Logger.log(getSheetData_(SHEET_ADMINS));
  Logger.log('--- Test Data Aspirasi ---');
  Logger.log(getSheetData_(SHEET_DATA));
  Logger.log('--- Test SystemConfig ---');
  Logger.log(getSheetData_(SHEET_SYSTEMCONFIG));
  Logger.log('--- Test Warga ---');
  Logger.log(getSheetData_(SHEET_WARGA));
  Logger.log('--- Test Kepuasan ---');
  Logger.log(getSheetData_(SHEET_KEPUASAN));
}

function getKontakData() {
  return {
    nomorPenting: getNomorPentingData_(),
    nomorDarurat: getNomorDaruratData_()
  };
}

// ===================================================================
// KALENDER KERJA — hanya agenda disimpan; grid kalender dan jam berjalan
// dirender di klien. Waktu server dipakai sebagai acuan Asia/Jakarta.
// ===================================================================
function getAppClock(sessionToken) {
  requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const now = new Date();
  return {
    epochMs: now.getTime(),
    timeZone: 'Asia/Jakarta',
    today: Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd')
  };
}

// ===================================================================
// v15 — HARI LIBUR & HARI PERINGATAN OTOMATIS
// -------------------------------------------------------------------
// Sumber utama: kalender publik "Hari Libur di Indonesia" milik Google (format ICS,
// tanpa login). Hasil per tahun disimpan di cache 12 jam.
// Koreksi manual (mis. cuti bersama baru / hari peringatan tambahan): buat sheet
// "HariLibur" dengan kolom Tanggal | Nama | Jenis (Libur / Peringatan / Internasional / Hapus).
// Hari internasional bertanggal tetap ada di daftar INTERNATIONAL_DAYS di bawah.
// Baris "Hapus" menyembunyikan entri Google pada tanggal itu.
// ===================================================================
const SHEET_HARILIBUR = 'HariLibur';
const HOLIDAY_ICS_URL = 'https://calendar.google.com/calendar/ical/id.indonesian%23holiday%40group.v.calendar.google.com/public/basic.ics';

function parseHolidayIcs_(text) {
  const lines = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let current = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { current = {}; return; }
    if (line === 'END:VEVENT') { if (current && current.date && current.name) out.push(current); current = null; return; }
    if (!current) return;
    const idx = line.indexOf(':'); if (idx < 0) return;
    const key = line.substring(0, idx).split(';')[0];
    const value = line.substring(idx + 1).replace(/\\,/g, ',').replace(/\\n/g, '\n').replace(/\\;/g, ';').trim();
    if (key === 'DTSTART') { const m = value.match(/^(\d{4})(\d{2})(\d{2})/); if (m) current.date = m[1] + '-' + m[2] + '-' + m[3]; }
    else if (key === 'SUMMARY') current.name = value;
    else if (key === 'DESCRIPTION') current.description = value;
  });
  return out.map(function (item) {
    const desc = String(item.description || '').toLowerCase();
    const observance = /observance|peringatan|perayaan/.test(desc) && !/libur|public holiday/.test(desc.split('\n')[0]);
    return { date: item.date, name: item.name, type: observance ? 'peringatan' : 'libur' };
  });
}

function getGoogleHolidays_(year) {
  const cache = CacheService.getScriptCache();
  const key = 'holidays-v1-' + year;
  const cached = cache.get(key);
  if (cached) { try { return JSON.parse(cached); } catch (ignore) {} }
  let list = [];
  try {
    const response = UrlFetchApp.fetch(HOLIDAY_ICS_URL, { muteHttpExceptions: true, followRedirects: true });
    if (response.getResponseCode() === 200) {
      list = parseHolidayIcs_(response.getContentText()).filter(function (item) { return item.date.indexOf(String(year)) === 0; });
    }
  } catch (err) { console.warn('Kalender libur Google tidak terambil: ' + err.message); }
  try { cache.put(key, JSON.stringify(list), list.length ? 43200 : 1800); } catch (ignore) {}
  return list;
}

function getManualHolidays_() {
  const sheet = getSheet_(SHEET_HARILIBUR);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return getSheetData_(SHEET_HARILIBUR).map(function (row) {
    const jenis = String(row.Jenis || 'Libur').trim().toLowerCase();
    return { date: agendaDateKey_(row.Tanggal), name: String(row.Nama || '').trim(), type: jenis === 'hapus' ? 'hapus' : (jenis === 'peringatan' ? 'peringatan' : (jenis === 'internasional' ? 'internasional' : 'libur')) };
  }).filter(function (item) { return /^\d{4}-\d{2}-\d{2}$/.test(item.date); });
}

// Hari internasional yang tanggalnya tetap dan benar-benar diperingati luas (sebagian besar hari PBB/WHO).
const INTERNATIONAL_DAYS = [
  ['01-27', 'Hari Peringatan Holocaust Internasional'], ['02-04', 'Hari Kanker Sedunia'], ['02-21', 'Hari Bahasa Ibu Internasional'],
  ['03-08', 'Hari Perempuan Internasional'], ['03-15', 'Hari Hak Konsumen Sedunia'], ['03-21', 'Hari Hutan Internasional'], ['03-22', 'Hari Air Sedunia'],
  ['04-07', 'Hari Kesehatan Sedunia'], ['04-22', 'Hari Bumi'], ['04-23', 'Hari Buku Sedunia'],
  ['05-01', 'Hari Buruh Internasional'], ['05-31', 'Hari Tanpa Tembakau Sedunia'],
  ['06-05', 'Hari Lingkungan Hidup Sedunia'], ['06-14', 'Hari Donor Darah Sedunia'], ['06-26', 'Hari Anti Narkotika Internasional'],
  ['08-12', 'Hari Remaja Internasional'], ['09-08', 'Hari Aksara Internasional'], ['09-21', 'Hari Perdamaian Internasional'], ['09-29', 'Hari Jantung Sedunia'],
  ['10-01', 'Hari Lanjut Usia Internasional'], ['10-05', 'Hari Guru Sedunia'], ['10-10', 'Hari Kesehatan Jiwa Sedunia'], ['10-16', 'Hari Pangan Sedunia'], ['10-24', 'Hari Perserikatan Bangsa-Bangsa'],
  ['11-14', 'Hari Diabetes Sedunia'], ['11-19', 'Hari Toilet Sedunia'], ['11-20', 'Hari Anak Sedunia'],
  ['12-01', 'Hari AIDS Sedunia'], ['12-03', 'Hari Penyandang Disabilitas Internasional'], ['12-05', 'Hari Relawan Internasional'], ['12-10', 'Hari Hak Asasi Manusia']
];

function getHolidaysForMonth_(year, month) {
  const monthKey = String(year) + '-' + ('0' + month).slice(-2);
  const manual = getManualHolidays_().filter(function (item) { return item.date.indexOf(monthKey) === 0; });
  const removed = {};
  manual.forEach(function (item) { if (item.type === 'hapus') removed[item.date] = true; });
  const merged = getGoogleHolidays_(year).filter(function (item) { return item.date.indexOf(monthKey) === 0 && !removed[item.date]; });
  manual.forEach(function (item) {
    if (item.type === 'hapus' || !item.name) return;
    if (!merged.some(function (x) { return x.date === item.date && x.name === item.name; })) merged.push(item);
  });
  INTERNATIONAL_DAYS.forEach(function (day) {
    const date = String(year) + '-' + day[0];
    if (date.indexOf(monthKey) !== 0 || removed[date]) return;
    // Tanggal yang sudah libur nasional, atau sudah ada dengan nama serupa (mis. 1 Mei), tidak diulang.
    const key = day[1].toLowerCase().split(' ').slice(0, 2).join(' ');
    if (merged.some(function (x) { return x.date === date && (x.type === 'libur' || x.name.toLowerCase().indexOf(key) >= 0); })) return;
    merged.push({ date: date, name: day[1], type: 'internasional' });
  });
  const order = { libur: 0, peringatan: 1, internasional: 2 };
  return merged.sort(function (a, b) { return a.date.localeCompare(b.date) || order[a.type] - order[b.type]; });
}

function getAgendaSheet_() {
  const headers = ['ID', 'Tanggal', 'JamMulai', 'JamSelesai', 'Judul', 'Lokasi', 'Detail', 'StatusAgenda', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];
  return withScriptLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_AGENDA);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_AGENDA);
      sheet.appendRow(headers);
      return sheet;
    }
    headers.forEach(function (header) { ensureSheetColumn_(sheet, header); });
    return sheet;
  });
}

function agendaSpreadsheetTimeZone_() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    return spreadsheet && typeof spreadsheet.getSpreadsheetTimeZone === 'function'
      ? (spreadsheet.getSpreadsheetTimeZone() || 'Asia/Jakarta')
      : 'Asia/Jakarta';
  } catch (ignore) { return 'Asia/Jakarta'; }
}
function agendaDateKey_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    // Legacy sheet cells may have been auto-parsed using the Spreadsheet's
    // timezone. Format in that same timezone to preserve the entered date.
    return Utilities.formatDate(value, agendaSpreadsheetTimeZone_(), 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : Utilities.formatDate(parsed, agendaSpreadsheetTimeZone_(), 'yyyy-MM-dd');
}
function agendaTimeKey_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    // Legacy time cells may be Date objects at midnight in the sheet's zone.
    return Utilities.formatDate(value, agendaSpreadsheetTimeZone_(), 'HH:mm');
  }
  const text = String(value).trim();
  const match = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  return match ? ('0' + match[1]).slice(-2) + ':' + match[2] : '';
}

function writeAgendaRow_(sheet, headers, row, existingRowNumber) {
  const rowNumber = existingRowNumber || Math.max(sheet.getLastRow() + 1, 2);
  if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rowNumber - sheet.getMaxRows());
  ['Tanggal', 'JamMulai', 'JamSelesai'].forEach(function (header) {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(rowNumber, col).setNumberFormat('@');
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  return rowNumber;
}

function isValidAgendaDate_(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parts = text.split('-').map(Number);
  if (parts[0] < 2000 || parts[0] > 2100) return false;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
}

function agendaMonthCacheKey_(year, month, isAdmin) {
  return 'tower-agenda-v3:' + year + '-' + ('0' + month).slice(-2) + ':' + (isAdmin ? 'admin' : 'public');
}
function invalidateAgendaCacheForDate_(dateValue) {
  const date = agendaDateKey_(dateValue);
  if (!date) return;
  const parts = date.split('-');
  const year = Number(parts[0]), month = Number(parts[1]);
  const cache = CacheService.getScriptCache();
  cache.remove(agendaMonthCacheKey_(year, month, false));
  cache.remove(agendaMonthCacheKey_(year, month, true));
}

function getAgendaCalendar(sessionToken, yearValue, monthValue) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const agendaSheet = getSheet_(SHEET_AGENDA);
  const now = new Date();
  let year, month;
  if ((yearValue === null || yearValue === undefined || yearValue === '') && (monthValue === null || monthValue === undefined || monthValue === '')) {
    const current = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM').split('-');
    year = Number(current[0]); month = Number(current[1]);
  } else {
    year = Number(yearValue); month = Number(monthValue);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Bulan kalender tidak valid.');
  }
  const monthKey = String(year) + '-' + ('0' + month).slice(-2);
  const isAdmin = session.role === 'admin' || session.role === 'super_admin';
  const cache = CacheService.getScriptCache();
  const cacheKey = agendaMonthCacheKey_(year, month, isAdmin);
  let events = null;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { const parsed = JSON.parse(cached); if (Array.isArray(parsed)) events = parsed; } catch (ignore) {}
  }
  if (!events) {
    events = (agendaSheet ? getSheetData_(SHEET_AGENDA) : []).map(function (row) {
      const date = agendaDateKey_(row.Tanggal);
      const active = String(row.StatusAgenda || 'Aktif') !== 'Diarsipkan';
      return {
        id: String(row.ID || ''), date: date, startTime: agendaTimeKey_(row.JamMulai), endTime: agendaTimeKey_(row.JamSelesai),
        title: String(row.Judul || ''), location: String(row.Lokasi || ''), detail: String(row.Detail || ''), active: active
      };
    }).filter(function (event) {
      return event.id && event.date.indexOf(monthKey) === 0 && event.active;
    }).sort(function (a, b) {
      return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title);
    });
    try { cache.put(cacheKey, JSON.stringify(events), 60); } catch (ignore) {}
  }
  let holidays = [];
  try { holidays = getHolidaysForMonth_(year, month); } catch (err) { writeApplicationError_('getHolidaysForMonth_', err, session.username); }
  return {
    success: true, year: year, month: month, monthKey: monthKey, events: events, holidays: holidays,
    isAdmin: isAdmin, serverTimeMs: now.getTime(), serverToday: Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd'), timeZone: 'Asia/Jakarta'
  };
}

function saveAgenda(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  payload = payload || {};
  const id = String(payload.id || '').trim();
  const date = String(payload.date || '').trim();
  const startTime = String(payload.startTime || '').trim();
  const endTime = String(payload.endTime || '').trim();
  const title = validateString_(payload.title, 'Judul agenda', 1, 120);
  const location = String(payload.location || '').trim();
  const detail = String(payload.detail || '').trim();
  if (id.length > 80) return { success: false, message: 'ID agenda tidak valid.' };
  if (!isValidAgendaDate_(date)) return { success: false, message: 'Tanggal agenda tidak valid.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return { success: false, message: 'Jam mulai harus diisi dengan format HH:mm.' };
  if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return { success: false, message: 'Jam selesai tidak valid.' };
  if (endTime && endTime <= startTime) return { success: false, message: 'Jam selesai harus setelah jam mulai pada tanggal yang sama.' };
  if (location.length > 120 || detail.length > 1200) return { success: false, message: 'Lokasi atau rincian agenda melebihi batas karakter.' };
  const sheet = getAgendaSheet_();
  return withScriptLock_(function () {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const sheetValues = sheet.getDataRange().getValues();
    const idCol = headers.indexOf('ID');
    let index = -1;
    if (id && idCol >= 0) {
      for (let i = 1; i < sheetValues.length; i++) if (String(sheetValues[i][idCol] || '') === id) { index = i - 1; break; }
    }
    if (id && index < 0) return { success: false, message: 'Agenda tidak ditemukan.' };
    const existing = {};
    if (index >= 0) headers.forEach(function (header, col) { existing[header] = sheetValues[index + 1][col]; });
    const eventId = id || Utilities.getUuid();
    const now = new Date();
    const rowData = {
      ID: eventId, Tanggal: sheetText_(date), JamMulai: sheetText_(startTime), JamSelesai: sheetText_(endTime),
      Judul: sheetText_(title), Lokasi: sheetText_(location), Detail: sheetText_(detail),
      StatusAgenda: sheetText_(String(existing.StatusAgenda || 'Aktif')),
      CreatedAt: existing.CreatedAt || now, CreatedBy: sheetTextKeep_(existing.CreatedBy) || sheetText_(session.username),
      UpdatedAt: now, UpdatedBy: sheetText_(session.username)
    };
    const row = headers.map(function (header) {
      return Object.prototype.hasOwnProperty.call(rowData, header) ? rowData[header] : (existing[header] === undefined ? '' : sheetTextKeep_(existing[header]));
    });
    writeAgendaRow_(sheet, headers, row, index >= 0 ? index + 2 : null);
    if (index >= 0) invalidateAgendaCacheForDate_(existing.Tanggal);
    invalidateAgendaCacheForDate_(date);
    writeAuditLog_(id ? 'UPDATE_TOWER_AGENDA' : 'CREATE_TOWER_AGENDA', session.username, eventId, title);
    if (!id) queuePush_({ all: true }, { title: 'Agenda baru Tower 2', body: title + ' — ' + formatAgendaDateForPush_(date, startTime), page: 'kalenderKerja' });
    return { success: true, id: eventId, message: id ? 'Agenda berhasil diperbarui.' : 'Agenda berhasil ditambahkan.' };
  });
}

function setAgendaActive(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  const id = String(payload && payload.id || '').trim();
  const active = payload && payload.active === true;
  if (!id || id.length > 80) return { success: false, message: 'ID agenda tidak valid.' };
  const sheet = getAgendaSheet_();
  return withScriptLock_(function () {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const values = sheet.getDataRange().getValues();
    const idCol = headers.indexOf('ID');
    const dateCol = headers.indexOf('Tanggal');
    let rowNumber = -1;
    for (let i = 1; i < values.length; i++) if (String(values[i][idCol] || '') === id) { rowNumber = i + 1; break; }
    const index = rowNumber < 0 ? -1 : rowNumber - 2;
    if (index < 0) return { success: false, message: 'Agenda tidak ditemukan.' };
    const targetDate = values[rowNumber - 1][dateCol];
    const statusCol = headers.indexOf('StatusAgenda') + 1;
    const updatedAtCol = headers.indexOf('UpdatedAt') + 1;
    const updatedByCol = headers.indexOf('UpdatedBy') + 1;
    sheet.getRange(rowNumber, statusCol).setValue(active ? 'Aktif' : 'Diarsipkan');
    sheet.getRange(rowNumber, updatedAtCol).setValue(new Date());
    sheet.getRange(rowNumber, updatedByCol).setValue(sheetText_(session.username));
    invalidateAgendaCacheForDate_(targetDate);
    writeAuditLog_(active ? 'RESTORE_TOWER_AGENDA' : 'ARCHIVE_TOWER_AGENDA', session.username, id, active ? 'Aktif' : 'Diarsipkan');
    return { success: true, message: active ? 'Agenda dipulihkan.' : 'Agenda diarsipkan; riwayat tetap tersimpan.' };
  });
}

function getAgendaProposalSheet_() {
  const headers = ['ID', 'Timestamp', 'Username', 'Nama', 'Judul', 'Tanggal', 'JamMulai', 'JamSelesai', 'Lokasi', 'Detail', 'Status', 'CatatanReview', 'ReviewedAt', 'ReviewedBy', 'AgendaID'];
  return withScriptLock_(function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_AGENDA_PROPOSALS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_AGENDA_PROPOSALS);
      sheet.appendRow(headers);
    } else {
      headers.forEach(function (header) { ensureSheetColumn_(sheet, header); });
    }
    return sheet;
  });
}

function submitAgendaProposal(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident']);
  payload = payload || {};
  const title = validateString_(payload.title, 'Judul agenda', 3, 120);
  const date = String(payload.date || '').trim();
  const startTime = String(payload.startTime || '').trim();
  const endTime = String(payload.endTime || '').trim();
  const location = String(payload.location || '').trim();
  const detail = String(payload.detail || '').trim();
  if (!isValidAgendaDate_(date)) return { success: false, message: 'Tanggal usulan tidak valid.' };
  // v19 (A12): usulan untuk tanggal yang sudah lewat ditolak (zona Asia/Jakarta).
  const todayKey = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  if (date < todayKey) return { success: false, message: 'Tanggal usulan sudah lewat. Pilih hari ini atau tanggal mendatang.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return { success: false, message: 'Jam mulai harus diisi dengan format HH:mm.' };
  if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return { success: false, message: 'Jam selesai tidak valid.' };
  if (endTime && endTime <= startTime) return { success: false, message: 'Jam selesai harus setelah jam mulai.' };
  if (location.length > 120 || detail.length > 1200) return { success: false, message: 'Lokasi atau rincian usulan melebihi batas karakter.' };
  const profile = getSheetData_(SHEET_WARGA).find(function (row) {
    return String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase();
  });
  if (!profile) return { success: false, message: 'Profil warga tidak ditemukan. Lengkapi profil terlebih dahulu.' };
  const name = validateString_(profile.Nama || session.username, 'Nama profil', 1, 120);
  const cache = CacheService.getScriptCache();
  const rateKey = 'agenda-proposal-rate:' + String(session.username || '').toLowerCase();
  if (cache.get(rateKey)) return { success: false, message: 'Tunggu sebentar sebelum mengirim usulan agenda berikutnya.' };
  const sheet = getAgendaProposalSheet_();
  return withScriptLock_(function () {
    if (cache.get(rateKey)) return { success: false, message: 'Tunggu sebentar sebelum mengirim usulan agenda berikutnya.' };
    const id = Utilities.getUuid();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const proposalRecord = {
      ID: sheetText_(id), Timestamp: new Date(), Username: sheetText_(session.username), Nama: sheetText_(name), Judul: sheetText_(title),
      Tanggal: sheetText_(date), JamMulai: sheetText_(startTime), JamSelesai: sheetText_(endTime), Lokasi: sheetText_(location), Detail: sheetText_(detail),
      Status: 'Menunggu Verifikasi', CatatanReview: '', ReviewedAt: '', ReviewedBy: '', AgendaID: ''
    };
    writeAgendaRow_(sheet, headers, headers.map(function (header) { return Object.prototype.hasOwnProperty.call(proposalRecord, header) ? proposalRecord[header] : ''; }));
    cache.put(rateKey, '1', 20);
    writeAuditLog_('SUBMIT_AGENDA_PROPOSAL', session.username, id, title);
    // v19 (A12): kabari admin agar usulan cepat diperiksa.
    queuePush_({ admins: true }, { title: 'Usulan agenda baru', body: title + ' — ' + formatAgendaDateForPush_(date, startTime), page: 'kelolaAgenda', tag: 'agenda-usulan-' + id });
    invalidateAdminNotificationCaches_();
    return { success: true, id: id, message: 'Usulan agenda terkirim dan menunggu pemeriksaan Admin. Agenda belum tampil di kalender.' };
  });
}

function getAgendaManagementData(sessionToken) {
  const session = requireSession_(sessionToken, ['admin', 'super_admin']);
  const agendaSheet = getSheet_(SHEET_AGENDA);
  const proposalSheet = getSheet_(SHEET_AGENDA_PROPOSALS);
  const agenda = (agendaSheet ? getSheetData_(SHEET_AGENDA) : []).map(function (row) {
    return {
      id: String(row.ID || ''), date: agendaDateKey_(row.Tanggal), startTime: agendaTimeKey_(row.JamMulai), endTime: agendaTimeKey_(row.JamSelesai),
      title: String(row.Judul || ''), location: String(row.Lokasi || ''), detail: String(row.Detail || ''), active: String(row.StatusAgenda || 'Aktif') !== 'Diarsipkan'
    };
  }).filter(function (item) { return !!item.id; }).sort(function (a, b) {
    return (a.active === b.active ? 0 : (a.active ? -1 : 1)) || a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime);
  });
  const proposals = (proposalSheet ? getSheetData_(SHEET_AGENDA_PROPOSALS) : []).map(function (row) {
    return {
      id: String(row.ID || ''), username: String(row.Username || ''), name: String(row.Nama || ''), title: String(row.Judul || ''),
      date: agendaDateKey_(row.Tanggal), startTime: agendaTimeKey_(row.JamMulai), endTime: agendaTimeKey_(row.JamSelesai),
      location: String(row.Lokasi || ''), detail: String(row.Detail || ''), status: String(row.Status || 'Menunggu Verifikasi'),
      reviewNote: String(row.CatatanReview || ''), submittedAt: row.Timestamp ? formatTanggal_(row.Timestamp) : '',
      sortTime: row.Timestamp ? new Date(row.Timestamp).getTime() : 0
    };
  }).filter(function (item) { return !!item.id; }).sort(function (a, b) {
    return (a.status === b.status ? 0 : (a.status === 'Menunggu Verifikasi' ? -1 : 1)) || b.sortTime - a.sortTime;
  });
  proposals.forEach(function (item) { delete item.sortTime; });
  return {
    success: true, isSuperAdmin: session.role === 'super_admin', agenda: agenda, proposals: proposals,
    pendingCount: proposals.filter(function (item) { return item.status === 'Menunggu Verifikasi'; }).length
  };
}

function reviewAgendaProposal(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  payload = payload || {};
  const id = validateString_(payload.id, 'ID usulan', 1, 80);
  const decision = String(payload.decision || '').trim();
  const note = String(payload.note || '').trim();
  if (['approve', 'reject'].indexOf(decision) < 0) return { success: false, message: 'Keputusan usulan tidak valid.' };
  if (note.length > 500) return { success: false, message: 'Catatan pemeriksaan maksimal 500 karakter.' };
  const proposalSheet = getSheet_(SHEET_AGENDA_PROPOSALS);
  if (!proposalSheet) return { success: false, message: 'Usulan agenda tidak ditemukan.' };
  const agendaSheet = decision === 'approve' ? getAgendaSheet_() : null;
  return withScriptLock_(function () {
    const proposalHeaders = proposalSheet.getRange(1, 1, 1, proposalSheet.getLastColumn()).getValues()[0].map(String);
    const proposalValues = proposalSheet.getDataRange().getValues();
    const idCol = proposalHeaders.indexOf('ID');
    let rowNumber = -1;
    for (let i = 1; i < proposalValues.length; i++) if (String(proposalValues[i][idCol] || '') === id) { rowNumber = i + 1; break; }
    if (rowNumber < 0) return { success: false, message: 'Usulan agenda tidak ditemukan.' };
    const proposal = {};
    proposalHeaders.forEach(function (header, col) { proposal[header] = proposalValues[rowNumber - 1][col]; });
    if (String(proposal.Status || '') !== 'Menunggu Verifikasi') return { success: false, message: 'Usulan ini sudah pernah diperiksa.' };
    let agendaId = '';
    if (decision === 'approve') {
      const date = agendaDateKey_(proposal.Tanggal);
      const startTime = agendaTimeKey_(proposal.JamMulai);
      const endTime = agendaTimeKey_(proposal.JamSelesai);
      const title = validateString_(proposal.Judul, 'Judul agenda', 3, 120);
      if (!isValidAgendaDate_(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || (endTime && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || endTime <= startTime))) {
        return { success: false, message: 'Data tanggal atau jam pada usulan tidak valid; agenda tidak dipublikasikan.' };
      }
      agendaId = 'proposal-' + id;
      const agendaHeaders = agendaSheet.getRange(1, 1, 1, agendaSheet.getLastColumn()).getValues()[0].map(String);
      const agendaIdCol = agendaHeaders.indexOf('ID');
      const agendaValues = agendaSheet.getDataRange().getValues();
      const alreadyPublished = agendaIdCol >= 0 && agendaValues.slice(1).some(function (row) { return String(row[agendaIdCol] || '') === agendaId; });
      if (!alreadyPublished) {
        const now = new Date();
        const agendaRecord = {
          ID: agendaId, Tanggal: sheetText_(date), JamMulai: sheetText_(startTime), JamSelesai: sheetText_(endTime),
          Judul: sheetText_(title), Lokasi: sheetText_(proposal.Lokasi || ''), Detail: sheetText_(proposal.Detail || ''), StatusAgenda: 'Aktif',
          CreatedAt: now, CreatedBy: sheetText_(session.username), UpdatedAt: now, UpdatedBy: sheetText_(session.username)
        };
        writeAgendaRow_(agendaSheet, agendaHeaders, agendaHeaders.map(function (header) {
          return Object.prototype.hasOwnProperty.call(agendaRecord, header) ? agendaRecord[header] : '';
        }));
      }
      invalidateAgendaCacheForDate_(date);
    }
    const statusCol = proposalHeaders.indexOf('Status') + 1;
    const noteCol = proposalHeaders.indexOf('CatatanReview') + 1;
    const reviewedAtCol = proposalHeaders.indexOf('ReviewedAt') + 1;
    const reviewedByCol = proposalHeaders.indexOf('ReviewedBy') + 1;
    const agendaIdCol = proposalHeaders.indexOf('AgendaID') + 1;
    proposalSheet.getRange(rowNumber, statusCol).setValue(decision === 'approve' ? 'Disetujui' : 'Ditolak');
    proposalSheet.getRange(rowNumber, noteCol).setValue(sheetText_(note));
    proposalSheet.getRange(rowNumber, reviewedAtCol).setValue(new Date());
    proposalSheet.getRange(rowNumber, reviewedByCol).setValue(sheetText_(session.username));
    if (agendaIdCol > 0) proposalSheet.getRange(rowNumber, agendaIdCol).setValue(agendaId);
    writeAuditLog_(decision === 'approve' ? 'APPROVE_AGENDA_PROPOSAL' : 'REJECT_AGENDA_PROPOSAL', session.username, id, note || String(proposal.Judul || ''));
    if (decision === 'approve') queuePush_({ all: true, excludeUsernames: [String(proposal.Username || '')] }, { title: 'Agenda baru Tower 2', body: String(proposal.Judul || '') + ' — ' + formatAgendaDateForPush_(agendaDateKey_(proposal.Tanggal), agendaTimeKey_(proposal.JamMulai)), page: 'kalenderKerja' });
    // v19 (A12): kabari pengusul hasilnya, termasuk catatan admin bila ditolak.
    if (proposal.Username) {
      queuePush_({ usernames: [String(proposal.Username)] }, decision === 'approve'
        ? { title: 'Usulan agenda disetujui', body: String(proposal.Judul || '') + ' sudah tampil di kalender Tower 2.', page: 'kalenderKerja' }
        : { title: 'Usulan agenda belum disetujui', body: String(proposal.Judul || '') + (note ? ' — ' + note : ''), page: 'kalenderKerja' });
    }
    // Notifikasi "Usulan agenda baru" di HP admin lain diganti, dan bulatan diperbarui.
    queuePush_({ admins: true, excludeUsernames: [session.username] }, { title: 'Usulan agenda sudah diperiksa', body: String(proposal.Judul || '') + ' · ' + (decision === 'approve' ? 'disetujui' : 'ditolak') + ' oleh ' + session.username, page: 'kelolaAgenda', tag: 'agenda-usulan-' + id });
    invalidateAdminNotificationCaches_();
    return { success: true, agendaId: agendaId, message: decision === 'approve' ? 'Usulan disetujui dan agenda sekarang tampil di kalender.' : 'Usulan agenda ditolak.' };
  });
}

// ===================================================================
// v12 — PEMBERSIHAN OTOMATIS AKUN YANG TIDAK DILENGKAPI
// -------------------------------------------------------------------
// • Akun warga yang profilnya belum lengkap 7 hari setelah daftar dihapus
//   otomatis setiap hari sekitar pukul 02.00 WIB.
// • Hari ke-5: pengingat lewat notifikasi push (bila warga memasang APK).
// • Sebelum dihapus, baris akun disalin utuh ke sheet tersembunyi
//   ArsipAkunDihapus, sehingga bisa dipulihkan manual bila keliru.
// • Akun Admin/SuperAdmin dan akun yang profilnya lengkap tidak pernah disentuh.
// • Akun lama tanpa tanggal daftar diberi tanggal saat pembersihan pertama
//   berjalan, jadi mereka tetap mendapat 7 hari penuh.
// • SystemConfig KEY "PembersihanAkun": aktif (bawaan) | uji (hanya mencatat,
//   tidak menghapus) | mati.
// Aktifkan sekali: jalankan fungsi aktifkanOtomatisasiTT2 dari editor Apps Script.
// ===================================================================
const WARGA_REGISTERED_COL = 'TerdaftarPada';
const WARGA_REMINDER_COL = 'PengingatProfil';
const SHEET_ACCOUNT_ARCHIVE = 'ArsipAkunDihapus';
const ACCOUNT_CLEANUP_DAYS = 7;
const ACCOUNT_REMINDER_DAYS = 5;
const DAY_MS_ = 24 * 60 * 60 * 1000;

function isProfileCompleteValue_(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function getCleanupMode_() {
  const raw = String(getSystemConfig_().PembersihanAkun || '').trim().toLowerCase();
  if (raw === 'mati' || raw === 'off' || raw === 'false') return 'mati';
  if (raw === 'uji' || raw === 'test') return 'uji';
  return 'aktif';
}

// Batas waktu melengkapi profil (ISO) untuk ditampilkan saat login; '' bila tidak berlaku.
function getProfileDeadline_(userRow) {
  if (!userRow || isProfileCompleteValue_(userRow.ProfileComplete)) return '';
  if (getCleanupMode_() !== 'aktif') return '';
  const registered = new Date(userRow[WARGA_REGISTERED_COL]);
  if (!userRow[WARGA_REGISTERED_COL] || isNaN(registered.getTime())) return '';
  return new Date(registered.getTime() + ACCOUNT_CLEANUP_DAYS * DAY_MS_).toISOString();
}

function getAdminUsernameSet_() {
  const set = {};
  set[String(getSuperAdminConfig_().username || '').toLowerCase()] = true;
  getAdminUsernamesCached_().forEach(function (name) { set[name] = true; });
  return set;
}

function getAccountArchiveSheet_(headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_ACCOUNT_ARCHIVE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ACCOUNT_ARCHIVE);
    sheet.getRange(1, 1, 1, headers.length + 2).setValues([['DihapusPada', 'Alasan'].concat(headers)]);
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (ignore) {}
  }
  return sheet;
}

// Inti pembersihan. options.now (ms) hanya untuk pengujian.
function runAccountCleanup_(options) {
  const mode = getCleanupMode_();
  const report = { mode: mode, stamped: 0, reminded: 0, deleted: [], wouldDelete: [] };
  if (mode === 'mati') return report;
  const now = (options && options.now) || Date.now();
  withScriptLock_(function () {
    const sheet = getSheet_(SHEET_WARGA);
    const registeredCol = ensureSheetColumn_(sheet, WARGA_REGISTERED_COL);
    const reminderCol = ensureSheetColumn_(sheet, WARGA_REMINDER_COL);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const userCol = headers.indexOf('Username');
    const completeCol = headers.indexOf('ProfileComplete');
    if (userCol < 0 || completeCol < 0) throw new Error('Kolom Username/ProfileComplete tidak ditemukan di WargaBaru.');
    const admins = getAdminUsernameSet_();
    const toDelete = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const username = String(row[userCol] || '').trim();
      if (!username || admins[username.toLowerCase()] || isProfileCompleteValue_(row[completeCol])) continue;
      const registeredValue = row[registeredCol - 1];
      const registered = registeredValue ? new Date(registeredValue).getTime() : NaN;
      if (!registeredValue || isNaN(registered)) {
        sheet.getRange(i + 1, registeredCol).setValue(new Date(now));
        report.stamped++;
        continue;
      }
      const ageDays = (now - registered) / DAY_MS_;
      if (ageDays >= ACCOUNT_CLEANUP_DAYS) {
        toDelete.push({ rowNumber: i + 1, username: username, row: row });
      } else if (ageDays >= ACCOUNT_REMINDER_DAYS && !row[reminderCol - 1] && mode === 'aktif') {
        const deadline = new Date(registered + ACCOUNT_CLEANUP_DAYS * DAY_MS_);
        queuePush_({ usernames: [username] }, {
          title: 'Lengkapi profil Anda',
          body: 'Akun Teras Tower 2 Anda akan dihapus otomatis pada ' +
            Utilities.formatDate(deadline, 'Asia/Jakarta', 'dd/MM/yyyy') + ' bila profil belum dilengkapi.',
          page: 'profil'
        });
        sheet.getRange(i + 1, reminderCol).setValue(new Date(now));
        report.reminded++;
      }
    }
    if (mode === 'uji') {
      report.wouldDelete = toDelete.map(function (item) { return item.username; });
      if (toDelete.length) writeAuditLog_('CLEANUP_UJI', 'sistem', '', 'Akan dihapus: ' + report.wouldDelete.join(', '));
      return;
    }
    if (!toDelete.length) return;
    const archive = getAccountArchiveSheet_(values[0]);
    // Hapus dari baris paling bawah agar nomor baris di atasnya tidak bergeser.
    toDelete.sort(function (a, b) { return b.rowNumber - a.rowNumber; }).forEach(function (item) {
      archive.appendRow([new Date(now), 'Profil tidak dilengkapi dalam ' + ACCOUNT_CLEANUP_DAYS + ' hari'].concat(item.row.map(sheetTextKeep_)));
      sheet.deleteRow(item.rowNumber);
      bumpSessionVersion_(item.username);
      removePushTokensForUser_(item.username);
      writeAuditLog_('CLEANUP_HAPUS_AKUN', 'sistem', item.username, 'Profil tidak dilengkapi dalam ' + ACCOUNT_CLEANUP_DAYS + ' hari');
      report.deleted.push(item.username);
    });
  });
  return report;
}

// ===================================================================
// v18 — HAPUS AKUN MANDIRI (syarat Google Play: "Account deletion")
// -------------------------------------------------------------------
// Warga menghapus akunnya sendiri dari Profil, setelah mengetik ulang PIN dan
// kata HAPUS. Yang terjadi, dalam satu kunci tulis:
//   • Baris akun di WargaBaru dihapus; di ArsipAkunDihapus hanya dicatat
//     waktu, alasan, dan username (TANPA nama, nomor WA, unit, atau PIN).
//   • Sesi, token notifikasi, simpanan Jelajah, permintaan reset PIN, dan
//     status baca notifikasi dihapus.
//   • Isi yang sudah dibagikan ke pengelola/warga lain (aspirasi, ulasan,
//     rekomendasi Jelajah, masukan, skor kepuasan, usulan agenda) TETAP ada
//     sebagai catatan pengelolaan, tetapi identitasnya dihapus: nama diganti
//     "Warga (akun dihapus)", username/WA/unit dikosongkan.
//   • AuditLog tetap disimpan (catatan keamanan), sesuai kebijakan privasi.
// Akun Admin/Super Admin tidak bisa menghapus dirinya sendiri di sini.
// ===================================================================
const DELETED_ACCOUNT_LABEL = 'Warga (akun dihapus)';

// v19: inisial nama, mis. "Budi Santoso" -> "B.S.".
function nameInitials_(name) {
  const parts = String(name || '').replace(/[^A-Za-z\u00C0-\u024F ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 3).map(function (p) { return p.charAt(0).toUpperCase() + '.'; }).join('');
}

// v19: menyandikan data pribadi satu arah (HMAC-SHA256 dengan kunci rahasia proyek).
// Hasilnya tidak bisa dibaca kembali, tetapi nilai yang sama selalu menghasilkan sandi
// yang sama, sehingga pengurus masih bisa mengenali laporan dari nomor/unit yang sama.
function sealPersonalValue_(value, kind) {
  let text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (kind === 'wa') text = normalizeWhatsAppNumber_(text) || text.replace(/[^0-9]/g, '');
  else text = text.toLowerCase();
  const bytes = Utilities.computeHmacSha256Signature(kind + ':' + text, getPinHashPepper_() + ':data', Utilities.Charset.UTF_8);
  return 'enc:' + bytes.slice(0, 8).map(function (b) { const v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function deletedAccountLabel_(name) {
  const initials = nameInitials_(name);
  return initials ? 'Warga ' + initials + ' (akun dihapus)' : DELETED_ACCOUNT_LABEL;
}

// Mengubah atau menghapus baris milik username di satu sheet. changes: {Header: nilaiBaru}
// atau null untuk menghapus barisnya. Mengembalikan jumlah baris yang tersentuh.
// v19: lapisan kedua di samping kunci tulis — tepat sebelum menulis/menghapus, baca ulang
// username di baris itu. Bila sudah bergeser (mis. sheet diurutkan manual di Google Sheets
// saat aplikasi berjalan), batalkan daripada mengubah baris warga lain.
function assertRowOwner_(sheet, rowNumber, usernameCol, username) {
  const actual = String(sheet.getRange(rowNumber, usernameCol + 1).getValue() || '').trim().toLowerCase();
  if (actual !== String(username || '').trim().toLowerCase()) {
    throw new Error('Data berubah saat sedang disimpan. Muat ulang lalu coba lagi.');
  }
}

function scrubUserRows_(sheetName, usernameHeader, username, changes) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const userCol = headers.indexOf(usernameHeader);
  if (userCol < 0) return 0;
  const target = String(username || '').trim().toLowerCase();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][userCol] || '').trim().toLowerCase() === target) rows.push(i);
  }
  if (!rows.length) return 0;
  if (changes === null) {
    rows.sort(function (a, b) { return b - a; }).forEach(function (i) { sheet.deleteRow(i + 1); });
    return rows.length;
  }
  // Tulis hanya sel yang berubah. Menulis ulang baris utuh dari getValues() berbahaya:
  // apostrof pelindung (sheetText_) sudah hilang saat dibaca, sehingga teks "=..." bisa
  // menjadi rumus dan "0812..." kehilangan angka nol.
  // changes boleh berupa fungsi(rowObj) → {Header: nilai}, untuk nilai yang bergantung pada isi baris.
  rows.forEach(function (i) {
    let rowChanges = changes;
    if (typeof changes === 'function') {
      const obj = {}; headers.forEach(function (h, c) { obj[h] = values[i][c]; });
      rowChanges = changes(obj) || {};
    }
    Object.keys(rowChanges).forEach(function (header) {
      const col = headers.indexOf(header);
      if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(rowChanges[header]);
    });
  });
  return rows.length;
}

function deleteMyAccount(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const username = String(session.username || '').trim();
  if (session.role !== 'resident' || isAdminUsername_(username)) {
    return { success: false, message: 'Akun pengurus tidak bisa dihapus dari sini. Minta Super Admin mencabut akses admin Anda terlebih dahulu.' };
  }
  if (String(payload.konfirmasi || '').trim().toUpperCase() !== 'HAPUS') return { success: false, message: 'Ketik HAPUS untuk mengonfirmasi.' };
  const pin = String(payload.pin || '').trim();
  if (!/^\d{6}$/.test(pin)) return { success: false, message: 'Masukkan PIN 6 angka Anda.' };
  if (isLoginRateLimited_(username)) return { success: false, message: 'Terlalu banyak percobaan. Coba lagi dalam 10 menit.' };
  try {
    return withScriptLock_(function () {
      const wargaSheet = getSheet_(SHEET_WARGA);
      const values = wargaSheet.getDataRange().getValues();
      const headers = values[0].map(String);
      const userCol = headers.indexOf('Username');
      const pinCol = headers.indexOf('PIN');
      let rowIndex = -1;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][userCol] || '').trim().toLowerCase() === username.toLowerCase()) { rowIndex = i; break; }
      }
      if (rowIndex < 0) return { success: false, message: 'Akun tidak ditemukan.' };
      if (!verifyStoredPin_(pin, values[rowIndex][pinCol])) {
        recordLoginFailure_(username);
        writeAuditLog_('DELETE_OWN_ACCOUNT_FAILED', username, username, 'PIN salah');
        return { success: false, message: 'PIN salah.' };
      }
      clearLoginFailures_(username);

      const label = sheetText_(DELETED_ACCOUNT_LABEL);
      const report = {};
      // v19: aspirasi memakai inisial; nomor WA dan unit disandikan satu arah.
      report.aspirasi = scrubUserRows_(SHEET_DATA, 'Username', username, function (row) {
        return { Username: '', Email_Pengisi: '', Nama: sheetText_(deletedAccountLabel_(row.Nama)),
          Nomor_WhatsApp: sealPersonalValue_(row.Nomor_WhatsApp, 'wa'), Unit: sealPersonalValue_(row.Unit, 'unit') };
      });
      report.jelajah = scrubUserRows_(SHEET_JELAJAH, 'Username', username, { Username: '', NamaPengirim: label });
      report.ulasan = scrubUserRows_(SHEET_JELAJAH_ULASAN, 'Username', username, { Username: '', NamaPengulas: label });
      report.laporanJelajah = scrubUserRows_(SHEET_JELAJAH_LAPORAN, 'Username', username, { Username: '', NamaPelapor: label });
      report.masukan = scrubUserRows_(SHEET_APPFEEDBACK, 'Username', username, { Username: '', Nama: label });
      report.kepuasan = scrubUserRows_(SHEET_KEPUASAN, 'Username', username, { Username: '' });
      report.usulanAgenda = scrubUserRows_(SHEET_AGENDA_PROPOSALS, 'Username', username, { Username: '', Nama: label });
      report.favorit = scrubUserRows_(SHEET_JELAJAH_FAVORIT, 'Username', username, null);
      report.dukunganAspirasi = scrubUserRows_(SHEET_ASPIRASI_DUKUNGAN, 'Username', username, null);
      // Apresiasi tetap tampil tanpa pengirim; dukungan pengguna ini dihapus.
      report.apresiasi = scrubUserRows_(SHEET_APRESIASI, 'Username', username, { Username: '' });
      report.dukunganApresiasi = scrubUserRows_(SHEET_APRESIASI_DUKUNGAN, 'Username', username, null);
      report.resetPin = scrubUserRows_(SHEET_RESETREQUESTS, 'Username', username, null);
      report.statusBaca = scrubUserRows_('NotificationState', 'Username', username, null);
      report.sesi = scrubUserRows_(SHEET_SESSIONS, 'Username', username, null);
      report.tokenNotifikasi = removePushTokensForUser_(username);

      const archive = getAccountArchiveSheet_(values[0]);
      const archiveRow = new Array(headers.length + 2).fill('');
      archiveRow[0] = new Date(); archiveRow[1] = 'Dihapus sendiri oleh pemilik akun'; archiveRow[2 + userCol] = sheetText_(username);
      archive.appendRow(archiveRow);
      wargaSheet.deleteRow(rowIndex + 1);
      bumpSessionVersion_(username);
      writeAuditLog_('DELETE_OWN_ACCOUNT', username, username, JSON.stringify(report));
      return { success: true, message: 'Akun Anda sudah dihapus. Terima kasih telah menggunakan Teras Tower 2.' };
    });
  } catch (err) {
    writeApplicationError_('deleteMyAccount', err, username);
    return { success: false, message: 'Akun belum terhapus: ' + err.message };
  }
}

// Dipanggil pemicu harian. Aman bila terpanggil lebih dari sekali sehari: hasilnya sama.
// v17: hanya boleh berjalan dari pemicu terjadwal proyek ini atau dari editor oleh pemilik.
// Tanpa penjaga ini, siapa pun bisa memanggilnya lewat google.script.run di versi web.
function isTrustedBackgroundCall_(e) {
  try {
    if (e && e.triggerUid) {
      const uid = String(e.triggerUid);
      return ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; });
    }
    const active = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    const effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    return !!active && active === effective;
  } catch (err) {
    return false;
  }
}

function requireTrustedBackgroundCall_(e, name) {
  if (isTrustedBackgroundCall_(e)) return;
  writeAuditLog_('PANGGILAN_DITOLAK', 'anonim', name, 'Fungsi latar dipanggil dari luar pemicu/editor');
  throw new Error('Fungsi ini hanya dapat dijalankan oleh pemicu terjadwal atau pemilik skrip.');
}

function jalankanPembersihanAkunHarian(e) {
  requireTrustedBackgroundCall_(e, 'jalankanPembersihanAkunHarian');
  try {
    const report = runAccountCleanup_();
    console.log('Pembersihan akun: ' + JSON.stringify(report));
    try { report.kapasitas = checkSpreadsheetCapacity_(); } catch (err) { writeApplicationError_('checkSpreadsheetCapacity_', err, 'sistem'); }
    try { report.jelajahTitik = withScriptLock_(function () { return fillJelajahCoordinates_(25); }); } catch (err) { writeApplicationError_('fillJelajahCoordinates_', err, 'sistem'); }
    try { report.logNotifikasiDipangkas = withScriptLock_(pruneNotificationLog_); } catch (err) { writeApplicationError_('pruneNotificationLog_', err, 'sistem'); }
    try { report.idAspirasi = withScriptLock_(repairAspirasiIds_); } catch (err) { writeApplicationError_('repairAspirasiIds_', err, 'sistem'); }
    try { report.retensi = withScriptLock_(applyDataRetention_); } catch (err) { writeApplicationError_('applyDataRetention_', err, 'sistem'); }
    try {
      const fp = PropertiesService.getScriptProperties();
      if (fp.getProperty('FAQ_SEEDED') === '1' && fp.getProperty('FAQ_V19') !== '1') { withScriptLock_(ensureFaqSheet_); report.faqV19 = true; }
    } catch (err) { writeApplicationError_('ensureFaqSheet_', err, 'sistem'); }
    return report;
  } catch (err) {
    writeApplicationError_('jalankanPembersihanAkunHarian', err, 'sistem');
    throw err;
  }
}

// Jalankan SEKALI dari editor Apps Script (pilih fungsi ini lalu klik Jalankan).
// Membuat pemicu harian pembersihan akun dan sekaligus meminta izin yang
// dibutuhkan notifikasi push (akses ke layanan eksternal).
function aktifkanOtomatisasiTT2(e) {
  requireTrustedBackgroundCall_(e, 'aktifkanOtomatisasiTT2');
  const handler = 'jalankanPembersihanAkunHarian';
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(handler).timeBased().everyDays(1).atHour(2).inTimezone('Asia/Jakarta').create();
  const fcm = getFcmConfig_();
  let fcmStatus = 'belum diatur (Script Property FCM_SERVICE_ACCOUNT kosong)';
  if (fcm) {
    try { getFcmAccessToken_(true); fcmStatus = 'tersambung ke proyek ' + fcm.project_id; }
    catch (err) { fcmStatus = 'GAGAL: ' + err.message; }
  }
  const message = 'Pemicu pembersihan harian aktif (sekitar 02.00 WIB), mode: ' + getCleanupMode_() + '. Notifikasi push: ' + fcmStatus + '.';
  console.log(message);
  return message;
}

// ===================================================================
// v12 — NOTIFIKASI PUSH (Firebase Cloud Messaging HTTP v1)
// -------------------------------------------------------------------
// • Token perangkat disimpan di sheet tersembunyi PushTokens.
// • Kunci service account Firebase disimpan di Script Properties dengan nama
//   FCM_SERVICE_ACCOUNT (isi file JSON utuh). Tidak pernah di repo/sheet.
//   Bila belum diatur, semua fungsi tetap berjalan; notifikasi tidak terkirim.
// • queuePush_ hanya mengantrekan; pengiriman terjadi setelah kunci skrip
//   dilepas (withScriptLock_) atau lewat flushPushQueue_.
// • Kegagalan kirim tidak pernah menggagalkan aksi utama (simpan aspirasi dll.).
// ===================================================================
const SHEET_PUSH_TOKENS = 'PushTokens';
const PUSH_TOKEN_HEADERS = ['Token', 'Username', 'Platform', 'UpdatedAt'];
const PUSH_MAX_TOKENS_PER_USER = 5;
const PUSH_CHANNEL_ID = 'tt2_umum';
let PUSH_QUEUE_ = [];
let PUSH_FLUSHING_ = false;

function getPushTokenSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PUSH_TOKENS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PUSH_TOKENS);
    sheet.getRange(1, 1, 1, PUSH_TOKEN_HEADERS.length).setValues([PUSH_TOKEN_HEADERS]);
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (ignore) {}
  }
  return sheet;
}

function readPushTokens_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PUSH_TOKENS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, PUSH_TOKEN_HEADERS.length).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) { return { token: String(row[0]), username: String(row[1] || ''), platform: String(row[2] || '') }; });
}

// Tanpa kunci: pemanggil yang menentukan (lihat catatan kunci bersarang di atas).
function removePushTokensWhere_(predicate) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PUSH_TOKENS);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, PUSH_TOKEN_HEADERS.length).getValues();
  let removed = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (predicate(values[i])) { sheet.deleteRow(i + 2); removed++; }
  }
  return removed;
}
function removePushTokensForUser_(username) {
  const target = String(username || '').toLowerCase();
  if (!target) return 0;
  return removePushTokensWhere_(function (row) { return String(row[1] || '').toLowerCase() === target; });
}

function validatePushToken_(token) {
  const value = String(token || '').trim();
  if (value.length < 20 || value.length > 4096 || !/^[A-Za-z0-9:_\-]+$/.test(value)) throw new Error('Token notifikasi tidak valid.');
  return value;
}

// Dipanggil aplikasi setelah login & izin notifikasi diberikan.
function registerPushToken(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const token = validatePushToken_(payload && payload.token);
  const platform = String(payload && payload.platform || 'android').toLowerCase() === 'ios' ? 'ios' : (String(payload && payload.platform || '').toLowerCase() === 'web' ? 'web' : 'android');
  return withScriptLock_(function () {
    const sheet = getPushTokenSheet_();
    // Satu perangkat = satu token. Bila perangkat dipakai akun lain, pemiliknya diganti.
    removePushTokensWhere_(function (row) { return String(row[0]) === token; });
    sheet.appendRow([token, sheetText_(session.username), platform, new Date()]);
    // Batasi jumlah perangkat per akun: hapus yang paling lama.
    const mine = readPushTokens_().filter(function (item) { return item.username.toLowerCase() === session.username.toLowerCase(); });
    if (mine.length > PUSH_MAX_TOKENS_PER_USER) {
      const drop = mine.slice(0, mine.length - PUSH_MAX_TOKENS_PER_USER).map(function (item) { return item.token; });
      removePushTokensWhere_(function (row) { return drop.indexOf(String(row[0])) >= 0; });
    }
    return { success: true };
  });
}

// Dipanggil aplikasi saat keluar, agar perangkat tidak menerima notifikasi akun itu lagi.
function unregisterPushToken(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const token = validatePushToken_(payload && payload.token);
  return withScriptLock_(function () {
    removePushTokensWhere_(function (row) {
      return String(row[0]) === token && String(row[1] || '').toLowerCase() === session.username.toLowerCase();
    });
    return { success: true };
  });
}

// target: { all: true } | { admins: true } | { usernames: ['a','b'] }
// message: { title, body, page }
function queuePush_(target, message) {
  PUSH_QUEUE_.push({ target: target || {}, message: message || {} });
  if (SCRIPT_LOCK_DEPTH_ === 0) flushPushQueue_();
}

function getFcmConfig_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return parsed;
  } catch (err) { return null; }
}

function base64UrlJson_(value) {
  return Utilities.base64EncodeWebSafe(JSON.stringify(value)).replace(/=+$/, '');
}

// Token akses OAuth untuk FCM, disimpan di cache 50 menit (berlaku 60 menit).
function getFcmAccessToken_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get('fcm-access-token');
    if (cached) return cached;
  }
  const config = getFcmConfig_();
  if (!config) throw new Error('FCM_SERVICE_ACCOUNT belum diatur.');
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenUri = config.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = base64UrlJson_({ alg: 'RS256', typ: 'JWT' }) + '.' + base64UrlJson_({
    iss: config.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri, iat: nowSec, exp: nowSec + 3600
  });
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, config.private_key)).replace(/=+$/, '');
  const response = UrlFetchApp.fetch(tokenUri, {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }
  });
  if (response.getResponseCode() !== 200) throw new Error('Gagal mendapat token Firebase: HTTP ' + response.getResponseCode() + ' ' + response.getContentText().substring(0, 200));
  const accessToken = JSON.parse(response.getContentText()).access_token;
  cache.put('fcm-access-token', accessToken, 3000);
  return accessToken;
}

function resolvePushRecipients_(target, allTokens, adminSet) {
  if (target.platform) allTokens = allTokens.filter(function (item) { return (item.platform || 'android') === target.platform; });
  if (target.excludeUsernames && target.excludeUsernames.length) {
    const skip = {};
    target.excludeUsernames.forEach(function (name) { skip[String(name || '').toLowerCase()] = true; });
    allTokens = allTokens.filter(function (item) { return !skip[String(item.username || '').toLowerCase()]; });
  }
  if (target.all) return allTokens;
  if (target.admins) return allTokens.filter(function (item) { return adminSet[item.username.toLowerCase()]; });
  const wanted = {};
  (target.usernames || []).forEach(function (name) { wanted[String(name || '').toLowerCase()] = true; });
  return allTokens.filter(function (item) { return wanted[item.username.toLowerCase()]; });
}

function buildFcmMessage_(token, message) {
  const data = { page: String(message.page || 'beranda') };
  if (message.url && /^https:\/\//.test(message.url)) data.url = String(message.url);
  return {
    message: {
      token: token,
      notification: { title: String(message.title || 'Teras Tower 2').substring(0, 100), body: String(message.body || '').substring(0, 400) },
      data: data,
      android: { priority: 'HIGH', notification: Object.assign({ channel_id: PUSH_CHANNEL_ID, icon: 'ic_stat_tt2', color: '#0E9CBF' }, message.tag ? { tag: String(message.tag).substring(0, 64) } : {}) },
      apns: Object.assign({ payload: { aps: { sound: 'default' } } }, message.tag ? { headers: { 'apns-collapse-id': String(message.tag).substring(0, 64) } } : {})
    }
  };
}

// Mengirim semua notifikasi yang diantrekan. Tidak pernah melempar error.
function flushPushQueue_() {
  if (PUSH_FLUSHING_ || !PUSH_QUEUE_.length) return { sent: 0, failed: 0 };
  PUSH_FLUSHING_ = true;
  const queue = PUSH_QUEUE_;
  PUSH_QUEUE_ = [];
  const result = { sent: 0, failed: 0, removed: 0 };
  // v18 (A5): hitungan per notifikasi untuk LogNotifikasi.
  queue.forEach(function (item) { item.stat = { devices: 0, sent: 0, failed: 0, note: '' }; });
  try {
    const config = getFcmConfig_();
    if (!config) { queue.forEach(function (item) { item.stat.note = 'FCM belum diatur'; }); return result; }
    const allTokens = readPushTokens_();
    if (!allTokens.length) { queue.forEach(function (item) { item.stat.note = 'Belum ada perangkat terdaftar'; }); return result; }
    const needsAdmins = queue.some(function (item) { return item.target.admins; });
    const adminSet = needsAdmins ? getAdminUsernameSet_() : {};
    const accessToken = getFcmAccessToken_();
    const url = 'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(config.project_id) + '/messages:send';
    const jobs = [];
    queue.forEach(function (item) {
      const seen = {};
      resolvePushRecipients_(item.target, allTokens, adminSet).forEach(function (recipient) {
        if (seen[recipient.token]) return;
        seen[recipient.token] = true;
        item.stat.devices++;
        jobs.push({ token: recipient.token, item: item, body: buildFcmMessage_(recipient.token, item.message) });
      });
    });
    const invalid = [];
    for (let start = 0; start < jobs.length; start += 100) {
      const batch = jobs.slice(start, start + 100);
      const responses = UrlFetchApp.fetchAll(batch.map(function (job) {
        return { url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + accessToken }, payload: JSON.stringify(job.body) };
      }));
      responses.forEach(function (response, index) {
        const code = response.getResponseCode();
        if (code === 200) { result.sent++; batch[index].item.stat.sent++; return; }
        result.failed++;
        batch[index].item.stat.failed++;
        const text = response.getContentText();
        if (code === 404 || /UNREGISTERED|registration-token-not-registered/.test(text) ||
            (code === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text))) invalid.push(batch[index].token);
        if (code === 401) CacheService.getScriptCache().remove('fcm-access-token');
      });
    }
    if (invalid.length) {
      withScriptLock_(function () {
        result.removed = removePushTokensWhere_(function (row) { return invalid.indexOf(String(row[0])) >= 0; });
      });
    }
  } catch (err) {
    queue.forEach(function (item) { if (!item.stat.note) item.stat.note = 'Galat: ' + String(err && err.message || err).substring(0, 120); });
    try { writeApplicationError_('flushPushQueue_', err, 'sistem'); } catch (ignore) {}
  } finally {
    try { writeNotificationLog_(queue); } catch (logErr) { try { writeApplicationError_('writeNotificationLog_', logErr, 'sistem'); } catch (ignore) {} }
    PUSH_FLUSHING_ = false;
  }
  return result;
}

// -------------------------------------------------------------------
// v18 (A5) — LOG RIWAYAT NOTIFIKASI
// Sheet tersembunyi LogNotifikasi. Admin melihat notifikasi untuk admin dan
// untuk semua warga; Super Admin melihat semuanya (termasuk ke warga tertentu).
// Disimpan maksimal NOTIF_LOG_MAX_ROWS baris terbaru.
// -------------------------------------------------------------------
const SHEET_NOTIF_LOG = 'LogNotifikasi';
const NOTIF_LOG_HEADERS = ['Waktu', 'Jenis', 'Sasaran', 'Judul', 'Isi', 'Halaman', 'Perangkat', 'Terkirim', 'Gagal', 'Catatan'];
const NOTIF_LOG_MAX_ROWS = 2000;

function describePushTarget_(target) {
  target = target || {};
  const suffix = target.platform ? ' (' + target.platform + ')' : '';
  if (target.all) return { kind: 'semua', text: 'Semua warga' + suffix };
  if (target.admins) return { kind: 'admin', text: 'Admin' + (target.excludeUsernames && target.excludeUsernames.length ? ' (kecuali ' + target.excludeUsernames.join(', ') + ')' : '') + suffix };
  return { kind: 'pribadi', text: (target.usernames || []).join(', ') + suffix };
}

function writeNotificationLog_(queue) {
  if (!queue || !queue.length) return;
  const rows = queue.map(function (item) {
    const target = describePushTarget_(item.target);
    const st = item.stat || { devices: 0, sent: 0, failed: 0, note: '' };
    return [new Date(), target.kind, sheetText_(target.text), sheetText_(String(item.message.title || '').substring(0, 100)),
      sheetText_(String(item.message.body || '').substring(0, 400)), String(item.message.page || ''), st.devices, st.sent, st.failed, sheetText_(st.note || '')];
  });
  // Tanpa withScriptLock_: fungsi ini bisa terpanggil saat kunci masih dipegang
  // (mis. updateTindakLanjut memakai LockService langsung). appendRow aman dipakai bersamaan.
  const sheet = getNotificationLogSheet_();
  rows.forEach(function (row) { sheet.appendRow(row); });
}

function getNotificationLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NOTIF_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NOTIF_LOG);
    sheet.appendRow(NOTIF_LOG_HEADERS);
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (ignore) {}
  }
  return sheet;
}

// Dipanggil pemicu harian (di dalam kunci).
function pruneNotificationLog_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIF_LOG);
  if (!sheet) return 0;
  const extra = sheet.getLastRow() - 1 - NOTIF_LOG_MAX_ROWS;
  if (extra > 0) sheet.deleteRows(2, extra);
  return Math.max(0, extra);
}

function getNotificationLog(sessionToken) {
  const session = requireSession_(sessionToken, ['admin', 'super_admin']);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NOTIF_LOG);
  if (!sheet || sheet.getLastRow() < 2) return { success: true, items: [] };
  const isSuper = session.role === 'super_admin';
  const items = getSheetData_(SHEET_NOTIF_LOG).filter(function (row) {
    return isSuper || String(row.Jenis || '') !== 'pribadi';
  }).slice(-150).reverse().map(function (row) {
    return {
      waktu: row.Waktu ? formatTanggal_(row.Waktu) : '', jenis: String(row.Jenis || ''), sasaran: String(row.Sasaran || ''),
      judul: String(row.Judul || ''), isi: String(row.Isi || ''), halaman: String(row.Halaman || ''),
      perangkat: Number(row.Perangkat) || 0, terkirim: Number(row.Terkirim) || 0, gagal: Number(row.Gagal) || 0, catatan: String(row.Catatan || '')
    };
  });
  return { success: true, items: items, isSuper: isSuper };
}

// ===================================================================
// v12 — PENGUMUMAN PENGURUS
// Disimpan di sheet Pengumuman, dikirim sebagai notifikasi ke semua perangkat,
// dan tampil di Beranda selama 3 hari (untuk warga tanpa APK/notifikasi).
// ===================================================================
const SHEET_PENGUMUMAN = 'Pengumuman';
const PENGUMUMAN_HEADERS = ['ID', 'DikirimPada', 'Judul', 'Isi', 'Oleh', 'Perangkat'];
const PENGUMUMAN_HOME_DAYS = 3;
const PENGUMUMAN_MAX_PER_HOUR = 10;

function getPengumumanSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PENGUMUMAN);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PENGUMUMAN);
    sheet.getRange(1, 1, 1, PENGUMUMAN_HEADERS.length).setValues([PENGUMUMAN_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readPengumuman_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PENGUMUMAN);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, PENGUMUMAN_HEADERS.length).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) {
      const sentAt = new Date(row[1]);
      return { id: String(row[0]), dikirimPada: isNaN(sentAt.getTime()) ? '' : sentAt.toISOString(), judul: String(row[2] || ''),
        isi: String(row[3] || ''), oleh: String(row[4] || ''), perangkat: Number(row[5] || 0) };
    })
    .sort(function (a, b) { return String(b.dikirimPada).localeCompare(String(a.dikirimPada)); });
}

function sendPengumuman(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  if (!isAdminUsername_(session.username)) return { success: false, message: 'Anda tidak memiliki akses.' };
  try {
    const judul = validateString_(payload.judul, 'Judul pengumuman', 3, 80);
    const isi = validateString_(payload.isi, 'Isi pengumuman', 3, 500);
    return withScriptLock_(function () {
      if (isHourlyLimitReached_('pengumuman', PENGUMUMAN_MAX_PER_HOUR)) {
        return { success: false, message: 'Batas ' + PENGUMUMAN_MAX_PER_HOUR + ' pengumuman per jam tercapai. Coba lagi nanti.' };
      }
      const deviceCount = readPushTokens_().length;
      const id = 'PGM-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 1000);
      getPengumumanSheet_().appendRow([id, new Date(), sheetText_(judul), sheetText_(isi), sheetText_(session.username), deviceCount]);
      countHourlyEvent_('pengumuman');
      writeAuditLog_('KIRIM_PENGUMUMAN', session.username, id, judul);
      queuePush_({ all: true }, { title: '📢 ' + judul, body: isi, page: 'beranda' });
      return { success: true, id: id, perangkat: deviceCount, pushAktif: !!getFcmConfig_() };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getPengumumanTerbaru(sessionToken) {
  requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const latest = readPengumuman_()[0];
  if (!latest || !latest.dikirimPada) return { success: true, pengumuman: null };
  const age = Date.now() - new Date(latest.dikirimPada).getTime();
  return { success: true, pengumuman: age <= PENGUMUMAN_HOME_DAYS * DAY_MS_ ? latest : null };
}

function getPengumumanAdmin(sessionToken) {
  const session = requireSession_(sessionToken, ['admin', 'super_admin']);
  if (!isAdminUsername_(session.username)) return { success: false, message: 'Anda tidak memiliki akses.' };
  return { success: true, daftar: readPengumuman_().slice(0, 20), perangkat: readPushTokens_().length, pushAktif: !!getFcmConfig_() };
}

function formatAgendaDateForPush_(date, startTime) {
  const parsed = date instanceof Date ? date : new Date(String(date || '') + 'T00:00:00+07:00');
  const label = isNaN(parsed.getTime()) ? String(date || '') : Utilities.formatDate(parsed, 'Asia/Jakarta', 'dd/MM/yyyy');
  const time = String(startTime || '').trim();
  return label + (time ? ' pukul ' + time : '');
}

// ===================================================================
// v13 — LAPORAN RILIS APK OTOMATIS DARI GITHUB
// -------------------------------------------------------------------
// Workflow GitHub memanggil reportApkRelease setelah APK terlampir di rilis.
// Fungsi ini:
//   1. menulis ApkVersiTerbaru & ApkTautanUnduh di SystemConfig,
//   2. mengirim notifikasi "Versi baru tersedia" ke semua HP Android
//      (warga DAN admin) yang memasang aplikasi.
// Keamanan: GitHub TIDAK memegang akun Google siapa pun. Ia hanya tahu satu
// kata sandi rilis (Script Property RELEASE_SECRET = GitHub Secret
// TT2_RELEASE_SECRET). Tautan unduhan tidak bisa diatur pemanggil (selalu
// tautan tetap di bawah), dan versi harus lebih baru dari yang tercatat,
// jadi kata sandi yang bocor paling jauh hanya bisa memicu satu notifikasi.
// ===================================================================
const APK_DOWNLOAD_URL = 'https://github.com/ryuuzaki-min/Teras-Tower-2-WAP/releases/latest/download/TerasTower2.apk';

function compareVersionStrings_(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function constantTimeEquals_(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// v14: Google Sheets bisa mengubah teks "1.2.0" menjadi TANGGAL. Versi yang tidak
// berbentuk angka.angka.angka dianggap kosong, dan sumber utamanya Script Properties.
function normalizeVersion_(value) {
  const text = value instanceof Date ? '' : String(value == null ? '' : value).trim();
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(text) ? text : '';
}
function getLatestApkInfo_() {
  const props = PropertiesService.getScriptProperties();
  const config = getSystemConfig_();
  const version = normalizeVersion_(props.getProperty('APK_LATEST_VERSION')) || normalizeVersion_(config.ApkVersiTerbaru);
  const url = String(props.getProperty('APK_LATEST_URL') || config.ApkTautanUnduh || '').trim();
  return { version: version, url: /^https:\/\//.test(url) ? url : '' };
}

function reportApkRelease(payload) {
  const expected = PropertiesService.getScriptProperties().getProperty('RELEASE_SECRET');
  if (!expected || expected.length < 24) return { success: false, message: 'RELEASE_SECRET belum diatur di Script Properties.' };
  if (!constantTimeEquals_(payload && payload.secret, expected)) {
    writeAuditLog_('LAPORAN_RILIS_DITOLAK', 'github', '', 'Kata sandi rilis salah');
    return { success: false, message: 'Kata sandi rilis salah.' };
  }
  const version = String(payload && payload.version || '').trim();
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) return { success: false, message: 'Format versi harus angka.angka.angka.' };
  return withScriptLock_(function () {
    const current = getLatestApkInfo_().version;
    if (current && compareVersionStrings_(version, current) <= 0) {
      return { success: true, changed: false, message: 'Versi ' + version + ' tidak lebih baru dari ' + current + '; tidak ada yang diubah.' };
    }
    PropertiesService.getScriptProperties().setProperties({ APK_LATEST_VERSION: version, APK_LATEST_URL: APK_DOWNLOAD_URL });
    // Tanda petik di depan memaksa Sheets menyimpan sebagai teks, bukan tanggal.
    upsertSystemConfigValue_('ApkVersiTerbaru', "'" + version);
    upsertSystemConfigValue_('ApkTautanUnduh', APK_DOWNLOAD_URL);
    writeAuditLog_('RILIS_APK', 'github', version, APK_DOWNLOAD_URL);
    queuePush_({ all: true, platform: 'android' }, {
      title: '⬆️ Versi baru Teras Tower 2',
      body: 'Versi ' + version + ' sudah tersedia. Ketuk untuk mengunduh, lalu pasang di atas aplikasi lama.',
      page: 'beranda',
      url: APK_DOWNLOAD_URL
    });
    return { success: true, changed: true, version: version, url: APK_DOWNLOAD_URL };
  });
}

// v15: isi FAQ bawaan. Dipakai sampai Admin pertama kali mengubah FAQ; setelah itu
// isinya disalin ke sheet "FAQ" dan sheet itulah sumbernya.
const FAQ_DEFAULTS = [
  ["Mengenal aplikasi","warga","Apa itu Teras Tower 2?","Aplikasi warga Tower 2 Wisma Atlet Pademangan untuk menyampaikan aspirasi, menilai layanan, melihat agenda, menghubungi nomor penting, dan berbagi rekomendasi tempat di sekitar. Aplikasi dikelola pengurus Tower 2."],
  ["Mengenal aplikasi","warga","Apa saja isi menu bawah?","Kontak Darurat untuk nomor yang perlu cepat dihubungi. Tombol tengah (Aspirasi) untuk mengirim masukan, kritik, atau pengaduan. Menu berisi semua layanan lain. Logo di kiri atas membawa Anda kembali ke Beranda."],
  ["Mengenal aplikasi","warga","Apa yang tampil di Beranda?","Salam dan jam, pengumuman terbaru dari pengurus, banner kegiatan, agenda terdekat, dan ringkasan kepuasan layanan warga."],
  ["Mengenal aplikasi","warga","Bagaimana memasang aplikasi di HP?","Android: unduh berkas APK dari tautan resmi pengurus, lalu izinkan pemasangan dari sumber tersebut saat diminta. iPhone: buka alamat aplikasi di Safari, tekan tombol Bagikan, lalu pilih “Tambahkan ke Layar Utama”."],
  ["Mengenal aplikasi","warga","Bagaimana saya tahu ada versi baru?","Spanduk kuning muncul di dalam aplikasi dan HP Android menerima notifikasi. Tautan unduhan selalu sama, jadi cukup buka tautan itu lagi lalu pasang di atas versi lama. Data Anda tidak hilang."],
  ["Akun & masuk","warga","Bagaimana cara mendaftar?","Di layar masuk, pilih Daftar. Isi username, PIN 6 angka, dan data diri, lalu lengkapi profil (status di wisma, lantai, unit, dan nomor WhatsApp)."],
  ["Akun & masuk","warga","Kenapa profil harus dilengkapi dalam 7 hari?","Akun yang profilnya belum lengkap 7 hari setelah mendaftar dihapus otomatis supaya data warga tetap rapi. Pengingat muncul beberapa hari sebelumnya. Jika terhapus, Anda bisa mendaftar lagi."],
  ["Akun & masuk","warga","Apa arti “Ingat saya”?","Jika dicentang, Anda tetap masuk selama 30 hari di HP itu. Tanpa centang, sesi berakhir setelah sekitar 6 jam. Jangan centang di HP milik orang lain."],
  ["Akun & masuk","warga","Saya lupa PIN. Apa yang harus dilakukan?","Di layar masuk, tekan “Lupa PIN?” lalu isi username. Admin akan membuat PIN baru dan mengirimkannya ke WhatsApp Anda."],
  ["Akun & masuk","warga","Bisakah saya mengganti PIN sendiri?","Belum. Untuk mengganti PIN, ajukan reset lewat “Lupa PIN?” atau hubungi Admin."],
  ["Akun & masuk","warga","Bagaimana mengubah nomor WhatsApp, lantai, atau unit?","Buka Menu → Profil Saya. Nomor WhatsApp hanya bisa diubah oleh pemilik akun, Admin tidak dapat mengubahnya."],
  ["Aspirasi & riwayat","warga","Apa beda Masukan, Kritik, dan Pengaduan?","Masukan: usulan perbaikan atau ide. Kritik: keberatan terhadap layanan atau kebijakan. Pengaduan: masalah nyata yang perlu ditangani, misalnya fasilitas rusak, kotor, atau tidak aman. Pengaduan bisa disertai foto dan tingkat prioritas."],
  ["Aspirasi & riwayat","warga","Data pelapor diambil dari mana?","Nama, status, lantai, unit, dan nomor WhatsApp diambil dari profil Anda. Untuk mengubahnya, tekan “Ubah di Profil”."],
  ["Aspirasi & riwayat","warga","Apa bedanya lokasi masalah dengan lantai/unit saya?","Lantai dan unit adalah tempat tinggal Anda. Lokasi masalah adalah tempat kejadiannya, misalnya lift, lobi, atau lantai lain."],
  ["Aspirasi & riwayat","warga","Apa arti status di Riwayat?","Dibaca: aspirasi sudah diterima pengurus dan sedang ditangani. Diselesaikan: sudah ditindaklanjuti, kadang disertai catatan dan foto. Ditolak: tidak dapat diproses, alasannya tercantum di kartu aspirasi."],
  ["Aspirasi & riwayat","warga","Apakah saya diberi tahu jika status berubah?","Ya. Aplikasi Android menerima notifikasi, dan tanda angka muncul di menu Riwayat."],
  ["Aspirasi & riwayat","warga","Apa maksud kesediaan swadaya?","Pernyataan bahwa Anda bersedia ikut membantu, misalnya tenaga atau iuran, bila penyelesaiannya membutuhkan peran warga. Tidak wajib."],
  ["Kepuasan layanan","warga","Layanan apa saja yang dinilai?","Pengelola Gedung, Pengelola Parkir, Pengelola Food Court, dan Paguyuban."],
  ["Kepuasan layanan","warga","Bagaimana cara menilai?","Geser slider ke angka 0 (sangat tidak puas) sampai 100 (sangat puas), tambahkan komentar bila perlu, lalu tekan Kirim Penilaian pada layanan tersebut."],
  ["Kepuasan layanan","warga","Berapa kali saya boleh menilai?","Satu kali per layanan setiap minggu. Layanan yang sudah dinilai terkunci sampai minggu berikutnya."],
  ["Kepuasan layanan","warga","Siapa yang melihat penilaian saya?","Pengurus melihat rekap dan komentar untuk perbaikan layanan. Rata-rata seluruh warga tampil di Beranda."],
  ["Kalender kerja","warga","Apa arti warna di kalender?","Merah: hari Minggu dan libur nasional. Jingga: hari Sabtu. Titik jingga: hari peringatan nasional. Titik biru: hari peringatan internasional. Kotak bergaris tebal: hari ini. Daftar hari libur dan peringatan bulan itu tampil di bawah kalender."],
  ["Kalender kerja","warga","Bagaimana melihat detail agenda?","Sentuh tanggalnya. Detail agenda, nama hari libur, atau hari peringatan muncul di jendela kecil."],
  ["Kalender kerja","warga","Bagaimana mengusulkan agenda?","Tekan “+ Usulkan agenda” atau pilih tanggal lalu tekan tombol usulan. Agenda tampil setelah disetujui Admin."],
  ["Kalender kerja","warga","Waktu agenda memakai zona apa?","Semua jam memakai Waktu Indonesia Barat (WIB)."],
  ["Kontak darurat & penting","warga","Apa beda Kontak Darurat dan Kontak Penting?","Kontak Darurat berisi nomor untuk keadaan genting seperti ambulans, pemadam kebakaran, polisi, dan rumah sakit. Kontak Penting berisi nomor sehari-hari di lingkungan Tower 2, misalnya pengelola dan keamanan."],
  ["Kontak darurat & penting","warga","Bagaimana cara menghubungi?","Sentuh kotak kontak, lalu pilih Telepon atau WhatsApp."],
  ["Kontak darurat & penting","warga","Nomornya salah atau sudah tidak aktif?","Sampaikan lewat Aspirasi (jenis Masukan) agar Admin memperbaikinya."],
  ["Jelajah sekitar","warga","Apa itu Jelajah Sekitar?","Kumpulan rekomendasi tempat di sekitar Tower 2 dari sesama warga: kuliner, jasa, kesehatan, fasilitas umum, dan lainnya. Halaman depannya menampilkan tempat yang paling disukai warga dan yang baru ditambahkan."],
  ["Jelajah sekitar","warga","Bagaimana mencari tempat?","Ketik di kolom cari (nama, jenis, tag, atau alamat), atau ketuk kategori. Hasil bisa diurutkan berdasarkan rating, jarak terdekat dari Tower 2, atau yang terbaru, dan disaring hanya yang Terverifikasi."],
  ["Jelajah sekitar","warga","Bagaimana memberi rekomendasi?","Pilih Beri rekomendasi. Langkah 1: cari nama tempat atau alamatnya, pilih hasil yang tepat, lalu geser titik di peta bila perlu. Bisa juga memakai lokasi Anda saat sedang berada di sana. Langkah 2: pilih kategori dan jenis, ceritakan tempatnya, lalu kirim. Tidak perlu membuka Google Maps."],
  ["Jelajah sekitar","warga","Tempatnya tidak ditemukan saat dicari. Bagaimana?","Tempat kecil kadang belum terdaftar di Google. Geser atau ketuk titik di peta tepat di lokasinya, lalu tulis namanya di langkah 2. Anda juga bisa menempel tautan Google Maps lewat pilihan di bawah peta."],
  ["Jelajah sekitar","warga","Apa arti angka 1–5 pada kisaran harga?","Perkiraan harga per orang: 1 = di bawah Rp15 ribu, 2 = Rp15–30 ribu, 3 = Rp30–50 ribu, 4 = Rp50–100 ribu, 5 = di atas Rp100 ribu. Boleh dikosongkan."],
  ["Jelajah sekitar","warga","Bagaimana memberi rating dan ulasan?","Buka detail tempat, pilih bintang, dan tulis komentar. Setiap akun punya satu ulasan per tempat dan bisa mengubahnya kapan saja."],
  ["Jelajah sekitar","warga","Apa fungsi tombol Simpan, Bagikan ke WA, dan Rute?","Simpan menaruh tempat di daftar Simpanan saya. Bagikan ke WA mengirim nama, rating, alamat, dan tautan lokasi lewat WhatsApp. Rute membuka petunjuk arah di Google Maps."],
  ["Jelajah sekitar","warga","Infonya salah atau tempatnya sudah tutup. Apa yang harus dilakukan?","Buka detail tempat, tekan Laporkan, pilih alasannya, lalu kirim. Admin langsung mendapat notifikasi untuk memeriksanya."],
  ["Jelajah sekitar","warga","Bisakah mengubah rekomendasi yang sudah saya kirim?","Bisa. Buka detail tempat yang Anda kirim, lalu tekan Ubah rekomendasi saya."],
  ["Jelajah sekitar","warga","Kenapa muncul peringatan tempat dengan nama mirip?","Supaya satu tempat tidak tercatat dua kali. Bila tempatnya sama, beri ulasan di tempat yang sudah ada. Bila memang berbeda, lanjutkan saja."],
  ["Jelajah sekitar","warga","Apa arti tanda Terverifikasi?","Tempat tersebut sudah diperiksa Admin, misalnya lokasi dan namanya sudah dicocokkan."],
  ["Notifikasi & masukan aplikasi","warga","Kenapa saya tidak menerima notifikasi?","Notifikasi hanya untuk aplikasi Android versi terbaru. Pastikan izin notifikasi diaktifkan saat diminta. Pengguna iPhone dan browser tetap bisa melihat pengumuman di Beranda."],
  ["Notifikasi & masukan aplikasi","warga","Berapa lama pengumuman tampil di Beranda?","Pengumuman pengurus tampil di Beranda selama 3 hari."],
  ["Notifikasi & masukan aplikasi","warga","Apa beda Masukan Pengembangan dengan Aspirasi?","Masukan Pengembangan khusus untuk aplikasi ini, misalnya ide fitur, tampilan, atau kendala, dan dibaca Super Admin. Masalah di gedung atau layanan disampaikan lewat Aspirasi. Status masukan bisa dilihat di tab Riwayat Saya."],
  ["Untuk Admin","admin","Apa isi Kartu Pengelolaan?","Semua menu pengelolaan: warga, aspirasi, kepuasan, agenda, pengumuman, nomor penting dan darurat, Jelajah, FAQ, serta log. Tombol Layanan di menu bawah membuka layanan yang sama seperti yang dilihat warga, termasuk Profil dan halaman Bantuan & FAQ ini."],
  ["Untuk Admin","admin","Bagaimana menindaklanjuti aspirasi?","Buka Kelola Aspirasi, pilih aspirasi, ubah statusnya, lalu isi catatan tindak lanjut (dan foto bila ada). Pengirim otomatis mendapat notifikasi saat status berubah. Aspirasi prioritas tinggi atau yang lebih dari 7 hari belum selesai ikut disorot di Perlu Tindakan."],
  ["Untuk Admin","admin","Bagaimana mereset PIN warga?","Buka Kelola Warga, lalu tekan tombol 📨 pada warga tersebut. Sistem membuat PIN acak baru dan membuka draf WhatsApp berisi PIN itu. Pesan tidak terkirim otomatis, periksa dulu lalu kirim."],
  ["Untuk Admin","admin","Apa arti “Data warga perlu diverifikasi”?","Ada isian lantai/unit yang tidak wajar, misalnya nomor unit tidak sesuai lantainya. Periksa dan perbaiki di Kelola Warga."],
  ["Untuk Admin","admin","Bagaimana mengirim pengumuman?","Buka Kirim Pengumuman, isi judul dan isi. Pengumuman dikirim sebagai notifikasi ke semua HP Android dan tampil di Beranda selama 3 hari. Maksimal 10 pengumuman per jam."],
  ["Untuk Admin","admin","Bagaimana mengelola agenda dan usulan warga?","Di Kelola Agenda, tambahkan agenda atau periksa usulan warga lalu setujui atau tolak. Agenda yang tidak dipakai bisa diarsipkan tanpa menghapus riwayatnya."],
  ["Untuk Admin","admin","Bagaimana mengatur Nomor Penting dan Darurat?","Nomor Penting punya kategori Pengelola, Keamanan, dan Lainnya. Warga melihat kelompoknya bila kategorinya lebih dari satu. Satu kontak bisa punya beberapa nomor, pisahkan dengan koma."],
  ["Untuk Admin","admin","Apa yang bisa diatur di Kelola Jelajah?","Empat tab: Tabel Rekomendasi (ubah, verifikasi, arsipkan, moderasi komentar), Kategori & Jenis, Laporan (laporan info salah dari warga), dan Pengaturan (titik Tower 2 dan pelengkapan titik lokasi data lama)."],
  ["Untuk Admin","admin","Kenapa jarak belum tampil di Jelajah?","Jarak dihitung dari titik Tower 2 yang diatur di Kelola Jelajah → Pengaturan. Cara paling tepat: berdiri di Tower 2, tekan Pakai lokasi saya, lalu Simpan titik."],
  ["Untuk Admin","admin","Bagaimana menangani laporan info salah?","Buka Kelola Jelajah → Laporan. Ubah tempatnya bila infonya salah, arsipkan bila tempatnya sudah tutup, lalu tekan Tandai selesai."],
  ["Untuk Admin","admin","Apa fungsi Notifikasi dan Tandai semua dibaca?","Halaman Notifikasi merangkum data baru sejak terakhir Anda membuka tiap menu, ditambah daftar Perlu Tindakan. Tandai semua dibaca mengosongkan hitungan tanpa menghapus data."],
  ["Untuk Admin","admin","Bagaimana mengubah isi FAQ?","Buka Kartu Pengelolaan → Kelola FAQ. Tambah, ubah, hapus, atau geser urutan pertanyaan. Pilih \"Tampil untuk\" agar pertanyaan hanya terlihat oleh peran tertentu. Perubahan langsung tampil di Bantuan & FAQ."],
  ["Untuk Admin","admin","Apa itu Log Pengelolaan?","Catatan tindakan pengelolaan: siapa melakukan apa dan kapan. Admin melihat log miliknya sendiri; Super Admin melihat semuanya."],
  ["Untuk Super Admin","super","Apa isi Kelola Aplikasi?","Empat tab: Warna & Tampilan (warna tema dan gambar latar), Banner (gambar bergilir di Beranda), Masukan (masukan pengembangan aplikasi dari warga), dan Penyimpanan (kapasitas data)."],
  ["Untuk Super Admin","super","Apakah warna tema bebas dipilih?","Ya. Aplikasi otomatis menyesuaikan warna teks dan tombol agar tetap terbaca. Pratinjau di editor menunjukkan hasil yang sama dengan aplikasi."],
  ["Untuk Super Admin","super","Apa arti tab Penyimpanan?","Google Sheets membatasi 10 juta sel per berkas, termasuk baris dan kolom kosong. Tab ini menunjukkan persentase terpakai dan perkiraan baris baru yang masih muat di tiap sheet. Peringatan muncul di Notifikasi pada 75% dan 90%, dan Admin mendapat notifikasi sekali per tingkat."],
  ["Untuk Super Admin","super","Bagaimana mengosongkan penyimpanan?","Hapus baris dan kolom kosong di sheet terbesar (klik kanan → hapus baris/kolom), atau pindahkan data lama (misalnya aspirasi tahun lalu) ke berkas arsip lain."],
  ["Untuk Super Admin","super","Hari libur di kalender datang dari mana?","Dari kalender publik Google “Hari Libur di Indonesia”, ditambah daftar hari internasional. Untuk koreksi, buat sheet HariLibur dengan kolom Tanggal | Nama | Jenis (Libur, Peringatan, Internasional, atau Hapus). Contoh tanggal: 2026-11-12."],
  ["Untuk Super Admin","super","Apa isi Log Sistem?","Daftar kesalahan aplikasi selama 60 hari terakhir dan pemeriksaan struktur database. Gunakan saat ada laporan fitur yang tidak berjalan."],
  ["Untuk Super Admin","super","Siapa yang bisa menambah Admin?","Hanya Super Admin, lewat Kelola Admin."]
];

// ===================================================================
// v15 — BANTUAN & FAQ (dapat dikelola Admin)
// -------------------------------------------------------------------
// Sheet "FAQ": ID | Bagian | Peran | Pertanyaan | Jawaban | Urutan | UpdatedAt | UpdatedBy
// Peran: warga (semua akun), admin (Admin & Super Admin), super (Super Admin).
// Sebelum ada perubahan pertama, aplikasi memakai FAQ_DEFAULTS. Saat Admin pertama
// kali menyimpan, isi bawaan disalin ke sheet (Script Property FAQ_SEEDED=1),
// sehingga menghapus semua pertanyaan tidak memunculkan isi bawaan lagi.
// ===================================================================
const SHEET_FAQ = 'FAQ';
const FAQ_HEADERS = ['ID', 'Bagian', 'Peran', 'Pertanyaan', 'Jawaban', 'Urutan', 'UpdatedAt', 'UpdatedBy'];
const FAQ_ROLES = ['warga', 'admin', 'super'];

// v19: FAQ untuk fitur baru. Ikut jadi bawaan pada instalasi baru, dan ditambahkan
// SEKALI ke sheet FAQ yang sudah ada (Script Property FAQ_V19=1), tanpa menimpa isi.
const FAQ_V19_ADDITIONS = [
  ['Papan Tindak Lanjut', 'warga', 'Apa itu Papan Tindak Lanjut?', 'Papan yang menunjukkan perkembangan aspirasi tentang fasilitas bersama: masuk, dibaca pengurus, ditindaklanjuti, sampai selesai. Hanya aspirasi yang dipilih pengurus yang tampil, dan nama, unit, nomor WhatsApp, isi asli, serta foto pelapor tidak pernah ditampilkan.'],
  ['Papan Tindak Lanjut', 'warga', 'Untuk apa tombol "Saya juga"?', 'Tekan bila Anda mengalami masalah yang sama. Jumlahnya membantu pengurus menentukan prioritas. Tekan sekali lagi untuk membatalkan.'],
  ['Papan Tindak Lanjut', 'warga', 'Aspirasi saya tampil di papan. Bisa disembunyikan?', 'Bisa. Buka Riwayat Saya, lalu ketuk "Sembunyikan dari papan" pada aspirasi itu. Pengurus akan diberi tahu.'],
  ['Papan Tindak Lanjut', 'admin', 'Kapan aspirasi sebaiknya ditampilkan di papan?', 'Untuk masalah fasilitas bersama (lift, lampu, kebersihan lorong, parkir). Tulis judul dan catatan versi publik tanpa nama, nomor unit, atau nomor telepon, lalu centang konfirmasi privasi. Pelapor mendapat notifikasi dan bisa menyembunyikannya.'],
  ['Dinding Apresiasi', 'warga', 'Apa itu Dinding Apresiasi?', 'Tempat mengucapkan terima kasih kepada petugas keamanan, kebersihan, teknisi, pengelola, pengurus, atau sesama warga. Apresiasi langsung tampil, dan pengirimnya ditampilkan sebagai jenis warga, bukan nama. Maksimal 5 apresiasi per hari.'],
  ['Dinding Apresiasi', 'warga', 'Bagaimana menghapus apresiasi?', 'Ketuk "Hapus" pada apresiasi yang Anda tulis. Admin dan Super Admin juga bisa menghapus apresiasi yang tidak pantas.'],
  ['Akun & privasi', 'warga', 'Bagaimana menghapus akun saya?', 'Buka Menu → Profil Saya, gulir ke bawah, ketuk "Hapus akun saya…", masukkan PIN, lalu ketik HAPUS. Akun dan data pribadi langsung dihapus. Aspirasi yang pernah dikirim tetap tersimpan sebagai catatan pengelolaan dengan inisial nama saja.'],
  ['Akun & privasi', 'warga', 'Di mana kebijakan privasi aplikasi ini?', 'Ketuk tautan "Privasi" di bagian bawah setiap halaman.']
];
Array.prototype.push.apply(FAQ_DEFAULTS, FAQ_V19_ADDITIONS);

function faqRolesFor_(role) {
  if (role === 'super_admin') return ['warga', 'admin', 'super'];
  if (role === 'admin') return ['warga', 'admin'];
  return ['warga'];
}
function faqDefaultItems_() {
  return FAQ_DEFAULTS.map(function (row, index) {
    return { id: 'bawaan-' + (index + 1), bagian: row[0], peran: row[1], pertanyaan: row[2], jawaban: row[3], urutan: index + 1 };
  });
}
function readFaqItems_() {
  if (PropertiesService.getScriptProperties().getProperty('FAQ_SEEDED') !== '1') return faqDefaultItems_();
  const sheet = getSheet_(SHEET_FAQ);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return getSheetData_(SHEET_FAQ).map(function (row) {
    return { id: String(row.ID || ''), bagian: String(row.Bagian || 'Lainnya'), peran: FAQ_ROLES.indexOf(String(row.Peran)) >= 0 ? String(row.Peran) : 'warga',
      pertanyaan: String(row.Pertanyaan || ''), jawaban: String(row.Jawaban || ''), urutan: Number(row.Urutan) || 0 };
  }).filter(function (item) { return item.id && item.pertanyaan; }).sort(function (a, b) { return a.urutan - b.urutan; });
}
// Menyalin isi bawaan ke sheet bila belum pernah. Harus dipanggil di dalam withScriptLock_.
function ensureFaqSheet_() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_FAQ);
  if (!sheet) { sheet = ss.insertSheet(SHEET_FAQ); sheet.appendRow(FAQ_HEADERS); }
  if (props.getProperty('FAQ_SEEDED') !== '1') {
    const now = new Date();
    const rows = faqDefaultItems_().map(function (item, index) {
      return ['FAQ-' + ('00' + (index + 1)).slice(-3), item.bagian, item.peran, item.pertanyaan, item.jawaban, (index + 1) * 10, now, 'bawaan'];
    });
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, FAQ_HEADERS.length).clearContent();
    if (rows.length) sheet.getRange(2, 1, rows.length, FAQ_HEADERS.length).setValues(rows);
    props.setProperty('FAQ_SEEDED', '1');
    props.setProperty('FAQ_V19', '1');
  } else if (props.getProperty('FAQ_V19') !== '1') {
    const existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, FAQ_HEADERS.length).getValues() : [];
    const questions = existing.map(function (r) { return String(r[3] || '').trim().toLowerCase(); });
    let order = existing.reduce(function (m, r) { return Math.max(m, Number(r[5]) || 0); }, 0);
    const now = new Date();
    FAQ_V19_ADDITIONS.forEach(function (item, index) {
      if (questions.indexOf(item[2].toLowerCase()) >= 0) return;
      order += 10;
      sheet.appendRow(['FAQ-V19-' + ('0' + (index + 1)).slice(-2), item[0], item[1], item[2], item[3], order, now, 'bawaan']);
    });
    props.setProperty('FAQ_V19', '1');
  }
  return sheet;
}
function faqRowIndex_(sheet, id) {
  const ids = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return -1;
}
function mapFaqId_(id) {
  // ID bawaan "bawaan-N" berubah menjadi "FAQ-00N" setelah disalin ke sheet.
  const m = String(id || '').match(/^bawaan-(\d+)$/);
  return m ? 'FAQ-' + ('00' + m[1]).slice(-3) : String(id || '');
}

function getFaq(sessionToken) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const allowed = faqRolesFor_(session.role);
  const items = readFaqItems_().filter(function (item) { return allowed.indexOf(item.peran) >= 0; });
  return { success: true, items: items, canEdit: session.role !== 'resident', editableRoles: session.role === 'super_admin' ? FAQ_ROLES : ['warga', 'admin'] };
}

function saveFaqItem(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  try {
    const editable = session.role === 'super_admin' ? FAQ_ROLES : ['warga', 'admin'];
    const peran = String(payload.peran || 'warga');
    if (editable.indexOf(peran) < 0) throw new Error('Anda tidak dapat mengatur FAQ untuk peran ini.');
    const bagian = validateString_(payload.bagian, 'Bagian', 2, 60);
    const pertanyaan = validateString_(payload.pertanyaan, 'Pertanyaan', 5, 200);
    const jawaban = validateString_(payload.jawaban, 'Jawaban', 5, 1500);
    return withScriptLock_(function () {
      const sheet = ensureFaqSheet_();
      const now = new Date();
      const id = mapFaqId_(payload.id);
      if (id) {
        const row = faqRowIndex_(sheet, id);
        if (row < 0) throw new Error('Pertanyaan tidak ditemukan. Muat ulang halaman.');
        const oldRole = String(sheet.getRange(row, 3).getValue());
        if (editable.indexOf(oldRole) < 0) throw new Error('Anda tidak dapat mengubah pertanyaan ini.');
        sheet.getRange(row, 2, 1, 4).setValues([[sheetText_(bagian), peran, sheetText_(pertanyaan), sheetText_(jawaban)]]);
        sheet.getRange(row, 7, 1, 2).setValues([[now, session.username]]);
        writeAuditLog_('UPDATE_FAQ', session.username, id, pertanyaan.substring(0, 80));
        return { success: true, id: id, message: 'Pertanyaan disimpan.' };
      }
      const items = readFaqItems_();
      const sameSection = items.filter(function (item) { return item.bagian === bagian; });
      const maxOrder = (sameSection.length ? sameSection : items).reduce(function (m, item) { return Math.max(m, item.urutan); }, 0);
      const newId = 'FAQ-' + Utilities.getUuid().substring(0, 8);
      sheet.appendRow([newId, sheetText_(bagian), peran, sheetText_(pertanyaan), sheetText_(jawaban), maxOrder + 1, now, session.username]);
      writeAuditLog_('ADD_FAQ', session.username, newId, pertanyaan.substring(0, 80));
      return { success: true, id: newId, message: 'Pertanyaan ditambahkan.' };
    });
  } catch (err) { return { success: false, message: err.message }; }
}

function deleteFaqItem(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  try {
    const editable = session.role === 'super_admin' ? FAQ_ROLES : ['warga', 'admin'];
    return withScriptLock_(function () {
      const sheet = ensureFaqSheet_();
      const id = mapFaqId_(payload.id);
      const row = faqRowIndex_(sheet, id);
      if (row < 0) throw new Error('Pertanyaan tidak ditemukan. Muat ulang halaman.');
      const values = sheet.getRange(row, 1, 1, 4).getValues()[0];
      if (editable.indexOf(String(values[2])) < 0) throw new Error('Anda tidak dapat menghapus pertanyaan ini.');
      sheet.deleteRow(row);
      writeAuditLog_('DELETE_FAQ', session.username, id, String(values[3]).substring(0, 80));
      return { success: true, message: 'Pertanyaan dihapus.' };
    });
  } catch (err) { return { success: false, message: err.message }; }
}

// Menggeser pertanyaan satu langkah ke atas/bawah di dalam bagiannya.
function moveFaqItem(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  try {
    const direction = Number(payload.direction) < 0 ? -1 : 1;
    return withScriptLock_(function () {
      const sheet = ensureFaqSheet_();
      const id = mapFaqId_(payload.id);
      const items = readFaqItems_();
      const current = items.filter(function (item) { return item.id === id; })[0];
      if (!current) throw new Error('Pertanyaan tidak ditemukan. Muat ulang halaman.');
      const visible = faqRolesFor_(session.role);
      const section = items.filter(function (item) { return item.bagian === current.bagian && visible.indexOf(item.peran) >= 0; });
      const pos = section.indexOf(current);
      const other = section[pos + direction];
      if (!other) return { success: true, message: 'Sudah di ujung.' };
      const rowA = faqRowIndex_(sheet, current.id), rowB = faqRowIndex_(sheet, other.id);
      const orderA = current.urutan === other.urutan ? other.urutan + direction : other.urutan;
      sheet.getRange(rowA, 6).setValue(orderA);
      sheet.getRange(rowB, 6).setValue(current.urutan);
      writeAuditLog_('MOVE_FAQ', session.username, id, direction < 0 ? 'naik' : 'turun');
      return { success: true };
    });
  } catch (err) { return { success: false, message: err.message }; }
}

// ===================================================================
// v16 — JELAJAH SEKITAR BARU
// -------------------------------------------------------------------
// • Titik lokasi (Lat/Lng/PlaceId), jam buka, harga skala 1–5 di sheet JelajahRekomendasi.
// • Cari lokasi di dalam aplikasi lewat layanan Maps bawaan Apps Script (data Google,
//   tanpa kunci API). Kuota akun Gmail: ±1.000 pencarian/hari — dibatasi 900/hari dan
//   40/jam per akun agar aman. Hasil pencarian disimpan di cache 6 jam.
// • Favorit (JelajahFavorit) dan laporan info salah (JelajahLaporan).
// • Titik Tower 2 diatur Admin (SystemConfig TowerLat/TowerLng); jarak hanya tampil bila sudah diatur.
// ===================================================================
const SHEET_JELAJAH_FAVORIT = 'JelajahFavorit';
const SHEET_JELAJAH_LAPORAN = 'JelajahLaporan';
const JELAJAH_REC_HEADERS = ['ID', 'Timestamp', 'Username', 'NamaPengirim', 'Kategori', 'Jenis', 'NamaLokasi', 'TautanMaps', 'Alamat', 'Keterangan', 'Tagging', 'StatusVerifikasi', 'VerifikasiOleh', 'TanggalVerifikasi', 'StatusRekomendasi', 'Lat', 'Lng', 'PlaceId', 'JamBuka', 'Harga', 'UpdatedAt'];
const JELAJAH_REPORT_REASONS = ['Tutup permanen', 'Lokasi salah', 'Info tidak sesuai', 'Lainnya'];
const JELAJAH_PRICE_LABELS = ['', '< Rp15 rb', 'Rp15–30 rb', 'Rp30–50 rb', 'Rp50–100 rb', '> Rp100 rb'];
// Batas wilayah "sekitar": Jabodetabek. Dipakai untuk bias pencarian dan validasi titik.
const JELAJAH_BOUNDS = { south: -6.8, west: 106.3, north: -5.8, east: 107.3 };
const JELAJAH_GEOCODE_DAILY_LIMIT = 900;
const JELAJAH_GEOCODE_USER_HOURLY = 40;

function getJelajahFavoriteSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_JELAJAH_FAVORIT);
  if (!sheet) sheet = ss.insertSheet(SHEET_JELAJAH_FAVORIT);
  ensureJelajahHeaders_(sheet, ['Username', 'RecommendationID', 'CreatedAt']);
  return sheet;
}
function getJelajahReportSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_JELAJAH_LAPORAN);
  if (!sheet) sheet = ss.insertSheet(SHEET_JELAJAH_LAPORAN);
  ensureJelajahHeaders_(sheet, ['ID', 'RecommendationID', 'Username', 'NamaPelapor', 'Alasan', 'Catatan', 'CreatedAt', 'Status', 'DiprosesOleh', 'DiprosesPada']);
  return sheet;
}
// Menulis satu baris berdasarkan nama kolom (urutan kolom di sheet boleh berbeda).
function appendRowByHeaders_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  sheet.appendRow(headers.map(function (h) { return Object.prototype.hasOwnProperty.call(record, h) ? record[h] : ''; }));
}
function findRowByColumn_(sheet, header, value) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = headers.indexOf(header);
  if (col < 0) return { row: -1, headers: headers };
  for (let i = 1; i < values.length; i++) if (String(values[i][col]) === String(value)) return { row: i + 1, headers: headers, values: values[i] };
  return { row: -1, headers: headers };
}
function setRowValuesByHeaders_(sheet, rowNumber, headers, record) {
  Object.keys(record).forEach(function (key) {
    const col = headers.indexOf(key);
    if (col >= 0) sheet.getRange(rowNumber, col + 1).setValue(record[key]);
  });
}

function parseJelajahCoordinate_(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!isFinite(la) || !isFinite(ln) || lat === '' || lng === '' || lat == null || lng == null) return null;
  if (la < JELAJAH_BOUNDS.south || la > JELAJAH_BOUNDS.north || ln < JELAJAH_BOUNDS.west || ln > JELAJAH_BOUNDS.east) return null;
  return { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 };
}
function getJelajahTowerLocation_() {
  const cfg = getSystemConfig_();
  return parseJelajahCoordinate_(cfg.TowerLat, cfg.TowerLng);
}
function buildJelajahMapsUrl_(name, coord, placeId) {
  if (placeId) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name || (coord ? coord.lat + ',' + coord.lng : '')) + '&query_place_id=' + encodeURIComponent(placeId);
  return 'https://www.google.com/maps/search/?api=1&query=' + coord.lat + ',' + coord.lng;
}
// Mengambil koordinat dari berbagai bentuk tautan Google Maps.
function extractCoordsFromMapsUrl_(url) {
  const text = decodeURIComponent(String(url || '')).replace(/\+/g, ' ');
  const patterns = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /\/place\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /\/search\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/];
  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (m) { const c = parseJelajahCoordinate_(m[1], m[2]); if (c) return c; }
  }
  return null;
}
// Tautan pendek (maps.app.goo.gl / goo.gl) diikuti sampai 3 kali untuk mendapat tautan lengkap.
function resolveMapsShortUrl_(url) {
  let current = String(url || '');
  for (let i = 0; i < 3; i++) {
    if (!/^https:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(current)) return current;
    const response = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true });
    const headers = response.getAllHeaders ? response.getAllHeaders() : (response.getHeaders ? response.getHeaders() : {});
    const location = headers.Location || headers.location;
    if (!location) return current;
    current = Array.isArray(location) ? location[0] : String(location);
  }
  return current;
}

// ---------- kuota pencarian ----------
function takeGeocodeBudget_(username) {
  const cache = CacheService.getScriptCache();
  const userKey = 'geo-user-' + String(username).toLowerCase();
  const used = Number(cache.get(userKey) || 0);
  if (used >= JELAJAH_GEOCODE_USER_HOURLY) throw new Error('Pencarian lokasi sudah terlalu sering. Coba lagi sekitar satu jam lagi, atau geser titik di peta.');
  const props = PropertiesService.getScriptProperties();
  const dayKey = 'GEOCODE_' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd');
  const daily = Number(props.getProperty(dayKey) || 0);
  if (daily >= JELAJAH_GEOCODE_DAILY_LIMIT) throw new Error('Kuota pencarian lokasi hari ini sudah habis. Geser titik di peta atau pakai lokasi Anda saat ini.');
  cache.put(userKey, String(used + 1), 3600);
  props.setProperty(dayKey, String(daily + 1));
}
function geocodeResultToPlace_(result, tower) {
  const loc = result && result.geometry && result.geometry.location;
  const coord = loc ? parseJelajahCoordinate_(loc.lat, loc.lng) : null;
  if (!coord) return null;
  const components = result.address_components || [];
  const types = result.types || [];
  const isPlace = types.indexOf('establishment') >= 0 || types.indexOf('point_of_interest') >= 0;
  const first = components[0] && components[0].long_name ? String(components[0].long_name) : '';
  const address = String(result.formatted_address || '');
  let name = isPlace && first ? first : address.split(',')[0];
  let shortAddress = address;
  if (name && shortAddress.indexOf(name + ', ') === 0) shortAddress = shortAddress.substring(name.length + 2);
  return { nama: name, alamat: shortAddress.replace(/, Indonesia$/, ''), lat: coord.lat, lng: coord.lng, placeId: String(result.place_id || ''), tempat: isPlace,
    jarak: tower ? Math.round(haversineMeters_(tower, coord)) : null };
}
function haversineMeters_(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
function searchJelajahPlaces(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const query = String(payload && payload.query || '').trim().replace(/\s+/g, ' ');
  if (query.length < 3 || query.length > 120) return { success: false, message: 'Ketik minimal 3 huruf nama tempat atau alamat.' };
  const tower = getJelajahTowerLocation_();
  const cache = CacheService.getScriptCache();
  const cacheKey = 'geo-q-' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, query.toLowerCase())).substring(0, 22);
  const cached = cache.get(cacheKey);
  let results;
  if (cached) { try { results = JSON.parse(cached); } catch (ignore) {} }
  if (!results) {
    try { takeGeocodeBudget_(session.username); } catch (err) { return { success: false, message: err.message }; }
    try {
      const geocoder = Maps.newGeocoder().setRegion('id').setLanguage('id').setBounds(JELAJAH_BOUNDS.south, JELAJAH_BOUNDS.west, JELAJAH_BOUNDS.north, JELAJAH_BOUNDS.east);
      const response = geocoder.geocode(query + (/jakarta|bekasi|tangerang|depok|bogor/i.test(query) ? '' : ', Jakarta'));
      results = (response && response.results || []).map(function (r) { return geocodeResultToPlace_(r, null); }).filter(Boolean).slice(0, 6);
      try { cache.put(cacheKey, JSON.stringify(results), 21600); } catch (ignore) {}
    } catch (err) {
      writeApplicationError_('searchJelajahPlaces', err, session.username);
      return { success: false, message: 'Pencarian lokasi sedang tidak tersedia. Geser titik di peta atau pakai lokasi Anda.' };
    }
  }
  results = results.map(function (r) { const copy = JSON.parse(JSON.stringify(r)); copy.jarak = tower ? Math.round(haversineMeters_(tower, r)) : null; return copy; });
  if (tower) results.sort(function (a, b) { return a.jarak - b.jarak; });
  return { success: true, results: results };
}
function reverseJelajahLocation(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const coord = parseJelajahCoordinate_(payload && payload.lat, payload && payload.lng);
  if (!coord) return { success: false, message: 'Titik berada di luar wilayah Jabodetabek.' };
  try { takeGeocodeBudget_(session.username); } catch (err) { return { success: false, message: err.message }; }
  try {
    const response = Maps.newGeocoder().setLanguage('id').reverseGeocode(coord.lat, coord.lng);
    const place = response && response.results && response.results[0] ? geocodeResultToPlace_(response.results[0], getJelajahTowerLocation_()) : null;
    return { success: true, alamat: place ? (place.tempat ? place.alamat : [place.nama, place.alamat].filter(Boolean).join(', ')) : '' };
  } catch (err) {
    writeApplicationError_('reverseJelajahLocation', err, session.username);
    return { success: true, alamat: '' };
  }
}

// ---------- validasi isian rekomendasi (kirim & ubah) ----------
function readJelajahRecommendationInput_(payload) {
  const out = {
    kategori: String(payload.kategori || '').trim(), jenis: String(payload.jenis || '').trim(),
    namaLokasi: String(payload.namaLokasi || '').trim(), alamat: String(payload.alamat || '').trim(),
    keterangan: String(payload.keterangan || '').trim(), jamBuka: String(payload.jamBuka || '').trim(),
    harga: payload.harga === '' || payload.harga == null ? '' : Number(payload.harga),
    coord: parseJelajahCoordinate_(payload.lat, payload.lng), placeId: String(payload.placeId || '').trim().substring(0, 300),
    tautanMaps: String(payload.tautanMaps || '').trim()
  };
  const tags = Array.isArray(payload.tags) ? payload.tags : String(payload.tags || '').split(',');
  out.tags = tags.map(function (tag) { return String(tag || '').trim().replace(/^#/, ''); }).filter(function (t, i, all) { return t && all.indexOf(t) === i; });
  if (!out.kategori || out.kategori.length > 60) throw new Error('Kategori wajib dipilih.');
  if (!out.jenis || out.jenis.length > 80) throw new Error('Jenis rekomendasi wajib dipilih.');
  if (!out.namaLokasi || out.namaLokasi.length > 140) throw new Error('Nama tempat wajib diisi (maksimal 140 karakter).');
  if (out.alamat.length > 240 || out.keterangan.length > 1200 || out.jamBuka.length > 80) throw new Error('Alamat, keterangan, atau jam buka terlalu panjang.');
  if (out.tags.length > 8 || out.tags.some(function (tag) { return tag.length > 32; })) throw new Error('Maksimal 8 tag, masing-masing maksimal 32 karakter.');
  if (out.harga !== '' && (out.harga < 1 || out.harga > 5 || Math.floor(out.harga) !== out.harga)) throw new Error('Kisaran harga harus 1 sampai 5.');
  if ((payload.lat !== undefined && payload.lat !== '' && payload.lat !== null) && !out.coord) throw new Error('Titik lokasi berada di luar wilayah Jabodetabek.');
  if (!out.coord) {
    if (!isAllowedGoogleMapsUrl_(out.tautanMaps)) throw new Error('Pilih lokasi di peta terlebih dahulu.');
    out.coord = extractCoordsFromMapsUrl_(out.tautanMaps);
  }
  if (out.coord && !out.tautanMaps) out.tautanMaps = buildJelajahMapsUrl_(out.namaLokasi, out.coord, out.placeId);
  if (out.coord && out.placeId && !isAllowedGoogleMapsUrl_(out.tautanMaps)) out.tautanMaps = buildJelajahMapsUrl_(out.namaLokasi, out.coord, out.placeId);
  return out;
}
function jelajahRecordFromInput_(input) {
  return {
    Kategori: sheetText_(input.kategori), Jenis: sheetText_(input.jenis), NamaLokasi: sheetText_(input.namaLokasi), TautanMaps: sheetText_(input.tautanMaps),
    Alamat: sheetText_(input.alamat), Keterangan: sheetText_(input.keterangan), Tagging: sheetText_(input.tags.join(', ')),
    Lat: input.coord ? input.coord.lat : '', Lng: input.coord ? input.coord.lng : '', PlaceId: sheetText_(input.placeId),
    JamBuka: sheetText_(input.jamBuka), Harga: input.harga === '' ? '' : input.harga, UpdatedAt: new Date()
  };
}
function jelajahSenderName_(username) {
  const warga = getSheetData_(SHEET_WARGA).find(function (row) { return String(row.Username || '').toLowerCase() === String(username || '').toLowerCase(); });
  return String(warga && warga.Nama || username);
}

function updateJelajahRecommendation(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  payload = payload || {};
  const id = String(payload.id || '').trim();
  let input;
  try { input = readJelajahRecommendationInput_(payload); } catch (err) { return { success: false, message: err.message }; }
  try {
    return withScriptLock_(function () {
      const sheet = getJelajahRecommendationSheet_();
      const found = findRowByColumn_(sheet, 'ID', id);
      if (found.row < 0) return { success: false, message: 'Rekomendasi tidak ditemukan. Muat ulang halaman.' };
      const owner = String(found.values[found.headers.indexOf('Username')] || '');
      const isOwner = owner.toLowerCase() === String(session.username).toLowerCase();
      if (!isOwner && session.role === 'resident') return { success: false, message: 'Hanya pengirim yang dapat mengubah rekomendasi ini.' };
      if (String(found.values[found.headers.indexOf('StatusRekomendasi')] || 'Aktif') === 'Dihapus') return { success: false, message: 'Rekomendasi ini sedang diarsipkan.' };
      const catalog = getJelajahCatalog_();
      const oldCategory = String(found.values[found.headers.indexOf('Kategori')] || ''), oldType = String(found.values[found.headers.indexOf('Jenis')] || '');
      const unchangedCatalog = oldCategory === input.kategori && oldType === input.jenis;
      if (!unchangedCatalog && (catalog.categories.indexOf(input.kategori) < 0 || (catalog.typesByCategory[input.kategori] || []).indexOf(input.jenis) < 0)) return { success: false, message: 'Kategori atau jenis sudah tidak tersedia.' };
      const dup = findJelajahDuplicate_(input, id);
      if (dup) return jelajahDuplicateResponse_(dup);
      setRowValuesByHeaders_(sheet, found.row, found.headers, jelajahRecordFromInput_(input));
      writeAuditLog_('UPDATE_JELAJAH_RECOMMENDATION', session.username, id, isOwner ? 'oleh pengirim' : 'oleh admin');
      return { success: true, message: 'Rekomendasi diperbarui.' };
    });
  } catch (err) {
    writeApplicationError_('updateJelajahRecommendation', err, session.username);
    return { success: false, message: 'Perubahan belum tersimpan. Coba lagi.' };
  }
}

function toggleJelajahFavorite(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const id = String(payload && payload.recommendationId || '').trim();
  if (!id) return { success: false, message: 'Rekomendasi tidak valid.' };
  return withScriptLock_(function () {
    const sheet = getJelajahFavoriteSheet_();
    const values = sheet.getDataRange().getValues();
    const me = String(session.username).toLowerCase();
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]).toLowerCase() === me && String(values[i][1]) === id) { sheet.deleteRow(i + 1); return { success: true, favorited: false, message: 'Dihapus dari Simpanan.' }; }
    }
    sheet.appendRow([sheetText_(session.username), id, new Date()]);
    return { success: true, favorited: true, message: 'Disimpan ke Simpanan saya.' };
  });
}

function submitJelajahReport(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  payload = payload || {};
  const id = String(payload.recommendationId || '').trim();
  const reason = String(payload.alasan || '');
  const note = String(payload.catatan || '').trim();
  if (JELAJAH_REPORT_REASONS.indexOf(reason) < 0) return { success: false, message: 'Pilih alasan laporan.' };
  if (note.length > 500) return { success: false, message: 'Catatan maksimal 500 karakter.' };
  try {
    return withScriptLock_(function () {
      const rec = getJelajahRecommendationRows_().find(function (row) { return String(row.ID || '') === id; });
      if (!rec || String(rec.StatusRekomendasi || 'Aktif') === 'Dihapus') return { success: false, message: 'Rekomendasi tidak ditemukan.' };
      const sheet = getJelajahReportSheet_();
      const open = getSheetData_(SHEET_JELAJAH_LAPORAN).some(function (row) { return String(row.RecommendationID) === id && String(row.Username).toLowerCase() === String(session.username).toLowerCase() && String(row.Status || 'Baru') === 'Baru'; });
      if (open) return { success: false, message: 'Laporan Anda untuk tempat ini masih menunggu ditinjau Admin.' };
      const reportId = 'LAP-' + Utilities.getUuid().substring(0, 8);
      appendRowByHeaders_(sheet, { ID: reportId, RecommendationID: id, Username: sheetText_(session.username), NamaPelapor: sheetText_(jelajahSenderName_(session.username)), Alasan: reason, Catatan: sheetText_(note), CreatedAt: new Date(), Status: 'Baru' });
      writeAuditLog_('REPORT_JELAJAH', session.username, id, reason);
      queuePush_({ admins: true }, { title: 'Laporan info Jelajah', body: reason + ': ' + String(rec.NamaLokasi || ''), page: 'kelolaJelajah' });
      return { success: true, message: 'Terima kasih. Laporan dikirim ke Admin.' };
    });
  } catch (err) {
    writeApplicationError_('submitJelajahReport', err, session.username);
    return { success: false, message: 'Laporan belum terkirim. Coba lagi.' };
  }
}
function resolveJelajahReport(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const id = String(payload && payload.id || '').trim();
  return withScriptLock_(function () {
    const sheet = getJelajahReportSheet_();
    const found = findRowByColumn_(sheet, 'ID', id);
    if (found.row < 0) return { success: false, message: 'Laporan tidak ditemukan.' };
    setRowValuesByHeaders_(sheet, found.row, found.headers, { Status: 'Selesai', DiprosesOleh: sheetText_(session.username), DiprosesPada: new Date() });
    writeAuditLog_('RESOLVE_JELAJAH_REPORT', session.username, id, '');
    return { success: true, message: 'Laporan ditandai selesai.' };
  });
}
function setJelajahTowerLocation(payload) {
  const session = requireJelajahAdmin_(payload && payload.sessionToken);
  const coord = parseJelajahCoordinate_(payload && payload.lat, payload && payload.lng);
  if (!coord) return { success: false, message: 'Titik berada di luar wilayah Jabodetabek.' };
  return withScriptLock_(function () {
    upsertSystemConfigValue_('TowerLat', coord.lat);
    upsertSystemConfigValue_('TowerLng', coord.lng);
    writeAuditLog_('SET_TOWER_LOCATION', session.username, 'SystemConfig', coord.lat + ',' + coord.lng);
    return { success: true, message: 'Titik Tower 2 disimpan.', tower: coord };
  });
}

// Melengkapi titik lokasi rekomendasi lama dari tautan Maps-nya. Dipanggil pemicu harian
// (maks 25 per hari) dan dari Kelola Jelajah. Yang gagal ditandai agar tidak dicoba terus.
function fillJelajahCoordinates_(limit) {
  const sheet = getJelajahRecommendationSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const col = function (h) { return headers.indexOf(h); };
  let filled = 0, failed = 0, tried = 0, remaining = 0;
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[col('Lat')]) !== '' && String(row[col('Lng')]) !== '') continue;
    if (String(row[col('PlaceId')]) === 'tidak-ditemukan') continue;
    if (tried >= limit) { remaining++; continue; }
    tried++;
    let coord = null;
    try {
      const url = String(row[col('TautanMaps')] || '');
      coord = extractCoordsFromMapsUrl_(url) || extractCoordsFromMapsUrl_(resolveMapsShortUrl_(url));
    } catch (ignore) {}
    if (coord) { sheet.getRange(i + 1, col('Lat') + 1, 1, 2).setValues([[coord.lat, coord.lng]]); filled++; }
    else { sheet.getRange(i + 1, col('PlaceId') + 1).setValue('tidak-ditemukan'); failed++; }
  }
  return { filled: filled, failed: failed, remaining: remaining };
}
function fillJelajahCoordinates(sessionToken) {
  const session = requireJelajahAdmin_(sessionToken);
  return withScriptLock_(function () {
    const report = fillJelajahCoordinates_(60);
    writeAuditLog_('FILL_JELAJAH_COORDINATES', session.username, 'JelajahRekomendasi', JSON.stringify(report));
    return { success: true, report: report, message: report.filled + ' titik dilengkapi, ' + report.failed + ' tidak ditemukan' + (report.remaining ? ', ' + report.remaining + ' menunggu giliran' : '') + '.' };
  });
}

// ===================================================================
// v19 — PAPAN TINDAK LANJUT (transparansi aspirasi)
// -------------------------------------------------------------------
// Admin memilih aspirasi yang tampil ke warga (biasanya soal fasilitas bersama) dan
// menulis judul/lokasi/catatan versi publik. Warga hanya melihat versi publik itu:
// TIDAK PERNAH nama, unit, nomor WA, isi asli, atau foto pelapor. Pelapor bisa
// menyembunyikan aspirasinya sendiri dari papan. Warga lain bisa menekan
// "Saya juga mengalami" (sheet AspirasiDukungan) untuk membantu prioritas.
// ===================================================================
const PAPAN_COLUMNS = ['Publik', 'JudulPublik', 'LokasiPublik', 'CatatanPublik', 'PublikPada', 'PublikOleh', 'DibacaPada', 'SelesaiPada'];
const SHEET_ASPIRASI_DUKUNGAN = 'AspirasiDukungan';
const PAPAN_CACHE_KEY = 'papan-v1';

function invalidatePapanCache_() {
  try { CacheService.getScriptCache().remove(PAPAN_CACHE_KEY); } catch (ignore) {}
}

function papanStage_(row) {
  const status = aspirationStatusOf_(row);
  if (status === 'Diselesaikan') return { step: 4, label: 'Selesai' };
  if (status === 'Ditolak') return { step: 4, label: 'Tidak dapat ditindaklanjuti', rejected: true };
  if (status === 'Baru') return { step: 1, label: 'Menunggu dibaca pengurus' };
  if (String(row.CatatanPublik || '').trim()) return { step: 3, label: 'Sedang ditindaklanjuti' };
  return { step: 2, label: 'Dibaca pengurus' };
}

function getAspirasiDukunganSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_ASPIRASI_DUKUNGAN);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ASPIRASI_DUKUNGAN);
    sheet.appendRow(['AspirasiID', 'Username', 'CreatedAt']);
    try { sheet.hideSheet(); } catch (ignore) {}
  }
  return sheet;
}

// Data papan bersama (tanpa info per pengguna), di-cache 60 detik.
function buildPapanBase_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PAPAN_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch (ignore) {} }
  const rows = getSheet_(SHEET_DATA) ? getSheetData_(SHEET_DATA) : [];
  const now = new Date();
  const monthKey = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM');
  const inMonth = function (value) { const t = notificationDate_(value); return t ? Utilities.formatDate(new Date(t), 'Asia/Jakarta', 'yyyy-MM') === monthKey : false; };
  const stats = { masuk: 0, ditangani: 0, selesai: 0, rataTanggapJam: null };
  let responseSum = 0, responseCount = 0;
  const items = [];
  rows.forEach(function (row) {
    if (!row.ID) return;
    const status = aspirationStatusOf_(row);
    if (inMonth(row.Timestamp)) stats.masuk++;
    if (status === 'Dibaca') stats.ditangani++;
    if (status === 'Diselesaikan' && inMonth(row.SelesaiPada || row.Tanggal_Tindak_Lanjut || row.LastUpdatedAt)) stats.selesai++;
    const t0 = notificationDate_(row.Timestamp), t1 = notificationDate_(row.DibacaPada);
    if (t0 && t1 && t1 >= t0 && inMonth(row.DibacaPada)) { responseSum += (t1 - t0); responseCount++; }
    if (String(row.Publik || '') !== 'Ya') return;
    const stage = papanStage_(row);
    const updated = Math.max(notificationDate_(row.LastUpdatedAt) || 0, notificationDate_(row.PublikPada) || 0, t0 || 0);
    items.push({
      id: String(row.ID), kategori: String(row.Kategori || ''), judul: String(row.JudulPublik || ''), lokasi: String(row.LokasiPublik || 'Area umum'),
      catatan: String(row.CatatanPublik || ''), step: stage.step, statusLabel: stage.label, ditolak: !!stage.rejected,
      masukPada: t0 ? formatTanggal_(new Date(t0)) : '', diperbaruiMs: updated
    });
  });
  if (responseCount) stats.rataTanggapJam = Math.round(responseSum / responseCount / 360000) / 10;
  items.sort(function (a, b) { return (a.step === 4) - (b.step === 4) || b.diperbaruiMs - a.diperbaruiMs; });
  const base = { bulan: Utilities.formatDate(now, 'Asia/Jakarta', 'MM/yyyy'), stats: stats, items: items };
  try { cache.put(PAPAN_CACHE_KEY, JSON.stringify(base), 60); } catch (ignore) {}
  return base;
}

function papanSupportIndex_(username) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ASPIRASI_DUKUNGAN);
  const counts = {}, mine = {};
  if (!sheet || sheet.getLastRow() < 2) return { counts: counts, mine: mine };
  const me = String(username || '').toLowerCase();
  getSheetData_(SHEET_ASPIRASI_DUKUNGAN).forEach(function (row) {
    const id = String(row.AspirasiID || '');
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
    if (String(row.Username || '').toLowerCase() === me) mine[id] = true;
  });
  return { counts: counts, mine: mine };
}

function getPapanTindakLanjut(sessionToken) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const base = buildPapanBase_();
  const support = papanSupportIndex_(session.username);
  const owned = {};
  getSheetData_(SHEET_DATA).forEach(function (row) {
    if (String(row.Publik || '') === 'Ya' && String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase()) owned[String(row.ID)] = true;
  });
  return {
    success: true, bulan: base.bulan, stats: base.stats,
    items: base.items.map(function (it) {
      return Object.assign({}, it, { dukungan: support.counts[it.id] || 0, didukung: !!support.mine[it.id], milikSaya: !!owned[it.id] });
    })
  };
}

function getPapanDetail(sessionToken, id) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const target = String(id || '').trim();
  const row = getSheetData_(SHEET_DATA).find(function (r) { return String(r.ID || '') === target && String(r.Publik || '') === 'Ya'; });
  if (!row) return { success: false, message: 'Aspirasi ini tidak (lagi) ditampilkan di papan.' };
  const stage = papanStage_(row);
  const support = papanSupportIndex_(session.username);
  const fmt = function (v) { const t = notificationDate_(v); return t ? formatTanggal_(new Date(t)) : ''; };
  const timeline = [{ label: 'Aspirasi masuk', waktu: fmt(row.Timestamp), done: true }];
  timeline.push({ label: 'Dibaca pengurus', waktu: fmt(row.DibacaPada), done: stage.step >= 2 });
  timeline.push({ label: 'Ditindaklanjuti', waktu: fmt(row.PublikPada), catatan: String(row.CatatanPublik || ''), done: stage.step >= 3 });
  timeline.push({ label: stage.rejected ? 'Tidak dapat ditindaklanjuti' : 'Selesai', waktu: fmt(row.SelesaiPada || (stage.step === 4 ? row.LastUpdatedAt : '')), done: stage.step >= 4 });
  return {
    success: true,
    item: {
      id: target, kategori: String(row.Kategori || ''), judul: String(row.JudulPublik || ''), lokasi: String(row.LokasiPublik || 'Area umum'),
      step: stage.step, statusLabel: stage.label, ditolak: !!stage.rejected, timeline: timeline,
      dukungan: support.counts[target] || 0, didukung: !!support.mine[target],
      milikSaya: String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase()
    }
  };
}

function setAspirasiPublik(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['admin', 'super_admin']);
  const id = String(payload.id || '').trim();
  const publik = !!payload.publik;
  const judul = publik ? validateString_(payload.judul, 'Judul untuk warga', 5, 120) : '';
  const lokasi = publik ? validateString_(payload.lokasi || 'Area umum', 'Lokasi untuk warga', 2, 60) : '';
  const catatan = String(payload.catatan || '').trim();
  if (catatan.length > 400) return { success: false, message: 'Catatan perkembangan maksimal 400 karakter.' };
  if (publik && payload.konfirmasiPrivasi !== true) return { success: false, message: 'Centang konfirmasi bahwa judul dan catatan tidak memuat nama, nomor unit, atau nomor telepon.' };
  if (publik && /(\b0?8\d{8,}|\+?62\d{8,})/.test(judul + ' ' + catatan)) return { success: false, message: 'Judul atau catatan tampak memuat nomor telepon. Hapus dulu.' };
  ensureAspirasiBookColumns_();
  return withScriptLock_(function () {
    const sheet = getSheet_(SHEET_DATA);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const col = function (h) { return headers.indexOf(h) + 1; };
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][col('ID') - 1] == null ? '' : values[i][col('ID') - 1]).trim() !== id) continue;
      const wasPublic = String(values[i][col('Publik') - 1] || '') === 'Ya';
      sheet.getRange(i + 1, col('Publik')).setValue(publik ? 'Ya' : '');
      if (publik) {
        sheet.getRange(i + 1, col('JudulPublik')).setValue(sheetText_(judul));
        sheet.getRange(i + 1, col('LokasiPublik')).setValue(sheetText_(lokasi));
        sheet.getRange(i + 1, col('CatatanPublik')).setValue(sheetText_(catatan));
        sheet.getRange(i + 1, col('PublikPada')).setValue(new Date());
        sheet.getRange(i + 1, col('PublikOleh')).setValue(sheetText_(session.username));
      }
      writeAuditLog_(publik ? 'PUBLISH_ASPIRASI' : 'UNPUBLISH_ASPIRASI', session.username, id, publik ? judul : '');
      invalidatePapanCache_();
      const owner = String(values[i][col('Username') - 1] || '').trim();
      if (publik && !wasPublic && owner) {
        queuePush_({ usernames: [owner] }, { title: 'Aspirasi Anda tampil di Papan Tindak Lanjut', body: 'Tanpa nama dan unit Anda. Bisa disembunyikan dari Riwayat Aspirasi.', page: 'riwayat' });
      }
      return { success: true, message: publik ? 'Aspirasi tampil di Papan Tindak Lanjut.' : 'Aspirasi disembunyikan dari papan.' };
    }
    return { success: false, notFound: true, message: 'Data tidak ditemukan. Muat ulang daftar aspirasi.' };
  });
}

// Pelapor menyembunyikan aspirasinya sendiri dari papan.
function hideMyAspirasiFromPapan(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const id = String(payload.id || '').trim();
  return withScriptLock_(function () {
    const sheet = getSheet_(SHEET_DATA);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const idCol = headers.indexOf('ID'), userCol = headers.indexOf('Username'), pubCol = headers.indexOf('Publik');
    if (pubCol < 0) return { success: false, message: 'Aspirasi ini tidak tampil di papan.' };
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idCol] || '').trim() !== id) continue;
      if (String(values[i][userCol] || '').toLowerCase() !== String(session.username || '').toLowerCase()) return { success: false, message: 'Hanya pelapor yang bisa menyembunyikan aspirasi ini.' };
      sheet.getRange(i + 1, pubCol + 1).setValue('');
      writeAuditLog_('UNPUBLISH_ASPIRASI', session.username, id, 'Disembunyikan oleh pelapor');
      invalidatePapanCache_();
      queuePush_({ admins: true }, { title: 'Aspirasi disembunyikan pelapor', body: 'Pelapor meminta aspirasinya tidak tampil di Papan Tindak Lanjut.', page: 'admin' });
      return { success: true, message: 'Aspirasi Anda tidak lagi tampil di papan.' };
    }
    return { success: false, message: 'Aspirasi tidak ditemukan.' };
  });
}

function toggleAspirasiDukungan(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const id = String(payload.id || '').trim();
  const row = getSheetData_(SHEET_DATA).find(function (r) { return String(r.ID || '') === id && String(r.Publik || '') === 'Ya'; });
  if (!row) return { success: false, message: 'Aspirasi ini tidak (lagi) ditampilkan di papan.' };
  if (String(row.Username || '').toLowerCase() === String(session.username || '').toLowerCase()) return { success: false, message: 'Ini aspirasi Anda sendiri.' };
  return withScriptLock_(function () {
    const sheet = getAspirasiDukunganSheet_();
    const values = sheet.getDataRange().getValues();
    const me = String(session.username || '').toLowerCase();
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]) === id && String(values[i][1]).toLowerCase() === me) {
        sheet.deleteRow(i + 1);
        return { success: true, didukung: false, dukungan: papanSupportIndex_(session.username).counts[id] || 0 };
      }
    }
    sheet.appendRow([sheetText_(id), sheetText_(session.username), new Date()]);
    return { success: true, didukung: true, dukungan: papanSupportIndex_(session.username).counts[id] || 0 };
  });
}

// ===================================================================
// v19 — DINDING APRESIASI (modul terpisah dari Aspirasi)
// -------------------------------------------------------------------
// Ucapan terima kasih langsung tampil. Penulis bisa menghapus miliknya sendiri;
// Admin dan Super Admin bisa menghapus apa pun (moderasi). Warga lain melihat
// pengirim sebagai jenis warga (Status_Wisma), bukan nama.
// ===================================================================
const SHEET_APRESIASI = 'Apresiasi';
const SHEET_APRESIASI_DUKUNGAN = 'ApresiasiDukungan';
const APRESIASI_HEADERS = ['ID', 'CreatedAt', 'Username', 'Untuk', 'UntukDetail', 'Pesan', 'Status', 'DihapusOleh', 'DihapusPada'];
const APRESIASI_TARGETS = ['Keamanan', 'Kebersihan', 'Teknisi', 'Pengelola', 'Pengurus', 'Sesama warga'];
const APRESIASI_MAX_PER_DAY = 5;

function getApresiasiSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_APRESIASI);
  if (!sheet) { sheet = ss.insertSheet(SHEET_APRESIASI); sheet.appendRow(APRESIASI_HEADERS); sheet.setFrozenRows(1); }
  return sheet;
}

function getApresiasiDukunganSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_APRESIASI_DUKUNGAN);
  if (!sheet) { sheet = ss.insertSheet(SHEET_APRESIASI_DUKUNGAN); sheet.appendRow(['ApresiasiID', 'Username', 'CreatedAt']); try { sheet.hideSheet(); } catch (ignore) {} }
  return sheet;
}

function getApresiasi(sessionToken) {
  const session = requireSession_(sessionToken, ['resident', 'admin', 'super_admin']);
  const me = String(session.username || '').toLowerCase();
  const canModerate = session.role === 'admin' || session.role === 'super_admin';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APRESIASI);
  if (!sheet || sheet.getLastRow() < 2) return { success: true, items: [], targets: APRESIASI_TARGETS, canModerate: canModerate };
  const counts = {}, mine = {};
  const dukSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APRESIASI_DUKUNGAN);
  if (dukSheet && dukSheet.getLastRow() > 1) getSheetData_(SHEET_APRESIASI_DUKUNGAN).forEach(function (row) {
    const id = String(row.ApresiasiID || ''); if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
    if (String(row.Username || '').toLowerCase() === me) mine[id] = true;
  });
  const labelOf = jelajahPublicLabeler_();
  const now = Date.now();
  const items = getSheetData_(SHEET_APRESIASI).filter(function (row) { return row.ID && String(row.Status || 'Aktif') === 'Aktif'; })
    .slice(-300).reverse().map(function (row) {
      const owner = String(row.Username || '').toLowerCase();
      const t = notificationDate_(row.CreatedAt);
      return {
        id: String(row.ID), untuk: String(row.Untuk || ''), untukDetail: String(row.UntukDetail || ''), pesan: String(row.Pesan || ''),
        dari: owner ? labelOf(owner) : 'Warga (akun dihapus)', waktuMs: t || 0, waktu: t ? formatTanggal_(new Date(t)) : '',
        milikSaya: !!owner && owner === me, bisaHapus: canModerate || (!!owner && owner === me),
        dukungan: counts[String(row.ID)] || 0, didukung: !!mine[String(row.ID)]
      };
    });
  return { success: true, items: items, targets: APRESIASI_TARGETS, canModerate: canModerate, serverNowMs: now };
}

function submitApresiasi(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const untuk = String(payload.untuk || '').trim();
  if (APRESIASI_TARGETS.indexOf(untuk) < 0) return { success: false, message: 'Pilih untuk siapa apresiasi ini.' };
  const untukDetail = String(payload.untukDetail || '').trim();
  if (untukDetail.length > 60) return { success: false, message: 'Keterangan penerima maksimal 60 karakter.' };
  const pesan = validateString_(payload.pesan, 'Pesan', 5, 280);
  if (/(\b0?8\d{8,}|\+?62\d{8,})/.test(pesan + ' ' + untukDetail)) return { success: false, message: 'Mohon jangan mencantumkan nomor telepon di dinding.' };
  return withScriptLock_(function () {
    const sheet = getApresiasiSheet_();
    const me = String(session.username || '').toLowerCase();
    const dayAgo = Date.now() - 86400000;
    const today = getSheetData_(SHEET_APRESIASI).filter(function (row) {
      return String(row.Username || '').toLowerCase() === me && notificationDate_(row.CreatedAt) > dayAgo;
    }).length;
    if (today >= APRESIASI_MAX_PER_DAY) return { success: false, message: 'Batas ' + APRESIASI_MAX_PER_DAY + ' apresiasi per hari sudah tercapai. Coba lagi besok.' };
    const id = 'P' + Utilities.getUuid().replace(/-/g, '').substring(0, 9).toUpperCase();
    sheet.appendRow([id, new Date(), sheetText_(session.username), untuk, sheetText_(untukDetail), sheetText_(pesan), 'Aktif', '', '']);
    writeAuditLog_('SUBMIT_APRESIASI', session.username, id, untuk);
    return { success: true, id: id, message: 'Terima kasih! Apresiasi Anda sudah tampil di dinding.' };
  });
}

function deleteApresiasi(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const id = String(payload.id || '').trim();
  const canModerate = session.role === 'admin' || session.role === 'super_admin';
  return withScriptLock_(function () {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APRESIASI);
    if (!sheet) return { success: false, message: 'Apresiasi tidak ditemukan.' };
    const values = sheet.getDataRange().getValues();
    const h = values[0].map(String);
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][h.indexOf('ID')]) !== id) continue;
      const owner = String(values[i][h.indexOf('Username')] || '').toLowerCase();
      if (!canModerate && owner !== String(session.username || '').toLowerCase()) return { success: false, message: 'Hanya penulis, Admin, atau Super Admin yang bisa menghapus.' };
      sheet.getRange(i + 1, h.indexOf('Status') + 1).setValue('Dihapus');
      sheet.getRange(i + 1, h.indexOf('DihapusOleh') + 1).setValue(sheetText_(session.username));
      sheet.getRange(i + 1, h.indexOf('DihapusPada') + 1).setValue(new Date());
      writeAuditLog_('DELETE_APRESIASI', session.username, id, owner === String(session.username || '').toLowerCase() ? 'oleh penulis' : 'moderasi');
      return { success: true, message: 'Apresiasi dihapus dari dinding.' };
    }
    return { success: false, message: 'Apresiasi tidak ditemukan.' };
  });
}

function toggleApresiasiDukungan(payload) {
  const session = requireSession_(payload && payload.sessionToken, ['resident', 'admin', 'super_admin']);
  const id = String(payload.id || '').trim();
  const exists = getSheet_(SHEET_APRESIASI) && getSheetData_(SHEET_APRESIASI).some(function (row) { return String(row.ID) === id && String(row.Status || 'Aktif') === 'Aktif'; });
  if (!exists) return { success: false, message: 'Apresiasi ini sudah tidak ada.' };
  return withScriptLock_(function () {
    const sheet = getApresiasiDukunganSheet_();
    const values = sheet.getDataRange().getValues();
    const me = String(session.username || '').toLowerCase();
    let count = 0, found = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]) !== id) continue;
      count++;
      if (String(values[i][1]).toLowerCase() === me) found = i;
    }
    if (found > 0) { sheet.deleteRow(found + 1); return { success: true, didukung: false, dukungan: count - 1 }; }
    sheet.appendRow([sheetText_(id), sheetText_(session.username), new Date()]);
    return { success: true, didukung: true, dukungan: count + 1 };
  });
}

// ===================================================================
// v19 — RETENSI DATA (sesuai Kebijakan Privasi), dijalankan pemicu harian
// -------------------------------------------------------------------
//   AuditLog ............................ 1 tahun
//   ErrorLog ............................ 60 hari (ERROR_LOG_RETENTION_DAYS)
//   ArsipAkunDihapus .................... 1 tahun
//   LogNotifikasi ....................... 2.000 baris terbaru (pruneNotificationLog_)
//   Apresiasi yang sudah dihapus ........ 90 hari, lalu barisnya dihapus
//   Kepuasan ............................ username dikosongkan setelah 1 tahun (skor tetap)
//   Aspirasi ............................ identitas pelapor dianonimkan setelah 3 tahun
//                                         (isi tetap sebagai arsip pengelolaan gedung)
//   Akun tanpa profil lengkap ........... 7 hari (pembersihan akun)
//   Sesi masuk .......................... 6 jam / 30 hari ("Ingat saya")
// ===================================================================
const RETENTION_DAYS = { audit: 365, archive: 365, apresiasiDeleted: 90, kepuasanUser: 365, aspirasiIdentity: 365 * 3 };
const RETENTION_MAX_ROWS_PER_RUN = 3000;

// Untuk log yang ditulis berurutan (kolom pertama = waktu): hapus baris terlama sekaligus.
function pruneLogByAge_(sheetName, days) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const limit = Math.min(sheet.getLastRow() - 1, RETENTION_MAX_ROWS_PER_RUN);
  const stamps = sheet.getRange(2, 1, limit, 1).getValues();
  const cutoff = Date.now() - days * 86400000;
  let n = 0;
  while (n < stamps.length) {
    const t = notificationDate_(stamps[n][0]);
    if (!t || t >= cutoff) break;
    n++;
  }
  if (n > 0) sheet.deleteRows(2, n);
  return n;
}

function applyDataRetention_() {
  const report = {};
  const cutoff = function (days) { return Date.now() - days * 86400000; };
  report.auditLog = pruneLogByAge_(AUDIT_SHEET, RETENTION_DAYS.audit);
  report.errorLog = pruneLogByAge_('ErrorLog', ERROR_LOG_RETENTION_DAYS);
  report.arsipAkun = pruneLogByAge_(SHEET_ACCOUNT_ARCHIVE, RETENTION_DAYS.archive);

  // Apresiasi yang sudah dihapus: buang barisnya setelah 90 hari.
  const ap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APRESIASI);
  report.apresiasiDihapus = 0;
  if (ap && ap.getLastRow() > 1) {
    const v = ap.getDataRange().getValues(); const h = v[0].map(String);
    for (let i = v.length - 1; i >= 1; i--) {
      if (String(v[i][h.indexOf('Status')]) === 'Dihapus' && notificationDate_(v[i][h.indexOf('DihapusPada')]) < cutoff(RETENTION_DAYS.apresiasiDeleted)) {
        ap.deleteRow(i + 1); report.apresiasiDihapus++;
      }
    }
  }

  // Kepuasan: kosongkan username setelah 1 tahun.
  report.kepuasan = 0;
  const kp = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_KEPUASAN);
  if (kp && kp.getLastRow() > 1) {
    const v = kp.getDataRange().getValues(); const h = v[0].map(String);
    const uc = h.indexOf('Username'), tc = h.indexOf('Timestamp');
    if (uc >= 0 && tc >= 0) for (let i = 1; i < v.length && report.kepuasan < RETENTION_MAX_ROWS_PER_RUN; i++) {
      if (v[i][uc] && notificationDate_(v[i][tc]) && notificationDate_(v[i][tc]) < cutoff(RETENTION_DAYS.kepuasanUser)) { kp.getRange(i + 1, uc + 1).setValue(''); report.kepuasan++; }
    }
  }

  // Aspirasi: anonimkan identitas pelapor setelah 3 tahun.
  report.aspirasi = 0;
  const as = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DATA);
  if (as && as.getLastRow() > 1) {
    const v = as.getDataRange().getValues(); const h = v[0].map(String);
    const c = function (name) { return h.indexOf(name); };
    for (let i = 1; i < v.length && report.aspirasi < RETENTION_MAX_ROWS_PER_RUN; i++) {
      const t = notificationDate_(v[i][c('Timestamp')]);
      if (!t || t >= cutoff(RETENTION_DAYS.aspirasiIdentity)) continue;
      const alreadyDone = !v[i][c('Username')] && /\(akun dihapus\)|\(diarsipkan\)/.test(String(v[i][c('Nama')] || ''));
      if (alreadyDone) continue;
      const set = function (name, value) { if (c(name) >= 0) as.getRange(i + 1, c(name) + 1).setValue(value); };
      set('Nama', sheetText_((nameInitials_(v[i][c('Nama')]) ? 'Warga ' + nameInitials_(v[i][c('Nama')]) : 'Warga') + ' (diarsipkan)'));
      set('Username', ''); set('Email_Pengisi', '');
      if (c('Nomor_WhatsApp') >= 0) set('Nomor_WhatsApp', sealPersonalValue_(v[i][c('Nomor_WhatsApp')], 'wa'));
      if (c('Unit') >= 0) set('Unit', sealPersonalValue_(v[i][c('Unit')], 'unit'));
      report.aspirasi++;
    }
  }
  if (Object.keys(report).some(function (k) { return report[k] > 0; })) writeAuditLog_('RETENSI_DATA', 'sistem', 'harian', JSON.stringify(report));
  return report;
}
