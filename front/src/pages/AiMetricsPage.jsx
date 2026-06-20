import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import client from '../api/client';
import './AiMetricsPage.css';

const COLORS = ['#6772e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const MODEL_PRICES = {
  'gpt-4.1':       [2.00,  8.00],
  'gpt-4.1-mini':  [0.40,  1.60],
  'gpt-4.1-nano':  [0.10,  0.40],
  'gpt-4o':        [2.50, 10.00],
  'gpt-5':         [1.25, 10.00],
  'gpt-5-mini':    [0.25,  2.00],
  'gpt-5-nano':    [0.05,  0.40],
  'o3-mini':       [1.10,  4.40],
  'o4-mini':       [0.55,  2.20],
  'gemini-2.5-flash':              [0.30,  2.50],
  'gemini-2.5-flash-lite':         [0.10,  0.40],
  'gemini-2.5-pro':                [1.25, 10.00],
  'gemini-3.1-flash-lite-preview': [0.25,  1.50],
};

const GRANULARITIES = [
  { value: 'minute', label: 'Minute' },
  { value: 'hour',   label: 'Hour'   },
  { value: 'day',    label: 'Day'    },
];

function granularityEnabled(g, from, to) {
  const diffDays = (to - from) / 86400000;
  if (g === 'minute') return diffDays < 2;
  return true;
}

function coerceGranularity(current, from, to) {
  if (granularityEnabled(current, from, to)) return current;
  return ['minute', 'hour', 'day'].find(g => granularityEnabled(g, from, to)) ?? 'day';
}

function granStepMs(gran) {
  if (gran === 'minute') return 60_000;
  if (gran === 'hour')   return 3_600_000;
  return 86_400_000;
}

