import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import client from '../api/client';
import './PlpgPage.css';

const GRANULARITIES = [
  { value: 'hour',  label: 'Hour' },
  { value: 'day',   label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year',  label: 'Year' },
];

const SOURCE_COLORS = ['#6772e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const CLAIMS_COLOR  = '#06b6d4';

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

function pivotBuckets(buckets, granularity) {
  const map = new Map();
  for (const b of buckets) {
    if (!map.has(b.ts)) map.set(b.ts, { ts: b.ts, label: formatBucketLabel(b.ts, granularity) });
    map.get(b.ts)[b.source] = Number(b.count);
  }
  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

function pivotClaims(data, granularity) {
  return data.map(b => ({
    ts:     b.ts,
    label:  formatBucketLabel(b.ts, granularity),
    claims: Number(b.count),
  })).sort((a, b) => a.ts - b.ts);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
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

const tooltipStyle = {
  contentStyle: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--text)',
  },
  cursor: { stroke: 'var(--border)', strokeWidth: 1 },
};

export default function PlpgPage() {
  const [from, setFrom]           = useState(startOfToday);
  const [to,   setTo]             = useState(endOfToday);
  const [granularity, setGran]    = useState('hour');
  const [sourceFilter, setSrcFilter] = useState('');

  const [sources, setSources]     = useState([]);
  const [buckets, setBuckets]     = useState([]);
  const [claims,  setClaims]      = useState([]);

  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingUsage,   setLoadingUsage]   = useState(true);
  const [loadingClaims,  setLoadingClaims]  = useState(true);
  const [error, setError]         = useState('');

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const { data } = await client.get('/plpg/sources');
      setSources(data.data ?? []);
    } catch { /* silent */ } finally {
      setLoadingSources(false);
    }
  }, []);

  const fetchUsage = useCallback(async (f, t, gran, src) => {
    setLoadingUsage(true);
    setError('');
    try {
      const { data } = await client.get('/plpg/usage', {
        params: {
          from:        f.toISOString(),
          to:          t.toISOString(),
          granularity: gran,
          ...(src ? { source: src } : {}),
        },
      });
      setBuckets(data.data ?? []);
    } catch {
      setError('Failed to load usage data.');
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  const fetchClaims = useCallback(async (f, t, gran) => {
    setLoadingClaims(true);
    try {
      const { data } = await client.get('/plpg/claims', {
        params: {
          from:        f.toISOString(),
          to:          t.toISOString(),
          granularity: gran,
        },
      });
      setClaims(data.data ?? []);
    } catch { /* silent */ } finally {
      setLoadingClaims(false);
    }
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  useEffect(() => {
    fetchUsage(from, to, granularity, sourceFilter);
    fetchClaims(from, to, granularity);
  }, [from, to, granularity, sourceFilter, fetchUsage, fetchClaims]);

  function applyRange(newFrom, newTo) {
    const newGran = coerceGranularity(granularity, newFrom, newTo);
    setFrom(newFrom);
    setTo(newTo);
    if (newGran !== granularity) setGran(newGran);
  }

  function handleFromChange(e) {
    const d = new Date(e.target.value);
    if (!isNaN(d)) applyRange(d, to);
  }

  function handleToChange(e) {
    const d = new Date(e.target.value);
    if (!isNaN(d)) applyRange(from, d);
  }

  function handleGranChange(g) {
    if (granularityEnabled(g, from, to)) setGran(g);
  }

  const allSources = Array.from(new Set([
    ...sources.map(s => s.name),
    ...buckets.map(b => b.source),
  ]));

  const visibleSources = sourceFilter ? [sourceFilter] : allSources;
  const chartData      = pivotBuckets(buckets, granularity);
  const claimsData     = pivotClaims(claims, granularity);
  const totalReqs      = buckets.reduce((s, b) => s + Number(b.count), 0);
  const totalClaims    = claims.reduce((s, b) => s + Number(b.count), 0);

  return (
    <div className="plpg-page">
      <div className="page-header">
        <div className="plpg-title-row">
          <div className="plpg-icon-wrap"><PlpgIcon /></div>
          <div>
            <h1 className="page-title">PLPG</h1>
            <p className="page-sub">
              {loadingUsage
                ? 'Loading…'
                : `${totalReqs.toLocaleString()} authentications · ${totalClaims.toLocaleString()} claims in range`}
            </p>
          </div>
        </div>
      </div>

      {/* Source cards */}
      {!loadingSources && sources.length > 0 && (
        <div className="plpg-sources">
          {sources.map((src, i) => {
            const color      = SOURCE_COLORS[i % SOURCE_COLORS.length];
            const used       = Number(src.current_hour_usage);
            const limit      = src.max_per_hour;
            const pct        = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            const remaining  = Math.max(0, limit - used);
            const srcTotal   = buckets
              .filter(b => b.source === src.name)
              .reduce((s, b) => s + Number(b.count), 0);
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
                  <div className="plpg-progress-fill" style={{ width: `${pct}%` }} />
                </div>

                <div className="plpg-remaining">
                  {remaining.toLocaleString()} remaining
                </div>

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

                <div className="plpg-source-usage">
                  <span className="plpg-usage-count">{srcTotal.toLocaleString()}</span>
                  <span className="plpg-usage-label"> reqs in range</span>
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
              value={toDatetimeLocal(from)} onChange={handleFromChange} />
          </div>
          <span className="plpg-date-sep">→</span>
          <div className="plpg-date-field">
            <label className="plpg-date-label">To</label>
            <input type="datetime-local" className="plpg-date-input"
              value={toDatetimeLocal(to)} onChange={handleToChange} />
          </div>
        </div>

        <div className="plpg-gran-group">
          {GRANULARITIES.map(g => {
            const enabled = granularityEnabled(g.value, from, to);
            return (
              <button
                key={g.value}
                className={`plpg-gran-btn${granularity === g.value ? ' active' : ''}${!enabled ? ' disabled' : ''}`}
                onClick={() => handleGranChange(g.value)}
                disabled={!enabled}
                title={!enabled ? 'Not available for the selected range' : undefined}
              >
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
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* Authentications chart */}
      <div className="plpg-chart-card">
        <div className="plpg-chart-header">
          <span className="plpg-chart-title">Authentications</span>
          <span className="plpg-chart-total">{totalReqs.toLocaleString()} total</span>
        </div>
        {loadingUsage ? (
          <div className="plpg-chart-state">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="plpg-chart-state muted">No data in selected range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.12)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={false} tickLine={false} width={40} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              {visibleSources.map((src) => (
                <Line
                  key={src}
                  type="monotone"
                  dataKey={src}
                  stroke={SOURCE_COLORS[allSources.indexOf(src) % SOURCE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Claims chart */}
      <div className="plpg-chart-card plpg-chart-card--claims">
        <div className="plpg-chart-header">
          <span className="plpg-chart-title">Claimed Pages</span>
          <span className="plpg-chart-total">{totalClaims.toLocaleString()} total</span>
        </div>
        {loadingClaims ? (
          <div className="plpg-chart-state">Loading…</div>
        ) : claimsData.length === 0 ? (
          <div className="plpg-chart-state muted">No claims in selected range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={claimsData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.12)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={false} tickLine={false} width={40} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Line
                type="monotone"
                dataKey="claims"
                stroke={CLAIMS_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
