import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client';
import SuspendModal from '../components/SuspendModal';
import './XHostingsPage.css';
import './UsersPage.css';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatReason(r) {
  if (!r) return '—';
  return r.replace(/_/g, ' ');
}

export default function XHostingsPage() {
  const [hostings, setHostings] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, per_page: 25, pages: 1 });
  const [search, setSearch] = useState('');
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [actionError, setActionError] = useState('');
  const searchTimer = useRef(null);

  const SUSPENDED_STATUS = 7;

  const fetchHostings = useCallback(async (params) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/xhostings', { params });
      setHostings(data.data ?? []);
      setMeta({
        total:    data.paginator?.total       ?? 0,
        page:     data.paginator?.currentPage ?? 1,
        pages:    data.paginator?.lastPage    ?? 1,
        per_page: 25,
      });
    } catch {
      setError('Failed to load hostings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHostings({ search, suspended: suspendedOnly ? 'true' : undefined, page, per_page: 25 });
  }, [suspendedOnly, page, fetchHostings]);

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchHostings({ search: val, suspended: suspendedOnly ? 'true' : undefined, page: 1, per_page: 25 });
    }, 400);
  }

  async function handleSuspend(hosting, reason, otherReason) {
    setActionError('');
    try {
      await client.post(`/xhostings/${hosting.id}/suspend`, {
        suspension_reason: reason,
        suspension_other_reason: otherReason || null,
      });
      setModal(null);
      fetchHostings({ search, suspended: suspendedOnly ? 'true' : undefined, page, per_page: 25 });
    } catch (e) {
      setActionError(e.response?.data?.message || 'Failed to suspend hosting.');
    }
  }

  async function handleUnsuspend(hosting) {
    if (!window.confirm(`Unsuspend hosting "${hosting.name || hosting.id}"?`)) return;
    setActionError('');
    try {
      await client.post(`/xhostings/${hosting.id}/unsuspend`);
      fetchHostings({ search, suspended: suspendedOnly ? 'true' : undefined, page, per_page: 25 });
    } catch (e) {
      setActionError(e.response?.data?.message || 'Failed to unsuspend hosting.');
    }
  }

  return (
    <div className="xhostings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Moderation</h1>
          <p className="page-sub">
            {loading ? 'Loading…' : `${meta.total.toLocaleString()} hosting${meta.total !== 1 ? 's' : ''}`}
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
            placeholder="Search by name…"
            value={search}
            onChange={handleSearchChange}
          />
        </div>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={suspendedOnly}
            onChange={(e) => { setSuspendedOnly(e.target.checked); setPage(1); }}
          />
          Suspended only
        </label>
      </div>

      {error && <div className="page-error">{error}</div>}
      {actionError && <div className="page-error">{actionError}</div>}

      <div className="table-wrap">
        <table className="xhostings-table">
          <thead>
            <tr>
              <th>Hosting</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Suspended At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && hostings.length === 0 ? (
              <tr><td colSpan="5" className="table-empty">Loading…</td></tr>
            ) : hostings.length === 0 ? (
              <tr><td colSpan="5" className="table-empty">No hostings found.</td></tr>
            ) : hostings.map((h) => {
              const isSuspended = h.status === SUSPENDED_STATUS || !!h.suspended_at;
              return (
                <tr key={h.id} className={`xhosting-row${isSuspended ? ' xhosting-row-suspended' : ''}`}>
                  <td>
                    <div className="xhosting-name">{h.name || '—'}</div>
                    <div className="xhosting-id">{h.id}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${isSuspended ? 'status-suspended' : 'status-active'}`}>
                      {isSuspended ? 'Suspended' : 'Active'}
                    </span>
                  </td>
                  <td>
                    {h.suspension_reason
                      ? <span className="reason-badge">{formatReason(h.suspension_reason)}</span>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                    {h.suspension_other_reason && (
                      <div className="user-email" style={{ marginTop: 4 }}>{h.suspension_other_reason}</div>
                    )}
                  </td>
                  <td>
                    <span className="suspended-at">{formatDate(h.suspended_at)}</span>
                  </td>
                  <td>
                    {isSuspended ? (
                      <button className="action-btn action-btn-unsuspend" onClick={() => handleUnsuspend(h)}>
                        Unsuspend
                      </button>
                    ) : (
                      <button className="action-btn action-btn-suspend" onClick={() => setModal({ hosting: h })}>
                        Suspend
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
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

      {modal && (
        <SuspendModal
          isOpen
          entityType="hosting"
          entityName={modal.hosting.name || modal.hosting.id}
          onClose={() => setModal(null)}
          onConfirm={(reason, other) => handleSuspend(modal.hosting, reason, other)}
        />
      )}
    </div>
  );
}