function truncateUtc(ms, gran) {
  const d = new Date(ms);
  if (gran === 'minute') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  if (gran === 'hour')   return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function generateGrid(from, to, gran) {
  const step  = granStepMs(gran);
  const start = truncateUtc(from.getTime(), gran);
  const end   = truncateUtc(to.getTime(), gran);
  const grid  = [];
  for (let t = start; t <= end; t += step) {
    grid.push(t / 1000);
  }
  return grid;
}

function formatBucketLabel(ts, gran) {
  const d    = new Date(ts * 1000);
  const opts = { timeZone: 'UTC' };
  if (gran === 'minute') return d.toLocaleString('en-US', { ...opts, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  if (gran === 'hour')   return d.toLocaleString('en-US', { ...opts, month: 'short', day: 'numeric', hour: '2-digit', hour12: false });
  return d.toLocaleDateString('en-US', { ...opts, month: 'short', day: 'numeric' });
}

function pivotByModel(data, grid, models, gran, field) {
  const map = new Map();
  for (const ts of grid) {
    const entry = { ts, label: formatBucketLabel(ts, gran) };
    for (const m of models) entry[m] = 0;
    map.set(ts, entry);
  }
  for (const row of data) {
    const entry = map.get(row.ts);
    if (entry) entry[row.model] = (entry[row.model] ?? 0) + Number(row[field]);
  }
  return Array.from(map.values());
}

function pivotTokens(data, grid, gran) {
  const map = new Map();
  for (const ts of grid) {
    map.set(ts, { ts, label: formatBucketLabel(ts, gran), input: 0, output: 0, thinking: 0 });
  }
  for (const row of data) {
    const entry = map.get(row.ts);
    if (entry) {
      entry.input    += Number(row.input_tokens);
      entry.output   += Number(row.output_tokens);
      entry.thinking += Number(row.thinking_tokens);
    }
  }
  return Array.from(map.values());
}

function aggregateModes(modeBreakdown) {
  const map = {};
  for (const row of modeBreakdown) {
    const k = row.mode;
    if (!map[k]) map[k] = { mode: k, input: 0, output: 0, thinking: 0 };
    map[k].input    += Number(row.input_tokens);
    map[k].output   += Number(row.output_tokens);
    map[k].thinking += Number(row.thinking_tokens);
  }
  return Object.values(map).sort((a, b) => (b.input + b.output + b.thinking) - (a.input + a.output + a.thinking));
}

function aggregateModelTotals(data) {
  const map = {};
  for (const row of data) {
    const k = `${row.provider}:${row.model}`;
    if (!map[k]) map[k] = { provider: row.provider, model: row.model, requests: 0, errors: 0, input: 0, output: 0, thinking: 0, durSum: 0, durCnt: 0 };
    map[k].requests += Number(row.requests);
    map[k].errors   += Number(row.errors);
    map[k].input    += Number(row.input_tokens);
    map[k].output   += Number(row.output_tokens);
    map[k].thinking += Number(row.thinking_tokens);
    map[k].durSum   += Number(row.duration_ms_sum);
    map[k].durCnt   += Number(row.duration_count);
  }
  return Object.values(map).sort((a, b) => b.requests - a.requests);
}

function calcCost(model, inTok, outTok, thinkTok) {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  return (inTok * p[0] + (outTok + thinkTok) * p[1]) / 1_000_000;
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtMs(ms) {
  if (!ms) return '—';
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
  return ms + 'ms';
}

function fmtCost(c) {
  if (c === null || c === undefined) return '—';
  if (c < 0.0001) return '$' + c.toFixed(6);
  if (c < 0.01)   return '$' + c.toFixed(4);
  if (c < 1)      return '$' + c.toFixed(3);
  return '$' + c.toFixed(2);
}

function toDatetimeLocal(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const tooltipStyle = {
  contentStyle: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' },
  cursor: { stroke: 'var(--border)', strokeWidth: 1 },
};

function SummaryCard({ label, value, accent }) {
  return (
    <div className="ai-stat-card" style={accent ? { borderColor: accent + '55' } : {}}>
      <div className="ai-stat-label">{label}</div>
      <div className="ai-stat-value" style={accent ? { color: accent } : {}}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children, empty, loading: isLoading }) {
  return (
    <div className="ai-chart-card">
      <div className="ai-chart-header">
        <span className="ai-chart-title">{title}</span>
      </div>
      {isLoading
        ? <div className="ai-chart-state">Loading…</div>
        : empty
          ? <div className="ai-chart-state muted">No data in selected range.</div>
          : children}
    </div>
  );
}

export default function AiMetricsPage() {
  const [from, setFrom]       = useState(() => { const d = new Date(); d.setHours(d.getHours() - 24); return d; });
  const [to,   setTo]         = useState(() => new Date());
  const [gran, setGran]       = useState('hour');
  const [provider, setProvider] = useState('');
  const [model,    setModel]    = useState('');

  const [statsData, setStatsData] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const fetchStats = useCallback(async (f, t, g, prov, mod) => {
    setLoading(true);
    setError('');
    try {
      const params = { from: f.toISOString(), to: t.toISOString(), granularity: g };
      if (prov) params.provider = prov;
      if (mod)  params.model    = mod;
      const { data } = await client.get('/ai/stats', { params });
      setStatsData(data);
    } catch {
      setError('Failed to load AI metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats(from, to, gran, provider, model);
  }, [from, to, gran, provider, model, fetchStats]);

  function applyRange(newFrom, newTo) {
    const newGran = coerceGranularity(gran, newFrom, newTo);
    setFrom(newFrom);
    setTo(newTo);
    if (newGran !== gran) setGran(newGran);
  }

  const rawData       = statsData?.data          ?? [];
  const modeBreakdown = statsData?.mode_breakdown ?? [];
  const allModels     = statsData?.models         ?? [];
  const allProviders  = statsData?.providers      ?? [];
  const summary       = statsData?.summary        ?? {};

  const grid         = generateGrid(from, to, gran);
  const requestsData = pivotByModel(rawData, grid, allModels, gran, 'requests');
  const errorsData   = pivotByModel(rawData, grid, allModels, gran, 'errors');
  const tokensData   = pivotTokens(rawData, grid, gran);
  const modesData    = aggregateModes(modeBreakdown);
  const modelTotals  = aggregateModelTotals(rawData);

  const avgRtMs = Number(summary.total_duration_count) > 0
    ? Math.round(Number(summary.total_duration_ms_sum) / Number(summary.total_duration_count))
    : null;

  let totalCost = 0, costKnown = false;
  for (const m of modelTotals) {
    const c = calcCost(m.model, m.input, m.output, m.thinking);
    if (c !== null) { totalCost += c; costKnown = true; }
  }

  const hasThinking = Number(summary.total_thinking_tokens ?? 0) > 0;
  const isEmpty     = rawData.length === 0;

  const tickFormatter = n => n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n);

  return (
    <div className="ai-page">
      <div className="page-header">
        <h1 className="page-title">AI Metrics</h1>
        <p className="page-sub">
          {loading
            ? 'Loading…'
            : `${Number(summary.total_requests ?? 0).toLocaleString()} requests · ${Number(summary.total_errors ?? 0).toLocaleString()} errors in range`}
        </p>
      </div>

      {/* Filters */}
      <div className="ai-filters">
        <div className="ai-date-range">
          <div className="ai-date-field">
            <label className="ai-date-label">From</label>
            <input type="datetime-local" className="ai-date-input"
              value={toDatetimeLocal(from)}
              onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) applyRange(d, to); }} />
          </div>
          <span className="ai-date-sep">→</span>
          <div className="ai-date-field">
            <label className="ai-date-label">To</label>
            <input type="datetime-local" className="ai-date-input"
              value={toDatetimeLocal(to)}
              onChange={e => { const d = new Date(e.target.value); if (!isNaN(d)) applyRange(from, d); }} />
          </div>
        </div>

        <div className="ai-gran-group">
          {GRANULARITIES.map(g => {
            const enabled = granularityEnabled(g.value, from, to);
            return (
              <button key={g.value}
                className={`ai-gran-btn${gran === g.value ? ' active' : ''}${!enabled ? ' disabled' : ''}`}
                onClick={() => enabled && setGran(g.value)}
                disabled={!enabled}
              >{g.label}</button>
            );
          })}
        </div>

        <div className="ai-filter-selects">
          {allProviders.length > 1 && (
            <select className="ai-select" value={provider} onChange={e => setProvider(e.target.value)}>
              <option value="">All providers</option>
              {allProviders.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {allModels.length > 1 && (
            <select className="ai-select" value={model} onChange={e => setModel(e.target.value)}>
              <option value="">All models</option>
              {allModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      {/* Summary cards */}
      <div className="ai-stat-grid">
        <SummaryCard label="Requests"          value={fmtNum(Number(summary.total_requests ?? 0))} />
        <SummaryCard label="Input Tokens"      value={fmtNum(Number(summary.total_input_tokens ?? 0))} />
        <SummaryCard label="Output Tokens"     value={fmtNum(Number(summary.total_output_tokens ?? 0))} />
        {hasThinking && <SummaryCard label="Thinking Tokens" value={fmtNum(Number(summary.total_thinking_tokens ?? 0))} />}
        <SummaryCard label="Errors"            value={fmtNum(Number(summary.total_errors ?? 0))} accent="#ef4444" />
        <SummaryCard label="Avg Response Time" value={fmtMs(avgRtMs)} />
        {costKnown && <SummaryCard label="Est. Cost" value={fmtCost(totalCost)} accent="#10b981" />}
      </div>

      {/* Requests over time */}
      <ChartCard title="Requests over time" loading={loading} empty={isEmpty}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={requestsData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.12)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {allModels.map((m, i) => (
              <Line key={m} type="monotone" dataKey={m}
                stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Token usage over time */}
      <ChartCard title="Token usage over time" loading={loading} empty={isEmpty}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={tokensData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.12)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false} tickLine={false} width={50} tickFormatter={tickFormatter} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Line type="monotone" dataKey="input"    name="Input"    stroke="#6772e5" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="output"   name="Output"   stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            {hasThinking && (
              <Line type="monotone" dataKey="thinking" name="Thinking" stroke="#f472b6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="ai-charts-row">
        {/* Errors over time */}
        <ChartCard title="Errors over time" loading={loading} empty={isEmpty}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={errorsData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.12)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={false} tickLine={false} width={40} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              {allModels.map((m, i) => (
                <Line key={m} type="monotone" dataKey={m}
                  stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Tokens by mode */}
        {(loading || modesData.length > 0) && (
          <ChartCard title="Tokens by mode" loading={loading} empty={modesData.length === 0}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={modesData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,.12)" vertical={false} />
                <XAxis dataKey="mode" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false} tickLine={false} width={50} tickFormatter={tickFormatter} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="input"  name="Input"  stackId="a" fill="#6772e5" radius={hasThinking ? [0,0,0,0] : [0,0,0,0]} />
                <Bar dataKey="output" name="Output" stackId="a" fill="#10b981" radius={hasThinking ? [0,0,0,0] : [3,3,0,0]} />
                {hasThinking && (
                  <Bar dataKey="thinking" name="Thinking" stackId="a" fill="#f472b6" radius={[3,3,0,0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>

      {/* Model breakdown table */}
      {(loading || modelTotals.length > 0) && (
        <ChartCard title="Model breakdown" loading={loading} empty={modelTotals.length === 0}>
          <div className="ai-table-wrap">
            <table className="ai-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Requests</th>
                  <th>Errors</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  {hasThinking && <th>Thinking Tokens</th>}
                  <th>Avg RT</th>
                  <th>Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {modelTotals.map((m, i) => {
                  const avgRt = m.durCnt > 0 ? Math.round(m.durSum / m.durCnt) : null;
                  const cost  = calcCost(m.model, m.input, m.output, m.thinking);
                  return (
                    <tr key={i}>
                      <td><span className="ai-provider-badge" data-provider={m.provider}>{m.provider}</span></td>
                      <td className="ai-model-name">{m.model}</td>
                      <td>{m.requests.toLocaleString()}</td>
                      <td className={m.errors > 0 ? 'ai-err-cell' : ''}>{m.errors.toLocaleString()}</td>
                      <td>{fmtNum(m.input)}</td>
                      <td>{fmtNum(m.output)}</td>
                      {hasThinking && <td>{fmtNum(m.thinking)}</td>}
                      <td>{fmtMs(avgRt)}</td>
                      <td className="ai-cost-cell">{fmtCost(cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}
    </div>
  );
}
