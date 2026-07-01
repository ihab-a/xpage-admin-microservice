import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import client from '../api/client';
import SuspendModal from '../components/SuspendModal';
import './XHostingsPage.css';
import './UsersPage.css';

const HOSTING_STATUS_LABELS = {
  1: 'Active',
  2: 'Deactivated',
  3: 'Inactive',
  4: 'Archived',
  5: 'Buffering',
  6: 'Buffered',
  7: 'Suspended',
};

const HOSTING_STATUS_CLASS = {
  1: 'status-active',
  2: 'status-deactivated',
  3: 'status-inactive',
  4: 'status-inactive',
  5: 'status-inactive',
  6: 'status-inactive',
  7: 'status-suspended',
};

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [hostings, setHostings] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, per_page: 25, pages: 1 });
  const [search, setSearch] = useState('');
  const [userIdFilter, setUserIdFilter] = useState(searchParams.get('user_id') || '');
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [actionError, setActionError] = useState('');
  const searchTimer = useRef(null);
  const userIdTimer = useRef(null);

  const buildParams = useCallback((overrides = {}) => {
    const base = {
      search: search || undefined,
      user_id: userIdFilter || undefined,
      suspended: suspendedOnly ? 'true' : undefined,
      page,
      per_page: 25,
    };
    return { ...base, ...overrides };
  }, [search, userIdFilter, suspendedOnly, page]);

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
    fetchHostings(buildParams());
  }, [suspendedOnly, page, fetchHostings, buildParams]);

  // Pre-fill user_id from query param on mount
  useEffect(() => {
    const uid = searchParams.get('user_id');
    if (uid) {
      setUserIdFilter(uid);
      fetchHostings(buildParams({ user_id: uid, page: 1 }));
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchHostings(buildParams({ search: val || undefined, page: 1 }));
    }, 400);
  }

  function handleUserIdChange(e) {
    const val = e.target.value;
    setUserIdFilter(val);
    setPage(1);
    clearTimeout(userIdTimer.current);
    userIdTimer.current = setTimeout(() => {
      fetchHostings(buildParams({ user_id: val || undefined, page: 1 }));
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
      fetchHostings(buildParams());
    } catch (e) {
      setActionError(e.response?.data?.message || 'Failed to suspend hosting.');
    }
  }

  async function handleUnsuspend(hosting) {
    if (!window.confirm(`Unsuspend hosting "${hosting.name || hosting.id}"?`)) return;
    setActionError('');
    try {
      await client.post(`/xhostings/${hosting.id}/unsuspend`);
      fetchHostings(buildParams());
    } catch (e) {
      setActionError(e.response?.data?.message || 'Failed to unsuspend hosting.');
    }
  }

  return (
    <div className="xhostings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Hostings</h1>
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
            placeholder="Search by ID or name…"
            value={search}
            onChange={handleSearchChange}
          />
        </div>
        <div className="search-wrap">
          <svg className="search-icon" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Filter by user ID…"
            value={userIdFilter}
            onChange={handleUserIdChange}
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

      {userIdFilter && (
        <div className="active-filter-bar">
          Filtered by user: <code>{userIdFilter}</code>
          <button className="clear-filter-btn" onClick={() => {
            setUserIdFilter('');
            setPage(1);
            fetchHostings(buildParams({ user_id: undefined, page: 1 }));
          }}>✕ Clear</button>
        </div>
      )}

      {error && <div className="page-error">{error}</div>}
      {actionError && <div className="page-error">{actionError}</div>}

      <div className="table-wrap">
        <table className="xhostings-table">
          <thead>
            <tr>
              <th>Hosting</th>
              <th>User ID</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Suspended At</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && hostings.length === 0 ? (
              <tr><td colSpan="8" className="table-empty">Loading…</td></tr>
            ) : hostings.length === 0 ? (
              <tr><td colSpan="8" className="table-empty">No hostings found.</td></tr>
            ) : hostings.map((h) => {
              const isSuspended = h.status === 7;
              const statusLabel = HOSTING_STATUS_LABELS[h.status] ?? `Status ${h.status}`;
              const statusClass = HOSTING_STATUS_CLASS[h.status] ?? 'status-inactive';
              return (
                <tr key={h.id} className={`xhosting-row${isSuspended ? ' xhosting-row-suspended' : ''}`}>
                  <td>
                    <div className="xhosting-name">{h.name || '—'}</div>
                    <div className="xhosting-id">{h.id}</div>
                  </td>
                  <td>
                    <span className="xhosting-user-id">{h.user_id || '—'}</span>
                  </td>
                  <td>
                    <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
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
                    <span className="date-cell">{formatDate(h.created_at)}</span>
                  </td>
                  <td>
                    <span className="date-cell">{formatDate(h.updated_at)}</span>
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
