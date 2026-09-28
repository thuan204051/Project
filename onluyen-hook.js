/* =====================================================================
 * onluyen-hook.js  (v2)  — bắt dữ liệu đề thi, có bảng trạng thái + chẩn đoán
 *
 * CÁCH DÙNG (đúng thứ tự — quan trọng):
 *   1. Mở Chrome → đăng nhập app.onluyen.vn (hoặc thi.onluyen.vn) → vào trang đề.
 *   2. F12 → tab Console → dán toàn bộ file này → Enter.
 *      → Thấy bảng "🟢 Hook đang chạy" ở góc dưới bên trái = đã cài.
 *   3. BẤM F5 để tải lại trang (hook phải có mặt TRƯỚC khi web gọi API lấy đề).
 *   4. Bấm vào đề / làm vài câu / chuyển câu.
 *   5. Bảng ở góc dưới hiện số file bắt được → bấm "Tải hết .json" → nạp vào player.
 *
 * GÕ 1 TRONG CÁC LỆNH NÀY KHI CẦN:
 *   __ochandoan()        → in báo cáo: hook sống không, đã thấy request nào, dữ liệu ở đâu
 *   __olonReplay()       → thử GỌI LẠI các API đã thấy (cứu dữ liệu tải trước khi cài hook)
 *   __hookScan()         → quét lại HTML trang hiện tại
 *   __olonSave()         → tải tất cả những gì đã bắt được
 *   __olonClear()        → xoá dữ liệu đã bắt trong phiên
 *
 * Chỉ dùng cho học tập/ôn luyện cá nhân. Nội dung đề thuộc bản quyền của đơn vị
 * phát hành (Edmicro) — không đăng lại công khai.
 * ===================================================================== */
