package main

import "net/http"

func handleIngestOrder(w http.ResponseWriter, r *http.Request) {
	var p IngestPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		jsonError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}

	if p.HostingID == "" || p.OrderID == "" || p.OrderRef == "" {
		jsonError(w, "hosting_id, order_id and order_ref are required", http.StatusBadRequest)
		return
	}

	// Ensure products is valid JSON string for JSONB column
	productsJSON := "[]"
	if len(p.Products) > 0 {
		productsJSON = string(p.Products)
	}

	_, err := db.Exec(r.Context(), `
		INSERT INTO paid_orders (
			hosting_id, hosting_name, order_id, order_ref,
			payment_method, total, discount, currency,
			card_last4, card_brand,
			customer_first_name, customer_last_name, customer_email, customer_phone,
			landing_page_url, products, paid_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17
		)
		ON CONFLICT ON CONSTRAINT uq_paid_orders_hosting_order DO NOTHING
	`,
		p.HostingID, p.HostingName, p.OrderID, p.OrderRef,
		p.PaymentMethod, p.Total, p.Discount, p.Currency,
		p.CardLast4, p.CardBrand,
		p.CustomerFirstName, p.CustomerLastName, p.CustomerEmail, p.CustomerPhone,
		p.LandingPageURL, productsJSON, p.PaidAt,
	)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{"ok": true})
}
