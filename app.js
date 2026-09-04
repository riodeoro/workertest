import { TABLE_PAGE_SIZE as PAGE_SIZE } from "./data.js";

import {
  ALL_SENSOR_COLS,
  HOUR_COL,
  MONTH_COL,
  DOY_COL,
  LINE_CAP,
  STATION_DETAIL_MAX,
  loadStationConfig,
  fireCentres,
  enabledStations,
  yearsForFc,
  resolveSource,
  resetEngine,
  materializeSource,
  stationSource,
  compileWhere,
  notNullSql,
  andSql,
  density,
  lineSample,
  stationSummary,
  stationSeries,
  stationsInRanges,
  previewSample,
  xLabel,
  dispUnit,
} from "./data.js";
import { dropCache, ready, fatal } from "./duck.js";
import { emptyFig, buildDensity, buildParcoords, buildStationDetail } from "./charts.js";

const PLOT_CONFIG_STATIC = { displayModeBar: false, responsive: true };
const PLOT_CONFIG_BAR = {
  displayModeBar: true,
  modeBarButtonsToRemove: ["lasso2d"],
  responsive: true,
  displaylogo: false,
};
const PLOT_CONFIG_DETAIL = {
  displayModeBar: true,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
  responsive: true,
};

const DEFAULT_DIMS_PREF = ["Temp", "Rh", "Wspd", "Dir", "Mx_Spd", "Rn_1"];

const state = {
  config: [],
  fc: null,
  years: [],
  stations: [],
  loaded: false,
  where: [],
  dims: [],
  colorby: "",
  xcol: null,
  ycol: null,
  liveCols: [],
  renderedDims: [],
  page: 0,
  sortBy: [],
  token: 0,
  pcToken: 0,
  axisStale: new Set(),
};

const el = (id) => document.getElementById(id);

const PERF = new URLSearchParams(location.search).has("perf");

