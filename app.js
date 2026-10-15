"use strict";
// One page, four views routed by location.hash (see DESIGN.md «Patterns»): Explore (#, #hood=<slug>, #method),
// Step 1 (#estimate/hood), Step 2 (#estimate/flat?…), Result (#estimate/result?…). Data: the two inline JSON blocks
// written by build_site.py; per-hood ads load from data/ads/<slug>.json on demand. Mirrors estimate.py's model.

const S = JSON.parse(document.getElementById("snapshot").textContent);
const H = JSON.parse(document.getElementById("history-data").textContent);

const fa0 = new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 0});
const fa1 = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 1, maximumFractionDigits: 1});
const fa2 = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const faM1 = new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 1});
const faPct = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero"});
const toFa = s => String(s).replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const pct = v => faPct.format(v) + "٪";
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const $ = id => document.getElementById(id);
const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const fmtM = v => fa0.format(Math.round(v));                 // millions
const fmtB = v => fa1.format(Math.round(v / 100) / 10);      // millions → billions, 1 decimal
const toAscii = s => String(s).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6F0).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660);
const parseIntFa = s => { const t = toAscii(s).replace(/[٬,\s]/g, ""); return /^\d+$/.test(t) ? +t : NaN; };
const parseNumFa = s => { const t = toAscii(s).replace(/[٬,\s]/g, "").replace("٫", "."); return /^\d+(\.\d+)?$/.test(t) ? +t : NaN; };
const norm = s => toAscii(s).replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[\u200c\u0640]/g, "").replace(/\s+/g, " ").trim();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const icon = (id, cls = "") => `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="#${id}"/></svg>`;
const floorText = f => f === 0 ? "همکف" : `طبقهٔ ${fa0.format(f)}`;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- model (mirror of model.predict / estimate.py) ---------------------------
const flights = (floor, elevator) => (elevator || !floor || floor < 2) ? 0 : floor - 1;
// One evaluator per regressor name of model.FEATURES; the design row is built from S.model.names, so a model change
// in Python either just works (new hood) or fails loudly here (new feature) instead of silently mispricing.
const FEATURES = {
  "const": () => 1,
  "age": f => S.year - f.year_built,
  [`log(size/${S.model.ref_area})`]: f => Math.log(f.area_m2 / S.model.ref_area),
  "parking": f => +f.parking,
  "elevator": f => +f.elevator,
  "flights": f => flights(f.floor, f.elevator),
  "renovated": f => +f.renovated,
  "complex": f => +f.complex,
};
const feature = name => {
  if (name.startsWith("hood:")) return f => +(f.hood === name.slice(5));
  if (!FEATURES[name]) throw new Error(`app.js: no evaluator for model feature ${name}`);
  return FEATURES[name];
};
const NAMES = S.model.names;
const K = (i => i < 0 ? NAMES.length : i)(NAMES.findIndex(n => n.startsWith("hood:")));
const FEAT = NAMES.slice(0, K).map(feature);
const HOOD_COL = Object.fromEntries(S.model.hoods.map((slug, j) => [slug, j]));   // baseline / unpriced → undefined
const BETA = Object.fromEntries(NAMES.slice(0, K).map((n, i) => [n, S.model.beta[i]]));
const SIZE = `log(size/${S.model.ref_area})`;
function predict(f) {  // mirror of model.predict: mu and the one-flat SE of log(M/m²)
  const x = FEAT.map(g => g(f)), j = HOOD_COL[f.hood], {beta, cov_ff, cov_fh, var_h, sigma} = S.model;
  let mu = 0, v = 0;
  for (let r = 0; r < K; r++) { mu += x[r] * beta[r]; for (let c = 0; c < K; c++) v += x[r] * cov_ff[r][c] * x[c]; }
  if (j !== undefined) { mu += beta[K + j]; v += var_h[j]; for (let r = 0; r < K; r++) v += 2 * x[r] * cov_fh[j][r]; }
  return {mu, one: Math.hypot(Math.sqrt(Math.max(v, 0)), sigma)};
}
function estimate(f) {
  const {mu, one} = predict(f), a = f.area_m2;
  return {mu, one, ppm: Math.exp(mu), equiv: Math.round(Math.exp(mu) * a),
          lo: Math.round(Math.exp(mu - 1.96 * one) * a), hi: Math.round(Math.exp(mu + 1.96 * one) * a)};
}
function cdf(z) {  // Φ(z), Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// ---- svg helpers (charts are direction:ltr, anchors are visual) ----------------
const scale = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
function ticks(lo, hi, count) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(6));
  return out;
}
const svg = (w, h, body, label) => `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
// rtl: Persian label laid out right-to-left; its "start" is then the right edge at x
const txt = (x, y, s, anchor = "middle", cls = "", rtl = false) => `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" text-anchor="${anchor}" class="${cls}"${rtl ? ' direction="rtl"' : ""}>${s}</text>`;
const line = (cls, x1, y1, x2, y2) => `<line class="${cls}" x1="${(+x1).toFixed(1)}" y1="${(+y1).toFixed(1)}" x2="${(+x2).toFixed(1)}" y2="${(+y2).toFixed(1)}"/>`;

// ---- hoods ----------------------------------------------------------------------
const hoodBySlug = Object.fromEntries(S.hoods.map(h => [h.slug, h]));
const priced = h => h.ref_ppm !== null;
const low = h => priced(h) && h.low_data;
const zoneMedian = () => S.zone.median_ref_ppm ?? median(S.hoods.filter(priced).map(h => h.ref_ppm));
const hoodRows = slug => H.filter(r => r.hoods[slug] !== undefined);
const RF = S.reference.flat;
const REF = {...RF, year_built: S.year - RF.age};
const refText = `${fa0.format(RF.area_m2)} متر، ${fa0.format(RF.age)} ساله، ${floorText(RF.floor)}، `
  + (RF.parking && RF.elevator ? "با پارکینگ و آسانسور" : `${RF.parking ? "با" : "بدون"} پارکینگ، ${RF.elevator ? "با" : "بدون"} آسانسور`);
const badgeLow = '<span class="badge badge--warn">کم‌داده</span>';
const exploreCell = slug => document.querySelector(`#x-map a.cell[data-slug="${slug}"]`);
const qClassOf = slug => { const c = exploreCell(slug); return c ? [...c.classList].find(k => /^q\d$/.test(k)) : null; };

