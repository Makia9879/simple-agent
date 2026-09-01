package pi

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func fakeAdapter(t *testing.T) *Adapter {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	fixture := filepath.Join("testdata", "fake-pi")
	if err := os.Chmod(fixture, 0755); err != nil {
		t.Fatal(err)
	}
	a, err := New(Config{Command: fixture, DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestSessionPathRejectsTraversal(t *testing.T) {
	a := fakeAdapter(t)
	for _, ref := range []string{"../x", "/tmp/x", "a/b", "a.jsonl", "", ".."} {
		if _, err := a.SessionPath(ref); err == nil {
			t.Fatalf("SessionPath(%q) accepted unsafe ref", ref)
		}
	}
	path, err := a.SessionPath("session_123")
	if err != nil || !strings.HasSuffix(path, "session_123.jsonl") {
		t.Fatalf("safe path=%q err=%v", path, err)
	}
}

func TestPromptUsesStrictJSONLFiltersThinkingAndSettles(t *testing.T) {
	a := fakeAdapter(t)
	events, err := a.Prompt(context.Background(), "session_123", "glm/glm-4-flash", "req-1", "hello\u2028world")
	if err != nil {
		t.Fatal(err)
	}
	var types []string
	var text string
	for event := range events {
		types = append(types, event.Type)
		if event.Type == "text_delta" {
			text += event.Delta
		}
	}
	want := []string{"usage", "text_delta", "agent_settled"}
	if strings.Join(types, ",") != strings.Join(want, ",") {
		t.Fatalf("events %v, want %v", types, want)
	}
	if text != "hello\u2028world" {
		t.Fatalf("text delta %q", text)
	}
	if err := a.Abort(context.Background(), "session_123"); err == nil {
		t.Fatal("settled process remained active")
	}
}

func TestAbortDoesNotClearQueueAndEndsAborted(t *testing.T) {
	a := fakeAdapter(t)
	events, err := a.Prompt(context.Background(), "session_123", "glm/glm-4-flash", "req-2", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Abort(context.Background(), "session_123"); err != nil {
		t.Fatal(err)
	}
	var settled string
	for event := range events {
		if event.Type == "agent_settled" {
			settled = event.FinishReason
		}
	}
	if settled != "aborted" {
		t.Fatalf("settled=%q", settled)
	}
}

func TestMessagesSinceAndVisibleFilter(t *testing.T) {
	a := fakeAdapter(t)
	path, _ := a.SessionPath("session_123")
	if err := os.WriteFile(path, []byte("placeholder\n"), 0600); err != nil {
		t.Fatal(err)
	}
	page, err := a.Messages(context.Background(), "session_123", "e0", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Role != "user" || page.Items[0].Content != "hello" || !page.HasMore || page.NextSince != "e1" {
		t.Fatalf("unexpected page: %#v", page)
	}
	page, err = a.Messages(context.Background(), "session_123", "e1", 50)
	if err != nil || len(page.Items) != 2 || page.Items[1].Content != "visible" {
		t.Fatalf("filter page=%#v err=%v", page, err)
	}
}

func TestListProvidersWhitelistsCredentials(t *testing.T) {
	a := fakeAdapter(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	providers, err := a.ListProviders(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(providers) != 2 || providers[0].Provider != "deepseek" || providers[1].Models[0].UpstreamModelID != "glm-4-flash" {
		t.Fatalf("providers %#v", providers)
	}
}
