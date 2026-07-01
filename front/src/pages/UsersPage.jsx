import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client';
import SuspendModal from '../components/SuspendModal';
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

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, per_page: 25, pages: 1 });
  const [search, setSearch] = useState('');
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { user } | null
  const [actionError, setActionError] = useState('');
  const searchTimer = useRef(null);

  const fetchUsers = useCallback(async (params) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/users', { params });
      setUsers(data.data ?? data.data);
      setMeta(data.meta);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers({ search, suspended: suspendedOnly ? 'true' : undefined, page, per_page: 25 });
  }, [suspendedOnly, page, fetchUsers]);

  function handleSearchChange(e) {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchUsers({ search: val, suspended: suspendedOnly ? 'true' : undefined, page: 1, per_page: 25 });
    }, 400);
  }

  async function handleSuspend(user, reason, otherReason) {
    setActionError('');
    try {
      await client.post(`/users/${user.id}/suspend`, {
        suspension_reason: reason,
        suspension_other_reason: otherReason || null,
      });
      setModal(null);
      fetchUsers({ search, suspended: suspendedOnly ? 'true' : undefined, page, per_page: 25 });
    } catch (e) {
      setActionError(e.response?.data?.message || 'Failed to suspend user.');
    }
  }

  async function handleUnsuspend(user) {
    if (!window.confirm(`Unsuspend ${user.first_name} ${user.last_name} (${user.email})?`)) return;
    setActionError('');
    try {
      await client.post(`/users/${user.id}/unsuspend`);
      fetchUsers({ search, suspended: suspendedOnly ? 'true' : undefined, page, per_page: 25 });
    } catch (e) {
      setActionError(e.response?.data?.message || 'Failed to unsuspend user.');
    }
  }

  return (
    <div className="users-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-sub">
            {loading ? 'Loading…' : `${meta.total.toLocaleString()} user${meta.total !== 1 ? 's' : ''}`}
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
            placeholder="Search by name or email…"
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
        <table className="users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Suspended At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr><td colSpan="5" className="table-empty">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan="5" className="table-empty">No users found.</td></tr>
            ) : users.map((u) => {
              const isSuspended = !!u.suspended_at;
              return (
                <tr key={u.id} className={`user-row${isSuspended ? ' user-row-suspended' : ''}`}>
                  <td>
                    <div className="user-name">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</div>
                    <div className="user-email">{u.email}</div>
                    <div className="user-id">{u.id}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${isSuspended ? 'status-suspended' : 'status-active'}`}>
                      {isSuspended ? 'Suspended' : 'Active'}
                    </span>
                  </td>
                  <td>
                    {u.suspension_reason
                      ? <span className="reason-badge">{formatReason(u.suspension_reason)}</span>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                    {u.suspension_other_reason && (
                      <div className="user-email" style={{ marginTop: 4 }}>{u.suspension_other_reason}</div>
                    )}
                  </td>
                  <td>
                    <span className="suspended-at">{formatDate(u.suspended_at)}</span>
                  </td>
                  <td>
                    {isSuspended ? (
                      <button className="action-btn action-btn-unsuspend" onClick={() => handleUnsuspend(u)}>
                        Unsuspend
                      </button>
                    ) : (
                      <button className="action-btn action-btn-suspend" onClick={() => setModal({ user: u })}>
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
          entityType="user"
          entityName={`${modal.user.first_name} ${modal.user.last_name} (${modal.user.email})`}
          onClose={() => setModal(null)}
          onConfirm={(reason, other) => handleSuspend(modal.user, reason, other)}
        />
      )}
    </div>
  );
}