const adsCache = {}, adsPending = {};
function loadAds(slug) {  // caches resolved files only, so a failed fetch can be retried
  if (adsCache[slug]) return Promise.resolve(adsCache[slug]);
  if (!hoodBySlug[slug].n) return Promise.resolve(adsCache[slug] = []);
  if (adsPending[slug]) return adsPending[slug];
  return adsPending[slug] = fetch(`data/ads/${slug}.json`).then(r => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(ads => (adsCache[slug] = ads)).finally(() => { delete adsPending[slug]; });
}
const prefetch = slug => { loadAds(slug).catch(() => {}); };

let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

// ---- router ---------------------------------------------------------------------
const KEYS = ["hood", "area", "built", "floor", "parking", "elevator", "renovated", "complex"];
function parseRoute(hash) {
  const h = decodeURIComponent(hash.replace(/^#/, ""));
  let m;
  if ((m = h.match(/^hood=([\w-]+)$/))) return {view: "explore", sheet: hoodBySlug[m[1]] ? m[1] : null};
  if (h === "method") return {view: "explore", method: true};
  if (h === "calc") return {view: "hood", params: new URLSearchParams(), canonical: "#estimate/hood"};
  if ((m = h.match(/^estimate\/(hood|flat|result)(?:\?(.*))?$/))) return {view: m[1], params: new URLSearchParams(m[2] || "")};
  if ((m = h.match(/^budget(?:\?(.*))?$/))) return {view: "budget", params: new URLSearchParams(m[1] || "")};
  return {view: "explore"};
}
function flatOf(p) {
  const int = k => /^\d+$/.test(p.get(k) || "") ? +p.get(k) : NaN;
  const floor = int("floor");
  return {area_m2: int("area"), year_built: int("built"), floor: Number.isNaN(floor) ? RF.floor : clamp(floor, 0, 30),
          parking: p.get("parking") !== "0", elevator: p.get("elevator") !== "0",
          renovated: p.get("renovated") === "1", complex: p.get("complex") === "1"};
}
function query(hood, f) {
  const v = {hood, area: f.area_m2, built: f.year_built, floor: f.floor, parking: +f.parking, elevator: +f.elevator,
             renovated: +f.renovated, complex: +f.complex};
  return KEYS.filter(k => v[k] !== undefined && v[k] !== null && !Number.isNaN(v[k])).map(k => `${k}=${v[k]}`).join("&");
}
const validArea = a => Number.isInteger(a) && a >= 20 && a <= 300;
const validBuilt = y => Number.isInteger(y) && y >= 1300 && y <= S.year;

function go(hash, {replace = false} = {}) {
  if (replace) history.replaceState(history.state, "", hash);
  else history.pushState({app: true}, "", hash);
  render();
}
const goBack = parent => history.state?.app ? history.back() : go(parent, {replace: true});

// Matomo: base.html defines window._paq on rent.nlogn.ir only; elsewhere these are no-ops.
const track = (...cmd) => { if (window._paq) window._paq.push(cmd); };
let trackedUrl = null;
function trackView(r) {  // one virtual page per route; the flat's details never leave the page
  const path = r.view === "explore" ? (r.sheet ? `/hood-sheet/${r.sheet}` : r.method ? "/method" : "/")
    : r.view === "result" ? `/estimate/result/${r.params.get("hood")}`
    : r.view === "budget" ? "/budget" : `/estimate/${r.view}`;
  const url = location.origin + path;
  if (trackedUrl) track("setReferrerUrl", trackedUrl);
  track("setCustomUrl", url);
  track("setDocumentTitle", path);
  track("trackPageView");
  trackedUrl = url;
}
let lastHash = null, curRoute = {view: "explore"}, exploreY = 0, firstRender = true;
function render() {
  const hash = location.hash || "#";
  if (hash === lastHash) return;
  lastHash = hash;
  const r = parseRoute(hash);
  if (r.canonical) { history.replaceState(history.state, "", r.canonical); lastHash = r.canonical; }
  const prev = curRoute;
  if ((r.view === "flat" || r.view === "result") && !checkHood(r)) return;
  if (r.view === "result" && !checkFlat(r)) return;
  if (prev.view === "explore" && r.view !== "explore") exploreY = scrollY;
  curRoute = r;
  for (const [v, id] of [["explore", "v-explore"], ["hood", "v-hood"], ["flat", "v-flat"], ["result", "v-result"], ["budget", "v-budget"]])
    $(id).hidden = v !== r.view;
  if (r.view !== "explore") document.body.style.paddingBottom = "";
  if (r.view === "explore") renderExplore(r);
  else if (r.view === "hood") renderHoodStep(r.params);
  else if (r.view === "flat") renderFlatStep(r.params);
  else if (r.view === "budget") renderBudget(r.params);
  else renderResult(r.params);
  if (r.view === "explore") {
    if (prev.view !== "explore") scrollTo(0, exploreY);
    if (r.method) {
      const acc = $("acc-method");
      acc.open = true;
      acc.scrollIntoView({block: "start"});
    }
  } else if (!firstRender) {
    scrollTo(0, 0);
    $(`v-${r.view}`).querySelector("h1").focus({preventScroll: true});
  }
  firstRender = false;
  trackView(r);
}
// hood / flat / result need a priced hood; otherwise replace with step 1 (+ toast for a known but unpriced hood)
function checkHood(r) {
  const h = hoodBySlug[r.params.get("hood")];
  if (h && priced(h)) return true;
  if (h) toast(`برای ${h.name} داده کافی نیست.`);
  go("#estimate/hood", {replace: true});
  return false;
}
function checkFlat(r) {
  const f = flatOf(r.params);
  if (validArea(f.area_m2) && validBuilt(f.year_built)) return true;
  pendingErrors = true;
  go(`#estimate/flat?${query(r.params.get("hood"), f)}`, {replace: true});
  return false;
}

// ---- explore ----------------------------------------------------------------------
function initExplore() {
  $("x-date").textContent = `برداشت ${toFa(S.jalali)}`;
  $("x-sub").textContent = `رهن کامل یک واحد ${fa0.format(RF.area_m2)} متری ${fa0.format(RF.age)} ساله `
    + `(${floorText(RF.floor)}، با پارکینگ و آسانسور) در هر محله؛ از ${fa0.format(S.counts.peers)} آگهی دیوار.`;
  renderMethodCounts();
  renderData();
  if (S.age === null) $("acc-market").hidden = true;
  const lazy = {"acc-deals": renderDeals, "acc-effects": renderEffects, "acc-market": renderMarket, "acc-history": renderHistory};
  for (const [id, fn] of Object.entries(lazy)) {
    const d = $(id);
    d.addEventListener("toggle", () => { if (d.open && !d.dataset.done) { d.dataset.done = "1"; fn(); } });
  }
  $("deals-list").addEventListener("click", ev => { if (ev.target.closest("[data-act=deals-retry]")) renderDeals(); });
  $("x-pick").addEventListener("click", () => {
    const map = document.querySelector("#x-map svg.map");
    $("x-map").scrollIntoView({block: "start", behavior: "smooth"});
    map.classList.add("hint");
    setTimeout(() => map.classList.remove("hint"), 1600);
    toast("روی محلهٔ خود روی نقشه بزنید.");
  });
  document.querySelector("#x-map svg.map").addEventListener("click", ev => {
    if (!ev.target.closest(".cell") && curRoute.sheet) goBack("#");
  });
  $("x-sheet-close").addEventListener("click", () => goBack("#"));
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && curRoute.view === "explore" && curRoute.sheet) goBack("#");
  });
}

