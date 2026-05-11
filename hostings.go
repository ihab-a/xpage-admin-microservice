package main

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func handleIngestHostingPayment(w http.ResponseWriter, r *http.Request) {
	var p HostingPaymentEvent
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		jsonError(w, "invalid json", http.StatusBadRequest)
		return
	}
	if p.HostingID == "" || p.Platform == "" || p.Event == "" {
		jsonError(w, "hosting_id, platform, event required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// Upsert the hosting row
	_, err := db.Exec(ctx, `
		INSERT INTO connected_hostings (hosting_id, hosting_name)
		VALUES ($1, $2)
		ON CONFLICT (hosting_id) DO UPDATE SET
			hosting_name = COALESCE(EXCLUDED.hosting_name, connected_hostings.hosting_name),
			updated_at = NOW()
	`, p.HostingID, nullStr(p.HostingName))
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	switch p.Platform {
	case "paypal":
		if p.Event == "connect" {
			_, err = db.Exec(ctx, `
				UPDATE connected_hostings SET
					paypal_merchant_id  = $2,
					paypal_connected_at = NOW(),
					paypal_livemode     = $3,
					updated_at          = NOW()
				WHERE hosting_id = $1
			`, p.HostingID, p.MerchantID, p.Livemode)
		} else {
			_, err = db.Exec(ctx, `
				UPDATE connected_hostings SET
					paypal_merchant_id  = NULL,
					paypal_connected_at = NULL,
					paypal_livemode     = NULL,
					updated_at          = NOW()
				WHERE hosting_id = $1
			`, p.HostingID)
		}
	case "stripe":
		if p.Event == "connect" {
			_, err = db.Exec(ctx, `
				UPDATE connected_hostings SET
					stripe_user_id      = $2,
					stripe_connected_at = NOW(),
					stripe_livemode     = $3,
					updated_at          = NOW()
				WHERE hosting_id = $1
			`, p.HostingID, p.StripeUserID, p.Livemode)
		} else {
			_, err = db.Exec(ctx, `
				UPDATE connected_hostings SET
					stripe_user_id      = NULL,
					stripe_connected_at = NULL,
					stripe_livemode     = NULL,
					updated_at          = NOW()
				WHERE hosting_id = $1
			`, p.HostingID)
		}
	default:
		jsonError(w, "unknown platform: must be paypal or stripe", http.StatusBadRequest)
		return
	}

	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{"ok": true})
}

func handleListHostings(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	stripeConnected := q.Get("stripe_connected")
	paypalConnected := q.Get("paypal_connected")
	page := intParam(q.Get("page"), 1)
	perPage := intParam(q.Get("per_page"), 25)
	if perPage > 100 {
		perPage = 100
	}
	offset := (page - 1) * perPage

	args := []any{}
	where := []string{}
	n := 1

	if stripeConnected == "true" {
		where = append(where, "stripe_user_id IS NOT NULL")
	} else if stripeConnected == "false" {
		where = append(where, "stripe_user_id IS NULL")
	}

	if paypalConnected == "true" {
		where = append(where, "paypal_merchant_id IS NOT NULL")
	} else if paypalConnected == "false" {
		where = append(where, "paypal_merchant_id IS NULL")
	}

	clause := ""
	if len(where) > 0 {
		clause = "WHERE " + strings.Join(where, " AND ")
	}

	var total int
	db.QueryRow(r.Context(), "SELECT COUNT(*) FROM connected_hostings "+clause, args...).Scan(&total)

	listArgs := append(args, perPage, offset)
	rows, err := db.Query(r.Context(),
		`SELECT id, hosting_id, hosting_name,
		        paypal_merchant_id, stripe_user_id,
		        paypal_connected_at, stripe_connected_at,
		        paypal_livemode, stripe_livemode,
		        updated_at, created_at
		 FROM connected_hostings `+clause+
			` ORDER BY updated_at DESC LIMIT $`+strconv.Itoa(n)+` OFFSET $`+strconv.Itoa(n+1),
		listArgs...,
	)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	hostings := []ConnectedHosting{}
	for rows.Next() {
		var h ConnectedHosting
		var paypalCA, stripeCA *time.Time
		var updatedAt, createdAt time.Time
		if err := rows.Scan(
			&h.ID, &h.HostingID, &h.HostingName,
			&h.PaypalMerchantID, &h.StripeUserID,
			&paypalCA, &stripeCA,
			&h.PaypalLivemode, &h.StripeLivemode,
			&updatedAt, &createdAt,
		); err != nil {
			continue
		}
		if paypalCA != nil {
			ts := paypalCA.Unix()
			h.PaypalConnectedAt = &ts
		}
		if stripeCA != nil {
			ts := stripeCA.Unix()
			h.StripeConnectedAt = &ts
		}
		h.UpdatedAt = updatedAt.Unix()
		h.CreatedAt = createdAt.Unix()
		hostings = append(hostings, h)
	}

	pages := int(math.Ceil(float64(total) / float64(perPage)))
	jsonOK(w, map[string]any{
		"data": hostings,
		"meta": map[string]any{
			"total":    total,
			"page":     page,
			"per_page": perPage,
			"pages":    pages,
		},
	})
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
