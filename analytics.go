package main

import (
	"net/http"
)

func handleAnalytics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Overview
	var totalOrders int
	var totalRevenue, avgOrderValue float64
	var uniqueCustomers int
	db.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(total),0), COUNT(DISTINCT customer_email),
		       COALESCE(AVG(total),0)
		FROM paid_orders
	`).Scan(&totalOrders, &totalRevenue, &uniqueCustomers, &avgOrderValue)

	// Orders + revenue per day, last 30 days
	dayRows, _ := db.Query(ctx, `
		SELECT
			EXTRACT(EPOCH FROM DATE_TRUNC('day', paid_at AT TIME ZONE 'UTC'))::bigint,
			COUNT(*),
			COALESCE(SUM(total),0)
		FROM paid_orders
		WHERE paid_at >= NOW() - INTERVAL '30 days'
		GROUP BY 1 ORDER BY 1
	`)
	ordersPerDay := []map[string]any{}
	for dayRows.Next() {
		var ts int64
		var cnt int
		var rev float64
		dayRows.Scan(&ts, &cnt, &rev)
		ordersPerDay = append(ordersPerDay, map[string]any{"ts": ts, "orders": cnt, "revenue": rev})
	}
	dayRows.Close()

	// Orders + revenue per hour, last 48h
	hourRows, _ := db.Query(ctx, `
		SELECT
			EXTRACT(EPOCH FROM DATE_TRUNC('hour', paid_at AT TIME ZONE 'UTC'))::bigint,
			COUNT(*),
			COALESCE(SUM(total),0)
		FROM paid_orders
		WHERE paid_at >= NOW() - INTERVAL '48 hours'
		GROUP BY 1 ORDER BY 1
	`)
	ordersPerHour := []map[string]any{}
	for hourRows.Next() {
		var ts int64
		var cnt int
		var rev float64
		hourRows.Scan(&ts, &cnt, &rev)
		ordersPerHour = append(ordersPerHour, map[string]any{"ts": ts, "orders": cnt, "revenue": rev})
	}
	hourRows.Close()

	// By payment method
	pmRows, _ := db.Query(ctx, `
		SELECT payment_method, COUNT(*), COALESCE(SUM(total),0)
		FROM paid_orders GROUP BY payment_method ORDER BY 2 DESC
	`)
	byPM := []map[string]any{}
	for pmRows.Next() {
		var pm, cnt int
		var rev float64
		pmRows.Scan(&pm, &cnt, &rev)
		byPM = append(byPM, map[string]any{
			"payment_method": pm, "label": paymentMethodLabel(pm),
			"orders": cnt, "revenue": rev,
		})
	}
	pmRows.Close()

	// By traffic source
	srcRows, _ := db.Query(ctx, `
		SELECT COALESCE(traffic_source,'Direct/Unknown'), COUNT(*), COALESCE(SUM(total),0)
		FROM paid_orders
		GROUP BY 1 ORDER BY 2 DESC LIMIT 10
	`)
	bySource := []map[string]any{}
	for srcRows.Next() {
		var src string
		var cnt int
		var rev float64
		srcRows.Scan(&src, &cnt, &rev)
		bySource = append(bySource, map[string]any{"source": src, "orders": cnt, "revenue": rev})
	}
	srcRows.Close()

	// Top 10 buyers by order count
	buyerRows, _ := db.Query(ctx, `
		SELECT customer_email, COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
		FROM paid_orders
		WHERE customer_email IS NOT NULL AND customer_email != ''
		GROUP BY customer_email ORDER BY orders DESC LIMIT 10
	`)
	topBuyers := []map[string]any{}
	for buyerRows.Next() {
		var email string
		var cnt int
		var rev float64
		buyerRows.Scan(&email, &cnt, &rev)
		topBuyers = append(topBuyers, map[string]any{"email": email, "orders": cnt, "revenue": rev})
	}
	buyerRows.Close()

	// Top 10 buyers across multiple stores
	multiRows, _ := db.Query(ctx, `
		SELECT customer_email, COUNT(DISTINCT hosting_id) as stores,
		       COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
		FROM paid_orders
		WHERE customer_email IS NOT NULL AND customer_email != ''
		GROUP BY customer_email
		HAVING COUNT(DISTINCT hosting_id) > 1
		ORDER BY stores DESC, orders DESC LIMIT 10
	`)
	multiStoreBuyers := []map[string]any{}
	for multiRows.Next() {
		var email string
		var stores, cnt int
		var rev float64
		multiRows.Scan(&email, &stores, &cnt, &rev)
		multiStoreBuyers = append(multiStoreBuyers, map[string]any{
			"email": email, "stores": stores, "orders": cnt, "revenue": rev,
		})
	}
	multiRows.Close()

	// Revenue by currency (all time)
	currRows, _ := db.Query(ctx, `
		SELECT currency, COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
		FROM paid_orders GROUP BY currency ORDER BY revenue DESC
	`)
	byCurrency := []map[string]any{}
	for currRows.Next() {
		var cur string
		var cnt int
		var rev float64
		currRows.Scan(&cur, &cnt, &rev)
		byCurrency = append(byCurrency, map[string]any{"currency": cur, "orders": cnt, "revenue": rev})
	}
	currRows.Close()

	jsonOK(w, map[string]any{
		"overview": map[string]any{
			"total_orders":     totalOrders,
			"total_revenue":    totalRevenue,
			"unique_customers": uniqueCustomers,
			"avg_order_value":  avgOrderValue,
		},
		"orders_per_day":       ordersPerDay,
		"orders_per_hour":      ordersPerHour,
		"by_payment_method":    byPM,
		"by_traffic_source":    bySource,
		"top_buyers":           topBuyers,
		"multi_store_buyers":   multiStoreBuyers,
		"by_currency":          byCurrency,
	})
}
