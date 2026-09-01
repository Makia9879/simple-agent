package pi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"time"

	logic "terminal-agent-hub/backend/api/internal/logic/hub"
)

const maxJSONLRecord = 1 << 20

// readLFRecord recognizes LF only. CR is tolerated only immediately before LF,
// as documented by PI; U+2028/U+2029 are regular bytes in JSON strings.
func readLFRecord(r *bufio.Reader) ([]byte, error) {
	line, err := r.ReadBytes('\n')
	if len(line) > maxJSONLRecord {
		return nil, ErrPIProtocol
	}
	if err != nil {
		if err == io.EOF && len(line) > 0 {
			return nil, ErrPIProtocol // strict JSONL does not accept an unterminated record
		}
		return nil, err
	}
	line = line[:len(line)-1]
	if len(line) > 0 && line[len(line)-1] == '\r' {
		line = line[:len(line)-1]
	}
	return line, nil
}

func number(v any) *int64 {
	switch n := v.(type) {
	case float64:
		i := int64(n)
		return &i
	case json.Number:
		i, err := n.Int64()
		if err == nil {
			return &i
		}
	}
	return nil
}
func usageEvent(v any) logic.PIEvent {
	u, ok := v.(map[string]any)
	if !ok {
		return logic.PIEvent{}
	}
	in, out, cache, total := number(u["input"]), number(u["output"]), number(u["cacheRead"]), number(u["totalTokens"])
	if in == nil && out == nil && cache == nil && total == nil {
		return logic.PIEvent{}
	}
	return logic.PIEvent{Type: "usage", InputTokens: in, OutputTokens: out, CachedTokens: cache, TotalTokens: total}
}

func (a *Adapter) request(ctx context.Context, ref string, noSession bool, command map[string]any) (map[string]any, error) {
	p, err := a.command(ctx, ref, "", noSession)
	if err != nil {
		return nil, err
	}
	defer func() { a.finish("", p) }()
	if err = writeCommand(p, command); err != nil {
		return nil, err
	}
	r := bufio.NewReaderSize(p.stdout, 64*1024)
	for {
		line, e := readLFRecord(r)
		if e != nil {
			return nil, fmt.Errorf("read PI response: %w", e)
		}
		if len(line) == 0 {
			continue
		}
		var response map[string]any
		if json.Unmarshal(line, &response) != nil {
			return nil, ErrPIProtocol
		}
		if response["type"] != "response" {
			continue
		}
		ok, exists := response["success"].(bool)
		if !exists || !ok {
			return nil, errors.New("PI command failed")
		}
		return response, nil
	}
}

// Messages maps PI's durable Entry cursor directly, filters all non-visible
// content, and returns at most limit entries. No session file means no messages.
func (a *Adapter) Messages(ctx context.Context, ref, since string, limit int) (logic.Page, error) {
	path, err := a.SessionPath(ref)
	if err != nil {
		return logic.Page{}, err
	}
	if _, err = os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return logic.Page{}, nil
	}
	if err != nil {
		return logic.Page{}, err
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	response, err := a.request(ctx, ref, false, map[string]any{"type": "get_entries", "since": since})
	if err != nil {
		return logic.Page{}, err
	}
	data, _ := response["data"].(map[string]any)
	entries, _ := data["entries"].([]any)
	visible := make([]logic.Message, 0, len(entries))
	for _, raw := range entries {
		entry, _ := raw.(map[string]any)
		message, ok := visibleMessage(entry)
		if ok {
			visible = append(visible, message)
		}
	}
	page := logic.Page{}
	if len(visible) > limit {
		page.HasMore = true
		visible = visible[:limit]
	}
	page.Items = visible
	if len(visible) > 0 {
		page.NextSince = visible[len(visible)-1].ID
	}
	return page, nil
}

func visibleMessage(entry map[string]any) (logic.Message, bool) {
	if entry["type"] != "message" {
		return logic.Message{}, false
	}
	id, _ := entry["id"].(string)
	body, _ := entry["message"].(map[string]any)
	role, _ := body["role"].(string)
	if id == "" || (role != "user" && role != "assistant") {
		return logic.Message{}, false
	}
	text := ""
	switch c := body["content"].(type) {
	case string:
		text = c
	case []any:
		for _, raw := range c {
			part, _ := raw.(map[string]any)
			// Only text is displayable. Thinking, toolCall, tool results and unknown
			// internal shapes are intentionally excluded.
			if part["type"] == "text" {
				if t, _ := part["text"].(string); t != "" {
					text += t
				}
			}
		}
	}
	if text == "" {
		return logic.Message{}, false
	}
	created := time.Time{}
	switch t := entry["timestamp"].(type) {
	case string:
		created, _ = time.Parse(time.RFC3339, t)
	case float64:
		created = time.UnixMilli(int64(t)).UTC()
	}
	status := "completed"
	if reason, _ := body["stopReason"].(string); reason == "aborted" {
		status = "aborted"
	} else if reason == "error" {
		status = "error"
	}
	return logic.Message{ID: id, Role: role, Content: text, Status: status, CreatedAt: created}, true
}

// ListProviders returns a field-whitelisted, credential-free model catalog.
func (a *Adapter) ListProviders(ctx context.Context) ([]logic.ProviderSnapshot, error) {
	response, err := a.request(ctx, "", true, map[string]any{"type": "get_available_models"})
	if err != nil {
		return nil, err
	}
	data, _ := response["data"].(map[string]any)
	models, _ := data["models"].([]any)
	byProvider := map[string]*logic.ProviderSnapshot{}
	for _, raw := range models {
		m, _ := raw.(map[string]any)
		provider, _ := m["provider"].(string)
		id, _ := m["id"].(string)
		name, _ := m["name"].(string)
		if provider == "" || id == "" {
			continue
		}
		if name == "" {
			name = id
		}
		p := byProvider[provider]
		if p == nil {
			p = &logic.ProviderSnapshot{Provider: provider, Name: provider, Status: "active"}
			byProvider[provider] = p
		}
		p.Models = append(p.Models, logic.SnapshotModel{UpstreamModelID: id, Name: name})
	}
	out := make([]logic.ProviderSnapshot, 0, len(byProvider))
	for _, p := range byProvider {
		sort.Slice(p.Models, func(i, j int) bool { return p.Models[i].UpstreamModelID < p.Models[j].UpstreamModelID })
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Provider < out[j].Provider })
	return out, nil
}

// parseInt is kept here for fixture parity with OpenAI-compatible provider JSON.
func parseInt(v any) *int64 {
	if s, ok := v.(string); ok {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			return &n
		}
	}
	return number(v)
}
