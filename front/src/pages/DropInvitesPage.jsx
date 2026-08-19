import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client';
import './DropInvitesPage.css';

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 1500;

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
  const [batch, setBatch] = useState(null);
  const [results, setResults] = useState([]);
  const pollTimer = useRef(null);

  const [linkEmail, setLinkEmail] = useState('');
  const [linkUses, setLinkUses] = useState(10);
  const [creatingLink, setCreatingLink] = useState(false);
  const [createdLink, setCreatedLink] = useState(null);

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

  // the job sends the emails, so the response is only a batch id: from there we
  // poll, pulling just the results we have not seen yet
  const pollBatch = useCallback(async (batchId, after) => {
    try {
      const { data } = await client.get(`/drop-invites/batch/${batchId}`, { params: { after } });
      const state = data.batch;

      setBatch(state);
      if (state.results?.length) {
        setResults((prev) => [...prev, ...state.results]);
      }

      if (state.status === 'finished' || state.status === 'failed') {
        setSending(false);
        fetchInvites(1);
        fetchStats();
        if (state.status === 'failed') {
          setError(state.error || 'The invite job failed.');
        }
        return;
      }

      pollTimer.current = setTimeout(() => pollBatch(batchId, state.next_offset), POLL_INTERVAL_MS);
    } catch (e) {
      setSending(false);
      setError(e.response?.data?.error || 'Lost track of the invite batch.');
    }
  }, [fetchInvites, fetchStats]);

  useEffect(() => () => clearTimeout(pollTimer.current), []);

  async function handleSend() {
    if (parsed.length === 0 || sending) return;
    if (!window.confirm(`Send the Drop beta invite to ${parsed.length} address${parsed.length !== 1 ? 'es' : ''}?`)) return;

    setSending(true);
    setError('');
    setBatch(null);
    setResults([]);
    try {
      const { data } = await client.post('/drop-invites', { emails: parsed });
      setBatch(data.batch);
      setRaw('');
      pollBatch(data.batch.id, 0);
    } catch (e) {
      setSending(false);
      setError(e.response?.data?.error || 'Failed to queue the invites.');
    }
  }

  // a shareable link is made on the spot: no queue, no email, just a link that
  // works for as many people as asked for
  async function handleCreateLink() {
    if (!linkEmail.trim() || creatingLink) return;

    setCreatingLink(true);
    setError('');
    setCreatedLink(null);
    try {
      const { data } = await client.post('/drop-invites/link', {
        email: linkEmail.trim(),
        uses: Number(linkUses) || 1,
      });
      setCreatedLink(data.link);
      setLinkEmail('');
      fetchInvites(1);
      fetchStats();
      setPage(1);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create the link.');
    } finally {
      setCreatingLink(false);
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

        {batch && (
          <div className="invite-results">
            <div className="invite-progress">
              <div className="invite-progress-bar">
                <div
                  className="invite-progress-fill"
                  style={{ width: `${batch.total ? Math.round((batch.processed / batch.total) * 100) : 0}%` }}
                />
              </div>
              <div className="invite-progress-label">
                {batch.status === 'finished'
                  ? `Done — ${batch.processed} of ${batch.total} processed`
                  : batch.status === 'failed'
                    ? `Job failed after ${batch.processed} of ${batch.total}`
                    : `Sending… ${batch.processed} of ${batch.total}`}
              </div>
            </div>

            <div className="invite-results-summary">
              <span className="result-pill result-pill-sent">{batch.sent} sent</span>
              {batch.link_only > 0 && (
                <span className="result-pill result-pill-link">{batch.link_only} link only</span>
              )}
              {batch.failed > 0 && (
                <span className="result-pill result-pill-failed">{batch.failed} failed</span>
              )}
            </div>

            <div className="invite-results-list">
              {results.map((res) => (
                <div key={res.email} className="invite-result-row">
                  <span className="invite-result-email">{res.email}</span>
                  <StatusBadge status={res.status} />
                  {res.url && <CopyLink url={res.url} />}
                  {res.error && <span className="invite-result-error">{res.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="invite-compose">
        <div className="invite-compose-head">
          <h2 className="invite-compose-title">Create a shareable link</h2>
          <span className="invite-compose-hint">
            Nothing is emailed — the link works until it runs out of uses.
          </span>
        </div>

        <div className="invite-link-form">
          <input
            className="search-input invite-link-input"
            type="text"
            placeholder="Label or email for this link"
            value={linkEmail}
            onChange={(e) => setLinkEmail(e.target.value)}
            disabled={creatingLink}
          />
          <label className="invite-uses-field">
            <span>Uses</span>
            <input
              className="search-input invite-uses-input"
              type="number"
              min="1"
              value={linkUses}
              onChange={(e) => setLinkUses(e.target.value)}
              disabled={creatingLink}
            />
          </label>
          <button
            className="invite-send-btn"
            onClick={handleCreateLink}
            disabled={creatingLink || !linkEmail.trim()}
          >
            {creatingLink ? 'Creating…' : 'Create link'}
          </button>
        </div>

        {createdLink && (
          <div className="invite-results">
            <div className="invite-result-row">
              <span className="invite-result-email">{createdLink.email}</span>
              <StatusBadge status={createdLink.status} />
              <span className="invite-sub">{createdLink.max_uses} uses</span>
              <CopyLink url={createdLink.url} />
            </div>
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
              <th>Uses</th>
              <th>Email</th>
              <th>Sent</th>
              <th>Expires</th>
              <th>Accepted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && invites.length === 0 ? (
              <tr><td colSpan="9" className="table-empty">Loading…</td></tr>
            ) : invites.length === 0 ? (
              <tr><td colSpan="9" className="table-empty">No invites yet.</td></tr>
            ) : invites.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <div className="invite-email">{inv.email}</div>
                  {inv.sent_by && <div className="invite-sub">by {inv.sent_by}</div>}
                </td>
                <td className="invite-link-cell"><CopyLink url={inv.url} /></td>
                <td><StatusBadge status={inv.status} /></td>
                <td>
                  <span className="invite-uses">{inv.uses ?? 0} / {inv.max_uses ?? 1}</span>
                </td>
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