async function timed(label, fn) {
  if (!PERF) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[wx] ${label}: ${(performance.now() - t0).toFixed(0)}ms`);
  }
}

function debounce(fn, ms) {
  let h = null;
  return (...args) => {
    if (h) clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  };
}

function spin(id, on) {
  const n = el(id);
  if (n) n.classList.toggle("on", !!on);
}

function fmtTs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (v, w) => String(v).padStart(w || 2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  );
}

function fmtDate(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function parsePlotlyDate(raw) {
  if (typeof raw === "number") return raw;
  const s = String(raw).trim().replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
  return Number.isFinite(ms) ? ms : null;
}

class Dropdown {
  constructor(node, opts) {
    this.node = node;
    this.multi = !!(opts && opts.multi);
    this.clearable = opts && opts.clearable === false ? false : true;
    this.placeholder = (opts && opts.placeholder) || "Select...";
    this.onChange = (opts && opts.onChange) || (() => {});
    this.options = [];
    this.value = this.multi ? [] : null;
    this.disabled = false;
    this.filter = "";
    this.root = document.createElement("div");
    this.root.className = "dd";
    this.control = document.createElement("div");
    this.control.className = "dd-control";
    this.menu = document.createElement("div");
    this.menu.className = "dd-menu";
    this.search = document.createElement("input");
    this.search.className = "dd-search";
    this.search.type = "text";
    this.search.placeholder = "Search";
    this.list = document.createElement("div");
    this.menu.appendChild(this.search);
    this.menu.appendChild(this.list);
    const arrow = document.createElement("div");
    arrow.className = "dd-arrow";
    this.root.appendChild(this.control);
    this.root.appendChild(arrow);
    this.root.appendChild(this.menu);
    node.appendChild(this.root);

    this.control.addEventListener("mousedown", (e) => {
      if (e.target.closest(".dd-tag button") || e.target.closest(".dd-clear"))
        return;
      e.preventDefault();
      this.toggle();
    });
    this.search.addEventListener("input", () => {
      this.filter = this.search.value.toLowerCase();
      this.renderList();
    });
    this.search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.root.contains(e.target)) this.close();
    });
    this.render();
  }

  setDisabled(v) {
    this.disabled = !!v;
    this.root.classList.toggle("disabled", this.disabled);
    if (this.disabled) this.close();
  }

  setOptions(options, keepValue) {
    this.options = options || [];
    const valid = new Set(this.options.map((o) => o.value));
    if (keepValue) {
      if (this.multi) this.value = (this.value || []).filter((v) => valid.has(v));
      else if (!valid.has(this.value)) this.value = null;
    } else {
      this.value = this.multi ? [] : null;
    }
    this.render();
  }

  setValue(v, silent) {
    this.value = this.multi ? (v || []).slice() : v === undefined ? null : v;
    this.render();
    if (!silent) this.onChange(this.getValue());
  }

  getValue() {
    return this.multi ? (this.value || []).slice() : this.value;
  }

  toggle() {
    if (this.disabled) return;
    if (this.root.classList.contains("open")) this.close();
    else this.open();
  }

  open() {
    document.querySelectorAll(".dd.open").forEach((n) => {
      if (n !== this.root) n.classList.remove("open");
    });
    this.filter = "";
    this.search.value = "";
    this.root.classList.add("open");
    this.renderList();
    this.search.focus();
  }

  close() {
    this.root.classList.remove("open");
  }

  labelFor(v) {
    const o = this.options.find((x) => x.value === v);
    return o ? o.label : String(v);
  }

  render() {
    this.control.innerHTML = "";
    const old = this.root.querySelector(".dd-clear");
    if (old) old.remove();
    if (this.multi) {
      const vals = this.value || [];
      if (!vals.length) {
        const ph = document.createElement("span");
        ph.className = "dd-ph";
        ph.textContent = this.placeholder;
        this.control.appendChild(ph);
      } else {
        for (const v of vals) {
          const tag = document.createElement("div");
          tag.className = "dd-tag";
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = "\u00d7";
          b.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.value = (this.value || []).filter((x) => x !== v);
            this.render();
            this.onChange(this.getValue());
          });
          const s = document.createElement("span");
          s.textContent = this.labelFor(v);
          tag.appendChild(b);
          tag.appendChild(s);
          this.control.appendChild(tag);
        }
      }
    } else {
      const s = document.createElement("span");
      const has = this.value !== null && this.value !== undefined;
      s.className = has ? "dd-single" : "dd-ph";
      s.textContent = has ? this.labelFor(this.value) : this.placeholder;
      this.control.appendChild(s);
      if (this.clearable && has) {
        const c = document.createElement("div");
        c.className = "dd-clear";
        c.textContent = "\u00d7";
        c.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.value = null;
          this.render();
          this.onChange(this.getValue());
        });
        this.root.appendChild(c);
      }
    }
    this.renderList();
  }

  renderList() {
    this.list.innerHTML = "";
    const f = this.filter;
    const shown = this.options.filter(
      (o) => !f || String(o.label).toLowerCase().includes(f)
    );
    if (!shown.length) {
      const d = document.createElement("div");
      d.className = "dd-empty";
      d.textContent = "No options";
      this.list.appendChild(d);
      return;
    }
    for (const o of shown) {
      const d = document.createElement("div");
      d.className = "dd-opt";
      const selected = this.multi
        ? (this.value || []).includes(o.value)
        : this.value === o.value;
      if (selected) d.classList.add("sel");
      d.textContent = o.label;
      d.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (this.multi) {
          const vals = new Set(this.value || []);
          if (vals.has(o.value)) vals.delete(o.value);
          else vals.add(o.value);
          this.value = this.options
            .map((x) => x.value)
            .filter((v) => vals.has(v));
          this.render();
        } else {
          this.value = o.value;
          this.render();
          this.close();
        }
        this.onChange(this.getValue());
      });
      this.list.appendChild(d);
    }
  }
}

const dd = {};

function optionsFor(cols, extra) {
  return (extra || []).concat(cols).map((c) => ({ label: xLabel(c), value: c }));
}

function filteredCols(clauses) {
  const out = [];
  for (const c of clauses || [])
    if (c.col && !out.includes(c.col)) out.push(c.col);
  return out;
}

function fmtBound(col, v) {
  if (col === "DATE_TIME_PARSED") return fmtDate(v * 1000);
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function clauseLabel(clause) {
  const col = clause.col;
  const names = clause.names;
  if (names != null || col === "STATION_NAME") {
    const list = names || [];
    let shown = list.slice(0, 3).join(", ");
    if (list.length > 3) shown += ` +${list.length - 3} more`;
    return list.length ? `Station: ${shown}` : "Station: none";
  }
  const parts = (clause.ranges || []).map(
    ([lo, hi]) => `${fmtBound(col, lo)} to ${fmtBound(col, hi)}`
  );
  return `${xLabel(col)}: ${parts.join(", ")}`;
}

const SELECTION_SRC = new Set(["zoom", "select", "brush"]);

function chipKey(c) {
  return `${c.src}|${c.col}`;
}

let _editing = false;

function editableChip(c) {
  return !!(
    c &&
    c.col &&
    c.col !== "STATION_NAME" &&
    c.names == null &&
    (c.ranges || []).length
  );
}

function editValue(col, v) {
  if (col === "DATE_TIME_PARSED") return fmtDate(v * 1000);
  return String(Number(Number(v).toFixed(3)));
}

function parseValue(col, text) {
  const s = String(text).trim();
  if (!s) return null;
  if (col === "DATE_TIME_PARSED") {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  const v = Number(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function setBound(clause, ri, side, value) {
  const live = state.where.find(
    (x) => x.src === clause.src && x.col === clause.col
  );
  if (!live || !live.ranges || !live.ranges[ri]) return;
  const ranges = live.ranges.map((r) => r.slice());
  let v = value;
  if (clause.col === "DATE_TIME_PARSED" && side === 1) v += 86399;
  ranges[ri][side] = v;
  if (ranges[ri][0] > ranges[ri][1]) ranges[ri].reverse();
  clearBrushPreview();
  state.where = state.where.map((x) => (x === live ? { ...live, ranges } : x));
  state.page = 0;
  renderAll();
}

function boundNode(clause, ri, side) {
  const col = clause.col;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tr-chip-num";
  b.textContent = fmtBound(col, clause.ranges[ri][side]);
  b.title = "Click to type an exact value";
  b.addEventListener("click", () => {
    if (_editing) return;
    _editing = true;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tr-chip-num";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = editValue(col, clause.ranges[ri][side]);
    input.style.width = `${Math.max(4, input.value.length + 1)}ch`;
    let done = false;
    const stop = () => {
      done = true;
      _editing = false;
    };
    const commit = () => {
      if (done) return;
      const v = parseValue(col, input.value);
      if (v === null) {
        input.classList.add("bad");
        input.focus();
        input.select();
        return;
      }
      stop();
      if (input.value.trim() === editValue(col, clause.ranges[ri][side]))
        input.replaceWith(b);
      else setBound(clause, ri, side, v);
    };
    input.addEventListener("input", () => {
      input.classList.remove("bad");
      input.style.width = `${Math.max(4, input.value.length + 1)}ch`;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        stop();
        input.replaceWith(b);
      }
    });
    input.addEventListener("blur", () => {
      if (done) return;
      const v = parseValue(col, input.value);
      stop();
      if (
        v === null ||
        input.value.trim() === editValue(col, clause.ranges[ri][side])
      )
        input.replaceWith(b);
      else setBound(clause, ri, side, v);
    });
    b.replaceWith(input);
    input.focus();
    input.select();
  });
  return b;
}

function fillChipLabel(wrap, clause, editable) {
  const text = clauseLabel(clause);
  if (wrap.dataset.text === text) return;
  wrap.dataset.text = text;
  wrap.innerHTML = "";
  const add = (t) => {
    const s = document.createElement("span");
    s.textContent = t;
    wrap.appendChild(s);
  };
  if (!editable || !editableChip(clause)) {
    add(text);
    return;
  }
  add(`${xLabel(clause.col)}: `);
  clause.ranges.forEach((r, ri) => {
    if (ri) add(", ");
    wrap.appendChild(boundNode(clause, ri, 0));
    add(" to ");
    wrap.appendChild(boundNode(clause, ri, 1));
  });
}

function renderChips(target, clauses, removable) {
  const list = clauses || [];
  if (_editing) return;
  const nodes = Array.from(target.children);
  const aligned =
    nodes.length === list.length &&
    list.every((c, i) => nodes[i].dataset.key === chipKey(c));
  if (aligned) {
    list.forEach((c, i) => {
      const lab = clauseLabel(c);
      fillChipLabel(nodes[i].firstChild, c, removable);
      const b = nodes[i].querySelector(".tr-chip-x");
      if (b) b.title = `Remove filter: ${lab}`;
    });
    return;
  }
  target.innerHTML = "";
  list.forEach((c) => {
    const span = document.createElement("span");
    span.className = "tr-chip";
    span.dataset.key = chipKey(c);
    const lab = document.createElement("span");
    fillChipLabel(lab, c, removable);
    span.appendChild(lab);
    if (removable) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tr-chip-x";
      b.textContent = "\u00d7";
      b.title = `Remove filter: ${clauseLabel(c)}`;
      b.addEventListener("click", () => {
        clearBrushPreview();
        state.where = SELECTION_SRC.has(c.src)
          ? dropSelection(state.where, c.col)
          : state.where.filter((x) => !(x.src === c.src && x.col === c.col));
        syncStationPicker();
        state.page = 0;
        renderAll();
      });
      span.appendChild(b);
    }
    target.appendChild(span);
  });
}

function withClause(list, src, col, ranges, names) {
  const hasRanges = ranges && ranges.length;
  const hasNames = Array.isArray(names);
  const adding = !!(hasRanges || hasNames);
  const wide = adding && SELECTION_SRC.has(src);
  const out = list.filter(
    (c) =>
      !(
        c.col === col &&
        (c.src === src || (wide && SELECTION_SRC.has(c.src)))
      )
  );
  if (adding) {
    const clause = { src, col };
    if (hasNames) clause.names = names;
    else clause.ranges = ranges;
    out.push(clause);
  }
  return out;
}

function dropSelection(list, col) {
  return list.filter((c) => !(c.col === col && SELECTION_SRC.has(c.src)));
}

function putClause(src, col, ranges, names) {
  state.where = withClause(state.where, src, col, ranges, names);
}

function pickedStations() {
  for (const c of state.where)
    if (c.col === "STATION_NAME") return c.names || [];
  return [];
}

function syncStationPicker() {
  dd.station.setValue(pickedStations(), true);
}

function normRanges(value) {
  let v = value;
  if (Array.isArray(v) && v.length === 1 && (Array.isArray(v[0]) || v[0] === null))
    v = v[0];
  if (!Array.isArray(v) || !v.length) return [];
  if (v.length === 2 && v.every((x) => typeof x === "number"))
    return [[Number(v[0]), Number(v[1])]];
  const out = [];
  for (const r of v)
    if (Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === "number"))
      out.push([Number(r[0]), Number(r[1])]);
  return out;
}

function axisValue(col, raw) {
  if (col === "DATE_TIME_PARSED") {
    const ms = parsePlotlyDate(raw);
    return ms === null ? null : ms / 1000;
  }
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

let _sourcePromise = null;
let _sourceKey = null;

function currentSource() {
  const picked = pickedStations();
  const key = `${state.fc}|${state.years.join(",")}|${picked.slice().sort().join(",")}`;
  if (key !== _sourceKey) {
    _sourceKey = key;
    _sourcePromise = resolveSource(state.fc, state.years, state.stations, picked);
  }
  return _sourcePromise;
}

function whereFrom(clauses) {
  return compileWhere(clauses, new Set(state.liveCols), state.stations.slice().sort());
}

function whereOf() {
  return whereFrom(state.where);
}

function retireAxisCol(prev, next) {
  if (prev && prev !== next) state.axisStale.add(prev);
  if (next) state.axisStale.delete(next);
  if (state.xcol) state.axisStale.delete(state.xcol);
  if (state.ycol) state.axisStale.delete(state.ycol);
}

function forgetStaleAxes() {
  if (state.axisStale.size) state.axisStale = new Set();
}

function densityWhere() {
  return whereFrom(state.where.filter((c) => !SELECTION_SRC.has(c.src)));
}

function densityMatchWhere() {
  const off = state.where.filter(
    (c) =>
      SELECTION_SRC.has(c.src) &&
      c.col !== state.xcol &&
      c.col !== state.ycol
  );
  return off.length ? whereFrom(off) : null;
}

function selectionSpan(col) {
  if (!col) return null;
  let lo = -Infinity;
  let hi = Infinity;
  let found = false;
  for (const c of state.where) {
    if (c.col !== col || !SELECTION_SRC.has(c.src)) continue;
    let a = Infinity;
    let b = -Infinity;
    for (const [x, y] of c.ranges || []) {
      if (x < a) a = x;
      if (y > b) b = y;
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > lo) lo = a;
    if (b < hi) hi = b;
    found = true;
  }
  if (!found || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo > hi) hi = lo;
  const k = col === "DATE_TIME_PARSED" ? 1000 : 1;
  return [lo * k, hi * k];
}

function densitySelection() {
  const x = selectionSpan(state.xcol);
  const y = selectionSpan(state.ycol);
  return x || y ? { x, y } : null;
}

function isParcoordsConstraint(clause) {
  return (
    (state.dims || []).includes(clause.col) || SELECTION_SRC.has(clause.src)
  );
}

function parcoordsWhere() {
  return whereFrom(state.where.filter((c) => !isParcoordsConstraint(c)));
}

function muteClauses() {
  return state.where.filter(
    (c) =>
      SELECTION_SRC.has(c.src) &&
      !(state.dims || []).includes(c.col) &&
      c.ranges &&
      c.ranges.length
  );
}

function matchFlags(sample, clauses) {
  if (!sample || !clauses.length) return null;
  const n = sample.n;
  const out = new Uint8Array(n).fill(1);
  for (const c of clauses) {
    const vals = sample.data[c.col];
    if (!vals) continue;
    for (let i = 0; i < n; i++) {
      if (!out[i]) continue;
      const v = vals[i];
      let ok = false;
      if (Number.isFinite(v))
        for (const [lo, hi] of c.ranges)
          if (v >= lo && v <= hi) {
            ok = true;
            break;
          }
      if (!ok) out[i] = 0;
    }
  }
  return out;
}

let _densityRedraw = false;
let _pcRedraw = false;

const FALLBACK_HEIGHTS = { pc: 380, density: 420 };

const VIEWPORT_TAIL = 10;

function chartHeights() {
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  if (vw <= 768 || vh < 620) return FALLBACK_HEIGHTS;
  const par = el("tr-x-parcoords");
  const dens = el("tr-x-scatter");
  const densCard = dens && dens.closest(".wx-card");
  if (!par || !dens || !densCard) return FALLBACK_HEIGHTS;
  const parH = par.offsetHeight;
  const densH = dens.offsetHeight;
  if (!parH || !densH) return FALLBACK_HEIGHTS;
  const y = window.scrollY || 0;
  const parTop = par.getBoundingClientRect().top + y;
  const densTop = dens.getBoundingClientRect().top + y;
  const cardBottom = densCard.getBoundingClientRect().bottom + y;
  const gap = densTop - (parTop + parH);
  const tail = cardBottom - (densTop + densH);
  if (!(gap >= 0) || !(tail >= 0)) return FALLBACK_HEIGHTS;
  const avail = vh - parTop - gap - tail - VIEWPORT_TAIL;
  if (avail < 500) return FALLBACK_HEIGHTS;
  const pc = Math.round(Math.min(560, Math.max(280, avail * 0.56)));
  return { pc, density: Math.round(Math.max(260, avail - pc)) };
}

function syncTableHeight() {
  const table = el("tr-x-table");
  const card = table && table.closest(".wx-card");
  const dens = el("tr-x-scatter");
  const densCard = dens && dens.closest(".wx-card");
  if (!card || !densCard) return;
  if ((window.innerWidth || 1200) <= 768) {
    card.style.maxHeight = "";
    return;
  }
  card.style.maxHeight = `${densCard.offsetHeight}px`;
}

function sized(fig, height, node) {
  if (!fig || !fig.layout) return fig;
  fig.layout.height = height;
  const w = node ? plotWidth(node) : 0;
  if (w) {
    fig.layout.width = w;
    fig.layout.autosize = false;
  }
  return fig;
}

function reactDensity(fig) {
  const node = el("tr-x-scatter");
  const layout = fig.layout || {};
  layout.selections = [];
  const pre = node._fullLayout && node._fullLayout._preGUI;
  if (pre)
    for (const k of Object.keys(pre))
      if (k.indexOf("selections") === 0) delete pre[k];
  _densityRedraw = true;
  try {
    return Plotly.react(node, fig.data, layout, PLOT_CONFIG_BAR);
  } finally {
    setTimeout(() => {
      _densityRedraw = false;
    }, 0);
  }
}

function reactParcoords(fig) {
  const node = el("tr-x-parcoords");
  _pcRedraw = true;
  try {
    return Plotly.react(node, fig.data, fig.layout || {}, PLOT_CONFIG_STATIC);
  } finally {
    setTimeout(() => {
      _pcRedraw = false;
    }, 0);
  }
}

async function renderParcoords(token) {
  if (!state.loaded || !state.dims.length) {
    reactParcoords(sized(emptyFig("Choose a fire centre and years to begin."), chartHeights().pc, el("tr-x-parcoords")));
    return;
  }
  spin("tr-spin-parcoords", true);
  try {
    const source = await currentSource();
    if (!source || token !== state.pcToken) return;
    const w = parcoordsWhere();
    const muted = muteClauses();
    const muteCols = [];
    for (const c of muted) if (!muteCols.includes(c.col)) muteCols.push(c.col);
    const cols = state.dims.concat(state.colorby ? [state.colorby] : []);
    const drawable = andSql(w, notNullSql(cols));
    const sample = await timed("parcoords:sql", () =>
      lineSample(
        source,
        state.dims,
        drawable,
        state.colorby || null,
        LINE_CAP,
        null,
        muteCols
      )
    );
    if (token !== state.pcToken) return;
    const shown = sample
      ? state.dims.filter((d) => sample.data[d])
      : [];
    state.renderedDims = shown;
    const fig = sample
      ? buildParcoords(
          sample,
          shown,
          state.colorby || null,
          state.where,
          state.stations.slice().sort(),
          matchFlags(sample, muted)
        )
      : emptyFig("No observations match the current filters.");
    await timed("parcoords:draw", () =>
      reactParcoords(sized(fig, chartHeights().pc, el("tr-x-parcoords")))
    );
  } catch (e) {
    reactParcoords(
      sized(
        emptyFig("No observations match the current filters."),
        chartHeights().pc,
        el("tr-x-parcoords")
      )
    );
  } finally {
    spin("tr-spin-parcoords", false);
  }
}

async function renderDensity(token) {
  if (!state.loaded || !state.xcol || !state.ycol) {
    reactDensity(
      sized(
        emptyFig("Choose a fire centre and years to begin.", 420),
        chartHeights().density,
        el("tr-x-scatter")
      )
    );
    return;
  }
  spin("tr-spin-scatter", true);
  try {
    const source = await currentSource();
    if (!source || token !== state.token) return;
    const res = await timed("density:sql", () =>
      density(
        source,
        state.xcol,
        state.ycol,
        densityWhere(),
        null,
        densityMatchWhere()
      )
    );
    if (token !== state.token) return;
    _densityRes = res;
    _densityTotal = 0;
    if (res && res.n) for (let i = 0; i < res.n.length; i++) _densityTotal += res.n[i];
    const fig = buildDensity(res, state.xcol, state.ycol, densitySelection());
    await timed("density:draw", () =>
      reactDensity(sized(fig, chartHeights().density, el("tr-x-scatter")))
    );
    ensurePreviewSample();
  } catch (e) {
    reactDensity(
      sized(
        emptyFig("No observations match the current filters.", 420),
        chartHeights().density,
        el("tr-x-scatter")
      )
    );
  } finally {
    spin("tr-spin-scatter", false);
  }
}

function stationColumns() {
  const cols = [
    { name: "Station", id: "STATION_NAME", text: true },
    { name: "Matching hours", id: "n", precision: 0 },
    { name: "First match", id: "first_t", text: true },
    { name: "Last match", id: "last_t", text: true },
  ];
  for (const [key, col] of [
    ["x_avg", state.xcol],
    ["y_avg", state.ycol],
  ])
    if (col && col !== "DATE_TIME_PARSED")
      cols.push({ name: `Mean ${xLabel(col)}`, id: key, precision: 1 });
  return cols;
}

function renderTableBody(cols, rows, total) {
  const table = el("tr-x-table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const tr = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th");
    if (c.id === "STATION_NAME") th.className = "tleft";
    const sort = state.sortBy.find((s) => s.column_id === c.id);
    th.textContent = c.name + (sort ? (sort.direction === "asc" ? "  \u2191" : "  \u2193") : "");
    th.addEventListener("click", (e) => {
      const existing = state.sortBy.find((s) => s.column_id === c.id);
      let next;
      if (!existing) next = { column_id: c.id, direction: "asc" };
      else if (existing.direction === "asc")
        next = { column_id: c.id, direction: "desc" };
      else next = null;
      const rest = e.shiftKey
        ? state.sortBy.filter((s) => s.column_id !== c.id)
        : [];
      state.sortBy = next ? rest.concat([next]) : rest;
      state.page = 0;
      renderTable(state.token);
    });
    tr.appendChild(th);
  }
  thead.appendChild(tr);

  for (const r of rows) {
    const row = document.createElement("tr");
    for (const c of cols) {
      const td = document.createElement("td");
      if (c.id === "STATION_NAME") td.className = "tleft";
      let v = r[c.id];
      if (c.id === "first_t" || c.id === "last_t") v = fmtTs(r[c.id]);
      else if (!c.text)
        v =
          v === null || v === undefined || !Number.isFinite(v)
            ? ""
            : Number(v).toFixed(c.precision);
      td.textContent = v === null || v === undefined ? "" : String(v);
      row.appendChild(td);
    }
    row.addEventListener("click", () => openStationDetail(r.STATION_NAME));
    row.addEventListener("pointerenter", () => {
      if (_prefetchTimer) clearTimeout(_prefetchTimer);
      _prefetchTimer = setTimeout(() => {
        _prefetchTimer = null;
        prefetchStationDetail(r.STATION_NAME);
      }, 120);
    });
    row.addEventListener("pointerleave", () => {
      if (_prefetchTimer) clearTimeout(_prefetchTimer);
      _prefetchTimer = null;
    });
    tbody.appendChild(row);
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pager = el("tr-x-pager");
  pager.innerHTML = "";
  const mk = (label, disabled, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener("click", fn);
    pager.appendChild(b);
  };
  mk("\u00ab", state.page <= 0, () => {
    state.page = 0;
    renderTable(state.token);
  });
  mk("\u2039", state.page <= 0, () => {
    state.page = Math.max(0, state.page - 1);
    renderTable(state.token);
  });
  const info = document.createElement("span");
  info.textContent = `${state.page + 1} / ${pages}`;
  pager.appendChild(info);
  mk("\u203a", state.page >= pages - 1, () => {
    state.page = Math.min(pages - 1, state.page + 1);
    renderTable(state.token);
  });
  mk("\u00bb", state.page >= pages - 1, () => {
    state.page = pages - 1;
    renderTable(state.token);
  });
}

async function renderTable(token) {
  if (!state.loaded) {
    renderTableBody(stationColumns(), [], 0);
    return;
  }
  spin("tr-spin-table", true);
  try {
    const source = await currentSource();
    if (!source || token !== state.token) return;
    const res = await timed("table:sql", () =>
      stationSummary(
        source,
        whereOf(),
        state.xcol,
        state.ycol,
        state.sortBy,
        state.page * PAGE_SIZE,
        PAGE_SIZE
      )
    );
    if (token !== state.token) return;
    const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
    if (state.page > pages - 1) {
      state.page = pages - 1;
      spin("tr-spin-table", false);
      return renderTable(token);
    }
    await timed("table:draw", () =>
      renderTableBody(stationColumns(), res.rows, res.total)
    );
  } catch (e) {
    renderTableBody(stationColumns(), [], 0);
  } finally {
    spin("tr-spin-table", false);
  }
}

function renderAll(opts) {
  state.token += 1;
  const token = state.token;
  renderChips(el("tr-x-filter-bar"), _preview || state.where, true);
  const jobs = [];
  if (!(opts && opts.keepParcoords)) {
    state.pcToken += 1;
    jobs.push(renderParcoords(state.pcToken));
  }
  jobs.push(renderDensity(token));
  jobs.push(renderTable(token));
  return Promise.allSettled(jobs).then((r) => {
    resizeCharts();
    return r;
  });
}

const renderAllDebounced = debounce(renderAll, 90);
const renderLinkedDebounced = debounce(
  () => renderAll({ keepParcoords: true }),
  90
);

const DETAIL_CACHE_MAX = 6;
const _detailCache = new Map();
let _prefetchTimer = null;

function detailPlan() {
  const cols = [state.xcol, state.ycol].filter(
    (c) => c && c !== "DATE_TIME_PARSED"
  );
  const plotCol =
    cols[0] || state.liveCols.filter((c) => ALL_SENSOR_COLS.includes(c))[0];
  if (!plotCol) return null;
  return { plotCol, plotCol2: cols[1] || null };
}

function loadStationDetail(station, plan) {
  const where = whereOf();
  const key = [
    station,
    state.fc,
    state.years.join(","),
    plan.plotCol,
    plan.plotCol2 || "",
    where || "",
  ].join("|");
  const hit = _detailCache.get(key);
  if (hit) {
    _detailCache.delete(key);
    _detailCache.set(key, hit);
    return hit;
  }
  const filtered = filteredCols(state.where);
  const p = (async () => {
    let source = await currentSource();
    if (!source || !source.materialized) {
      let alt = null;
      try {
        alt = await stationSource(station, state.years, state.stations);
      } catch (e) {
        alt = null;
      }
      if (alt) source = alt;
    }
    if (!source) throw new Error("no source for station detail");
    const want = [plan.plotCol, plan.plotCol2]
      .concat(filtered)
      .filter((c) => c && c !== "STATION_NAME" && c !== "DATE_TIME_PARSED");
    const series = await stationSeries(
      source,
      station,
      where,
      want,
      STATION_DETAIL_MAX
    );
    return buildStationDetail(series, plan.plotCol, plan.plotCol2, filtered);
  })();
  p.catch(() => _detailCache.delete(key));
  _detailCache.set(key, p);
  if (_detailCache.size > DETAIL_CACHE_MAX)
    _detailCache.delete(_detailCache.keys().next().value);
  return p;
}

function prefetchStationDetail(station) {
  if (!station || !state.loaded) return;
  const plan = detailPlan();
  if (!plan) return;
  loadStationDetail(station, plan).catch(() => {});
}

function detailHeight(card, plot) {
  const vh = window.innerHeight || 800;
  const narrow = (window.innerWidth || 1200) <= 768;
  const cap = Math.max(300, vh - (narrow ? 16 : 48));
  const chrome = card ? card.offsetHeight - (plot ? plot.offsetHeight : 0) : 0;
  const avail = cap - Math.max(0, chrome) - 8;
  return Math.round(Math.max(320, Math.min(760, avail)));
}

async function openStationDetail(station) {
  if (!station || !state.loaded) return;
  const plan = detailPlan();
  if (!plan) return;
  const plotCol = plan.plotCol;
  const plotCol2 = plan.plotCol2;
  const pending = loadStationDetail(station, plan);
  const container = el("tr-detail-chart-container");
  const backdrop = document.createElement("div");
  backdrop.className = "tr-backdrop";
  const card = document.createElement("div");
  card.className = "tr-modal";
  const head = document.createElement("div");
  head.className = "tr-modal-head";
  const title = document.createElement("span");
  title.className = "t";
  let header = `${station}  \u00b7  ${dispUnit(plotCol)}`;
  if (plotCol2) header += `  vs  ${dispUnit(plotCol2)}`;
  title.textContent = header;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  head.appendChild(title);
  head.appendChild(close);
  const chips = document.createElement("div");
  chips.className = "tr-chips";
  chips.style.marginBottom = "8px";
  renderChips(chips, state.where, false);
  const plot = document.createElement("div");
  plot.style.width = "100%";
  card.appendChild(head);
  card.appendChild(chips);
  card.appendChild(plot);
  backdrop.appendChild(card);
  container.innerHTML = "";
  container.appendChild(backdrop);

  const onResize = debounce(() => {
    if (!plot.isConnected) return;
    const h = detailHeight(card, plot);
    const cur = (plot.layout && plot.layout.height) || 0;
    if (Math.abs(cur - h) < 1) return;
    try {
      const p = Plotly.relayout(plot, { height: h });
      if (p && p.catch) p.catch(() => {});
    } catch (err) {
      void err;
    }
  }, 150);
  window.addEventListener("resize", onResize);
  const shut = () => {
    window.removeEventListener("resize", onResize);
    container.innerHTML = "";
  };

  close.addEventListener("click", shut);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) shut();
  });

  const start = emptyFig("", detailHeight(card, plot));
  Plotly.newPlot(plot, start.data, start.layout, PLOT_CONFIG_DETAIL);

  try {
    const fig = await pending;
    if (!plot.isConnected) return;
    fig.layout.height = detailHeight(card, plot);
    Plotly.react(plot, fig.data, fig.layout, PLOT_CONFIG_DETAIL);
  } catch (e) {
    if (!plot.isConnected) return;
    console.error("station detail failed", e);
    const fig = emptyFig("No data for this station.", detailHeight(card, plot));
    Plotly.react(plot, fig.data, fig.layout, PLOT_CONFIG_DETAIL);
  }
}

let _preview = null;
let _previewRaf = 0;
let _previewTimer = 0;
let _previewPainted = false;
let _previewToken = -1;
let _previewSig = null;
let _resizeDeferred = false;

function brushDims() {
  return state.renderedDims && state.renderedDims.length
    ? state.renderedDims
    : state.dims;
}

function traceDims() {
  const par = el("tr-x-parcoords");
  const trace = par && par.data && par.data[0];
  const specs = trace && trace.dimensions;
  return specs && specs.length ? specs : null;
}

function dimByLabel() {
  const specs = traceDims();
  const dims = brushDims();
  const map = new Map();
  if (!specs) return map;
  for (let i = 0; i < specs.length && i < dims.length; i++)
    map.set(String(specs[i].label), { col: dims[i], spec: specs[i] });
  return map;
}

function midY(node) {
  const r = node.getBoundingClientRect();
  return (r.top + r.bottom) / 2;
}

function tickValue(text) {
  const raw = String(text || "")
    .replace(/[\u2212\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[\s,\u00a0\u2009]/g, "")
    .replace(/[^0-9.eE+-]/g, "");
  if (!raw || !/\d/.test(raw)) return NaN;
  return parseFloat(raw);
}

function tickScale(axisGroup) {
  const pts = [];
  for (const t of axisGroup.querySelectorAll("g.tick")) {
    const mark = t.querySelector("line") || t;
    const y = midY(mark);
    const v = tickValue(t.textContent);
    if (Number.isFinite(v) && Number.isFinite(y)) pts.push([y, v]);
  }
  if (pts.length < 2) return null;
  pts.sort((a, b) => a[0] - b[0]);
  let sy = 0;
  let sv = 0;
  for (const [y, v] of pts) {
    sy += y;
    sv += v;
  }
  const my = sy / pts.length;
  const mv = sv / pts.length;
  let num = 0;
  let den = 0;
  for (const [y, v] of pts) {
    num += (y - my) * (v - mv);
    den += (y - my) * (y - my);
  }
  if (!den) return null;
  const slope = num / den;
  const intercept = mv - slope * my;
  if (!Number.isFinite(slope) || !slope) return null;
  let spanV = 0;
  for (const [, v] of pts) spanV = Math.max(spanV, Math.abs(v - mv));
  const tol = Math.max(spanV * 0.02, 1e-9);
  for (const [y, v] of pts)
    if (Math.abs(slope * y + intercept - v) > tol) return null;
  return (y) => slope * y + intercept;
}

function extentScale(background, spec) {
  const range = spec && spec.range;
  if (!background || !range || range.length !== 2) return null;
  const r = background.getBoundingClientRect();
  if (!r.height) return null;
  const lo = Number(range[0]);
  const hi = Number(range[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return (y) => hi + ((y - r.top) * (lo - hi)) / r.height;
}

function dashArray(node) {
  const raw =
    node.getAttribute("stroke-dasharray") ||
    node.style.strokeDasharray ||
    window.getComputedStyle(node).strokeDasharray ||
    "";
  if (!raw || raw === "none") return [];
  const out = [];
  for (const tok of String(raw).trim().split(/[\s,]+/)) {
    const v = parseFloat(tok);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function dashSegments(node) {
  const nums = dashArray(node);
  if (!nums.length) return [];
  const out = [];
  let pos = 0;
  for (let i = 0; i < nums.length; i++) {
    const len = nums[i];
    if (i % 2 === 0 && len > 0) out.push([pos, pos + len]);
    pos += len;
  }
  return out;
}

function brushRanges(brushGroup, scale, spec) {
  const line =
    brushGroup.querySelector("line.highlight") ||
    brushGroup.querySelector("line.highlight-shadow");
  if (!line) return [];
  const box = line.getBoundingClientRect();
  const y1 = Number(line.getAttribute("y1"));
  const y2 = Number(line.getAttribute("y2"));
  const span = Math.abs(y2 - y1);
  if (!box.height || !Number.isFinite(span) || span <= 0) return [];
  const ratio = box.height / span;
  const down = !(Number.isFinite(y1) && Number.isFinite(y2)) || y1 <= y2;
  const at = (off) =>
    down ? box.top + off * ratio : box.bottom - off * ratio;
  const range = spec && spec.range;
  let rlo = null;
  let rhi = null;
  if (range && range.length === 2) {
    const a = Number(range[0]);
    const b = Number(range[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      rlo = Math.min(a, b);
      rhi = Math.max(a, b);
    }
  }
  const out = [];
  for (const [a, b] of dashSegments(line)) {
    const len = b - a;
    if (len * ratio < 0.5) continue;
    if (len >= span * 0.985) continue;
    const va = scale(at(a));
    const vb = scale(at(b));
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    let lo = Math.min(va, vb);
    let hi = Math.max(va, vb);
    if (rlo !== null) {
      lo = Math.max(lo, rlo);
      hi = Math.min(hi, rhi);
    }
    if (hi > lo) out.push([lo, hi]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function liveBrushClauses() {
  const par = el("tr-x-parcoords");
  if (!par) return null;
  const groups = par.querySelectorAll("g.axis-brush");
  if (!groups.length) return null;
  const lookup = dimByLabel();
  if (!lookup.size) return null;
  let out = state.where.slice();
  let seen = 0;
  for (const brushGroup of groups) {
    const axisGroup = brushGroup.parentNode;
    if (!axisGroup || !axisGroup.querySelector) continue;
    const title = axisGroup.querySelector(".axis-title");
    const hit = title ? lookup.get(String(title.textContent || "").trim()) : null;
    if (!hit) continue;
    const background = brushGroup.querySelector("rect.background");
    const scale = tickScale(axisGroup) || extentScale(background, hit.spec);
    if (!scale) continue;
    seen += 1;
    const ranges = brushRanges(brushGroup, scale, hit.spec);
    if (hit.col === "STATION_NAME")
      out = withClause(
        out,
        "station",
        "STATION_NAME",
        null,
        ranges.length
          ? stationsInRanges(state.stations.slice().sort(), ranges)
          : null
      );
    else out = withClause(out, "brush", hit.col, ranges);
  }
  return seen ? out : null;
}

window.__wxBrushProbe = () => {
  const par = el("tr-x-parcoords");
  const groups = par ? Array.from(par.querySelectorAll("g.axis-brush")) : [];
  const lines = [];
  groups.forEach((g, i) => {
    const t = g.parentNode && g.parentNode.querySelector(".axis-title");
    lines.push(`AXIS ${i} "${t ? t.textContent : "?"}"`);
    for (const n of g.querySelectorAll("line")) {
      lines.push(
        `  ${n.getAttribute("class")} y1=${n.getAttribute("y1")} ` +
          `y2=${n.getAttribute("y2")} dash=${dashArray(n).join("|")}`
      );
    }
  });
  const text = lines.join("\n");
  console.log(text);
  console.log("clauses", JSON.stringify(liveBrushClauses()));
  return text;
};

let _densityRes = null;
let _densityTotal = 0;
let _previewSample = null;
let _previewKey = null;
let _previewBusy = false;

function previewCols() {
  const out = [];
  for (const c of [state.xcol, state.ycol].concat(state.dims || []))
    if (c && c !== "STATION_NAME" && !out.includes(c)) out.push(c);
  return out;
}

function ensurePreviewSample() {
  if (!state.loaded || !state.xcol || !state.ycol) return;
  const cols = previewCols();
  const where = densityWhere() || "";
  const key = [_sourceKey, where, state.xcol, state.ycol, cols.join(",")].join("|");
  if (key === _previewKey) return;
  _previewKey = key;
  _previewSample = null;
  (async () => {
    const source = await currentSource();
    if (!source || key !== _previewKey) return;
    const out = await previewSample(source, cols, densityWhere(), null);
    if (key === _previewKey) _previewSample = out;
  })().catch(() => {});
}

function densityGrid() {
  const node = el("tr-x-scatter");
  const data = node && node.data;
  const t = data && data.length ? data[0] : null;
  if (!t || t.type !== "heatmap" || !t.x || !t.y) return null;
  if (t.x.length < 2 || t.y.length < 2) return null;
  const xs = Number(t.x[1]) - Number(t.x[0]);
  const ys = Number(t.y[1]) - Number(t.y[0]);
  if (!xs || !ys) return null;
  return {
    nx: t.x.length,
    ny: t.y.length,
    x0: Number(t.x[0]) - xs / 2,
    y0: Number(t.y[0]) - ys / 2,
    xs,
    ys,
    xk: state.xcol === "DATE_TIME_PARSED" ? 1000 : 1,
    yk: state.ycol === "DATE_TIME_PARSED" ? 1000 : 1,
  };
}

function previewDensity(clauses) {
  const sample = _previewSample;
  const g = densityGrid();
  if (!sample || !g) return null;
  const xv = sample.data[state.xcol];
  const yv = sample.data[state.ycol];
  if (!xv || !yv) return null;
  const tests = [];
  for (const c of clauses || []) {
    if (!SELECTION_SRC.has(c.src) || !c.ranges || !c.ranges.length) continue;
    const vals = sample.data[c.col];
    if (vals) tests.push([vals, c.ranges]);
  }
  const counts = new Float64Array(g.nx * g.ny);
  for (let i = 0; i < sample.n; i++) {
    let ok = true;
    for (let t = 0; t < tests.length; t++) {
      const v = tests[t][0][i];
      let hit = false;
      if (Number.isFinite(v))
        for (const [lo, hi] of tests[t][1])
          if (v >= lo && v <= hi) {
            hit = true;
            break;
          }
      if (!hit) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const xb = Math.floor((xv[i] * g.xk - g.x0) / g.xs);
    if (xb < 0 || xb >= g.nx) continue;
    const yb = Math.floor((yv[i] * g.yk - g.y0) / g.ys);
    if (yb < 0 || yb >= g.ny) continue;
    counts[yb * g.nx + xb] += 1;
  }
  const scale = _densityTotal && sample.n ? _densityTotal / sample.n : 1;
  const z = new Array(g.ny);
  const cd = new Array(g.ny);
  for (let r = 0; r < g.ny; r++) {
    const zr = new Array(g.nx).fill(null);
    const cr = new Array(g.nx).fill(0);
    for (let c = 0; c < g.nx; c++) {
      const n = counts[r * g.nx + c];
      if (!n) continue;
      const v = n * scale;
      cr[c] = v;
      zr[c] = Math.log10(v);
    }
    z[r] = zr;
    cd[r] = cr;
  }
  return { z, cd };
}

function ensureDensityPair() {
  const node = el("tr-x-scatter");
  const data = node && node.data;
  if (!data || data.length !== 1 || !_densityRes || !_densityRes.n) return null;
  if (data[0].type !== "heatmap") return null;
  const res = _densityRes;
  const withSel = {
    xb: res.xb,
    yb: res.yb,
    n: res.n,
    sel: new Float64Array(res.n.length),
    x0: res.x0,
    xs: res.xs,
    nx: res.nx,
    y0: res.y0,
    ys: res.ys,
    ny: res.ny,
  };
  return reactDensity(
    sized(
      buildDensity(withSel, state.xcol, state.ycol, densitySelection()),
      chartHeights().density,
      node
    )
  );
}

function restoreDensity() {
  if (!_densityRes || !_densityRes.n) return;
  try {
    reactDensity(
      sized(
        buildDensity(_densityRes, state.xcol, state.ycol, densitySelection()),
        chartHeights().density,
        el("tr-x-scatter")
      )
    );
  } catch (e) {
    void e;
  }
}

function paintPreviewDensity(clauses) {
  if (_previewBusy) return;
  if (!_previewSample) return;
  const node = el("tr-x-scatter");
  const data = node && node.data;
  if (!data || !data.length) return;
  if (data.length < 2) {
    const pair = ensureDensityPair();
    if (pair && pair.then) {
      _previewBusy = true;
      const free = () => {
        _previewBusy = false;
      };
      pair.then(free, free);
    }
    return;
  }
  const fig = previewDensity(clauses);
  if (!fig) return;
  _previewBusy = true;
  const done = () => {
    _previewBusy = false;
  };
  try {
    const p = Plotly.restyle(
      node,
      { z: [fig.z], customdata: [fig.cd] },
      [data.length - 1]
    );
    _previewPainted = true;
    if (p && p.then) p.then(done, done);
    else done();
  } catch (e) {
    done();
  }
}

function clearBrushPreview() {
  if (_previewRaf) cancelAnimationFrame(_previewRaf);
  if (_previewTimer) clearTimeout(_previewTimer);
  _previewRaf = 0;
  _previewTimer = 0;
  _preview = null;
  _previewSig = null;
}

function startBrushPreview() {
  clearBrushPreview();
  _previewPainted = false;
  _previewToken = state.token;
  _previewSig = JSON.stringify(state.where);
  const tick = () => {
    const next = liveBrushClauses();
    if (next) {
      const sig = JSON.stringify(next);
      if (sig !== _previewSig) {
        _previewSig = sig;
        _preview = next;
        renderChips(el("tr-x-filter-bar"), next, true);
        paintPreviewDensity(next);
      }
    }
    _previewRaf = requestAnimationFrame(tick);
  };
  tick();
}

function endBrushPreview() {
  if (!_previewRaf) return;
  cancelAnimationFrame(_previewRaf);
  _previewRaf = 0;
  if (_resizeDeferred) {
    _resizeDeferred = false;
    resizeCharts();
  }
  if (_previewTimer) clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => {
    _previewTimer = 0;
    _preview = null;
    renderChips(el("tr-x-filter-bar"), state.where, true);
    if (_previewPainted && state.token === _previewToken) restoreDensity();
    _previewPainted = false;
  }, 500);
}

let _resizeBusy = false;
let _resizeAgain = false;
let _resizeLast = 0;
let _resizeTimer = 0;
let _resizeWidth = 0;

function plotWidth(node) {
  const host = node && node.parentElement;
  if (!host) return 0;
  const cs = window.getComputedStyle(host);
  const pad =
    (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(240, Math.floor(host.clientWidth - pad));
}

function resizePlot(node, height) {
  const width = plotWidth(node);
  if (!width || !node.layout) return null;
  const cur = node.layout;
  const dw = Math.abs((cur.width || 0) - width);
  const dh = Math.abs((cur.height || 0) - height);
  if (dw < 1 && dh < 1) return null;
  return Plotly.relayout(node, { width, height, autosize: false });
}

function applyChartSizes() {
  if (_previewRaf) {
    _resizeDeferred = true;
    return;
  }
  if (_resizeBusy) {
    _resizeAgain = true;
    return;
  }
  const par = el("tr-x-parcoords");
  const sc = el("tr-x-scatter");
  if (!par || !sc) return;
  const h = chartHeights();
  _resizeBusy = true;
  const jobs = [];
  try {
    const a = resizePlot(par, h.pc);
    if (a) jobs.push(a);
    const b = resizePlot(sc, h.density);
    if (b) jobs.push(b);
  } catch (e) {
    void e;
  }
  Promise.allSettled(jobs).then(() => {
    _resizeBusy = false;
    syncTableHeight();
    if (_resizeAgain) {
      _resizeAgain = false;
      applyChartSizes();
    }
  });
}

function resizeCharts() {
  const now = performance.now();
  if (_resizeTimer) clearTimeout(_resizeTimer);
  if (now - _resizeLast > 120) {
    _resizeLast = now;
    applyChartSizes();
  }
  _resizeTimer = setTimeout(() => {
    _resizeTimer = 0;
    _resizeLast = performance.now();
    applyChartSizes();
  }, 150);
}

function watchLayout() {
  window.addEventListener("resize", resizeCharts);
  window.addEventListener("orientationchange", resizeCharts);
  if (typeof ResizeObserver === "undefined") return;
  const host = document.querySelector(".main-content");
  if (!host) return;
  _resizeWidth = host.clientWidth;
  const obs = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = Math.round(entry.contentRect.width);
      if (w === _resizeWidth) continue;
      _resizeWidth = w;
      resizeCharts();
    }
  });
  obs.observe(host);
}

function attachPlotEvents() {
  const par = el("tr-x-parcoords");
  par.addEventListener("pointerover", () => {
    if (_pcRedraw || !state.loaded) return;
    ensurePreviewSample();
  });
  par.addEventListener("pointerdown", () => {
    if (_pcRedraw || !state.loaded) return;
    ensurePreviewSample();
    startBrushPreview();
  });
  window.addEventListener("pointerup", endBrushPreview);
  window.addEventListener("pointercancel", endBrushPreview);
  par.on("plotly_restyle", (evt) => {
    if (_pcRedraw) return;
    const payload = Array.isArray(evt) ? evt[0] : evt;
    if (!payload || typeof payload !== "object") return;
    const dims = state.renderedDims && state.renderedDims.length
      ? state.renderedDims
      : state.dims;
    let changed = false;
    for (const key of Object.keys(payload)) {
      const m = /dimensions\[(\d+)\]\.constraintrange/.exec(String(key));
      if (!m) continue;
      const i = parseInt(m[1], 10);
      if (!dims.length || i >= dims.length) continue;
      const ranges = normRanges(payload[key]);
      if (dims[i] === "STATION_NAME")
        putClause(
          "station",
          "STATION_NAME",
          null,
          ranges.length
            ? stationsInRanges(state.stations.slice().sort(), ranges)
            : null
        );
      else if (ranges.length) putClause("brush", dims[i], ranges);
      else state.where = dropSelection(state.where, dims[i]);
      changed = true;
    }
    if (!changed) return;
    clearBrushPreview();
    renderChips(el("tr-x-filter-bar"), state.where, true);
    syncStationPicker();
    state.page = 0;
    renderLinkedDebounced();
  });

  const sc = el("tr-x-scatter");
  sc.on("plotly_selected", (evt) => {
    if (_densityRedraw) return;
    const range = evt && evt.range ? evt.range : null;
    if (!range) return;
    const picked = [];
    for (const [axis, col] of [
      ["x", state.xcol],
      ["y", state.ycol],
    ]) {
      const span = range[axis];
      if (!Array.isArray(span) || span.length !== 2 || !col) continue;
      const a = axisValue(col, span[0]);
      const b = axisValue(col, span[1]);
      if (a === null || b === null) continue;
      picked.push([col, [[Math.min(a, b), Math.max(a, b)]]]);
    }
    if (!picked.length) return;
    const cols = picked.map(([col]) => col);
    for (const col of cols) state.axisStale.delete(col);
    const drop = state.axisStale;
    state.where = state.where.filter(
      (c) =>
        !(cols.includes(c.col) && c.ranges && c.ranges.length) &&
        !(drop.has(c.col) && SELECTION_SRC.has(c.src))
    );
    state.axisStale = new Set();
    for (const [col, ranges] of picked) putClause("select", col, ranges);
    state.page = 0;
    renderAllDebounced();
  });

  sc.on("plotly_deselect", () => {
    if (_densityRedraw) return;
    const before = state.where.length;
    const drop = state.axisStale;
    state.where = state.where.filter(
      (c) =>
        c.src !== "select" && !(drop.has(c.col) && SELECTION_SRC.has(c.src))
    );
    state.axisStale = new Set();
    if (state.where.length === before) return;
    state.page = 0;
    renderAllDebounced();
  });

  sc.on("plotly_relayout", (rl) => {
    if (_densityRedraw) return;
    if (!rl || typeof rl !== "object") return;
    if (rl["xaxis.autorange"] || rl["yaxis.autorange"]) {
      const before = state.where.length;
      state.where = state.where.filter((c) => c.src !== "zoom");
      if (state.where.length !== before) {
        state.page = 0;
        renderAllDebounced();
      }
      return;
    }
    let got = false;
    for (const [axis, col] of [
      ["xaxis", state.xcol],
      ["yaxis", state.ycol],
    ]) {
      const lo = rl[`${axis}.range[0]`];
      const hi = rl[`${axis}.range[1]`];
      if (lo === undefined || hi === undefined || !col) continue;
      const a = axisValue(col, lo);
      const b = axisValue(col, hi);
      if (a === null || b === null) continue;
      putClause("zoom", col, [[Math.min(a, b), Math.max(a, b)]]);
      got = true;
    }
    if (!got) return;
    state.page = 0;
    renderAllDebounced();
  });
}

function setStatus(html, warn) {
  const n = el("tr-load-status");
  n.innerHTML = "";
  if (!html) return;
  const d = document.createElement("div");
  if (warn) d.className = "warn";
  d.textContent = html;
  n.appendChild(d);
}

function setTiming(text) {
  el("tr-timing-diag").textContent = text || "";
}

function blankAttributes() {
  dd.dims.setOptions([], false);
  dd.colorby.setOptions([], false);
  dd.scatterX.setOptions([], false);
  dd.scatterY.setOptions([], false);
  dd.station.setOptions([], false);
  state.dims = [];
  state.colorby = "";
  state.xcol = null;
  state.ycol = null;
  forgetStaleAxes();
}

let _loadSeq = 0;
let _fcSeq = 0;
let _loadChain = Promise.resolve();
let _busyYears = false;
let _busyLoad = false;

function syncBusy() {
  spin("tr-spin-load", _busyYears || _busyLoad);
}

function setBusyYears(on) {
  _busyYears = !!on;
  syncBusy();
}

function runLoad() {
  const seq = ++_loadSeq;
  _loadChain = _loadChain
    .then(() => (seq === _loadSeq ? doLoad(seq) : undefined))
    .catch(() => {})
    .then(() => {
      if (seq !== _loadSeq) return;
      _busyLoad = false;
      syncBusy();
    });
  return _loadChain;
}

const runLoadDebounced = debounce(runLoad, 220);

function requestLoad() {
  _busyLoad = true;
  syncBusy();
  runLoadDebounced();
}

async function doLoad(seq) {
  const fc = dd.fc.getValue();
  const years = (dd.year.getValue() || []).map(Number).sort((a, b) => a - b);
  state.where = [];
  forgetStaleAxes();
  state.page = 0;
  state.sortBy = [];
  _sourceKey = null;
  _densityRes = null;
  _densityTotal = 0;
  _previewSample = null;
  _previewKey = null;
  _detailCache.clear();
  dropCache();
  if (!fc) {
    state.loaded = false;
    state.fc = null;
    state.years = [];
    blankAttributes();
    setStatus("");
    setTiming("");
    renderAll();
    return;
  }
  if (!years.length) {
    state.loaded = false;
    state.fc = fc;
    state.years = [];
    blankAttributes();
    setStatus("");
    setTiming("");
    renderAll();
    return;
  }

  state.fc = fc;
  state.years = years;
  state.stations = enabledStations(state.config, fc);
  setStatus("");
  setTiming("Reading parquet footers\u2026");
  const t0 = performance.now();

  const resolve = () =>
    timed("source:resolve", () => resolveSource(fc, years, state.stations, []));

  let source = null;
  try {
    source = await resolve();
  } catch (e) {
    source = null;
  }
  if (seq !== undefined && seq !== _loadSeq) return;

  if (!source || fatal()) {
    if (fatal()) {
      setStatus("The query engine hit an error and is restarting\u2026");
      setTiming("Restarting DuckDB\u2026");
      try {
        await resetEngine();
      } catch (e) {
        void e;
      }
      if (seq !== undefined && seq !== _loadSeq) return;
      try {
        source = await resolve();
      } catch (e) {
        source = null;
      }
      if (seq !== undefined && seq !== _loadSeq) return;
      if (source && !fatal()) setStatus("");
      else {
        try {
          await resetEngine();
        } catch (e) {
          void e;
        }
        source = null;
        state.loaded = false;
        blankAttributes();
        setStatus(
          `Could not read the data for ${fc} ${years.join(", ")}. ` +
            "Try a different year selection.",
          true
        );
        setTiming("");
        renderAll();
        return;
      }
    }
  }
  if (!source) {
    state.loaded = false;
    blankAttributes();
    setStatus(`No data for ${fc} ${years.join(", ")}.`, true);
    setTiming("");
    renderAll();
    return;
  }

  const numeric = source.liveCols.filter(
    (c) => ALL_SENSOR_COLS.includes(c) || c === "YEAR"
  );
  const all = numeric.concat([HOUR_COL, MONTH_COL, DOY_COL]);
  state.liveCols = all.slice();
  if (!all.length) {
    state.loaded = false;
    blankAttributes();
    setStatus(`No plottable attributes for ${fc} ${years.join(", ")}.`, true);
    setTiming("");
    renderAll();
    return;
  }

  const dimOpts = optionsFor(all);
  const xyOpts = optionsFor(all, ["DATE_TIME_PARSED"]);
  const colourOpts = [{ label: "None", value: "" }].concat(optionsFor(all));

  let keep = state.dims.filter((d) => all.includes(d) || d === "STATION_NAME");
  if (!keep.length) {
    keep = DEFAULT_DIMS_PREF.filter((c) => all.includes(c)).slice(0, 4);
    if (!keep.length) keep = all.slice(0, 4);
  }

  const pick = (cur, prefs) => {
    if (all.includes(cur) || cur === "DATE_TIME_PARSED") return cur;
    for (const p of prefs) if (all.includes(p)) return p;
    return all[0];
  };
  let xval = pick(state.xcol, ["Temp", "Wspd", "FFMC"]);
  let yval = pick(state.ycol, ["Rh", "FWI", "ISI"]);
  if (yval === xval && all.length > 1)
    yval = all.find((c) => c !== xval) || yval;
  let cval = "";
  const validColour = new Set(colourOpts.map((o) => o.value));
  if (state.colorby && validColour.has(state.colorby)) cval = state.colorby;
  else cval = keep.find((d) => all.includes(d)) || "";

  dd.dims.setOptions(dimOpts, false);
  dd.dims.setValue(keep, true);
  dd.scatterX.setOptions(xyOpts, false);
  dd.scatterX.setValue(xval, true);
  dd.scatterY.setOptions(xyOpts, false);
  dd.scatterY.setValue(yval, true);
  dd.colorby.setOptions(colourOpts, false);
  dd.colorby.setValue(cval, true);
  dd.station.setOptions(
    state.stations.slice().sort().map((s) => ({ label: s, value: s })),
    false
  );

  state.dims = keep;
  state.xcol = xval;
  state.ycol = yval;
  forgetStaleAxes();
  state.colorby = cval;
  state.loaded = true;

  const missing = years.filter(
    (y) => !source.urls.some((u) => u.includes(`/${y}.parquet`))
  );
  if (missing.length) {
    const loaded = years.filter((y) => !missing.includes(y));
    setStatus(
      `No data for ${missing.join(", ")}. Showing ${loaded.join(", ")}.`,
      true
    );
  }
  setTiming(
    `${source.urls.length} remote parquet file(s) \u00b7 footers read in ` +
      `${((performance.now() - t0) / 1000).toFixed(1)}s`
  );
  timed("render:all", () => renderAll()).then(() => {
    if (PERF)
      console.log(`[wx] total: ${(performance.now() - t0).toFixed(0)}ms`);
    if (seq !== undefined && seq !== _loadSeq) return;
    timed("source:materialize", () => materializeSource(source)).catch(() => {});
  });
}

async function boot() {
  const warm = timed("duckdb:boot", () => ready());
  warm.catch((e) => void e);

  dd.fc = new Dropdown(el("tr-fc-select"), {
    placeholder: "Choose a fire centre",
    onChange: async (v) => {
      const seq = ++_fcSeq;
      if (!v) {
        dd.year.setOptions([], false);
        dd.year.setDisabled(false);
        setBusyYears(false);
        requestLoad();
        return;
      }
      const now = new Date().getUTCFullYear();
      dd.year.setOptions([{ label: String(now), value: now }], false);
      dd.year.setValue([now], true);
      dd.year.setDisabled(false);
      requestLoad();
      setBusyYears(true);
      let years = [];
      try {
        years = (await yearsForFc(v, enabledStations(state.config, v))).years;
      } catch (e) {
        years = [];
      }
      if (seq !== _fcSeq) return;
      if (years.length) {
        const list = years.includes(now) ? years : [now].concat(years);
        dd.year.setOptions(
          list.map((y) => ({ label: String(y), value: y })),
          true
        );
      }
      setBusyYears(false);
    },
  });
  dd.year = new Dropdown(el("tr-year-select"), {
    multi: true,
    placeholder: "Choose one or more years",
    onChange: () => requestLoad(),
  });
  dd.station = new Dropdown(el("tr-x-station"), {
    multi: true,
    placeholder: "All stations",
    onChange: (v) => {
      putClause("station", "STATION_NAME", null, v && v.length ? v : null);
      state.page = 0;
      renderAllDebounced();
    },
  });
  dd.dims = new Dropdown(el("tr-x-dims"), {
    multi: true,
    placeholder: "Choose attributes",
    onChange: (v) => {
      state.dims = v || [];
      const kept = new Set(state.dims);
      const before = state.where.length;
      state.where = state.where.filter(
        (c) => c.src !== "brush" || kept.has(c.col)
      );
      if (state.where.length !== before) state.page = 0;
      renderAllDebounced();
    },
  });
  dd.colorby = new Dropdown(el("tr-x-colorby"), {
    placeholder: "None",
    onChange: (v) => {
      state.colorby = v || "";
      renderAllDebounced();
    },
  });
  dd.scatterX = new Dropdown(el("tr-x-scatter-x"), {
    clearable: false,
    placeholder: "X attribute",
    onChange: (v) => {
      const prev = state.xcol;
      state.xcol = v;
      retireAxisCol(prev, v);
      state.page = 0;
      renderAllDebounced();
    },
  });
  dd.scatterY = new Dropdown(el("tr-x-scatter-y"), {
    clearable: false,
    placeholder: "Y attribute",
    onChange: (v) => {
      const prev = state.ycol;
      state.ycol = v;
      retireAxisCol(prev, v);
      state.page = 0;
      renderAllDebounced();
    },
  });

  el("tr-x-btn-clear").addEventListener("click", () => {
    if (!state.where.length) return;
    state.where = [];
    forgetStaleAxes();
    syncStationPicker();
    state.page = 0;
    renderAll();
  });

  const startFig = () => emptyFig("Choose a fire centre and years to begin.");
  const startHeights = chartHeights();
  Plotly.newPlot(
    el("tr-x-parcoords"),
    startFig().data,
    sized(startFig(), startHeights.pc, el("tr-x-parcoords")).layout,
    PLOT_CONFIG_STATIC
  );
  Plotly.newPlot(
    el("tr-x-scatter"),
    startFig().data,
    sized(startFig(), startHeights.density, el("tr-x-scatter")).layout,
    PLOT_CONFIG_BAR
  );
  watchLayout();
  applyChartSizes();
  attachPlotEvents();
  renderTableBody(stationColumns(), [], 0);

  setTiming("Starting DuckDB\u2026");
  try {
    state.config = await timed("config:load", () => loadStationConfig());
    dd.fc.setOptions(
      fireCentres(state.config).map((f) => ({ label: f, value: f })),
      false
    );
    setTiming("");
  } catch (e) {
    setStatus("Could not load the station configuration.", true);
    setTiming("");
  }
}

boot();
