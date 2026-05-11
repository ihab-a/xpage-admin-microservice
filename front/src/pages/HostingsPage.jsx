import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import './HostingsPage.css';

function formatDate(ts) {
  if (!ts) return null;
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const FILTER_OPTIONS = [
  { value: '', label: 'All Hostings' },
  { value: 'stripe', label: 'Stripe Connected' },
  { value: 'paypal', label: 'PayPal Connected' },
  { value: 'both', label: 'Both Connected' },
  { value: 'none', label: 'None Connected' },
];

export default function HostingsPage() {
  const navigate = useNavigate();
  const [hostings, setHostings] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, per_page: 25, pages: 1 });
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchHostings = useCallback(async (params) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/hostings', { params });
      setHostings(data.data);
      setMeta(data.meta);
    } catch {
      setError('Failed to load hostings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = { page, per_page: 25 };
    if (filter === 'stripe') params.stripe_connected = 'true';
    else if (filter === 'paypal') params.paypal_connected = 'true';
    else if (filter === 'both') { params.stripe_connected = 'true'; params.paypal_connected = 'true'; }
    else if (filter === 'none') { params.stripe_connected = 'false'; params.paypal_connected = 'false'; }
    fetchHostings(params);
  }, [filter, page, fetchHostings]);

  function handleFilterChange(e) {
    setFilter(e.target.value);
    setPage(1);
  }

  return (
    <div className="hostings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payment Connections</h1>
          <p className="page-sub">
            {loading ? 'Loading…' : `${meta.total.toLocaleString()} hosting${meta.total !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div className="filters-bar">
        <select className="method-select" value={filter} onChange={handleFilterChange}>
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className="table-wrap">
        <table className="hostings-table">
          <thead>
            <tr>
              <th>Hosting</th>
              <th>PayPal</th>
              <th>Stripe</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {loading && hostings.length === 0 ? (
              <tr><td colSpan="4" className="table-empty">Loading…</td></tr>
            ) : hostings.length === 0 ? (
              <tr><td colSpan="4" className="table-empty">No hostings found.</td></tr>
            ) : hostings.map((h) => (
              <tr key={h.id} className="hosting-row">
                <td>
                  <div className="hosting-name">{h.hosting_name || h.hosting_id?.slice(0, 8)}</div>
                  <div className="hosting-id">{h.hosting_id}</div>
                </td>
                <td>
                  {h.paypal_merchant_id ? (
                    <div>
                      <span className="conn-badge conn-paypal">Connected</span>
                      {h.paypal_livemode === false && <span className="env-badge">Sandbox</span>}
                      {h.paypal_livemode === true && <span className="env-badge env-live">Live</span>}
                      <div className="merchant-id">{h.paypal_merchant_id}</div>
                      {h.paypal_connected_at && (
                        <div className="conn-date">{formatDate(h.paypal_connected_at)}</div>
                      )}
                    </div>
                  ) : (
                    <span className="conn-badge conn-none">Not connected</span>
                  )}
                </td>
                <td>
                  {h.stripe_user_id ? (
                    <div>
                      <span className="conn-badge conn-stripe">Connected</span>
                      {h.stripe_livemode === false && <span className="env-badge">Test</span>}
                      {h.stripe_livemode === true && <span className="env-badge env-live">Live</span>}
                      <div className="merchant-id">{h.stripe_user_id}</div>
                      {h.stripe_connected_at && (
                        <div className="conn-date">{formatDate(h.stripe_connected_at)}</div>
                      )}
                    </div>
                  ) : (
                    <span className="conn-badge conn-none">Not connected</span>
                  )}
                </td>
                <td>
                  <button
                    className="view-orders-btn"
                    onClick={() => navigate(`/orders?hosting_id=${h.hosting_id}`)}
                  >
                    View orders →
                  </button>
                </td>
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
