package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
)

func laravelProxy(w http.ResponseWriter, r *http.Request, method, path string, body io.Reader, bodyBytes []byte) {
	if globalCfg.LaravelURL == "" {
		jsonError(w, "laravel integration not configured", http.StatusServiceUnavailable)
		return
	}

	target := globalCfg.LaravelURL + path

	req, err := http.NewRequestWithContext(r.Context(), method, target, body)
	if err != nil {
		jsonError(w, "failed to build request: "+err.Error(), http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	if globalCfg.HMACSecret != "" {
		mac := hmac.New(sha256.New, []byte(globalCfg.HMACSecret))
		mac.Write(bodyBytes)
		req.Header.Set("X-Signature", hex.EncodeToString(mac.Sum(nil)))
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		jsonError(w, "upstream error: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

func forwardQueryToLaravel(w http.ResponseWriter, r *http.Request, laravelPath string, allowedParams []string) {
	src := r.URL.Query()
	fwd := url.Values{}
	for _, k := range allowedParams {
		if v := src.Get(k); v != "" {
			fwd.Set(k, v)
		}
	}
	fullPath := laravelPath
	if len(fwd) > 0 {
		fullPath += "?" + fwd.Encode()
	}
	laravelProxy(w, r, http.MethodGet, fullPath, nil, []byte{})
}

func handleListUsers(w http.ResponseWriter, r *http.Request) {
	forwardQueryToLaravel(w, r, "/api/global/admin/users", []string{"page", "per_page", "search", "suspended"})
}

func handleSuspendUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		jsonError(w, "failed to read body", http.StatusBadRequest)
		return
	}
	laravelProxy(w, r, http.MethodPost, "/api/global/admin/user/"+id+"/suspend",
		bytes.NewReader(bodyBytes), bodyBytes)
}

func handleUnsuspendUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	body := []byte("{}")
	laravelProxy(w, r, http.MethodPost, "/api/global/admin/user/"+id+"/unsuspend",
		bytes.NewReader(body), body)
}

func handleListXHostings(w http.ResponseWriter, r *http.Request) {
	forwardQueryToLaravel(w, r, "/api/global/admin/xhostings", []string{"page", "per_page", "search", "suspended", "user_id", "status"})
}

func handleSuspendHosting(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		jsonError(w, "failed to read body", http.StatusBadRequest)
		return
	}
	laravelProxy(w, r, http.MethodPost, "/api/global/admin/hosting/"+id+"/suspend",
		bytes.NewReader(bodyBytes), bodyBytes)
}

func handleUnsuspendHosting(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	body := []byte("{}")
	laravelProxy(w, r, http.MethodPost, "/api/global/admin/hosting/"+id+"/unsuspend",
		bytes.NewReader(body), body)
}
