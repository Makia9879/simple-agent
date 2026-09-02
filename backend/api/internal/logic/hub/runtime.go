package hub

import (
	"context"
	"sync"
	"time"
)

// TokenStore is implemented by Redis in production. Refresh rotation is an
// atomic consume operation, so a stolen old refresh token cannot be replayed.
type TokenStore interface {
	Put(context.Context, string, string, time.Duration) error
	Get(context.Context, string) (string, bool, error)
	Take(context.Context, string) (string, bool, error)
	Delete(context.Context, ...string) error
}

type memoryTokenStore struct {
	mu sync.Mutex
	v  map[string]tokenRecord
}

func newMemoryTokenStore() *memoryTokenStore { return &memoryTokenStore{v: map[string]tokenRecord{}} }
func (m *memoryTokenStore) Put(_ context.Context, key, user string, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.v[key] = tokenRecord{UserID: user, ExpiresAt: time.Now().UTC().Add(ttl)}
	return nil
}
func (m *memoryTokenStore) Get(_ context.Context, key string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.v[key]
	if !ok || !time.Now().UTC().Before(r.ExpiresAt) {
		delete(m.v, key)
		return "", false, nil
	}
	return r.UserID, true, nil
}
func (m *memoryTokenStore) Take(ctx context.Context, key string) (string, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.v[key]
	delete(m.v, key)
	if !ok || !time.Now().UTC().Before(r.ExpiresAt) {
		return "", false, nil
	}
	return r.UserID, true, nil
}
func (m *memoryTokenStore) Delete(_ context.Context, keys ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range keys {
		delete(m.v, k)
	}
	return nil
}

// GenerationRuntime provides cross-process Redis locking and counters.
type GenerationRuntime interface {
	Acquire(context.Context, string, string, int, int, time.Duration) error
	Release(context.Context, string, string) error
	Exists(context.Context, string) (bool, error)
}

type memoryGenerationRuntime struct {
	mu            sync.Mutex
	conversations map[string]string
	perUser       map[string]int
}

func newMemoryGenerationRuntime() *memoryGenerationRuntime {
	return &memoryGenerationRuntime{conversations: map[string]string{}, perUser: map[string]int{}}
}
func (m *memoryGenerationRuntime) Acquire(_ context.Context, conversation, user string, maxUser, maxSystem int, _ time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.conversations[conversation]; ok {
		return ErrConversationBusy
	}
	if len(m.conversations) >= maxSystem || m.perUser[user] >= maxUser {
		return ErrConcurrencyLimit
	}
	m.conversations[conversation] = user
	m.perUser[user]++
	return nil
}
func (m *memoryGenerationRuntime) Release(_ context.Context, conversation, user string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.conversations[conversation]; ok {
		delete(m.conversations, conversation)
		if m.perUser[user] > 0 {
			m.perUser[user]--
		}
	}
	return nil
}
func (m *memoryGenerationRuntime) Exists(_ context.Context, conversation string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.conversations[conversation]
	return ok, nil
}