function renderExplore(r) {
  const sheet = $("x-sheet");
  for (const c of document.querySelectorAll("#x-map .cell.sel")) c.classList.remove("sel");
  if (!r.sheet) {
    sheet.hidden = true;
    document.body.style.paddingBottom = "";
    return;
  }
  const h = hoodBySlug[r.sheet], cell = exploreCell(h.slug);
  if (cell) { cell.classList.add("sel"); cell.parentNode.appendChild(cell); }
  $("x-sheet-title").innerHTML = esc(h.name) + (low(h) ? " " + badgeLow : "");
  const chips = h.neighbors.filter(s => hoodBySlug[s]).map(s => `<a class="chip" href="#hood=${s}">${esc(hoodBySlug[s].name)}</a>`).join("");
  const near = chips ? `<h3 class="sheet__sub">محله‌های نزدیک</h3><div class="chips">${chips}</div>` : "";
  let body;
  if (!priced(h)) {
    body = `<p>فقط ${fa0.format(h.n)} آگهی؛ برای برآورد کافی نیست.</p>` + near;
  } else {
    const rows = [["آگهی تمیز این هفته", fa0.format(h.n)],
      ["میانهٔ آگهی‌ها", `ودیعه ${fmtM(h.median_deposit)} + اجاره ${fa1.format(h.median_rent)} (رهن کامل ${fmtM(h.median_equiv)})`],
      ["میانهٔ متراژ و عمر بنا", `${fa0.format(h.median_area)} متر، ${fa0.format(h.median_age)} سال`]];
    const hr = hoodRows(h.slug);
    if (hr.length >= 2) rows.push(["نسبت به برداشت قبل", pct((hr[hr.length - 1].hoods[h.slug] / hr[hr.length - 2].hoods[h.slug] - 1) * 100)]);
    body = `<p class="sheet__ref muted">واحد مرجع: ${refText}</p>`
      + `<p class="price price--sheet"><span class="price__value">${fmtM(h.ref_equiv)} <span class="price__unit">میلیون تومان رهن کامل</span></span></p>`
      + `<p class="price__sub">۹۵٪ آگهی‌های چنین واحدی: ${fmtM(h.band_one[0])} تا ${fmtM(h.band_one[1])}</p>`
      + `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` + near
      + `<a class="btn btn--primary btn--block" href="#estimate/flat?hood=${h.slug}">برآورد واحد من در ${esc(h.name)}</a>`
      + `<a class="btn btn--text btn--block" href="/hood/${h.slug}/">صفحهٔ ${esc(h.name)}</a>`;
  }
  $("x-sheet-body").innerHTML = body;
  const wasHidden = sheet.hidden;
  sheet.hidden = false;
  $("x-sheet-body").scrollTop = 0;
  document.body.style.paddingBottom = `${sheet.offsetHeight}px`;
  if (wasHidden && !firstRender) $("x-sheet-title").focus({preventScroll: true});
}

function divergingBars(rows, label) {
  const W = 360, rowH = 28, T = 6, Ht = T + rows.length * rowH + 6;
  const labelW = Math.min(170, Math.max(...rows.map(r => r.label.length)) * 6.2 + 8);
  const L = 8, R = W - 8 - labelW, half = (R - L) / 2, x0 = L + half;
  const k = 0.62 * half / Math.max(1e-9, ...rows.map(r => Math.abs(r.pct)));
  const bars = rows.map((r, i) => {
    const yc = T + i * rowH + rowH / 2, w = Math.abs(r.pct) * k, pos = r.pct >= 0;
    return `<rect class="${pos ? "pos" : "neg"}" x="${(pos ? x0 : x0 - w).toFixed(1)}" y="${yc - 8}" width="${w.toFixed(1)}" height="16" rx="2"/>`
      + txt(W - 8, yc + 4, esc(r.label), "start", "", true)
      + txt(pos ? x0 + w + 4 : x0 - w - 4, yc + 4, pct(r.pct), pos ? "start" : "end", "val");
  }).join("");
  return svg(W, Ht, line("axis", x0, T, x0, Ht - 6) + bars, label);
}

function renderEffects() {
  // age is shown per 10 years so its bar is comparable with the one-off features
  const ageB = S.model.beta[NAMES.indexOf("age")];
  const rows = S.effects.map(e => e.name === "age"
    ? {label: "۱۰ سال عمر بیشتر", pct: (Math.exp(10 * ageB) - 1) * 100} : {label: e.label, pct: e.pct});
  $("effects-chart").innerHTML = divergingBars(rows, "اثر هر ویژگی بر قیمت");
  $("sigma-note").textContent = `پراکندگی آگهی‌ها حول مدل: حدود ±${fa0.format((Math.exp(S.model.sigma) - 1) * 100)}٪ برای یک واحد`;
}

function renderMarket() {
  let weeks = S.age.by_week.filter(w => w.n >= 10);
  if (!weeks.length) weeks = S.age.by_week;
  const rows = weeks.map(w => {
    const [, mm, dd] = w.week.split("-").map(Number);
    return {label: `هفتهٔ ${fa0.format(dd)} ${MONTHS[mm - 1]}، ${fa0.format(w.n)} آگهی`, pct: w.median_pct};
  });
  $("week-chart").innerHTML = divergingBars(rows, "میانهٔ آگهی‌ها نسبت به مدل، بر اساس هفتهٔ انتشار");
  const d = S.age.drift_pct_per_30d;
  $("drift-note").textContent = `آگهی‌های تازه‌تر به‌ازای هر ۳۰ روز حدود ${fa1.format(Math.abs(d))}٪ `
    + `${d >= 0 ? "گران‌تر" : "ارزان‌تر"} هستند. آگهی‌های تازه سقف بازار را نشان می‌دهند؛ آگهی‌های ۱۵+ روزه هنوز اجاره نرفته‌اند.`;
}

function renderHistory() {
  const zm = v => v === null || v === undefined ? "—" : fa2.format(v);
  $("history-table").tBodies[0].innerHTML = H.map(h => `<tr><td>${toFa(h.jalali)}</td><td>${fa0.format(h.peers)}</td>`
    + `<td>${zm(h.zone_median_ref_ppm)}</td></tr>`).join("");
  const rows = H.filter(h => h.zone_median_ref_ppm !== null && h.zone_median_ref_ppm !== undefined);
  if (H.length < 3 || rows.length < 2) { $("history-chart").innerHTML = ""; return; }
  const W = 360, Ht = 180, L = 44, R = 12, T = 16, B = 28;
  const vals = rows.map(h => h.zone_median_ref_ppm);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { lo -= 1; hi += 1; }
  const t = rows.map(h => Date.parse(h.date)), x = scale(t[0], t[t.length - 1], L, W - R), y = scale(lo, hi, Ht - B, T);
  const pts = rows.map((h, i) => [x(t[i]).toFixed(1), y(h.zone_median_ref_ppm).toFixed(1)]);
  $("history-chart").innerHTML = svg(W, Ht,
    line("axis", L, Ht - B, W - R, Ht - B)
    + `<polyline class="line" points="${pts.map(p => p.join(",")).join(" ")}"/>`
    + pts.map(([cx, cy]) => `<circle class="line" cx="${cx}" cy="${cy}" r="3"/>`).join("")
    + txt(L, Ht - B + 18, toFa(rows[0].jalali), "start") + txt(W - R, Ht - B + 18, toFa(rows[rows.length - 1].jalali), "end")
    + txt(L - 6, y(hi) + 4, fa1.format(hi), "end") + txt(L - 6, y(lo) + 4, fa1.format(lo), "end"),
    "روند میانهٔ محله‌ها، میلیون تومان بر متر واحد مرجع");
}

function renderMethodCounts() {
  const c = S.counts, d = c.dropped;
  $("method-counts").textContent = `در این برداشت ${fa0.format(c.peers)} آگهی از ${fa0.format(c.ads)} آگهی ماند `
    + `(${fa0.format(S.zone.hoods_with_data)} محله با دست‌کم ۵ آگهی). حذف‌شده‌ها: ناقص ${fa0.format(d.missing)}، `
    + `غیر واحد کامل ${fa0.format(d.not_whole_flat)}، بدون قیمت ${fa0.format(d.zero)}، تکراری ${fa0.format(d.dup)}، `
    + `پرت ${fa0.format(d.outlier)}.`;
}

