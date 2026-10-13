"use strict";
// Renders the page from the two inline JSON blocks written by build_site.py (per-hood ads load from data/ads/).
// Mirrors estimate.py's model. The selected neighborhood lives in location.hash (#hood=<slug>).

const S = JSON.parse(document.getElementById("snapshot").textContent);
const H = JSON.parse(document.getElementById("history-data").textContent);

const fa0 = new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 0});
const fa1 = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 1, maximumFractionDigits: 1});
const fa2 = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const faM1 = new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 1});
const faS = new Intl.NumberFormat("fa-IR", {maximumFractionDigits: 1, signDisplay: "exceptZero"});
const faPct = new Intl.NumberFormat("fa-IR", {minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero"});
const toFa = s => String(s).replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const pct = v => faPct.format(v) + "٪";
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const $ = id => document.getElementById(id);
const UNIT = "میلیون تومان";
const DEFAULT_HOOD = "sazman-barname-jonubi";
const MIN_PRICED = S.thresholds.priced;  // fewer clean ads → no own hood effect, no reference price
const hoodBySlug = Object.fromEntries(S.hoods.map(h => [h.slug, h]));
let hood = null;        // selected slug
let ADS = [];           // clean ads of the selected hood
const adsCache = {};
const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const numOrDash = v => v === null || v === undefined ? "—" : fa0.format(v);

function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- model (mirror of estimate.flights / estimate.row) ---------------------
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
const DESIGN = S.model.names.map(feature);
const rowOf = f => DESIGN.map(g => g(f));
const predictPpm = f => Math.exp(rowOf(f).reduce((a, v, i) => a + v * S.model.beta[i], 0));

// ---- svg helpers -------------------------------------------------------------
const scale = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
function ticks(lo, hi, count) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(6));
  return out;
}
const svg = (w, h, body, label) => `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
// charts are direction:rtl so Persian strings with digits render in reading order; anchors here are visual:
// "start" = text begins at x and runs right, "end" = text ends at x
const ANCHOR = {start: "end", end: "start", middle: "middle"};
const txt = (x, y, s, anchor = "middle", cls = "") => `<text x="${x}" y="${y}" text-anchor="${ANCHOR[anchor]}" class="${cls}">${s}</text>`;
const line = (cls, x1, y1, x2, y2) => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
function star(cx, cy, r) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return "M" + p.join("L") + "Z";
}

function fillRows(tbody, rows) {
  tbody.innerHTML = rows.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("");
}

// ---- neighborhood helpers ------------------------------------------------------
const H_ = () => hoodBySlug[hood];
const priced = h => h.ref_ppm !== null;
const zoneMedian = () => S.zone.median_ref_ppm ?? median(S.hoods.filter(priced).map(h => h.ref_ppm));
const hoodRows = slug => H.filter(r => r.hoods[slug] !== undefined);
const splitsBelow = equiv => [500, 1000, 1500, 2000].filter(d => d < equiv).map(d => [d, (equiv - d) * S.rate]);

// ---- static sections ---------------------------------------------------------
function renderSub() {
  $("sub").textContent = `برآورد از آگهی‌های عمومی دیوار · آخرین برداشت: ${toFa(S.jalali)} · `
    + `${fa0.format(S.counts.peers)} آگهی تمیز از ${fa0.format(S.counts.ads)} آگهی در ${fa0.format(S.zone.hoods_with_data)} محله`;
  $("built-on").textContent = `ساخته‌شده در ${toFa(S.jalali)}`;
  $("zone-median").innerHTML = `${fa1.format(zoneMedian())} <small>میلیون/متر، واحد مرجع</small>`;
  $("zone-hoods").textContent = `در ${fa0.format(S.zone.hoods_with_data)} محله با داده`;
}

function renderHeadline() {
  const h = H_();
  $("hood-name").textContent = h.name;
  $("ref-hood-change").textContent = "";
  if (priced(h)) {
    $("ref-hood").innerHTML = `${fa0.format(h.ref_equiv)} <small>${UNIT} رهن کامل</small>`;
    const rows = hoodRows(h.slug);
    if (rows.length >= 2) {
      const prev = rows[rows.length - 2].hoods[h.slug], last = rows[rows.length - 1].hoods[h.slug];
      $("ref-hood-change").textContent = `نسبت به برداشت قبل: ${pct((last / prev - 1) * 100)}`;
    }
  } else {
    $("ref-hood").innerHTML = `<small>داده کافی نیست (${fa0.format(h.n)} آگهی)</small>`;
  }
  $("median-ppm").innerHTML = h.n ? `${fa2.format(h.median_ppm)} <small>میلیون</small>` : "—";
  $("median-equiv").textContent = h.n ? `میانهٔ رهن کامل ${fa0.format(h.median_equiv)} میلیون، ${fa0.format(h.n)} آگهی` : "";
}

function renderPanel() {
  const h = H_(), p = $("hood-panel");
  if (!priced(h)) {
    p.innerHTML = `<h3>${esc(h.name)}</h3><p>${fa0.format(h.n)} آگهی تمیز این هفته</p><p>داده کافی نیست.</p>`;
    return;
  }
  const rows = hoodRows(h.slug);
  let wow = "";
  if (rows.length >= 2) {
    const prev = rows[rows.length - 2].hoods[h.slug], last = rows[rows.length - 1].hoods[h.slug];
    wow = `<p>نسبت به برداشت قبل: ${pct((last / prev - 1) * 100)}</p>`;
  }
  const nb = h.neighbors.map(s => hoodBySlug[s])
    .map(o => `<li><a href="#hood=${o.slug}">${esc(o.name)}</a>: ${fa1.format(o.ref_ppm)} میلیون/متر</li>`).join("");
  p.innerHTML = `<h3>${esc(h.name)}</h3>`
    + `<p>${fa0.format(h.n)} آگهی تمیز این هفته${h.low_data ? " (کم؛ عدد کم‌اطمینان است)" : ""}</p>`
    + `<p>میانهٔ آگهی‌ها: <strong>${fa0.format(h.median_equiv)}</strong> میلیون رهن کامل `
    + `(ودیعه ${fa0.format(h.median_deposit)} + اجاره ${fa1.format(h.median_rent)})، ${fa0.format(h.median_area)} متر</p>`
    + `<p>واحد مرجع: <span class="big">${fa0.format(h.ref_equiv)}</span> میلیون رهن کامل (${fa1.format(h.ref_ppm)} میلیون/متر)</p>`
    + (myEquiv(h) === null ? "" : `<p>واحد شما در این محله: <strong>${fa0.format(myEquiv(h))}</strong> میلیون رهن کامل</p>`)
    + `<p class="note">۹۵٪ آگهی‌های چنین واحدی: ${fa0.format(h.band_one[0])} تا ${fa0.format(h.band_one[1])}</p>` + wow
    + `<p>همین مبلغ به صورت ودیعه + اجاره:</p><ul>`
    + splitsBelow(h.ref_equiv).map(([d, r]) => `<li>${fa0.format(d)} + ${fa1.format(r)} در ماه</li>`).join("") + "</ul>"
    + (nb ? `<p>محله‌های همسایه:</p><ul>${nb}</ul>` : "")
    + `<a class="btn" href="#calc">قیمت واحد خودم در ${esc(h.name)}</a>`;
}

function tipHtml(h) {
  const rows = [["آگهی تمیز", fa0.format(h.n)]];
  if (h.n) rows.push(["میانهٔ رهن کامل", `${fa0.format(h.median_equiv)} میلیون`],
    ["میانهٔ ودیعه", `${fa0.format(h.median_deposit)} میلیون`], ["میانهٔ اجاره", `${fa1.format(h.median_rent)} میلیون`],
    ["میانهٔ متراژ", `${fa0.format(h.median_area)} متر`], ["میانهٔ عمر بنا", `${fa0.format(h.median_age)} سال`],
    ["میانهٔ هر متر", `${fa2.format(h.median_ppm)} میلیون`]);
  if (priced(h)) rows.push(["واحد مرجع ۷۵ متری", `${fa0.format(h.ref_equiv)} میلیون`]);
  const mine = myEquiv(h);
  if (mine !== null) rows.push(["<strong>واحد شما</strong>", `${fa0.format(mine)} میلیون`]);
  return `<b>${esc(h.name)}</b><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>`
    + (priced(h) ? (h.low_data ? `<span class="note">کمتر از ${fa0.format(S.thresholds.solid)} آگهی: کم‌اطمینان</span>` : "")
                 : `<span class="note">داده کافی نیست</span>`);
}

function initMapTips() {
  const box = $("map-svg"), tip = $("hood-tip");
  const show = (a, ev) => {
    tip.innerHTML = tipHtml(hoodBySlug[a.dataset.slug]);
    tip.hidden = false;
    const r = box.getBoundingClientRect();
    let x, y;
    if (ev && ev.clientX !== undefined) { x = ev.clientX - r.left; y = ev.clientY - r.top; }
    else { const c = a.querySelector("circle").getBoundingClientRect(); x = c.left + c.width / 2 - r.left; y = c.top + c.height / 2 - r.top; }
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(0, x > r.width / 2 ? x - w - 14 : x + 14)}px`;
    tip.style.top = `${Math.max(0, Math.min(y - h / 2, r.height - h))}px`;
  };
  for (const a of box.querySelectorAll("a.hood")) {
    a.addEventListener("mousemove", ev => show(a, ev));
    a.addEventListener("focus", () => show(a));
    a.addEventListener("mouseleave", () => { tip.hidden = true; });
    a.addEventListener("blur", () => { tip.hidden = true; });
  }
}

