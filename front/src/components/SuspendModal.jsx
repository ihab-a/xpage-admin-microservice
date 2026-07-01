import { useState, useEffect } from 'react';
import './SuspendModal.css';

const REASONS = [
  { value: 'FRAUD_REVIEW',       label: 'Fraud Review' },
  { value: 'POLICY_VIOLATION',   label: 'Policy Violation' },
  { value: 'HIGH_RISK_ACTIVITY', label: 'High Risk Activity' },
  { value: 'FAKE_STORE',         label: 'Fake Store' },
  { value: 'PROHIBITED_PRODUCT', label: 'Prohibited Product' },
  { value: 'KYC_REQUIRED',       label: 'KYC Required' },
  { value: 'CHARGEBACK_RISK',    label: 'Chargeback Risk' },
  { value: 'OTHER',              label: 'Other' },
];

export default function SuspendModal({ isOpen, onClose, onConfirm, entityType, entityName }) {
  const [reason, setReason] = useState('FRAUD_REVIEW');
  const [otherReason, setOtherReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);

  const confirmPhrase = `suspend ${entityType}`;

  useEffect(() => {
    if (isOpen) {
      setReason('FRAUD_REVIEW');
      setOtherReason('');
      setConfirmText('');
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const canSubmit =
    confirmText === confirmPhrase &&
    (reason !== 'OTHER' || otherReason.trim().length > 0) &&
    !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await onConfirm(reason, reason === 'OTHER' ? otherReason.trim() : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="modal-title">Suspend {entityType === 'user' ? 'User' : 'Hosting'}</div>
        <div className="modal-entity-name">{entityName}</div>

        <div className="modal-field">
          <label className="modal-label">Suspension Reason</label>
          <select className="modal-select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {reason === 'OTHER' && (
          <div className="modal-field">
            <label className="modal-label">Custom Reason</label>
            <textarea
              className="modal-textarea"
              placeholder="Describe the reason…"
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
            />
          </div>
        )}

        <div className="modal-field">
          <p className="modal-confirm-phrase">
            To confirm, type <strong>{confirmPhrase}</strong> below:
          </p>
          <input
            type="text"
            className="modal-confirm-input"
            placeholder={confirmPhrase}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="modal-btn-suspend" onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? 'Suspending…' : 'Suspend'}
          </button>
        </div>
      </div>
    </div>
  );
}
