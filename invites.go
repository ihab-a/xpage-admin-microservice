package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
)

const (
	inviteSent     = "sent"      // invite created and the email went out
	inviteLinkOnly = "link_only" // invite created, but the email failed — the link still works
	inviteFailed   = "failed"    // no invite was created
)

type sendInvitesRequest struct {
	Emails []string `json:"emails"`
}

type inviteResult struct {
	Email    string `json:"email"`
	Status   string `json:"status"`
	InviteID string `json:"invite_id,omitempty"`
	URL      string `json:"url,omitempty"`
	MaxUses  int    `json:"max_uses,omitempty"`
	Error    string `json:"error,omitempty"`
}

// inviteBatch mirrors the redis backed progress xPage keeps for a queued batch.
type inviteBatch struct {
	ID         string         `json:"id"`
	Status     string         `json:"status"`
	Total      int            `json:"total"`
	Processed  int            `json:"processed"`
	Sent       int            `json:"sent"`
	LinkOnly   int            `json:"link_only"`
	Failed     int            `json:"failed"`
	CreatedAt  int64          `json:"created_at"`
	FinishedAt *int64         `json:"finished_at"`
	Error      *string        `json:"error"`
	Results    []inviteResult `json:"results"`
	NextOffset int            `json:"next_offset"`
}

// handleSendDropInvites hands the whole batch of addresses to xPage, which
// queues a job to issue the invites and send the beta access emails. The reply
// is a batch id: progress is followed through handleDropInviteBatch.
func handleSendDropInvites(w http.ResponseWriter, r *http.Request) {
	var req sendInvitesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Emails) == 0 {
		jsonError(w, "no email addresses given", http.StatusBadRequest)
		return
	}

	payload, err := json.Marshal(map[string]any{"emails": req.Emails})
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	status, body, err := laravelCall(r.Context(), http.MethodPost, "/api/global/admin/drop/invite/send", payload)
	if err != nil {
		jsonError(w, "invite service unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	if status < 200 || status >= 300 {
		jsonError(w, laravelErrorMessage(body, status), status)
		return
	}

	var queued struct {
		Batch inviteBatch `json:"batch"`
	}
	if err := json.Unmarshal(body, &queued); err != nil || queued.Batch.ID == "" {
		jsonError(w, "unexpected upstream response", http.StatusBadGateway)
		return
	}

	jsonOK(w, map[string]any{"batch": queued.Batch})
}

type createLinkRequest struct {
	Email string `json:"email"`
	Uses  int    `json:"uses"`
}

// handleCreateDropInviteLink creates a single invite link that may be redeemed
// as many times as asked for. Nothing is emailed and nothing is queued: the
// link comes straight back, and is recorded here as link_only since that is
// exactly what it is.
func handleCreateDropInviteLink(w http.ResponseWriter, r *http.Request) {
	var req createLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Email == "" {
		jsonError(w, "an email or label is required", http.StatusBadRequest)
		return
	}
	if req.Uses < 1 {
		req.Uses = 1
	}

	payload, err := json.Marshal(map[string]any{"email": req.Email, "uses": req.Uses})
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	status, body, err := laravelCall(r.Context(), http.MethodPost, "/api/global/admin/drop/invite", payload)
	if err != nil {
		jsonError(w, "invite service unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	if status < 200 || status >= 300 {
		jsonError(w, laravelErrorMessage(body, status), status)
		return
	}

	var created struct {
		URL    string `json:"url"`
		Invite struct {
			ID      string `json:"id"`
			Email   string `json:"email"`
			MaxUses int    `json:"max_uses"`
		} `json:"invite"`
	}
	if err := json.Unmarshal(body, &created); err != nil || created.URL == "" {
		jsonError(w, "invite service returned no link", http.StatusBadGateway)
		return
	}

	result := inviteResult{
		Email:    created.Invite.Email,
		Status:   inviteLinkOnly,
		InviteID: created.Invite.ID,
		URL:      created.URL,
		MaxUses:  created.Invite.MaxUses,
	}
	recordSentInvite(r.Context(), result, currentAdmin(r).Email)

	jsonOK(w, map[string]any{"link": result})
}

// handleDropInviteBatch reports how far a queued batch has got. Every result it
// sees is recorded on the way through, since the links it carries exist nowhere
// else - xPage only keeps a hash of each code.
func handleDropInviteBatch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	path := "/api/global/admin/drop/invite/batch/" + url.PathEscape(id)
	if after := r.URL.Query().Get("after"); after != "" {
		path += "?after=" + url.QueryEscape(after)
	}

	status, body, err := laravelCall(r.Context(), http.MethodGet, path, []byte{})
	if err != nil {
		jsonError(w, "upstream error: "+err.Error(), http.StatusBadGateway)
		return
	}
	if status < 200 || status >= 300 {
		jsonError(w, laravelErrorMessage(body, status), status)
		return
	}

	var polled struct {
		Batch inviteBatch `json:"batch"`
	}
	if err := json.Unmarshal(body, &polled); err != nil {
		jsonError(w, "unexpected upstream response", http.StatusBadGateway)
		return
	}

	admin := currentAdmin(r)
	for _, res := range polled.Batch.Results {
		recordSentInvite(r.Context(), res, admin.Email)
	}

	jsonOK(w, map[string]any{"batch": polled.Batch})
}

