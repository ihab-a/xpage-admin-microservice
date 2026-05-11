import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client';
import './OrderDetailPage.css';

const METHOD_CLASS = { 1: 'pm-paypal', 2: 'pm-stripe', 3: 'pm-cod' };

function formatMoney(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0);
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function Field({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get(`/orders/${id}`)
      .then(({ data }) => setOrder(data.data))
      .catch(() => setError('Order not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="detail-page"><div className="detail-loading">Loading…</div></div>;
  if (error || !order) return <div className="detail-page"><div className="detail-error">{error || 'Not found'}</div></div>;

  const products = Array.isArray(order.products) ? order.products : [];
  const subtotal = products.reduce((s, p) => s + (p.price || 0) * (p.quantity || 1), 0);
  const fullName = [order.customer_first_name, order.customer_last_name].filter(Boolean).join(' ');
  const addressParts = [order.customer_address, order.customer_city, order.customer_state, order.customer_postal_code].filter(Boolean);

  return (
    <div className="detail-page">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/orders')}>← Orders</button>
        <div className="detail-title-row">
          <h1 className="detail-ref">{order.order_ref}</h1>
          <span className={`pm-badge ${METHOD_CLASS[order.payment_method] || ''}`}>
            {order.payment_method_label}
          </span>
        </div>
        <div className="detail-meta">
          {order.hosting_name && <span className="detail-hosting">{order.hosting_name}</span>}
          <span className="detail-date">Paid {formatDate(order.paid_at)}</span>
        </div>
      </div>

      <div className="detail-grid">
        {/* Customer */}
        <div className="detail-card">
          <div className="detail-card-title">Customer</div>
          <Field label="Name" value={fullName || null} />
          <Field label="Email" value={order.customer_email} />
          <Field label="Phone" value={order.customer_phone} />
          {addressParts.length > 0 && (
            <div className="detail-field">
              <div className="detail-label">Address</div>
              <div className="detail-value">{addressParts.join(', ')}</div>
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="detail-card">
          <div className="detail-card-title">Payment</div>
          <Field label="Method" value={order.payment_method_label} />
          {order.card_brand && (
            <Field label="Card" value={`${order.card_brand} ···· ${order.card_last4}`} />
          )}
          <Field label="Currency" value={order.currency} />
          {order.landing_page_url && (
            <div className="detail-field">
              <div className="detail-label">Landing Page</div>
              <div className="detail-value">
                <a href={order.landing_page_url} target="_blank" rel="noopener noreferrer" className="detail-link">
                  {order.landing_page_url} ↗
                </a>
              </div>
            </div>
          )}
          {order.traffic_source && <Field label="Traffic Source" value={order.traffic_source} />}
        </div>

        {/* Order Summary */}
        <div className="detail-card">
          <div className="detail-card-title">Summary</div>
          {subtotal > 0 && <Field label="Subtotal" value={formatMoney(subtotal, order.currency)} />}
          {order.discount > 0 && <Field label="Discount" value={`-${formatMoney(order.discount, order.currency)}`} />}
          {order.discount_code && <Field label="Discount Code" value={order.discount_code} />}
          {order.tip > 0 && <Field label="Tip" value={formatMoney(order.tip, order.currency)} />}
          {order.shipping_rate > 0 && <Field label="Shipping" value={formatMoney(order.shipping_rate, order.currency)} />}
          {order.shipping_name && <Field label="Shipping Method" value={order.shipping_name} />}
          <div className="detail-field detail-total-row">
            <div className="detail-label">Total</div>
            <div className="detail-value detail-total">{formatMoney(order.total, order.currency)}</div>
          </div>
        </div>
      </div>

      {/* Products */}
      {products.length > 0 && (
        <div className="detail-card detail-products-card">
          <div className="detail-card-title">Products ({products.length})</div>
          <div className="products-grid">
            {products.map((p, i) => (
              <div key={i} className="product-card">
                {p.image_path && (
                  <img
                    src={p.image_path}
                    alt={p.product_name || p.variant_title}
                    className="product-card-img"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                <div className="product-card-body">
                  <div className="product-card-name">{p.product_name || '—'}</div>
                  {p.variant_title && <div className="product-card-variant">{p.variant_title}</div>}
                  {p.sku && <div className="product-card-sku">SKU: {p.sku}</div>}
                  {p.options && Object.keys(p.options).length > 0 && (
                    <div className="product-card-options">
                      {Object.entries(p.options).map(([k, v]) => (
                        <span key={k} className="product-option-tag">{k}: {v}</span>
                      ))}
                    </div>
                  )}
                  <div className="product-card-footer">
                    <span className="product-card-qty">×{p.quantity}</span>
                    <span className="product-card-price">{formatMoney(p.price, order.currency)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
