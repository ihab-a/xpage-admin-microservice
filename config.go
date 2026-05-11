package main

import "os"

type Config struct {
	Port          string
	DatabaseURL   string
	IngestSecret  string
	AdminEmail    string
	AdminPassword string
	AdminName     string
}

func loadConfig() Config {
	return Config{
		Port:          getenv("PORT", "8080"),
		DatabaseURL:   getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/admin_metrics?sslmode=disable"),
		IngestSecret:  mustenv("INGEST_SECRET"),
		AdminEmail:    os.Getenv("ADMIN_EMAIL"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"),
		AdminName:     getenv("ADMIN_NAME", "Admin"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustenv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic("required env var not set: " + key)
	}
	return v
}
