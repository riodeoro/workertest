import {
  CIRCULAR_COLS,
  FWI_COLS,
  xLabel,
  disp,
  dispUnit,
} from "./data.js";

export const FONT_FAMILY =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

export const SERIES_COLOR = "#a8a29e";
export const SERIES_FILL = "rgba(168, 162, 158, 0.12)";
export const SERIES2_COLOR = "#ea8a0b";
export const SERIES2_FILL = "rgba(234, 138, 11, 0.10)";
export const SERIES2_OPACITY = 0.45;
export const MATCH_COLOR = "#dc2626";

export const DENSITY_SCALE = [
  [0.0, "#eee5d6"],
  [0.3, "#d3bd9b"],
  [0.6, "#ac8f6b"],
  [0.85, "#755a41"],
  [1.0, "#3d2c1d"],
];

export const MUTED_SCALE = [
  [0.0, "#efedeb"],
  [1.0, "#dcd8d3"],
];

export const MUTED_OPACITY = 0.35;

export const PARCOORDS_MUTED = "#a8a29e";

export const PARCOORDS_MUTED_OPACITY = 0.05;

export const WARM_SCALE = [
  [0.0, "#fef3c7"],
  [0.35, "#fbbf24"],
  [0.7, "#ea580c"],
  [1.0, "#991b1b"],
];

export const COOL_SCALE = [
  [0.0, "#cfe3ef"],
  [0.35, "#5ba3c4"],
  [0.7, "#2f6f9e"],
  [1.0, "#1e3a6b"],
];

export const GREEN_SCALE = [
  [0.0, "#dcf0d8"],
  [0.35, "#86c07a"],
  [0.7, "#3f8f45"],
  [1.0, "#1a4a2b"],
];

export const POWER_SCALE = [
  [0.0, "#ece7f7"],
  [0.35, "#a78bfa"],
  [0.7, "#7c3aed"],
  [1.0, "#3b0764"],
];

export const PLAIN_SCALE = [
  [0.0, "#e2e8f0"],
  [0.5, "#64748b"],
  [1.0, "#1e293b"],
];

const COL_SCALE = {
  Temp: WARM_SCALE,
  ST1: WARM_SCALE,
  ST2: WARM_SCALE,
  ST3: WARM_SCALE,
  Rh: COOL_SCALE,
  SM1: COOL_SCALE,
  SM2: COOL_SCALE,
  SM3: COOL_SCALE,
  Rn_1: COOL_SCALE,
  PrecipOP2: COOL_SCALE,
  PrecipPC2: COOL_SCALE,
  Wspd: GREEN_SCALE,
  Mx_Spd: GREEN_SCALE,
  Dir: GREEN_SCALE,
  Vbat: POWER_SCALE,
  Vslr: POWER_SCALE,
  Ibat: POWER_SCALE,
  PYR: POWER_SCALE,
};

for (const c of FWI_COLS) COL_SCALE[c] = WARM_SCALE;

export function scaleFor(col) {
  return COL_SCALE[col] || PLAIN_SCALE;
}

export const PARCOORDS_LINE = "rgba(194, 65, 12, 0.30)";

export const STATION_PALETTE = [
  "#ea8a0b", "#dc2626", "#7c3aed", "#0d9488", "#16a34a",
  "#db2777", "#a16207", "#4f46e5", "#b45309", "#0891b2",
];

export function discreteScale(n) {
  n = Math.max(1, Math.floor(n));
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = STATION_PALETTE[i % STATION_PALETTE.length];
    out.push([i / n, c]);
    out.push([(i + 1) / n, c]);
  }
  return out;
}

export function axisStyle(title) {
  return {
    title: { text: title, font: { color: "#26231f", size: 12 } },
    tickfont: { color: "#8a857d" },
    showgrid: true,
    gridcolor: "#f1f0ee",
    gridwidth: 1,
    zeroline: false,
    showline: true,
    linecolor: "#e8e6e3",
    linewidth: 1,
  };
}

export function circularAxis(title) {
  return {
    title: { text: title, font: { color: "#26231f", size: 12 } },
    range: [0, 360],
    tickmode: "array",
    tickvals: [0, 45, 90, 135, 180, 225, 270, 315, 360],
    ticktext: ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"],
    tickfont: { color: "#8a857d" },
    showgrid: true,
    gridcolor: "#f1f0ee",
    gridwidth: 1,
    zeroline: false,
    showline: true,
    linecolor: "#e8e6e3",
    linewidth: 1,
  };
}

