"use strict";
// Renders the page from the two inline JSON blocks written by build_site.py. Mirrors estimate.py's model.

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
const SIDE = {true: "جنوبی", false: "شمالی"};
const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const numOrDash = v => v === null || v === undefined ? "—" : fa0.format(v);

function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- model (mirror of estimate.flights / estimate.row) ---------------------
const flights = (floor, elevator) => (elevator || !floor || floor < 2) ? 0 : floor - 1;
const rowOf = f => [1, S.year - f.year_built, Math.log(f.area_m2 / S.model.ref_area), +f.parking, +f.elevator,
  flights(f.floor, f.elevator), +f.renovated, +f.complex, +f.south];
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

// ---- static sections ---------------------------------------------------------
function renderHeadline() {
  $("sub").textContent = `برآورد از آگهی‌های عمومی دیوار · آخرین برداشت: ${toFa(S.jalali)} · `
    + `${fa0.format(S.counts.peers)} آگهی تمیز از ${fa0.format(S.counts.ads)} آگهی`;
  for (const side of ["south", "north"]) {
    $(`ref-${side}`).innerHTML = `${fa0.format(S.reference[side].equiv)} <small>${UNIT} رهن کامل</small>`;
    if (H.length >= 2) {
      const key = `ref_${side}_equiv`, prev = H[H.length - 2][key], last = H[H.length - 1][key];
      $(`ref-${side}-change`).textContent = `نسبت به برداشت قبل: ${pct((last / prev - 1) * 100)}`;
    }
  }
  $("median-ppm").innerHTML = `<span>جنوبی ${fa2.format(S.medians.south.ppm)}</span> / `
    + `<span>شمالی ${fa2.format(S.medians.north.ppm)}</span> <small>میلیون</small>`;
  $("built-on").textContent = `ساخته‌شده در ${toFa(S.jalali)}`;
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
  fillRows($("history-table").tBodies[0], H.map(h => [toFa(h.jalali), fa0.format(h.peers),
    fa0.format(h.ref_south_equiv), fa0.format(h.ref_north_equiv),
    fa2.format(h.median_south_ppm), fa2.format(h.median_north_ppm)]));
  if (H.length < 2) return;
  const W = 600, Ht = 220, L = 60, R = 20, T = 24, B = 40;
  const vals = H.flatMap(h => [h.ref_south_equiv, h.ref_north_equiv]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { lo -= 1; hi += 1; }
  const t = H.map(h => Date.parse(h.date)), x = scale(t[0], t[t.length - 1], L, W - R), y = scale(lo, hi, Ht - B, T);
  const series = (key, cls) => `<polyline class="${cls}" points="${H.map((h, i) => `${x(t[i]).toFixed(1)},${y(h[key]).toFixed(1)}`).join(" ")}"/>`
    + H.map((h, i) => `<circle class="${cls}" cx="${x(t[i]).toFixed(1)}" cy="${y(h[key]).toFixed(1)}" r="3"/>`).join("");
  $("history-chart").innerHTML = svg(W, Ht,
    line("axis", L, Ht - B, W - R, Ht - B) + series("ref_south_equiv", "s-south") + series("ref_north_equiv", "s-north")
    + txt(L, Ht - B + 18, toFa(H[0].jalali), "start") + txt(W - R, Ht - B + 18, toFa(H[H.length - 1].jalali), "end")
    + txt(L - 6, y(hi) + 4, fa0.format(hi), "end") + txt(L - 6, y(lo) + 4, fa0.format(lo), "end")
    + txt(L, T - 8, "— مرجع جنوبی", "start", "s-south") + txt(L + 110, T - 8, "— مرجع شمالی", "start", "s-north"),
    "روند واحد مرجع");
}

function renderMethodCounts() {
  const c = S.counts, d = c.dropped;
  $("method-counts").textContent = `در این برداشت ${fa0.format(c.peers)} آگهی از ${fa0.format(c.ads)} آگهی ماند `
    + `(${fa0.format(c.south)} جنوبی، ${fa0.format(c.north)} شمالی). حذف‌شده‌ها: ناقص ${fa0.format(d.missing)}، `
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
          renovated: $("renovated").checked, complex: false, south: $("side-south").checked};
}

