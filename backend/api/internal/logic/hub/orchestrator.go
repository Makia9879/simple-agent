package hub

import (
	"context"
	"errors"
	"sync"
	"time"
)

type PIEvent struct {
	Type, Delta, FinishReason, Code, Message             string
	InputTokens, OutputTokens, CachedTokens, TotalTokens *int64
}
type PublicEvent struct {
	Type, RequestID, ConversationID, Delta, FinishReason, Code, Message string
	InputTokens, OutputTokens, TotalTokens                              *int64
}
type PI interface {
	Prompt(context.Context, string, string, string, string) (<-chan PIEvent, error)
	Abort(context.Context, string) error
	Messages(context.Context, string, string, int) (Page, error)
}
type generation struct {
	requestID, userID, sessionRef string
	cancel                        context.CancelFunc
	settled                       chan struct{}
}
type Orchestrator struct {
	Store                 *Store
	PI                    PI
	MaxPerUser, MaxSystem int
	DisconnectGrace       time.Duration
	mu                    sync.Mutex
	active                map[string]*generation
	Runtime               GenerationRuntime
}

func NewOrchestrator(s *Store, pi PI) *Orchestrator {
	return &Orchestrator{Store: s, PI: pi, MaxPerUser: 2, MaxSystem: 20, DisconnectGrace: 120 * time.Second, active: map[string]*generation{}, Runtime: newMemoryGenerationRuntime()}
}
func (o *Orchestrator) SetRuntime(runtime GenerationRuntime) {
	if runtime != nil {
		o.Runtime = runtime
	}
}
func (o *Orchestrator) acquire(c Conversation, user string) (*generation, error) {
	if err := o.Runtime.Acquire(context.Background(), c.ID, user, o.MaxPerUser, o.MaxSystem, o.DisconnectGrace+5*time.Minute); err != nil {
		return nil, err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if _, ok := o.active[c.ID]; ok {
		_ = o.Runtime.Release(context.Background(), c.ID, user)
		return nil, ErrConversationBusy
	}
	_, cancel := context.WithCancel(context.Background())
	g := &generation{requestID: randomID("req_"), userID: user, sessionRef: c.SessionRef, cancel: cancel, settled: make(chan struct{})}
	o.active[c.ID] = g
	return g, nil
}
func (o *Orchestrator) release(id string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	g, ok := o.active[id]
	if !ok {
		return
	}
	delete(o.active, id)
	_ = o.Runtime.Release(context.Background(), id, g.userID)
	g.cancel()
	close(g.settled)
}
func (o *Orchestrator) IsGenerating(id string) bool {
	ok, err := o.Runtime.Exists(context.Background(), id)
	return err == nil && ok
}

// Prompt starts a server-owned generation. Client cancellation only starts the
// disconnect grace timer; it does not immediately terminate PI.
func (o *Orchestrator) Prompt(client context.Context, user, conversationID, content string) (<-chan PublicEvent, error) {
	c, err := o.Store.ConversationForUser(conversationID, user, true)
	if err != nil {
		return nil, err
	}
	if !o.Store.IsModelEffective(user, c.ModelID) {
		return nil, ErrModelUnauthorized
	}
	g, err := o.acquire(c, user)
	if err != nil {
		return nil, err
	}
	piCtx, piCancel := context.WithCancel(context.Background())
	g.cancel = piCancel
	in, err := o.PI.Prompt(piCtx, c.SessionRef, c.ModelID, g.requestID, content)
	if err != nil {
		o.release(c.ID)
		return nil, ErrPIUnavailable
	}
	out := make(chan PublicEvent, 16)
	go o.consume(client, piCtx, c, g, in, out)
	return out, nil
}
func (o *Orchestrator) consume(client, piCtx context.Context, c Conversation, g *generation, in <-chan PIEvent, out chan<- PublicEvent) {
	defer close(out)
	started := time.Now().UTC()
	terminal := false
	var usage PIEvent
	go func() {
		select {
		case <-client.Done():
		case <-piCtx.Done():
			return
		}
		timer := time.NewTimer(o.DisconnectGrace)
		defer timer.Stop()
		select {
		case <-timer.C:
			_ = o.PI.Abort(context.Background(), c.SessionRef)
		case <-piCtx.Done():
		}
	}()
	for ev := range in {
		p := PublicEvent{RequestID: g.requestID, ConversationID: c.ID}
		switch ev.Type {
		case "text_delta":
			if terminal {
				continue
			}
			p.Type = "text_delta"
			p.Delta = ev.Delta
			out <- p
		case "usage":
			if terminal {
				continue
			}
			usage = ev
			p.Type = "usage"
			p.InputTokens = ev.InputTokens
			p.OutputTokens = ev.OutputTokens
			p.TotalTokens = ev.TotalTokens
			out <- p
		case "done":
			if terminal {
				continue
			}
			terminal = true
			p.Type = "done"
			p.FinishReason = ev.FinishReason
			if p.FinishReason == "" {
				p.FinishReason = "stop"
			}
			out <- p
		case "error":
			if terminal {
				continue
			}
			terminal = true
			p.Type = "error"
			p.Code = ev.Code
			p.Message = Redact(ev.Message)
			out <- p
		case "agent_settled":
			if !terminal {
				terminal = true
				p.Type = "done"
				p.FinishReason = ev.FinishReason
				if p.FinishReason == "" {
					p.FinishReason = "stop"
				}
				out <- p
			}
			status := "completed"
			if p.FinishReason == "aborted" {
				status = "aborted"
			}
			o.Store.RecordUsage(Usage{RequestID: g.requestID, ConversationID: c.ID, UserID: c.OwnerID, ModelID: c.ModelID, Status: status, InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, CachedTokens: usage.CachedTokens, TotalTokens: usage.TotalTokens, StartedAt: started, EndedAt: time.Now().UTC()})
			o.release(c.ID)
			return
		}
	}
	if !terminal {
		out <- PublicEvent{Type: "error", RequestID: g.requestID, ConversationID: c.ID, Code: "PI_UNAVAILABLE", Message: "模型服务暂时不可用"}
	}
	// Exiting without agent_settled is always a failed execution, even if PI
	// previously emitted a message-end/done marker.
	o.Store.RecordUsage(Usage{RequestID: g.requestID, ConversationID: c.ID, UserID: c.OwnerID, ModelID: c.ModelID, Status: "failed", InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, CachedTokens: usage.CachedTokens, TotalTokens: usage.TotalTokens, StartedAt: started, EndedAt: time.Now().UTC()})
	if o.IsGenerating(c.ID) {
		o.release(c.ID)
	}
}
func (o *Orchestrator) Abort(ctx context.Context, user, id string) error {
	c, e := o.Store.ConversationForUser(id, user, true)
	if e != nil {
		return e
	}
	o.mu.Lock()
	_, ok := o.active[id]
	o.mu.Unlock()
	if !ok {
		return ErrNoActiveGeneration
	}
	if e = o.PI.Abort(ctx, c.SessionRef); e != nil {
		return ErrPIUnavailable
	}
	return nil
}
func ErrorHTTP(err error) (int, string) {
	switch {
	case errors.Is(err, ErrUnauthenticated):
		return 401, "UNAUTHENTICATED"
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrModelUnauthorized):
		return 403, err.Error()
	case errors.Is(err, ErrNotFound):
		return 404, "NOT_FOUND"
	case errors.Is(err, ErrConversationBusy), errors.Is(err, ErrNoActiveGeneration):
		return 409, err.Error()
	case errors.Is(err, ErrConcurrencyLimit), errors.Is(err, ErrLoginRateLimited):
		return 429, err.Error()
	default:
		return 502, "PI_UNAVAILABLE"
	}
}