function renderData() {
  const links = [["data/latest.json", "آخرین برداشت (latest.json)"], ["data/history.json", "روند (history.json)"]]
    .concat(H.map(h => [`data/${h.date}.json`, `برداشت ${toFa(h.jalali)} (${h.date}.json)`]));
  $("data-links").innerHTML = links.map(([href, label]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join("");
}

// ---- step 1: hood -------------------------------------------------------------------
const STOP = new Set(["خیابان", "خ", "بلوار", "میدان", "کوچه", "بزرگراه"]);
const SEARCH = S.hoods.map(h => ({h, key: norm(h.name).replace(/ /g, ""),
  streets: (h.streets || []).map(s => [s, norm(s).replace(/ /g, "")])}));
const BY_NAME = [...S.hoods].sort((a, b) => a.name.localeCompare(b.name, "fa"));
let hoodParams = new URLSearchParams();

function searchHoods(q) {
  const words = norm(q).split(" ").filter(w => w && !STOP.has(w));
  if (!words.length) return BY_NAME.map(h => ({h}));
  const all = s => words.every(w => s.includes(w)), byN = (a, b) => b.h.n - a.h.n;
  const names = SEARCH.filter(e => all(e.key)).map(e => ({h: e.h})).sort(byN);
  const streets = SEARCH.filter(e => !all(e.key)).map(e => ({h: e.h, street: (e.streets.find(([, k]) => all(k)) || [])[0]}))
    .filter(e => e.street).sort(byN);
  return names.concat(streets);
}

function renderHoodList() {
  const cur = hoodParams.get("hood"), res = searchHoods($("h-q").value);
  $("h-empty").hidden = res.length > 0;
  $("h-list").innerHTML = res.map(({h, street}) => {
    const q = qClassOf(h.slug), ok = priced(h);
    const sub = !ok ? `کمتر از ${fa0.format(S.thresholds.priced)} آگهی؛ برآورد ممکن نیست`
      : street ? `${street.startsWith("خیابان") ? "" : "خیابان "}${esc(street)}، ${fa0.format(h.n)} آگهی`
      : `${fa0.format(h.n)} آگهی، واحد مرجع ${fmtB(h.ref_equiv)} میلیارد`;
    return `<li><button type="button" class="row" data-slug="${h.slug}"${ok ? "" : " disabled"}${h.slug === cur ? ' aria-current="true"' : ""}>`
      + (q ? `<span class="row__swatch ${q}"></span>` : "")
      + `<span class="row__main"><span class="row__title">${esc(h.name)}</span><span class="row__sub">${sub}</span></span>`
      + (low(h) ? badgeLow : "") + icon("i-chevron", "icon--fwd") + "</button></li>";
  }).join("");
}

function renderHoodStep(params) {
  hoodParams = params;
  renderHoodList();
}

function pickHood(slug) {
  prefetch(slug);
  go(`#estimate/flat?${query(slug, flatOf(hoodParams))}`);
}

const distM = (lat1, lon1, lat2, lon2) => {  // port of divar.dist_m
  const p = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * p / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lon2 - lon1) * p / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};

function initHoodStep() {
  $("h-q").addEventListener("input", renderHoodList);
  $("h-list").addEventListener("click", ev => {
    const b = ev.target.closest("button.row");
    if (b && !b.disabled) pickHood(b.dataset.slug);
  });
  if (!("geolocation" in navigator)) { $("h-locate").hidden = true; return; }
  $("h-locate").addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition(pos => {
      const {latitude: la, longitude: lo} = pos.coords;
      let best = null, bd = Infinity;
      for (const h of S.hoods) { const d = distM(la, lo, h.lat, h.lon); if (d < bd) { bd = d; best = h; } }
      if (!best || bd > 3000) { toast("موقعیت شما بیرون از غرب تهران است."); return; }
      if (priced(best)) { pickHood(best.slug); toast(`محلهٔ شما: ${best.name}`); return; }
      toast(`برای ${best.name} داده کافی نیست.`);
      $("h-q").value = best.name;
      renderHoodList();
    }, () => toast("موقعیت در دسترس نیست."), {enableHighAccuracy: false, timeout: 10000, maximumAge: 600000});
  });
}

// ---- step 2: flat ------------------------------------------------------------------
let flatHood = null, pendingErrors = false;
const AREA_MSG = "متراژ را بین ۲۰ تا ۳۰۰ متر وارد کنید.";
const BUILT_MSG = () => `سال ساخت را بین ۱۳۰۰ و ${toFa(S.year)} وارد کنید.`;
const [SZ0, SZ1] = S.zone.size_m2;
const SIZE_HINT = `مدل با آگهی‌های ${fa0.format(SZ0)} تا ${fa0.format(SZ1)} متری ساخته شده؛ برای این متراژ دقت کمتر است.`;
const readArea = () => parseIntFa($("f-area").value);
function parseBuilt(s) {
  const t = toAscii(s).replace(/[٬,\s]/g, "");
  const v = parseIntFa(t);
  return Number.isNaN(v) || t.length > 2 ? v : v >= 50 ? 1300 + v : 1400 + v;
}
const readBuilt = () => parseBuilt($("f-built").value);
function readFlat() {
  const chip = k => document.querySelector(`#f-form .chip[data-key="${k}"]`).getAttribute("aria-pressed") === "true";
  return {area_m2: readArea(), year_built: readBuilt(), floor: +$("f-floor").dataset.v, parking: chip("parking"),
          elevator: chip("elevator"), renovated: chip("renovated"), complex: chip("complex")};
}
function setError(id, msg) {
  $(`${id}-field`).classList.toggle("field--error", !!msg);
  $(`${id}-msg`).textContent = msg || "";
  $(id).setAttribute("aria-invalid", msg ? "true" : "false");
}
function checkArea(show) {
  const a = readArea(), ok = validArea(a);
  $("f-area-hint").hidden = !(ok && (a < SZ0 || a > SZ1));
  if (ok || show) setError("f-area", ok ? "" : AREA_MSG);
  return ok;
}
function checkBuilt(show) {
  const ok = validBuilt(readBuilt());
  if (ok || show) setError("f-built", ok ? "" : BUILT_MSG());
  return ok;
}
function setFloor(v) {
  const f = $("f-floor");
  f.dataset.v = v;
  f.textContent = v === 0 ? "همکف" : fa0.format(v);
}
function syncFlatUrl() {  // keep the typed flat in the URL so back / «تغییر محله» resume it
  const f = readFlat();
  if (!validArea(f.area_m2)) f.area_m2 = NaN;
  if (!validBuilt(f.year_built)) f.year_built = NaN;
  const q = query(flatHood, f);
  history.replaceState(history.state, "", `#estimate/flat?${q}`);
  lastHash = location.hash;
  const a = $("f-context").querySelector("a");
  if (a) a.href = `#estimate/hood?${q}`;
}

function renderFlatStep(params) {
  const h = hoodBySlug[params.get("hood")], f = flatOf(params);
  flatHood = h.slug;
  prefetch(h.slug);
  $("f-context").innerHTML = `${esc(h.name)}${low(h) ? " " + badgeLow : ""}، ${fa0.format(h.n)} آگهی، واحد مرجع ${fmtM(h.ref_equiv)} میلیون `
    + `<a href="#estimate/hood?${query(h.slug, f)}">تغییر محله</a>`;
  $("f-area").value = Number.isNaN(f.area_m2) ? "" : toFa(f.area_m2);
  $("f-built").value = Number.isNaN(f.year_built) ? "" : toFa(f.year_built);
  setFloor(f.floor);
  for (const c of document.querySelectorAll("#f-form .chip")) c.setAttribute("aria-pressed", String(!!f[c.dataset.key]));
  setError("f-area", "");
  setError("f-built", "");
  checkArea(pendingErrors);
  checkBuilt(pendingErrors);
  pendingErrors = false;
}

