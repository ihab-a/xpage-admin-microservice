import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import EChart from '../components/EChart';
import client from '../api/client';
import { useTheme } from '../hooks/useTheme';
import './AiMetricsPage.css';

// ── Colors ────────────────────────────────────────────────────────────────────

const COLORS = ['#60a5fa','#34d399','#f472b6','#fbbf24','#a78bfa',
                 '#f87171','#38bdf8','#4ade80','#fb923c','#e879f9'];

// ── Presets / granularities ───────────────────────────────────────────────────

const PRESETS = [
  { label: '1h',  ms: 3_600_000,       gran: 'minute' },
  { label: '24h', ms: 86_400_000,      gran: 'hour'   },
  { label: '7d',  ms: 7 * 86_400_000,  gran: 'hour'   },
  { label: '30d', ms: 30 * 86_400_000, gran: 'day'    },
];
const GRANS = [
  { value: 'minute', label: 'Min' },
  { value: 'hour',   label: 'Hour' },
  { value: 'day',    label: 'Day'  },
];

// ── Pricing ───────────────────────────────────────────────────────────────────

const DEFAULT_PRICES = {
  'gpt-4.1':                       [2.00,  8.00],
  'gpt-4.1-mini':                  [0.40,  1.60],
  'gpt-4.1-nano':                  [0.10,  0.40],
  'gpt-4o':                        [2.50, 10.00],
  'gpt-5':                         [1.25, 10.00],
  'gpt-5-mini':                    [0.25,  2.00],
  'gpt-5-nano':                    [0.05,  0.40],
  'o3-mini':                       [1.10,  4.40],
  'o4-mini':                       [0.55,  2.20],
  'gemini-2.5-flash':              [0.30,  2.50],
  'gemini-2.5-flash-lite':         [0.10,  0.40],
  'gemini-2.5-pro':                [1.25, 10.00],
  'gemini-3.1-flash-lite-preview': [0.25,  1.50],
};
const PRICES_KEY = 'ai_metrics_prices_v2';

