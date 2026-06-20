package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ── Ingest ───────────────────────────────────────────────────────────────────

type AiMetricIngestPayload struct {
	TsMs           int64   `json:"ts"`
	Provider       string  `json:"provider"`
	Model          string  `json:"model"`
	Mode           string  `json:"mode"`
	InputTokens    int     `json:"input_tokens"`
	OutputTokens   int     `json:"output_tokens"`
	ThinkingTokens int     `json:"thinking_tokens"`
	DurationMs     int     `json:"duration_ms"`
	IsError        bool    `json:"is_error"`
	ErrorMessage   *string `json:"error_message"`
	ErrorCode      *string `json:"error_code"`
}

func handleIngestAiMetric(w http.ResponseWriter, r *http.Request) {
	var p AiMetricIngestPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		jsonError(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if p.Provider == "" || p.Model == "" {
		jsonError(w, "provider and model are required", http.StatusBadRequest)
		return
	}

	ts := time.Now()
	if p.TsMs > 0 {
		ts = time.UnixMilli(p.TsMs)
	}

	_, err := db.Exec(r.Context(), `
		INSERT INTO ai_metric_events (
			ts, provider, model, mode,
			input_tokens, output_tokens, thinking_tokens,
			duration_ms, is_error, error_message, error_code
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`,
		ts, p.Provider, p.Model, p.Mode,
		p.InputTokens, p.OutputTokens, p.ThinkingTokens,
		p.DurationMs, p.IsError, p.ErrorMessage, p.ErrorCode,
	)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{"ok": true})
}

// ── Stats ────────────────────────────────────────────────────────────────────

func aiTruncExpr(granularity string) string {
	switch granularity {
	case "minute":
		return "date_trunc('minute', ts AT TIME ZONE 'UTC')"
	case "hour":
		return "date_trunc('hour', ts AT TIME ZONE 'UTC')"
	default:
		return "date_trunc('day', ts AT TIME ZONE 'UTC')"
	}
}

type AiStatsBucket struct {
	Ts             int64  `json:"ts"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	Requests       int64  `json:"requests"`
	Errors         int64  `json:"errors"`
	InputTokens    int64  `json:"input_tokens"`
	OutputTokens   int64  `json:"output_tokens"`
	ThinkingTokens int64  `json:"thinking_tokens"`
	DurationMsSum  int64  `json:"duration_ms_sum"`
	DurationCount  int64  `json:"duration_count"`
}

type AiModeBreakdown struct {
	Mode           string `json:"mode"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	InputTokens    int64  `json:"input_tokens"`
	OutputTokens   int64  `json:"output_tokens"`
	ThinkingTokens int64  `json:"thinking_tokens"`
	DurationMsSum  int64  `json:"duration_ms_sum"`
	DurationCount  int64  `json:"duration_count"`
}

type AiStatsSummary struct {
	TotalRequests       int64 `json:"total_requests"`
	TotalErrors         int64 `json:"total_errors"`
	TotalInputTokens    int64 `json:"total_input_tokens"`
	TotalOutputTokens   int64 `json:"total_output_tokens"`
	TotalThinkingTokens int64 `json:"total_thinking_tokens"`
	TotalDurationMsSum  int64 `json:"total_duration_ms_sum"`
	TotalDurationCount  int64 `json:"total_duration_count"`
}

