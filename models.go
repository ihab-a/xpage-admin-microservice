package main

import (
	"encoding/json"
	"time"
)

type PaidOrder struct {
	ID                 string          `json:"id"`
	HostingID          string          `json:"hosting_id"`
	HostingName        *string         `json:"hosting_name"`
	OrderID            string          `json:"order_id"`
	OrderRef           string          `json:"order_ref"`
	PaymentMethod      int             `json:"payment_method"`
	PaymentMethodLabel string          `json:"payment_method_label"`
	Total              float64         `json:"total"`
	Discount           float64         `json:"discount"`
	Currency           string          `json:"currency"`
	CardLast4          *string         `json:"card_last4"`
	CardBrand          *string         `json:"card_brand"`
	CustomerFirstName  *string         `json:"customer_first_name"`
	CustomerLastName   *string         `json:"customer_last_name"`
	CustomerEmail      *string         `json:"customer_email"`
	CustomerPhone      *string         `json:"customer_phone"`
	CustomerAddress    *string         `json:"customer_address"`
	CustomerCity       *string         `json:"customer_city"`
	CustomerState      *string         `json:"customer_state"`
	CustomerPostalCode *string         `json:"customer_postal_code"`
	ShippingRate       float64         `json:"shipping_rate"`
	ShippingName       *string         `json:"shipping_name"`
	TrafficSource      *string         `json:"traffic_source"`
	DiscountCode       *string         `json:"discount_code"`
	Tip                float64         `json:"tip"`
	LandingPageURL     *string         `json:"landing_page_url"`
	Products           json.RawMessage `json:"products"`
	PaidAt             *int64          `json:"paid_at"`
	CreatedAt          int64           `json:"created_at"`
}

type IngestPayload struct {
	HostingID          string          `json:"hosting_id"`
	HostingName        string          `json:"hosting_name"`
	OrderID            string          `json:"order_id"`
	OrderRef           string          `json:"order_ref"`
	PaymentMethod      int             `json:"payment_method"`
	Total              float64         `json:"total"`
	Discount           float64         `json:"discount"`
	Currency           string          `json:"currency"`
	CardLast4          *string         `json:"card_last4"`
	CardBrand          *string         `json:"card_brand"`
	CustomerFirstName  *string         `json:"customer_first_name"`
	CustomerLastName   *string         `json:"customer_last_name"`
	CustomerEmail      *string         `json:"customer_email"`
	CustomerPhone      *string         `json:"customer_phone"`
	CustomerAddress    *string         `json:"customer_address"`
	CustomerCity       *string         `json:"customer_city"`
	CustomerState      *string         `json:"customer_state"`
	CustomerPostalCode *string         `json:"customer_postal_code"`
	ShippingRate       float64         `json:"shipping_rate"`
	ShippingName       *string         `json:"shipping_name"`
	TrafficSource      *string         `json:"traffic_source"`
	DiscountCode       *string         `json:"discount_code"`
	Tip                float64         `json:"tip"`
	LandingPageURL     *string         `json:"landing_page_url"`
	Products           json.RawMessage `json:"products"`
	PaidAt             *int64          `json:"paid_at"`
}

type ConnectedHosting struct {
	ID                string  `json:"id"`
	HostingID         string  `json:"hosting_id"`
	HostingName       *string `json:"hosting_name"`
	PaypalMerchantID  *string `json:"paypal_merchant_id"`
	StripeUserID      *string `json:"stripe_user_id"`
	PaypalConnectedAt *int64  `json:"paypal_connected_at"`
	StripeConnectedAt *int64  `json:"stripe_connected_at"`
	PaypalLivemode    *bool   `json:"paypal_livemode"`
	StripeLivemode    *bool   `json:"stripe_livemode"`
	UpdatedAt         int64   `json:"updated_at"`
	CreatedAt         int64   `json:"created_at"`
}

type HostingPaymentEvent struct {
	HostingID    string  `json:"hosting_id"`
	HostingName  string  `json:"hosting_name"`
	Platform     string  `json:"platform"`
	Event        string  `json:"event"`
	MerchantID   *string `json:"merchant_id"`
	StripeUserID *string `json:"stripe_user_id"`
	Livemode     *bool   `json:"livemode"`
}

type Admin struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	CreatedAt int64  `json:"created_at"`
}

func paymentMethodLabel(m int) string {
	switch m {
	case 1:
		return "PayPal"
	case 2:
		return "Stripe"
	case 3:
		return "Cash on Delivery"
	default:
		return "Unknown"
	}
}

// toTimePtr converts a nullable Unix seconds int64 to *time.Time for DB insertion.
func toTimePtr(ts *int64) *time.Time {
	if ts == nil {
		return nil
	}
	t := time.Unix(*ts, 0).UTC()
	return &t
}
