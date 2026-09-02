package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	logic "terminal-agent-hub/backend/api/internal/logic/hub"
)

// Authorizer is compatible with a Casbin enforcement adapter: object is the
// stable API path and action is the HTTP method. Production policy keeps the
// V1 role model intentionally limited to admin/user.
type Authorizer interface {
	Enforce(role, object, action string) bool
}
type RoleAuthorizer struct{}

func (RoleAuthorizer) Enforce(role, object, action string) bool {
	return !strings.HasPrefix(object, "/admin") || role == "admin"
}

type Handler struct {
	Store        *logic.Store
	Auth         *logic.AuthService
	Orchestrator *logic.Orchestrator
	Catalog      logic.ProviderCatalog
	Secure       bool
	Authorizer   Authorizer
}

func New(s *logic.Store, a *logic.AuthService, o *logic.Orchestrator, catalog logic.ProviderCatalog, secure bool) http.Handler {
	return &Handler{Store: s, Auth: a, Orchestrator: o, Catalog: catalog, Secure: secure, Authorizer: RoleAuthorizer{}}
}

type errBody struct {
	Error struct {
		Code, Message, RequestID string `json:",omitempty"`
	} `json:"error"`
}

func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func fail(w http.ResponseWriter, e error) {
	status, code := logic.ErrorHTTP(e)
	var b errBody
	b.Error.Code = code
	b.Error.Message = publicMessage(code)
	b.Error.RequestID = requestID()
	jsonOut(w, status, b)
}
func publicMessage(code string) string {
	switch code {
	case "UNAUTHENTICATED":
		return "请先登录"
	case "FORBIDDEN":
		return "无权执行此操作"
	case "MODEL_NOT_AUTHORIZED":
		return "当前用户无权使用该模型"
	case "NOT_FOUND":
		return "资源不存在"
	case "CONVERSATION_BUSY":
		return "会话正在生成"
	case "NO_ACTIVE_GENERATION":
		return "当前没有活动生成"
	case "CONCURRENCY_LIMIT":
		return "并发请求过多"
	case "LOGIN_RATE_LIMITED":
		return "登录尝试过多，请稍后再试"
	default:
		return "服务暂时不可用"
	}
}
func requestID() string { return fmt.Sprintf("req_%d", time.Now().UnixNano()) }
func decode(r *http.Request, v any) error {
	// LimitReader avoids the nil ResponseWriter panic that MaxBytesReader would
	// trigger on an oversized body while keeping request parsing bounded.
	d := json.NewDecoder(io.LimitReader(r.Body, 1<<20+1))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("invalid trailing request data")
	}
	return nil
}
func (h *Handler) cookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/api/v1", HttpOnly: true, Secure: h.Secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}
func (h *Handler) user(r *http.Request) (logic.User, error) {
	c, e := r.Cookie("tah_access")
	if e != nil {
		return logic.User{}, logic.ErrUnauthenticated
	}
	return h.Auth.Me(c.Value)
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	if strings.HasPrefix(path, "/auth/") {
		h.auth(w, r, path)
		return
	}
	u, e := h.user(r)
	if e != nil {
		fail(w, e)
		return
	}
	if strings.HasPrefix(path, "/admin") {
		if h.Authorizer == nil || !h.Authorizer.Enforce(u.Role, path, r.Method) {
			fail(w, logic.ErrForbidden)
			return
		}
		h.admin(w, r, u, strings.TrimPrefix(path, "/admin"))
		return
	}
	h.userRoutes(w, r, u, path)
}
func (h *Handler) auth(w http.ResponseWriter, r *http.Request, path string) {
	switch {
	case r.Method == "POST" && path == "/auth/login":
		var q struct{ Username, Password string }
		if decode(r, &q) != nil {
			jsonOut(w, 400, map[string]string{"error": "invalid request"})
			return
		}
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		s, e := h.Auth.Login(q.Username, q.Password, host)
		if e != nil {
			fail(w, e)
			return
		}
		h.cookie(w, "tah_access", s.Access, 900)
		h.cookie(w, "tah_refresh", s.Refresh, 604800)
		jsonOut(w, 200, map[string]any{"user": safeUser(s.User)})
	case r.Method == "POST" && path == "/auth/refresh":
		c, e := r.Cookie("tah_refresh")
		if e != nil {
			fail(w, logic.ErrUnauthenticated)
			return
		}
		s, e := h.Auth.Refresh(c.Value)
		if e != nil {
			fail(w, e)
			return
		}
		h.cookie(w, "tah_access", s.Access, 900)
		h.cookie(w, "tah_refresh", s.Refresh, 604800)
		jsonOut(w, 200, map[string]any{"user": safeUser(s.User)})
	case r.Method == "POST" && path == "/auth/logout":
		a, _ := r.Cookie("tah_access")
		rf, _ := r.Cookie("tah_refresh")
		av, rv := "", ""
		if a != nil {
			av = a.Value
		}
		if rf != nil {
			rv = rf.Value
		}
		h.Auth.Logout(av, rv)
		h.cookie(w, "tah_access", "", -1)
		h.cookie(w, "tah_refresh", "", -1)
		w.WriteHeader(204)
	case r.Method == "GET" && path == "/auth/me":
		u, e := h.user(r)
		if e != nil {
			fail(w, e)
			return
		}
		jsonOut(w, 200, safeUser(u))
	default:
		fail(w, logic.ErrNotFound)
	}
}
func safeUser(u logic.User) map[string]string {
	return map[string]string{"id": u.ID, "username": u.Username, "role": u.Role, "status": u.Status}
}
func (h *Handler) userRoutes(w http.ResponseWriter, r *http.Request, u logic.User, path string) {
	switch {
	case r.Method == "GET" && path == "/models":
		jsonOut(w, 200, map[string]any{"items": h.Store.EffectiveModels(u.ID)})
	case r.Method == "POST" && path == "/conversations":
		var q struct {
			ModelID string `json:"model_id"`
		}
		if decode(r, &q) != nil {
			jsonOut(w, 400, map[string]string{"error": "invalid request"})
			return
		}
		c, e := h.Store.CreateConversation(u.ID, q.ModelID, "", time.Now().UTC())
		if e != nil {
			fail(w, e)
			return
		}
		jsonOut(w, 201, conversation(c, h.Orchestrator, h.Store))
	case r.Method == "GET" && path == "/conversations":
		items := []any{}
		for _, c := range h.Store.Conversations {
			if c.OwnerID == u.ID && !c.Hidden {
				items = append(items, conversation(c, h.Orchestrator, h.Store))
			}
		}
		jsonOut(w, 200, map[string]any{"items": items})
	case strings.HasPrefix(path, "/conversations/"):
		h.conversation(w, r, u, path)
	case r.Method == "GET" && path == "/usage":
		items := []logic.Usage{}
		for _, x := range h.Store.Usages {
			if x.UserID == u.ID && matchUsage(r, x) {
				items = append(items, x)
			}
		}
		jsonOut(w, 200, map[string]any{"items": items})
	default:
		fail(w, logic.ErrNotFound)
	}
}
func conversation(c logic.Conversation, o *logic.Orchestrator, s *logic.Store) map[string]any {
	status := "active"
	if !s.IsModelEffective(c.OwnerID, c.ModelID) {
		status = "readonly"
	}
	if o != nil && o.IsGenerating(c.ID) {
		status = "generating"
	}
	return map[string]any{"id": c.ID, "model_id": c.ModelID, "title": c.Title, "status": status, "hidden": c.Hidden, "created_at": c.CreatedAt}
}
func (h *Handler) conversation(w http.ResponseWriter, r *http.Request, u logic.User, path string) {
	rest := strings.TrimPrefix(path, "/conversations/")
	parts := strings.Split(rest, "/")
	id := parts[0]
	if len(parts) == 1 {
		switch r.Method {
		case "PATCH":
			var q struct {
				Title string `json:"title"`
			}
			if decode(r, &q) != nil {
				jsonOut(w, 400, nil)
				return
			}
			if e := h.Store.RenameConversation(id, u.ID, q.Title); e != nil {
				fail(w, e)
				return
			}
			jsonOut(w, 200, map[string]bool{"ok": true})
		case "DELETE":
			if e := h.Store.HideConversation(id, u.ID); e != nil {
				fail(w, e)
				return
			}
			w.WriteHeader(204)
		default:
			fail(w, logic.ErrNotFound)
		}
		return
	}
	switch parts[1] {
	case "messages":
		if r.Method == "GET" {
			c, e := h.Store.ConversationForUser(id, u.ID, true)
			if e != nil {
				fail(w, e)
				return
			}
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			if limit < 1 || limit > 100 {
				limit = 50
			}
			p, e := h.Orchestrator.PI.Messages(r.Context(), c.SessionRef, r.URL.Query().Get("since"), limit)
			if e != nil {
				fail(w, logic.ErrPIUnavailable)
				return
			}
			jsonOut(w, 200, p)
			return
		}
		if r.Method == "POST" {
			var q struct {
				Content string `json:"content"`
			}
			if decode(r, &q) != nil || strings.TrimSpace(q.Content) == "" {
				jsonOut(w, 400, nil)
				return
			}
			events, e := h.Orchestrator.Prompt(r.Context(), u.ID, id, q.Content)
			if e != nil {
				fail(w, e)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("X-Accel-Buffering", "no")
			fl, _ := w.(http.Flusher)
			for ev := range events {
				b, _ := json.Marshal(ev)
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, b)
				if fl != nil {
					fl.Flush()
				}
			}
			return
		}
	case "abort":
		if r.Method == "POST" {
			if e := h.Orchestrator.Abort(r.Context(), u.ID, id); e != nil {
				fail(w, e)
				return
			}
			jsonOut(w, 202, map[string]bool{"accepted": true})
			return
		}
	}
	fail(w, logic.ErrNotFound)
}
func matchUsage(r *http.Request, u logic.Usage) bool {
	q := r.URL.Query()
	if q.Get("model_id") != "" && q.Get("model_id") != u.ModelID {
		return false
	}
	if raw := q.Get("from"); raw != "" {
		from, err := time.Parse(time.RFC3339, raw)
		if err != nil || u.StartedAt.Before(from) {
			return false
		}
	}
	if raw := q.Get("to"); raw != "" {
		to, err := time.Parse(time.RFC3339, raw)
		if err != nil || u.StartedAt.After(to) {
			return false
		}
	}
	return true
}

