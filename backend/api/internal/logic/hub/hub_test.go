package hub

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeCatalog struct {
	items []ProviderSnapshot
	err   error
}

func (f fakeCatalog) ListProviders(context.Context) ([]ProviderSnapshot, error) {
	return f.items, f.err
}

type fakePI struct {
	events  chan PIEvent
	aborted chan string
}

func (f *fakePI) Prompt(context.Context, string, string, string, string) (<-chan PIEvent, error) {
	return f.events, nil
}
func (f *fakePI) Abort(_ context.Context, s string) error                     { f.aborted <- s; return nil }
func (f *fakePI) Messages(context.Context, string, string, int) (Page, error) { return Page{}, nil }
func setup(t *testing.T) (*Store, User, Model) {
	t.Helper()
	s := NewStore()
	h, _ := HashPassword("correct horse battery")
	u := User{ID: "u1", Username: "user", PasswordHash: h, Role: "user", Status: "active"}
	s.Users[u.ID] = u
	s.Providers["glm"] = Provider{Provider: "glm", Status: "active"}
	m := Model{ID: "m1", Provider: "glm", UpstreamModelID: "glm-4", Enabled: true, Available: true}
	s.Models[m.ID] = m
	_ = s.PutGrant(Grant{SubjectType: "user", SubjectID: u.ID, ModelID: m.ID})
	return s, u, m
}
func TestPasswordAndAuthRotationDisable(t *testing.T) {
	s, u, _ := setup(t)
	a := NewAuth(s)
	sess, e := a.Login("user", "correct horse battery", "127.0.0.1")
	if e != nil {
		t.Fatal(e)
	}
	next, e := a.Refresh(sess.Refresh)
	if e != nil || next.Refresh == sess.Refresh {
		t.Fatal("refresh did not rotate")
	}
	s.mu.Lock()
	x := s.Users[u.ID]
	x.Status = "disabled"
	s.Users[u.ID] = x
	s.mu.Unlock()
	if _, e = a.Refresh(next.Refresh); !errors.Is(e, ErrUnauthenticated) {
		t.Fatalf("disabled refresh: %v", e)
	}
}
func TestLoginRateLimit(t *testing.T) {
	s, _, _ := setup(t)
	a := NewAuth(s)
	for i := 0; i < 5; i++ {
		_, _ = a.Login("user", "wrong password", "ip")
	}
	if _, e := a.Login("user", "correct horse battery", "ip"); !errors.Is(e, ErrLoginRateLimited) {
		t.Fatalf("got %v", e)
	}
}
func TestEffectiveModelsUnionAndStatus(t *testing.T) {
	s, u, m := setup(t)
	s.RemoveGrant(Grant{SubjectType: "user", SubjectID: u.ID, ModelID: m.ID})
	s.Groups["g1"] = Group{ID: "g1", Status: "active"}
	s.Groups["g2"] = Group{ID: "g2", Status: "active"}
	s.SetMembers("g1", []string{u.ID}, nil)
	s.SetMembers("g2", []string{u.ID}, nil)
	_ = s.PutGrant(Grant{SubjectType: "group", SubjectID: "g1", ModelID: m.ID})
	_ = s.PutGrant(Grant{SubjectType: "group", SubjectID: "g2", ModelID: m.ID})
	if got := s.EffectiveModels(u.ID); len(got) != 1 {
		t.Fatalf("union=%v", got)
	}
	s.RemoveGrant(Grant{SubjectType: "group", SubjectID: "g1", ModelID: m.ID})
	if len(s.EffectiveModels(u.ID)) != 1 {
		t.Fatal("second group should still authorize")
	}
	s.RemoveGrant(Grant{SubjectType: "group", SubjectID: "g2", ModelID: m.ID})
	if len(s.EffectiveModels(u.ID)) != 0 {
		t.Fatal("revocation not immediate")
	}
	s.Models[m.ID] = Model{ID: m.ID, Provider: "glm", Enabled: true, Available: false}
	_ = s.PutGrant(Grant{SubjectType: "user", SubjectID: u.ID, ModelID: m.ID})
	if len(s.EffectiveModels(u.ID)) != 0 {
		t.Fatal("unavailable model authorized")
	}
}
func TestProviderSyncNoDeleteAndDefaultDisabled(t *testing.T) {
	s, _, _ := setup(t)
	old := s.Models["m1"]
	_ = s.PutGrant(Grant{SubjectType: "user", SubjectID: "u1", ModelID: "m1"})
	e := s.SyncProviders(context.Background(), fakeCatalog{items: []ProviderSnapshot{{Provider: "deepseek", Name: "DeepSeek", Status: "active", Models: []SnapshotModel{{UpstreamModelID: "chat", Name: "Chat"}}}}}, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if s.Models[old.ID].Available {
		t.Fatal("missing model remains available")
	}
	if _, ok := s.Grants[grantKey(Grant{SubjectType: "user", SubjectID: "u1", ModelID: "m1"})]; !ok {
		t.Fatal("grant deleted")
	}
	for _, m := range s.Models {
		if m.Provider == "deepseek" && m.Enabled {
			t.Fatal("new model enabled")
		}
	}
	_ = s.SyncProviders(context.Background(), fakeCatalog{err: errors.New("offline")}, time.Now())
	if s.Providers["deepseek"].Status != "stale" {
		t.Fatal("failed sync must mark stale")
	}
}
func TestConversationFixedAndSoftDelete(t *testing.T) {
	s, u, m := setup(t)
	c, e := s.CreateConversation(u.ID, m.ID, "", time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if e = s.HideConversation(c.ID, u.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ConversationForUser(c.ID, u.ID, false); !errors.Is(e, ErrNotFound) {
		t.Fatal("hidden conversation visible")
	}
	if got := s.Conversations[c.ID]; got.ModelID != m.ID {
		t.Fatal("model changed")
	}
}
func TestUsageIdempotentUnknown(t *testing.T) {
	s := NewStore()
	u := Usage{RequestID: "req", Status: "completed"}
	if !s.RecordUsage(u) || s.RecordUsage(u) {
		t.Fatal("idempotency failed")
	}
	if s.Usages["req"].TotalTokens != nil {
		t.Fatal("unknown token was fabricated")
	}
}
func TestReviewAlwaysAuditedAndRedacted(t *testing.T) {
	s := NewStore()
	c := Conversation{ID: "c", SessionRef: "opaque"}
	p, e := s.Review(context.Background(), "admin", "trace", c, func(context.Context, string, string, int) (Page, error) {
		return Page{Items: []Message{{Content: "api_key=super-secret"}}}, nil
	}, "", 50)
	if e != nil || len(s.Audits) != 1 || p.Items[0].Content == "api_key=super-secret" {
		t.Fatal("review contract")
	}
	_, _ = s.Review(context.Background(), "admin", "trace2", c, func(context.Context, string, string, int) (Page, error) { return Page{}, errors.New("pi down") }, "", 50)
	if len(s.Audits) != 2 || s.Audits[1].Result != "failed" {
		t.Fatal("failed review not audited")
	}
}
func TestSSETerminalSettledAndConcurrency(t *testing.T) {
	s, u, m := setup(t)
	c, _ := s.CreateConversation(u.ID, m.ID, "", time.Now())
	pi := &fakePI{events: make(chan PIEvent, 8), aborted: make(chan string, 1)}
	o := NewOrchestrator(s, pi)
	out, e := o.Prompt(context.Background(), u.ID, c.ID, "hello")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = o.Prompt(context.Background(), u.ID, c.ID, "again"); !errors.Is(e, ErrConversationBusy) {
		t.Fatalf("expected busy: %v", e)
	}
	n := int64(3)
	pi.events <- PIEvent{Type: "text_delta", Delta: "hi"}
	pi.events <- PIEvent{Type: "usage", TotalTokens: &n}
	pi.events <- PIEvent{Type: "done"}
	if !o.IsGenerating(c.ID) {
		t.Fatal("done released before settled")
	}
	pi.events <- PIEvent{Type: "agent_settled"}
	close(pi.events)
	var terminal int
	for ev := range out {
		if ev.Type == "done" || ev.Type == "error" {
			terminal++
		}
	}
	if terminal != 1 || o.IsGenerating(c.ID) || len(s.Usages) != 1 {
		t.Fatalf("terminal=%d active=%v usage=%d", terminal, o.IsGenerating(c.ID), len(s.Usages))
	}
}
func TestDisconnectGraceAborts(t *testing.T) {
	s, u, m := setup(t)
	c, _ := s.CreateConversation(u.ID, m.ID, "", time.Now())
	pi := &fakePI{events: make(chan PIEvent), aborted: make(chan string, 1)}
	o := NewOrchestrator(s, pi)
	o.DisconnectGrace = 10 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	_, e := o.Prompt(ctx, u.ID, c.ID, "hello")
	if e != nil {
		t.Fatal(e)
	}
	cancel()
	select {
	case <-pi.aborted:
	case <-time.After(time.Second):
		t.Fatal("not aborted after grace")
	}
	close(pi.events)
}