export function emptyFig(msg, height) {
  return {
    data: [],
    layout: {
      annotations: [
        {
          text: msg,
          xref: "paper",
          yref: "paper",
          x: 0.5,
          y: 0.5,
          showarrow: false,
          font: { size: 13, color: "#94a3b8" },
        },
      ],
      height: height || 360,
      margin: { l: 40, r: 24, t: 24, b: 40 },
      paper_bgcolor: "white",
      plot_bgcolor: "#fafafa",
      xaxis: { visible: false },
      yaxis: { visible: false },
    },
  };
}

export function normalizeDensitySelection(selection) {
  if (!selection) return null;
  const src = selection.range && (selection.range.x || selection.range.y)
    ? selection.range
    : selection;
  const rawX = src.x || src.xRange || src.xaxis || null;
  const rawY = src.y || src.yRange || src.yaxis || null;
  const norm = (a) => {
    if (!Array.isArray(a) || a.length !== 2) return null;
    const lo = Number(a[0]);
    const hi = Number(a[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  };
  const x = norm(rawX);
  const y = norm(rawY);
  if (!x && !y) return null;
  return { x, y };
}

export function buildDensity(res, xcol, ycol, selection) {
  if (!res || !res.n.length)
    return emptyFig("No observations match the current filters.", 420);
  const nx = res.nx;
  const ny = res.ny;
  const hasMatch = !!res.sel;
  const grid = new Array(ny);
  const cnt = new Array(ny);
  const mcnt = hasMatch ? new Array(ny) : null;
  for (let r = 0; r < ny; r++) {
    grid[r] = new Array(nx).fill(null);
    cnt[r] = new Array(nx).fill(0);
    if (hasMatch) mcnt[r] = new Array(nx).fill(0);
  }
  let maxCount = 0;
  for (let i = 0; i < res.n.length; i++) {
    const yb = Math.min(Math.max(res.yb[i], 0), ny - 1);
    const xb = Math.min(Math.max(res.xb[i], 0), nx - 1);
    const c = res.n[i];
    grid[yb][xb] = Math.log10(c);
    cnt[yb][xb] = c;
    if (hasMatch) mcnt[yb][xb] = res.sel[i];
    if (c > maxCount) maxCount = c;
  }
  const xAxisVals = new Array(nx);
  for (let i = 0; i < nx; i++) xAxisVals[i] = res.x0 + (i + 0.5) * res.xs;
  const yAxisVals = new Array(ny);
  for (let i = 0; i < ny; i++) yAxisVals[i] = res.y0 + (i + 0.5) * res.ys;
  const isDateX = xcol === "DATE_TIME_PARSED";
  const isDateY = ycol === "DATE_TIME_PARSED";
  const xOut = isDateX ? xAxisVals.map((v) => v * 1000) : xAxisVals;
  const yOut = isDateY ? yAxisVals.map((v) => v * 1000) : yAxisVals;

  const xDomain = [res.x0, res.x0 + nx * res.xs];
  const yDomain = [res.y0, res.y0 + ny * res.ys];
  const xRange = isDateX ? xDomain.map((v) => v * 1000) : xDomain;
  const yRange = isDateY ? yDomain.map((v) => v * 1000) : yDomain;

  const zmin = 0;
  const zmax = Math.max(Math.log10(Math.max(maxCount, 1)), 0.3);
  const tickvals = [];
  const ticktext = [];
  for (let k = 1; k < zmax; k++) {
    tickvals.push(k);
    ticktext.push(Math.pow(10, k).toLocaleString("en-US"));
  }

  const xaxis = axisStyle(xLabel(xcol));
  if (isDateX) xaxis.type = "date";
  xaxis.range = xRange;
  xaxis.autorange = false;

  const yaxis = axisStyle(xLabel(ycol));
  if (isDateY) yaxis.type = "date";
  yaxis.range = yRange;
  yaxis.autorange = false;

  const hoverlabel = {
    bgcolor: "white",
    bordercolor: "#d6d3d0",
    font: { color: "#1c1917", size: 12 },
  };

  const colorbar = {
    title: {
      text: "hours",
      side: "right",
      font: { size: 11, color: "#57534e" },
    },
    thickness: 12,
    len: 0.85,
    outlinewidth: 0,
    tickfont: { size: 10, color: "#8a857d" },
    tickvals,
    ticktext,
  };

  const hovertemplate =
    `${xLabel(xcol)}: %{x}<br>${xLabel(ycol)}: %{y}<br>` +
    "hours: %{customdata:,.0f}<extra></extra>";

  const sel = normalizeDensitySelection(selection);
  const data = [];

  if (!sel && !hasMatch) {
    data.push({
      type: "heatmap",
      x: xOut,
      y: yOut,
      z: grid,
      customdata: cnt,
      colorscale: DENSITY_SCALE,
      zmin,
      zmax,
      zauto: false,
      hoverongaps: false,
      xgap: 1,
      ygap: 1,
      hoverlabel,
      colorbar,
      hovertemplate,
    });
  } else {
    const inSel = (xv, yv) => {
      if (!sel) return true;
      if (sel.x && (xv < sel.x[0] || xv > sel.x[1])) return false;
      if (sel.y && (yv < sel.y[0] || yv > sel.y[1])) return false;
      return true;
    };
    const selGrid = new Array(ny);
    const selCnt = new Array(ny);
    for (let r = 0; r < ny; r++) {
      selGrid[r] = new Array(nx).fill(null);
      selCnt[r] = new Array(nx).fill(0);
      for (let c = 0; c < nx; c++) {
        if (grid[r][c] === null) continue;
        if (!inSel(xOut[c], yOut[r])) continue;
        const hits = hasMatch ? mcnt[r][c] : cnt[r][c];
        if (!hits) continue;
        selGrid[r][c] = Math.log10(hits);
        selCnt[r][c] = hits;
      }
    }

    data.push({
      type: "heatmap",
      x: xOut,
      y: yOut,
      z: grid,
      customdata: cnt,
      colorscale: MUTED_SCALE,
      zmin,
      zmax,
      zauto: false,
      opacity: MUTED_OPACITY,
      hoverongaps: false,
      xgap: 1,
      ygap: 1,
      showscale: false,
      hoverinfo: "skip",
    });

    data.push({
      type: "heatmap",
      x: xOut,
      y: yOut,
      z: selGrid,
      customdata: selCnt,
      colorscale: DENSITY_SCALE,
      zmin,
      zmax,
      zauto: false,
      hoverongaps: false,
      xgap: 1,
      ygap: 1,
      hoverlabel,
      colorbar,
      hovertemplate,
    });
  }

  return {
    data,
    layout: {
      height: 420,
      margin: { l: 64, r: 24, t: 16, b: 48 },
      plot_bgcolor: "#ffffff",
      paper_bgcolor: "white",
      font: { size: 11, color: "#57534e", family: FONT_FAMILY },
      xaxis,
      yaxis,
      dragmode: "select",
      selectdirection: "any",
      showlegend: false,
      hoverlabel,
    },
  };
}

function intersectRanges(a, b) {
  if (a.length !== 1 || b.length !== 1) return a;
  const lo = Math.max(a[0][0], b[0][0]);
  const hi = Math.min(a[0][1], b[0][1]);
  return [[lo, Math.max(lo, hi)]];
}

function muteColorscale(base, cmin, cmax) {
  const span = cmax - cmin || 1;
  const pad = span * 0.08;
  const lo = cmin - pad;
  const f = pad / (span + pad);
  const scale = [
    [0, PARCOORDS_MUTED],
    [f, PARCOORDS_MUTED],
  ];
  for (const [p, c] of base) scale.push([f + p * (1 - f), c]);
  return { scale, cmin: lo, cmax, sentinel: cmin - pad / 2 };
}

function applyMute(line, match, n) {
  let any = false;
  for (let i = 0; i < n; i++)
    if (!match[i]) {
      any = true;
      break;
    }
  if (!any) return line;

  let base;
  let cmin;
  let cmax;
  let values;
  if (Array.isArray(line.color) || ArrayBuffer.isView(line.color)) {
    base = line.colorscale;
    values = line.color;
    if (Number.isFinite(line.cmin) && Number.isFinite(line.cmax)) {
      cmin = line.cmin;
      cmax = line.cmax;
    } else {
      cmin = Infinity;
      cmax = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) continue;
        if (v < cmin) cmin = v;
        if (v > cmax) cmax = v;
      }
      if (!Number.isFinite(cmin) || !Number.isFinite(cmax)) {
        cmin = 0;
        cmax = 1;
      }
    }
  } else {
    base = [
      [0, line.color],
      [1, line.color],
    ];
    cmin = 0;
    cmax = 1;
    values = null;
  }

  const m = muteColorscale(base, cmin, cmax);
  const out = new Array(n);
  for (let i = 0; i < n; i++)
    out[i] = match[i] ? (values ? values[i] : cmax) : m.sentinel;
  line.color = out;
  line.colorscale = m.scale;
  line.cmin = m.cmin;
  line.cmax = m.cmax;
  return line;
}

