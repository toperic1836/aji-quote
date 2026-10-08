/* 業務員資料（南方通訊處共用）：旅平險、意外險兩個報價工具同網域（toperic1836.github.io），
 * 共用同一個 localStorage key，任一工具填一次、另一工具自動帶入。
 * 品牌固定：富邦人壽 南方通訊處；姓名／職級／電話由各業務員自行填寫（只存在自己的瀏覽器）。 */
(function (g) {
  'use strict';
  var KEY = 'nf-agent-profile-v1';
  var TEAM = '';
  var ORG = '富邦人壽 南方通訊處';
  var UNIT = '南方通訊處';
  /** 富邦人壽業務職級（常見稱謂）；可自由輸入 */
  var TITLES = ['業務員', '業務主任', '主任', '業務襄理', '襄理', '業務經理', '經理', '區經理', '資深區經理', '處經理', '總監'];
  /** 範例（虛構，非真實業務員） */
  var SAMPLE = { name: '王小明', title: '業務員', phone: '0912-345-678' };

  function clean(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function sanitize(a) {
    a = (a && typeof a === 'object') ? a : {};
    return { name: clean(a.name, 20), title: clean(a.title, 20), phone: clean(a.phone, 24) };
  }
  function telDigits(p) { return String(p || '').replace(/[^\d+]/g, ''); }
  function telHref(p) { return 'tel:' + telDigits(p); }
  function load() {
    try { var raw = g.localStorage.getItem(KEY); return sanitize(raw ? JSON.parse(raw) : {}); } catch (e) { return sanitize({}); }
  }
  function save(a) {
    a = sanitize(a);
    try { g.localStorage.setItem(KEY, JSON.stringify({ name: a.name, title: a.title, phone: a.phone, updatedAt: new Date().toISOString() })); } catch (e) {}
    return a;
  }
  /** 送出前必填：姓名、電話 */
  function missing(a) {
    a = sanitize(a); var m = [];
    if (!a.name) m.push('姓名');
    if (!telDigits(a.phone)) m.push('電話');
    return m;
  }
  function isSample(a) { a = sanitize(a); return !!a.name && a.name === SAMPLE.name && telDigits(a.phone) === telDigits(SAMPLE.phone); }
  function phoneLooksOdd(a) { var d = telDigits(sanitize(a).phone).replace(/^\+886/, '0'); return !!d && (d.length < 9 || d.length > 12); }
  /** 「王小明 業務員」；沒填姓名 → 只顯示「富邦人壽 南方通訊處」 */
  function line(a) { a = sanitize(a); return a.name ? [TEAM, a.name, a.title].filter(Boolean).join(' ') : ORG; }
  /** 檢查訊息（給編輯器的送出前檢查） */
  function problems(a) {
    var out = [], m = missing(a);
    if (m.length) out.push({ level: 'err', msg: '業務員資料尚未填寫' + m.join('、') + '：客戶頁／圖片將只顯示「富邦人壽 南方通訊處」' + (m.indexOf('電話') >= 0 ? '、沒有撥號按鈕' : '') + '。請在最上方「業務員資料」填寫（填一次，旅平險與意外險共用）。' });
    if (isSample(a)) out.push({ level: 'err', msg: '業務員資料仍是範例（' + SAMPLE.name + '），傳給客戶前請改成您自己的姓名與電話。' });
    if (phoneLooksOdd(a)) out.push({ level: 'warn', msg: '業務員電話「' + sanitize(a).phone + '」位數看起來不對，請確認。' });
    return out;
  }

  /** 綁定「業務員資料」欄位：opts = { name, title, phone, list, sample, status, onChange } (元素) */
  function bind(opts) {
    var els = { name: opts.name, title: opts.title, phone: opts.phone };
    if (opts.list) opts.list.innerHTML = TITLES.map(function (t) { return '<option value="' + t + '"></option>'; }).join('');
    function fill(a) { Object.keys(els).forEach(function (k) { if (els[k] && els[k].value !== a[k]) els[k].value = a[k]; }); }
    function status(a) {
      if (!opts.status) return;
      var pr = problems(a);
      if (!pr.length) {
        opts.status.className = 'agent-status ok';
        opts.status.textContent = '✓ 客戶頁、圖片署名：' + line(a) + '　☎ ' + a.phone;
      } else {
        opts.status.className = 'agent-status ' + pr[0].level;
        opts.status.textContent = '⚠ ' + (missing(a).length ? '送出前請填寫：' + missing(a).join('、') + '（未填時客戶頁只顯示「富邦人壽 南方通訊處」）' : pr[0].msg);
      }
      if (opts.card) opts.card.classList.toggle('is-missing', missing(a).length > 0 || isSample(a));
    }
    function current() { return sanitize({ name: els.name.value, title: els.title.value, phone: els.phone.value }); }
    var a0 = load(); fill(a0); status(a0);
    Object.keys(els).forEach(function (k) {
      els[k].addEventListener('input', function (e) {
        e.stopPropagation(); // 不觸發報價表單的 input 處理
        var a = save(current()); status(a); if (opts.onChange) opts.onChange(a);
      });
      els[k].addEventListener('change', function (e) {
        e.stopPropagation();
        var a = save(current()); fill(a); status(a); if (opts.onChange) opts.onChange(a);
      });
    });
    if (opts.sample) opts.sample.addEventListener('click', function () {
      var cur = load();
      if ((cur.name || cur.phone) && !isSample(cur) && !g.confirm('以範例（' + SAMPLE.name + '）覆蓋目前的業務員資料？')) return;
      var a = save(SAMPLE); fill(a); status(a); if (opts.onChange) opts.onChange(a);
    });
    // 另一個分頁／另一個工具改了資料 → 同步
    g.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      var a = load(); fill(a); status(a); if (opts.onChange) opts.onChange(a);
    });
    return { get: load, refresh: function () { var a = load(); fill(a); status(a); return a; } };
  }

  g.AgentProfile = {
    KEY: KEY, TEAM: TEAM, ORG: ORG, UNIT: UNIT, TITLES: TITLES, SAMPLE: SAMPLE,
    sanitize: sanitize, load: load, save: save, missing: missing, isSample: isSample, problems: problems,
    line: line, telDigits: telDigits, telHref: telHref, bind: bind
  };
})(window);
