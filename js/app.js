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
  stationSource,
  compileWhere,
  notNullSql,
  andSql,
  density,
  lineSample,
  stationSummary,
  stationSeries,
  stationsInRanges,
  xLabel,
  dispUnit,
} from "./data.js";
import { dropCache } from "./duck.js";
import { emptyFig, buildDensity, buildParcoords, buildStationDetail } from "./charts.js";

const PLOT_CONFIG_STATIC = { displayModeBar: false, responsive: true };
const PLOT_CONFIG_BAR = {
  displayModeBar: true,
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
};

const el = (id) => document.getElementById(id);

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

function clauseLabel(clause) {
  const col = clause.col;
  const names = clause.names;
  if (names != null || col === "STATION_NAME") {
    const list = names || [];
    let shown = list.slice(0, 3).join(", ");
    if (list.length > 3) shown += ` +${list.length - 3} more`;
    return list.length ? `Station: ${shown}` : "Station: none";
  }
  const ranges = clause.ranges || [];
  let parts;
  if (col === "DATE_TIME_PARSED")
    parts = ranges.map(
      ([lo, hi]) => `${fmtDate(lo * 1000)} to ${fmtDate(hi * 1000)}`
    );
  else
    parts = ranges.map(
      ([lo, hi]) =>
        `${Number(lo).toLocaleString("en-US", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} to ${Number(hi).toLocaleString("en-US", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}`
    );
  return `${xLabel(col)}  ${parts.join(", ")}`;
}

function renderChips(target, clauses, removable) {
  target.innerHTML = "";
  (clauses || []).forEach((c, i) => {
    const span = document.createElement("span");
    span.className = "tr-chip";
    const lab = document.createElement("span");
    lab.textContent = clauseLabel(c);
    span.appendChild(lab);
    if (removable) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "\u00d7";
      b.title = `Remove filter: ${clauseLabel(c)}`;
      b.addEventListener("click", () => {
        state.where = state.where.slice(0, i).concat(state.where.slice(i + 1));
        syncStationPicker();
        state.page = 0;
        renderAll();
      });
      span.appendChild(b);
    }
    target.appendChild(span);
  });
}

