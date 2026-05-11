package main

import (
	"encoding/json"
	"time"
)

type PaidOrder struct {
	ID                string          `json:"id"`
	HostingID         string          `json:"hosting_id"`
	HostingName       *string         `json:"hosting_name"`
	OrderID           string          `json:"order_id"`
	OrderRef          string          `json:"order_ref"`
	PaymentMethod     int             `json:"payment_method"`
	PaymentMethodLabel string         `json:"payment_method_label"`
	Total             float64         `json:"total"`
	Discount          float64         `json:"discount"`
	Currency          string          `json:"currency"`
	CardLast4         *string         `json:"card_last4"`
	CardBrand         *string         `json:"card_brand"`
	CustomerFirstName *string         `json:"customer_first_name"`
	CustomerLastName  *string         `json:"customer_last_name"`
	CustomerEmail     *string         `json:"customer_email"`
	CustomerPhone     *string         `json:"customer_phone"`
	LandingPageURL    *string         `json:"landing_page_url"`
	Products          json.RawMessage `json:"products"`
	PaidAt            *time.Time      `json:"paid_at"`
	CreatedAt         time.Time       `json:"created_at"`
}

// IngestPayload is what the Laravel backend POSTs.
type IngestPayload struct {
	HostingID         string          `json:"hosting_id"`
	HostingName       string          `json:"hosting_name"`
	OrderID           string          `json:"order_id"`
	OrderRef          string          `json:"order_ref"`
	PaymentMethod     int             `json:"payment_method"`
	Total             float64         `json:"total"`
	Discount          float64         `json:"discount"`
	Currency          string          `json:"currency"`
	CardLast4         *string         `json:"card_last4"`
	CardBrand         *string         `json:"card_brand"`
	CustomerFirstName *string         `json:"customer_first_name"`
	CustomerLastName  *string         `json:"customer_last_name"`
	CustomerEmail     *string         `json:"customer_email"`
	CustomerPhone     *string         `json:"customer_phone"`
	LandingPageURL    *string         `json:"landing_page_url"`
	Products          json.RawMessage `json:"products"`
	PaidAt            *time.Time      `json:"paid_at"`
}

type Admin struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
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
