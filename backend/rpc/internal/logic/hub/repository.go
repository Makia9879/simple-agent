// Package hub contains the SQL-backed Hub repository used by Core RPC.
package hub

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type Repository struct{ DB *sql.DB }
type Model struct {
	ID, Provider, UpstreamModelID, Name string
	Enabled, Available                  bool
}
type Conversation struct {
	ID, OwnerID, ModelID, SessionRef, Title string
	Hidden                                  bool
	CreatedAt, UpdatedAt                    time.Time
}
type Usage struct {
	RequestID, ConversationID, UserID, ModelID, Status   string
	InputTokens, OutputTokens, CachedTokens, TotalTokens *int64
	StartedAt, EndedAt                                   time.Time
}

// EffectiveModels is the SQL equivalent of the single domain calculation:
// direct grants UNION active-group grants, intersected with model/provider state.
func (r Repository) EffectiveModels(ctx context.Context, userID string) ([]Model, error) {
	rows, e := r.DB.QueryContext(ctx, `
SELECT DISTINCT m.id,m.provider,m.upstream_model_id,m.name,m.enabled,m.available
FROM hub_models m JOIN hub_providers p ON p.provider=m.provider
JOIN hub_grants g ON g.model_id=m.id
LEFT JOIN hub_group_members gm ON g.subject_type='group' AND gm.group_id=g.subject_id
LEFT JOIN hub_groups hg ON hg.id=gm.group_id
WHERE ((g.subject_type='user' AND g.subject_id=?) OR (g.subject_type='group' AND gm.user_id=? AND hg.status='active'))
AND m.enabled=TRUE AND m.available=TRUE AND p.status='active' ORDER BY m.id`, userID, userID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Model{}
	for rows.Next() {
		var m Model
		if e = rows.Scan(&m.ID, &m.Provider, &m.UpstreamModelID, &m.Name, &m.Enabled, &m.Available); e != nil {
			return nil, e
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (r Repository) CreateConversation(ctx context.Context, c Conversation) error {
	if c.ID == "" || c.OwnerID == "" || c.ModelID == "" || c.SessionRef == "" {
		return errors.New("missing conversation identity")
	}
	_, e := r.DB.ExecContext(ctx, `INSERT INTO hub_conversations(id,owner_id,model_id,pi_session_ref,title,hidden,created_at,updated_at) VALUES(?,?,?,?,?,FALSE,?,?)`, c.ID, c.OwnerID, c.ModelID, c.SessionRef, c.Title, c.CreatedAt, c.UpdatedAt)
	return e
}
func (r Repository) HideConversation(ctx context.Context, id, owner string, now time.Time) (bool, error) {
	res, e := r.DB.ExecContext(ctx, `UPDATE hub_conversations SET hidden=TRUE,updated_at=? WHERE id=? AND owner_id=?`, now, id, owner)
	if e != nil {
		return false, e
	}
	n, e := res.RowsAffected()
	return n == 1, e
}
func (r Repository) RecordUsage(ctx context.Context, u Usage) (bool, error) {
	res, e := r.DB.ExecContext(ctx, `INSERT IGNORE INTO hub_usage_records(request_id,conversation_id,user_id,model_id,status,input_tokens,output_tokens,cached_tokens,total_tokens,started_at,ended_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, u.RequestID, u.ConversationID, u.UserID, u.ModelID, u.Status, u.InputTokens, u.OutputTokens, u.CachedTokens, u.TotalTokens, u.StartedAt, u.EndedAt)
	if e != nil {
		return false, e
	}
	n, e := res.RowsAffected()
	return n == 1, e
}