function initFlatStep() {
  const form = $("f-form");
  for (const id of ["f-area", "f-built"]) {
    const el = $(id), check = id === "f-area" ? checkArea : checkBuilt, read = id === "f-area" ? readArea : readBuilt;
    el.addEventListener("input", () => { check(false); syncFlatUrl(); });
    el.addEventListener("blur", () => {
      if (check(el.value.trim() !== "")) el.value = toFa(read());
    });
  }
  form.addEventListener("click", ev => {
    const step = ev.target.closest("[data-step]"), chip = ev.target.closest(".chip");
    if (step) setFloor(clamp(+$("f-floor").dataset.v + +step.dataset.step, 0, 30));
    else if (chip) chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
    else return;
    syncFlatUrl();
  });
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const okA = checkArea(true), okB = checkBuilt(true);
    if (!okA || !okB) { $(okA ? "f-built" : "f-area").focus(); return; }
    go(`#estimate/result?${query(flatHood, readFlat())}`);
  });
}

// ---- result --------------------------------------------------------------------------
const R = {key: null, h: null, flat: null, est: null, ads: null, err: false, scope: "similar", sort: "close", shown: 20, offer: null};
const exact = a => a.deposit_m + (a.rent_m || 0) / S.rate;  // equiv_m in the JSON is rounded
const similarTo = f => a => Math.abs(a.year_built - f.year_built) <= 6 && Math.abs(a.area_m2 - f.area_m2) <= 15;
const floor50 = v => Math.floor(v / 50) * 50, round50 = v => Math.round(v / 50) * 50;

function renderResult(params) {
  const h = hoodBySlug[params.get("hood")], flat = flatOf(params), f = {...flat, hood: h.slug};
  const key = query(h.slug, flat);
  if (key !== R.key) Object.assign(R, {key, scope: "similar", sort: "close", shown: 20});
  Object.assign(R, {h, flat: f, est: estimate(f), ads: adsCache[h.slug] || null, err: false});
  const est = R.est;
  const extras = [["parking", "پارکینگ"], ["elevator", "آسانسور"], ["renovated", "بازسازی‌شده"], ["complex", "مجتمع"]]
    .filter(([k]) => f[k]).map(([, v]) => v);
  $("r-summary").textContent = [h.name, `${fa0.format(f.area_m2)} متر`, `ساخت ${toFa(f.year_built)}`, floorText(f.floor)]
    .concat(extras.length ? [extras.join("، ")] : []).join("، ");
  $("r-edit").href = `#estimate/flat?${key}`;
  $("r-banners").innerHTML = (low(h) ? `<p class="banner banner--warn" role="note">${esc(h.name)} فقط ${fa0.format(h.n)} آگهی دارد؛ عدد کم‌اطمینان‌تر و بازه پهن‌تر است.</p>` : "")
    + (f.area_m2 < SZ0 || f.area_m2 > SZ1 ? `<p class="banner banner--info" role="note">${SIZE_HINT}</p>` : "");
  $("r-equiv").textContent = fmtM(est.equiv);
  $("r-ppm").textContent = `حدود ${fa1.format(est.ppm)} میلیون برای هر متر`;
  const dep = $("r-dep"), max = floor50(est.equiv);
  dep.max = max;
  dep.value = Math.min(round50(h.median_deposit ?? 0), max);
  $("r-rate").value = String(S.rate);
  renderSplit();
  renderWhy();
  $("r-basis").textContent = `بر پایهٔ ${fa0.format(h.n)} آگهی ${h.name} و مدلی از ${fa0.format(S.counts.peers)} آگهی غرب تهران، برداشت ${toFa(S.jalali)}`;
  readOffer();
  renderBand();
  renderAds();
  renderResultMap();
  if (!R.ads) {
    const k = R.key;
    loadAds(h.slug).then(ads => { if (R.key === k) { R.ads = ads; renderBand(); renderAds(); } })
      .catch(() => { if (R.key === k) { R.err = true; renderAds(); } });
  }
}

function renderSplit() {
  const equiv = R.est.equiv, rate = +$("r-rate").value, d = +$("r-dep").value, rent = (equiv - d) * rate;
  $("r-split").innerHTML = `ودیعه <strong>${fmtM(d)}</strong> میلیون تومان + اجارهٔ ماهانه <strong>${fa1.format(rent)}</strong> میلیون تومان`;
  $("r-rate-note").textContent = `هر ۱۰۰ میلیون تومان ودیعه ≈ ${faM1.format(rate * 100)} میلیون اجارهٔ ماهانه (نرخ ${faM1.format(rate * 100)}٪). `
    + `مدل با نرخ ۳٪ (میانهٔ نرخ خود آگهی‌دهندگان در ${fa0.format(S.poster_rate.n)} آگهی قابل تبدیل) برازش شده؛ `
    + `نرخ انتخابی فقط تقسیم ودیعه/اجاره را تغییر می‌دهد.`;
}

// Zone-median reference flat → this hood → each way the user's flat differs from the reference flat. The model is
// log-additive and the size term is exact ((A/75)^(1+βs)), so the product of the factors is the estimate itself.
function whySteps(f) {
  const b = BETA, age = S.year - f.year_built, fl = flights(f.floor, f.elevator), flRef = flights(RF.floor, RF.elevator);
  const zoneRef = zoneMedian() * RF.area_m2, hoodRef = Math.exp(predict({...REF, hood: f.hood}).mu) * RF.area_m2;
  const rows = [[`${hoodBySlug[f.hood].name} نسبت به میانهٔ محله‌ها`, hoodRef / zoneRef]];
  if (f.area_m2 !== RF.area_m2) rows.push([`${fa0.format(f.area_m2)} متر به‌جای ${fa0.format(RF.area_m2)}`, (f.area_m2 / RF.area_m2) ** (1 + b[SIZE])]);
  if (age !== RF.age) rows.push([`${fa0.format(age)} سال عمر به‌جای ${fa0.format(RF.age)}`, Math.exp(b.age * (age - RF.age))]);
  if (f.elevator !== RF.elevator) rows.push([f.elevator ? "با آسانسور" : "بدون آسانسور", Math.exp(b.elevator * (f.elevator - RF.elevator))]);
  if (fl !== flRef) rows.push([`${fa0.format(fl)} طبقه پله`, Math.exp(b.flights * (fl - flRef))]);
  if (f.parking !== RF.parking) rows.push([f.parking ? "با پارکینگ" : "بدون پارکینگ", Math.exp(b.parking * (f.parking - RF.parking))]);
  if (f.renovated !== RF.renovated) rows.push([f.renovated ? "بازسازی‌شده" : "بازسازی‌نشده", Math.exp(b.renovated * (f.renovated - RF.renovated))]);
  if (f.complex !== RF.complex) rows.push([f.complex ? "مجتمع/شهرک" : "غیر مجتمع", Math.exp(b.complex * (f.complex - RF.complex))]);
  return {zoneRef, rows};
}
function renderWhy() {
  const {zoneRef, rows} = whySteps(R.flat);
  const li = (k, d, v, cls) => `<li${cls ? ` class="${cls}"` : ""}><span class="why__k">${k}</span><span class="why__d">${d}</span><span class="why__v">${fmtM(v)}</span></li>`;
  let v = zoneRef;
  $("r-why-list").innerHTML = li(`واحد مرجع، میانهٔ ${fa0.format(S.zone.hoods_solid)} محله`, "", zoneRef)
    + rows.map(([k, x]) => li(esc(k), pct((x - 1) * 100), v *= x)).join("")
    + li("برآورد واحد شما", "", R.est.equiv, "why__total");
}

