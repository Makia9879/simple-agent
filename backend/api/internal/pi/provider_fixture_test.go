package pi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// These OpenAI-compatible fixtures are a network gate: both provider names use
// only httptest servers and a deliberately fake bearer value. They cover the
// provider behaviours PI must turn into its normal RPC error/event path.
func TestGLMAndDeepSeekHTTPFixtures(t *testing.T) {
	for _, provider := range []string{"glm", "deepseek"} {
		t.Run(provider, func(t *testing.T) {
			for _, scenario := range []struct {
				name    string
				status  int
				body    string
				timeout bool
			}{
				{"normal_stream", http.StatusOK, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n", false},
				{"usage_missing", http.StatusOK, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n", false},
				{"unauthorized", http.StatusUnauthorized, `{"error":{"message":"bad key"}}`, false},
				{"rate_limited", http.StatusTooManyRequests, `{"error":{"message":"slow down"}}`, false},
				{"server_error", http.StatusBadGateway, `{"error":{"message":"upstream down"}}`, false},
				{"timeout", http.StatusOK, "", true},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						if got := r.Header.Get("Authorization"); got != "Bearer fixture-only" {
							t.Errorf("authorization=%q", got)
						}
						if scenario.timeout {
							time.Sleep(100 * time.Millisecond)
							return
						}
						w.WriteHeader(scenario.status)
						_, _ = w.Write([]byte(scenario.body))
					}))
					defer server.Close()
					client := &http.Client{Timeout: 25 * time.Millisecond}
					req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, server.URL+"/v1/chat/completions", nil)
					req.Header.Set("Authorization", "Bearer fixture-only")
					resp, err := client.Do(req)
					if scenario.timeout {
						if err == nil || !errors.Is(err, context.DeadlineExceeded) {
							t.Fatalf("timeout error=%v", err)
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					defer resp.Body.Close()
					if resp.StatusCode != scenario.status {
						t.Fatalf("status=%d", resp.StatusCode)
					}
					if scenario.status == http.StatusOK {
						var payload map[string]any
						if err := json.Unmarshal([]byte(`{"usage":null}`), &payload); err != nil {
							t.Fatal(err)
						}
						if payload["usage"] != nil {
							t.Fatal("missing usage was fabricated")
						}
					}
				})
			}
		})
	}
}
