// Tiruan minimal layanan Google Apps Script untuk menguji Code.gs di Node.
// Bukan pengganti uji di Apps Script sungguhan; hanya meniru perilaku yang
// dipakai fungsi sesi, registrasi, dan router doPost.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

function toSigned(buf) { return Array.from(buf).map(function (b) { return b > 127 ? b - 256 : b; }); }

function makeSheet(name, rows) {
  const data = rows ? rows.map(function (r) { return r.slice(); }) : [];
  const sheet = {
    name: name, hidden: false, data: data,
    getName: function () { return name; },
    getLastRow: function () { return data.length; },
    getLastColumn: function () { return data.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    appendRow: function (row) { data.push(row.slice()); return sheet; },
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
            for (let c = 0; c < values[r].length; c++) data[row - 1 + r][col - 1 + c] = values[r][c];
          }
        },
        setValue: function (v) { if (!data[row - 1]) data[row - 1] = []; data[row - 1][col - 1] = v; },
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
  const ctx = {
    console: console, JSON: JSON, Math: Math, Date: FakeDate, Number: Number, String: String, Array: Array, Object: Object,
    RegExp: RegExp, Error: Error, Set: Set,
    CacheService: { getScriptCache: function () { return {
      get: function (k) { const e = cacheStore[k]; if (!e) return null; if (e.exp < now) { delete cacheStore[k]; return null; } return e.v; },
      put: function (k, v, ttl) { cacheStore[k] = { v: String(v), exp: now + (ttl || 600) * 1000 }; },
      remove: function (k) { delete cacheStore[k]; }
    }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return props[k] === undefined ? null : props[k]; },
      setProperty: function (k, v) { props[k] = String(v); }
    }; } },
    LockService: { getScriptLock: function () { return {
      waitLock: function () { if (lockHeld) throw new Error('nested lock (deadlock in real Apps Script)'); lockHeld++; },
      releaseLock: function () { lockHeld = Math.max(0, lockHeld - 1); }
    }; } },
    Utilities: {
      getUuid: function () { return crypto.randomUUID(); },
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: function (alg, text) { return toSigned(crypto.createHash('sha256').update(String(text), 'utf8').digest()); },
      computeHmacSha256Signature: function (text, key) { return toSigned(crypto.createHmac('sha256', String(key)).update(String(text), 'utf8').digest()); },
      formatDate: function (d) { return new RealDate(d).toISOString().slice(0, 10); }
    },
    SpreadsheetApp: { getActiveSpreadsheet: function () { return {
      getSheetByName: function (n) { return sheets[n] || null; },
      insertSheet: function (n) { sheets[n] = makeSheet(n, []); return sheets[n]; },
      getSpreadsheetTimeZone: function () { return 'Asia/Jakarta'; }
    }; } },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: function (t) { return { text: t, setMimeType: function () { return this; }, getContent: function () { return t; } }; }
    },
    ScriptApp: { getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/TEST/exec'; } }; } },
    HtmlService: {}
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(options.codePath, 'utf8'), ctx, { filename: 'Code.gs' });
  return {
    ctx: ctx, sheets: sheets, cacheStore: cacheStore, props: props,
    advance: function (ms) { now += ms; },
    clearCache: function () { Object.keys(cacheStore).forEach(function (k) { delete cacheStore[k]; }); },
    lockHeld: function () { return lockHeld; }
  };
}

module.exports = { createContext: createContext };
