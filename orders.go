package main

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const orderSelectCols = `
	id, hosting_id, hosting_name, order_id, order_ref,
	payment_method, total, discount, currency,
	card_last4, card_brand,
	customer_first_name, customer_last_name, customer_email, customer_phone,
	customer_address, customer_city, customer_state, customer_postal_code,
	shipping_rate, shipping_name, traffic_source, discount_code, tip,
	landing_page_url, products, paid_at, created_at`

func scanOrder(scan func(...any) error) (PaidOrder, error) {
	var o PaidOrder
	var productsStr string
	var paidAtTime *time.Time
	var createdAtTime time.Time
	err := scan(
		&o.ID, &o.HostingID, &o.HostingName, &o.OrderID, &o.OrderRef,
		&o.PaymentMethod, &o.Total, &o.Discount, &o.Currency,
		&o.CardLast4, &o.CardBrand,
		&o.CustomerFirstName, &o.CustomerLastName, &o.CustomerEmail, &o.CustomerPhone,
		&o.CustomerAddress, &o.CustomerCity, &o.CustomerState, &o.CustomerPostalCode,
		&o.ShippingRate, &o.ShippingName, &o.TrafficSource, &o.DiscountCode, &o.Tip,
		&o.LandingPageURL, &productsStr, &paidAtTime, &createdAtTime,
	)
	if err != nil {
		return o, err
	}
	if paidAtTime != nil {
		ts := paidAtTime.Unix()
		o.PaidAt = &ts
	}
	o.CreatedAt = createdAtTime.Unix()
	o.Products = json.RawMessage(productsStr)
	o.PaymentMethodLabel = paymentMethodLabel(o.PaymentMethod)
	return o, nil
}

func handleListOrders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("search"))
	pmFilter := q.Get("payment_method")
	page := intParam(q.Get("page"), 1)
	perPage := intParam(q.Get("per_page"), 25)
	if perPage > 100 {
		perPage = 100
	}
	offset := (page - 1) * perPage

	args := []any{}
	where := []string{}
	n := 1

	if search != "" {
		where = append(where, "search_vector @@ plainto_tsquery('english', $"+strconv.Itoa(n)+")")
		args = append(args, search)
		n++
	}

	if pm, err := strconv.Atoi(pmFilter); err == nil && pm >= 1 && pm <= 3 {
		where = append(where, "payment_method = $"+strconv.Itoa(n))
		args = append(args, pm)
		n++
	}

	if hostingID := q.Get("hosting_id"); hostingID != "" {
		where = append(where, "hosting_id = $"+strconv.Itoa(n)+"::uuid")
		args = append(args, hostingID)
		n++
	}

	clause := ""
	if len(where) > 0 {
		clause = "WHERE " + strings.Join(where, " AND ")
	}

	var total int
	db.QueryRow(r.Context(), "SELECT COUNT(*) FROM paid_orders "+clause, args...).Scan(&total)

	listArgs := append(args, perPage, offset)
	rows, err := db.Query(r.Context(),
		`SELECT `+orderSelectCols+` FROM paid_orders `+clause+
			` ORDER BY paid_at DESC NULLS LAST LIMIT $`+strconv.Itoa(n)+` OFFSET $`+strconv.Itoa(n+1),
		listArgs...,
	)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	orders := []PaidOrder{}
	for rows.Next() {
		o, err := scanOrder(rows.Scan)
		if err != nil {
			continue
		}
		o.Products = nil // omit products from list — load on detail page
		orders = append(orders, o)
	}

	pages := int(math.Ceil(float64(total) / float64(perPage)))
	jsonOK(w, map[string]any{
		"data": orders,
		"meta": map[string]any{
			"total":    total,
			"page":     page,
			"per_page": perPage,
			"pages":    pages,
		},
	})
}

func handleShowOrder(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	row := db.QueryRow(r.Context(),
		`SELECT `+orderSelectCols+` FROM paid_orders WHERE id = $1`, id,
	)
	o, err := scanOrder(row.Scan)
	if err != nil {
		jsonError(w, "order not found", http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]any{"data": o})
}

func handleOrderStats(w http.ResponseWriter, r *http.Request) {
	var totalOrders int
	var totalRevenue float64
	var totalHostings int
	db.QueryRow(r.Context(),
		`SELECT COUNT(*), COALESCE(SUM(total),0), COUNT(DISTINCT hosting_id) FROM paid_orders`,
	).Scan(&totalOrders, &totalRevenue, &totalHostings)

	pmRows, _ := db.Query(r.Context(), `
		SELECT payment_method, COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
		FROM paid_orders GROUP BY payment_method ORDER BY orders DESC
	`)
	byPM := []map[string]any{}
	for pmRows.Next() {
		var pm int
		var cnt int
		var rev float64
		pmRows.Scan(&pm, &cnt, &rev)
		byPM = append(byPM, map[string]any{
			"payment_method":       pm,
			"payment_method_label": paymentMethodLabel(pm),
			"orders":               cnt,
			"revenue":              rev,
		})
	}
	pmRows.Close()

	monthRows, _ := db.Query(r.Context(), `
		SELECT TO_CHAR(paid_at AT TIME ZONE 'UTC','YYYY-MM') as month,
		       COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
		FROM paid_orders
		WHERE paid_at >= NOW() - INTERVAL '12 months'
		GROUP BY month ORDER BY month
	`)
	monthly := []map[string]any{}
	for monthRows.Next() {
		var month string
		var cnt int
		var rev float64
		monthRows.Scan(&month, &cnt, &rev)
		monthly = append(monthly, map[string]any{"month": month, "orders": cnt, "revenue": rev})
	}
	monthRows.Close()

	topRows, _ := db.Query(r.Context(), `
		SELECT COALESCE(hosting_name,'Unknown'), COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
		FROM paid_orders GROUP BY hosting_name ORDER BY revenue DESC LIMIT 10
	`)
	topHostings := []map[string]any{}
	for topRows.Next() {
		var name string
		var cnt int
		var rev float64
		topRows.Scan(&name, &cnt, &rev)
		topHostings = append(topHostings, map[string]any{"hosting_name": name, "orders": cnt, "revenue": rev})
	}
	topRows.Close()

	jsonOK(w, map[string]any{
		"overview":          map[string]any{"total_orders": totalOrders, "total_revenue": totalRevenue, "total_hostings": totalHostings},
		"by_payment_method": byPM,
		"monthly":           monthly,
		"top_hostings":      topHostings,
	})
}

func intParam(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil && v > 0 {
		return v
	}
	return def
}