(function () {
  'use strict';

  if (window.__OL_HOOK_V2__) {
    console.warn('[hook] Hook đã được cài từ trước — không cài lại. Gõ __ochandoan() để xem trạng thái.');
    return;
  }
  window.__OL_HOOK_V2__ = true;

  var CAPS = (window.__OL_CAPS__ = window.__OL_CAPS__ || []);   // dữ liệu đã bắt
  var LOG = (window.__OL_LOG__ = window.__OL_LOG__ || []);      // mọi request đã thấy
  var SEEN = Object.create(null);
  var inFrame = false;
  try { inFrame = (window.top !== window.self); } catch (e) { inFrame = true; }

  /* ---------------- nhận diện dữ liệu đề ---------------- */
  var MARK = [
    'numberQuestion', 'dataStandard', 'dataMaterial', 'languagesData', 'listSection',
    'totalQuestion', 'listAnswer', 'stepId', 'questionId', 'correct_answer', 'correctanswer',
    'answerUrlPremade', 'assignmentCode', 'maxScoreMultipleChoice', 'maxScoreEssay'
  ];
  function scoreText(text) {
    var s = 0, t = String(text || '');
    for (var i = 0; i < MARK.length; i++) if (t.indexOf(MARK[i]) >= 0) s += 2;
    if (/"questions"|"question_list"|"list_question"/.test(t)) s += 3;
    if (/"options"|"answers"|"choices"/.test(t)) s += 2;
    if (/"content"|"contentHtml"/.test(t)) s += 1;
    return s;
  }
  function looksRelevant(text) { return scoreText(text) >= 5; }

  /* ---------------- lưu tạm để không mất khi F5 ---------------- */
  function persist() {
    try {
      var pack = CAPS.slice(-12).map(function (c) {
        return { url: c.url, text: c.text.length > 6000000 ? c.text.slice(0, 6000000) : c.text, kind: c.kind };
      });
      localStorage.setItem('__ol_caps__', JSON.stringify(pack));
    } catch (e) {}
  }
  function restore() {
    try {
      var raw = localStorage.getItem('__ol_caps__');
      if (!raw) return;
      JSON.parse(raw).forEach(function (c) {
        if (!c || !c.text) return;
        var k = (c.url || '') + '|' + c.text.length;
        if (SEEN[k]) return;
        SEEN[k] = 1;
        CAPS.push({ url: c.url || 'khôi phục', text: c.text, kind: c.kind || 'restore', at: Date.now() });
      });
    } catch (e) {}
  }

  var reqCount = 0;

  /* ---------------- bảng trạng thái (luôn hiện) ---------------- */
  var panel = null, listEl = null, headEl = null, bodyEl = null;
  function ui() {
    if (!document.body) return null;
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = '__ol_panel';
    panel.style.cssText = 'position:fixed;z-index:2147483647;left:10px;bottom:10px;max-width:420px;' +
      'font:12.5px/1.5 system-ui,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#fff;' +
      'border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);overflow:hidden';
    headEl = document.createElement('div');
    headEl.style.cssText = 'background:#0f172a;color:#fff;padding:7px 10px;font-weight:700;display:flex;gap:8px;align-items:center';
    panel.appendChild(headEl);
    bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'padding:8px 10px;display:none;max-height:260px;overflow:auto';
    panel.appendChild(bodyEl);
    listEl = document.createElement('div');
    bodyEl.appendChild(listEl);
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';
    [['Tải hết .json', function () { window.__olonSave(); }],
     ['Gọi lại API (replay)', function () { window.__olonReplay(); }],
     ['Báo cáo chẩn đoán', function () { window.__ochandoan(); }],
     ['Quét lại HTML', function () { window.__hookScan(); }]].forEach(function (b) {
      var bt = document.createElement('button');
      bt.textContent = b[0];
      bt.style.cssText = 'font:12px/1 system-ui;padding:6px 9px;border:1px solid #cbd5e1;background:#f8fafc;' +
        'border-radius:8px;cursor:pointer;color:#0f172a';
      bt.onclick = b[1];
      btnRow.appendChild(bt);
    });
    bodyEl.appendChild(btnRow);
    headEl.onclick = function () {
      var open = bodyEl.style.display !== 'none';
      bodyEl.style.display = open ? 'none' : 'block';
    };
    document.body.appendChild(panel);
    return panel;
  }

  function render() {
    try {
      ui();
      if (!headEl) return;
      var live = '🟢 Hook đang chạy';
      if (inFrame) live = '🟠 Hook trong khung (iframe)';
      headEl.textContent = live + ' — ' + reqCount + ' request · ' + CAPS.length + ' file' +
        (bodyEl && bodyEl.style.display === 'none' ? '  ▾' : '  ▴');
      if (!listEl) return;
      listEl.innerHTML = '';
      if (!CAPS.length) {
        var p = document.createElement('div');
        p.style.color = '#475569';
        p.textContent = 'Chưa bắt được gì. Hãy BẤM F5 tải lại trang (hook phải có trước khi web gọi API), ' +
          'rồi bấm vào đề. Vẫn không được → bấm "Báo cáo chẩn đoán".';
        listEl.appendChild(p);
      }
      CAPS.forEach(function (c, i) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid #eef2f7';
        var a = downloadLink(c.text, fileName(c.url, i));
        a.textContent = '⬇ ' + fileName(c.url, i) + ' (' + Math.round(c.text.length / 1024) + ' KB)';
        a.style.cssText = 'color:#1d4ed8;text-decoration:underline;cursor:pointer;flex:1;word-break:break-all';
        row.appendChild(a);
        listEl.appendChild(row);
      });
      var last = LOG.slice(-6);
      if (last.length) {
        var lb = document.createElement('div');
        lb.style.cssText = 'margin-top:8px;padding-top:6px;border-top:1px dashed #cbd5e1;color:#64748b';
        lb.innerHTML = 'Request gần đây:<br>' + last.map(function (r) {
          return '· ' + r.method + ' ' + shorten(r.url) + (r.status ? ' → ' + r.status : '') +
            (r.len ? ' · ' + Math.round(r.len / 1024) + ' KB' : '') + (r.hit ? ' ✅' : '');
        }).join('<br>');
        listEl.appendChild(lb);
      }
    } catch (e) {}
  }
  function shorten(u) {
    u = String(u || '');
    try {
      var x = new URL(u, location.href);
      var q = x.search ? '?' + (x.search.length > 40 ? x.search.slice(0, 40) + '…' : x.search.slice(1)) : '';
      return x.host + x.pathname.slice(-46) + q;
    } catch (e) { return u.slice(0, 70); }
  }
  function fileName(url, i) {
    var base = String(url || 'capture').split('?')[0].split('/').filter(Boolean).slice(-2).join('_') || 'capture';
    base = base.replace(/[^\w.-]+/g, '_').slice(0, 60);
    return (i + 1) + '_' + base + '.json';
  }
  function isAsset(url) {
    return /\.(js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|mp3)(\?|$)/i.test(String(url));
  }

  function addCap(url, text, kind) {
    if (!text || typeof text !== 'string') return false;
    var key = String(url || '') + '|' + text.length;
    if (SEEN[key]) return false;
    var sc = scoreText(text);
    if (sc < 5) return false;
    SEEN[key] = 1;
    CAPS.push({ url: url || 'inline', text: text, kind: kind || 'http', at: Date.now(), score: sc });
    console.log('%c[hook] ✅ bắt được dữ liệu đề (' + Math.round(text.length / 1024) + ' KB, điểm ' + sc + '):',
      'color:#15803d;font-weight:bold', url || '(trong trang)');
    persist();
    render();
    return true;
  }

  /** Tạo link tải: dùng blob URL, nếu trang chặn (CSP) hoặc môi trường không hỗ trợ thì lùi về data URI */
  function downloadLink(text, name, mime) {
    var a = document.createElement('a');
    var url = '';
    try { url = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' })); }
    catch (e) { url = ''; }
    if (!url) {
      try { url = 'data:' + (mime || 'application/json') + ';charset=utf-8,' + encodeURIComponent(text.slice(0, 1500000)); }
      catch (e2) { url = ''; }
    }
    if (url) a.href = url;
    a.download = name;
    return a;
  }
  function saveFile(text, name, mime) {
    try {
      var a = downloadLink(text, name, mime);
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 1) fetch ---------------- */
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = '', method = 'GET', body = '';
      try {
        url = (typeof input === 'string') ? input : (input && input.url) || '';
        method = (init && init.method) || (input && input.method) || 'GET';
        body = (init && init.body) ? (typeof init.body === 'string' ? init.body : '[body]') : '';
      } catch (e) {}
      reqCount++;
      var rec = { method: method, url: url, body: body, at: Date.now() };
      LOG.push(rec);
      render();
      return origFetch.apply(this, arguments).then(function (res) {
        try {
          rec.status = res.status;
          var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
          var len = Number((res.headers && res.headers.get && res.headers.get('content-length')) || 0);
          if (len) rec.len = len;
          var texty = /json|text|javascript|html/i.test(ct) || !ct;
          if (texty && !isAsset(url)) {
            res.clone().text().then(function (txt) {
              rec.len = rec.len || (txt ? txt.length : 0);
              if (txt && addCap(url, txt, 'fetch')) rec.hit = 1;
              render();
            }, function () {});
          }
        } catch (e) {}
        return res;
      }, function (err) { reqCount++; throw err; });
    };
  }

  /* ---------------- 2) XMLHttpRequest ---------------- */
  var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__ol = { method: method, url: url }; } catch (e) {}
    return oOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    try {
      reqCount++;
      var rec = xhr.__ol || { method: 'XHR', url: '' };
      if (body) rec.body = typeof body === 'string' ? body : '[body]';
      LOG.push(rec);
      render();
      xhr.addEventListener('load', function () {
        try {
          rec.status = xhr.status;
          var ct = xhr.getResponseHeader && (xhr.getResponseHeader('content-type') || '');
          var txt = xhr.responseText;
          rec.len = txt ? txt.length : 0;
          var texty = /json|text|html|javascript/i.test(ct) || !ct;
          if (texty && txt && !isAsset(rec.url) && addCap(rec.url, txt, 'xhr')) rec.hit = 1;
        } catch (e) {}
        render();
      });
      xhr.addEventListener('error', function () { rec.status = 'lỗi'; render(); });
    } catch (e) {}
    return oSend.apply(this, arguments);
  };

  /* ---------------- 3) WebSocket / EventSource / sendBeacon ---------------- */
  try {
    var OWS = window.WebSocket;
    if (OWS) {
      window.WebSocket = function (url, proto) {
        var ws = proto ? new OWS(url, proto) : new OWS(url);
        try {
          LOG.push({ method: 'WS', url: url });
          reqCount++;
          render();
          ws.addEventListener('message', function (ev) {
            try {
              var d = typeof ev.data === 'string' ? ev.data : '';
              if (d) { if (addCap(url, d, 'websocket')) { var r = LOG[LOG.length - 1]; r.hit = 1; } }
            } catch (e) {}
          });
        } catch (e) {}
        return ws;
      };
      window.WebSocket.prototype = OWS.prototype;
    }
  } catch (e) {}
  try {
    var OES = window.EventSource;
    if (OES) {
      window.EventSource = function (url, cfg) {
        try { LOG.push({ method: 'SSE', url: url }); reqCount++; render(); } catch (e) {}
        return cfg ? new OES(url, cfg) : new OES(url);
      };
    }
  } catch (e) {}
  try {
    var OBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (OBeacon) navigator.sendBeacon = function (url, data) {
      try { LOG.push({ method: 'BEACON', url: url }); reqCount++; render(); } catch (e) {}
      return OBeacon(url, data);
    };
  } catch (e) {}

  /* ---------------- 4) quét HTML trang ---------------- */
  function scanPage() {
    var n = 0;
    try {
      if (addCap('inline-html', document.documentElement.outerHTML, 'inline')) n++;
    } catch (e) {}
    // quét cả các <script> chứa JSON nhúng
    try {
      Array.prototype.forEach.call(document.querySelectorAll('script:not([src])'), function (sc) {
        var t = sc.textContent || '';
        if (t.length > 300 && looksRelevant(t)) { if (addCap('inline-script', t, 'script')) n++; }
      });
    } catch (e) {}
    console.log('%c[hook] quét HTML: ' + (n ? 'thêm ' + n + ' dữ liệu' : 'không thấy gì mới'),
      'color:#2563eb;font-weight:bold');
    return n;
  }

  /* ---------------- 5) GỌI LẠI API (cứu dữ liệu tải trước khi cài hook) ---------------- */
  window.__olonReplay = function () {
    var urls = [], seenU = Object.create(null);
    function push(u, method, body) {
      u = String(u || '');
      if (!/^https?:/i.test(u) && u.charAt(0) !== '/') return;
      if (isAsset(u)) return;
      var abs;
      try { abs = new URL(u, location.href).href; } catch (e) { return; }
      if (seenU[abs + (method || '')]) return;
      seenU[abs + (method || '')] = 1;
      urls.push({ url: abs, method: method || 'GET', body: body || '' });
    }
    LOG.forEach(function (r) { push(r.url, r.method, r.body); });
    // bổ sung từ lịch sử tài nguyên của trình duyệt (có cả request trước khi cài hook)
    try {
      performance.getEntriesByType('resource').forEach(function (e) { push(e.name, 'GET', ''); });
    } catch (e) {}
    if (!urls.length) {
      console.warn('[hook] chưa thấy URL API nào để gọi lại. Hãy mở đề trên trang rồi thử lại.');
      return Promise.resolve(0);
    }
    console.log('%c[hook] đang gọi lại ' + urls.length + ' URL để tìm dữ liệu đề…', 'color:#2563eb;font-weight:bold');
    var got = 0;
    return urls.reduce(function (chain, u) {
      return chain.then(function () {
        var opt = { credentials: 'include', headers: { 'Accept': 'application/json, text/plain, */*' } };
        if (u.method && u.method !== 'GET') {
          opt.method = u.method;
          if (u.body && u.body !== '[body]') { opt.body = u.body; opt.headers['Content-Type'] = 'application/json'; }
        }
        return origFetch.call(window, u.url, opt).then(function (res) {
          if (res && res.ok === false) return null;              // (lỗi cũ: điều kiện ngược -> replay luôn trả 0)
          return res.text().then(function (t) {
            if (t && addCap(u.url + ' (replay)', t, 'replay')) got++;
          });
        }).catch(function (e) {
          console.warn('[hook] không gọi lại được:', shorten(u.url), e && e.message);
        });
      });
    }, Promise.resolve()).then(function () {
      console.log('%c[hook] replay xong — ' + got + ' dữ liệu mới. ' + (got ? 'Bấm "Tải hết .json" nhé.' : 'Không có gì mới.'),
        'color:' + (got ? '#15803d' : '#b45309') + ';font-weight:bold');
      render();
      return got;
    });
  };

  /* ---------------- 6) lưu tất cả ---------------- */
  window.__olonSave = function () {
    if (!CAPS.length) { console.warn('[hook] chưa có gì để lưu.'); return; }
    // gộp tất cả thành 1 file để nạp 1 lần vào player
    var bundle = CAPS.map(function (c) { return { url: c.url, type: c.kind, body: c.text }; });
    var txt = JSON.stringify(bundle);
    saveFile(txt, 'onluyen-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json', 'application/json');
    CAPS.forEach(function (c, i) { saveFile(c.text, fileName(c.url, i), 'application/json'); });
    console.log('%c[hook] đã tải ' + (CAPS.length + 1) + ' file (1 gói gộp + ' + CAPS.length + ' file lẻ).',
      'color:#15803d;font-weight:bold');
  };

  window.__olonClear = function () {
    CAPS.length = 0; LOG.length = 0; reqCount = 0;
    Object.keys(SEEN).forEach(function (k) { delete SEEN[k]; });
    try { localStorage.removeItem('__ol_caps__'); } catch (e) {}
    render();
    console.log('[hook] đã xoá dữ liệu đã bắt trong phiên.');
  };

  /* ---------------- 7) báo cáo chẩn đoán ---------------- */
  window.__ochandoan = function () {
    var L = [];
    L.push('===== BÁO CÁO HOOK BẮT ĐỀ — Onluyen =====');
    L.push('Thời điểm     : ' + new Date().toLocaleString('vi-VN'));
    L.push('Hook đã cài   : CÓ (v2)');
    L.push('Trang hiện tại: ' + location.href);
    L.push('Đang trong khung (iframe): ' + (inFrame ? 'CÓ — ⚠️ hãy đổi dropdown ở Console sang đúng khung chứa đề (thường tên bắt đầu bằng "app.onluyen.vn") rồi dán lại hook' : 'không'));
    L.push('Số request đã thấy: ' + reqCount + ' | số dữ liệu đã bắt: ' + CAPS.length);
    if (CAPS.length) {
      L.push('');
      L.push('--- Dữ liệu đã bắt ---');
      CAPS.forEach(function (c, i) {
        L.push((i + 1) + '. ' + Math.round(c.text.length / 1024) + ' KB · ' + (c.kind || '') + ' · ' + shorten(c.url));
      });
    }
    var apiLike = LOG.filter(function (r) { return !isAsset(r.url); }).slice(-25);
    L.push('');
    L.push('--- Request gần đây (không phải file tĩnh) ---');
    if (!apiLike.length) L.push('(chưa thấy request nào — hook cài sau khi trang đã tải? Hãy F5 rồi thao tác lại)');
    apiLike.forEach(function (r) {
      L.push('· ' + (r.method || '?') + ' ' + shorten(r.url) + (r.status ? ' → ' + r.status : '') +
        (r.len ? ' · ' + Math.round(r.len / 1024) + ' KB' : '') + (r.hit ? ' ✅ có câu hỏi' : ''));
    });
    // kho lưu trữ + biến toàn cục
    var storeHits = [];
    [['localStorage', window.localStorage], ['sessionStorage', window.sessionStorage]].forEach(function (pair) {
      try {
        var st = pair[1];
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i), v = st.getItem(k) || '';
          var sc = scoreText(v);
          if (sc >= 4) storeHits.push(pair[0] + '["' + k + '"] — ' + Math.round(v.length / 1024) + ' KB · điểm ' + sc);
        }
      } catch (e) {}
    });
    L.push('');
    L.push('--- Dữ liệu đề nằm trong kho lưu trữ trình duyệt ---');
    L.push(storeHits.length ? storeHits.join('\n') : '(không thấy — nếu có, gõ: __olonFromStore("<tên khoá>") để lấy ra file)');
    L.push('');
    L.push('--- Biến toàn cục giống dữ liệu đề ---');
    var g = [];
    try {
      Object.keys(window).slice(0, 4000).forEach(function (k) {
        if (/^__|^webkit|^on/.test(k)) return;
        var v;
        try { v = window[k]; } catch (e) { return; }
        if (!v || typeof v !== 'object') return;
        try {
          var s0 = JSON.stringify(v);
          if (s0 && s0.length > 3000 && scoreText(s0) >= 6) g.push(k + ' — ' + Math.round(s0.length / 1024) + ' KB');
        } catch (e) {}
      });
    } catch (e) {}
    L.push(g.length ? g.join('\n') : '(không thấy)');
    L.push('');
    L.push('--- Gợi ý ---');
    L.push('1) Nếu "Số request đã thấy" = 0 → hook cài SAU khi trang đã tải xong: bấm F5 rồi thao tác lại.');
    L.push('2) Nếu thấy request nhưng không có ✅ → gõ __olonReplay() để gọi lại toàn bộ API đã thấy.');
    L.push('3) Nếu "không thấy mảng câu hỏi" trong player → nạp file gộp vào player rồi mở tab Chẩn đoán.');
    L.push('4) Đường cuối: bôi đen toàn bộ đề trên trang (Ctrl+A) → nạp vào tab Chẩn đoán → "Tách đề từ văn bản".');
    var txt = L.join('\n');
    console.log('%c' + txt, 'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace');
    try { if (navigator.clipboard) navigator.clipboard.writeText(txt); } catch (e) {}
    saveFile(txt, 'bao-cao-hook.txt', 'text/plain');
    return txt;
  };

  /** Lấy dữ liệu đề ra từ kho lưu trữ trình duyệt (khi request đã chạy trước khi cài hook) */
  window.__olonFromStore = function (key) {
    try {
      var v = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
      if (!v) { console.warn('[hook] không có khoá này:', key); return null; }
      addCap('store:' + key, v, 'storage');
      window.__olonSave();
      return v.length;
    } catch (e) { return null; }
  };

  window.__hookScan = scanPage;

  /* ---------------- khởi động ---------------- */
  restore();
  function boot() {
    render();
    scanPage();
    console.log('%c[hook v2] ĐÃ CÀI. Bảng trạng thái ở góc dưới bên trái.' +
      '\n 1) BẤM F5 TẢI LẠI TRANG (hook phải chạy trước khi web gọi API lấy đề).' +
      '\n 2) Bấm vào đề / làm vài câu.' +
      '\n 3) Bấm "Tải hết .json" trong bảng rồi nạp file vào Onluyen Offline Player.' +
      '\n Nếu không bắt được: gõ __ochandoan() (in báo cáo) hoặc __olonReplay() (gọi lại API đã thấy).',
      'color:#15803d;font-weight:bold');
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);

  // bắt thêm dữ liệu đi kèm điều hướng SPA
  try {
    var pushState = history.pushState;
    history.pushState = function () {
      var r = pushState.apply(this, arguments);
      setTimeout(function () { render(); }, 300);
      return r;
    };
  } catch (e) {}
})();