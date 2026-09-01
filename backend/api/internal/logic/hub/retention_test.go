package hub

import (
	"context"
	"testing"
	"time"
)

type cleaner struct{ refs []string }

func (c *cleaner) DeleteSession(_ context.Context, s string) error {
	c.refs = append(c.refs, s)
	return nil
}
func TestRetentionOnlyPurgesOldHidden(t *testing.T) {
	s := NewStore()
	old := time.Now().Add(-48 * time.Hour)
	s.Conversations["hidden"] = Conversation{ID: "hidden", SessionRef: "opaque-hidden", Hidden: true, UpdatedAt: old}
	s.Conversations["visible"] = Conversation{ID: "visible", SessionRef: "opaque-visible", UpdatedAt: old}
	s.Audits = []Audit{{ObjectID: "hidden"}}
	c := &cleaner{}
	n, e := s.PurgeHiddenBefore(context.Background(), time.Now().Add(-24*time.Hour).UnixMicro(), c)
	if e != nil || n != 1 || len(c.refs) != 1 {
		t.Fatalf("n=%d refs=%v err=%v", n, c.refs, e)
	}
	if _, ok := s.Conversations["visible"]; !ok {
		t.Fatal("visible conversation purged")
	}
	if len(s.Audits) != 1 {
		t.Fatal("audit metadata purged")
	}
}