// CarGurus-style levels from the model gap: ±σ and ±0.4σ in log space, compared in percent so they match
// site_data.deals() on the rounded vs_fit_pct.
const SIG = S.model.sigma;
const CUT_LO = -(1 - Math.exp(-SIG)) * 100, CUT_HI = (Math.exp(SIG) - 1) * 100;
const NEAR_LO = -(1 - Math.exp(-0.4 * SIG)) * 100, NEAR_HI = (Math.exp(0.4 * SIG) - 1) * 100;
function dealBadge(v) {
  const p = faM1.format(Math.abs(v));
  if (v <= CUT_LO) return `<span class="badge badge--pos badge--strong">خیلی زیر برآورد، ${p}٪</span>`;
  if (v <= NEAR_LO) return `<span class="badge badge--pos">زیر برآورد، ${p}٪</span>`;
  if (v < NEAR_HI) return '<span class="badge">نزدیک برآورد</span>';
  if (v < CUT_HI) return `<span class="badge badge--neg">بالای برآورد، ${p}٪</span>`;
  return `<span class="badge badge--neg badge--strong">خیلی بالای برآورد، ${p}٪</span>`;
}

let deals = null;
function renderDeals() {
  const list = $("deals-list");
  $("deals-note").textContent = `آگهی‌های ۱۴ روز اخیر در محله‌های پرآگهی که دست‌کم ${fa0.format(-CUT_LO)}٪ زیر برآورد مدل برای همان مشخصات‌اند، بیشترین فاصله اول. `
    + "ارزانی ممکن است دلیلی داشته باشد که در آگهی نیامده (زیرزمین، وضعیت بنا، شرایط خاص)؛ آگهی را کامل بخوانید.";
  if (deals) {
    list.innerHTML = deals.length ? deals.map(a => adCard(a, true)).join("") : '<div class="empty"><p>این هفته آگهی تازه‌ای با این فاصله نیست.</p></div>';
    return;
  }
  list.innerHTML = '<div class="skeleton skeleton--ad"></div>'.repeat(3);
  fetch("data/deals.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { deals = d; renderDeals(); })
    .catch(() => { list.innerHTML = '<div class="empty"><p>آگهی‌ها بارگذاری نشد.</p><button type="button" class="btn btn--secondary" data-act="deals-retry">تلاش دوباره</button></div>'; });
}

function bandSvg({lo, hi, est, dots, offer, loading}) {
  const vals = [lo, hi, est, ...(dots || []), ...(offer ? [offer] : [])];
  let d0 = Math.min(...vals), d1 = Math.max(...vals);
  const pad = (d1 - d0) * 0.04 || 1;
  d0 -= pad; d1 += pad;
  const x = v => 16 + (v - d0) / (d1 - d0) * 288;
  let body = "";
  if (loading) {
    for (let i = 0; i < 12; i++) body += `<circle class="dot skeleton-dot" cx="${(x(lo) + (x(hi) - x(lo)) * (i + 0.5) / 12).toFixed(1)}" cy="30" r="2.6"/>`;
  } else if (dots) {
    const cols = {};
    for (const v of dots) {
      const c = Math.floor((x(v) - 16) / 7), i = cols[c] = (cols[c] || 0) + 1;
      if (i <= 4) body += `<circle class="dot" cx="${(16 + c * 7 + 3.5).toFixed(1)}" cy="${30 - (i - 1) * 6}" r="2.6"/>`;
    }
  }
  const xe = x(est).toFixed(1), lx = v => clamp(x(v), 24, 296).toFixed(1);
  body += `<rect class="track" x="${x(lo).toFixed(1)}" y="38" width="${(x(hi) - x(lo)).toFixed(1)}" height="8" rx="4"/>`
    + `<line class="est" x1="${xe}" y1="33" x2="${xe}" y2="51"/><circle class="est" cx="${xe}" cy="42" r="6"/>`
    + (offer ? `<path class="offer" d="M${x(offer).toFixed(1)},34 l6,8 l-6,8 l-6,-8z"/>` : "")
    + `<text class="band__lbl" x="${lx(lo)}" y="68">${fmtM(lo)}</text><text class="band__lbl" x="${lx(hi)}" y="68">${fmtM(hi)}</text>`;
  return body;
}

function renderBand() {
  const {est, h, flat} = R, sim = R.ads ? R.ads.filter(similarTo(flat)).map(exact) : null;
  const cap = `۹۵٪ آگهی‌های واحدی مثل شما بین ${fmtM(est.lo)} و ${fmtM(est.hi)} میلیون تومان است.`
    + (sim && sim.length ? ` هر نقطه یک آگهی مشابه در ${h.name} است.` : "");
  $("r-band").innerHTML = `<svg class="band__svg" viewBox="0 0 320 76" dir="ltr" role="img" aria-label="${esc(cap)}">`
    + bandSvg({lo: est.lo, hi: est.hi, est: est.equiv, dots: sim, offer: R.offer?.equiv, loading: !R.ads && !R.err}) + "</svg>";
  $("r-band-cap").textContent = cap;
}

function readOffer() {
  const dep = parseNumFa($("o-dep").value), rent = parseNumFa($("o-rent").value);
  const out = $("o-out");
  if (Number.isNaN(dep) && Number.isNaN(rent)) { R.offer = null; out.textContent = ""; return; }
  const equiv = (Number.isNaN(dep) ? 0 : dep) + (Number.isNaN(rent) ? 0 : rent) / S.rate;
  if (!(equiv > 0)) { R.offer = null; out.textContent = ""; return; }
  const {mu, one, lo, hi} = R.est, p = cdf((Math.log(equiv / R.flat.area_m2) - mu) / one);
  R.offer = {equiv};
  out.textContent = `رهن کامل این پیشنهاد ${fmtM(equiv)} میلیون است: `
    + (p <= 0.5 ? `ارزان‌تر از ${fa0.format(clamp(Math.round(100 * (1 - p)), 1, 99))}٪` : `گران‌تر از ${fa0.format(clamp(Math.round(100 * p), 1, 99))}٪`)
    + " آگهی‌های واحدی مثل شما." + (equiv < lo || equiv > hi ? " (بیرون از بازهٔ ۹۵٪)" : "");
}

function adAge(d) {
  if (d === null || d === undefined) return "";
  return d === 0 ? "امروز" : d === 1 ? "دیروز" : `${fa0.format(d)} روز پیش`;
}
function adCard(a, cross = false) {
  const stats = (cross ? [esc(hoodBySlug[a.hood]?.name ?? a.hood)] : []).concat([`${fa0.format(a.area_m2)} متر`, `ساخت ${toFa(a.year_built)}`], a.floor === null || a.floor === undefined ? [] : [floorText(a.floor)]);
  const tags = [a.parking ? "<span class=\"badge\">پارکینگ</span>" : "<span class=\"badge badge--off\">بدون پارکینگ</span>",
    a.elevator ? "<span class=\"badge\">آسانسور</span>" : "<span class=\"badge badge--off\">بدون آسانسور</span>"]
    .concat(a.renovated ? ["<span class=\"badge\">بازسازی‌شده</span>"] : []).join("");
  const fit = dealBadge(a.vs_fit_pct);
  const m = x => x === null || x === undefined ? "—" : fmtM(x);
  return `<article class="ad"><p class="ad__stats">${stats.join("، ")}</p><div class="ad__tags">${tags}</div>`
    + `<dl class="kv ad__price"><div><dt>ودیعه</dt><dd>${m(a.deposit_m)}</dd></div><div><dt>اجارهٔ ماهانه</dt><dd>${m(a.rent_m)}</dd></div>`
    + `<div class="kv--strong"><dt>رهن کامل</dt><dd>${m(a.equiv_m)}</dd></div></dl>`
    + `<div class="ad__foot">${fit}<span class="ad__age">${adAge(a.published_days)}</span>`
    + (cross ? `<a class="btn btn--text" href="#estimate/result?${query(a.hood, {area_m2: a.area_m2, year_built: a.year_built, floor: a.floor ?? NaN, parking: a.parking, elevator: a.elevator, renovated: a.renovated, complex: a.complex})}">برآورد</a>` : "")
    + `<a class="btn btn--text" href="${esc(a.url)}" target="_blank" rel="noopener">دیوار${icon("i-external")}</a></div></article>`;
}

function sortedAds() {
  const f = R.flat, ads = R.scope === "similar" ? R.ads.filter(similarTo(f)) : [...R.ads];
  const days = a => a.published_days ?? Infinity;
  const dist = a => Math.abs(a.area_m2 - f.area_m2) / 15 + Math.abs(a.year_built - f.year_built) / 6
    + (a.parking !== f.parking) + (a.elevator !== f.elevator);
  const cmp = {close: (a, b) => dist(a) - dist(b) || days(a) - days(b), cheap: (a, b) => a.equiv_m - b.equiv_m,
               new: (a, b) => days(a) - days(b)}[R.sort];
  return ads.sort((a, b) => cmp(a, b) || 0);
}

function renderAds() {
  const list = $("r-ads-list"), more = $("r-ads-more"), name = esc(R.h.name);
  const [cSim, cAll] = document.querySelectorAll("#r-ads-scope .chip");
  for (const c of document.querySelectorAll("#r-ads-scope .chip")) c.setAttribute("aria-checked", String(c.dataset.scope === R.scope));
  for (const c of document.querySelectorAll("#r-ads-sort .chip")) c.setAttribute("aria-checked", String(c.dataset.sort === R.sort));
  more.hidden = true;
  if (!R.ads) {
    cSim.textContent = "مشابه";
    cAll.textContent = "همهٔ آگهی‌های محله";
    $("r-ads-median").textContent = "";
    list.innerHTML = R.err ? `<div class="empty"><p>آگهی‌های ${name} بارگذاری نشد.</p><button type="button" class="btn btn--secondary" data-act="retry">تلاش دوباره</button></div>`
      : '<div class="skeleton skeleton--ad"></div>'.repeat(3);
    return;
  }
  const sim = R.ads.filter(similarTo(R.flat));
  cSim.textContent = `مشابه (${fa0.format(sim.length)})`;
  cAll.textContent = `همهٔ آگهی‌های محله (${fa0.format(R.ads.length)})`;
  $("r-ads-median").textContent = sim.length
    ? `میانهٔ ${fa0.format(sim.length)} آگهی مشابه (±۱۵ متر، ±۶ سال): ${fmtM(median(sim.map(exact)))} میلیون` : "";
  if (R.scope === "similar" && !sim.length) {
    list.innerHTML = `<div class="empty"><p>آگهی مشابهی (±۱۵ متر، ±۶ سال) در ${name} نیست.</p>`
      + `<button type="button" class="btn btn--secondary" data-act="all">دیدن همهٔ آگهی‌های ${name}</button></div>`;
    return;
  }
  const ads = sortedAds();
  list.innerHTML = ads.slice(0, R.shown).map(adCard).join("");
  more.hidden = ads.length <= R.shown;
}

function mapIn(boxId) {  // this view's private copy of the Explore map, created on first use
  const box = $(boxId);
  return box.querySelector("svg.map") || box.appendChild(document.querySelector("#x-map svg.map").cloneNode(true));
}
function renderResultMap() {
  const map = mapIn("r-map-box"), f = R.flat;
  map.classList.remove("hint");
  for (const el of map.querySelectorAll(".sel, .mine")) el.classList.remove("sel", "mine");
  for (const c of map.querySelectorAll(".cell")) {
    const slug = c.dataset.slug, h = hoodBySlug[slug], v = estimate({...f, hood: slug}).equiv;
    c.setAttribute("href", `#estimate/result?${query(slug, f)}`);
    c.setAttribute("aria-label", `${h.name}: ${fmtB(v)} میلیارد تومان برای واحد شما`);
    const val = map.querySelector(`.lbl[data-slug="${slug}"] .lbl-val`);
    if (val) val.textContent = fmtB(v);
    if (slug === R.h.slug) {
      c.classList.add("mine");
      c.parentNode.appendChild(c);
      map.querySelector(`.lbl[data-slug="${slug}"]`)?.classList.add("mine");
    }
  }
  const lg = document.querySelector("#x-map .legend"), base = S.model.baseline;
  const k = Math.exp(predict({...f, hood: base}).mu - predict({...REF, hood: base}).mu) * f.area_m2 / REF.area_m2;
  const edges = lg.dataset.edges.split(",").map(Number);
  $("r-legend").innerHTML = lg.outerHTML;
  const nl = $("r-legend").querySelector(".legend");
  nl.querySelector(".legend__title").textContent = "رهن کامل همین واحد، میلیارد تومان";
  nl.querySelectorAll(".legend__ticks span").forEach((s, i) => { s.textContent = fmtB(edges[i] * k); });
}

function initResult() {
  $("r-ads-key").textContent = `برچسب‌ها: فاصلهٔ قیمت آگهی از برآورد مدل برای همان مشخصات در همان محله. «خیلی» یعنی دست‌کم ${fa0.format(-CUT_LO)}٪ ارزان‌تر یا ${fa0.format(CUT_HI)}٪ گران‌تر.`;
  $("r-dep").addEventListener("input", renderSplit);
  $("r-rate").addEventListener("change", renderSplit);
  for (const id of ["o-dep", "o-rent"]) $(id).addEventListener("input", () => { readOffer(); renderBand(); });
  $("r-ads-scope").addEventListener("click", ev => {
    const c = ev.target.closest(".chip");
    if (c && R.scope !== c.dataset.scope) { R.scope = c.dataset.scope; R.shown = 20; renderAds(); }
  });
  $("r-ads-sort").addEventListener("click", ev => {
    const c = ev.target.closest(".chip");
    if (c && R.sort !== c.dataset.sort) { R.sort = c.dataset.sort; R.shown = 20; renderAds(); }
  });
  $("r-ads-more").addEventListener("click", () => { R.shown += 20; renderAds(); });
  $("r-ads-list").addEventListener("click", ev => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "all") { R.scope = "all"; R.shown = 20; renderAds(); return; }
    const k = R.key, slug = R.h.slug;
    R.err = false;
    renderBand();
    renderAds();
    loadAds(slug).then(ads => { if (R.key === k) { R.ads = ads; renderBand(); renderAds(); } })
      .catch(() => { if (R.key === k) { R.err = true; renderBand(); renderAds(); } });
  });
}