// handleListDropInvites returns xPage's invite list — the source of truth for
// whether an invite was accepted — with the invite link and delivery outcome
// this service recorded when the batch was sent.
func handleListDropInvites(w http.ResponseWriter, r *http.Request) {
	src := r.URL.Query()
	fwd := url.Values{}
	for _, k := range []string{"page", "page_size"} {
		if v := src.Get(k); v != "" {
			fwd.Set(k, v)
		}
	}

	path := "/api/global/admin/drop/invite"
	if len(fwd) > 0 {
		path += "?" + fwd.Encode()
	}

	status, body, err := laravelCall(r.Context(), http.MethodGet, path, []byte{})
	if err != nil {
		jsonError(w, "upstream error: "+err.Error(), http.StatusBadGateway)
		return
	}
	if status < 200 || status >= 300 {
		jsonError(w, laravelErrorMessage(body, status), status)
		return
	}

	var listed struct {
		Data      []map[string]any `json:"data"`
		Paginator map[string]any   `json:"paginator"`
	}
	if err := json.Unmarshal(body, &listed); err != nil {
		jsonError(w, "unexpected upstream response", http.StatusBadGateway)
		return
	}

	ids := make([]string, 0, len(listed.Data))
	for _, row := range listed.Data {
		if id, ok := row["id"].(string); ok {
			ids = append(ids, id)
		}
	}

	local := localInvites(r.Context(), ids)
	for _, row := range listed.Data {
		id, _ := row["id"].(string)
		rec, ok := local[id]
		if !ok {
			continue
		}
		row["url"] = rec.URL
		row["email_status"] = rec.EmailStatus
		row["email_error"] = rec.EmailError
		row["sent_by"] = rec.SentBy
		row["sent_at"] = rec.SentAt
	}

	jsonOK(w, map[string]any{
		"data":      listed.Data,
		"paginator": listed.Paginator,
	})
}

