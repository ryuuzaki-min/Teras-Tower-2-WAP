// Tiruan minimal layanan Google Apps Script untuk menguji Code.gs di Node.
// Bukan pengganti uji di Apps Script sungguhan; hanya meniru perilaku yang
// dipakai fungsi sesi, registrasi, dan router doPost.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

function toSigned(buf) { return Array.from(buf).map(function (b) { return b > 127 ? b - 256 : b; }); }

// Seperti Google Sheets: teks berawalan tanda petik disimpan tanpa tanda petiknya.
// v18 (A8): teks berawalan = + - @ TANPA tanda petik akan dijadikan rumus oleh Sheets.
// Tiruan mencatatnya di FORMULA_HITS agar uji bisa memastikan tidak ada injeksi rumus.
const FORMULA_HITS = [];
function cell(v, sheetName) {
  if (typeof v !== 'string') return v;
  if (v.charAt(0) === "'") return v.slice(1);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(v)) FORMULA_HITS.push({ sheet: sheetName || '?', value: v });
  return v;
}
function makeSheet(name, rows) {
  const data = rows ? rows.map(function (r) { return r.slice(); }) : [];
  const sheet = {
    name: name, hidden: false, data: data,
    getName: function () { return name; },
    getLastRow: function () { return data.length; },
    getLastColumn: function () { return data.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    maxRows: 1000, maxCols: 26,
    getMaxRows: function () { return Math.max(sheet.maxRows, data.length); },
    getMaxColumns: function () { return Math.max(sheet.maxCols, sheet.getLastColumn()); },
    appendRow: function (row) { data.push(row.map(function (v) { return cell(v, name); })); return sheet; },
    deleteRow: function (n) { data.splice(n - 1, 1); },
    setFrozenRows: function () {},
    hideSheet: function () { sheet.hidden = true; },
    getDataRange: function () { return sheet.getRange(1, 1, Math.max(1, data.length), Math.max(1, sheet.getLastColumn())); },
    getRange: function (row, col, numRows, numCols) {
      if (typeof row === 'string') throw new Error('A1 notation not mocked');
      numRows = numRows || 1; numCols = numCols || 1;
      return {
        getValues: function () {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const src = data[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            out.push(line);
          }
          return out;
        },
        setValues: function (values) {
          for (let r = 0; r < values.length; r++) {
            if (!data[row - 1 + r]) data[row - 1 + r] = [];
            for (let c = 0; c < values[r].length; c++) data[row - 1 + r][col - 1 + c] = cell(values[r][c], name);
          }
        },
        getValue: function () { const v = (data[row - 1] || [])[col - 1]; return v === undefined ? '' : v; },
        setValue: function (v) { if (!data[row - 1]) data[row - 1] = []; data[row - 1][col - 1] = cell(v, name); },
        clearContent: function () { for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) if (data[row - 1 + r]) data[row - 1 + r][col - 1 + c] = ''; return this; },
        setNumberFormat: function () { return this; },
        createTextFinder: function (text) {
          return {
            matchEntireCell: function () { return this; },
            findNext: function () {
              for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) {
                const v = (data[row - 1 + r] || [])[col - 1 + c];
                if (String(v) === String(text)) return { getRow: function () { return row + r; } };
              }
              return null;
            }
          };
        }
      };
    }
  };
  return sheet;
}

