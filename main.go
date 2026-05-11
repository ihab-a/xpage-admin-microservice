package main

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

//go:embed all:front/dist
var frontendFS embed.FS

func main() {
	cfg := loadConfig()
	ctx := context.Background()

	if err := initDB(ctx, cfg.DatabaseURL); err != nil {
		log.Fatalf("db init failed: %v", err)
	}
	log.Println("database ready")

	if err := seedAdmin(ctx, cfg); err != nil {
		log.Printf("warn: seed admin failed: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// Ingest endpoint — called by the Laravel backend
	r.Group(func(r chi.Router) {
		r.Use(IngestAuth(cfg.IngestSecret))
		r.Post("/api/v1/ingest/order", handleIngestOrder)
	})

	// Admin API
	r.Post("/api/v1/auth/login", handleLogin)
	r.Group(func(r chi.Router) {
		r.Use(AdminAuth)
		r.Delete("/api/v1/auth/logout", handleLogout)
		r.Get("/api/v1/auth/me", handleMe)
		r.Get("/api/v1/orders", handleListOrders)
		r.Get("/api/v1/orders/stats", handleOrderStats)
	})

	// Serve React SPA for everything else
	r.Get("/*", spaHandler())

	log.Printf("listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		log.Fatal(err)
	}
}

func spaHandler() http.HandlerFunc {
	distFS, err := fs.Sub(frontendFS, "front/dist")
	if err != nil {
		log.Fatal("frontend embed error: ", err)
	}
	fileServer := http.FileServer(http.FS(distFS))

	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")

		// Try to open the file; fall back to index.html for SPA routing
		f, err := distFS.Open(path)
		if err != nil {
			// Serve index.html
			index, _ := frontendFS.ReadFile("front/dist/index.html")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(index)
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonOK(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
