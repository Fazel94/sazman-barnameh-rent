"use strict";
// One script for every page: <body data-page> picks the init (explore, hoods, flat-step, result, budget);
// data is the inline #snapshot; per-hood ads load from <zone path>data/ads/<slug>.json on demand. Mirrors estimate.py's model.

const S = JSON.parse(document.getElementById("snapshot").textContent);
const BASE = S.zone.path;  // "/", "/east/", "/karaj/": every link but /hood/<slug>/ lives under it

const fa0 = new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 0});
const fa1 = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 1, maximumFractionDigits: 1});
const faM1 = new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 1});
const faPct = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero"});
const toFa = s => String(s).replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const pct = v => faPct.format(v) + "٪";
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const $ = id => document.getElementById(id);
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
  "pub_age": () => 0,  // days since the ad was published: a flat being priced is at the snapshot's asking level
};
const feature = name => {
  if (name.startsWith("hood:")) return f => +(f.hood === name.slice(5));
  const knot = /^age>(\d+)$/.exec(name);  // piecewise-linear age: years beyond each knot of model.AGE_KNOTS
  if (knot) return f => Math.max(0, S.year - f.year_built - +knot[1]);
  if (!FEATURES[name]) throw new Error(`app.js: no evaluator for model feature ${name}`);
  return FEATURES[name];
};
const NAMES = S.model.names;
const K = (i => i < 0 ? NAMES.length : i)(NAMES.findIndex(n => n.startsWith("hood:")));
const FEAT = NAMES.slice(0, K).map(feature);
const HOOD_COL = Object.fromEntries(S.model.hoods.map((slug, j) => [slug, j]));   // baseline / unpriced → undefined
const BETA = Object.fromEntries(NAMES.slice(0, K).map((n, i) => [n, S.model.beta[i]]));
const SIZE = `log(size/${S.model.ref_area})`;
const AGE_TERMS = NAMES.slice(0, K).filter(n => n === "age" || n.startsWith("age>")).map(n => [S.model.beta[NAMES.indexOf(n)], feature(n)]);
const ageLog = f => AGE_TERMS.reduce((s, [b, g]) => s + b * g(f), 0);  // the whole age effect, log scale
function predict(f) {  // mirror of model.predict: mu and the one-flat SE of log(M/m²) with the hood's residual sd
  const x = FEAT.map(g => g(f)), j = HOOD_COL[f.hood], {beta, cov_ff, cov_fh, var_h, sigma, sigma_hood} = S.model;
  let mu = 0, v = 0;
  for (let r = 0; r < K; r++) { mu += x[r] * beta[r]; for (let c = 0; c < K; c++) v += x[r] * cov_ff[r][c] * x[c]; }
  if (j !== undefined) { mu += beta[K + j]; v += var_h[j]; for (let r = 0; r < K; r++) v += 2 * x[r] * cov_fh[j][r]; }
  return {mu, one: Math.hypot(Math.sqrt(Math.max(v, 0)), sigma_hood[f.hood] ?? sigma)};
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


// ---- hoods ----------------------------------------------------------------------
const hoodBySlug = Object.fromEntries(S.hoods.map(h => [h.slug, h]));
const priced = h => h.ref_ppm !== null;
const low = h => priced(h) && h.low_data;
const zoneMedian = () => S.zone.median_ref_ppm ?? median(S.hoods.filter(priced).map(h => h.ref_ppm));
const RF = S.reference.flat;
const REF = {...RF, year_built: S.year - RF.age};
const refText = `${fa0.format(RF.area_m2)} متر، ${fa0.format(RF.age)} ساله، ${floorText(RF.floor)}، `
  + (RF.parking && RF.elevator ? "با پارکینگ و آسانسور" : `${RF.parking ? "با" : "بدون"} پارکینگ، ${RF.elevator ? "با" : "بدون"} آسانسور`);
const badgeLow = '<span class="badge badge--warn">کم‌داده</span>';
const exploreCell = slug => document.querySelector(`#x-map a.cell[data-slug="${slug}"]`);
const qClassOf = slug => { const q = hoodBySlug[slug]?.q; return q ? `q${q}` : null; };

const adsCache = {}, adsPending = {};
function loadAds(slug) {  // caches resolved files only, so a failed fetch can be retried
  if (adsCache[slug]) return Promise.resolve(adsCache[slug]);
  if (!hoodBySlug[slug].n) return Promise.resolve(adsCache[slug] = []);
  if (adsPending[slug]) return adsPending[slug];
  return adsPending[slug] = fetch(`${BASE}data/ads/${slug}.json`).then(r => {
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

// ---- shared -----------------------------------------------------------------------
const KEYS = ["hood", "area", "built", "floor", "parking", "elevator", "renovated", "complex"];
function flatOf(p) {  // URL → flat; an absent key takes the reference flat's value (the form's defaults)
  const int = k => /^\d+$/.test(p.get(k) || "") ? +p.get(k) : NaN;
  const floor = int("floor");
  return {area_m2: p.has("area") ? int("area") : REF.area_m2, year_built: p.has("built") ? int("built") : REF.year_built,
          floor: Number.isNaN(floor) ? RF.floor : clamp(floor, 0, 30),
          parking: p.get("parking") !== "0", elevator: p.get("elevator") !== "0",
          renovated: p.get("renovated") === "1", complex: p.get("complex") === "1"};
}
function query(hood, f) {
  const v = {hood, area: f.area_m2, built: f.year_built, floor: f.floor, parking: +f.parking, elevator: +f.elevator,
             renovated: +f.renovated, complex: +f.complex};
  return KEYS.filter(k => v[k] !== undefined && v[k] !== null && !Number.isNaN(v[k])).map(k => `${k}=${v[k]}`).join("&");
}
const flatText = f => [`${fa0.format(f.area_m2)} متر`, `ساخت ${toFa(f.year_built)}`, floorText(f.floor)]
  .concat([["parking", "پارکینگ"], ["elevator", "آسانسور"], ["renovated", "بازسازی‌شده"], ["complex", "مجتمع"]].filter(([k]) => f[k]).map(([, v]) => v)).join("، ");
const validArea = a => Number.isInteger(a) && a >= 20 && a <= 300;
const validBuilt = y => Number.isInteger(y) && y >= 1300 && y <= S.year;
// the result's hood; otherwise the hoods page for this flat (which toasts a known but unpriced hood)
function priceableHood(params) {
  const h = hoodBySlug[params.get("hood")];
  if (h && priced(h)) return h;
  location.replace(`${BASE}estimate/?${query(h ? h.slug : null, flatOf(params))}`);
  return null;
}

// Matomo: base.html defines window._paq on rent.nlogn.ir only; elsewhere these are no-ops.
const track = (...cmd) => { if (window._paq) window._paq.push(cmd); };

// ---- explore ----------------------------------------------------------------------
// The bottom sheet is the one in-place view: /#hood=<slug>. Opening it pushes one history entry, so back closes it.
const sheetSlug = () => { const m = location.hash.match(/^#hood=([\w-]+)$/); return m && hoodBySlug[m[1]] ? m[1] : null; };
function openSheet(slug) {
  if (sheetSlug()) history.replaceState(history.state, "", "#hood=" + slug);
  else history.pushState({sheet: true}, "", "#hood=" + slug);
  renderSheet(true);
  track("trackEvent", "sheet", "open", slug);
}
function closeSheet() {
  if (history.state?.sheet) history.back();
  else { history.replaceState(null, "", location.pathname + location.search); renderSheet(false); }
}

function initExplore() {
  $("x-pick").addEventListener("click", ev => {
    ev.preventDefault();
    const map = document.querySelector("#x-map svg.map");
    $("x-map").scrollIntoView({block: "start", behavior: "smooth"});
    map.classList.add("hint");
    setTimeout(() => map.classList.remove("hint"), 1600);
    toast("روی محلهٔ خود روی نقشه بزنید.");
  });
  document.querySelector("#x-map svg.map").addEventListener("click", ev => {
    if (!ev.target.closest(".cell") && sheetSlug()) closeSheet();
  });
  $("x-sheet-close").addEventListener("click", closeSheet);
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && sheetSlug()) closeSheet(); });
  document.addEventListener("click", ev => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = ev.target.closest("#x-map a[data-slug], #x-sheet a[data-slug]");
    if (a) { ev.preventDefault(); openSheet(a.dataset.slug); }
  });
  addEventListener("popstate", () => renderSheet(false));
  addEventListener("hashchange", () => renderSheet(false));
  initInstall();
  renderSheet(false);
}

function renderSheet(focus) {
  const slug = sheetSlug();
  const sheet = $("x-sheet");
  for (const c of document.querySelectorAll("#x-map .cell.sel")) c.classList.remove("sel");
  if (!slug) {
    sheet.hidden = true;
    document.body.style.paddingBottom = "";
    return;
  }
  const h = hoodBySlug[slug], cell = exploreCell(h.slug);
  if (cell) { cell.classList.add("sel"); cell.parentNode.appendChild(cell); }
  $("x-sheet-title").innerHTML = esc(h.name) + (low(h) ? " " + badgeLow : "");
  const chips = h.neighbors.filter(s => hoodBySlug[s]).map(s => `<a class="chip" href="/hood/${s}/" data-slug="${s}">${esc(hoodBySlug[s].name)}</a>`).join("");
  const near = chips ? `<h3 class="sheet__sub">محله‌های نزدیک</h3><div class="chips">${chips}</div>` : "";
  let body;
  if (!priced(h)) {
    body = `<p>فقط ${fa0.format(h.n)} آگهی؛ برای برآورد کافی نیست.</p>` + near;
  } else {
    const rows = [["آگهی تمیز این هفته", fa0.format(h.n)],
      ["میانهٔ آگهی‌ها", `ودیعه ${fmtM(h.median_deposit)} + اجاره ${fa1.format(h.median_rent)} (رهن کامل ${fmtM(h.median_equiv)})`],
      ["میانهٔ متراژ و عمر بنا", `${fa0.format(h.median_area)} متر، ${fa0.format(h.median_age)} سال`]];
    if (h.change !== null) rows.push(["نسبت به برداشت قبل", pct(h.change * 100)]);
    body = `<p class="sheet__ref muted">واحد مرجع: ${refText}</p>`
      + `<p class="price price--sheet"><span class="price__value">${fmtM(h.ref_equiv)} <span class="price__unit">میلیون تومان رهن کامل</span></span></p>`
      + `<p class="price__sub">۹۵٪ آگهی‌های چنین واحدی: ${fmtM(h.band_one[0])} تا ${fmtM(h.band_one[1])}</p>`
      + `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` + near
      + `<a class="btn btn--primary btn--block" href="${BASE}estimate/flat/?hood=${h.slug}">برآورد واحد من در ${esc(h.name)}</a>`
      + `<a class="btn btn--text btn--block" href="/hood/${h.slug}/">صفحهٔ ${esc(h.name)}</a>`;
  }
  $("x-sheet-body").innerHTML = body;
  const wasHidden = sheet.hidden;
  sheet.hidden = false;
  $("x-sheet-body").scrollTop = 0;
  document.body.style.paddingBottom = `${sheet.offsetHeight}px`;
  if (wasHidden && focus) $("x-sheet-title").focus({preventScroll: true});
}

// ---- hoods: one flat priced in every hood (map, search, list) ---------------------------------
const STOP = new Set(["خیابان", "خ", "بلوار", "میدان", "کوچه", "بزرگراه"]);
const SEARCH = S.hoods.map(h => ({h, key: norm(h.name).replace(/ /g, ""),
  streets: (h.streets || []).map(s => [s, norm(s).replace(/ /g, "")])}));
// cheap → dear for every flat (the hood effect is one additive log term); unpriced hoods last
const BY_PRICE = [...S.hoods].sort((a, b) => (a.ref_ppm ?? Infinity) - (b.ref_ppm ?? Infinity) || a.name.localeCompare(b.name, "fa"));
let hoodsFlat = null, hoodsCur = null;

function searchHoods(q) {
  const words = norm(q).split(" ").filter(w => w && !STOP.has(w));
  if (!words.length) return BY_PRICE.map(h => ({h}));
  const all = s => words.every(w => s.includes(w)), byN = (a, b) => b.h.n - a.h.n;
  const names = SEARCH.filter(e => all(e.key)).map(e => ({h: e.h})).sort(byN);
  const streets = SEARCH.filter(e => !all(e.key)).map(e => ({h: e.h, street: (e.streets.find(([, k]) => all(k)) || [])[0]}))
    .filter(e => e.street).sort(byN);
  return names.concat(streets);
}

function renderHoodList() {
  const res = searchHoods($("h-q").value), f = hoodsFlat;
  $("h-empty").hidden = res.length > 0;
  $("h-list").innerHTML = res.map(({h, street}) => {
    const q = qClassOf(h.slug), ok = priced(h);
    const sub = !ok ? `کمتر از ${fa0.format(S.thresholds.priced)} آگهی؛ برآورد ممکن نیست`
      : (street ? `${street.startsWith("خیابان") ? "" : "خیابان "}${esc(street)}، ` : "") + `${fa0.format(h.n)} آگهی`;
    return "<li>" + (ok ? `<a class="row" href="${esc(`${BASE}estimate/result/?${query(h.slug, f)}`)}"${h.slug === hoodsCur ? ' aria-current="true"' : ""}>` : '<span class="row" aria-disabled="true">')
      + (q ? `<span class="row__swatch ${q}"></span>` : "")
      + `<span class="row__main"><span class="row__title">${esc(h.name)}</span><span class="row__sub">${sub}</span></span>`
      + (low(h) ? badgeLow : "") + (ok ? `<span class="row__val">${fmtB(estimate({...f, hood: h.slug}).equiv)} میلیارد</span>` : "")
      + icon("i-chevron", "icon--fwd") + (ok ? "</a></li>" : "</span></li>");
  }).join("");
}

const distM = (lat1, lon1, lat2, lon2) => {  // port of divar.dist_m
  const p = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * p / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lon2 - lon1) * p / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};

let zoneQ = "";
function zoneTabs(q) {  // region tabs and the map's region pointers carry the typed inputs
  zoneQ = q;
  for (const a of document.querySelectorAll(".zone-tabs a")) a.search = q;
  for (const a of document.querySelectorAll("a.zptr")) a.setAttribute("href", a.getAttribute("data-base") + (q ? `?${q}` : ""));
}
function initHoods() {
  const params = new URLSearchParams(location.search), f = flatOf(params), pre = hoodBySlug[params.get("hood")];
  if (!validArea(f.area_m2) || !validBuilt(f.year_built)) {
    location.replace(`${BASE}estimate/flat/?${query(null, f)}&err=1`);
    return;
  }
  if (pre && !priced(pre)) toast(`برای ${pre.name} داده کافی نیست.`);
  hoodsFlat = f;
  zoneTabs(query(null, f));
  hoodsCur = pre && priced(pre) ? pre.slug : null;
  $("h-edit").href = document.querySelector("[data-back]").href = `${BASE}estimate/flat/?${query(null, f)}`;
  $("h-summary").textContent = flatText(f);
  $("h-banners").innerHTML = f.area_m2 < SZ0 || f.area_m2 > SZ1 ? `<p class="banner banner--info" role="note">${SIZE_HINT}</p>` : "";
  const vals = S.hoods.filter(h => priced(h) && !h.low_data).map(h => estimate({...f, hood: h.slug}).equiv);  // the hoods the map draws
  $("h-range").textContent = `رهن کامل این واحد در ${fa0.format(vals.length)} محلهٔ روی نقشه از ${fmtB(Math.min(...vals))} تا `
    + `${fmtB(Math.max(...vals))} میلیارد تومان است؛ میانه ${fmtB(median(vals))} میلیارد.`;
  labelMap("h-map-box", "h-legend", f, hoodsCur);
  renderHoodList();
  $("h-q").addEventListener("input", renderHoodList);
  if (!("geolocation" in navigator)) { $("h-locate").hidden = true; return; }
  $("h-locate").addEventListener("click", () => locate(hoodsFlat, [S.zone.id]));
  const tried = (params.get("locate") || "").split(",").filter(Boolean);
  if (tried.length) {  // arrived from another region's button (locate=<regions tried>): drop the flag, then locate here
    history.replaceState(null, "", `${location.pathname}?${query(hoodsCur, f)}`);
    locate(f, tried);
  }
}

function locate(f, tried) {  // nearest hood of this region, else a region whose frame holds the user (never one already tried)
  navigator.geolocation.getCurrentPosition(pos => {
    const {latitude: la, longitude: lo} = pos.coords;
    let best = null, bd = Infinity;
    for (const h of S.hoods) { const d = distM(la, lo, h.lat, h.lon); if (d < bd) { bd = d; best = h; } }
    if (!best || bd > 3000) {
      const inside = z => !tried.includes(z.id) && lo >= z.bbox[0] && la >= z.bbox[1] && lo <= z.bbox[2] && la <= z.bbox[3];
      const mid = z => (((z.bbox[0] + z.bbox[2]) / 2 - lo) * 0.81) ** 2 + ((z.bbox[1] + z.bbox[3]) / 2 - la) ** 2;  // 0.81 ≈ cos(lat)
      const z = S.zones.filter(inside).sort((a, b) => mid(a) - mid(b))[0];  // frames overlap: nearest centre first
      if (z) { location.href = `${z.path}estimate/?${query(null, f)}&locate=${[...tried, z.id].join(",")}`; return; }
      toast(`موقعیت شما بیرون از ${S.zones.map(z => z.name).join("، ")} است.`);
      return;
    }
    if (priced(best)) { location.href = `${BASE}estimate/result/?${query(best.slug, f)}`; return; }
    toast(`برای ${best.name} داده کافی نیست.`);
    $("h-q").value = best.name;
    renderHoodList();
  }, () => toast("موقعیت در دسترس نیست."), {enableHighAccuracy: false, timeout: 10000, maximumAge: 600000});
}

// ---- flat: the form; with ?hood= it opens that hood's result, without it every hood's price -------
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
function syncFlatUrl() {  // keep the typed flat in the URL so reload / «تغییر محله» resume it; an empty field drops its key
  const q = query(flatHood, readFlat());
  history.replaceState(null, "", `${BASE}estimate/flat/?${q}`);
  const a = $("f-context").querySelector("a");
  if (a) a.href = `${BASE}estimate/?${q}`;
}

function renderFlatStep(params) {
  const h = hoodBySlug[flatHood], f = flatOf(params);
  if (h) prefetch(h.slug);
  $("f-context").innerHTML = h ? `${esc(h.name)}${low(h) ? " " + badgeLow : ""}، ${fa0.format(h.n)} آگهی، واحد مرجع ${fmtM(h.ref_equiv)} میلیون `
    + `<a href="${BASE}estimate/?${query(h.slug, f)}">تغییر محله</a>` : "در قدم بعد رهن کامل همین واحد را در هر محله روی نقشه می‌بینید.";
  $("f-submit").textContent = h ? "دیدن برآورد" : "دیدن قیمت در محله‌ها";
  document.querySelector("[data-back]").href = h ? `${BASE}#hood=${h.slug}` : BASE;
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
  const params = new URLSearchParams(location.search), h = hoodBySlug[params.get("hood")];
  if (h && !priced(h)) toast(`برای ${h.name} داده کافی نیست.`);
  flatHood = h && priced(h) ? h.slug : null;
  pendingErrors = params.get("err") === "1";
  const form = $("f-form");
  for (const id of ["f-area", "f-built"]) {
    const el = $(id), check = id === "f-area" ? checkArea : checkBuilt, read = id === "f-area" ? readArea : readBuilt;
    el.addEventListener("focus", () => setTimeout(() => el.select()));  // typing replaces the default value
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
    location.href = `${BASE}estimate/${flatHood ? "result/" : ""}?${query(flatHood, readFlat())}`;
  });
  renderFlatStep(params);
  syncFlatUrl();
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
  $("r-summary").textContent = `${h.name}، ${flatText(f)}`;
  $("r-edit").href = `${BASE}estimate/flat/?${key}`;
  document.querySelector("[data-back]").href = `${BASE}estimate/?${key}`;
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
  $("r-basis").textContent = `بر پایهٔ ${fa0.format(h.n)} آگهی ${h.name} و مدلی از ${fa0.format(S.counts.peers)} آگهی ${S.zone.name}، برداشت ${toFa(S.jalali)}`;
  readOffer();
  renderBand();
  renderAds();
  labelMap("r-map-box", "r-legend", f, h.slug);
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
  if (age !== RF.age) rows.push([`${fa0.format(age)} سال عمر به‌جای ${fa0.format(RF.age)}`, Math.exp(ageLog(f) - ageLog(REF))]);
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
function adCard(a) {
  const stats = [`${fa0.format(a.area_m2)} متر`, `ساخت ${toFa(a.year_built)}`].concat(a.floor === null || a.floor === undefined ? [] : [floorText(a.floor)]);
  const tags = [a.parking ? "<span class=\"badge\">پارکینگ</span>" : "<span class=\"badge badge--off\">بدون پارکینگ</span>",
    a.elevator ? "<span class=\"badge\">آسانسور</span>" : "<span class=\"badge badge--off\">بدون آسانسور</span>"]
    .concat(a.renovated ? ["<span class=\"badge\">بازسازی‌شده</span>"] : []).join("");
  const fit = dealBadge(a.vs_fit_pct);
  const m = x => x === null || x === undefined ? "—" : fmtM(x);
  return `<article class="ad"><p class="ad__stats">${stats.join("، ")}</p><div class="ad__tags">${tags}</div>`
    + `<dl class="kv ad__price"><div><dt>ودیعه</dt><dd>${m(a.deposit_m)}</dd></div><div><dt>اجارهٔ ماهانه</dt><dd>${m(a.rent_m)}</dd></div>`
    + `<div class="kv--strong"><dt>رهن کامل</dt><dd>${m(a.equiv_m)}</dd></div></dl>`
    + `<div class="ad__foot">${fit}<span class="ad__age">${adAge(a.published_days)}</span>`
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

function mapIn(boxId) {  // this page's copy of the map (with its region pointers) in <template id="map-tpl">, created on first use
  const box = $(boxId), have = box.querySelector("svg.map");
  if (have) return have;
  box.appendChild($("map-tpl").content.querySelector(".mapbox").cloneNode(true));
  zoneTabs(zoneQ);  // the copy's region pointers
  return box.querySelector("svg.map");
}
// The template's map in boxId and its legend in legendId, labelled with flat f's full-deposit price in every hood; each
// cell opens that hood's result. Colours stay the reference flat's classes: every hood's price scales by the same factor.
function labelMap(boxId, legendId, f, mine) {
  const map = mapIn(boxId);
  map.classList.remove("hint");
  for (const el of map.querySelectorAll(".sel, .mine")) el.classList.remove("sel", "mine");
  for (const c of map.querySelectorAll(".cell")) {
    const slug = c.dataset.slug, h = hoodBySlug[slug], v = estimate({...f, hood: slug}).equiv;
    c.setAttribute("href", `${BASE}estimate/result/?${query(slug, f)}`);
    c.setAttribute("aria-label", `${h.name}: ${fmtB(v)} میلیارد تومان برای واحد شما`);
    const val = map.querySelector(`.lbl[data-slug="${slug}"] .lbl-val`);
    if (val) val.textContent = fmtB(v);
    if (slug === mine) {
      c.classList.add("mine");
      c.parentNode.appendChild(c);
      map.querySelector(`.lbl[data-slug="${slug}"]`)?.classList.add("mine");
    }
  }
  const lg = $("map-tpl").content.querySelector(".legend"), base = S.model.baseline;
  const k = Math.exp(predict({...f, hood: base}).mu - predict({...REF, hood: base}).mu) * f.area_m2 / REF.area_m2;
  const edges = lg.dataset.edges.split(",").map(Number);
  $(legendId).innerHTML = lg.outerHTML;
  const nl = $(legendId).querySelector(".legend");
  nl.querySelector(".legend__title").textContent = "رهن کامل همین واحد، میلیارد تومان";
  nl.querySelectorAll(".legend__ticks span").forEach((s, i) => { s.textContent = fmtB(edges[i] * k); });
}

function initResult() {
  const params = new URLSearchParams(location.search);
  if (!priceableHood(params)) return;
  const flat = flatOf(params);
  if (!validArea(flat.area_m2) || !validBuilt(flat.year_built)) {
    location.replace(`${BASE}estimate/flat/?${query(params.get("hood"), flat)}&err=1`);
    return;
  }
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
  zoneTabs(query(null, flat));  // the map's region pointers open that region's hood list for this flat
  renderResult(params);
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
  history.replaceState(null, "", `${BASE}budget/?${budgetQuery(b)}`);
  renderBudgetOut(b);
}
function renderBudgetOut(b) {
  zoneTabs(budgetQuery(b));
  const out = $("b-out"), sum = $("b-summary"), B = nz(b.dep) + nz(b.rent) / b.rate;
  if (!(B > 0)) { out.hidden = true; sum.textContent = "ودیعه یا اجارهٔ ماهانه را وارد کنید."; return; }
  if (!(1 + BS > 0.05)) { out.hidden = true; sum.textContent = "محاسبهٔ بودجه با مدل این هفته ممکن نیست."; return; }
  const f = {year_built: b.year_built, floor: RF.floor, parking: b.parking, elevator: b.elevator, renovated: false, complex: false, area_m2: A0};
  const rows = S.hoods.filter(priced).map(h => ({h, a: Math.round(areaFor(B, predict({...f, hood: h.slug}).mu))})).sort((x, y) => y.a - x.a);
  const val = a => a < 20 ? "کمتر از ۲۰ متر" : a > 300 ? "بیش از ۳۰۰ متر" : `${fa0.format(a)} متر`;
  sum.textContent = `بودجهٔ شما برابر ${fmtM(B)} میلیون تومان رهن کامل است (اجارهٔ ماهانه با نرخ ${faM1.format(b.rate * 100)}٪ تبدیل شده). `
    + `متراژ یک واحد ${fa0.format(S.year - b.year_built)} ساله، ${floorText(RF.floor)}، ${b.parking ? "با" : "بدون"} پارکینگ و ${b.elevator ? "با" : "بدون"} آسانسور در هر محله:`
    + (rows.some(({a}) => a < SZ0 || a > SZ1) ? ` مدل با آگهی‌های ${fa0.format(SZ0)} تا ${fa0.format(SZ1)} متری ساخته شده؛ بیرون از این بازه دقت کمتر است.` : "");
  const href = (h, a) => a >= 20 && a <= 300 ? `${BASE}estimate/result/?${query(h.slug, {...f, area_m2: a})}` : null;
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
  const lg = $("map-tpl").content.querySelector(".legend"), base = S.model.baseline;
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
  renderBudget(new URLSearchParams(location.search));
}

let installEv = null;  // set where the browser offers a one-tap install (Chrome on Android); elsewhere the button shows steps
function installHelp() {
  const ua = navigator.userAgent;
  if (/; wv\)|FBAN|FBAV|Instagram|Telegram|Eitaa|Line\//.test(ua)) return "این صفحه داخل برنامهٔ دیگری باز شده و نصب در آن ممکن نیست. از منوی ⋮ گزینهٔ «باز کردن در مرورگر» را بزنید و دوباره امتحان کنید.";
  if (/iPad|iPhone|iPod/.test(ua)) return "دکمهٔ اشتراک‌گذاری مرورگر را بزنید و «افزودن به صفحهٔ اصلی» را انتخاب کنید.";
  return "از منوی مرورگر (⋮) گزینهٔ «نصب برنامه» یا «افزودن به صفحهٔ اصلی» را بزنید. اگر نبود، مرورگرتان نصب را پشتیبانی نمی‌کند؛ Chrome را به‌روز کنید.";
}
function initInstall() {
  const btn = $("x-install"), help = $("x-install-help");
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return;  // already installed: no button
  btn.hidden = false;
  addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); installEv = ev; });
  addEventListener("appinstalled", () => { installEv = null; btn.hidden = true; help.hidden = true; });
  btn.addEventListener("click", async () => {
    const ev = installEv;
    if (!ev) { help.textContent = installHelp(); help.hidden = false; track("trackEvent", "pwa", "install_help", "shown"); return; }
    installEv = null;  // a prompt event is single-use; the browser fires a new one after a dismissal
    ev.prompt();
    const c = await ev.userChoice;
    track("trackEvent", "pwa", "install_prompt", c.outcome);
    if (c.outcome !== "accepted") { help.textContent = installHelp(); help.hidden = false; }
  });
}


function init() {
  ({"explore": initExplore, "hoods": initHoods, "flat-step": initFlatStep, "result": initResult, "budget": initBudget})[document.body.dataset.page]();
  document.addEventListener("toggle", ev => {  // toggle does not bubble; capture sees it
    if (ev.target instanceof HTMLDetailsElement && ev.target.open && ev.target.id) track("trackEvent", "section", "open", ev.target.id);
  }, true);
  document.addEventListener("click", ev => {  // app-bar back = browser back when we came from this site, else the parent page
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    if (ev.target.closest("[data-back]") && history.length > 1 && document.referrer.startsWith(location.origin + "/")) {
      ev.preventDefault();
      history.back();
    }
  });
}

init();