function renderEffects() {
  // age is shown per 10 years so its bar is comparable with the one-off features
  const ageB = S.model.beta[S.model.names.indexOf("age")];
  const rows = S.effects.map(e => e.name === "age"
    ? {label: "۱۰ سال عمر بیشتر", pct: (Math.exp(10 * ageB) - 1) * 100} : {label: e.label, pct: e.pct});
  const W = 600, rowH = 30, L = 190, R = 40, T = 8, Ht = T + rows.length * rowH + 8;
  const half = (W - L - R) / 2, x0 = L + half, k = 0.72 * half / Math.max(...rows.map(r => Math.abs(r.pct)));
  const bars = rows.map((r, i) => {
    const yc = T + i * rowH + rowH / 2, w = Math.abs(r.pct) * k, pos = r.pct >= 0;
    return `<rect class="${pos ? "pos" : "neg"}" x="${(pos ? x0 : x0 - w).toFixed(1)}" y="${yc - 9}" width="${w.toFixed(1)}" height="18" rx="2"/>`
      + txt(L - 10, yc + 4, esc(r.label), "end")
      + txt(pos ? x0 + w + 5 : x0 - w - 5, yc + 4, pct(r.pct), pos ? "start" : "end", "val");
  }).join("");
  $("effects-chart").innerHTML = svg(W, Ht, line("axis", x0, T, x0, Ht - 8) + bars, "اثر هر ویژگی بر قیمت");
  $("sigma-note").textContent = `پراکندگی آگهی‌ها حول مدل: حدود ±${fa0.format((Math.exp(S.model.sigma) - 1) * 100)}٪ برای یک واحد`;
}