// ---- budget -----------------------------------------------------------------------
const A0 = S.model.ref_area, BS = BETA[SIZE];
const areaFor = (B, c) => A0 * (B / (A0 * Math.exp(c))) ** (1 / (1 + BS));
const RATES = [0.025, 0.03, 0.035, 0.04];
const nz = x => Number.isNaN(x) ? 0 : x;
function budgetOf(p) {  // URL → inputs; build year defaults to the reference flat's
  const num = k => parseNumFa(p.get(k) || ""), built = parseIntFa(p.get("built") || "");
  return {dep: num("dep"), rent: num("rent"), rate: RATES.includes(+p.get("rate")) ? +p.get("rate") : S.rate,
          year_built: validBuilt(built) ? built : REF.year_built, builtSet: validBuilt(built),
          parking: p.get("parking") !== "0", elevator: p.get("elevator") !== "0"};
}
function readBudget() {
  const chip = k => document.querySelector(`#b-form .chip[data-key="${k}"]`).getAttribute("aria-pressed") === "true";
  const built = parseBuilt($("b-built").value);
  return {dep: parseNumFa($("b-dep").value), rent: parseNumFa($("b-rent").value), rate: +$("b-rate").value,
          year_built: validBuilt(built) ? built : REF.year_built, builtSet: validBuilt(built), parking: chip("parking"), elevator: chip("elevator")};
}
const budgetQuery = b => Object.entries({dep: b.dep, rent: b.rent, rate: b.rate, built: b.builtSet ? b.year_built : NaN,
  parking: +b.parking, elevator: +b.elevator}).filter(([, x]) => !Number.isNaN(x)).map(([k, x]) => `${k}=${x}`).join("&");
