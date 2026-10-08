/* =====================================================================
 * app.js ── 報價計算與畫面更新（純 JavaScript，不需要任何框架或伺服器）
 * 安康如意 AJI＋ADH 版（南方通訊處 115/10/08）：parseRocBirth、骨折圖點選邏輯沿用意外險工具；
 * compute() 改為 AJI 主約（官方費率表／投保規則／商品說明／建議書 xlsx）＋ ADH 附約（沿用意外險工具費率）。
 * ---------------------------------------------------------------------
 * 所有費率與參數都在 rates.js；本檔只放「計算邏輯」與「畫面呈現」。
 * ===================================================================== */
(function () {
  "use strict";

  var R = window.QUOTE_RATES;
  var RULES = R.RULES;

  var money = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }); // 金額：整數
  var wan = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });   // 萬元：最多 1 位小數

  /* ---------------------------------------------------------------
   * 民國生日 → 保險年齡（所有險種、所有年齡判斷共用這一個函式）
   * ---------------------------------------------------------------
   * 輸入：6 碼（如 700101）或 7 碼（如 1000101）民國生日，非數字字元會被忽略。
   * 規則（富邦「保險年齡」：超過半年就加一歲）：
   *   1. 足歲 = 今天以前（含今天）已經過了幾個生日。
   *   2. 以「最近一次生日 + 6 個月」為半歲日；今天「晚於」半歲日才加 1 歲。
   *      剛好滿 6 個月的那一天不加歲，隔天才加。
   * 月底處理（比照民法第 121 條「無相當日者，以其月之末日」）：
   *   ‧ 半歲日落在不存在的日期時，改用該月最後一天。
   *     例：8/31 生 → 半歲日為 2/28（閏年 2/29）；3/31 生 → 9/30。
   *   ‧ 2/29 生日在非閏年以 2/28 當作生日；半歲日仍以原本的 29 日推算（8/29）。
   * 回傳：{ birth, exactAge（足歲）, age（保險年齡） }；
   *       日期不存在（如 700231）→ null；生日在未來 → age = -1（顯示生日錯誤）。
   * 半歲月數設定在 rates.js 的 RULES.insuranceAge.roundUpAfterMonths。
   * --------------------------------------------------------------- */
  function dateClamped(year, month0, day) {
    // 建立 year 年 month0 月（0 起算、可超過 11）的 day 日；該月沒有這一天就用月底
    var first = new Date(year, month0, 1);
    var lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay));
  }

  function parseRocBirth(value, today) {
    var digits = String(value).replace(/\D/g, "");
    if (digits.length !== 6 && digits.length !== 7) return null;
    var yearDigits = digits.length - 4;
    var rocYear = Number(digits.slice(0, yearDigits));
    var month = Number(digits.slice(yearDigits, yearDigits + 2));
    var day = Number(digits.slice(yearDigits + 2));
    var year = rocYear + 1911;
    var birth = new Date(year, month - 1, day);
    if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return null;

    var now = today || new Date();
    var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 只比日期，不比時間
    if (birth > today0) return { birth: birth, exactAge: -1, age: -1 };

    // 1. 足歲
    var exactAge = today0.getFullYear() - year;
    if (dateClamped(today0.getFullYear(), month - 1, day) > today0) exactAge -= 1;

    // 2. 最近一次生日 + N 個月（半歲日），今天晚於半歲日 → 加 1 歲
    var months = RULES.insuranceAge.roundUpAfterMonths;
    var halfDay = dateClamped(year + exactAge, month - 1 + months, day);
    var age = exactAge + (today0 > halfDay ? 1 : 0);

    return { birth: birth, exactAge: exactAge, age: age };
  }

  function findBone(id) {
    for (var i = 0; i < R.BONES.length; i++) if (R.BONES[i].id === id) return R.BONES[i];
    return R.BONES[8]; // 找不到時預設「橈骨或尺骨」（同原工具）
  }

  /* ---------------------------------------------------------------
   * 核心計算：輸入 state，回傳所有保費與給付數字（純函式，方便測試）
   * AJI：費率表／投保規則／商品內容說明／建議書 xlsx（見 rates.js）；ADH：沿用意外險工具
   * --------------------------------------------------------------- */
  function adhRateFor(age, oi) {
    return age <= 14 ? R.ADH_RATES.child[oi] : age === 15 ? R.ADH_RATES.age15[oi]
      : age <= 44 ? R.ADH_RATES.age16to44[oi] : age <= 59 ? R.ADH_RATES.age45to59[oi] : R.ADH_RATES.age60to75[oi];
  }

  function compute(s, today) {
    var A = RULES.aji;
    var parsed = parseRocBirth(s.rocBirth, today);
    var age = parsed ? parsed.age : -1;
    var pay = R.PAY_MODES[s.payMode];
    var oi = s.occupation - 1; // 職業類別 → 陣列索引
    var term = s.ajiTerm, termN = Number(term);
    var amt = s.ajiAmount;     // AJI 保險金額（萬元）
    var range = A.ages[term];

    // ---- AJI 投保檢核（投保規則） ----
    var ajiError = age < 0 ? "請輸入正確的民國生日（6或7碼）"
      : (age < range[0] || age > range[1]) ? "AJI " + term + " 年期投保年齡為 " + range[0] + "～" + range[1] + " 歲（目前保險年齡 " + age + " 歲）"
      : A.occupations.indexOf(s.occupation) < 0 ? "AJI 投保職業類別限第 1～4 類（目前第 " + s.occupation + " 類）"
      : (amt < A.min || amt > A.max || amt % 1) ? "AJI 保險金額須為 " + A.min + "～" + A.max + " 萬元（以萬元為單位）" : "";
    var ajiOk = !ajiError;
    var ajiRate = ajiOk ? R.AJI_RATES[term][age] : undefined;
    var ben = ajiOk ? R.AJI_BEN[term][s.gender][age] : null;

    // ---- ADH 搭配上限：min(200 萬, AJI 保額 × 1) ----
    // ADH 上限 = min(200 萬, 主約保額 × 5)，主約保額以 AJI 投保金額 1 倍計（ADH／AJI 投保規則）
    var maxAdh = Math.min(RULES.adh.max, Math.floor(Math.max(0, amt) * A.riderMultiple * RULES.adh.mainMultiple));
    var effectiveAdh = Math.max(0, Math.min(s.adhAmount, maxAdh));

    // ---- 保費 ----
    var premiums = null;
    if (age >= 0) {
      // AJI：原始保費 = ROUND(保額(萬) × 每萬費率, 1)；各期 = ROUND(原始 × 繳別係數, 0)（建議書 xlsx OP!C31、C35）
      var ajiBase = ajiOk ? Math.round(amt * ajiRate * 10) / 10 : null;
      var adhRate = adhRateFor(age, oi);
      var adh = adhRate * effectiveAdh;
      var periodic = {
        aji: ajiBase === null ? null : Math.round(ajiBase * pay.aji),
        adh: Math.round(adh * pay.adh)
      };
      premiums = {
        ajiRate: ajiRate, adhRate: adhRate,
        annual: { aji: ajiBase === null ? null : Math.round(ajiBase), adh: adh },
        periodic: periodic,
        total: periodic.aji === null ? null : periodic.aji + periodic.adh
      };
    }

    // ---- 骨折情境給付 ----
    var bone = findBone(s.boneId);
    var fracture = R.FRACTURE_TYPES[s.fractureType];
    var f = fracture.factor;
    var hospitalDays = Math.min(RULES.maxHospitalDays, Math.max(0, Math.floor(Number(s.hospitalDaysInput) || 0)));
    var adhFracture = Math.round(effectiveAdh * 1e4 * (bone.adh / 100) * f); // ADH 骨折保險金
    var adhCare = Math.round(adhFracture * RULES.adhCareRatio);                // ADH 2% 關懷金
    var amtYuan = Math.max(0, amt) * 1e4;
    var ajiDaily = Math.round(amtYuan * A.hospitalRate);                       // AJI 住院醫療：每日 保額 0.1%
    var boneDays = bone.days * f;                                               // 骨折別日數（不完全 1/2、龜裂 1/4）
    var paidHospitalDays = Math.min(hospitalDays, A.maxHospitalDaysPerAccident);
    var remainingBoneDays = Math.max(0, boneDays - paidHospitalDays);
    var ajiHospital = paidHospitalDays * ajiDaily;
    var ajiBone = Math.round(remainingBoneDays * amtYuan * A.boneRate);          // 未住院部分：日數 × 保額 0.05%
    var ajiSurgeryEach = Math.round(amtYuan * A.surgeryRate);
    var ajiSurgery = s.surgery && paidHospitalDays > 0 ? ajiSurgeryEach : 0;    // 住院接受手術：保額 0.3%
    var ajiFracture = ajiHospital + ajiBone + ajiSurgery;
    var fixedFractureTotal = adhFracture + adhCare + ajiFracture;

    // ---- 保障彙整 ----
    var year1Die = ben ? Math.round(ben.d[0] * amt) : null;     // 第1年度 非意外身故／完全失能（＝max(當年度保險金額, 保價金)）
    var survival = ben ? Math.round(ben.s * amt) : null;        // 第20保單年度屆滿 生存保險金
    var adhYuan = effectiveAdh * 1e4;
    var years = [];
    if (ben && premiums) {
      var annualPaid = premiums.periodic.aji * pay.perYear;
      [1, 2, 3, 4, 5, 6, 10, 15, 20, 21].forEach(function (y) {
        var inYr20 = y <= A.survivalYear;
        years.push({
          year: y, age: age + y - 1,
          paid: annualPaid * Math.min(y, termN),
          accident: (inYr20 ? Math.round(ben.d[y - 1] * amt) : 0) + amtYuan,
          nonAccident: inYr20 ? Math.round(ben.d[y - 1] * amt) : null,
          cv: Math.round(ben.c[y - 1] * amt),
          survival: y === A.survivalYear ? survival : 0
        });
      });
    }

    return {
      age: age, pay: pay, term: term, ajiOk: ajiOk, ajiError: ajiError, ajiRate: ajiRate,
      maxAdh: maxAdh, effectiveAdh: effectiveAdh, premiums: premiums,
      bone: bone, fracture: fracture, hospitalDays: hospitalDays, boneDays: boneDays,
      paidHospitalDays: paidHospitalDays, remainingBoneDays: remainingBoneDays,
      adhFracture: adhFracture, adhCare: adhCare, ajiDaily: ajiDaily, ajiHospital: ajiHospital, ajiBone: ajiBone,
      ajiSurgeryEach: ajiSurgeryEach, ajiSurgery: ajiSurgery, ajiFracture: ajiFracture, fixedFractureTotal: fixedFractureTotal,
      year1Die: year1Die, survival: survival, amtYuan: amtYuan, adhYuan: adhYuan,
      accidentDeath1: year1Die === null ? null : year1Die + amtYuan + adhYuan,
      accidentDeath21: amtYuan + adhYuan,
      // ADH：搭乘陸上／水上大眾運輸 × 2；ADH 的「大眾運輸」不含空中，空中事故屬 ADH 一般意外 × 1
      landDeath1: year1Die === null ? null : year1Die + amtYuan * A.landMultiple + adhYuan * RULES.adh.landWaterMultiple,
      airDeath1: year1Die === null ? null : year1Die + amtYuan * A.airMultiple + adhYuan,
      adhSuture: Math.round(adhYuan * RULES.adh.sutureRate),
      burnTotal: Math.round(amtYuan * A.burnRate + adhYuan * RULES.burn.adh),
      disabilityTotal: Math.max(0, amt) + effectiveAdh, // 萬元（一般意外 100%）
      years: years,
      ageError: age < 0 ? "請輸入正確的民國生日（6或7碼）" : age > RULES.maxEntryAge ? "ADH 投保年齡以 0～" + RULES.maxEntryAge + " 歲為限" : ""
    };
  }

  /* =====================================================================
   * 以下為畫面（115/10/08 AJI 版）：骨折圖邏輯沿用意外險工具。
   * 新增：職業類別不可投保（費率「–」）提示、客戶頁連結（#q=）、下載保障彙整圖、草稿自動儲存。
   * 115/10/06 ac2：業務員姓名／職級／電話改由使用者填寫（AgentProfile，與旅平險工具共用 localStorage），隨客戶頁連結帶出。
   * ===================================================================== */
  var STORE_KEY = "nf-aji-quote-draft-v1";
  var STATE_KEYS = Object.keys(R.DEFAULTS);
  var AP = window.AgentProfile;
  /** 客戶頁連結帶來的業務員資料（舊連結沒有 → null，只顯示「富邦人壽 南方通訊處」） */
  var linkAgent = null;
  function currentAgent() { return clientMode ? (linkAgent || AP.sanitize({})) : AP.load(); }
  var ASSET_V = (function () {
    var s = document.querySelector('script[src*="app.js"]');
    var m = s && /[?&]v=([^&]+)/.exec(s.getAttribute("src"));
    return m ? m[1] : "";
  })();
  var LOGO = "img/logo.png" + (ASSET_V ? "?v=" + ASSET_V : "");

  var state = JSON.parse(JSON.stringify(R.DEFAULTS));
  var clientMode = false;
  var $ = function (id) { return document.getElementById(id); };

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fillOptions(sel, items) {
    sel.innerHTML = items.map(function (it) {
      return '<option value="' + esc(it[0]) + '">' + esc(it[1]) + "</option>";
    }).join("");
  }
  // 與原工具相同：數字欄位只在數值不同時才覆寫（避免打字時游標跳動）
  function syncNumber(input, value) {
    if ((value === 0 && input.value === "") || input.value != value) input.value = String(value);
  }
  function syncText(input, value) {
    if (input.value !== String(value)) input.value = String(value);
  }
  function showText(el, text) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
  }

  /* ---- ADH 職業類別不可投保（rates.js 費率 0＝DM「–」）：不列 ADH 保障並提示 ---- */
  function computeView(s) {
    var c = compute(s), d = s, blocked = [];
    if (c.age >= 0 && c.effectiveAdh > 0 && adhRateFor(c.age, s.occupation - 1) === 0) blocked.push("ADH");
    if (blocked.length) {
      d = JSON.parse(JSON.stringify(s));
      d.adhAmount = 0;
      c = compute(d);
    }
    c.blocked = blocked;
    return { c: c, s: d };
  }

  function quoteHtml(c, s) {
    var A = RULES.aji, p = c.premiums;
    var amt = s.ajiAmount, adhE = c.effectiveAdh;
    var totalOk = !!(p && p.total !== null);
    var yuan = function (v) { return money.format(v) + " 元"; };
    var wanY = function (v) { return wan.format(v / 1e4) + " 萬"; };
    var blockedMsg = c.blocked.length ? "職業第 " + s.occupation + " 類於保險年齡 " + c.age + " 歲不可投保 ADH（DM 費率「–」），已不列入保障與保費。" : "";
    var alert = c.ajiError || c.ageError;

    var h = "";
    // ---- 頁首（DM hero） ----
    h += '<section class="q-hero"><div class="hero-tags"><span class="hero-tag">富邦人壽｜安康如意終身保險 AJI</span>' +
      '<span class="hero-badge gold">' + (adhE > 0 ? "主約＋ADH 骨折" : "主約") + "</span></div>" +
      '<h1 class="q-title"><span class="q-name">' + esc(s.name || "未填姓名") + '</span><span class="ttl">的終身意外保障</span></h1>' +
      '<div class="hero-trip"><span>' + (c.age >= 0 ? "保險年齡 <b>" + c.age + "</b> 歲" : "年齡待確認") + "</span>" +
      "<span>" + (s.gender === "female" ? "女性" : "男性") + "</span><span>職業第 <b>" + s.occupation + "</b> 類</span><span>繳費 " + esc(s.ajiTerm) + " 年</span><span>" + esc(c.pay.label) + "</span></div>" +
      '<div class="q-total"><small>' + esc(c.pay.suffix) + "合計保費</small>" +
      (totalOk ? '<span class="c">NT$</span><b>' + money.format(p.total) + "</b><span class=\"u\">元</span>" : '<b class="miss">待確認</b>') + "</div></section>";
    if (alert) h += '<div class="alert-strip">' + esc(alert) + "</div>";
    if (blockedMsg) h += '<div class="alert-strip">' + esc(blockedMsg) + "</div>";

    // ---- 商品卡 ----
    function prod(cls, code, nm, main, sub, off) {
      return '<div class="q-prod ' + cls + (off ? " is-off" : "") + '"><div class="q-prod-h"><span class="code">' + code + "</span><small>" + esc(nm) + "</small></div>" +
        '<div class="q-prod-b"><b>' + main + "</b><em>" + sub + "</em></div></div>";
    }
    h += '<section class="q-products q-products-2">';
    h += prod("pp-ola", "AJI", "安康如意終身保險（主約）", esc(amt) + "萬・繳費" + esc(s.ajiTerm) + "年",
      p && p.periodic.aji !== null ? "NT$ " + money.format(p.periodic.aji) : "待確認", !c.ajiOk);
    h += prod("pp-adh", "ADH", "骨力勇意外骨折傷害", adhE === 0 ? "不投保" : adhE + "萬骨折保障",
      adhE === 0 ? (c.blocked.length ? "職業類別不可投保" : "未計保費") : "NT$ " + money.format(p ? p.periodic.adh : 0), adhE === 0);
    h += "</section>";

    // ---- 保障內容 ----
    function brow(n, title, amount, note, cls) {
      var none = amount === "不投保" || amount === "待確認";
      return '<tr class="' + (cls || "") + '"><td class="k"><span class="bn">' + n + "</span>" + esc(title) + "<small>" + esc(note) + "</small></td>" +
        '<td class="' + (none ? "na" : "") + '">' + esc(amount) + "</td></tr>";
    }
    var ok = c.year1Die !== null;
    h += '<section class="cmp-card q-benefits"><h2 class="sec-title big">保障內容<small>符合各條款約定時給付</small></h2>' +
      '<div class="cmp-scroll"><table class="cmp q-ben"><thead><tr><th class="k">保障項目</th><th>給付金額</th></tr></thead><tbody>';
    h += brow("1", "一般意外身故（第1保單年度）", ok ? wanY(c.accidentDeath1) : "待確認",
      ok ? "AJI 保額 " + amt + " 萬＋第1年度當年度保險金額 " + money.format(c.year1Die) + " 元（與保價金取大）" + (adhE > 0 ? "＋ADH " + adhE + " 萬" : "") +
        "；逐年增加至第20年度，第21年度起 AJI 為保額 " + amt + " 萬" + (adhE > 0 ? "（合計 " + wanY(c.accidentDeath21) + "）" : "") : "AJI 投保條件待確認");
    h += brow("2", "搭乘大眾運輸意外身故（第1保單年度）", ok ? "陸／水 " + wanY(c.landDeath1) + "｜空中 " + wanY(c.airDeath1) : "待確認",
      "AJI 保額 3 倍（陸上、水上）／4 倍（空中）＋當年度保險金額；第21年度起為保額 3／4 倍" +
        (adhE > 0 ? "；ADH 陸／水 2 倍 " + adhE * 2 + " 萬、空中屬 ADH 一般意外 " + adhE + " 萬" : ""));
    h += brow("3", "意外失能", wan.format(c.disabilityTotal * RULES.disabilityMinRatio) + "～" + wan.format(c.disabilityTotal) + " 萬",
      (adhE > 0 ? "AJI＋ADH" : "AJI") + " 一般意外依失能等級 5%～100%；AJI 搭乘陸／水大眾運輸 3 倍、空中 4 倍" + (adhE > 0 ? "，ADH 陸／水 2 倍" : "") + "；第1～20年度一級失能另加計當年度保險金額與保價金取大");
    h += brow("4", "重大燒燙傷", yuan(c.burnTotal), "AJI 保額 25%" + (adhE > 0 ? "＋ADH 25%" : "") + "，契約有效期間以一次為限");
    h += brow("5", "意外住院醫療", "每日 " + yuan(c.ajiDaily), "AJI 保額 0.1% × 實際住院日數，同一事故最高 90 日；骨折未住院按骨折別日數 × 保額 0.05%");
    h += brow("6", "意外住院手術", "每次 " + yuan(c.ajiSurgeryEach), "AJI 保額 0.3%，每次事故一次；住院醫療＋手術合計最高 AJI 保額（保險年齡 85 歲前之事故）");
    h += brow("7", c.bone.label + "｜" + c.fracture.label, adhE === 0 ? "不投保" : yuan(c.adhFracture + c.adhCare),
      adhE === 0 ? "此方案未納入 ADH" : "ADH 骨折金 " + money.format(c.adhFracture) + "＋2%關懷金 " + money.format(c.adhCare), adhE > 0 ? "accent" : "");
    h += brow("8", "意外創傷縫合處置", adhE === 0 ? "不投保" : "≦7cm " + yuan(Math.round(c.adhSuture * RULES.adh.sutureRatios[0])) + "｜>7cm " + yuan(Math.round(c.adhSuture * RULES.adh.sutureRatios[1])),
      adhE === 0 ? "此方案未納入 ADH" : "ADH 保額 0.1% × 50%（表淺撕裂傷 ≦7 公分）／100%（>7 公分），同一事故一次");
    h += brow("9", "非意外身故／完全失能（第1保單年度）", ok ? yuan(c.year1Die) : "待確認",
      "第1～20年度：當年度保險金額與保單價值準備金取大；第21年度起無此給付");
    h += brow("10", "生存保險金（第20保單年度屆滿）", ok ? yuan(c.survival) : "待確認",
      "當年度保險金額＝年繳標準保費 × 1.01 × 實際繳費年度數，契約繼續有效");
    h += "</tbody></table></div></section>";

    // ---- 骨折情境試算 ----
    var dayTxt = function (d) { return Number(d.toFixed(2)) + ""; };
    h += '<section class="q-frac"><h2 class="sec-title big">骨折可領多少？<small>符合條款定義的情境試算</small></h2>' +
      '<div class="q-frac-grid">' +
      "<div><small>ADH 骨折＋關懷金</small><b>" + (adhE === 0 ? "未投保" : money.format(c.adhFracture + c.adhCare)) + "</b>" + (adhE ? "<span>元</span>" : "") + "</div>" +
      "<div><small>AJI 住院醫療 " + c.paidHospitalDays + " 日</small><b>" + money.format(c.ajiHospital) + "</b><span>元</span></div>" +
      "<div><small>AJI 骨折未住院 " + dayTxt(c.remainingBoneDays) + " 日</small><b>" + money.format(c.ajiBone) + "</b><span>元</span></div>" +
      "<div><small>AJI 住院手術</small><b>" + (s.surgery ? money.format(c.ajiSurgery) : "未選") + "</b>" + (s.surgery ? "<span>元</span>" : "") + "</div>" +
      '<div class="tot"><small>定額給付合計試算</small><b>' + money.format(c.fixedFractureTotal) + "</b><span>元</span></div>" +
      "</div><p>" + esc(c.bone.label) + "（" + esc(c.fracture.label) + "）AJI 骨折別日數 " + dayTxt(c.boneDays) + " 日、實際住院 " + c.hospitalDays + " 日；" +
      "未住院部分＝（骨折別日數 − 住院日數）× AJI 保額 0.05%。</p></section>";

    // ---- AJI 保單利益（建議書數值） ----
    if (c.years.length) {
      h += '<section class="cmp-card q-benefits q-years"><h2 class="sec-title big">AJI 保單年度利益<small>取自官方建議書試算表・單位：元</small></h2>' +
        '<div class="cmp-scroll"><table class="cmp q-yr"><thead><tr><th>年度</th><th>年齡</th><th>累計保費<small>未含折扣</small></th><th>一般意外身故</th><th>非意外身故<small>／完全失能</small></th><th>年度末解約金</th></tr></thead><tbody>';
      c.years.forEach(function (y) {
        h += '<tr' + (y.year === A.survivalYear ? ' class="hl"' : "") + "><td>" + y.year + "</td><td>" + y.age + "</td><td>" + money.format(y.paid) + "</td><td>" + money.format(y.accident) +
          "</td><td>" + (y.nonAccident === null ? "—" : money.format(y.nonAccident)) + "</td><td>" + money.format(y.cv) + "</td></tr>";
      });
      h += "</tbody></table></div><p class=\"yr-note\">第20保單年度屆滿仍生存，另給付生存保險金 " + yuan(c.survival) +
        "。數值僅 AJI 主約、未含 ADH；累計保費以" + esc(c.pay.label) + "保費換算全年、未扣除繳費方式折扣。</p></section>";
    }

    // ---- 試算依據與重要提醒 ----
    var notes = [
      "AJI 保費＝保險金額（萬）× 年繳費率（" + (c.ajiRate ? c.ajiRate + " 元／萬，" : "") + "男女相同）× 繳別係數（半年 0.5、季 0.25、月 0.08333333）；ADH 保費依職業類別與年齡費率 × 繳別係數（0.52／0.262／0.088），各自四捨五入。",
      "保費折扣（本試算未扣除）：金融機構轉帳、富邦信用卡、自行繳費享總保費 1%；首期匯款 1%；20 年期員工轉帳件主約 3%；主約折扣上限 3%。",
      "AJI 投保規則：6 年期 16～70 歲、20 年期 16～60 歲；保額 30～500 萬（以萬元為單位）；職業 1～4 類；同一被保險人傷害險累計最高 2,000 萬。ADH 最低 10 萬、最高 200 萬且不得大於主約保額 5 倍（AJI 以投保金額 1 倍計算附約額度；本件 ADH 上限 " + c.maxAdh + " 萬）；ADH 為一年期附約，續保至保險年齡 75 歲，續保時依當時費率、年齡、職業重新計算保費。",
      "意外傷害住院醫療、住院手術醫療保險金限保險年齡屆滿 85 歲前之意外事故，合計最高以 AJI 保險金額為限。"
    ];
    if (blockedMsg) notes.push(blockedMsg);
    notes.push("本頁僅供試算；實際承保、保費與理賠，以保單條款、正式建議書及富邦人壽審核為準。");
    h += '<section class="notes-wrap"><h2 class="sec-title big">試算依據與重要提醒</h2><ul class="notes">' +
      notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></section>";
    return h;
  }

  function footerHtml() {
    var a = currentAgent();
    return '<div class="sig-wrap"><img class="sig-logo" src="' + LOGO + '" alt="富邦人壽 南方通訊處" width="88" height="88">' +
      '<div class="sig-text"><div class="sig-kicker">您的專屬保險顧問</div>' +
      '<div class="sig-name">' + esc(AP.line(a)) + "</div>" +
      (a.name ? '<div class="sig-unit">' + esc(AP.ORG) + "</div>" : "") + "</div>" + // 未填姓名時 sig-name 已是「富邦人壽 南方通訊處」，不重複
      (AP.telDigits(a.phone) ? '<a class="sig-phone" href="' + esc(AP.telHref(a.phone)) + '">☎ ' + esc(a.phone) + "</a>" : "") + "</div>" +
      '<div class="sig-disc">以上保費為試算結果，實際以富邦人壽核保為準；保障內容以保單條款為準。</div>';
  }

  function render() {
    var s = state;
    var v = computeView(s), c = v.c;
    var raw = c.blocked.length ? compute(s) : c; // 輸入欄提示仍依使用者輸入

    // ---- 左側輸入欄同步 ----
    syncText($("name"), s.name);
    syncText($("rocBirth"), s.rocBirth);
    $("gender").value = s.gender;
    $("occupation").value = String(s.occupation);
    $("payMode").value = s.payMode;
    $("ajiTerm").value = s.ajiTerm;
    syncNumber($("ajiAmount"), s.ajiAmount);
    $("adhAmount").max = String(raw.maxAdh);
    syncNumber($("adhAmount"), s.adhAmount);
    $("boneId").value = s.boneId;
    $("fractureType").value = s.fractureType;
    syncText($("hospitalDays"), s.hospitalDaysInput);
    $("surgery").checked = !!s.surgery;

    showText($("ageError"), raw.age < 0 ? raw.ageError : "");
    showText($("ajiError"), raw.age >= 0 ? (raw.ajiError || raw.ageError) : "");
    $("adhNote").textContent = "0＝不投保｜10～" + raw.maxAdh + " 萬元（最高 200 萬且 ≦ AJI 保額 × 5）";
    showText($("adhError"), s.adhAmount !== raw.effectiveAdh ? "已依搭配規則改以 " + raw.effectiveAdh + " 萬元試算"
      : s.adhAmount > 0 && s.adhAmount < RULES.adh.min ? "ADH 最低保額 " + RULES.adh.min + " 萬元（離開欄位時自動補足）" : "");

    $("quoteCard").innerHTML = quoteHtml(c, v.s);
    renderChart(c);
    renderCallout(c);
    $("sigFooter").innerHTML = footerHtml();
    if (!clientMode) saveDraft();
  }

  /* ---- 草稿（localStorage）與客戶頁連結（#q=，資料全在網址、不經伺服器） ---- */
  function pickState(o) {
    var out = JSON.parse(JSON.stringify(R.DEFAULTS));
    if (o && typeof o === "object") STATE_KEYS.forEach(function (k) {
      if (o[k] !== undefined && typeof o[k] === typeof R.DEFAULTS[k]) out[k] = o[k];
    });
    if (!R.PAY_MODES[out.payMode]) out.payMode = R.DEFAULTS.payMode;
    if (!R.FRACTURE_TYPES[out.fractureType]) out.fractureType = R.DEFAULTS.fractureType;
    if (RULES.aji.terms.indexOf(out.ajiTerm) < 0) out.ajiTerm = R.DEFAULTS.ajiTerm;
    if ([1, 2, 3, 4, 5, 6].indexOf(out.occupation) < 0) out.occupation = R.DEFAULTS.occupation;
    if (out.gender !== "male" && out.gender !== "female") out.gender = R.DEFAULTS.gender;
    return out;
  }
  var saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }, 250);
  }
  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function shareUrl() {
    var u = new URL(location.href); u.search = ""; u.hash = "";
    var payload = Object.assign({}, state, { agent: AP.sanitize(AP.load()) }); // 連結帶業務員資料，客戶看到正確的人
    return u.href + "#q=" + b64urlEncode(JSON.stringify(payload));
  }
  function stateFromHash() {
    var m = /[#&]q=([^&]+)/.exec(location.hash || "");
    if (!m) return null;
    try {
      var o = JSON.parse(b64urlDecode(m[1]));
      linkAgent = (o && o.agent && typeof o.agent === "object") ? AP.sanitize(o.agent) : null;
      return pickState(o);
    } catch (e) { return null; }
  }
  /** 送出（下載圖／連結）前提醒：業務員資料未填或仍是範例 */
  function agentReminder() {
    var a = AP.load(), m = AP.missing(a), smp = AP.isSample(a);
    if (!m.length && !smp) return "";
    var card = $("agentCard");
    if (card) { card.classList.add("flash"); setTimeout(function () { card.classList.remove("flash"); }, 1600); }
    return smp ? "⚠ 業務員資料仍是範例（" + AP.SAMPLE.name + "）" : "⚠ 尚未填寫業務員" + m.join("、") + "，客戶只會看到「富邦人壽 南方通訊處」";
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2400);
  }
  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? resolve() : reject(new Error("copy failed")); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  /* ---- 下載保障彙整圖（html2canvas；780px 寬 × 2 倍） ---- */
  function downloadPng() {
    if (!window.html2canvas) { alert("缺少 html2canvas 元件"); return Promise.resolve(); }
    var v = computeView(state);
    var host = document.createElement("div");
    host.className = "png-host";
    host.innerHTML = '<div class="png-root" id="pngRoot"><div class="quote-wrap">' + quoteHtml(v.c, v.s) + '</div><footer class="site-footer">' + footerHtml() + "</footer></div>";
    document.body.appendChild(host);
    var root = host.querySelector("#pngRoot");
    var imgs = Array.prototype.slice.call(root.querySelectorAll("img"));
    var ready = Promise.all(imgs.map(function (im) { return im.complete ? 0 : new Promise(function (r) { im.onload = im.onerror = r; }); }));
    return ready.then(function () {
      return window.html2canvas(root, { scale: 2, backgroundColor: "#eef6f7", useCORS: true, logging: false, width: 780, windowWidth: 780 });
    }).then(function (canvas) {
      var d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
      var name = "AJI保障_" + (state.name || "客戶").replace(/[\\/:*?"<>|\s]/g, "") + "_" + ymd + ".png";
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          resolve(name);
        }, "image/png");
      });
    }).finally(function () { host.remove(); });
  }

  /* ---------------- ADH 骨折別表圖：標示目前選擇的骨折（或脫臼）部位 ----------------
   * 位置資料在 rates.js 的 BONE_CHART／JOINT_CHART（百分比），圖片縮放時會自動對齊。
   * 只在部位／程度／ADH 金額改變時才重畫，避免輸入其他欄位時動畫一直重播。
   * 圖上有兩種模式：
   *   骨折（預設）：跟著左側「骨折部位」，金額＝報價卡「骨折」那一列（ADH 骨折金＋2% 關懷金）
   *   脫臼：點圖右欄的關節時進入；金額＝ADH 保險金額 × 脫臼別表比例（只顯示在圖上與說明卡，不影響報價卡）
   *   點左欄骨折部位、或變更「骨折部位／骨折程度」選單，就回到骨折模式。 */
  var lastChartKey = "";
  var chartView = { mode: "bone", jointId: null };

  function pctText(v) { return Number(v.toFixed(2)) + "%"; } // 例：0.75%、30%

  function factorText(f) { // 1/2、1/4 等分數顯示
    if (f === 1) return "";
    var inv = 1 / f;
    return Math.abs(inv - Math.round(inv)) < 1e-9 ? "1/" + Math.round(inv) : String(f);
  }

  function findJoint(id) {
    for (var i = 0; i < R.JOINTS.length; i++) if (R.JOINTS[i].id === id) return R.JOINTS[i];
    return null;
  }

  // 意外傷害脫臼開放性復位術保險金 = ADH 保險金額 × 脫臼別表比例（DM 第 2 頁；無關懷金）
  function dislocationBenefit(c, joint) {
    return Math.round(c.effectiveAdh * 10000 * joint.pct / 100);
  }

  function currentJoint() {
    return chartView.mode === "joint" ? findJoint(chartView.jointId) : null;
  }

  function overlayHtml(pos, label, pctHtml, smallHtml, payHtml) {
    var b = pos.box, l = pos.line, html = "";
    if (l) {
      html += '<svg class="chart-lines" viewBox="0 0 100 100" preserveAspectRatio="none">' +
        '<line class="chart-line-glow" x1="' + l[0] + '" y1="' + l[1] + '" x2="' + l[2] + '" y2="' + l[3] + '"/>' +
        '<line class="chart-line-core" x1="' + l[0] + '" y1="' + l[1] + '" x2="' + l[2] + '" y2="' + l[3] + '"/>' +
        "</svg>";
    }
    html += '<span class="chart-spot" style="left:' + b[0] + "%;top:" + b[1] + "%;width:" + b[2] + "%;height:" + b[3] + '%"></span>';
    if (l) html += '<span class="chart-dot" style="left:' + l[2] + "%;top:" + l[3] + '%"></span>';
    html += '<span class="chart-bubble" style="left:' + (b[0] + b[2]) + "%;top:" + b[1] + '%">' +
      '<span class="chart-bubble-name">' + esc(label) + "</span>" +
      "<b>" + pctHtml + "</b>" + (smallHtml || "") +
      '<em class="chart-bubble-pay">' + payHtml + "</em></span>";
    return html;
  }

  function renderChart(c) {
    var joint = currentJoint();
    var key = joint
      ? ["joint", joint.id, c.effectiveAdh].join("|")
      : ["bone", c.bone.id, state.fractureType, c.effectiveAdh, c.adhFracture].join("|");
    if (key === lastChartKey) return;
    lastChartKey = key;

    var overlay = "";
    if (joint) {
      overlay = overlayHtml(R.JOINT_CHART[joint.id], joint.label, joint.pct + "%", "",
        c.effectiveAdh > 0 ? "理賠 " + money.format(dislocationBenefit(c, joint)) + " 元" : "未投保 ADH");
    } else {
      var bone = c.bone, f = c.fracture.factor, pos = R.BONE_CHART[bone.id];
      if (pos) {
        overlay = overlayHtml(pos, bone.label, bone.adh + "%",
          f !== 1 ? "<small>" + esc(c.fracture.label) + " " + pctText(bone.adh * f) + "</small>" : "",
          // 理賠金額＝報價卡「骨折」那一列的金額（ADH 骨折金＋2% 關懷金），不另外計算
          c.effectiveAdh > 0 ? "理賠 " + money.format(c.adhFracture + c.adhCare) + " 元" : "未投保 ADH");
      }
    }
    var boxes = document.querySelectorAll(".chart-overlay");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].innerHTML = overlay;
      boxes[i].classList.toggle("is-joint", !!joint);
    }
  }

  // 右側說明卡：每次都更新（含 AJI 住院日數等，數字全部取自報價卡同一份計算結果 c）
  function renderCallout(c) {
    var callout = $("chartCallout");
    if (!callout) return;
    var joint = currentJoint();
    var adh = c.effectiveAdh > 0, aji = state.ajiAmount > 0;
    var row = function (label, value, cls) {
      return '<div class="' + (cls || "") + '"><dt>' + label + "</dt><dd>" + value + "</dd></div>";
    };
    var yuan = function (v) { return money.format(v) + " 元"; };
    callout.classList.toggle("is-joint", !!joint);

    if (joint) { // ---- 脫臼模式 ----
      var amt = dislocationBenefit(c, joint);
      callout.innerHTML =
        '<span class="callout-label">目前脫臼部位</span>' +
        '<div class="callout-main"><strong>' + esc(joint.label) + "</strong><b>" + joint.pct + "%</b></div>" +
        "<em>脫臼開放性復位術 → 保險金額 × " + joint.pct + "%</em>" +
        "<em>" + (adh
          ? "ADH " + money.format(c.effectiveAdh) + " 萬 × " + joint.pct + "% → <mark>" + yuan(amt) + "</mark>"
          : "目前未投保 ADH") + "</em>" +
        '<dl class="callout-pay">' +
          (adh ? row("脫臼開放性復位術保險金", yuan(amt), "is-total") : row("ADH", "未投保 ADH", "is-muted")) +
        "</dl>" +
        '<p class="callout-note">須經醫師診斷必須且實際施行脫臼開放性復位術；同一事故僅給付一項較高比例。脫臼不另給付 2% 關懷金。</p>' +
        '<p class="callout-dm">DM：「意外傷害脫臼開放性復位術保險金：保險金額x脫臼別表(10%~30%)，同一意外傷害事故僅給付一次。」' +
        "註2：「如因同一意外傷害事故致成二項以上脫臼經醫師診斷必須且實際施行二項以上之『脫臼開放性復位術』治療者，" +
        "富邦人壽僅給付一項較高比例之意外傷害脫臼開放性復位術保險金。」詳細給付內容及條件限制，請參閱保單條款。</p>" +
        '<p class="callout-back">此為圖上試算，未計入上方報價卡；點圖左欄骨折部位即回到骨折試算。</p>';
      return;
    }

    // ---- 骨折模式（與報價卡相同數字）----
    var bone = c.bone, f = c.fracture.factor, eff = bone.adh * f;
    var pay = "";
    if (adh) {
      pay += row("ADH 骨折保險金", yuan(c.adhFracture));
      pay += row("2% 關懷金", yuan(c.adhCare));
      pay += row("ADH 理賠小計", yuan(c.adhFracture + c.adhCare), "is-sub");
    } else {
      pay += row("ADH", "未投保 ADH", "is-muted");
    }
    if (aji) {
      pay += row("AJI 住院醫療 " + c.paidHospitalDays + " 日", yuan(c.ajiHospital));
      pay += row("AJI 骨折未住院 " + Number(c.remainingBoneDays.toFixed(2)) + " 日", yuan(c.ajiBone));
      if (state.surgery) pay += row("AJI 住院手術", yuan(c.ajiSurgery));
    }
    if (aji || adh) pay += row("定額給付合計", yuan(c.fixedFractureTotal), "is-total");
    callout.innerHTML =
      '<span class="callout-label">目前骨折部位</span>' +
      '<div class="callout-main"><strong>' + esc(bone.label) + "</strong><b>" + bone.adh + "%</b></div>" +
      "<em>" + esc(c.fracture.label) + " → 保險金額 × " +
        (f === 1 ? bone.adh + "%" : bone.adh + "% × " + factorText(f) + " = <mark>" + pctText(eff) + "</mark>") + "</em>" +
      "<em>" + (adh
        ? "ADH " + money.format(c.effectiveAdh) + " 萬 → 骨折保險金 <mark>" + money.format(c.adhFracture) + " 元</mark>"
        : "目前未投保 ADH") + "</em>" +
      '<dl class="callout-pay">' + pay + "</dl>";
  }

  /* ---------------- 點圖上的部位 → 直接選取、顯示理賠金額 ----------------
   * 用 BONE_CHART／JOINT_CHART 的百分比位置做點擊判定：點在標籤框上（或框旁幾 px 內），
   * 或點在骨頭／關節上的引線端點附近，就選取最近的部位。兩個骨折部位共用同一端點時（橈骨／脛骨），
   * 連點會在兩者間切換。點到圖上空白處不做任何事。 */
  var coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  // 回傳 { kind: "bone" | "joint", id } 或 null
  function hitTarget(stage, clientX, clientY) {
    var r = stage.getBoundingClientRect();
    if (!r.width) return null;
    var x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
    // 容許誤差（px）：點在標籤／比例格外圍這個距離內也算；相鄰標籤以「最近者」為準，不會選錯
    var tolBox = coarsePointer ? 16 : 12, tolDot = coarsePointer ? 26 : 18;
    var best = null, groups = {};
    function test(kind, table) {
      Object.keys(table).forEach(function (id) {
        var p = table[id], b = p.box, l = p.line;
        var bx = b[0] / 100 * r.width, by = b[1] / 100 * r.height, bw = b[2] / 100 * r.width, bh = b[3] / 100 * r.height;
        var dBox = Math.hypot(Math.max(bx - x, 0, x - bx - bw), Math.max(by - y, 0, y - by - bh));
        if (dBox <= tolBox && (!best || dBox < best.d)) best = { kind: kind, id: id, d: dBox, dot: null };
        if (!l) return; // 「其他關節」沒有引線
        var dDot = Math.hypot(x - l[2] / 100 * r.width, y - l[3] / 100 * r.height);
        var key = kind + ":" + l[2] + "," + l[3];
        (groups[key] = groups[key] || []).push(id);
        if (dDot <= tolDot && (!best || dDot < best.d)) best = { kind: kind, id: id, d: dDot, dot: key };
      });
    }
    test("bone", R.BONE_CHART);
    test("joint", R.JOINT_CHART);
    if (!best) return null;
    if (best.dot && best.kind === "bone") { // 共用端點：已選其中一個時，再點一次換下一個
      var g = groups[best.dot], cur = chartView.mode === "bone" ? g.indexOf(state.boneId) : -1;
      return { kind: "bone", id: cur >= 0 ? g[(cur + 1) % g.length] : g[0] };
    }
    return { kind: best.kind, id: best.id };
  }

  function selectBone(id) {
    if (!id || !R.BONE_CHART[id]) return;
    state.boneId = id; // 與左側「骨折部位」下拉選單相同效果
    chartView.mode = "bone";
    render();
  }

  function selectJoint(id) {
    if (!findJoint(id)) return;
    chartView.mode = "joint"; chartView.jointId = id; // 只影響圖與說明卡，不改報價資料
    render();
  }

  function initChartClicks() {
    var stages = document.querySelectorAll(".chart-stage");
    for (var i = 0; i < stages.length; i++) (function (stage) {
      var hover = document.createElement("span");
      hover.className = "chart-hover"; hover.hidden = true;
      stage.appendChild(hover);
      stage.addEventListener("mousemove", function (e) {
        var t = hitTarget(stage, e.clientX, e.clientY);
        stage.classList.toggle("is-over-bone", !!t);
        hover.hidden = !t;
        if (!t) { stage.removeAttribute("title"); return; }
        var isJoint = t.kind === "joint";
        var b = (isJoint ? R.JOINT_CHART : R.BONE_CHART)[t.id].box;
        var item = isJoint ? findJoint(t.id) : findBone(t.id);
        hover.classList.toggle("is-joint", isJoint);
        hover.style.cssText = "left:" + b[0] + "%;top:" + b[1] + "%;width:" + b[2] + "%;height:" + b[3] + "%";
        stage.title = item.label + " " + (isJoint ? item.pct + "%（脫臼開放性復位術）" : item.adh + "%") + "：點一下看理賠金額";
      });
      stage.addEventListener("mouseleave", function () { hover.hidden = true; stage.classList.remove("is-over-bone"); });
    })(stages[i]);
  }

  /* ---------------- 事件綁定 ---------------- */
  function clampNum(v, min, max) { return Math.min(max, Math.max(min, Number(v))); }

  function init() {
    fillOptions($("occupation"), [1, 2, 3, 4, 5, 6].map(function (n) { return [n, "第 " + n + " 類"]; }));
    fillOptions($("payMode"), Object.keys(R.PAY_MODES).map(function (k) { return [k, R.PAY_MODES[k].label]; }));
    fillOptions($("ajiTerm"), RULES.aji.terms.map(function (t) { return [t, t + " 年期（" + RULES.aji.ages[t][0] + "～" + RULES.aji.ages[t][1] + " 歲）"]; }));
    fillOptions($("boneId"), R.BONES.map(function (b) { return [b.id, b.label]; }));
    fillOptions($("fractureType"), Object.keys(R.FRACTURE_TYPES).map(function (k) { return [k, R.FRACTURE_TYPES[k].label]; }));
    $("ajiAmount").min = String(RULES.aji.min); $("ajiAmount").max = String(RULES.aji.max);
    $("adhAmount").step = String(RULES.adh.step);
    $("hospitalDays").max = String(RULES.maxHospitalDays);
    // 載入順序：網址 #q=（客戶頁）→ 草稿 → 預設
    var fromHash = stateFromHash();
    if (fromHash) {
      state = fromHash; clientMode = true;
      document.body.classList.add("is-client");
      document.title = (state.name ? state.name + " 的" : "") + "安康如意 AJI 保障試算｜" + AP.line(currentAgent());
    } else {
      AP.bind({ name: $("agentName"), title: $("agentTitle"), phone: $("agentPhone"), list: $("agentTitleList"),
        sample: $("agentSample"), status: $("agentStatus"), card: $("agentCard"), onChange: function () { render(); } });
      try { var raw = localStorage.getItem(STORE_KEY); if (raw) state = pickState(JSON.parse(raw)); } catch (e) {}
    }

    function on(id, ev, fn) { $(id).addEventListener(ev, function (e) { fn(e.target); render(); }); }
    on("name", "input", function (t) { state.name = t.value; });
    on("rocBirth", "input", function (t) { state.rocBirth = t.value; });
    on("gender", "change", function (t) { state.gender = t.value; });
    on("occupation", "change", function (t) { state.occupation = Number(t.value); });
    on("payMode", "change", function (t) { state.payMode = t.value; });
    on("ajiTerm", "change", function (t) { state.ajiTerm = t.value; });
    on("ajiAmount", "input", function (t) { state.ajiAmount = clampNum(t.value, 0, RULES.aji.max); });
    on("ajiAmount", "blur", function () { // 離開欄位時：補到最低 30 萬、取整數萬元
      state.ajiAmount = Math.round(clampNum(state.ajiAmount, RULES.aji.min, RULES.aji.max));
      state.adhAmount = Math.min(state.adhAmount, compute(state).maxAdh);
    });
    on("adhAmount", "input", function (t) { state.adhAmount = clampNum(t.value, 0, compute(state).maxAdh); });
    on("adhAmount", "blur", function () { if (state.adhAmount > 0 && state.adhAmount < RULES.adh.min) state.adhAmount = Math.min(RULES.adh.min, compute(state).maxAdh); }); // ADH 最低 10 萬
    on("boneId", "change", function (t) { state.boneId = t.value; chartView.mode = "bone"; });
    on("fractureType", "change", function (t) { state.fractureType = t.value; chartView.mode = "bone"; });
    on("hospitalDays", "input", function (t) { state.hospitalDaysInput = t.value; });
    on("hospitalDays", "blur", function () { state.hospitalDaysInput = String(compute(state).hospitalDays); });
    on("surgery", "change", function (t) { state.surgery = t.checked; });

    $("btnPng").addEventListener("click", function () {
      var b = $("btnPng"); b.disabled = true; b.textContent = "產生中…";
      var remind = agentReminder();
      downloadPng().then(function (n) { if (n) toast(remind ? remind + "（已下載 " + n + "）" : "已下載 " + n); })
        .catch(function (err) { alert("產生圖片失敗：" + (err && err.message ? err.message : err)); })
        .finally(function () { b.disabled = false; b.textContent = "🖼 下載保障彙整圖"; });
    });
    $("btnCopyLink").addEventListener("click", function () {
      var url = shareUrl(), remind = agentReminder();
      copyText(url).then(function () {
        toast(remind ? remind + "（連結已複製）" : /^file:/.test(location.href) ? "已複製（本機檔案連結僅供自己預覽；上線後的連結才能傳給客戶）" : "已複製客戶頁連結，可貼到 LINE");
      }).catch(function () { prompt("請複製以下連結：", url); });
    });
    $("btnOpenClient").addEventListener("click", function () { var r = agentReminder(); if (r) toast(r); window.open(shareUrl(), "_blank"); });
    $("btnReset").addEventListener("click", function () {
      if (!confirm("恢復預設示範資料？（目前輸入會被覆蓋）")) return;
      state = JSON.parse(JSON.stringify(R.DEFAULTS)); chartView.mode = "bone"; render(); toast("已恢復預設");
    });
    window.addEventListener("hashchange", function () { if (/[#&]q=/.test(location.hash)) location.reload(); });
    render();
    initChartPicker();
  }

  /* ---------------- ADH 骨折別表：點圖上的部位（骨折或脫臼）→ 選取 ---------------- */
  function initChartPicker() {
    var thumb = $("chartThumb");
    if (!thumb) return;
    var stage = thumb.querySelector(".chart-stage");
    initChartClicks();
    stage.addEventListener("click", function (e) {
      var t = hitTarget(stage, e.clientX, e.clientY);
      if (!t) return; // 沒點到部位：不做任何事
      if (t.kind === "joint") selectJoint(t.id); else selectBone(t.id);
    });
  }

  // 對外提供計算函式（測試或日後擴充用；compute 與原工具相同）
  window.QuoteCalc = { parseRocBirth: parseRocBirth, compute: compute, computeView: computeView, getState: function () { return state; },
    setState: function (o) { state = pickState(Object.assign({}, state, o)); render(); return computeView(state).c; },
    rates: R,
    shareUrl: shareUrl, downloadPng: downloadPng, getAgent: function () { return currentAgent(); },
    getChartView: function () { return { mode: chartView.mode, jointId: chartView.jointId }; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
