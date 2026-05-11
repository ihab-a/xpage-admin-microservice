package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request", http.StatusBadRequest)
		return
	}

	var (
		adminID      string
		name         string
		email        string
		passwordHash string
		createdAt    time.Time
	)
	err := db.QueryRow(r.Context(),
		`SELECT id, name, email, password, created_at FROM admins WHERE email = $1`,
		strings.ToLower(strings.TrimSpace(body.Email)),
	).Scan(&adminID, &name, &email, &passwordHash, &createdAt)

	if err != nil || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)) != nil {
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	rawToken := make([]byte, 48)
	if _, err := rand.Read(rawToken); err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	tokenStr := hex.EncodeToString(rawToken)
	tokenHash := sha256hex(tokenStr)
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	_, err = db.Exec(r.Context(),
		`INSERT INTO admin_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		adminID, tokenHash, expiresAt,
	)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"token": tokenStr,
		"admin": Admin{ID: adminID, Name: name, Email: email, CreatedAt: createdAt.Unix()},
	})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if raw != "" {
		db.Exec(r.Context(), `DELETE FROM admin_tokens WHERE token_hash = $1`, sha256hex(raw))
	}
	jsonOK(w, map[string]any{"message": "logged out"})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, currentAdmin(r))
}

func seedAdmin(ctx context.Context, cfg Config) error {
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return nil
	}

	var count int
	db.QueryRow(ctx, `SELECT COUNT(*) FROM admins WHERE email = $1`, strings.ToLower(cfg.AdminEmail)).Scan(&count)
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = db.Exec(ctx,
		`INSERT INTO admins (name, email, password) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
		cfg.AdminName, strings.ToLower(cfg.AdminEmail), string(hash),
	)
	return err
}