// handleDropInviteStats merges xPage's acceptance figures with the delivery
// failures only this service knows about.
func handleDropInviteStats(w http.ResponseWriter, r *http.Request) {
	status, body, err := laravelCall(r.Context(), http.MethodGet, "/api/global/admin/drop/invite/stats", []byte{})
	if err != nil {
		jsonError(w, "upstream error: "+err.Error(), http.StatusBadGateway)
		return
	}
	if status < 200 || status >= 300 {
		jsonError(w, laravelErrorMessage(body, status), status)
		return
	}

	var upstream struct {
		Stats map[string]any `json:"stats"`
	}
	if err := json.Unmarshal(body, &upstream); err != nil || upstream.Stats == nil {
		jsonError(w, "unexpected upstream response", http.StatusBadGateway)
		return
	}

	var undelivered int
	if err := db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM drop_invites WHERE email_status <> $1`, inviteSent,
	).Scan(&undelivered); err != nil {
		log.Printf("drop invites: count undelivered failed: %v", err)
	}
	upstream.Stats["undelivered_emails"] = undelivered

	jsonOK(w, map[string]any{"stats": upstream.Stats})
}

func handleRevokeDropInvite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	status, body, err := laravelCall(r.Context(), http.MethodDelete, "/api/global/admin/drop/invite/"+url.PathEscape(id), []byte{})
	if err != nil {
		jsonError(w, "upstream error: "+err.Error(), http.StatusBadGateway)
		return
	}
	if status < 200 || status >= 300 {
		jsonError(w, laravelErrorMessage(body, status), status)
		return
	}

	if _, err := db.Exec(r.Context(), `DELETE FROM drop_invites WHERE invite_id = $1`, id); err != nil {
		log.Printf("drop invites: delete local record %s failed: %v", id, err)
	}

	jsonOK(w, map[string]any{"ok": true})
}

type localInvite struct {
	URL         string  `json:"url"`
	EmailStatus string  `json:"email_status"`
	EmailError  *string `json:"email_error"`
	SentBy      *string `json:"sent_by"`
	SentAt      int64   `json:"sent_at"`
}

func recordSentInvite(ctx context.Context, res inviteResult, sentBy string) {
	if res.InviteID == "" {
		return
	}

	var mailErr *string
	if res.Error != "" {
		mailErr = &res.Error
	}

	_, err := db.Exec(ctx, `
		INSERT INTO drop_invites (invite_id, email, url, email_status, email_error, sent_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (invite_id) DO UPDATE SET
			url          = EXCLUDED.url,
			email_status = EXCLUDED.email_status,
			email_error  = EXCLUDED.email_error,
			sent_by      = EXCLUDED.sent_by
	`, res.InviteID, res.Email, res.URL, res.Status, mailErr, sentBy)

	if err != nil {
		// the invite is already out; losing the local copy only costs us the
		// link and the delivery outcome in the UI
		log.Printf("drop invites: record %s failed: %v", res.InviteID, err)
	}
}

func localInvites(ctx context.Context, ids []string) map[string]localInvite {
	out := map[string]localInvite{}
	if len(ids) == 0 {
		return out
	}

	rows, err := db.Query(ctx, `
		SELECT invite_id, url, email_status, email_error, sent_by, created_at
		FROM drop_invites
		WHERE invite_id = ANY($1)
	`, ids)
	if err != nil {
		log.Printf("drop invites: load local records failed: %v", err)
		return out
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var rec localInvite
		var sentAt any

		if err := rows.Scan(&id, &rec.URL, &rec.EmailStatus, &rec.EmailError, &rec.SentBy, &sentAt); err != nil {
			log.Printf("drop invites: scan local record failed: %v", err)
			continue
		}
		if t, ok := sentAt.(interface{ Unix() int64 }); ok {
			rec.SentAt = t.Unix()
		}

		out[id] = rec
	}

	return out
}

// laravelErrorMessage pulls the human readable part out of an xPage error body.
// Validation failures carry their detail per field, and "Validation failed" on
// its own tells whoever is looking at the admin nothing, so those get appended.
func laravelErrorMessage(body []byte, status int) string {
	var payload struct {
		Message          string              `json:"message"`
		Error            string              `json:"error"`
		ValidationErrors map[string][]string `json:"validationErrors"`
	}

	if err := json.Unmarshal(body, &payload); err == nil {
		message := payload.Message
		if message == "" {
			message = payload.Error
		}

		if len(payload.ValidationErrors) > 0 {
			fields := make([]string, 0, len(payload.ValidationErrors))
			for field, messages := range payload.ValidationErrors {
				if len(messages) > 0 {
					fields = append(fields, field+": "+messages[0])
				}
			}
			sort.Strings(fields) // map order is random, the message should not be
			detail := strings.Join(fields, "; ")

			if message == "" {
				return detail
			}
			return message + " — " + detail
		}

		if message != "" {
			return message
		}
	}

	return fmt.Sprintf("invite service returned %d", status)
}