function renderMarket() {
  if (S.age === null) { $("market").hidden = true; return; }
  let weeks = S.age.by_week.filter(w => w.n >= 10);
  if (!weeks.length) weeks = S.age.by_week;
  const W = 600, Ht = 230, L = 50, R = 10, T = 20, B = 50;
  const maxAbs = Math.max(1, ...weeks.map(w => Math.abs(w.median_pct))) * 1.25;
  const y = scale(-maxAbs, maxAbs, Ht - B, T), y0 = y(0);
  const bw = (W - L - R) / weeks.length, barW = Math.min(60, bw * 0.6);
  const grid = ticks(-maxAbs, maxAbs, 4).map(v => line("grid", L, y(v), W - R, y(v)) + txt(L - 6, y(v) + 4, faS.format(v) + "٪", "end")).join("");
  const bars = weeks.map((w, i) => {
    const xc = L + bw * (i + 0.5), yv = y(w.median_pct), pos = w.median_pct >= 0;
    const [, mm, dd] = w.week.split("-").map(Number);
    return `<rect class="${pos ? "pos" : "neg"}" x="${(xc - barW / 2).toFixed(1)}" y="${Math.min(y0, yv).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.abs(yv - y0).toFixed(1)}" rx="2"/>`
      + txt(xc, pos ? yv - 5 : yv + 14, pct(w.median_pct), "middle", "val")
      + txt(xc, Ht - B + 16, `هفتهٔ ${fa0.format(dd)} ${MONTHS[mm - 1]}`)
      + txt(xc, Ht - B + 32, `${fa0.format(w.n)} آگهی`, "middle", "muted");
  }).join("");
  $("week-chart").innerHTML = svg(W, Ht, grid + line("axis", L, y0, W - R, y0) + bars, "میانهٔ آگهی‌ها نسبت به مدل، بر اساس هفتهٔ انتشار");
  const d = S.age.drift_pct_per_30d;
  $("drift-note").textContent = `آگهی‌های تازه‌تر به‌ازای هر ۳۰ روز حدود ${fa1.format(Math.abs(d))}٪ `
    + `${d >= 0 ? "گران‌تر" : "ارزان‌تر"} هستند. آگهی‌های تازه سقف بازار را نشان می‌دهند؛ آگهی‌های ۱۵+ روزه هنوز اجاره نرفته‌اند.`;
}