function createContext(options) {
  options = options || {};
  const sheets = {};
  Object.keys(options.sheets || {}).forEach(function (n) { sheets[n] = makeSheet(n, options.sheets[n]); });
  const cacheStore = {};
  const props = {};
  let now = options.now || Date.UTC(2026, 10, 17, 5, 0, 0);
  const RealDate = Date;
  function FakeDate() {
    if (arguments.length === 0) return new RealDate(now);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  FakeDate.now = function () { return now; };
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse; FakeDate.prototype = RealDate.prototype;

  let lockHeld = 0;
  const triggers = [];
  // Tiruan HTTP: options.http(url, params) -> { code, body }. Semua panggilan dicatat.
  const http = { calls: [], batches: [], lockAtCall: [], fetch: function (url, params) {
    http.calls.push({ url: url, params: params });
    http.lockAtCall.push(lockHeld);
    const res = (options.http || function () { return { code: 200, body: '{}' }; })(url, params);
    return { getResponseCode: function () { return res.code; }, getContentText: function () { return res.body; }, getAllHeaders: function () { return res.headers || {}; } };
  } };
  const ctx = {
    console: console, JSON: JSON, Math: Math, Date: FakeDate, Number: Number, String: String, Array: Array, Object: Object,
    RegExp: RegExp, Error: Error, Set: Set,
    CacheService: { getScriptCache: function () { return {
      get: function (k) { const e = cacheStore[k]; if (!e) return null; if (e.exp < now) { delete cacheStore[k]; return null; } return e.v; },
      put: function (k, v, ttl) { cacheStore[k] = { v: String(v), exp: now + (ttl || 600) * 1000 }; },
      remove: function (k) { delete cacheStore[k]; },
      removeAll: function (keys) { (keys || []).forEach(function (k) { delete cacheStore[k]; }); }
    }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return props[k] === undefined ? null : props[k]; },
      setProperties: function (o) { Object.keys(o).forEach(function (k) { props[k] = String(o[k]); }); },
      setProperty: function (k, v) { props[k] = String(v); }
    }; } },
    LockService: { getScriptLock: function () { return {
      waitLock: function () { if (lockHeld) throw new Error('nested lock (deadlock in real Apps Script)'); lockHeld++; },
      releaseLock: function () { lockHeld = Math.max(0, lockHeld - 1); }
    }; } },
    Utilities: {
      getUuid: function () { return crypto.randomUUID(); },
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: function (alg, text) { return toSigned(crypto.createHash('sha256').update(String(text), 'utf8').digest()); },
      computeHmacSha256Signature: function (text, key) { return toSigned(crypto.createHmac('sha256', String(key)).update(String(text), 'utf8').digest()); },
      formatDate: function (d, tz, pattern) {
        const iso = new RealDate(new RealDate(d).getTime() + 7 * 3600000).toISOString();
        if (pattern === 'dd/MM/yyyy') return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
        if (pattern === 'yyyyMMddHHmmss') return iso.replace(/[-:T]/g, '').slice(0, 14);
        return iso.slice(0, 10);
      },
      base64EncodeWebSafe: function (value) {
        const buf = Array.isArray(value) ? Buffer.from(value.map(function (b) { return b < 0 ? b + 256 : b; })) : Buffer.from(String(value), 'utf8');
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      },
      computeRsaSha256Signature: function (input, key) {
        return toSigned(crypto.sign('RSA-SHA256', Buffer.from(input, 'utf8'), key));
      }
    },
    UrlFetchApp: {
      fetch: function (url, params) { return http.fetch(url, params); },
      fetchAll: function (requests) { http.batches.push(requests.length); return requests.map(function (r) { return http.fetch(r.url, r); }); }
    },
    // Tiruan layanan Maps: options.maps = { geocode(query) -> {results}, reverse(lat,lng) -> {results} }
    Maps: { newGeocoder: function () { const g = { calls: [],
      setRegion: function () { return g; }, setLanguage: function () { return g; }, setBounds: function () { return g; },
      geocode: function (q) { (ctx.__geoCalls = ctx.__geoCalls || []).push(q); return (options.maps && options.maps.geocode || function () { return { status: 'ZERO_RESULTS', results: [] }; })(q); },
      reverseGeocode: function (la, ln) { (ctx.__geoCalls = ctx.__geoCalls || []).push(la + ',' + ln); return (options.maps && options.maps.reverse || function () { return { results: [] }; })(la, ln); } }; return g; } },
    ScriptApp: {
      getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/TEST/exec'; } }; },
      getProjectTriggers: function () { return triggers.slice(); },
      deleteTrigger: function (t) { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: function (handler) {
        const spec = { handler: handler };
        const builder = { timeBased: function () { return builder; }, everyDays: function (n) { spec.everyDays = n; return builder; },
          atHour: function (h) { spec.atHour = h; return builder; }, inTimezone: function (tz) { spec.tz = tz; return builder; },
          create: function () { const uid = 'trg-' + (triggers.length + 1) + '-' + handler; const t = { spec: spec, getHandlerFunction: function () { return handler; }, getUniqueId: function () { return uid; } }; triggers.push(t); return t; } };
        return builder;
      }
    },
    SpreadsheetApp: { getActiveSpreadsheet: function () { return {
      getSheetByName: function (n) { return sheets[n] || null; },
      getSheets: function () { return Object.keys(sheets).map(function (n) { return sheets[n]; }); },
      insertSheet: function (n) { sheets[n] = makeSheet(n, []); return sheets[n]; },
      getSpreadsheetTimeZone: function () { return 'Asia/Jakarta'; }
    }; } },
    Session: { getScriptTimeZone: function () { return 'Asia/Jakarta'; },
      // Default meniru menjalankan dari editor oleh pemilik; uji pengunjung web memakai options.activeEmail = ''.
      getActiveUser: function () { const e = options.activeEmail === undefined ? 'pemilik@contoh.id' : options.activeEmail; return { getEmail: function () { return e; } }; },
      getEffectiveUser: function () { return { getEmail: function () { return 'pemilik@contoh.id'; } }; } },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: function (t) { return { text: t, setMimeType: function () { return this; }, getContent: function () { return t; } }; }
    },
    HtmlService: {}
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(options.codePath, 'utf8'), ctx, { filename: 'Code.gs' });
  return {
    ctx: ctx, sheets: sheets, cacheStore: cacheStore, props: props,
    advance: function (ms) { now += ms; },
    clearCache: function () { Object.keys(cacheStore).forEach(function (k) { delete cacheStore[k]; }); },
    lockHeld: function () { return lockHeld; },
    http: http,
    triggers: triggers,
    // v17: ganti identitas pemanggil di tengah uji ('' = pengunjung web anonim).
    setActiveEmail: function (email) { options.activeEmail = email; }
  };
}

module.exports = { createContext: createContext, FORMULA_HITS: FORMULA_HITS };
