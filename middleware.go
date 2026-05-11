package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type contextKey string

const ctxAdmin contextKey = "admin"

// IngestAuth verifies the shared secret sent by the Laravel backend.
func IngestAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if token != secret {
				jsonError(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// AdminAuth validates the admin Bearer token against the DB.
func AdminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if raw == "" {
			jsonError(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		hash := sha256hex(raw)

		var admin Admin
		var createdAt time.Time
		err := db.QueryRow(r.Context(), `
			SELECT a.id, a.name, a.email, a.created_at
			FROM admin_tokens t
			JOIN admins a ON a.id = t.admin_id
			WHERE t.token_hash = $1 AND t.expires_at > $2
		`, hash, time.Now()).Scan(&admin.ID, &admin.Name, &admin.Email, &createdAt)

		if err != nil {
			jsonError(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		admin.CreatedAt = createdAt.Unix()

		ctx := context.WithValue(r.Context(), ctxAdmin, admin)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func currentAdmin(r *http.Request) Admin {
	return r.Context().Value(ctxAdmin).(Admin)
}

func sha256hex(s string) string {
	h := sha256.New()
	h.Write([]byte(s))
	return fmt.Sprintf("%x", h.Sum(nil))
}
