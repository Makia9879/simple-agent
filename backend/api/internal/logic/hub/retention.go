package hub

import "context"

// SessionCleaner is implemented by the PI boundary. Retention is disabled
// unless an operator supplies a cutoff; no undocumented default is assumed.
type SessionCleaner interface {
	DeleteSession(context.Context, string) error
}

// PurgeHiddenBefore physically removes PI content and then its Hub index for
// conversations the user hid before cutoff. Audit metadata is retained.
func (s *Store) PurgeHiddenBefore(ctx context.Context, cutoffUnixMicro int64, cleaner SessionCleaner) (int, error) {
	s.mu.RLock()
	candidates := make([]Conversation, 0)
	for _, c := range s.Conversations {
		if c.Hidden && c.UpdatedAt.UnixMicro() < cutoffUnixMicro {
			candidates = append(candidates, c)
		}
	}
	s.mu.RUnlock()
	removed := 0
	for _, c := range candidates {
		if err := cleaner.DeleteSession(ctx, c.SessionRef); err != nil {
			return removed, err
		}
		s.mu.Lock()
		current, ok := s.Conversations[c.ID]
		if ok && current.Hidden && current.UpdatedAt.UnixMicro() < cutoffUnixMicro {
			delete(s.Conversations, c.ID)
			removed++
		}
		s.mu.Unlock()
	}
	return removed, nil
}