const similarTo = f => a => a.south === f.south && Math.abs(a.year_built - f.year_built) <= 6
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
  const sim = S.ads.filter(similarTo(f));
  const exact = a => a.deposit_m + a.rent_m / S.rate;  // equiv_m / ppm in the JSON are rounded
  const simLine = sim.length
    ? `میانهٔ ${fa0.format(sim.length)} آگهی مشابه (همان سمت، ±۶ سال، ±۱۵ متر): `
      + `${fa0.format(median(sim.map(exact)))} میلیون (${fa2.format(median(sim.map(a => exact(a) / a.area_m2)))} میلیون/متر)`
    : "آگهی مشابهی نیست";
  out.innerHTML = `<p>معادل رهن کامل: <strong>${fa0.format(equiv)} ${UNIT}</strong> (${fa2.format(ppm)} میلیون/متر)</p>`
    + `<p>${simLine}</p>`;
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
  const ads = S.ads.filter(a => a.south === f.south), isSim = new Set(sim), cls = f.south ? "s-south" : "s-north";
  $("calc").classList.toggle("side-south", f.south);
  $("calc").classList.toggle("side-north", !f.south);
  $("scatter-title").textContent = `واحد شما در میان ${fa0.format(ads.length)} آگهی ${SIDE[f.south]}`;
  const W = 600, Ht = 300, L = 50, R = 15, T = 26, B = 44;
  const yrs = ads.map(a => a.year_built), x0 = Math.min(...yrs, f.year_built), x1 = Math.max(...yrs, f.year_built, S.year);
  const vals = ads.map(a => a.ppm), lo = Math.floor(Math.min(...vals, ppm) / 5) * 5, hi = Math.ceil(Math.max(...vals, ppm) / 5) * 5;
  const x = scale(x0, x1, L, W - R), y = scale(lo, hi, Ht - B, T);
  const xt = ticks(x0, x1, 6).map(v => line("tick", x(v), Ht - B, x(v), Ht - B + 4) + txt(x(v), Ht - B + 17, toFa(v))).join("");
  const yt = ticks(lo, hi, 5).map(v => line("grid", L, y(v), W - R, y(v)) + txt(L - 8, y(v) + 4, fa0.format(v), "end")).join("");
  let curve = "";
  for (let yr = x0; yr <= x1; yr++) curve += `${x(yr).toFixed(1)},${y(predictPpm({...f, year_built: yr})).toFixed(1)} `;
  const pts = ads.map(a => `<circle class="pt ${cls}${isSim.has(a) ? " sim" : ""}" cx="${x(a.year_built).toFixed(1)}" cy="${y(a.ppm).toFixed(1)}" r="3.5">`
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
  const side = $("ads-side").value, f = readFlat();
  let ads = S.ads.filter(a => side === "all" || a.south === (side === "south"));
  if ($("ads-similar").checked) ads = ads.filter(similarTo(f));
  ads.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;  // nulls last
    if (y === null || y === undefined) return -1;
    return (x - y) * sortDir;
  });
  const yes = v => v ? "✓" : "—";
  fillRows($("ads-table").tBodies[0], ads.map(a => [SIDE[a.south], fa0.format(a.area_m2), toFa(a.year_built),
    numOrDash(a.floor), yes(a.parking), yes(a.elevator), yes(a.renovated), fa0.format(a.deposit_m), numOrDash(a.rent_m),
    fa0.format(a.equiv_m), fa2.format(a.ppm), pct(a.vs_fit_pct), numOrDash(a.published_days),
    `<a href="${esc(a.url)}" target="_blank" rel="noopener">دیوار</a>`]));
  $("ads-count").textContent = `${fa0.format(ads.length)} از ${fa0.format(S.ads.length)} آگهی`;
  for (const th of document.querySelectorAll("#ads-table th[data-key]"))
    th.dataset.sort = th.dataset.key === sortKey ? (sortDir > 0 ? "asc" : "desc") : "";
}

function init() {
  const built = $("built");
  built.max = S.year;
  built.value = S.year - 15;
  renderHeadline();
  renderEffects();
  renderMarket();
  renderHistory();
  renderMethodCounts();
  renderData();
  const update = () => { renderCalc(); renderAds(); };
  $("calc-form").addEventListener("input", update);
  $("dep").addEventListener("input", renderSplit);
  $("ads-side").addEventListener("change", renderAds);
  $("ads-similar").addEventListener("change", renderAds);
  for (const th of document.querySelectorAll("#ads-table th[data-key]")) {
    th.addEventListener("click", () => {
      sortDir = th.dataset.key === sortKey ? -sortDir : 1;
      sortKey = th.dataset.key;
      renderAds();
    });
  }
  update();
}

init();
