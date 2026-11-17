"""Regresi: halaman berjalan dalam mode Apps Script (google.script.run, tanpa app-shell)."""
import json, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
WWW = sys.argv[1]
h = functools.partial(SimpleHTTPRequestHandler, directory=WWW); h.log_message = lambda *a: None
srv = ThreadingHTTPServer(('127.0.0.1', 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = r"""
window.__calls = [];
const USER = {username:'budi',name:'Budi',isAdmin:false,isSuperAdmin:false,profileComplete:true,sessionToken:'t'};
const T = {loginWithPin:{success:true,user:USER},validateSession:{valid:true,username:'budi',role:'resident'},
  getResidentNotificationSummary:{updates:0},getRekapKepuasan:{global:4.2,jumlahResponden:3},getMyKepuasanThisWeek:[],getKontakData:{nomorPenting:[],nomorDarurat:[{Nama:'Ambulans',Nomor:'118',Kategori:'Umum'}]}};
function mk(st){return new Proxy({},{get(_,p){ if(typeof p==='symbol'||p==='then')return undefined;
 if(p==='withSuccessHandler')return h=>mk({...st,s:h}); if(p==='withFailureHandler')return h=>mk({...st,f:h});
 if(p==='withUserObject')return o=>mk({...st,u:o});
 return function(){ window.__calls.push({fn:p,args:[...arguments]}); setTimeout(()=>{ if(st.s) st.s(T[p]===undefined?null:T[p], st.u); },20); };}});}
window.google = {script:{run: mk({})}};
"""
ok = True
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
    c.add_init_script(FAKE)
    c.route('**/app-shell.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='/* mode GAS: tidak dimuat */'))
    c.route('https://script.google.com/**', lambda r: (_ for _ in ()).throw(Exception('fetch tidak boleh dipakai di mode GAS')))
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:%d/' % srv.server_address[1])
    pg.evaluate("document.getElementById('tt2Splash') && document.getElementById('tt2Splash').remove()")
    pg.wait_for_selector('#loginScreen', state='visible')
    def check(n, cond, d=''):
        global ok; ok = ok and bool(cond); print(('  ✓ ' if cond else '  ✗ ') + n + ('' if cond else ' — ' + str(d)))
    print('Mode Apps Script (regresi versi web)')
    check('TT2Remote nonaktif di dalam Apps Script', pg.evaluate('window.TT2Remote.enabled === false'))
    check('riwayat navigasi nonaktif (iframe Google)', pg.evaluate('appHistory.enabled === false'))
    hist0 = pg.evaluate('history.length')
    pg.fill('#loginUsername', 'budi'); pg.fill('#loginPin', '123456'); pg.click('#btnLogin')
    pg.wait_for_selector('#mainScreen', state='visible'); pg.wait_for_timeout(300)
    calls = pg.evaluate('window.__calls')
    check('login lewat google.script.run, membawa remember', any(x['fn'] == 'loginWithPin' and x['args'][0].get('remember') is True for x in calls))
    pg.click('#bottomNavUser [data-page="kontakDarurat"]'); pg.wait_for_timeout(300)
    check('navigasi & data tampil', 'Ambulans' in pg.inner_text('#pageContent'))
    hist = pg.evaluate('history.length')
    check('tidak menambah history di mode GAS', hist == hist0, (hist0, hist))
    check('tidak ada error JavaScript', not errs, errs[:3])
    b.close()
srv.shutdown()
sys.exit(0 if ok else 1)
