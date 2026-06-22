import { useState, useEffect, useCallback, useMemo } from 'react';
import EChart from '../components/EChart';
import client from '../api/client';
import { useTheme } from '../hooks/useTheme';
import './PlpgPage.css';

const GRANULARITIES = [
  { value: 'hour',  label: 'Hour' },
  { value: 'day',   label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year',  label: 'Year' },
];

const SOURCE_COLORS = ['#6772e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const fmt          = n => Number(n).toLocaleString();
const pct          = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—';
const fmtDateShort = d => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

// ── Granularity helpers ───────────────────────────────────────────────────────

function granularityEnabled(g, from, to) {
  const diffDays = (to - from) / 86400000;
  if (g === 'hour') return diffDays < 2;
  if (g === 'day')  return diffDays / 30 <= 4;
  return true;
}

function coerceGranularity(current, from, to) {
  if (granularityEnabled(current, from, to)) return current;
  return ['hour', 'day', 'month', 'year'].find(g => granularityEnabled(g, from, to)) ?? 'month';
}

function formatBucketLabel(ts, granularity) {
  const d = new Date(ts * 1000);
  if (granularity === 'hour')  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', hour12: false });
  if (granularity === 'day')   return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (granularity === 'month') return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  return String(d.getUTCFullYear());
}

function toDatetimeLocal(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function truncateUTC(date, granularity) {
  const d = new Date(date);
  if (granularity === 'hour')  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  if (granularity === 'day')   return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (granularity === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

function advanceUTC(date, granularity) {
  const d = new Date(date);
  if (granularity === 'hour')  { d.setUTCHours(d.getUTCHours() + 1); return d; }
  if (granularity === 'day')   { d.setUTCDate(d.getUTCDate() + 1); return d; }
  if (granularity === 'month') { d.setUTCMonth(d.getUTCMonth() + 1); return d; }
  d.setUTCFullYear(d.getUTCFullYear() + 1); return d;
}

function generateGrid(from, to, granularity) {
  const tsList = [];
  let cur = truncateUTC(from, granularity);
  while (cur <= to) { tsList.push(cur.getTime() / 1000); cur = advanceUTC(cur, granularity); }
  return tsList;
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function shiftPrev(prevBuckets, durationMs) {
  const dSec = Math.round(durationMs / 1000);
  return prevBuckets.map(b => ({ ...b, ts: b.ts + dSec }));
}

// Returns { labels, series: [{name,data}], prevSeries: [{name,data}] }
function buildUsageSeries(buckets, prevBuckets, granularity, from, to, sources, metricKey, prevMetricKey) {
  const grid = generateGrid(from, to, granularity);
  const cur  = new Map(grid.map(ts => [ts, {}]));
  const prev = new Map(grid.map(ts => [ts, {}]));

  for (const b of buckets) {
    if (cur.has(b.ts)) cur.get(b.ts)[b.source] = Number(b[metricKey] ?? b.count);
  }
  for (const b of prevBuckets) {
    if (prev.has(b.ts)) prev.get(b.ts)[b.source] = Number(b[metricKey] ?? b.count);
  }

  const labels = grid.map(ts => formatBucketLabel(ts, granularity));
  const series = sources.map(src => ({
    name: src,
    data: grid.map(ts => cur.get(ts)?.[src] ?? 0),
  }));
  const prevSeries = prevBuckets.length > 0
    ? sources.map(src => ({
        name: src,
        data: grid.map(ts => prev.get(ts)?.[src] ?? null),
      }))
    : [];

  return { labels, series, prevSeries };
}

function buildClaimsSeries(claims, prevClaims, granularity, from, to, sources, metricKey) {
  const grid = generateGrid(from, to, granularity);
  const cur  = new Map(grid.map(ts => [ts, {}]));
  const prev = new Map(grid.map(ts => [ts, {}]));

  for (const b of claims) {
    const src = b.source || 'unattributed';
    if (cur.has(b.ts)) cur.get(b.ts)[src] = Number(b[metricKey] ?? b.count);
  }
  for (const b of prevClaims) {
    const src = b.source || 'unattributed';
    if (prev.has(b.ts)) prev.get(b.ts)[src] = Number(b[metricKey] ?? b.count);
  }

  const claimSources = sources.length > 0 ? sources : ['unattributed'];
  const labels = grid.map(ts => formatBucketLabel(ts, granularity));
  const series = claimSources.map(src => ({
    name: src,
    data: grid.map(ts => cur.get(ts)?.[src] ?? 0),
  }));
  const prevSeries = prevClaims.length > 0
    ? claimSources.map(src => ({
        name: src,
        data: grid.map(ts => prev.get(ts)?.[src] ?? null),
      }))
    : [];

  return { labels, series, prevSeries };
}

function computeRoi(usageBuckets, claimBuckets) {
  const roi = {};
  for (const b of usageBuckets) {
    const src = b.source || 'unattributed';
    if (!roi[src]) roi[src] = { source: src, gens: 0, uniqueGens: 0, claims: 0, uniqueClaimers: 0 };
    roi[src].gens       += Number(b.count);
    roi[src].uniqueGens += Number(b.unique_users ?? 0);
  }
  for (const b of claimBuckets) {
    const src = b.source || 'unattributed';
    if (!roi[src]) roi[src] = { source: src, gens: 0, uniqueGens: 0, claims: 0, uniqueClaimers: 0 };
    roi[src].claims         += Number(b.count);
    roi[src].uniqueClaimers += Number(b.unique_claimers ?? 0);
  }
  return Object.values(roi).sort((a, b) => b.gens - a.gens);
}

// ── ECharts helpers ───────────────────────────────────────────────────────────

function makeChartStyles(isDark) {
  const axisLabel  = { color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 };
  const axisLine   = { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } };
  const splitLine  = { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)' } };
  const splitLineX = { show: false };
  const tooltip    = {
    backgroundColor: isDark ? '#1e293b' : '#fff',
    borderColor:     isDark ? '#334155' : '#e2e8f0',
    textStyle: { color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
  };
  const legend  = { textStyle: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }, type: 'scroll' };
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
  const dataZoom = [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }];
  return { axisLabel, axisLine, splitLine, splitLineX, tooltip, legend, toolbox, dataZoom };
}

const activateDragZoom = chart =>
  chart.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: true });

function lineSeriesItem(name, data, idx) {
  const color = SOURCE_COLORS[idx % SOURCE_COLORS.length];
  return {
    type: 'line', name, smooth: 0.3, symbolSize: 4, data,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    areaStyle: { color: color + '18', origin: 'start' },
    large: true, largeThreshold: 2000,
  };
}

function lineSeriesItemPrev(name, data, idx) {
  const color = SOURCE_COLORS[idx % SOURCE_COLORS.length];
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

function makePlpgLineOpt({ labels, series, prevSeries = [], cs, compareEnabled = false, height = 260 }) {
  const prevByName = Object.fromEntries(prevSeries.map(s => [s.name, s]));

  const tooltipFormatter = compareEnabled ? params => {
    const label = params[0]?.axisValue ?? '';
    const curMap = {}, prevMap = {};
    for (const p of params) {
      const isPrev = p.seriesName.endsWith(' ·prev');
      const src    = isPrev ? p.seriesName.slice(0, -6) : p.seriesName;
      if (isPrev) prevMap[src] = p.value;
      else        curMap[src]  = { value: p.value, color: p.color };
    }
    const rows = Object.entries(curMap).map(([src, cur]) => {
      const prev  = prevMap[src];
      let deltaHtml = '';
      if (prev != null && prev !== 0 && cur.value != null) {
        const d     = ((cur.value - prev) / prev * 100).toFixed(1);
        const up    = Number(d) >= 0;
        const clr   = up ? '#10b981' : '#ef4444';
        deltaHtml   = ` <span style="color:${clr};font-size:11px">${up ? '↑' : '↓'}${Math.abs(d)}%</span>`;
      }
      const prevStr = prev != null ? `<span style="color:#94a3b8;font-size:11px"> vs ${Number(prev).toLocaleString()}${deltaHtml}</span>` : '';
      return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0">
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${cur.color};flex-shrink:0"></span>
        <span style="flex:1">${src}</span>
        <strong>${(cur.value ?? 0).toLocaleString()}</strong>${prevStr}
      </div>`;
    }).join('');
    return `<div style="font-size:12px;min-width:160px">
      <div style="color:#94a3b8;font-size:11px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(128,128,128,.2)">${label}</div>
      ${rows}
    </div>`;
  } : undefined;

  const bottom = height > 220 ? 50 : 40;

  return {
    backgroundColor: 'transparent', animation: false, color: SOURCE_COLORS,
    tooltip: {
      ...cs.tooltip, trigger: 'axis',
      ...(tooltipFormatter ? { formatter: tooltipFormatter } : {}),
    },
    legend: {
      ...cs.legend, bottom: bottom - 14,
      data: series.map(s => s.name),
    },
    toolbox: cs.toolbox,
    dataZoom: cs.dataZoom,
    grid: { left: 54, right: 20, top: 40, bottom },
    xAxis: { type: 'category', boundaryGap: false, axisLabel: cs.axisLabel, axisLine: cs.axisLine, splitLine: cs.splitLineX, data: labels },
    yAxis: { type: 'value', min: 0, axisLabel: cs.axisLabel, axisLine: cs.axisLine, splitLine: cs.splitLine },
    series: [
      ...series.map((s, i) => lineSeriesItem(s.name, s.data, i)),
      ...series
        .map((s, i) => {
          const p = prevByName[s.name];
          return p ? lineSeriesItemPrev(s.name, p.data, i) : null;
        })
        .filter(Boolean),
    ],
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricToggle({ value, onChange }) {
  return (
    <div className="plpg-metric-toggle">
      <button className={value === 'total'  ? 'active' : ''} onClick={() => onChange('total')}>Total</button>
      <button className={value === 'unique' ? 'active' : ''} onClick={() => onChange('unique')}>Unique</button>
    </div>
  );
}

function PlpgIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="13" cy="13" r="11.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="13" r="8"    stroke="currentColor" strokeWidth="1"   opacity=".45" />
      <circle cx="13" cy="13" r="4.5"  stroke="currentColor" strokeWidth="1"   opacity=".3"  />
      <circle cx="13" cy="13" r="1.8"  fill="currentColor" />
      <path d="M13 3v2.5M13 20.5V23M3 13h2.5M20.5 13H23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13" cy="3"  r=".9" fill="currentColor" opacity=".55" />
      <circle cx="13" cy="23" r=".9" fill="currentColor" opacity=".55" />
      <circle cx="3"  cy="13" r=".9" fill="currentColor" opacity=".55" />
      <circle cx="23" cy="13" r=".9" fill="currentColor" opacity=".55" />
      <path d="M7.5 7.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 7.5l-1.8 1.8M9.3 16.7l-1.8 1.8"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday()   { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }

export default function PlpgPage() {
  const { theme } = useTheme();
  const isDark    = theme === 'dark';
  const cs        = useMemo(() => makeChartStyles(isDark), [isDark]);

  const [from, setFrom]              = useState(startOfToday);
  const [to,   setTo]                = useState(endOfToday);
  const [granularity, setGran]       = useState('hour');
  const [sourceFilter, setSrcFilter] = useState('');
  const [usageMetric,  setUsageMetric]  = useState('total');
  const [claimsMetric, setClaimsMetric] = useState('total');

  // comparison
  const [compareEnabled,    setCompareEnabled]    = useState(false);
  const [customCompareFrom, setCustomCompareFrom] = useState(null);
  const [showCustomDate,    setShowCustomDate]    = useState(false);

  const [sources,     setSources]     = useState([]);
  const [buckets,     setBuckets]     = useState([]);
  const [claims,      setClaims]      = useState([]);
  const [prevBuckets, setPrevBuckets] = useState([]);
  const [prevClaims,  setPrevClaims]  = useState([]);

  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingUsage,   setLoadingUsage]   = useState(true);
  const [loadingClaims,  setLoadingClaims]  = useState(true);
  const [error, setError] = useState('');

  const duration = to - from;

  const { prevFrom, prevTo } = useMemo(() => {
    if (!compareEnabled) return { prevFrom: null, prevTo: null };
    const pf = customCompareFrom ?? new Date(from.getTime() - duration);
    return { prevFrom: pf, prevTo: new Date(pf.getTime() + duration) };
  }, [compareEnabled, customCompareFrom, from, to, duration]);

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const { data } = await client.get('/plpg/sources');
      setSources(data.data ?? []);
    } catch { /* silent */ } finally { setLoadingSources(false); }
  }, []);

  const fetchUsage = useCallback(async (f, t, gran, src) => {
    setLoadingUsage(true); setError('');
    try {
      const { data } = await client.get('/plpg/usage', {
        params: { from: f.toISOString(), to: t.toISOString(), granularity: gran, ...(src ? { source: src } : {}) },
      });
      setBuckets(data.data ?? []);
    } catch { setError('Failed to load usage data.'); }
    finally   { setLoadingUsage(false); }
  }, []);

  const fetchClaims = useCallback(async (f, t, gran, src) => {
    setLoadingClaims(true);
    try {
      const { data } = await client.get('/plpg/claims', {
        params: { from: f.toISOString(), to: t.toISOString(), granularity: gran, ...(src ? { source: src } : {}) },
      });
      setClaims(data.data ?? []);
    } catch { /* silent */ } finally { setLoadingClaims(false); }
  }, []);

  const fetchPrevUsage = useCallback(async (f, t, gran, src) => {
    try {
      const { data } = await client.get('/plpg/usage', {
        params: { from: f.toISOString(), to: t.toISOString(), granularity: gran, ...(src ? { source: src } : {}) },
      });
      setPrevBuckets(data.data ?? []);
    } catch {}
  }, []);

  const fetchPrevClaims = useCallback(async (f, t, gran, src) => {
    try {
      const { data } = await client.get('/plpg/claims', {
        params: { from: f.toISOString(), to: t.toISOString(), granularity: gran, ...(src ? { source: src } : {}) },
      });
      setPrevClaims(data.data ?? []);
    } catch {}
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  useEffect(() => {
    fetchUsage(from, to, granularity, sourceFilter);
    fetchClaims(from, to, granularity, sourceFilter);
  }, [from, to, granularity, sourceFilter, fetchUsage, fetchClaims]);

  useEffect(() => {
    if (compareEnabled && prevFrom && prevTo) {
      fetchPrevUsage(prevFrom, prevTo, granularity, sourceFilter);
      fetchPrevClaims(prevFrom, prevTo, granularity, sourceFilter);
    } else {
      setPrevBuckets([]);
      setPrevClaims([]);
    }
  }, [compareEnabled, prevFrom, prevTo, granularity, sourceFilter, fetchPrevUsage, fetchPrevClaims]);

  function applyRange(newFrom, newTo) {
    const newGran = coerceGranularity(granularity, newFrom, newTo);
    setFrom(newFrom); setTo(newTo); setCustomCompareFrom(null);
    if (newGran !== granularity) setGran(newGran);
  }

  const allSources   = Array.from(new Set([...sources.map(s => s.name), ...buckets.map(b => b.source)])).filter(Boolean);
  const claimSources = Array.from(new Set(claims.map(b => b.source).filter(Boolean)));
  const visSrc       = sourceFilter ? [sourceFilter] : allSources;
  const visClaimSrc  = sourceFilter ? [sourceFilter] : claimSources;

  const shiftedPrevBuckets = useMemo(() => shiftPrev(prevBuckets, duration), [prevBuckets, duration]);
  const shiftedPrevClaims  = useMemo(() => shiftPrev(prevClaims,  duration), [prevClaims,  duration]);

  // Build ECharts series
  const usageMKey  = usageMetric  === 'total' ? 'count' : 'unique_users';
  const claimsMKey = claimsMetric === 'total' ? 'count' : 'unique_claimers';

  const usageChart = useMemo(
    () => buildUsageSeries(buckets, shiftedPrevBuckets, granularity, from, to, visSrc, usageMKey, usageMKey),
    [buckets, shiftedPrevBuckets, granularity, from, to, visSrc, usageMKey]
  );
  const claimsChart = useMemo(
    () => buildClaimsSeries(claims, shiftedPrevClaims, granularity, from, to, visClaimSrc, claimsMKey),
    [claims, shiftedPrevClaims, granularity, from, to, visClaimSrc, claimsMKey]
  );

  const usageOpt = useMemo(
    () => makePlpgLineOpt({ ...usageChart,  cs, compareEnabled, height: 280 }),
    [usageChart,  cs, compareEnabled]
  );
  const claimsOpt = useMemo(
    () => makePlpgLineOpt({ ...claimsChart, cs, compareEnabled, height: 240 }),
    [claimsChart, cs, compareEnabled]
  );

  const roiRows = computeRoi(buckets, claims);

  const totalReqs    = buckets.reduce((s, b) => s + Number(b.count), 0);
  const totalClaims  = claims.reduce((s, b)  => s + Number(b.count), 0);
  const totalUniqueG = buckets.reduce((s, b) => s + Number(b.unique_users    ?? 0), 0);
  const totalUniqueC = claims.reduce((s, b)  => s + Number(b.unique_claimers ?? 0), 0);

  const prevTotalReqs   = prevBuckets.reduce((s, b) => s + Number(b.count), 0);
  const prevTotalClaims = prevClaims.reduce((s, b)  => s + Number(b.count), 0);

  function delta(cur, prev) {
    if (!compareEnabled || !prevBuckets.length || prev === 0) return null;
    const d = ((cur - prev) / prev * 100).toFixed(1);
    return { d, up: Number(d) >= 0 };
  }
  const reqsDelta   = delta(totalReqs,   prevTotalReqs);
  const claimsDelta = delta(totalClaims, prevTotalClaims);

  const comparePeriodLabel = prevFrom ? `vs ${fmtDateShort(prevFrom)} – ${fmtDateShort(prevTo)}` : '';

  const claimsBySource         = {};
  const uniqueClaimersBySource = {};
  const uniqueGensBySource     = {};
  for (const b of claims)  { const s = b.source || 'unattributed'; claimsBySource[s] = (claimsBySource[s] ?? 0) + Number(b.count); uniqueClaimersBySource[s] = (uniqueClaimersBySource[s] ?? 0) + Number(b.unique_claimers ?? 0); }
  for (const b of buckets) { uniqueGensBySource[b.source] = (uniqueGensBySource[b.source] ?? 0) + Number(b.unique_users ?? 0); }

  const isEmpty  = buckets.length === 0;
  const spinUsage = loadingUsage;

  return (
    <div className="plpg-page">
      <div className="page-header">
        <div className="plpg-title-row">
          <div className="plpg-icon-wrap"><PlpgIcon /></div>
          <div>
            <h1 className="page-title">PLPG</h1>
            <p className="page-sub">
              {loadingUsage ? 'Loading…' : (
                <>
                  <span>{fmt(totalReqs)} authentications</span>
                  {compareEnabled && reqsDelta && (
                    <span className={`plpg-sub-delta ${reqsDelta.up ? 'up' : 'down'}`}>
                      {reqsDelta.up ? '↑' : '↓'}{Math.abs(reqsDelta.d)}%
                    </span>
                  )}
                  <span> · {fmt(totalUniqueG)} unique · </span>
                  <span>{fmt(totalClaims)} claims</span>
                  {compareEnabled && claimsDelta && (
                    <span className={`plpg-sub-delta ${claimsDelta.up ? 'up' : 'down'}`}>
                      {claimsDelta.up ? '↑' : '↓'}{Math.abs(claimsDelta.d)}%
                    </span>
                  )}
                  <span> · {fmt(totalUniqueC)} unique claimers</span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Source cards */}
      {!loadingSources && sources.length > 0 && (
        <div className="plpg-sources">
          {sources.map((src, i) => {
            const color          = SOURCE_COLORS[i % SOURCE_COLORS.length];
            const used           = Number(src.current_hour_usage);
            const limit          = src.max_per_hour;
            const fillPct        = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            const remaining      = Math.max(0, limit - used);
            const srcTotal       = buckets.filter(b => b.source === src.name).reduce((s, b) => s + Number(b.count), 0);
            const srcUniqueGen   = uniqueGensBySource[src.name] ?? 0;
            const srcClaims      = claimsBySource[src.name] ?? 0;
            const srcUniqueClaim = uniqueClaimersBySource[src.name] ?? 0;
            return (
              <div key={src.name} className="plpg-source-card" style={{ '--src-color': color }}>
                <div className="plpg-source-dot" />
                <div className="plpg-source-name">{src.name}</div>
                <div className="plpg-quota-row">
                  <span className="plpg-quota-used">{used.toLocaleString()}</span>
                  <span className="plpg-quota-sep">/</span>
                  <span className="plpg-quota-limit">{limit.toLocaleString()}</span>
                  <span className="plpg-quota-label"> this hour</span>
                </div>
                <div className="plpg-progress-track">
                  <div className="plpg-progress-fill" style={{ width: `${fillPct}%` }} />
                </div>
                <div className="plpg-remaining">{remaining.toLocaleString()} remaining</div>
                <div className="plpg-source-limits">
                  <div className="plpg-limit-item">
                    <span className="plpg-limit-label">Global limit/hr</span>
                    <span className="plpg-limit-val">{limit.toLocaleString()}</span>
                  </div>
                  <div className="plpg-limit-item">
                    <span className="plpg-limit-label">Per user/hr</span>
                    <span className="plpg-limit-val">{src.max_per_user_per_hour.toLocaleString()}</span>
                  </div>
                </div>
                <div className="plpg-source-roi">
                  <div className="plpg-roi-item">
                    <span className="plpg-roi-val">{fmt(srcTotal)}</span>
                    <span className="plpg-roi-label">gens</span>
                  </div>
                  <div className="plpg-roi-item">
                    <span className="plpg-roi-val">{fmt(srcUniqueGen)}</span>
                    <span className="plpg-roi-label">unique</span>
                  </div>
                  <div className="plpg-roi-item">
                    <span className="plpg-roi-val">{fmt(srcClaims)}</span>
                    <span className="plpg-roi-label">claims</span>
                  </div>
                  <div className="plpg-roi-item">
                    <span className="plpg-roi-val plpg-roi-conv">{pct(srcUniqueClaim, srcUniqueGen)}</span>
                    <span className="plpg-roi-label">conv.</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="plpg-filters">
        <div className="plpg-date-range">
          <div className="plpg-date-field">
            <label className="plpg-date-label">From</label>
            <input type="datetime-local" className="plpg-date-input"
              value={toDatetimeLocal(from)} onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) applyRange(d, to); }} />
          </div>
          <span className="plpg-date-sep">→</span>
          <div className="plpg-date-field">
            <label className="plpg-date-label">To</label>
            <input type="datetime-local" className="plpg-date-input"
              value={toDatetimeLocal(to)} onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) applyRange(from, d); }} />
          </div>
        </div>

        <div className="plpg-gran-group">
          {GRANULARITIES.map(g => {
            const enabled = granularityEnabled(g.value, from, to);
            return (
              <button key={g.value}
                className={`plpg-gran-btn${granularity === g.value ? ' active' : ''}${!enabled ? ' disabled' : ''}`}
                onClick={() => { if (enabled) setGran(g.value); }} disabled={!enabled}>
                {g.label}
              </button>
            );
          })}
        </div>

        {allSources.length > 1 && (
          <select className="plpg-source-select" value={sourceFilter}
            onChange={e => setSrcFilter(e.target.value)}>
            <option value="">All sources</option>
            {allSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {/* Compare toggle */}
        <div className="plpg-compare-group">
          <button
            className={`plpg-compare-btn${compareEnabled ? ' active' : ''}`}
            onClick={() => { setCompareEnabled(v => !v); setShowCustomDate(false); setCustomCompareFrom(null); }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" strokeWidth="1.5" stroke="currentColor">
              <path d="M1 7h5M8 7h5M4 4l-3 3 3 3M10 4l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Compare
          </button>

          {compareEnabled && (
            <div className="plpg-compare-period">
              <span className="plpg-compare-label">{comparePeriodLabel}</span>
              <button className="plpg-compare-custom-btn" onClick={() => setShowCustomDate(v => !v)}>
                {customCompareFrom ? 'Custom ✓' : 'Custom'}
              </button>
              {customCompareFrom && (
                <button className="plpg-compare-reset" onClick={() => { setCustomCompareFrom(null); setShowCustomDate(false); }}>✕</button>
              )}
            </div>
          )}
        </div>
      </div>

      {compareEnabled && showCustomDate && (
        <div className="plpg-custom-compare">
          <label className="plpg-date-label">Compare period start</label>
          <input type="datetime-local" className="plpg-date-input"
            value={toDatetimeLocal(customCompareFrom ?? prevFrom)}
            onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) setCustomCompareFrom(d); }} />
          <span className="plpg-date-label" style={{ alignSelf: 'center' }}>
            → {fmtDateShort(prevTo)} (same length)
          </span>
        </div>
      )}

      {error && <div className="page-error">{error}</div>}

      {/* Authentications chart */}
      <div className="plpg-chart-card">
        <div className="plpg-chart-header">
          <div>
            <span className="plpg-chart-title">Authentications</span>
            <span className="plpg-chart-total">
              {fmt(usageMetric === 'total' ? totalReqs : totalUniqueG)} {usageMetric === 'total' ? 'total' : 'unique'}
            </span>
            {compareEnabled && comparePeriodLabel && (
              <span className="plpg-chart-compare-label">{comparePeriodLabel}</span>
            )}
          </div>
          <MetricToggle value={usageMetric} onChange={setUsageMetric} />
        </div>
        {spinUsage
          ? <div className="plpg-chart-state">Loading…</div>
          : isEmpty
            ? <div className="plpg-chart-state muted">No data in selected range.</div>
            : <EChart option={usageOpt} style={{ height: 280 }} onChartReady={activateDragZoom} />
        }
      </div>

      {/* Claims chart */}
      <div className="plpg-chart-card plpg-chart-card--claims">
        <div className="plpg-chart-header">
          <div>
            <span className="plpg-chart-title">Claimed Pages</span>
            <span className="plpg-chart-total">
              {fmt(claimsMetric === 'total' ? totalClaims : totalUniqueC)} {claimsMetric === 'total' ? 'total' : 'unique'}
            </span>
            {compareEnabled && comparePeriodLabel && (
              <span className="plpg-chart-compare-label">{comparePeriodLabel}</span>
            )}
          </div>
          <MetricToggle value={claimsMetric} onChange={setClaimsMetric} />
        </div>
        {loadingClaims
          ? <div className="plpg-chart-state">Loading…</div>
          : <EChart option={claimsOpt} style={{ height: 240 }} onChartReady={activateDragZoom} />
        }
      </div>

      {/* ROI table */}
      {roiRows.length > 0 && (
        <div className="plpg-chart-card">
          <div className="plpg-chart-header">
            <span className="plpg-chart-title">ROI by Source</span>
            <span className="plpg-chart-sub">unique counts are per-bucket sums — directional</span>
          </div>
          <div className="plpg-roi-table-wrap">
            <table className="plpg-roi-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Gens</th>
                  <th>Unique generators</th>
                  <th>Avg gens / user</th>
                  <th>Claims</th>
                  <th>Unique claimers</th>
                  <th>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {roiRows.map((row, i) => (
                  <tr key={row.source}>
                    <td>
                      <span className="plpg-src-dot" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                      {row.source}
                    </td>
                    <td>{fmt(row.gens)}</td>
                    <td>{fmt(row.uniqueGens)}</td>
                    <td>{row.uniqueGens > 0 ? (row.gens / row.uniqueGens).toFixed(1) : '—'}</td>
                    <td>{fmt(row.claims)}</td>
                    <td>{fmt(row.uniqueClaimers)}</td>
                    <td className="plpg-conv-cell">{pct(row.uniqueClaimers, row.uniqueGens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
