import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import './OrdersPage.css';

const PAYMENT_METHODS = [
  { value: '', label: 'All Methods' },
  { value: '1', label: 'PayPal' },
  { value: '2', label: 'Stripe' },
  { value: '3', label: 'Cash on Delivery' },
];

const METHOD_CLASS = { 1: 'pm-paypal', 2: 'pm-stripe', 3: 'pm-cod' };

function formatMoney(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0);
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, per_page: 25, pages: 1 });
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const searchTimer = useRef(null);

  const fetchOrders = useCallback(async (params) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/orders', { params });
      setOrders(data.data);
      setMeta(data.meta);
    } catch {
      setError('Failed to load orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders({ search, payment_method: paymentMethod || undefined, page, per_page: 25 });
  }, [paymentMethod, page, fetchOrders]);

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchOrders({ search: val, payment_method: paymentMethod || undefined, page: 1, per_page: 25 });
    }, 350);
  }

  function handleMethodChange(e) {
    setPaymentMethod(e.target.value);
    setPage(1);
  }

  return (
    <div className="orders-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-sub">
            {loading ? 'Loading…' : `${meta.total.toLocaleString()} paid orders`}
          </p>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-wrap">
          <svg className="search-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search by ref, name, email, phone…"
            value={search}
            onChange={handleSearchChange}
          />
        </div>

        <select className="method-select" value={paymentMethod} onChange={handleMethodChange}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className="table-wrap">
        <table className="orders-table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Customer</th>
              <th>Hosting</th>
              <th>Method</th>
              <th>Total</th>
              <th>Discount</th>
              <th>Paid At</th>
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 ? (
              <tr><td colSpan="7" className="table-empty">Loading…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan="7" className="table-empty">No orders found.</td></tr>
            ) : orders.map((order) => (
              <tr key={order.id} className="order-row" onClick={() => navigate(`/orders/${order.id}`)}>
                <td>
                  <span className="order-ref">{order.order_ref}</span>
                </td>
                <td>
                  <div className="customer-name">
                    {[order.customer_first_name, order.customer_last_name].filter(Boolean).join(' ') || '—'}
                  </div>
                  {order.customer_email && <div className="customer-email">{order.customer_email}</div>}
                  {order.customer_phone && <div className="customer-phone">{order.customer_phone}</div>}
                </td>
                <td>
                  <span className="hosting-name">{order.hosting_name || order.hosting_id?.slice(0, 8)}</span>
                </td>
                <td>
                  <span className={`pm-badge ${METHOD_CLASS[order.payment_method] || ''}`}>
                    {order.payment_method_label}
                  </span>
                  {order.card_brand && (
                    <div className="card-info">{order.card_brand} ···{order.card_last4}</div>
                  )}
                </td>
                <td>
                  <span className="order-total">{formatMoney(order.total, order.currency)}</span>
                </td>
                <td>
                  {order.discount > 0
                    ? <span className="discount">-{formatMoney(order.discount, order.currency)}</span>
                    : <span className="muted">—</span>}
                </td>
                <td className="paid-at">{formatDate(order.paid_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta.pages > 1 && (
        <div className="pagination">
          <button className="page-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </button>
          <span className="page-info">Page {page} of {meta.pages}</span>
          <button className="page-btn" disabled={page >= meta.pages} onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
