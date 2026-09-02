package hub

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
)

type fixturePersistence struct {
	snapshot Snapshot
	saves    int
}

func (f *fixturePersistence) Load(context.Context) (Snapshot, error) { return f.snapshot, nil }
func (f *fixturePersistence) Save(_ context.Context, s Snapshot) error {
	f.snapshot = s
	f.saves++
	return nil
}

func TestRestartRestoresDurableHubState(t *testing.T) {
	p := &fixturePersistence{}
	first := NewStore()
	if err := first.AttachPersistence(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	hash, _ := HashPassword("restart fixture password")
	first.Users["u1"] = User{ID: "u1", Username: "fixture", PasswordHash: hash, Role: "user", Status: "active"}
	first.Providers["glm"] = Provider{Provider: "glm", Name: "GLM", Status: "active"}
	first.Models["m1"] = Model{ID: "m1", Provider: "glm", UpstreamModelID: "fixture-model", Name: "Fixture", Enabled: true, Available: true}
	if err := first.PutGrant(Grant{SubjectType: "user", SubjectID: "u1", ModelID: "m1"}); err != nil {
		t.Fatal(err)
	}
	c, err := first.CreateConversation("u1", "m1", "restart", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if !first.RecordUsage(Usage{RequestID: "req1", ConversationID: c.ID, UserID: "u1", ModelID: "m1", Status: "completed", StartedAt: time.Now().UTC(), EndedAt: time.Now().UTC()}) {
		t.Fatal("usage was not saved")
	}

	restarted := NewStore()
	if err = restarted.AttachPersistence(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.ConversationForUser(c.ID, "u1", true); err != nil {
		t.Fatalf("conversation missing after restart: %v", err)
	}
	if len(restarted.EffectiveModels("u1")) != 1 || restarted.Usages["req1"].Status != "completed" {
		t.Fatal("grant or usage missing after restart")
	}
	if p.saves < 3 {
		t.Fatalf("expected durable writes, got %d", p.saves)
	}
}

func TestRedisTokenRotationAndGenerationLimits(t *testing.T) {
	server := miniredis.RunT(t)
	runtime, err := OpenRedis(server.Addr(), "", 0)
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	s, u, _ := setup(t)
	auth := NewAuth(s)
	auth.SetTokenStore(runtime)
	session, err := auth.Login(u.Username, "correct horse battery", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	rotated, err := auth.Refresh(session.Refresh)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = auth.Refresh(session.Refresh); err != ErrUnauthenticated {
		t.Fatalf("old refresh replay=%v", err)
	}
	if _, err = auth.Me(rotated.Access); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err = runtime.Acquire(ctx, "c1", u.ID, 1, 1, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err = runtime.Acquire(ctx, "c1", u.ID, 1, 1, time.Minute); err != ErrConversationBusy {
		t.Fatalf("duplicate lock=%v", err)
	}
	if err = runtime.Acquire(ctx, "c2", u.ID, 1, 2, time.Minute); err != ErrConcurrencyLimit {
		t.Fatalf("user limit=%v", err)
	}
	if err = runtime.Release(ctx, "c1", u.ID); err != nil {
		t.Fatal(err)
	}
	if err = runtime.Acquire(ctx, "c2", u.ID, 1, 1, time.Minute); err != nil {
		t.Fatalf("counter not released: %v", err)
	}
}
