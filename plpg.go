package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type PlpgIngestPayload struct {
	Source            string `json:"source"`
	UserID            string `json:"user_id"`
	MaxPerHour        int    `json:"max_per_hour"`
	MaxPerUserPerHour int    `json:"max_per_user_per_hour"`
	RequestedAt       *int64 `json:"requested_at"`
}

func handleIngestPlpgRequest(w http.ResponseWriter, r *http.Request) {
	var p PlpgIngestPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		jsonError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if p.Source == "" || p.UserID == "" {
		jsonError(w, "source and user_id are required", http.StatusBadRequest)
		return
	}

	reqAt := time.Now()
	if p.RequestedAt != nil {
		reqAt = time.Unix(*p.RequestedAt, 0)
	}

	_, err := db.Exec(r.Context(), `
		INSERT INTO plpg_sources (name, max_per_hour, max_per_user_per_hour, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (name) DO UPDATE SET
			max_per_hour          = EXCLUDED.max_per_hour,
			max_per_user_per_hour = EXCLUDED.max_per_user_per_hour,
			updated_at            = NOW()
	`, p.Source, p.MaxPerHour, p.MaxPerUserPerHour)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	_, err = db.Exec(r.Context(), `
		INSERT INTO plpg_requests (source, user_id, requested_at)
		VALUES ($1, $2, $3)
	`, p.Source, p.UserID, reqAt)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{"ok": true})
}

func handlePlpgSources(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(r.Context(), `
		SELECT name, max_per_hour, max_per_user_per_hour, updated_at, created_at
		FROM plpg_sources ORDER BY name
	`)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Source struct {
		Name              string    `json:"name"`
		MaxPerHour        int       `json:"max_per_hour"`
		MaxPerUserPerHour int       `json:"max_per_user_per_hour"`
		UpdatedAt         time.Time `json:"updated_at"`
		CreatedAt         time.Time `json:"created_at"`
	}

	sources := []Source{}
	for rows.Next() {
		var s Source
		if err := rows.Scan(&s.Name, &s.MaxPerHour, &s.MaxPerUserPerHour, &s.UpdatedAt, &s.CreatedAt); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		sources = append(sources, s)
	}

	jsonOK(w, map[string]any{"data": sources})
}

func handlePlpgUsage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	granularity := q.Get("granularity")
	fromStr := q.Get("from")
	toStr := q.Get("to")
	source := q.Get("source")

	var truncExpr string
	switch granularity {
	case "hour":
		truncExpr = "date_trunc('hour', requested_at AT TIME ZONE 'UTC')"
	case "month":
		truncExpr = "date_trunc('month', requested_at AT TIME ZONE 'UTC')"
	case "year":
		truncExpr = "date_trunc('year', requested_at AT TIME ZONE 'UTC')"
	default:
		truncExpr = "date_trunc('day', requested_at AT TIME ZONE 'UTC')"
	}

	from := time.Now().AddDate(0, -1, 0)
	to := time.Now()
	if fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			from = t
		}
	}
	if toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			to = t
		}
	}

	args := []any{from, to}
	extraCond := ""
	if source != "" {
		extraCond = " AND source = $3"
		args = append(args, source)
	}

	sql := fmt.Sprintf(`
		SELECT
			source,
			EXTRACT(EPOCH FROM %s)::bigint AS ts,
			COUNT(*)::bigint AS count
		FROM plpg_requests
		WHERE requested_at >= $1 AND requested_at <= $2%s
		GROUP BY source, ts
		ORDER BY source, ts
	`, truncExpr, extraCond)

	rows, err := db.Query(r.Context(), sql, args...)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Bucket struct {
		Source string `json:"source"`
		Ts     int64  `json:"ts"`
		Count  int64  `json:"count"`
	}

	buckets := []Bucket{}
	for rows.Next() {
		var b Bucket
		if err := rows.Scan(&b.Source, &b.Ts, &b.Count); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		buckets = append(buckets, b)
	}

	jsonOK(w, map[string]any{"data": buckets})
}