function renderBudget(params) {
  const b = budgetOf(params);
  $("b-dep").value = Number.isNaN(b.dep) ? "" : toFa(b.dep);
  $("b-rent").value = Number.isNaN(b.rent) ? "" : toFa(b.rent);
  $("b-rate").value = String(b.rate);
  $("b-built").value = b.builtSet ? toFa(b.year_built) : "";
  for (const c of document.querySelectorAll("#b-form .chip")) c.setAttribute("aria-pressed", String(b[c.dataset.key]));
  renderBudgetOut(b);
}
function syncBudget() {  // inputs live in the URL (shareable), no new history entry, no re-render
  const b = readBudget();
  history.replaceState(history.state, "", `#budget?${budgetQuery(b)}`);
  lastHash = location.hash;
  renderBudgetOut(b);
}
function renderBudgetOut(b) {
  const out = $("b-out"), sum = $("b-summary"), B = nz(b.dep) + nz(b.rent) / b.rate;
  if (!(B > 0)) { out.hidden = true; sum.textContent = "ودیعه یا اجارهٔ ماهانه را وارد کنید."; return; }
  if (!(1 + BS > 0.05)) { out.hidden = true; sum.textContent = "محاسبهٔ بودجه با مدل این هفته ممکن نیست."; return; }
  const f = {year_built: b.year_built, floor: RF.floor, parking: b.parking, elevator: b.elevator, renovated: false, complex: false, area_m2: A0};
  const rows = S.hoods.filter(priced).map(h => ({h, a: Math.round(areaFor(B, predict({...f, hood: h.slug}).mu))})).sort((x, y) => y.a - x.a);
  const val = a => a < 20 ? "کمتر از ۲۰ متر" : a > 300 ? "بیش از ۳۰۰ متر" : `${fa0.format(a)} متر`;
  sum.textContent = `بودجهٔ شما برابر ${fmtM(B)} میلیون تومان رهن کامل است (اجارهٔ ماهانه با نرخ ${faM1.format(b.rate * 100)}٪ تبدیل شده). `
    + `متراژ یک واحد ${fa0.format(S.year - b.year_built)} ساله، ${floorText(RF.floor)}، ${b.parking ? "با" : "بدون"} پارکینگ و ${b.elevator ? "با" : "بدون"} آسانسور در هر محله:`
    + (rows.some(({a}) => a < SZ0 || a > SZ1) ? ` مدل با آگهی‌های ${fa0.format(SZ0)} تا ${fa0.format(SZ1)} متری ساخته شده؛ بیرون از این بازه دقت کمتر است.` : "");
  const href = (h, a) => a >= 20 && a <= 300 ? `#estimate/result?${query(h.slug, {...f, area_m2: a})}` : null;
  $("b-list").innerHTML = rows.map(({h, a}) => {
    const to = href(h, a), q = qClassOf(h.slug), inner = (q ? `<span class="row__swatch ${q}"></span>` : "")
      + `<span class="row__main"><span class="row__title">${esc(h.name)}</span><span class="row__sub">${fa0.format(h.n)} آگهی</span></span>`
      + (low(h) ? badgeLow : "") + `<span class="row__val">${val(a)}</span>` + (to ? icon("i-chevron", "icon--fwd") : "");
    return `<li>${to ? `<a class="row" href="${to}">${inner}</a>` : `<span class="row">${inner}</span>`}</li>`;
  }).join("");
  const map = mapIn("b-map-box"), by = Object.fromEntries(rows.map(r => [r.h.slug, r]));
  for (const el of map.querySelectorAll(".sel, .mine")) el.classList.remove("sel", "mine");
  map.classList.remove("hint");
  for (const c of map.querySelectorAll(".cell")) {
    const {h, a} = by[c.dataset.slug], to = href(h, a);
    if (to) c.setAttribute("href", to); else c.removeAttribute("href");
    c.setAttribute("aria-label", `${h.name}: ${val(a)} با این بودجه`);
    const lv = map.querySelector(`.lbl[data-slug="${h.slug}"] .lbl-val`);
    if (lv) lv.textContent = a < 20 ? "<۲۰" : a > 300 ? ">۳۰۰" : fa0.format(a);
  }
  const lg = document.querySelector("#x-map .legend"), base = S.model.baseline;
  const delta = predict({...f, hood: base}).mu - predict({...REF, area_m2: A0, hood: base}).mu;
  const edges = lg.dataset.edges.split(",").map(Number);
  $("b-legend").innerHTML = lg.outerHTML;
  const nl = $("b-legend").querySelector(".legend");
  nl.querySelector(".legend__title").textContent = "متراژ با این بودجه (متر)";
  nl.querySelectorAll(".legend__ticks span").forEach((s, i) => {
    s.textContent = fa0.format(Math.round(areaFor(B, Math.log(edges[i] / RF.area_m2) - BS * Math.log(RF.area_m2 / A0) + delta)));
  });
  out.hidden = false;
}
function initBudget() {
  $("b-built").placeholder = `مثلاً ${toFa(REF.year_built)}`;
  const form = $("b-form");
  form.addEventListener("input", syncBudget);
  form.addEventListener("change", syncBudget);
  form.addEventListener("click", ev => {
    const c = ev.target.closest(".chip");
    if (!c) return;
    c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true"));
    syncBudget();
  });
  form.addEventListener("submit", ev => ev.preventDefault());
}

// ---- wiring ------------------------------------------------------------------------
let installEv = null;  // Android/Chrome only; iOS installs from the share menu
function initInstall() {
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(err => console.warn("sw:", err)));
  addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); installEv = ev; $("x-install").hidden = false; });
  addEventListener("appinstalled", () => { installEv = null; $("x-install").hidden = true; });
  $("x-install").addEventListener("click", () => {
    const ev = installEv;
    if (!ev) return;
    installEv = null;
    $("x-install").hidden = true;
    ev.prompt();
    ev.userChoice.then(c => track("trackEvent", "pwa", "install_prompt", c.outcome));
  });
}

const PARENT = {result: p => `#estimate/flat?${p}`, flat: p => `#estimate/hood?${p}`, hood: () => "#", budget: () => "#"};
function init() {
  initExplore();
  initHoodStep();
  initFlatStep();
  initResult();
  initBudget();
  initInstall();
  document.addEventListener("toggle", ev => {  // toggle does not bubble; capture sees it
    if (ev.target instanceof HTMLDetailsElement && ev.target.open && ev.target.id) track("trackEvent", "section", "open", ev.target.id);
  }, true);
  document.addEventListener("click", ev => {
    const a = ev.target.closest('a[href^="https://divar.ir/"]');
    if (a) track("trackLink", a.href, "link");
  }, true);
  document.addEventListener("click", ev => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const back = ev.target.closest("[data-back]");
    if (back) {
      const r = curRoute;
      goBack(PARENT[r.view](r.params ? query(r.params.get("hood") || "", flatOf(r.params)).replace(/^hood=&/, "") : ""));
      return;
    }
    const a = ev.target.closest("a[href]");
    const href = a && a.getAttribute("href");
    if (!href || !href.startsWith("#")) return;
    ev.preventDefault();
    if (href === location.hash) return;
    go(href, {replace: curRoute.view === "explore" && !!curRoute.sheet && href.startsWith("#hood=")});
  });
  addEventListener("popstate", render);
  addEventListener("hashchange", render);
  render();
}

init();
