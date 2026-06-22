package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// ── Ingest: PLPG request ─────────────────────────────────────────────────────

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

	log.Printf("plpg ingest: source=%q user_id=%q", p.Source, p.UserID)

	if p.Source == "" {
		jsonError(w, "source is required", http.StatusBadRequest)
		return
	}
	if p.UserID == "" {
		p.UserID = "anonymous"
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

// ── Ingest: PLPG claim ───────────────────────────────────────────────────────

type PlpgClaimPayload struct {
	SessionID string `json:"session_id"`
	ClaimedAt *int64 `json:"claimed_at"`
	Source    string `json:"source"`
	UserID    string `json:"user_id"`
}

func handleIngestPlpgClaim(w http.ResponseWriter, r *http.Request) {
	var p PlpgClaimPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		jsonError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if p.SessionID == "" {
		jsonError(w, "session_id is required", http.StatusBadRequest)
		return
	}

	claimedAt := time.Now()
	if p.ClaimedAt != nil {
		claimedAt = time.Unix(*p.ClaimedAt, 0)
	}

	_, err := db.Exec(r.Context(), `
		INSERT INTO plpg_claims (session_id, claimed_at, source, user_id)
		VALUES ($1, $2, $3, $4)
	`, p.SessionID, claimedAt, p.Source, p.UserID)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{"ok": true})
}

// ── Sources ──────────────────────────────────────────────────────────────────

func handlePlpgSources(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(r.Context(), `
		SELECT
			s.name,
			s.max_per_hour,
			s.max_per_user_per_hour,
			COALESCE(u.cnt, 0) AS current_hour_usage,
			s.updated_at,
			s.created_at
		FROM plpg_sources s
		LEFT JOIN (
			SELECT source, COUNT(*) AS cnt
			FROM plpg_requests
			WHERE requested_at >= date_trunc('hour', NOW() AT TIME ZONE 'UTC')
			  AND requested_at <  date_trunc('hour', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 hour'
			GROUP BY source
		) u ON u.source = s.name
		ORDER BY s.name
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
		CurrentHourUsage  int64     `json:"current_hour_usage"`
		UpdatedAt         time.Time `json:"updated_at"`
		CreatedAt         time.Time `json:"created_at"`
	}

	sources := []Source{}
	for rows.Next() {
		var s Source
		if err := rows.Scan(
			&s.Name, &s.MaxPerHour, &s.MaxPerUserPerHour,
			&s.CurrentHourUsage, &s.UpdatedAt, &s.CreatedAt,
		); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		sources = append(sources, s)
	}

	jsonOK(w, map[string]any{"data": sources})
}

// ── Usage time-series ────────────────────────────────────────────────────────

func handlePlpgUsage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	granularity := q.Get("granularity")
	fromStr := q.Get("from")
	toStr := q.Get("to")
	source := q.Get("source")

	truncExpr := safeTruncExpr(granularity, "requested_at")

	from := time.Now().Add(-24 * time.Hour)
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
			COUNT(*)::bigint                     AS count,
			COUNT(DISTINCT user_id)::bigint      AS unique_users
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
		Source      string `json:"source"`
		Ts          int64  `json:"ts"`
		Count       int64  `json:"count"`
		UniqueUsers int64  `json:"unique_users"`
	}

	buckets := []Bucket{}
	for rows.Next() {
		var b Bucket
		if err := rows.Scan(&b.Source, &b.Ts, &b.Count, &b.UniqueUsers); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		buckets = append(buckets, b)
	}

	jsonOK(w, map[string]any{"data": buckets})
}

// ── Claims time-series ───────────────────────────────────────────────────────

func handlePlpgClaims(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	granularity := q.Get("granularity")
	fromStr := q.Get("from")
	toStr := q.Get("to")
	source := q.Get("source")

	truncExpr := safeTruncExpr(granularity, "claimed_at")

	from := time.Now().Add(-24 * time.Hour)
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
			COUNT(*)::bigint                  AS count,
			COUNT(DISTINCT NULLIF(user_id,''))::bigint AS unique_claimers
		FROM plpg_claims
		WHERE claimed_at >= $1 AND claimed_at <= $2%s
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
		Source         string `json:"source"`
		Ts             int64  `json:"ts"`
		Count          int64  `json:"count"`
		UniqueClaimers int64  `json:"unique_claimers"`
	}

	buckets := []Bucket{}
	for rows.Next() {
		var b Bucket
		if err := rows.Scan(&b.Source, &b.Ts, &b.Count, &b.UniqueClaimers); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		buckets = append(buckets, b)
	}

	jsonOK(w, map[string]any{"data": buckets})
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func safeTruncExpr(granularity, col string) string {
	switch granularity {
	case "hour":
		return fmt.Sprintf("date_trunc('hour', %s AT TIME ZONE 'UTC')", col)
	case "month":
		return fmt.Sprintf("date_trunc('month', %s AT TIME ZONE 'UTC')", col)
	case "year":
		return fmt.Sprintf("date_trunc('year', %s AT TIME ZONE 'UTC')", col)
	default:
		return fmt.Sprintf("date_trunc('day', %s AT TIME ZONE 'UTC')", col)
	}
}
