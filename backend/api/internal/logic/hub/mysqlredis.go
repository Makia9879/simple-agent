// Package hub includes production persistence/runtime adapters behind domain
// interfaces, keeping tests fixture-only.
package hub

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/redis/go-redis/v9"
)

// MySQLRepository is the production MySQL persistence adapter.
type MySQLRepository struct{ DB *sql.DB }

func OpenMySQL(dsn string) (*MySQLRepository, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetConnMaxLifetime(3 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return &MySQLRepository{DB: db}, nil
}
func (r *MySQLRepository) Close() error { return r.DB.Close() }

func (r *MySQLRepository) Load(ctx context.Context) (Snapshot, error) {
	x := Snapshot{Members: map[string][]string{}}
	queries := []struct {
		q    string
		scan func(*sql.Rows) error
	}{
		{`SELECT id,username,password_hash,role,status FROM sys_users`, func(rows *sql.Rows) error {
			var v User
			if err := rows.Scan(&v.ID, &v.Username, &v.PasswordHash, &v.Role, &v.Status); err != nil {
				return err
			}
			x.Users = append(x.Users, v)
			return nil
		}},
		{`SELECT id,name,status FROM hub_groups`, func(rows *sql.Rows) error {
			var v Group
			if err := rows.Scan(&v.ID, &v.Name, &v.Status); err != nil {
				return err
			}
			x.Groups = append(x.Groups, v)
			return nil
		}},
		{`SELECT group_id,user_id FROM hub_group_members`, func(rows *sql.Rows) error {
			var g, u string
			if err := rows.Scan(&g, &u); err != nil {
				return err
			}
			x.Members[g] = append(x.Members[g], u)
			return nil
		}},
		{`SELECT provider,name,status,last_synced_at FROM hub_providers`, func(rows *sql.Rows) error {
			var v Provider
			var t sql.NullTime
			if err := rows.Scan(&v.Provider, &v.Name, &v.Status, &t); err != nil {
				return err
			}
			if t.Valid {
				v.LastSyncedAt = t.Time
			}
			x.Providers = append(x.Providers, v)
			return nil
		}},
		{`SELECT id,provider,upstream_model_id,name,enabled,available FROM hub_models`, func(rows *sql.Rows) error {
			var v Model
			if err := rows.Scan(&v.ID, &v.Provider, &v.UpstreamModelID, &v.Name, &v.Enabled, &v.Available); err != nil {
				return err
			}
			x.Models = append(x.Models, v)
			return nil
		}},
		{`SELECT subject_type,subject_id,model_id FROM hub_grants`, func(rows *sql.Rows) error {
			var v Grant
			if err := rows.Scan(&v.SubjectType, &v.SubjectID, &v.ModelID); err != nil {
				return err
			}
			x.Grants = append(x.Grants, v)
			return nil
		}},
		{`SELECT id,owner_id,model_id,pi_session_ref,title,hidden,created_at,updated_at FROM hub_conversations`, func(rows *sql.Rows) error {
			var v Conversation
			if err := rows.Scan(&v.ID, &v.OwnerID, &v.ModelID, &v.SessionRef, &v.Title, &v.Hidden, &v.CreatedAt, &v.UpdatedAt); err != nil {
				return err
			}
			x.Conversations = append(x.Conversations, v)
			return nil
		}},
		{`SELECT request_id,conversation_id,user_id,model_id,status,input_tokens,output_tokens,cached_tokens,total_tokens,started_at,ended_at FROM hub_usage_records`, func(rows *sql.Rows) error {
			var v Usage
			if err := rows.Scan(&v.RequestID, &v.ConversationID, &v.UserID, &v.ModelID, &v.Status, &v.InputTokens, &v.OutputTokens, &v.CachedTokens, &v.TotalTokens, &v.StartedAt, &v.EndedAt); err != nil {
				return err
			}
			x.Usages = append(x.Usages, v)
			return nil
		}},
		{`SELECT actor_id,action,object_type,object_id,result,trace_id,created_at FROM hub_audit_logs ORDER BY id`, func(rows *sql.Rows) error {
			var v Audit
			if err := rows.Scan(&v.ActorID, &v.Action, &v.ObjectType, &v.ObjectID, &v.Result, &v.TraceID, &v.CreatedAt); err != nil {
				return err
			}
			x.Audits = append(x.Audits, v)
			return nil
		}},
	}
	for _, item := range queries {
		rows, err := r.DB.QueryContext(ctx, item.q)
		if err != nil {
			return x, err
		}
		for rows.Next() {
			if err = item.scan(rows); err != nil {
				rows.Close()
				return x, err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return x, err
		}
	}
	return x, nil
}

// Save uses one transaction so callers never observe half-written grants,
// memberships, usage, or audit rows. V1 deploys one mutating Core API instance.
func (r *MySQLRepository) Save(ctx context.Context, x Snapshot) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"hub_group_members", "hub_grants", "hub_usage_records", "hub_audit_logs", "hub_conversations", "hub_models", "hub_providers", "hub_groups", "sys_users"} {
		if _, err = tx.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return err
		}
	}
	for _, v := range x.Users {
		_, err = tx.ExecContext(ctx, `INSERT INTO sys_users(id,username,password_hash,role,status) VALUES(?,?,?,?,?)`, v.ID, v.Username, v.PasswordHash, v.Role, v.Status)
		if err != nil {
			return err
		}
	}
	for _, v := range x.Groups {
		_, err = tx.ExecContext(ctx, `INSERT INTO hub_groups(id,name,status) VALUES(?,?,?)`, v.ID, v.Name, v.Status)
		if err != nil {
			return err
		}
	}
	for _, v := range x.Providers {
		var synced any
		if !v.LastSyncedAt.IsZero() {
			synced = v.LastSyncedAt
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO hub_providers(provider,name,status,last_synced_at) VALUES(?,?,?,?)`, v.Provider, v.Name, v.Status, synced)
		if err != nil {
			return err
		}
	}
	for _, v := range x.Models {
		_, err = tx.ExecContext(ctx, `INSERT INTO hub_models(id,provider,upstream_model_id,name,enabled,available) VALUES(?,?,?,?,?,?)`, v.ID, v.Provider, v.UpstreamModelID, v.Name, v.Enabled, v.Available)
		if err != nil {
			return err
		}
	}
	for g, users := range x.Members {
		for _, u := range users {
			_, err = tx.ExecContext(ctx, `INSERT INTO hub_group_members(group_id,user_id) VALUES(?,?)`, g, u)
			if err != nil {
				return err
			}
		}
	}
	for _, v := range x.Grants {
		_, err = tx.ExecContext(ctx, `INSERT INTO hub_grants(subject_type,subject_id,model_id) VALUES(?,?,?)`, v.SubjectType, v.SubjectID, v.ModelID)
		if err != nil {
			return err
		}
	}
	for _, v := range x.Conversations {
		_, err = tx.ExecContext(ctx, `INSERT INTO hub_conversations(id,owner_id,model_id,pi_session_ref,title,hidden,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, v.ID, v.OwnerID, v.ModelID, v.SessionRef, v.Title, v.Hidden, v.CreatedAt, v.UpdatedAt)
		if err != nil {
			return err
		}
	}
	for _, v := range x.Usages {
		_, err = tx.ExecContext(ctx, `INSERT INTO hub_usage_records(request_id,conversation_id,user_id,model_id,status,input_tokens,output_tokens,cached_tokens,total_tokens,started_at,ended_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, v.RequestID, v.ConversationID, v.UserID, v.ModelID, v.Status, v.InputTokens, v.OutputTokens, v.CachedTokens, v.TotalTokens, v.StartedAt, v.EndedAt)
		if err != nil {
			return err
		}
	}
	for _, v := range x.Audits {
		_, err = tx.ExecContext(ctx, `INSERT INTO hub_audit_logs(actor_id,action,object_type,object_id,result,trace_id,created_at) VALUES(?,?,?,?,?,?,?)`, v.ActorID, v.Action, v.ObjectType, v.ObjectID, v.Result, v.TraceID, v.CreatedAt)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

type RedisRuntime struct {
	Client *redis.Client
	Prefix string
}

func OpenRedis(addr, password string, db int) (*RedisRuntime, error) {
	c := redis.NewClient(&redis.Options{Addr: addr, Password: password, DB: db})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		c.Close()
		return nil, err
	}
	return &RedisRuntime{Client: c, Prefix: "tah:"}, nil
}
func (r *RedisRuntime) Close() error { return r.Client.Close() }
func (r *RedisRuntime) Put(ctx context.Context, key, user string, ttl time.Duration) error {
	return r.Client.Set(ctx, r.Prefix+"token:"+key, user, ttl).Err()
}
func (r *RedisRuntime) Get(ctx context.Context, key string) (string, bool, error) {
	v, err := r.Client.Get(ctx, r.Prefix+"token:"+key).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	return v, err == nil, err
}

var takeScript = redis.NewScript(`local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]) end; return v`)

func (r *RedisRuntime) Take(ctx context.Context, key string) (string, bool, error) {
	v, err := takeScript.Run(ctx, r.Client, []string{r.Prefix + "token:" + key}).Text()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	return v, err == nil, err
}
func (r *RedisRuntime) Delete(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	for i := range keys {
		keys[i] = r.Prefix + "token:" + keys[i]
	}
	return r.Client.Del(ctx, keys...).Err()
}

var acquireScript = redis.NewScript(`
if redis.call('EXISTS',KEYS[1])==1 then return 1 end
local system=tonumber(redis.call('GET',KEYS[2]) or '0')
local user=tonumber(redis.call('GET',KEYS[3]) or '0')
if system>=tonumber(ARGV[1]) or user>=tonumber(ARGV[2]) then return 2 end
redis.call('SET',KEYS[1],ARGV[3],'PX',ARGV[4]); redis.call('INCR',KEYS[2]); redis.call('PEXPIRE',KEYS[2],ARGV[4]); redis.call('INCR',KEYS[3]); redis.call('PEXPIRE',KEYS[3],ARGV[4]); return 0`)

func (r *RedisRuntime) Acquire(ctx context.Context, conversation, user string, maxUser, maxSystem int, ttl time.Duration) error {
	keys := []string{r.Prefix + "generation:" + conversation, r.Prefix + "inflight:system", r.Prefix + "inflight:user:" + user}
	n, err := acquireScript.Run(ctx, r.Client, keys, maxSystem, maxUser, user, ttl.Milliseconds()).Int()
	if err != nil {
		return err
	}
	if n == 1 {
		return ErrConversationBusy
	}
	if n == 2 {
		return ErrConcurrencyLimit
	}
	return nil
}

var releaseScript = redis.NewScript(`if redis.call('DEL',KEYS[1])==1 then local s=tonumber(redis.call('GET',KEYS[2]) or '0'); if s>0 then redis.call('DECR',KEYS[2]) end; local u=tonumber(redis.call('GET',KEYS[3]) or '0'); if u>0 then redis.call('DECR',KEYS[3]) end end; return 0`)

func (r *RedisRuntime) Release(ctx context.Context, conversation, user string) error {
	return releaseScript.Run(ctx, r.Client, []string{r.Prefix + "generation:" + conversation, r.Prefix + "inflight:system", r.Prefix + "inflight:user:" + user}).Err()
}
func (r *RedisRuntime) Exists(ctx context.Context, conversation string) (bool, error) {
	n, err := r.Client.Exists(ctx, r.Prefix+"generation:"+conversation).Result()
	return n == 1, err
}

func RedisDB(v string) int { n, _ := strconv.Atoi(v); return n }
func MySQLDSN(user, password, host, database string) string {
	return fmt.Sprintf("%s:%s@tcp(%s)/%s?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci", user, password, host, database)
}