function renderHistory() {
  const slug = hood, zm = v => v === null || v === undefined ? "—" : fa2.format(v);
  fillRows($("history-table").tBodies[0], H.map(h => [toFa(h.jalali), fa0.format(h.peers),
    numOrDash(h.hoods[slug]), zm(h.zone_median_ref_ppm)]));
  const rows = hoodRows(slug);
  if (rows.length < 2) { $("history-chart").innerHTML = ""; return; }
  const W = 600, Ht = 220, L = 60, R = 20, T = 24, B = 40;
  const vals = rows.map(h => h.hoods[slug]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { lo -= 1; hi += 1; }
  const t = rows.map(h => Date.parse(h.date)), x = scale(t[0], t[t.length - 1], L, W - R), y = scale(lo, hi, Ht - B, T);
  const pts = rows.map((h, i) => [x(t[i]).toFixed(1), y(h.hoods[slug]).toFixed(1)]);
  $("history-chart").innerHTML = svg(W, Ht,
    line("axis", L, Ht - B, W - R, Ht - B)
    + `<polyline class="s-hood" points="${pts.map(p => p.join(",")).join(" ")}"/>`
    + pts.map(([cx, cy]) => `<circle class="s-hood" cx="${cx}" cy="${cy}" r="3"/>`).join("")
    + txt(L, Ht - B + 18, toFa(rows[0].jalali), "start") + txt(W - R, Ht - B + 18, toFa(rows[rows.length - 1].jalali), "end")
    + txt(L - 6, y(hi) + 4, fa0.format(hi), "end") + txt(L - 6, y(lo) + 4, fa0.format(lo), "end")
    + txt(L, T - 8, `— واحد مرجع، ${esc(H_().name)}`, "start", "s-hood"),
    "روند واحد مرجع");
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

// ---- calculator + ads ----------------------------------------------------------
function readFlat() {
  return {area_m2: parseFloat($("area").value), year_built: parseInt($("built").value, 10),
          floor: parseInt($("floor").value, 10) || 0, elevator: $("elevator").checked, parking: $("parking").checked,
          renovated: $("renovated").checked, complex: false, hood: $("hood").value};
}

// The map form (m-*) and the calculator form share one flat: editing either copies its values into the other.
const FLAT_FIELDS = ["area", "built", "floor", "elevator", "parking", "renovated"];

function syncFlat(fromMap) {
  for (const id of FLAT_FIELDS) {
    const [src, dst] = fromMap ? [$(`m-${id}`), $(id)] : [$(id), $(`m-${id}`)];
    if (src.type === "checkbox") dst.checked = src.checked; else dst.value = src.value;
  }
}

// Full-deposit estimate of the user's flat in a priced hood (null when the flat is incomplete or the hood unpriced).
function myEquiv(h) {
  const f = readFlat();
  if (!priced(h) || !(f.area_m2 > 0) || !Number.isFinite(f.year_built)) return null;
  return Math.round(predictPpm({...f, hood: h.slug}) * f.area_m2);
}

let mapMine = false;  // bubbles show the user's flat once the flat form is edited; the reset button turns it off
const FLAT_DEFAULTS = () => ({area: 75, built: S.year - 15, floor: 3, elevator: true, parking: true, renovated: false});

function resetFlat() {
  const d = FLAT_DEFAULTS();
  for (const id of FLAT_FIELDS) {
    const el = $(`m-${id}`);
    if (el.type === "checkbox") el.checked = d[id]; else el.value = d[id];
  }
  syncFlat(true);
  mapMine = false;
}

function renderMapLabels() {
  const mine = mapMine;
  $("map-reset").hidden = !mine;
  const vals = [];
  for (const a of document.querySelectorAll("a.hood")) {
    const t = a.querySelector("text.val");
    if (!t) continue;
    t.dataset.median ??= t.textContent;
    const h = hoodBySlug[a.dataset.slug], v = mine ? myEquiv(h) : null;
    if (v !== null) vals.push([v, h]);
    t.textContent = v === null ? t.dataset.median : fa0.format(v);
    t.classList.toggle("mine", v !== null);
  }
  const note = $("map-mode-note");
  if (!mine) { note.textContent = ""; return; }
  if (!vals.length) { note.textContent = "متراژ و سال ساخت را وارد کنید."; return; }
  vals.sort((x, y) => x[0] - y[0]);
  const [lo, hi] = [vals[0], vals[vals.length - 1]];
  note.textContent = `عدد هر دایره: رهن کامل برآوردی واحد شما در آن محله (میلیون تومان). `
    + `از ${fa0.format(lo[0])} در ${lo[1].name} تا ${fa0.format(hi[0])} در ${hi[1].name}؛ `
    + `محله‌های با کمتر از ${fa0.format(MIN_PRICED)} آگهی برآورد ندارند.`;
}

const similarTo = f => a => a.hood === f.hood && Math.abs(a.year_built - f.year_built) <= 6
  && Math.abs(a.area_m2 - f.area_m2) <= 15;

let cur = null;  // {equiv, rate} of the last valid calculator run, read by the deposit slider

function renderCalc() {
  const f = readFlat(), rate = parseFloat($("rate").value), out = $("calc-out");
  const ok = f.area_m2 > 0 && Number.isFinite(f.year_built);
  $("split").hidden = !ok;
  $("scatter-legend").hidden = !ok;
  if (!ok) {
    out.textContent = "متراژ و سال ساخت را وارد کنید.";
    $("scatter-title").textContent = "";
    $("scatter").innerHTML = "";
    cur = null;
    return;
  }
  const ppm = predictPpm(f), equiv = Math.round(ppm * f.area_m2);
  const sim = ADS.filter(similarTo(f));
  const exact = a => a.deposit_m + a.rent_m / S.rate;  // equiv_m / ppm in the JSON are rounded
  const simLine = sim.length
    ? `میانهٔ ${fa0.format(sim.length)} آگهی مشابه (همین محله، ±۶ سال، ±۱۵ متر): `
      + `${fa0.format(median(sim.map(exact)))} میلیون (${fa2.format(median(sim.map(a => exact(a) / a.area_m2)))} میلیون/متر)`
    : "آگهی مشابهی نیست";
  const thin = priced(hoodBySlug[f.hood]) ? ""
    : `<p class="note">این محله کمتر از ${fa0.format(MIN_PRICED)} آگهی دارد؛ برآورد با سطح قیمت محلهٔ مبنا (${esc(hoodBySlug[S.model.baseline].name)}) است.</p>`;
  out.innerHTML = `<p>معادل رهن کامل: <strong>${fa0.format(equiv)} ${UNIT}</strong> (${fa2.format(ppm)} میلیون/متر)</p>`
    + `<p>${simLine}</p>` + thin;
  $("rate-note").textContent = `هر ۱۰۰ میلیون تومان ودیعه ≈ ${faM1.format(rate * 100)} میلیون اجارهٔ ماهانه (نرخ ${faM1.format(rate * 100)}٪). `
    + `مدل با نرخ ۳٪ (میانهٔ نرخ خود آگهی‌دهندگان در ${fa0.format(S.poster_rate.n)} آگهی قابل تبدیل) برازش شده؛ `
    + `نرخ انتخابی فقط تقسیم ودیعه/اجاره را تغییر می‌دهد.`;
  cur = {equiv, rate};
  renderSplit();
  renderScatter(f, ppm, sim);
}

function renderSplit() {
  if (!cur) return;
  const {equiv, rate} = cur, dep = $("dep");
  dep.max = equiv;
  if (+dep.value > equiv) dep.value = equiv;
  const d = +dep.value, rent = (equiv - d) * rate, maxRent = equiv * rate;
  $("split-line").innerHTML = `ودیعه <strong>${fa0.format(d)}</strong> ${UNIT} + اجارهٔ ماهانه <strong>${fa1.format(rent)}</strong> ${UNIT}`
    + (d >= equiv ? " (رهن کامل)" : "");
  const W = 600, Ht = 200, L = 50, R = 20, T = 26, B = 40;
  const x = scale(0, equiv, L, W - R), y = scale(0, maxRent, Ht - B, T);
  const xt = ticks(0, equiv, 5).map(v => line("tick", x(v), Ht - B, x(v), Ht - B + 4) + txt(x(v), Ht - B + 17, fa0.format(v))).join("");
  const yt = ticks(0, maxRent, 4).map(v => line("grid", L, y(v), W - R, y(v)) + txt(L - 8, y(v) + 4, fa0.format(v), "end")).join("");
  $("split-chart").innerHTML = svg(W, Ht, yt + xt
    + line("axis", L, Ht - B, W - R, Ht - B) + line("axis", L, T, L, Ht - B)
    + line("model", x(0), y(maxRent), x(equiv), y(0))
    + line("guide", x(d), y(rent), x(d), Ht - B) + line("guide", L, y(rent), x(d), y(rent))
    + `<circle class="me" cx="${x(d).toFixed(1)}" cy="${y(rent).toFixed(1)}" r="6"/>`
    + txt(W - R, Ht - 4, "ودیعه (میلیون تومان)", "end", "muted") + txt(L, 12, "اجارهٔ ماهانه (میلیون تومان)", "start", "muted"),
    "ودیعه در برابر اجارهٔ ماهانه");
}

function renderScatter(f, ppm, sim) {
  const ads = ADS, isSim = new Set(sim);
  $("scatter-title").textContent = `واحد شما در میان ${fa0.format(ads.length)} آگهی ${hoodBySlug[f.hood].name}`;
  const W = 600, Ht = 300, L = 50, R = 15, T = 26, B = 44;
  const yrs = ads.map(a => a.year_built), x0 = Math.min(...yrs, f.year_built), x1 = Math.max(...yrs, f.year_built, S.year);
  const vals = ads.map(a => a.ppm), lo = Math.floor(Math.min(...vals, ppm) / 5) * 5, hi = Math.ceil(Math.max(...vals, ppm) / 5) * 5;
  const x = scale(x0, x1, L, W - R), y = scale(lo, hi, Ht - B, T);
  const xt = ticks(x0, x1, 6).map(v => line("tick", x(v), Ht - B, x(v), Ht - B + 4) + txt(x(v), Ht - B + 17, toFa(v))).join("");
  const yt = ticks(lo, hi, 5).map(v => line("grid", L, y(v), W - R, y(v)) + txt(L - 8, y(v) + 4, fa0.format(v), "end")).join("");
  let curve = "";
  for (let yr = x0; yr <= x1; yr++) curve += `${x(yr).toFixed(1)},${y(predictPpm({...f, year_built: yr})).toFixed(1)} `;
  const pts = ads.map(a => `<circle class="pt s-hood${isSim.has(a) ? " sim" : ""}" cx="${x(a.year_built).toFixed(1)}" cy="${y(a.ppm).toFixed(1)}" r="3.5">`
    + `<title>${esc(`${fa0.format(a.area_m2)} متر، ساخت ${toFa(a.year_built)}، طبقهٔ ${numOrDash(a.floor)}: ${fa0.format(a.equiv_m)} میلیون (${fa2.format(a.ppm)} میلیون/متر)`)}</title></circle>`).join("");
  $("scatter").innerHTML = svg(W, Ht, yt + xt
    + line("axis", L, Ht - B, W - R, Ht - B) + line("axis", L, T, L, Ht - B)
    + `<polyline class="model" points="${curve}"/>` + pts
    + `<path class="me" d="${star(x(f.year_built), y(ppm), 9)}"/>`
    + txt(W - R, Ht - 4, "سال ساخت", "end", "muted") + txt(L, 12, "میلیون تومان به‌ازای هر متر (رهن کامل)", "start", "muted"),
    "واحد شما در میان آگهی‌ها");
}

let sortKey = "published_days", sortDir = 1;

function renderAds() {
  let ads = [...ADS];
  if ($("ads-similar").checked) ads = ads.filter(similarTo(readFlat()));
  ads.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;  // nulls last
    if (y === null || y === undefined) return -1;
    return (x - y) * sortDir;
  });
  const yes = v => v ? "✓" : "—";
  fillRows($("ads-table").tBodies[0], ads.map(a => [fa0.format(a.area_m2), toFa(a.year_built),
    numOrDash(a.floor), yes(a.parking), yes(a.elevator), yes(a.renovated), fa0.format(a.deposit_m), numOrDash(a.rent_m),
    fa0.format(a.equiv_m), fa2.format(a.ppm), pct(a.vs_fit_pct), numOrDash(a.published_days),
    `<a href="${esc(a.url)}" target="_blank" rel="noopener">دیوار</a>`]));
  $("ads-hood").textContent = H_().name;
  $("ads-count").textContent = `${fa0.format(ads.length)} از ${fa0.format(ADS.length)} آگهی`;
  for (const th of document.querySelectorAll("#ads-table th[data-key]"))
    th.dataset.sort = th.dataset.key === sortKey ? (sortDir > 0 ? "asc" : "desc") : "";
}