function putClause(src, col, ranges, names) {
  const out = state.where.filter((c) => !(c.src === src && c.col === col));
  const hasRanges = ranges && ranges.length;
  const hasNames = names && names.length;
  if (hasRanges || hasNames) {
    const clause = { src, col };
    if (names !== undefined && names !== null) clause.names = names;
    else clause.ranges = ranges;
    out.push(clause);
  }
  state.where = out;
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

const SELECTION_SRC = new Set(["zoom", "select"]);

function isDensitySelection(clause) {
  return (
    SELECTION_SRC.has(clause.src) &&
    (clause.col === state.xcol || clause.col === state.ycol)
  );
}

function densityWhere() {
  return whereFrom(state.where.filter((c) => !isDensitySelection(c)));
}

function selectionSpan(col) {
  if (!col) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of state.where) {
    if (c.col !== col || !SELECTION_SRC.has(c.src)) continue;
    for (const [a, b] of c.ranges || []) {
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const k = col === "DATE_TIME_PARSED" ? 1000 : 1;
  return [lo * k, hi * k];
}

function densitySelection() {
  const x = selectionSpan(state.xcol);
  const y = selectionSpan(state.ycol);
  return x || y ? { x, y } : null;
}

async function renderParcoords(token) {
  const node = el("tr-x-parcoords");
  if (!state.loaded || !state.dims.length) {
    Plotly.react(node, emptyFig("Load a fire centre to begin."), {}, PLOT_CONFIG_STATIC);
    return;
  }
  spin("tr-spin-parcoords", true);
  try {
    const source = await currentSource();
    if (!source || token !== state.token) return;
    const w = whereOf();
    const cols = state.dims.concat(state.colorby ? [state.colorby] : []);
    const drawable = andSql(w, notNullSql(cols));
    const sample = await lineSample(
      source,
      state.dims,
      drawable,
      state.colorby || null,
      LINE_CAP
    );
    if (token !== state.token) return;
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
          state.stations.slice().sort()
        )
      : emptyFig("No observations match the current filters.");
    Plotly.react(node, fig.data, fig.layout, PLOT_CONFIG_STATIC);
  } catch (e) {
    Plotly.react(
      node,
      emptyFig("No observations match the current filters."),
      {},
      PLOT_CONFIG_STATIC
    );
  } finally {
    spin("tr-spin-parcoords", false);
  }
}

async function renderDensity(token) {
  const node = el("tr-x-scatter");
  if (!state.loaded || !state.xcol || !state.ycol) {
    Plotly.react(node, emptyFig("Load a fire centre to begin.", 420), {}, PLOT_CONFIG_BAR);
    return;
  }
  spin("tr-spin-scatter", true);
  try {
    const source = await currentSource();
    if (!source || token !== state.token) return;
    const res = await density(source, state.xcol, state.ycol, densityWhere());
    if (token !== state.token) return;
    const fig = buildDensity(res, state.xcol, state.ycol, densitySelection());
    Plotly.react(node, fig.data, fig.layout, PLOT_CONFIG_BAR);
  } catch (e) {
    Plotly.react(
      node,
      emptyFig("No observations match the current filters.", 420),
      {},
      PLOT_CONFIG_BAR
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
    const res = await stationSummary(
      source,
      whereOf(),
      state.xcol,
      state.ycol,
      state.sortBy,
      state.page * PAGE_SIZE,
      PAGE_SIZE
    );
    if (token !== state.token) return;
    const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
    if (state.page > pages - 1) {
      state.page = pages - 1;
      spin("tr-spin-table", false);
      return renderTable(token);
    }
    renderTableBody(stationColumns(), res.rows, res.total);
  } catch (e) {
    renderTableBody(stationColumns(), [], 0);
  } finally {
    spin("tr-spin-table", false);
  }
}

function renderAll() {
  state.token += 1;
  const token = state.token;
  renderChips(el("tr-x-filter-bar"), state.where, true);
  renderParcoords(token);
  renderDensity(token);
  renderTable(token);
}

const renderAllDebounced = debounce(renderAll, 90);

async function openStationDetail(station) {
  if (!station || !state.loaded) return;
  const cols = [state.xcol, state.ycol].filter(
    (c) => c && c !== "DATE_TIME_PARSED"
  );
  const plotCol = cols[0] || state.liveCols.filter((c) => ALL_SENSOR_COLS.includes(c))[0];
  if (!plotCol) return;
  const plotCol2 = cols[1] || null;
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

  close.addEventListener("click", () => (container.innerHTML = ""));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) container.innerHTML = "";
  });

  Plotly.newPlot(plot, emptyFig("", 440).data, emptyFig("", 440).layout, PLOT_CONFIG_DETAIL);

  try {
    let source = await stationSource(station, state.years, state.stations);
    if (!source) source = await currentSource();
    if (!source) return;
    const want = [plotCol, plotCol2]
      .concat(filteredCols(state.where))
      .filter((c) => c && c !== "STATION_NAME" && c !== "DATE_TIME_PARSED");
    const series = await stationSeries(
      source,
      station,
      whereOf(),
      want,
      STATION_DETAIL_MAX
    );
    const fig = buildStationDetail(
      series,
      plotCol,
      plotCol2,
      filteredCols(state.where)
    );
    Plotly.react(plot, fig.data, fig.layout, PLOT_CONFIG_DETAIL);
  } catch (e) {
    console.error("station detail failed", e);
    const fig = emptyFig("No data for this station.", 440);
    Plotly.react(plot, fig.data, fig.layout, PLOT_CONFIG_DETAIL);
  }
}