func (h *Handler) admin(w http.ResponseWriter, r *http.Request, u logic.User, path string) {
	switch {
	case path == "/users" && r.Method == "GET":
		items := []map[string]string{}
		for _, x := range h.Store.Users {
			items = append(items, safeUser(x))
		}
		jsonOut(w, 200, map[string]any{"items": items})
	case path == "/users" && r.Method == "POST":
		var q struct{ Username, Password, Role string }
		if decode(r, &q) != nil || q.Username == "" {
			jsonOut(w, 400, nil)
			return
		}
		for _, x := range h.Store.Users {
			if strings.EqualFold(x.Username, q.Username) {
				jsonOut(w, 409, map[string]string{"error": "username exists"})
				return
			}
		}
		hash, e := logic.HashPassword(q.Password)
		if e != nil {
			jsonOut(w, 400, map[string]string{"error": e.Error()})
			return
		}
		if q.Role != "admin" {
			q.Role = "user"
		}
		x := logic.User{ID: requestID(), Username: q.Username, PasswordHash: hash, Role: q.Role, Status: "active"}
		h.Store.Users[x.ID] = x
		if e := h.Store.Persist(); e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		h.Store.AddAudit(logic.Audit{ActorID: u.ID, Action: "user.create", ObjectType: "user", ObjectID: x.ID, Result: "success", TraceID: requestID()})
		jsonOut(w, 201, safeUser(x))
	case strings.HasPrefix(path, "/users/") && strings.HasSuffix(path, "/reset-password") && r.Method == "POST":
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/users/"), "/reset-password")
		var q struct {
			Password string `json:"password"`
		}
		if decode(r, &q) != nil {
			jsonOut(w, 400, nil)
			return
		}
		hash, e := logic.HashPassword(q.Password)
		if e != nil {
			jsonOut(w, 400, map[string]string{"error": e.Error()})
			return
		}
		x, ok := h.Store.Users[id]
		if !ok {
			fail(w, logic.ErrNotFound)
			return
		}
		x.PasswordHash = hash
		h.Store.Users[id] = x
		if e := h.Store.Persist(); e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 204, nil)
	case strings.HasPrefix(path, "/users/") && r.Method == "PATCH":
		id := strings.TrimPrefix(path, "/users/")
		x, ok := h.Store.Users[id]
		if !ok {
			fail(w, logic.ErrNotFound)
			return
		}
		var q struct{ Status, Role string }
		if decode(r, &q) != nil {
			jsonOut(w, 400, nil)
			return
		}
		if q.Status == "active" || q.Status == "disabled" {
			x.Status = q.Status
		}
		if q.Role == "admin" || q.Role == "user" {
			x.Role = q.Role
		}
		h.Store.Users[id] = x
		if e := h.Store.Persist(); e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 200, safeUser(x))
	case path == "/groups" && r.Method == "GET":
		jsonOut(w, 200, map[string]any{"items": h.Store.Groups})
	case strings.HasPrefix(path, "/groups/") && !strings.HasSuffix(path, "/members") && r.Method == "PATCH":
		id := strings.TrimPrefix(path, "/groups/")
		g, ok := h.Store.Groups[id]
		if !ok {
			fail(w, logic.ErrNotFound)
			return
		}
		var q logic.Group
		if decode(r, &q) != nil {
			jsonOut(w, 400, nil)
			return
		}
		if q.Name != "" {
			g.Name = q.Name
		}
		if q.Status == "active" || q.Status == "disabled" {
			g.Status = q.Status
		}
		h.Store.Groups[id] = g
		if e := h.Store.Persist(); e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 200, g)
	case path == "/providers" && r.Method == "GET":
		jsonOut(w, 200, map[string]any{"items": h.Store.Providers})
	case path == "/providers/sync" && r.Method == "POST":
		if h.Catalog == nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		e := h.Store.SyncProviders(r.Context(), h.Catalog, time.Now().UTC())
		result := "success"
		if e != nil {
			result = "failed"
		}
		h.Store.AddAudit(logic.Audit{ActorID: u.ID, Action: "provider.sync", ObjectType: "provider", Result: result, TraceID: requestID()})
		if e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 200, map[string]any{"items": h.Store.Providers})
	case path == "/models" && r.Method == "GET":
		jsonOut(w, 200, map[string]any{"items": h.Store.Models})
	case (path == "/models" || strings.HasPrefix(path, "/models/")) && r.Method == "PATCH":
		var q struct {
			ID      string `json:"id"`
			Enabled bool   `json:"enabled"`
		}
		q.ID = strings.TrimPrefix(path, "/models/")
		if decode(r, &q) != nil {
			jsonOut(w, 400, nil)
			return
		}
		m, ok := h.Store.Models[q.ID]
		if !ok {
			fail(w, logic.ErrNotFound)
			return
		}
		m.Enabled = q.Enabled
		h.Store.Models[q.ID] = m
		if e := h.Store.Persist(); e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		h.Store.AddAudit(logic.Audit{ActorID: u.ID, Action: "model.update", ObjectType: "model", ObjectID: q.ID, Result: "success", TraceID: requestID()})
		jsonOut(w, 200, m)
	case path == "/grants" && r.Method == "GET":
		items := make([]logic.Grant, 0, len(h.Store.Grants))
		for _, g := range h.Store.Grants {
			items = append(items, g)
		}
		jsonOut(w, 200, map[string]any{"items": items})
	case path == "/grants" && r.Method == "POST":
		var g logic.Grant
		if decode(r, &g) != nil || h.Store.PutGrant(g) != nil {
			jsonOut(w, 400, nil)
			return
		}
		h.Store.AddAudit(logic.Audit{ActorID: u.ID, Action: "grant.create", ObjectType: "model", ObjectID: g.ModelID, Result: "success", TraceID: requestID()})
		jsonOut(w, 201, g)
	case path == "/grants" && r.Method == "DELETE":
		var g logic.Grant
		if decode(r, &g) != nil {
			jsonOut(w, 400, nil)
			return
		}
		h.Store.RemoveGrant(g)
		if h.Store.PersistenceError() != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 204, nil)
	case path == "/groups" && r.Method == "POST":
		var g logic.Group
		if decode(r, &g) != nil {
			jsonOut(w, 400, nil)
			return
		}
		if g.ID == "" {
			g.ID = requestID()
		}
		if g.Status == "" {
			g.Status = "active"
		}
		h.Store.Groups[g.ID] = g
		if e := h.Store.Persist(); e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 201, g)
	case strings.HasPrefix(path, "/groups/") && strings.HasSuffix(path, "/members") && r.Method == "PATCH":
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/groups/"), "/members")
		var q struct {
			Add    []string `json:"add_user_ids"`
			Remove []string `json:"remove_user_ids"`
		}
		if decode(r, &q) != nil {
			jsonOut(w, 400, nil)
			return
		}
		if _, ok := h.Store.Groups[id]; !ok {
			fail(w, logic.ErrNotFound)
			return
		}
		h.Store.SetMembers(id, q.Add, q.Remove)
		if h.Store.PersistenceError() != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
	case path == "/usage" && r.Method == "GET":
		items := []logic.Usage{}
		for _, x := range h.Store.Usages {
			if (r.URL.Query().Get("user_id") == "" || r.URL.Query().Get("user_id") == x.UserID) && matchUsage(r, x) {
				items = append(items, x)
			}
		}
		jsonOut(w, 200, map[string]any{"items": items})
	case path == "/conversations" && r.Method == "GET":
		jsonOut(w, 200, map[string]any{"items": h.Store.Conversations})
	case path == "/audit" && r.Method == "GET":
		jsonOut(w, 200, map[string]any{"items": h.Store.Audits})
	case strings.HasPrefix(path, "/users/") && strings.HasSuffix(path, "/effective-models") && r.Method == "GET":
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/users/"), "/effective-models")
		jsonOut(w, 200, map[string]any{"items": h.Store.EffectiveModels(id)})
	case strings.HasPrefix(path, "/conversations/") && strings.HasSuffix(path, "/messages") && r.Method == "GET":
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/conversations/"), "/messages")
		c, ok := h.Store.Conversations[id]
		if !ok {
			h.Store.AddAudit(logic.Audit{ActorID: u.ID, Action: "conversation.review", ObjectType: "conversation", ObjectID: id, Result: "failed", TraceID: requestID()})
			fail(w, logic.ErrNotFound)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit < 1 || limit > 100 {
			limit = 50
		}
		p, e := h.Store.Review(r.Context(), u.ID, requestID(), c, h.Orchestrator.PI.Messages, r.URL.Query().Get("since"), limit)
		if e != nil {
			fail(w, logic.ErrPIUnavailable)
			return
		}
		jsonOut(w, 200, p)
	default:
		fail(w, logic.ErrNotFound)
	}
}

var _ = errors.Is
