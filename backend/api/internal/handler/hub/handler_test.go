package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	logic "terminal-agent-hub/backend/api/internal/logic/hub"
)

type testPI struct{}

func (testPI) Prompt(context.Context, string, string, string, string) (<-chan logic.PIEvent, error) {
	return nil, logic.ErrPIUnavailable
}
func (testPI) Abort(context.Context, string) error { return logic.ErrPIUnavailable }
func (testPI) Messages(context.Context, string, string, int) (logic.Page, error) {
	return logic.Page{}, nil
}
func (testPI) ListProviders(context.Context) ([]logic.ProviderSnapshot, error) {
	return []logic.ProviderSnapshot{{Provider: "glm", Name: "GLM", Status: "active"}}, nil
}
func login(t *testing.T, h http.Handler, user, pass string) []*http.Cookie {
	t.Helper()
	r := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"username":"`+user+`","password":"`+pass+`"}`))
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("login=%d %s", w.Code, w.Body.String())
	}
	return w.Result().Cookies()
}
func TestAuthCookiesAndAdminRBAC(t *testing.T) {
	s := logic.NewStore()
	a := logic.NewAuth(s)
	_, e := a.BootstrapAdmin("admin", "administrator password")
	if e != nil {
		t.Fatal(e)
	}
	hash, _ := logic.HashPassword("ordinary user password")
	s.Users["u1"] = logic.User{ID: "u1", Username: "user", PasswordHash: hash, Role: "user", Status: "active"}
	pi := testPI{}
	h := New(s, a, logic.NewOrchestrator(s, pi), pi, false)
	cookies := login(t, h, "user", "ordinary user password")
	r := httptest.NewRequest("GET", "/api/v1/admin/audit", nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("admin status=%d", w.Code)
	}
	var body map[string]any
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || body["error"] == nil {
		t.Fatal("missing stable error envelope")
	}
	adminCookies := login(t, h, "admin", "administrator password")
	r = httptest.NewRequest("POST", "/api/v1/admin/providers/sync", nil)
	for _, c := range adminCookies {
		r.AddCookie(c)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || strings.Contains(strings.ToLower(w.Body.String()), "secret") {
		t.Fatalf("sync=%d %s", w.Code, w.Body.String())
	}
}
func TestCasbinCompatibleAuthorizerSeam(t *testing.T) {
	a := RoleAuthorizer{}
	if a.Enforce("user", "/admin/audit", http.MethodGet) {
		t.Fatal("user was allowed into admin policy")
	}
	if !a.Enforce("admin", "/admin/audit", http.MethodGet) || !a.Enforce("user", "/models", http.MethodGet) {
		t.Fatal("role policy rejected an allowed route")
	}
}

func TestDisabledAccessImmediatelyRejected(t *testing.T) {
	s := logic.NewStore()
	a := logic.NewAuth(s)
	hash, _ := logic.HashPassword("ordinary user password")
	s.Users["u1"] = logic.User{ID: "u1", Username: "user", PasswordHash: hash, Role: "user", Status: "active"}
	pi := testPI{}
	h := New(s, a, logic.NewOrchestrator(s, pi), pi, false)
	cookies := login(t, h, "user", "ordinary user password")
	u := s.Users["u1"]
	u.Status = "disabled"
	s.Users["u1"] = u
	r := httptest.NewRequest("GET", "/api/v1/models", nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("disabled access=%d", w.Code)
	}
}