// ---- neighborhood selection ------------------------------------------------------
function loadAds(slug) {
  if (adsCache[slug]) return Promise.resolve(adsCache[slug]);
  if (!hoodBySlug[slug].n) return Promise.resolve(adsCache[slug] = []);
  return fetch(`data/ads/${slug}.json`).then(r => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(ads => (adsCache[slug] = ads));
}

const update = () => { renderCalc(); renderAds(); };

function selectHood(slug) {
  if (!hoodBySlug[slug] || slug === hood) return;
  hood = slug;
  for (const a of document.querySelectorAll("a.hood")) a.classList.toggle("selected", a.dataset.slug === slug);
  $("hood").value = slug;
  renderPanel();
  renderHeadline();
  renderHistory();
  ADS = [];
  fillRows($("ads-table").tBodies[0], []);
  $("ads-hood").textContent = H_().name;
  $("ads-count").textContent = "در حال بارگذاری…";
  loadAds(slug).then(ads => {
    if (hood !== slug) return;  // a later click won the race
    ADS = ads;
    update();
  }).catch(() => {
    if (hood !== slug) return;
    $("ads-count").textContent = "آگهی‌های این محله بارگذاری نشد";
  });
}

function applyHash() {
  const m = location.hash.match(/^#hood=([\w-]+)$/);
  if (m && hoodBySlug[m[1]]) selectHood(m[1]);
  else if (hood === null) selectHood(hoodBySlug[DEFAULT_HOOD] ? DEFAULT_HOOD : S.hoods[0].slug);
}

function init() {
  for (const id of ["built", "m-built"]) $(id).max = S.year;
  resetFlat();
  $("hood").innerHTML = [...S.hoods].sort((a, b) => a.name.localeCompare(b.name, "fa"))
    .map(h => `<option value="${h.slug}">${esc(h.name)}${h.n ? ` (${fa0.format(h.n)})` : ""}</option>`).join("");
  renderSub();
  renderEffects();
  renderMarket();
  renderMethodCounts();
  renderData();
  initMapTips();
  const flatChanged = () => { renderMapLabels(); renderPanel(); };
  $("calc-form").addEventListener("input", ev => {
    if (ev.target.id === "hood") return;
    syncFlat(false);
    if (FLAT_FIELDS.includes(ev.target.id)) mapMine = true;
    update();
    flatChanged();
  });
  $("map-flat").addEventListener("input", ev => {
    syncFlat(true);
    mapMine = true;
    update();
    flatChanged();
  });
  $("map-reset").addEventListener("click", () => { resetFlat(); update(); flatChanged(); });
  $("hood").addEventListener("change", () => { location.hash = `hood=${$("hood").value}`; });
  $("dep").addEventListener("input", renderSplit);
  $("ads-similar").addEventListener("change", renderAds);
  for (const th of document.querySelectorAll("#ads-table th[data-key]")) {
    th.addEventListener("click", () => {
      sortDir = th.dataset.key === sortKey ? -sortDir : 1;
      sortKey = th.dataset.key;
      renderAds();
    });
  }
  window.addEventListener("hashchange", applyHash);
  applyHash();
}

init();
