import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, Tooltip, XAxis, YAxis,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import client from '../api/client';
import './HomePage.css';

const PM_COLORS = { 1: '#009cde', 2: '#6772e5', 3: '#f59e0b' };
const CHART_COLORS = ['#6772e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function fmt(n, currency) {
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtShort(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtHour(ts) {
  const d = new Date(ts * 1000);
  return d.getHours() + ':00';
}

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="chart-section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label, labelFmt }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-label">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p, i) => (
        <div key={i} className="tooltip-row" style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === 'number' && p.value > 100 ? fmtShort(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  );
};

export default function HomePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/analytics').then(({ data }) => setData(data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="home-page"><div className="home-loading">Loading analytics…</div></div>;
  if (!data) return <div className="home-page"><div className="home-loading">Failed to load.</div></div>;

  const { overview, orders_per_day = [], orders_per_hour = [], by_payment_method = [],
    by_traffic_source = [], top_buyers = [], multi_store_buyers = [], by_currency = [] } = data;

  const primaryCurrency = by_currency[0]?.currency || 'USD';

  const pmTotal = by_payment_method.reduce((s, p) => s + p.orders, 0);
  const pmPie = by_payment_method.map(p => ({
    name: p.label, value: p.orders,
    pct: pmTotal ? Math.round((p.orders / pmTotal) * 100) : 0,
    color: PM_COLORS[p.payment_method] || '#8b5cf6',
  }));

  return (
    <div className="home-page">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
      </div>

      {/* Overview */}
      <div className="stats-grid">
        <StatCard label="Total Orders" value={overview.total_orders.toLocaleString()} />
        <StatCard label="Total Revenue" value={fmt(overview.total_revenue, primaryCurrency)} />
        <StatCard label="Avg Order Value" value={fmt(overview.avg_order_value, primaryCurrency)} />
        <StatCard label="Unique Customers" value={overview.unique_customers.toLocaleString()} />
      </div>

      {/* Revenue by currency */}
      {by_currency.length > 1 && (
        <div className="currency-pills">
          {by_currency.map(c => (
            <div key={c.currency} className="currency-pill">
              <span className="currency-code">{c.currency}</span>
              <span className="currency-rev">{fmt(c.revenue, c.currency)}</span>
              <span className="currency-orders">{c.orders} orders</span>
            </div>
          ))}
        </div>
      )}

      <div className="charts-row">
        {/* Orders per day */}
        <Section title="Orders — last 30 days">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={orders_per_day} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="ts" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip labelFmt={fmtDate} />} />
              <Line type="monotone" dataKey="orders" stroke="#6772e5" strokeWidth={2} dot={false} name="Orders" />
            </LineChart>
          </ResponsiveContainer>
        </Section>

        {/* Revenue per day */}
        <Section title="Revenue — last 30 days">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={orders_per_day} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="ts" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
              <Tooltip content={<CustomTooltip labelFmt={fmtDate} />} />
              <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} name="Revenue" />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* Hourly — last 48h */}
      <Section title="Orders &amp; Revenue — last 48 hours">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={orders_per_hour} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="ts" tickFormatter={fmtHour} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
            <Tooltip content={<CustomTooltip labelFmt={fmtHour} />} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
            <Bar yAxisId="left" dataKey="orders" fill="#6772e5" name="Orders" radius={[3,3,0,0]} />
            <Bar yAxisId="right" dataKey="revenue" fill="#10b981" name="Revenue" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Section>

      <div className="charts-row">
        {/* Payment method pie */}
        <Section title="Payment Methods">
          <div className="pie-wrap">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pmPie} dataKey="value" cx="50%" cy="50%" outerRadius={80} paddingAngle={2}>
                  {pmPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v, n, p) => [`${v} (${p.payload.pct}%)`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pie-legend">
              {pmPie.map((p, i) => (
                <div key={i} className="pie-legend-row">
                  <span className="pie-dot" style={{ background: p.color }} />
                  <span className="pie-name">{p.name}</span>
                  <span className="pie-pct">{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Traffic sources */}
        <Section title="Top Traffic Sources">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={by_traffic_source} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
              <YAxis dataKey="source" type="category" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={90} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="orders" fill="#6772e5" name="Orders" radius={[0,3,3,0]}>
                {by_traffic_source.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <div className="charts-row">
        {/* Top buyers */}
        <Section title="Top 10 Buyers">
          <table className="analytics-table">
            <thead><tr><th>Email</th><th>Orders</th><th>Revenue</th></tr></thead>
            <tbody>
              {top_buyers.map((b, i) => (
                <tr key={i}>
                  <td className="buyer-email">{b.email}</td>
                  <td>{b.orders}</td>
                  <td>{fmt(b.revenue, primaryCurrency)}</td>
                </tr>
              ))}
              {top_buyers.length === 0 && <tr><td colSpan="3" className="empty-row">No data</td></tr>}
            </tbody>
          </table>
        </Section>

        {/* Multi-store buyers */}
        <Section title="Multi-Store Buyers">
          <table className="analytics-table">
            <thead><tr><th>Email</th><th>Stores</th><th>Orders</th><th>Revenue</th></tr></thead>
            <tbody>
              {multi_store_buyers.map((b, i) => (
                <tr key={i}>
                  <td className="buyer-email">{b.email}</td>
                  <td><span className="stores-badge">{b.stores}</span></td>
                  <td>{b.orders}</td>
                  <td>{fmt(b.revenue, primaryCurrency)}</td>
                </tr>
              ))}
              {multi_store_buyers.length === 0 && <tr><td colSpan="4" className="empty-row">No multi-store buyers yet</td></tr>}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