function attachPlotEvents() {
  const par = el("tr-x-parcoords");
  par.on("plotly_restyle", (evt) => {
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
          stationsInRanges(state.stations.slice().sort(), ranges)
        );
      else putClause("brush", dims[i], ranges);
      changed = true;
    }
    if (!changed) return;
    syncStationPicker();
    state.page = 0;
    renderAllDebounced();
  });

  const sc = el("tr-x-scatter");
  sc.on("plotly_selected", (evt) => {
    const range = evt && evt.range ? evt.range : null;
    if (!range) return;
    let got = false;
    for (const [axis, col] of [
      ["x", state.xcol],
      ["y", state.ycol],
    ]) {
      const span = range[axis];
      if (!Array.isArray(span) || span.length !== 2 || !col) continue;
      const a = axisValue(col, span[0]);
      const b = axisValue(col, span[1]);
      if (a === null || b === null) continue;
      putClause("select", col, [[Math.min(a, b), Math.max(a, b)]]);
      got = true;
    }
    if (!got) return;
    state.page = 0;
    renderAllDebounced();
  });

  sc.on("plotly_deselect", () => {
    const before = state.where.length;
    state.where = state.where.filter((c) => c.src !== "select");
    if (state.where.length === before) return;
    state.page = 0;
    renderAllDebounced();
  });

  sc.on("plotly_relayout", (rl) => {
    if (!rl || typeof rl !== "object") return;
    if (rl["xaxis.autorange"] || rl.autosize) {
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
}

async function doLoad() {
  const fc = dd.fc.getValue();
  const years = (dd.year.getValue() || []).map(Number).sort((a, b) => a - b);
  state.where = [];
  state.page = 0;
  state.sortBy = [];
  _sourceKey = null;
  dropCache();
  if (!fc) {
    state.loaded = false;
    state.fc = null;
    state.years = [];
    blankAttributes();
    setStatus("");
    renderAll();
    return;
  }
  if (!years.length) {
    state.loaded = false;
    state.fc = fc;
    state.years = [];
    blankAttributes();
    setStatus("");
    renderAll();
    return;
  }

  state.fc = fc;
  state.years = years;
  state.stations = enabledStations(state.config, fc);
  setStatus("");
  setTiming("Reading parquet footers\u2026");
  const t0 = performance.now();

  let source = null;
  try {
    source = await resolveSource(fc, years, state.stations, []);
  } catch (e) {
    source = null;
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
  renderAll();
}

async function boot() {
  dd.fc = new Dropdown(el("tr-fc-select"), {
    placeholder: "Choose a fire centre",
    onChange: async (v) => {
      dd.year.setOptions([], false);
      if (!v) return;
      dd.year.setDisabled(true);
      setTiming("Locating year partitions\u2026");
      const stations = enabledStations(state.config, v);
      const { years } = await yearsForFc(v, stations);
      dd.year.setOptions(
        years.map((y) => ({ label: String(y), value: y })),
        false
      );
      dd.year.setDisabled(false);
      setTiming("");
    },
  });
  dd.year = new Dropdown(el("tr-year-select"), {
    multi: true,
    placeholder: "Choose one or more years",
  });
  dd.station = new Dropdown(el("tr-x-station"), {
    multi: true,
    placeholder: "All stations",
    onChange: (v) => {
      putClause("station", "STATION_NAME", null, v || []);
      state.page = 0;
      renderAllDebounced();
    },
  });
  dd.dims = new Dropdown(el("tr-x-dims"), {
    multi: true,
    placeholder: "Choose attributes",
    onChange: (v) => {
      state.dims = v || [];
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
      state.xcol = v;
      state.page = 0;
      renderAllDebounced();
    },
  });
  dd.scatterY = new Dropdown(el("tr-x-scatter-y"), {
    clearable: false,
    placeholder: "Y attribute",
    onChange: (v) => {
      state.ycol = v;
      state.page = 0;
      renderAllDebounced();
    },
  });

  el("tr-btn-reload").addEventListener("click", () => {
    el("tr-btn-reload").disabled = true;
    doLoad().finally(() => (el("tr-btn-reload").disabled = false));
  });

  el("tr-x-btn-clear").addEventListener("click", () => {
    if (!state.where.length) return;
    state.where = [];
    syncStationPicker();
    state.page = 0;
    renderAll();
  });

  Plotly.newPlot(
    el("tr-x-parcoords"),
    emptyFig("Load a fire centre to begin.").data,
    emptyFig("Load a fire centre to begin.").layout,
    PLOT_CONFIG_STATIC
  );
  Plotly.newPlot(
    el("tr-x-scatter"),
    emptyFig("Load a fire centre to begin.", 420).data,
    emptyFig("Load a fire centre to begin.", 420).layout,
    PLOT_CONFIG_BAR
  );
  attachPlotEvents();
  renderTableBody(stationColumns(), [], 0);

  setTiming("Starting DuckDB\u2026");
  try {
    state.config = await loadStationConfig();
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