export function buildParcoords(
  sample,
  dims,
  colourCol,
  constraints,
  stations,
  match
) {
  if (!sample || !sample.n || !dims || !dims.length)
    return emptyFig("Choose one or more attributes for the axes.");
  const df = sample.data;
  const extents = sample.extents || {};
  const usable = dims.filter((d) => df[d]);
  if (!usable.length) return emptyFig("Choose one or more attributes for the axes.");

  const cons = {};
  for (const c of constraints || []) {
    const col = c.col;
    if (!col) continue;
    if (col === "STATION_NAME") {
      const idx = (c.names || [])
        .map((nm) => stations.indexOf(nm))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      const runs = [];
      for (const i of idx) {
        if (runs.length && i === runs[runs.length - 1][1] + 1)
          runs[runs.length - 1][1] = i;
        else runs.push([i, i]);
      }
      if (runs.length) cons[col] = runs.map(([a, b]) => [a - 0.45, b + 0.45]);
      continue;
    }
    if (c.ranges && c.ranges.length)
      cons[col] = cons[col] ? intersectRanges(cons[col], c.ranges) : c.ranges;
  }

  const dimensions = [];
  for (const d of usable) {
    const spec = { label: xLabel(d) };
    if (d === "STATION_NAME") {
      spec.values = Array.from(df[d], (v) => (Number.isFinite(v) ? v : null));
      spec.tickvals = stations.map((_, i) => i);
      spec.ticktext = stations.slice();
      spec.range = [0, Math.max(0, stations.length - 1)];
    } else {
      const vals = df[d];
      let lo = extents[d] ? extents[d][0] : NaN;
      let hi = extents[d] ? extents[d][1] : NaN;
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
        lo = Infinity;
        hi = -Infinity;
        for (let i = 0; i < vals.length; i++) {
          const v = vals[i];
          if (Number.isFinite(v)) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
        hi = (Number.isFinite(lo) ? lo : 0) + 1;
        lo = hi - 1;
      }
      spec.values = vals;
      spec.range = CIRCULAR_COLS.has(d) ? [0, 360] : [lo, hi];
      if (CIRCULAR_COLS.has(d)) {
        spec.tickvals = [0, 90, 180, 270, 360];
        spec.ticktext = ["N", "E", "S", "W", "N"];
      }
    }
    if (cons[d])
      spec.constraintrange = cons[d].length === 1 ? cons[d][0] : cons[d];
    spec.multiselect = !!(cons[d] && cons[d].length > 1);
    dimensions.push(spec);
  }

  let line;
  if (colourCol && df[colourCol] && colourCol !== "STATION_NAME") {
    line = {
      color: df[colourCol],
      colorscale: scaleFor(colourCol),
      showscale: true,
      colorbar: {
        title: {
          text: xLabel(colourCol),
          side: "right",
          font: { size: 11, color: "#57534e" },
        },
        thickness: 12,
        len: 0.85,
        outlinewidth: 0,
        tickfont: { size: 10, color: "#8a857d" },
      },
    };
  } else if (colourCol === "STATION_NAME" && df.STATION_NAME) {
    const n = Math.max(1, stations.length);
    line = {
      color: Array.from(df.STATION_NAME, (v) => (Number.isFinite(v) ? v : 0)),
      colorscale: discreteScale(n),
      cmin: -0.5,
      cmax: n - 0.5,
      showscale: false,
    };
  } else {
    line = { color: PARCOORDS_LINE };
  }

  if (match && match.length === sample.n) line = applyMute(line, match, sample.n);

  return {
    data: [
      {
        type: "parcoords",
        dimensions,
        line,
        unselected: {
          line: { color: PARCOORDS_MUTED, opacity: PARCOORDS_MUTED_OPACITY },
        },
        labelfont: { size: 12, color: "#26231f" },
        tickfont: { size: 11, color: "#57534e" },
        rangefont: { size: 10, color: "#8a857d" },
        labelangle: 0,
        labelside: "top",
      },
    ],
    layout: {
      height: 380,
      margin: { l: 64, r: 64, t: 56, b: 28 },
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      font: { size: 11, color: "#57534e", family: FONT_FAMILY },
    },
  };
}