function loadCustomPrices() {
  try { return JSON.parse(localStorage.getItem(PRICES_KEY) || '{}'); } catch { return {}; }
}
function effectivePrices() { return { ...DEFAULT_PRICES, ...loadCustomPrices() }; }
function calcCost(model, inTok, outTok, thinkTok) {
  const p = effectivePrices()[model];
  if (!p) return null;
  return (Number(inTok) * p[0] + (Number(outTok) + Number(thinkTok)) * p[1]) / 1_000_000;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
function fmtMs(ms) {
  if (!ms) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
}
function fmtCost(c) {
  if (c === null || c === undefined) return '—';
  if (c === 0) return '$0';
  if (c < 0.0001) return '$' + c.toFixed(6);
  if (c < 0.01)   return '$' + c.toFixed(4);
  if (c < 1)      return '$' + c.toFixed(3);
  return '$' + c.toFixed(2);
}
function toDatetimeLocal(d) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}
function fmtDateShort(d) {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

// ── Delta helper ──────────────────────────────────────────────────────────────

function calcDelta(current, prev, compareEnabled) {
  if (!compareEnabled || !prev) return null;
  const p = Number(prev);
  if (p === 0) return null;
  const pct = ((Number(current) - p) / p) * 100;
  return { pct, up: pct >= 0 };
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function granStepMs(g) {
  return g === 'minute' ? 60_000 : g === 'hour' ? 3_600_000 : 86_400_000;
}
function truncUtc(ms, g) {
  const d = new Date(ms);
  if (g === 'minute') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  if (g === 'hour')   return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function makeGrid(from, to, gran) {
  const step  = granStepMs(gran);
  const start = truncUtc(from.getTime(), gran);
  const end   = truncUtc(to.getTime(), gran);
  const grid  = [];
  for (let t = start; t <= end; t += step) grid.push(t / 1000);
  return grid;
}
function bucketLabel(ts, gran) {
  const d = new Date(ts * 1000);
  const u = { timeZone: 'UTC' };
  if (gran === 'minute') return d.toLocaleString('en-US', { ...u, hour: '2-digit', minute: '2-digit', hour12: false });
  if (gran === 'hour')   return d.toLocaleString('en-US', { ...u, month: 'short', day: 'numeric', hour: '2-digit', hour12: false });
  return d.toLocaleDateString('en-US', { ...u, month: 'short', day: 'numeric' });
}

// ── Data pivots ───────────────────────────────────────────────────────────────

function pivotByModel(data, grid, models, gran, field) {
  const map = new Map();
  for (const ts of grid) {
    const row = { ts };
    for (const m of models) row[m] = 0;
    map.set(ts, row);
  }
  for (const r of data) {
    const e = map.get(r.ts);
    if (e) e[r.model] = (e[r.model] ?? 0) + Number(r[field]);
  }
  return { labels: grid.map(ts => bucketLabel(ts, gran)), series: models.map(m => ({ name: m, data: grid.map(ts => map.get(ts)?.[m] ?? 0) })) };
}

function pivotTokens(data, grid, gran) {
  const map = new Map();
  for (const ts of grid) map.set(ts, { input: 0, output: 0, thinking: 0 });
  for (const r of data) {
    const e = map.get(r.ts);
    if (e) { e.input += Number(r.input_tokens); e.output += Number(r.output_tokens); e.thinking += Number(r.thinking_tokens); }
  }
  const labels = grid.map(ts => bucketLabel(ts, gran));
  return { labels, input: grid.map(ts => map.get(ts)?.input ?? 0), output: grid.map(ts => map.get(ts)?.output ?? 0), thinking: grid.map(ts => map.get(ts)?.thinking ?? 0) };
}

function pivotCostByModel(data, grid, models, gran) {
  const prices = effectivePrices();
  const map = new Map();
  for (const ts of grid) { const row = {}; for (const m of models) row[m] = 0; map.set(ts, row); }
  for (const r of data) {
    const e = map.get(r.ts);
    if (!e) continue;
    const p = prices[r.model];
    if (p) e[r.model] = (e[r.model] ?? 0) + (Number(r.input_tokens) * p[0] + (Number(r.output_tokens) + Number(r.thinking_tokens)) * p[1]) / 1_000_000;
  }
  return { labels: grid.map(ts => bucketLabel(ts, gran)), series: models.filter(m => prices[m]).map(m => ({ name: m, data: grid.map(ts => +(map.get(ts)?.[m] ?? 0).toFixed(6)) })) };
}

function modelTotals(data) {
  const map = {};
  for (const r of data) {
    const k = `${r.provider}:${r.model}`;
    if (!map[k]) map[k] = { provider: r.provider, model: r.model, requests: 0, errors: 0, input: 0, output: 0, thinking: 0, durSum: 0, durCnt: 0 };
    map[k].requests += Number(r.requests); map[k].errors   += Number(r.errors);
    map[k].input    += Number(r.input_tokens); map[k].output   += Number(r.output_tokens);
    map[k].thinking += Number(r.thinking_tokens);
    map[k].durSum   += Number(r.duration_ms_sum); map[k].durCnt   += Number(r.duration_count);
  }
  return Object.values(map).sort((a, b) => b.requests - a.requests);
}

function modeTotals(modeBreakdown) {
  const map = {};
  for (const r of modeBreakdown) {
    if (!map[r.mode]) map[r.mode] = { mode: r.mode, input: 0, output: 0, thinking: 0, durSum: 0, durCnt: 0, rows: [] };
    map[r.mode].input    += Number(r.input_tokens);   map[r.mode].output   += Number(r.output_tokens);
    map[r.mode].thinking += Number(r.thinking_tokens); map[r.mode].durSum   += Number(r.duration_ms_sum);
    map[r.mode].durCnt   += Number(r.duration_count); map[r.mode].rows.push(r);
  }
  return Object.values(map).sort((a, b) => (b.input + b.output + b.thinking) - (a.input + a.output + a.thinking));
}

// ── ECharts shared style ──────────────────────────────────────────────────────

function makeChartStyles(isDark) {
  const axisLabel = { color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 };
  const axisLine  = { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } };
  const splitLine = { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)' } };
  const splitLineX= { show: false };
  const tooltip = {
    backgroundColor: isDark ? '#1e293b' : '#fff',
    borderColor:     isDark ? '#334155' : '#e2e8f0',
    textStyle: { color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
  };
  const legend = { textStyle: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }, type: 'scroll' };
  const toolbox = {
    right: 10, top: 4,
    feature: {
      dataZoom:    { yAxisIndex: 'none', title: { zoom: 'Zoom', back: 'Reset' } },
      saveAsImage: { pixelRatio: 2, title: 'Export' },
      restore:     { title: 'Reset' },
    },
    iconStyle: { borderColor: isDark ? '#475569' : '#94a3b8' },
    emphasis:  { iconStyle: { borderColor: isDark ? '#94a3b8' : '#475569' } },
  };
  const dataZoom = [
    { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
  ];
  return { axisLabel, axisLine, splitLine, splitLineX, tooltip, legend, toolbox, dataZoom };
}

const activateDragZoom = (chart) =>
  chart.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: true });

// ── Option builders ───────────────────────────────────────────────────────────

function lineSeriesItem(name, data, idx) {
  const color = COLORS[idx % COLORS.length];
  return {
    type: 'line', name, smooth: 0.3, symbolSize: 4, data,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    areaStyle: { color: color + '18', origin: 'start' },
    large: true, largeThreshold: 2000,
  };
}

// Previous-period series: dashed, low opacity, no area, hidden from legend
function lineSeriesItemPrev(name, data, idx) {
  const color = COLORS[idx % COLORS.length];
  return {
    type: 'line', name: name + ' ·prev', smooth: 0.3, symbolSize: 0, data,
    lineStyle: { width: 1.5, color, type: 'dashed', opacity: 0.4 },
    itemStyle: { color, opacity: 0.4 },
    areaStyle: null,
    legendHoverLink: false,
    emphasis: { disabled: true },
    large: true, largeThreshold: 2000,
  };
}

// prevSeries: array of {name, data} aligned by name to `series`
function makeLineOpt({ labels, series, prevSeries = [], cs, withZoom = false, yFormatter }) {
  const prevByName = Object.fromEntries(prevSeries.map(s => [s.name, s]));
  const allSeries = [
    ...series.map((s, i) => lineSeriesItem(s.name, s.data, i)),
    ...series
      .map((s, i) => {
        const p = prevByName[s.name];
        return p ? lineSeriesItemPrev(s.name, p.data, i) : null;
      })
      .filter(Boolean),
  ];
  return {
    backgroundColor: 'transparent', animation: false, color: COLORS,
    tooltip: { ...cs.tooltip, trigger: 'axis' },
    legend: {
      ...cs.legend, bottom: 28,
      // hide the '·prev' ghost entries from the legend
      formatter: name => name.endsWith('·prev') ? '' : name,
      data: series.map(s => s.name),
    },
    toolbox: cs.toolbox,
    ...(withZoom ? { dataZoom: cs.dataZoom } : {}),
    grid: { left: 54, right: 20, top: 40, bottom: withZoom ? 50 : 46 },
    xAxis: { type: 'category', boundaryGap: false, axisLabel: cs.axisLabel, axisLine: cs.axisLine, splitLine: cs.splitLineX, data: labels },
    yAxis: { type: 'value', min: 0, axisLabel: yFormatter ? { ...cs.axisLabel, formatter: yFormatter } : cs.axisLabel, axisLine: cs.axisLine, splitLine: cs.splitLine },
    series: allSeries,
  };
}

function makePieOpt({ data, cs, donut = false, labelFmt }) {
  return {
    backgroundColor: 'transparent', animation: false, color: COLORS,
    tooltip: { ...cs.tooltip, trigger: 'item', formatter: labelFmt ?? '{b}<br/>{c} ({d}%)' },
    legend: { ...cs.legend, bottom: 0 },
    series: [{
      type: 'pie',
      radius: donut ? ['38%', '68%'] : ['0%', '68%'],
      center: ['50%', '45%'],
      label: { color: cs.axisLabel.color, fontSize: 11, formatter: '{b}\n{d}%' },
      labelLine: { length: 10, length2: 8, lineStyle: { color: cs.axisLabel.color } },
      emphasis: { label: { fontSize: 13 } },
      data,
    }],
  };
}

function makeStackedBarOpt({ categories, series, cs, yMax = 100, yFmt = v => v + '%' }) {
  return {
    backgroundColor: 'transparent', animation: false,
    tooltip: { ...cs.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { ...cs.legend, bottom: 4 },
    toolbox: { ...cs.toolbox, feature: { saveAsImage: cs.toolbox.feature.saveAsImage } },
    grid: { left: 54, right: 20, top: 40, bottom: 44 },
    xAxis: { type: 'category', axisLabel: { ...cs.axisLabel, interval: 0, rotate: categories.length > 5 ? 12 : 0 }, axisLine: cs.axisLine, splitLine: cs.splitLineX, data: categories },
    yAxis: { type: 'value', min: 0, max: yMax, axisLabel: { ...cs.axisLabel, formatter: yFmt }, axisLine: cs.axisLine, splitLine: cs.splitLine },
    series: series.map(s => ({ type: 'bar', name: s.name, stack: 'a', data: s.data, itemStyle: { color: s.color, borderRadius: s.top ? [3,3,0,0] : [0,0,0,0] } })),
  };
}

function makeGroupedBarOpt({ categories, series, cs, yFormatter, tooltipFmt }) {
  return {
    backgroundColor: 'transparent', animation: false, color: COLORS,
    tooltip: { ...cs.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, ...(tooltipFmt ? { formatter: tooltipFmt } : {}) },
    legend: { ...cs.legend, bottom: 4, type: 'scroll' },
    toolbox: { ...cs.toolbox, feature: { saveAsImage: cs.toolbox.feature.saveAsImage } },
    grid: { left: 60, right: 20, top: 40, bottom: 50, containLabel: true },
    xAxis: { type: 'category', axisLabel: { ...cs.axisLabel, rotate: categories.length > 5 ? 14 : 0 }, axisLine: cs.axisLine, splitLine: cs.splitLineX, data: categories },
    yAxis: { type: 'value', min: 0, axisLabel: yFormatter ? { ...cs.axisLabel, formatter: yFormatter } : cs.axisLabel, axisLine: cs.axisLine, splitLine: cs.splitLine },
    series: series.map((s, i) => ({ type: 'bar', name: s.name, data: s.data, itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [3,3,0,0] } })),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, accent, sub, trend }) {
  return (
    <div className="ai-stat-card" style={accent ? { borderColor: accent + '55' } : {}}>
      <div className="ai-stat-label">{label}</div>
      <div className="ai-stat-value-row">
        <div className="ai-stat-value" style={accent ? { color: accent } : {}}>{value}</div>
        {trend && (
          <div className={`ai-stat-trend ${trend.up ? 'up' : 'down'}`}>
            {trend.up ? '↑' : '↓'}{Math.abs(trend.pct).toFixed(1)}%
          </div>
        )}
      </div>
      {sub && <div className="ai-stat-sub">{sub}</div>}
    </div>
  );
}

function Card({ title, children, empty, loading: spin, noPad, action }) {
  return (
    <div className="ai-chart-card">
      {title && (
        <div className="ai-chart-header">
          <span className="ai-chart-title">{title}</span>
          {action}
        </div>
      )}
      {spin    ? <div className="ai-chart-state">Loading…</div>
       : empty ? <div className="ai-chart-state muted">No data in range.</div>
       : noPad ? children
       : <div>{children}</div>}
    </div>
  );
}

function PBadge({ provider }) {
  return <span className="ai-provider-badge" data-provider={provider}>{provider}</span>;
}

// ── Prices modal ──────────────────────────────────────────────────────────────

function PricesModal({ onClose }) {
  const eff = effectivePrices();
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const [m, p] of Object.entries(DEFAULT_PRICES)) d[m] = { in: (eff[m] ?? p)[0], out: (eff[m] ?? p)[1] };
    return d;
  });

  function save() {
    const store = {};
    for (const [m, v] of Object.entries(draft)) {
      const def = DEFAULT_PRICES[m];
      if (!def || v.in !== def[0] || v.out !== def[1]) store[m] = [v.in, v.out];
    }
    if (Object.keys(store).length === 0) localStorage.removeItem(PRICES_KEY);
    else localStorage.setItem(PRICES_KEY, JSON.stringify(store));
    onClose();
  }

  function resetAll() {
    if (!confirm('Reset all prices to defaults?')) return;
    localStorage.removeItem(PRICES_KEY);
    const d = {};
    for (const [m, p] of Object.entries(DEFAULT_PRICES)) d[m] = { in: p[0], out: p[1] };
    setDraft(d);
  }

  return (
    <div className="ai-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ai-modal-panel">
        <button className="ai-modal-close" onClick={onClose}>✕</button>
        <h3 className="ai-modal-title">Model Pricing <span className="ai-modal-sub">$/1M tokens</span></h3>
        <p className="ai-modal-desc">Edits saved to browser. Used for cost estimation only.</p>
        <table className="ai-prices-table">
          <thead><tr><th>Model</th><th>Input $/1M</th><th>Output $/1M</th><th></th></tr></thead>
          <tbody>
            {Object.entries(DEFAULT_PRICES).map(([model, def]) => {
              const v   = draft[model] ?? { in: def[0], out: def[1] };
              const mod = v.in !== def[0] || v.out !== def[1];
              const set = (field) => (e) =>
                setDraft(d => ({ ...d, [model]: { ...d[model], [field]: parseFloat(e.target.value) || 0 } }));
              return (
                <tr key={model}>
                  <td>
                    <span className="ai-price-model">{model}</span>
                    {mod && <span className="ai-price-custom">custom</span>}
                  </td>
                  <td><input className={`ai-price-input${mod ? ' modified' : ''}`} type="number" step="0.01" min="0" value={v.in}  onChange={set('in')}  /></td>
                  <td><input className={`ai-price-input${mod ? ' modified' : ''}`} type="number" step="0.01" min="0" value={v.out} onChange={set('out')} /></td>
                  <td>{mod && <button className="ai-price-row-reset" onClick={() => { const d = DEFAULT_PRICES[model]; setDraft(dr => ({ ...dr, [model]: { in: d[0], out: d[1] } })); }}>↺</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="ai-modal-footer">
          <button className="ai-btn ai-btn-danger"  onClick={resetAll}>Reset All</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ai-btn ai-btn-ghost"   onClick={onClose}>Cancel</button>
            <button className="ai-btn ai-btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Errors modal ──────────────────────────────────────────────────────────────

function ErrorsModal({ errors, filter, onFilter, onClose }) {
  const models   = [...new Set(errors.map(e => e.model))].sort();
  const filtered = filter ? errors.filter(e => e.model === filter) : errors;

  return (
    <div className="ai-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ai-modal-panel ai-modal-errors">
        <button className="ai-modal-close" onClick={onClose}>✕</button>
        <h3 className="ai-modal-title">Error Log</h3>
        <div className="ai-errlog-filters">
          <button className={`ai-errlog-filter${!filter ? ' active' : ''}`} onClick={() => onFilter(null)}>All</button>
          {models.map(m => (
            <button key={m} className={`ai-errlog-filter${filter === m ? ' active' : ''}`} onClick={() => onFilter(m)}>{m}</button>
          ))}
        </div>
        <div className="ai-errlog-count">
          {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}{filter ? ` for ${filter}` : ''}
        </div>
        <div className="ai-errlog-list">
          {filtered.length === 0
            ? <div className="ai-error-no-msg" style={{ padding: '16px 0' }}>No errors recorded.</div>
            : filtered.map((e, i) => (
              <div key={i} className={`ai-errlog-entry${e.error_message ? ' has-msg' : ''}`}>
                <div className="ai-error-meta">
                  <PBadge provider={e.provider} />
                  <span className="ai-error-model">{e.model}</span>
                  {e.mode && <span className="ai-error-mode">{e.mode}</span>}
                  <span className="ai-error-time">{new Date(e.ts * 1000).toLocaleString()}</span>
                  {e.error_code && <span className="ai-error-code">#{e.error_code}</span>}
                </div>
                {e.error_message
                  ? <div className="ai-error-msg">{e.error_message}</div>
                  : <div className="ai-error-no-msg">No message</div>}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiMetricsPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const cs = useMemo(() => makeChartStyles(isDark), [isDark]);

  // Range state
  const [preset,   setPreset]   = useState(PRESETS[1]);
  const [liveMode, setLiveMode] = useState(true);
  const [cFrom,    setCFrom]    = useState(() => new Date(Date.now() - 86_400_000));
  const [cTo,      setCTo]      = useState(() => new Date());
  const [gran,     setGran]     = useState('hour');

  // Filters
  const [provider, setProvider] = useState('');
  const [model,    setModel]    = useState('');

  // Compare
  const [compareEnabled,    setCompareEnabled]    = useState(false);
  const [customCompareFrom, setCustomCompareFrom] = useState(null);
  const [showCustomDate,    setShowCustomDate]    = useState(false);

  // Data
  const [stats,       setStats]       = useState(null);
  const [prevStats,   setPrevStats]   = useState(null);
  const [errors,      setErrors]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastAt,      setLastAt]      = useState(null);
  const [dropModels,  setDropModels]  = useState([]);
  const [dropProvs,   setDropProvs]   = useState([]);

  // UI
  const [pricesOpen,     setPricesOpen]     = useState(false);
  const [priceTick,      setPriceTick]      = useState(0);
  const [errModalOpen,   setErrModalOpen]   = useState(false);
  const [errModelFilter, setErrModelFilter] = useState(null);

  function openErrorsFor(m = null) { setErrModelFilter(m); setErrModalOpen(true); }

  // Refs for interval closure
  const presetRef          = useRef(preset);
  const liveModeRef        = useRef(liveMode);
  const cFromRef           = useRef(cFrom);
  const cToRef             = useRef(cTo);
  const compareEnabledRef  = useRef(compareEnabled);
  const customCmpFromRef   = useRef(customCompareFrom);
  presetRef.current         = preset;
  liveModeRef.current       = liveMode;
  cFromRef.current          = cFrom;
  cToRef.current            = cTo;
  compareEnabledRef.current = compareEnabled;
  customCmpFromRef.current  = customCompareFrom;

  const fetchAll = useCallback(async (from, to) => {
    const timeParams = { from: from.toISOString(), to: to.toISOString(), granularity: gran };
    const dataParams = { ...timeParams };
    if (provider) dataParams.provider = provider;
    if (model)    dataParams.model    = model;
    const hasFilter = !!(provider || model);

    const calls = [
      client.get('/ai/stats',  { params: dataParams }),
      client.get('/ai/errors', { params: { ...dataParams, limit: 200 } }),
      ...(hasFilter ? [client.get('/ai/stats', { params: { ...timeParams, granularity: 'day' } })] : []),
    ];
    const [sr, er, ir] = await Promise.allSettled(calls);

    if (sr.status === 'fulfilled') setStats(sr.value.data);
    if (er.status === 'fulfilled') setErrors(er.value.data?.data ?? []);

    const idx = hasFilter ? ir : sr;
    if (idx?.status === 'fulfilled') {
      setDropModels((idx.value.data.models    ?? []).slice().sort());
      setDropProvs( (idx.value.data.providers ?? []).slice().sort());
    }
    setLastAt(new Date());
  }, [gran, provider, model]);

  const fetchPrevStats = useCallback(async (from, to) => {
    const params = { from: from.toISOString(), to: to.toISOString(), granularity: gran };
    if (provider) params.provider = provider;
    if (model)    params.model    = model;
    try {
      const { data } = await client.get('/ai/stats', { params });
      setPrevStats(data);
    } catch {}
  }, [gran, provider, model]);

  useEffect(() => {
    let alive = true, first = true;
    const run = async () => {
      const live = liveModeRef.current;
      const now  = new Date();
      const from = live ? new Date(now.getTime() - presetRef.current.ms) : cFromRef.current;
      const to   = live ? now : cToRef.current;
      if (first) { setLoading(true); first = false; }

      const dur = to.getTime() - from.getTime();
      const cmpEnabled = compareEnabledRef.current;

      await Promise.allSettled([
        fetchAll(from, to),
        ...(cmpEnabled ? (() => {
          const pf = customCmpFromRef.current ?? new Date(from.getTime() - dur);
          const pt = new Date(pf.getTime() + dur);
          return [fetchPrevStats(pf, pt)];
        })() : []),
      ]);

      if (!cmpEnabled) setPrevStats(null);
      if (alive) setLoading(false);
    };
    run();
    const id = setInterval(run, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [gran, provider, model, liveMode, preset, cFrom, cTo, compareEnabled, customCompareFrom, fetchAll, fetchPrevStats]);

  function applyPreset(p) {
    setPreset(p); setLiveMode(true);
    if (gran === 'minute' && p.ms / 86_400_000 >= 2) setGran('hour');
  }
  function applyCustom(from, to) {
    setCFrom(from); setCTo(to); setLiveMode(false);
    if (gran === 'minute' && (to - from) / 86_400_000 >= 2) setGran('hour');
  }

  // Derived range
  const now       = new Date();
  const rangeFrom = liveMode ? new Date(now.getTime() - preset.ms) : cFrom;
  const rangeTo   = liveMode ? now : cTo;
  const duration  = rangeTo.getTime() - rangeFrom.getTime();

  const prevFrom = compareEnabled
    ? (customCompareFrom ?? new Date(rangeFrom.getTime() - duration))
    : null;
  const prevTo = prevFrom ? new Date(prevFrom.getTime() + duration) : null;

  const comparePeriodLabel = prevFrom
    ? `vs ${fmtDateShort(prevFrom)} – ${fmtDateShort(prevTo)}`
    : '';

  // Derived current data
  const rawData   = stats?.data          ?? [];
  const modeBkdn  = stats?.mode_breakdown ?? [];
  const allModels = (stats?.models    ?? []).slice().sort();
  const summary   = stats?.summary ?? {};

  const grid    = makeGrid(rangeFrom, rangeTo, gran);
  const mTotals = modelTotals(rawData);
  const modRows = modeTotals(modeBkdn);

  const totReq  = Number(summary.total_requests        ?? 0);
  const totErr  = Number(summary.total_errors          ?? 0);
  const totIn   = Number(summary.total_input_tokens    ?? 0);
  const totOut  = Number(summary.total_output_tokens   ?? 0);
  const totThk  = Number(summary.total_thinking_tokens ?? 0);
  const totDurS = Number(summary.total_duration_ms_sum ?? 0);
  const totDurC = Number(summary.total_duration_count  ?? 0);
  const avgRt   = totDurC > 0 ? Math.round(totDurS / totDurC) : null;

  let totalCost = 0, costKnown = false;
  for (const m of mTotals) {
    const c = calcCost(m.model, m.input, m.output, m.thinking);
    if (c !== null) { totalCost += c; costKnown = true; }
  }

  // Derived previous data
  const prevSummary = prevStats?.summary ?? {};
  const prevRawData = prevStats?.data    ?? [];
  const prevGrid    = useMemo(
    () => (compareEnabled && prevFrom && prevTo) ? makeGrid(prevFrom, prevTo, gran) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareEnabled, prevFrom?.getTime(), prevTo?.getTime(), gran]
  );

  // Deltas for StatCards
  const reqTrend    = calcDelta(totReq, prevSummary.total_requests,        compareEnabled && !!prevStats);
  const inTrend     = calcDelta(totIn,  prevSummary.total_input_tokens,    compareEnabled && !!prevStats);
  const outTrend    = calcDelta(totOut, prevSummary.total_output_tokens,   compareEnabled && !!prevStats);
  const thkTrend    = calcDelta(totThk, prevSummary.total_thinking_tokens, compareEnabled && !!prevStats);
  const errTrend    = calcDelta(totErr, prevSummary.total_errors,          compareEnabled && !!prevStats);

  let prevTotalCost = 0, prevCostKnown = false;
  const prevMTotals = useMemo(() => modelTotals(prevRawData), [prevRawData]);
  for (const m of prevMTotals) {
    const c = calcCost(m.model, m.input, m.output, m.thinking);
    if (c !== null) { prevTotalCost += c; prevCostKnown = true; }
  }
  const costTrend = calcDelta(totalCost, prevCostKnown ? prevTotalCost : null, compareEnabled && !!prevStats && costKnown && prevCostKnown);

  const prevAvgRtDurS = Number(prevSummary.total_duration_ms_sum ?? 0);
  const prevAvgRtDurC = Number(prevSummary.total_duration_count  ?? 0);
  const prevAvgRt     = prevAvgRtDurC > 0 ? Math.round(prevAvgRtDurS / prevAvgRtDurC) : null;
  const rtTrend       = calcDelta(avgRt, prevAvgRt, compareEnabled && !!prevStats && avgRt !== null && prevAvgRt !== null);

  const hasThk  = totThk > 0;
  const isEmpty = rawData.length === 0;
  const prices  = effectivePrices();
  const spin    = loading && !stats;

  // ── Current period pivots ─────────────────────────────────────────────────

  const reqPivot  = useMemo(() => pivotByModel(rawData, grid, allModels, gran, 'requests'), [rawData, grid, allModels, gran]);
  const errPivot  = useMemo(() => pivotByModel(rawData, grid, allModels, gran, 'errors'),   [rawData, grid, allModels, gran]);
  const tokPivot  = useMemo(() => pivotTokens(rawData, grid, gran),                         [rawData, grid, gran]);
  const costPivot = useMemo(() => pivotCostByModel(rawData, grid, allModels, gran),         [rawData, grid, allModels, gran, priceTick]);

  // ── Previous period pivots ────────────────────────────────────────────────

  const prevReqPivot  = useMemo(() => compareEnabled && prevGrid.length ? pivotByModel(prevRawData, prevGrid, allModels, gran, 'requests') : null, [compareEnabled, prevRawData, prevGrid, allModels, gran]);
  const prevErrPivot  = useMemo(() => compareEnabled && prevGrid.length ? pivotByModel(prevRawData, prevGrid, allModels, gran, 'errors')   : null, [compareEnabled, prevRawData, prevGrid, allModels, gran]);
  const prevTokPivot  = useMemo(() => compareEnabled && prevGrid.length ? pivotTokens(prevRawData, prevGrid, gran)                         : null, [compareEnabled, prevRawData, prevGrid, gran]);
  const prevCostPivot = useMemo(() => compareEnabled && prevGrid.length ? pivotCostByModel(prevRawData, prevGrid, allModels, gran)          : null, [compareEnabled, prevRawData, prevGrid, allModels, gran, priceTick]);

  // ── Chart options ─────────────────────────────────────────────────────────

  const reqOpt = useMemo(() => makeLineOpt({
    labels: reqPivot.labels, series: reqPivot.series,
    prevSeries: prevReqPivot?.series ?? [],
    cs, withZoom: true,
  }), [reqPivot, prevReqPivot, cs]);

  const tokOpt = useMemo(() => makeLineOpt({
    labels: tokPivot.labels,
    series: [
      { name: 'Input',    data: tokPivot.input    },
      { name: 'Output',   data: tokPivot.output   },
      ...(hasThk ? [{ name: 'Thinking', data: tokPivot.thinking }] : []),
    ],
    prevSeries: prevTokPivot ? [
      { name: 'Input',    data: prevTokPivot.input    },
      { name: 'Output',   data: prevTokPivot.output   },
      ...(hasThk ? [{ name: 'Thinking', data: prevTokPivot.thinking }] : []),
    ] : [],
    cs, withZoom: true,
    yFormatter: v => v >= 1000 ? (v/1000).toFixed(0)+'k' : String(v),
  }), [tokPivot, prevTokPivot, hasThk, cs]);

  const errOpt = useMemo(() => makeLineOpt({
    labels: errPivot.labels, series: errPivot.series,
    prevSeries: prevErrPivot?.series ?? [],
    cs, withZoom: true,
  }), [errPivot, prevErrPivot, cs]);

  const costTimeOpt = useMemo(() => {
    if (!costPivot.series.length) return null;
    return makeLineOpt({
      labels: costPivot.labels, series: costPivot.series,
      prevSeries: prevCostPivot?.series ?? [],
      cs, withZoom: true,
      yFormatter: v => v === 0 ? '$0' : v < 0.01 ? '$'+v.toFixed(4) : '$'+v.toFixed(3),
    });
  }, [costPivot, prevCostPivot, cs]);

  const pieTokenModel = useMemo(() =>
    mTotals.map(m => ({ name: m.model, value: m.input + m.output + m.thinking })).filter(d => d.value > 0),
    [mTotals]
  );
  const pieCostModel = useMemo(() =>
    mTotals.map(m => ({ name: m.model, value: calcCost(m.model, m.input, m.output, m.thinking) ?? 0 })).filter(d => d.value > 0).sort((a,b)=>b.value-a.value),
    [mTotals, priceTick]
  );
  const pieModeTokens = useMemo(() =>
    modRows.map(m => ({ name: m.mode, value: m.input + m.output + m.thinking })).filter(d => d.value > 0),
    [modRows]
  );

  const pieTokenModelOpt = useMemo(() => makePieOpt({ data: pieTokenModel, cs, donut: true, labelFmt: p => `${p.data.name}<br/>${fmtNum(p.data.value)} (${p.percent}%)` }), [pieTokenModel, cs]);
  const pieCostModelOpt  = useMemo(() => makePieOpt({ data: pieCostModel,  cs, donut: true, labelFmt: p => `${p.data.name}<br/>${fmtCost(p.data.value)} (${p.percent}%)` }), [pieCostModel,  cs]);
  const pieModeOpt       = useMemo(() => makePieOpt({ data: pieModeTokens, cs }), [pieModeTokens, cs]);

  const stackOutThk = useMemo(() =>
    mTotals.filter(m => m.output + m.thinking > 0).map(m => {
      const tot = m.output + m.thinking;
      return { model: m.model, out: +(m.output/tot*100).toFixed(1), thk: +(m.thinking/tot*100).toFixed(1) };
    }), [mTotals]
  );
  const stackSuccErr = useMemo(() =>
    mTotals.filter(m => m.requests > 0).map(m => ({
      model: m.model,
      ok:  +((m.requests - m.errors)/m.requests*100).toFixed(1),
      err: +(m.errors/m.requests*100).toFixed(1),
    })), [mTotals]
  );

  const outThkOpt = useMemo(() => makeStackedBarOpt({
    categories: stackOutThk.map(d => d.model), cs,
    series: [
      { name: 'Output %',   data: stackOutThk.map(d => d.out), color: '#60a5fa', top: false },
      { name: 'Thinking %', data: stackOutThk.map(d => d.thk), color: '#f472b6', top: true  },
    ],
  }), [stackOutThk, cs]);

  const succErrOpt = useMemo(() => makeStackedBarOpt({
    categories: stackSuccErr.map(d => d.model), cs,
    series: [
      { name: 'Success %', data: stackSuccErr.map(d => d.ok),  color: '#22c55e', top: false },
      { name: 'Error %',   data: stackSuccErr.map(d => d.err), color: '#ef4444', top: true  },
    ],
  }), [stackSuccErr, cs]);

  const rtModeList = useMemo(() =>
    [...new Set(modeBkdn.filter(r => Number(r.duration_count) > 0).map(r => r.mode))].sort(),
    [modeBkdn]
  );
  const rtOpt = useMemo(() => {
    if (!rtModeList.length) return null;
    const series = allModels.map(m => ({
      name: m,
      data: rtModeList.map(mode => {
        const r = modeBkdn.find(x => x.mode === mode && x.model === m && Number(x.duration_count) > 0);
        return r ? Math.round(Number(r.duration_ms_sum) / Number(r.duration_count)) : 0;
      }),
    }));
    return makeGroupedBarOpt({
      categories: rtModeList, series, cs,
      yFormatter: v => v >= 1000 ? (v/1000).toFixed(1)+'s' : v+'ms',
      tooltipFmt: params => {
        const lines = params.filter(p => p.value > 0).map(p =>
          `${p.marker}${p.seriesName}: ${p.value >= 1000 ? (p.value/1000).toFixed(2)+'s' : p.value+'ms'}`);
        return `<b>${params[0]?.axisValue}</b><br/>${lines.join('<br/>')}`;
      },
    });
  }, [rtModeList, allModels, modeBkdn, cs]);

  const avgTokOpt = useMemo(() => {
    const rows = mTotals.filter(m => m.requests > 0);
    if (!rows.length) return null;
    return makeGroupedBarOpt({
      categories: rows.map(m => m.model),
      series: [
        { name: 'Avg Input',    data: rows.map(m => Math.round(m.input    / m.requests)) },
        { name: 'Avg Output',   data: rows.map(m => Math.round(m.output   / m.requests)) },
        ...(hasThk ? [{ name: 'Avg Thinking', data: rows.map(m => Math.round(m.thinking / m.requests)) }] : []),
      ],
      cs,
      yFormatter: v => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(v),
    });
  }, [mTotals, hasThk, cs]);

  return (
    <div className="ai-page">

      {/* ── Header ── */}
      <div className="ai-top-header">
        <div>
          <h1 className="page-title">AI Metrics</h1>
          <p className="page-sub">
            {!stats && loading ? 'Loading…' : `${totReq.toLocaleString()} requests · ${totErr.toLocaleString()} errors`}
          </p>
        </div>
        <div className="ai-header-right">
          {lastAt && (
            <span className="ai-last-updated">
              <span className="ai-live-dot" />
              {lastAt.toLocaleTimeString()}
            </span>
          )}
          {errors.length > 0 && (
            <button className="ai-btn ai-btn-err" onClick={() => openErrorsFor(null)}>
              ⚠ {errors.length} error{errors.length > 1 ? 's' : ''}
            </button>
          )}
          <button className="ai-btn ai-btn-ghost" onClick={() => setPricesOpen(true)}>💰 Model Prices</button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="ai-filters">
        <div className="ai-gran-group">
          {PRESETS.map(p => (
            <button key={p.label}
              className={`ai-gran-btn${liveMode && preset === p ? ' active' : ''}`}
              onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
          <button className={`ai-gran-btn${!liveMode ? ' active' : ''}`} onClick={() => setLiveMode(false)}>Custom</button>
        </div>

        {!liveMode && (
          <div className="ai-date-range">
            <div className="ai-date-field">
              <label className="ai-date-label">From</label>
              <input type="datetime-local" className="ai-date-input" value={toDatetimeLocal(cFrom)}
                onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) applyCustom(d, cTo); }} />
            </div>
            <span className="ai-date-sep">→</span>
            <div className="ai-date-field">
              <label className="ai-date-label">To</label>
              <input type="datetime-local" className="ai-date-input" value={toDatetimeLocal(cTo)}
                onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) applyCustom(cFrom, d); }} />
            </div>
          </div>
        )}

        <div className="ai-gran-group">
          {GRANS.map(g => {
            const diffDays = (liveMode ? preset.ms : (cTo - cFrom)) / 86_400_000;
            const ok = g.value !== 'minute' || diffDays < 2;
            return (
              <button key={g.value}
                className={`ai-gran-btn${gran === g.value ? ' active' : ''}${!ok ? ' disabled' : ''}`}
                onClick={() => ok && setGran(g.value)} disabled={!ok}>{g.label}</button>
            );
          })}
        </div>

        <div className="ai-filter-selects">
          {dropProvs.length > 1 && (
            <select className="ai-select" value={provider} onChange={e => { setProvider(e.target.value); setModel(''); }}>
              <option value="">All providers</option>
              {dropProvs.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <select className="ai-select" value={model} onChange={e => setModel(e.target.value)}>
            <option value="">All models</option>
            {dropModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Compare toggle */}
        <div className="ai-compare-group">
          <button
            className={`ai-compare-btn${compareEnabled ? ' active' : ''}`}
            onClick={() => { setCompareEnabled(v => !v); setShowCustomDate(false); setCustomCompareFrom(null); }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" strokeWidth="1.5" stroke="currentColor">
              <path d="M1 7h5M8 7h5M4 4l-3 3 3 3M10 4l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Compare
          </button>

          {compareEnabled && (
            <div className="ai-compare-period">
              <span className="ai-compare-label">{comparePeriodLabel}</span>
              <button className="ai-compare-custom-btn" onClick={() => setShowCustomDate(v => !v)}>
                {customCompareFrom ? 'Custom ✓' : 'Custom'}
              </button>
              {customCompareFrom && (
                <button className="ai-compare-reset" onClick={() => { setCustomCompareFrom(null); setShowCustomDate(false); }}>✕</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Custom compare date */}
      {compareEnabled && showCustomDate && (
        <div className="ai-custom-compare">
          <label className="ai-date-label">Compare period start</label>
          <input type="datetime-local" className="ai-date-input"
            value={toDatetimeLocal(customCompareFrom ?? prevFrom)}
            onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) setCustomCompareFrom(d); }} />
          <span className="ai-date-label" style={{ alignSelf: 'center' }}>
            → {fmtDateShort(prevTo)} (same length)
          </span>
        </div>
      )}

      {/* ── Active models in period ── */}
      {allModels.length > 0 && (
        <div className="ai-active-models">
          <span className="ai-active-models-label">Active in period:</span>
          {allModels.map((m, i) => (
            <span key={m} className="ai-model-chip" style={{ background: COLORS[i % COLORS.length] + '22', borderColor: COLORS[i % COLORS.length] + '66', color: COLORS[i % COLORS.length] }}>
              {m}
            </span>
          ))}
        </div>
      )}

      {/* ── Summary cards ── */}
      <div className="ai-stat-grid">
        <StatCard label="Requests"          value={fmtNum(totReq)}  trend={reqTrend} />
        <StatCard label="Input Tokens"      value={fmtNum(totIn)}   trend={inTrend} />
        <StatCard label="Output Tokens"     value={fmtNum(totOut)}  trend={outTrend} />
        {hasThk && <StatCard label="Thinking Tokens" value={fmtNum(totThk)} trend={thkTrend} />}
        <StatCard label="Total Tokens"      value={fmtNum(totIn + totOut + totThk)} />
        <StatCard label="Errors" accent="#ef4444" value={fmtNum(totErr)} trend={errTrend}
          sub={totReq > 0 ? `${(totErr/totReq*100).toFixed(1)}% rate` : undefined} />
        <StatCard label="Active Models"     value={String(allModels.length)} />
        <StatCard label="Avg Response Time" value={fmtMs(avgRt)}    trend={rtTrend} />
        {costKnown && <StatCard label="Est. Total Cost" accent="#10b981" value={fmtCost(totalCost)} trend={costTrend} />}
      </div>

      {/* ── Requests over time ── */}
      <Card title={`Requests over time${compareEnabled ? ' — ' + comparePeriodLabel : ''}`} loading={spin} empty={isEmpty}>
        <EChart option={reqOpt} style={{ height: 300 }} onChartReady={activateDragZoom} />
      </Card>

      {/* ── Token usage over time ── */}
      <Card title={`Token usage over time${compareEnabled ? ' — ' + comparePeriodLabel : ''}`} loading={spin} empty={isEmpty}>
        <EChart option={tokOpt} style={{ height: 280 }} onChartReady={activateDragZoom} />
      </Card>

      {/* ── 3 pies ── */}
      <div className="ai-charts-3col">
        <Card title="Token distribution by model" loading={spin} empty={pieTokenModel.length === 0}>
          <EChart option={pieTokenModelOpt} style={{ height: 280 }} />
        </Card>
        <Card title="Cost distribution by model" loading={spin} empty={pieCostModel.length === 0}>
          <EChart option={pieCostModelOpt} style={{ height: 280 }} />
        </Card>
        <Card title="Token distribution by mode" loading={spin} empty={pieModeTokens.length === 0}>
          <EChart option={pieModeOpt} style={{ height: 280 }} />
        </Card>
      </div>

      {/* ── Stacked bars ── */}
      <div className="ai-charts-row">
        <Card title="Output vs Thinking split" loading={spin} empty={!hasThk || stackOutThk.length === 0}>
          <EChart option={outThkOpt} style={{ height: 240 }} />
        </Card>
        <Card title="Success vs Error rate" loading={spin} empty={stackSuccErr.length === 0}>
          <EChart option={succErrOpt} style={{ height: 240 }} />
        </Card>
      </div>

      {/* ── Avg RT ── */}
      {rtOpt && (
        <Card title="Avg response time by model & mode" loading={spin} empty={rtModeList.length === 0}>
          <EChart option={rtOpt} style={{ height: 260 }} />
        </Card>
      )}

      {/* ── Avg tokens per request ── */}
      {avgTokOpt && (
        <Card title="Avg tokens per request by model" loading={spin} empty={mTotals.length === 0}>
          <EChart option={avgTokOpt} style={{ height: 240 }} />
        </Card>
      )}

      {/* ── Cost over time ── */}
      {costTimeOpt && (
        <Card title={`Estimated cost over time${compareEnabled ? ' — ' + comparePeriodLabel : ''}`} loading={spin} empty={isEmpty}>
          <EChart option={costTimeOpt} style={{ height: 280 }} onChartReady={activateDragZoom} />
        </Card>
      )}

      {/* ── Errors over time ── */}
      <div className="ai-charts-row">
        <Card title={`Errors over time${compareEnabled ? ' — ' + comparePeriodLabel : ''}`} loading={spin} empty={isEmpty}>
          <EChart option={errOpt} style={{ height: 240 }} onChartReady={activateDragZoom} />
        </Card>

        <Card title={`Recent errors (${errors.length})`} loading={spin} empty={errors.length === 0} noPad
          action={errors.length > 0 ? <button className="ai-btn ai-btn-ghost ai-btn-sm" onClick={() => openErrorsFor(null)}>View all</button> : null}>
          <div className="ai-error-list">
            {errors.slice(0, 30).map((e, i) => (
              <div key={i} className={`ai-error-entry${e.error_message ? ' has-msg' : ''}`}>
                <div className="ai-error-meta">
                  <PBadge provider={e.provider} />
                  <span className="ai-error-model">{e.model}</span>
                  {e.mode && <span className="ai-error-mode">{e.mode}</span>}
                  <span className="ai-error-time">{new Date(e.ts * 1000).toLocaleTimeString()}</span>
                  {e.error_code && <span className="ai-error-code">#{e.error_code}</span>}
                </div>
                {e.error_message
                  ? <div className="ai-error-msg">{e.error_message}</div>
                  : <div className="ai-error-no-msg">No message</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Pricing by mode table ── */}
      {modRows.length > 0 && (
        <Card title="Pricing by generation mode">
          <div className="ai-table-wrap">
            <table className="ai-table">
              <thead>
                <tr>
                  <th>Mode</th><th>Input Tokens</th><th>Output Tokens</th>
                  {hasThk && <th>Thinking Tokens</th>}
                  <th>Total Tokens</th><th>Avg RT</th><th>Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {modRows.map((m, i) => {
                  const rt = m.durCnt > 0 ? Math.round(m.durSum / m.durCnt) : null;
                  let mc = 0, mcKnown = false;
                  for (const r of m.rows) {
                    const c = calcCost(r.model, r.input_tokens, r.output_tokens, r.thinking_tokens);
                    if (c !== null) { mc += c; mcKnown = true; }
                  }
                  return (
                    <tr key={i}>
                      <td><span className="ai-mode-badge">{m.mode}</span></td>
                      <td>{fmtNum(m.input)}</td><td>{fmtNum(m.output)}</td>
                      {hasThk && <td>{fmtNum(m.thinking)}</td>}
                      <td>{fmtNum(m.input + m.output + m.thinking)}</td>
                      <td>{fmtMs(rt)}</td>
                      <td className="ai-cost-cell">{mcKnown ? fmtCost(mc) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Per-model cost & usage table ── */}
      {mTotals.length > 0 && (
        <Card title="Cost & usage per model">
          <div className="ai-table-wrap">
            <table className="ai-table">
              <thead>
                <tr>
                  <th>Provider</th><th>Model</th><th>Requests</th><th>Errors</th>
                  <th>Input Tokens</th><th>Output Tokens</th>{hasThk && <th>Think Tokens</th>}
                  <th>Avg Input/req</th><th>Avg Output/req</th>
                  <th>Avg RT</th><th>Input $/1M</th><th>Output $/1M</th><th>Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {mTotals.map((m, i) => {
                  const rt   = m.durCnt > 0 ? Math.round(m.durSum / m.durCnt) : null;
                  const cost = calcCost(m.model, m.input, m.output, m.thinking);
                  const p    = prices[m.model];
                  const req  = m.requests || 1;
                  return (
                    <tr key={i}>
                      <td><PBadge provider={m.provider} /></td>
                      <td className="ai-model-name">{m.model}</td>
                      <td>{m.requests.toLocaleString()}</td>
                      <td className={m.errors > 0 ? 'ai-err-cell' : ''}>{m.errors.toLocaleString()}</td>
                      <td>{fmtNum(m.input)}</td>
                      <td>{fmtNum(m.output)}</td>
                      {hasThk && <td>{fmtNum(m.thinking)}</td>}
                      <td className="ai-dim-cell">{fmtNum(Math.round(m.input   / req))}</td>
                      <td className="ai-dim-cell">{fmtNum(Math.round(m.output  / req))}</td>
                      <td>{fmtMs(rt)}</td>
                      <td className="ai-dim-cell">{p ? `$${p[0]}` : '—'}</td>
                      <td className="ai-dim-cell">{p ? `$${p[1]}` : '—'}</td>
                      <td className="ai-cost-cell">{fmtCost(cost)}</td>
                    </tr>
                  );
                })}
                <tr className="ai-totals-row">
                  <td colSpan={2}><strong>Total</strong></td>
                  <td><strong>{totReq.toLocaleString()}</strong></td>
                  <td className={totErr > 0 ? 'ai-err-cell' : ''}><strong>{totErr.toLocaleString()}</strong></td>
                  <td><strong>{fmtNum(totIn)}</strong></td>
                  <td><strong>{fmtNum(totOut)}</strong></td>
                  {hasThk && <td><strong>{fmtNum(totThk)}</strong></td>}
                  <td className="ai-dim-cell">{totReq > 0 ? fmtNum(Math.round(totIn  / totReq)) : '—'}</td>
                  <td className="ai-dim-cell">{totReq > 0 ? fmtNum(Math.round(totOut / totReq)) : '—'}</td>
                  <td><strong>{fmtMs(avgRt)}</strong></td>
                  <td>—</td><td>—</td>
                  <td className="ai-cost-cell"><strong>{costKnown ? fmtCost(totalCost) : '—'}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pricesOpen && <PricesModal onClose={() => { setPricesOpen(false); setPriceTick(t => t + 1); }} />}
      {errModalOpen && (
        <ErrorsModal errors={errors} filter={errModelFilter} onFilter={setErrModelFilter} onClose={() => setErrModalOpen(false)} />
      )}
    </div>
  );
}