func handleAiStats(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	granularity := q.Get("granularity")
	fromStr := q.Get("from")
	toStr := q.Get("to")
	provider := q.Get("provider")
	model := q.Get("model")

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

	truncExpr := aiTruncExpr(granularity)

	// Build dynamic WHERE clause for optional filters
	conditions := []string{"ts >= $1", "ts <= $2"}
	args := []any{from, to}
	argIdx := 3

	if provider != "" {
		conditions = append(conditions, fmt.Sprintf("provider = $%d", argIdx))
		args = append(args, provider)
		argIdx++
	}
	if model != "" {
		conditions = append(conditions, fmt.Sprintf("model = $%d", argIdx))
		args = append(args, model)
		argIdx++
	}
	where := strings.Join(conditions, " AND ")

	statsSQL := fmt.Sprintf(`
		SELECT
			EXTRACT(EPOCH FROM %s)::bigint AS ts,
			provider, model,
			COUNT(*) AS requests,
			SUM(CASE WHEN is_error THEN 1 ELSE 0 END) AS errors,
			COALESCE(SUM(input_tokens),    0) AS input_tokens,
			COALESCE(SUM(output_tokens),   0) AS output_tokens,
			COALESCE(SUM(thinking_tokens), 0) AS thinking_tokens,
			COALESCE(SUM(CASE WHEN NOT is_error AND duration_ms > 0 THEN duration_ms ELSE 0 END), 0) AS duration_ms_sum,
			COALESCE(SUM(CASE WHEN NOT is_error AND duration_ms > 0 THEN 1 ELSE 0 END),           0) AS duration_count
		FROM ai_metric_events
		WHERE %s
		GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
	`, truncExpr, where)

	rows, err := db.Query(r.Context(), statsSQL, args...)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	data := []AiStatsBucket{}
	modelsSet := map[string]bool{}
	providersSet := map[string]bool{}
	var summary AiStatsSummary

	for rows.Next() {
		var b AiStatsBucket
		if err := rows.Scan(
			&b.Ts, &b.Provider, &b.Model,
			&b.Requests, &b.Errors,
			&b.InputTokens, &b.OutputTokens, &b.ThinkingTokens,
			&b.DurationMsSum, &b.DurationCount,
		); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		data = append(data, b)
		modelsSet[b.Model] = true
		providersSet[b.Provider] = true
		summary.TotalRequests += b.Requests
		summary.TotalErrors += b.Errors
		summary.TotalInputTokens += b.InputTokens
		summary.TotalOutputTokens += b.OutputTokens
		summary.TotalThinkingTokens += b.ThinkingTokens
		summary.TotalDurationMsSum += b.DurationMsSum
		summary.TotalDurationCount += b.DurationCount
	}
	rows.Close()

	// Mode breakdown (no time bucket, group by mode + provider + model)
	modeSQL := fmt.Sprintf(`
		SELECT mode, provider, model,
			COALESCE(SUM(input_tokens),    0),
			COALESCE(SUM(output_tokens),   0),
			COALESCE(SUM(thinking_tokens), 0),
			COALESCE(SUM(CASE WHEN NOT is_error AND duration_ms > 0 THEN duration_ms ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN NOT is_error AND duration_ms > 0 THEN 1 ELSE 0 END),           0)
		FROM ai_metric_events
		WHERE %s AND mode != ''
		GROUP BY 1, 2, 3
		ORDER BY SUM(input_tokens + output_tokens + thinking_tokens) DESC
	`, where)

	modeRows, err := db.Query(r.Context(), modeSQL, args...)
	if err != nil {
		jsonError(w, "db error (mode): "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer modeRows.Close()

	modeBreakdown := []AiModeBreakdown{}
	for modeRows.Next() {
		var m AiModeBreakdown
		if err := modeRows.Scan(
			&m.Mode, &m.Provider, &m.Model,
			&m.InputTokens, &m.OutputTokens, &m.ThinkingTokens,
			&m.DurationMsSum, &m.DurationCount,
		); err != nil {
			jsonError(w, "scan error (mode): "+err.Error(), http.StatusInternalServerError)
			return
		}
		modeBreakdown = append(modeBreakdown, m)
	}

	models := make([]string, 0, len(modelsSet))
	for k := range modelsSet {
		models = append(models, k)
	}
	providers := make([]string, 0, len(providersSet))
	for k := range providersSet {
		providers = append(providers, k)
	}

	jsonOK(w, map[string]any{
		"data":           data,
		"mode_breakdown": modeBreakdown,
		"models":         models,
		"providers":      providers,
		"summary":        summary,
	})
}

// ── Errors ───────────────────────────────────────────────────────────────────

type AiErrorEntry struct {
	TsMs         int64   `json:"ts"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	Mode         string  `json:"mode"`
	ErrorMessage *string `json:"error_message"`
	ErrorCode    *string `json:"error_code"`
}

func handleAiErrors(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	fromStr := q.Get("from")
	toStr := q.Get("to")
	provider := q.Get("provider")
	model := q.Get("model")
	limitStr := q.Get("limit")
	offsetStr := q.Get("offset")

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

	limit := 100
	if v, err := strconv.Atoi(limitStr); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(offsetStr); err == nil && v >= 0 {
		offset = v
	}

	conditions := []string{"is_error = true", "ts >= $1", "ts <= $2"}
	args := []any{from, to}
	argIdx := 3

	if provider != "" {
		conditions = append(conditions, fmt.Sprintf("provider = $%d", argIdx))
		args = append(args, provider)
		argIdx++
	}
	if model != "" {
		conditions = append(conditions, fmt.Sprintf("model = $%d", argIdx))
		args = append(args, model)
		argIdx++
	}
	where := strings.Join(conditions, " AND ")

	var total int64
	db.QueryRow(r.Context(), fmt.Sprintf(
		`SELECT COUNT(*) FROM ai_metric_events WHERE %s`, where,
	), args...).Scan(&total)

	listArgs := append(args, limit, offset)
	rows, err := db.Query(r.Context(), fmt.Sprintf(`
		SELECT
			EXTRACT(EPOCH FROM ts)::bigint * 1000 AS ts_ms,
			provider, model, mode, error_message, error_code
		FROM ai_metric_events
		WHERE %s
		ORDER BY ts DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1), listArgs...)
	if err != nil {
		jsonError(w, "db error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := []AiErrorEntry{}
	for rows.Next() {
		var e AiErrorEntry
		if err := rows.Scan(&e.TsMs, &e.Provider, &e.Model, &e.Mode, &e.ErrorMessage, &e.ErrorCode); err != nil {
			jsonError(w, "scan error: "+err.Error(), http.StatusInternalServerError)
			return
		}
		entries = append(entries, e)
	}

	jsonOK(w, map[string]any{
		"data":  entries,
		"total": total,
	})
}