function fmtVal(v) {
  return v === null || v === undefined || !Number.isFinite(v)
    ? "-"
    : v.toFixed(1);
}

export function buildStationDetail(series, plotCol, plotCol2, filtered) {
  if (!series || !series.n || !series[plotCol])
    return emptyFig("No data for this station.", 440);

  const circular = CIRCULAR_COLS.has(plotCol);
  const t = series.t;
  const v = series[plotCol];
  const keptT = [];
  const keptV = [];
  for (let i = 0; i < series.n; i++) {
    if (Number.isFinite(v[i])) {
      keptT.push(t[i]);
      keptV.push(v[i]);
    }
  }

  const data = [];
  if (keptT.length) {
    if (circular) {
      data.push({
        type: "scattergl",
        x: keptT,
        y: keptV,
        mode: "markers",
        name: disp(plotCol),
        marker: {
          color: SERIES_COLOR,
          size: 3,
          opacity: 0.35,
          line: { width: 0 },
        },
        hovertemplate: `${dispUnit(plotCol)}: %{y:.0f}<extra></extra>`,
        showlegend: false,
      });
    } else {
      const gx = [];
      const gy = [];
      const gapMs = 7 * 24 * 3600 * 1000;
      for (let i = 0; i < keptT.length; i++) {
        if (i > 0 && keptT[i] - keptT[i - 1] > gapMs) {
          gx.push(keptT[i]);
          gy.push(null);
        }
        gx.push(keptT[i]);
        gy.push(keptV[i]);
      }
      data.push({
        type: "scattergl",
        x: gx,
        y: gy,
        mode: "lines",
        name: disp(plotCol),
        line: { color: SERIES_COLOR, width: 1.4, shape: "linear" },
        yaxis: "y",
        fill: "tozeroy",
        fillcolor: SERIES_FILL,
        hovertemplate: `${dispUnit(plotCol)}: %{y:.1f}<extra></extra>`,
        showlegend: false,
      });
    }
  }

  let hasSecond = !!(plotCol2 && plotCol2 !== plotCol && series[plotCol2]);
  if (hasSecond) {
    const v2 = series[plotCol2];
    const t2 = [];
    const y2 = [];
    for (let i = 0; i < series.n; i++) {
      if (Number.isFinite(v2[i])) {
        t2.push(t[i]);
        y2.push(v2[i]);
      }
    }
    if (!t2.length) hasSecond = false;
    else {
      const circ2 = CIRCULAR_COLS.has(plotCol2);
      const trace = {
        type: "scattergl",
        x: t2,
        y: y2,
        mode: circ2 ? "markers" : "lines",
        name: disp(plotCol2),
        xaxis: "x",
        yaxis: "y2",
        marker: {
          color: SERIES2_COLOR,
          size: 3,
          opacity: 0.35,
          line: { width: 0 },
        },
        line: { color: SERIES2_COLOR, width: 1.4 },
        hovertemplate: `${dispUnit(plotCol2)}: %{y:.1f}<extra></extra>`,
        showlegend: false,
      };
      if (!circ2) {
        trace.fill = "tozeroy";
        trace.fillcolor = SERIES2_FILL;
      }
      data.push(trace);
    }
  }

  const mx = [];
  const my = [];
  const mtext = [];
  const extraCols = (filtered || []).filter(
    (c) => c !== plotCol && series[c]
  );
  for (let i = 0; i < series.n; i++) {
    if (series.match[i] && Number.isFinite(v[i])) {
      mx.push(t[i]);
      my.push(v[i]);
      let txt = `${dispUnit(plotCol)}: ${fmtVal(v[i])}`;
      for (const cv of extraCols)
        txt += `<br>${dispUnit(cv)}: ${fmtVal(series[cv][i])}`;
      mtext.push(txt);
    }
  }
  if (mx.length) {
    data.push({
      type: "scattergl",
      x: mx,
      y: my,
      mode: "markers",
      name: "Meets filters",
      xaxis: "x",
      yaxis: "y",
      marker: {
        color: MATCH_COLOR,
        size: 8,
        symbol: "circle",
        line: { width: 1, color: "white" },
        opacity: 0.92,
      },
      customdata: mtext,
      hovertemplate: "%{customdata}<extra></extra>",
      showlegend: true,
    });
  }

  const strip = matchStrip(mx);
  const hasStrip = !!strip;
  if (hasStrip) data.push(strip.trace);

  const stripH = hasStrip ? 0.1 : 0;
  const stripGap = hasStrip ? 0.06 : 0;
  const panels = hasSecond ? 2 : 1;
  const panelGap = 0.08;
  const panelH =
    (1 - stripH - stripGap - (panels - 1) * panelGap) / panels;
  const domains = [];
  let topEdge = 1;
  for (let i = 0; i < panels; i++) {
    domains.push([
      Math.max(0, +(topEdge - panelH).toFixed(4)),
      +topEdge.toFixed(4),
    ]);
    topEdge = topEdge - panelH - panelGap;
  }

  const layout = {
    height: 440,
    margin: { l: 60, r: 24, t: 20, b: 40 },
    plot_bgcolor: "#ffffff",
    paper_bgcolor: "white",
    font: { size: 11, color: "#57534e", family: FONT_FAMILY },
    showlegend: !!mx.length,
    legend: {
      orientation: "h",
      yanchor: "bottom",
      y: 1.02,
      xanchor: "right",
      x: 1,
      bgcolor: "rgba(255,255,255,0)",
      font: { size: 11 },
    },
    hovermode: "x unified",
    hoverlabel: {
      bgcolor: "white",
      font_size: 11,
      bordercolor: "#e8e6e3",
      align: "left",
    },
    xaxis: {
      type: "date",
      anchor: hasStrip ? "y3" : hasSecond ? "y2" : "y",
      showgrid: true,
      gridcolor: "#f1f0ee",
      gridwidth: 1,
      showline: true,
      linecolor: "#e8e6e3",
      linewidth: 1,
      ticks: "outside",
      tickcolor: "#e8e6e3",
      ticklen: 4,
      rangeslider: { visible: true, thickness: 0.08, bgcolor: "#fafaf9" },
    },
    yaxis: circular
      ? circularAxis(dispUnit(plotCol))
      : axisStyle(dispUnit(plotCol)),
  };
  layout.yaxis.domain = domains[0];
  layout.yaxis.anchor = "x";
  if (hasSecond) {
    const y2 = CIRCULAR_COLS.has(plotCol2)
      ? circularAxis(dispUnit(plotCol2))
      : axisStyle(dispUnit(plotCol2));
    y2.title.font = { color: SERIES2_COLOR, size: 12 };
    y2.tickfont = { color: SERIES2_COLOR };
    y2.domain = domains[1];
    y2.anchor = "x";
    layout.yaxis2 = y2;
  }
  if (hasStrip) {
    layout.yaxis3 = {
      domain: [0, +stripH.toFixed(4)],
      anchor: "x",
      title: { text: "Matches", font: { color: "#26231f", size: 11 } },
      range: [-0.5, 0.5],
      showticklabels: false,
      showgrid: false,
      zeroline: false,
      ticks: "",
      showline: true,
      linecolor: "#e8e6e3",
      linewidth: 1,
      fixedrange: true,
    };
  }
  return { data, layout };
}

