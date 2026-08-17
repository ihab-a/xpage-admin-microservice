import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';
import './DropInvitesPage.css';

const PAGE_SIZE = 25;

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Mirrors xPage's own parsing: comma, semicolon or newline separated. Spaces
// are never separators — "jane doe@example.com" is a typo worth reporting, not
// an invite for doe@example.com.
function parseEmails(raw) {
  const seen = new Set();
  return raw
    .split(/[,;\r\n\t]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => {
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
    });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`invite-stat${tone ? ` invite-stat-${tone}` : ''}`}>
      <div className="invite-stat-label">{label}</div>
      <div className="invite-stat-value">{value}</div>
      {hint && <div className="invite-stat-hint">{hint}</div>}
    </div>
  );
}

function CopyLink({ url }) {
  const [copied, setCopied] = useState(false);

  if (!url) return <span className="invite-link-missing">link not stored</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard is unavailable outside secure contexts — fall back to a prompt
      window.prompt('Copy the invite link:', url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="invite-link">
      <code className="invite-link-url" title={url}>{url}</code>
      <button className="action-btn invite-copy-btn" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function StatusBadge({ status }) {
  const key = String(status || '').toLowerCase();
  return <span className={`status-badge status-${key}`}>{key || '—'}</span>;
}

export default function DropInvitesPage() {
  const [invites, setInvites] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [raw, setRaw] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);

  const parsed = parseEmails(raw);
  const invalid = parsed.filter((e) => !EMAIL_RE.test(e));

  const fetchInvites = useCallback(async (p) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/drop-invites', { params: { page: p, page_size: PAGE_SIZE } });
      setInvites(data.data ?? []);
      setMeta({
        total: data.paginator?.total ?? 0,
        pages: data.paginator?.lastPage ?? 1,
      });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load invites.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await client.get('/drop-invites/stats');
      setStats(data.stats ?? null);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => { fetchInvites(page); }, [page, fetchInvites]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  async function handleSend() {
    if (parsed.length === 0 || sending) return;
    if (!window.confirm(`Send the Drop beta invite to ${parsed.length} address${parsed.length !== 1 ? 'es' : ''}?`)) return;

    setSending(true);
    setError('');
    setResults(null);
    try {
      const { data } = await client.post('/drop-invites', { emails: parsed });
      setResults(data);
      setRaw('');
      setPage(1);
      fetchInvites(1);
      fetchStats();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to send invites.');
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke(invite) {
    const warning = invite.status === 'ACCEPTED'
      ? `Delete the invite record for ${invite.email}? They keep the drop access it granted.`
      : `Delete the invite for ${invite.email}? The link stops working immediately.`;
    if (!window.confirm(warning)) return;
    try {
      await client.delete(`/drop-invites/${invite.id}`);
      fetchInvites(page);
      fetchStats();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to revoke invite.');
    }
  }

  return (
    <div className="invites-page">
      <div className="page-header">
        <h1 className="page-title">Drop Invites</h1>
        <p className="page-sub">
          Send beta access links and track who has actually signed up with them.
        </p>
      </div>

      <div className="invite-stats">
        <StatCard label="Invites sent" value={stats?.total ?? '—'} />
        <StatCard
          label="Accepted"
          value={stats?.accepted ?? '—'}
          hint={stats ? `${stats.acceptance_rate}% acceptance` : null}
          tone="accepted"
        />
        <StatCard label="Pending" value={stats?.pending ?? '—'} tone="pending" />
        <StatCard label="Expired" value={stats?.expired ?? '—'} tone="expired" />
        <StatCard
          label="Undelivered emails"
          value={stats?.undelivered_emails ?? '—'}
          hint="link created, email failed"
          tone={stats?.undelivered_emails ? 'failed' : null}
        />
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className="invite-compose">
        <div className="invite-compose-head">
          <h2 className="invite-compose-title">Send invites</h2>
          <span className="invite-compose-hint">
            One address per line, or comma separated.
          </span>
        </div>

        <textarea
          className="invite-textarea"
          rows={6}
          placeholder={'jane@example.com\njohn@example.com'}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          disabled={sending}
        />

        <div className="invite-compose-foot">
          <div className="invite-parsed">
            {parsed.length > 0 && (
              <>
                <strong>{parsed.length}</strong> address{parsed.length !== 1 ? 'es' : ''}
                {invalid.length > 0 && (
                  <span className="invite-parsed-invalid">
                    {' '}· {invalid.length} look{invalid.length === 1 ? 's' : ''} invalid
                  </span>
                )}
              </>
            )}
          </div>
          <button
            className="invite-send-btn"
            onClick={handleSend}
            disabled={sending || parsed.length === 0}
          >
            {sending ? 'Sending…' : `Send ${parsed.length || ''} invite${parsed.length === 1 ? '' : 's'}`}
          </button>
        </div>

        {results && (
          <div className="invite-results">
            <div className="invite-results-summary">
              <span className="result-pill result-pill-sent">{results.sent} sent</span>
              {results.link_only > 0 && (
                <span className="result-pill result-pill-link">{results.link_only} link only</span>
              )}
              {results.failed > 0 && (
                <span className="result-pill result-pill-failed">{results.failed} failed</span>
              )}
            </div>

            {results.results?.map((res) => (
              <div key={res.email} className="invite-result-row">
                <span className="invite-result-email">{res.email}</span>
                <StatusBadge status={res.status} />
                {res.url && <CopyLink url={res.url} />}
                {res.error && <span className="invite-result-error">{res.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="invites-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Invite link</th>
              <th>Status</th>
              <th>Email</th>
              <th>Sent</th>
              <th>Expires</th>
              <th>Accepted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && invites.length === 0 ? (
              <tr><td colSpan="8" className="table-empty">Loading…</td></tr>
            ) : invites.length === 0 ? (
              <tr><td colSpan="8" className="table-empty">No invites yet.</td></tr>
            ) : invites.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <div className="invite-email">{inv.email}</div>
                  {inv.sent_by && <div className="invite-sub">by {inv.sent_by}</div>}
                </td>
                <td className="invite-link-cell"><CopyLink url={inv.url} /></td>
                <td><StatusBadge status={inv.status} /></td>
                <td>
                  {inv.email_status
                    ? <StatusBadge status={inv.email_status} />
                    : <span className="invite-sub">—</span>}
                  {inv.email_error && <div className="invite-result-error">{inv.email_error}</div>}
                </td>
                <td><span className="date-cell">{formatDate(inv.sent_at || inv.created_at)}</span></td>
                <td><span className="date-cell">{formatDate(inv.expires_at)}</span></td>
                <td><span className="date-cell">{formatDate(inv.accepted_at)}</span></td>
                <td>
                  <button className="action-btn action-btn-revoke" onClick={() => handleRevoke(inv)}>
                    Delete
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