const STRIP_MAX_CELLS = 800;
const DAY_MS = 24 * 3600 * 1000;

function matchStrip(times) {
  if (!times || times.length < 2) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of times) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const span = hi - lo;
  let step = DAY_MS;
  while (span / step > STRIP_MAX_CELLS) step *= 7;
  const start = Math.floor(lo / step) * step;
  const cells = Math.max(1, Math.ceil((hi - start) / step) + 1);
  const counts = new Float64Array(cells);
  for (const v of times) {
    const b = Math.floor((v - start) / step);
    if (b >= 0 && b < cells) counts[b] += 1;
  }
  const x = new Array(cells);
  const z = new Array(cells);
  let peak = 0;
  for (let i = 0; i < cells; i++) {
    x[i] = start + (i + 0.5) * step;
    z[i] = counts[i] || null;
    if (counts[i] > peak) peak = counts[i];
  }
  if (!peak) return null;
  const unit = step === DAY_MS ? "day" : `${Math.round(step / DAY_MS)} days`;
  return {
    step,
    trace: {
      type: "heatmap",
      x,
      y: [0],
      z: [z],
      xaxis: "x",
      yaxis: "y3",
      colorscale: [
        [0, "#fde3e0"],
        [1, MATCH_COLOR],
      ],
      zmin: 0,
      zmax: peak,
      zauto: false,
      showscale: false,
      hoverongaps: false,
      xgap: 0,
      ygap: 0,
      hovertemplate: `%{z:,.0f} matching hours per ${unit}<extra></extra>`,
      showlegend: false,
    },
  };
}
