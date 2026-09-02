// Package hub implements Terminal Agent Hub use cases without depending on HTTP,
// Ent, or a concrete PI process. The interfaces are deliberately injectable.
package hub

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrUnauthenticated    = errors.New("UNAUTHENTICATED")
	ErrForbidden          = errors.New("FORBIDDEN")
	ErrNotFound           = errors.New("NOT_FOUND")
	ErrModelUnauthorized  = errors.New("MODEL_NOT_AUTHORIZED")
	ErrConversationBusy   = errors.New("CONVERSATION_BUSY")
	ErrNoActiveGeneration = errors.New("NO_ACTIVE_GENERATION")
	ErrConcurrencyLimit   = errors.New("CONCURRENCY_LIMIT")
	ErrLoginRateLimited   = errors.New("LOGIN_RATE_LIMITED")
	ErrPIUnavailable      = errors.New("PI_UNAVAILABLE")
)

type Clock interface{ Now() time.Time }
type realClock struct{}

func (realClock) Now() time.Time { return time.Now().UTC() }

type User struct{ ID, Username, PasswordHash, Role, Status string }
type Group struct{ ID, Name, Status string }
type Provider struct {
	Provider, Name, Status string
	LastSyncedAt           time.Time
}
type Model struct {
	ID, Provider, UpstreamModelID, Name string
	Enabled, Available                  bool
}
type Grant struct{ SubjectType, SubjectID, ModelID string }
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
type Audit struct {
	ActorID, Action, ObjectType, ObjectID, Result, TraceID string
	CreatedAt                                              time.Time
}
type Message struct {
	ID, Role, Content, Status string
	CreatedAt                 time.Time
}
type Page struct {
	Items     []Message
	NextSince string
	HasMore   bool
}

// Snapshot is the persistence boundary between Hub domain logic and the MySQL
// adapter. Runtime-only access/refresh tokens are intentionally absent.
type Snapshot struct {
	Users         []User
	Groups        []Group
	Members       map[string][]string
	Providers     []Provider
	Models        []Model
	Grants        []Grant
	Conversations []Conversation
	Usages        []Usage
	Audits        []Audit
}

type Persistence interface {
	Load(context.Context) (Snapshot, error)
	Save(context.Context, Snapshot) error
}

type Store struct {
	mu            sync.RWMutex
	persistence   Persistence
	persistErr    error
	Users         map[string]User
	Groups        map[string]Group
	Members       map[string]map[string]bool
	Providers     map[string]Provider
	Models        map[string]Model
	Grants        map[string]Grant
	Conversations map[string]Conversation
	Usages        map[string]Usage
	Audits        []Audit
	refresh       map[string]tokenRecord
	access        map[string]tokenRecord
}
type tokenRecord struct {
	UserID    string
	ExpiresAt time.Time
}

func NewStore() *Store {
	return &Store{Users: map[string]User{}, Groups: map[string]Group{}, Members: map[string]map[string]bool{}, Providers: map[string]Provider{}, Models: map[string]Model{}, Grants: map[string]Grant{}, Conversations: map[string]Conversation{}, Usages: map[string]Usage{}, refresh: map[string]tokenRecord{}, access: map[string]tokenRecord{}}
}

// AttachPersistence loads the durable state before the HTTP server starts.
// There is deliberately no fallback to an empty store when MySQL is configured:
// silently doing so would make a restart appear to have deleted organization data.
func (s *Store) AttachPersistence(ctx context.Context, p Persistence) error {
	snap, err := p.Load(ctx)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.persistence = p
	s.Users = map[string]User{}
	for _, v := range snap.Users {
		s.Users[v.ID] = v
	}
	s.Groups = map[string]Group{}
	for _, v := range snap.Groups {
		s.Groups[v.ID] = v
	}
	s.Members = map[string]map[string]bool{}
	for g, users := range snap.Members {
		s.Members[g] = map[string]bool{}
		for _, u := range users {
			s.Members[g][u] = true
		}
	}
	s.Providers = map[string]Provider{}
	for _, v := range snap.Providers {
		s.Providers[v.Provider] = v
	}
	s.Models = map[string]Model{}
	for _, v := range snap.Models {
		s.Models[v.ID] = v
	}
	s.Grants = map[string]Grant{}
	for _, v := range snap.Grants {
		s.Grants[grantKey(v)] = v
	}
	s.Conversations = map[string]Conversation{}
	for _, v := range snap.Conversations {
		s.Conversations[v.ID] = v
	}
	s.Usages = map[string]Usage{}
	for _, v := range snap.Usages {
		s.Usages[v.RequestID] = v
	}
	s.Audits = append([]Audit(nil), snap.Audits...)
	return nil
}
func (s *Store) snapshotLocked() Snapshot {
	x := Snapshot{Members: map[string][]string{}}
	for _, v := range s.Users {
		x.Users = append(x.Users, v)
	}
	for _, v := range s.Groups {
		x.Groups = append(x.Groups, v)
	}
	for g, users := range s.Members {
		for u := range users {
			x.Members[g] = append(x.Members[g], u)
		}
	}
	for _, v := range s.Providers {
		x.Providers = append(x.Providers, v)
	}
	for _, v := range s.Models {
		x.Models = append(x.Models, v)
	}
	for _, v := range s.Grants {
		x.Grants = append(x.Grants, v)
	}
	for _, v := range s.Conversations {
		x.Conversations = append(x.Conversations, v)
	}
	for _, v := range s.Usages {
		x.Usages = append(x.Usages, v)
	}
	x.Audits = append(x.Audits, s.Audits...)
	return x
}
func (s *Store) persistLocked() {
	if s.persistence != nil {
		s.persistErr = s.persistence.Save(context.Background(), s.snapshotLocked())
	}
}
func (s *Store) Persist() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.persistLocked()
	return s.persistErr
}
func (s *Store) PersistenceError() error { s.mu.RLock(); defer s.mu.RUnlock(); return s.persistErr }
func randomID(prefix string) string {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

func HashPassword(password string) (string, error) {
	if len(password) < 12 {
		return "", errors.New("password must be at least 12 characters")
	}
	salt := make([]byte, 16)
	if _, e := rand.Read(salt); e != nil {
		return "", e
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, 210000, 32)
	if err != nil {
		return "", err
	}
	return "pbkdf2-sha256$210000$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key), nil
}
func VerifyPassword(encoded, password string) bool {
	p := strings.Split(encoded, "$")
	if len(p) != 4 || p[0] != "pbkdf2-sha256" {
		return false
	}
	var n int
	if _, e := fmt.Sscanf(p[1], "%d", &n); e != nil {
		return false
	}
	salt, e1 := base64.RawStdEncoding.DecodeString(p[2])
	want, e2 := base64.RawStdEncoding.DecodeString(p[3])
	if e1 != nil || e2 != nil {
		return false
	}
	got, e := pbkdf2.Key(sha256.New, password, salt, n, len(want))
	return e == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// AuthService wraps the underlying user records in opaque, rotating browser sessions.
type AuthService struct {
	Store        *Store
	Clock        Clock
	SecureCookie bool
	Tokens       TokenStore
	mu           sync.Mutex
	attempts     map[string]*attempt
}
type attempt struct {
	Count        int
	BlockedUntil time.Time
}
type Session struct {
	Access, Refresh string
	User            User
}

func NewAuth(s *Store) *AuthService {
	return &AuthService{Store: s, Clock: realClock{}, Tokens: newMemoryTokenStore(), attempts: map[string]*attempt{}}
}
func (a *AuthService) SetTokenStore(tokens TokenStore) {
	if tokens != nil {
		a.Tokens = tokens
	}
}
func (a *AuthService) BootstrapAdmin(username, password string) (User, error) {
	a.Store.mu.Lock()
	defer a.Store.mu.Unlock()
	for _, u := range a.Store.Users {
		if u.Role == "admin" {
			return User{}, errors.New("administrator already exists")
		}
	}
	h, e := HashPassword(password)
	if e != nil {
		return User{}, e
	}
	u := User{ID: randomID("u_"), Username: username, PasswordHash: h, Role: "admin", Status: "active"}
	a.Store.Users[u.ID] = u
	a.Store.persistLocked()
	return u, a.Store.persistErr
}
func (a *AuthService) Login(username, password, source string) (Session, error) {
	key := strings.ToLower(username) + "|" + source
	now := a.Clock.Now()
	a.mu.Lock()
	at := a.attempts[key]
	if at != nil && now.Before(at.BlockedUntil) {
		a.mu.Unlock()
		return Session{}, ErrLoginRateLimited
	}
	a.mu.Unlock()
	a.Store.mu.Lock()
	defer a.Store.mu.Unlock()
	var found User
	for _, u := range a.Store.Users {
		if strings.EqualFold(u.Username, username) {
			found = u
			break
		}
	}
	if found.ID == "" || !VerifyPassword(found.PasswordHash, password) {
		a.fail(key, now)
		return Session{}, ErrUnauthenticated
	}
	if found.Status != "active" {
		return Session{}, ErrForbidden
	}
	a.mu.Lock()
	delete(a.attempts, key)
	a.mu.Unlock()
	session := a.issueLocked(found)
	if session.Access == "" {
		return Session{}, ErrPIUnavailable
	}
	return session, nil
}
func (a *AuthService) fail(key string, now time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	x := a.attempts[key]
	if x == nil {
		x = &attempt{}
		a.attempts[key] = x
	}
	x.Count++
	if x.Count >= 5 {
		x.BlockedUntil = now.Add(time.Minute)
	}
}
func (a *AuthService) issueLocked(u User) Session {
	access := randomID("a_")
	refresh := randomID("r_")
	if a.Tokens.Put(context.Background(), "access:"+access, u.ID, 15*time.Minute) != nil {
		return Session{}
	}
	if a.Tokens.Put(context.Background(), "refresh:"+refresh, u.ID, 7*24*time.Hour) != nil {
		_ = a.Tokens.Delete(context.Background(), "access:"+access)
		return Session{}
	}
	return Session{Access: access, Refresh: refresh, User: u}
}
func (a *AuthService) Refresh(token string) (Session, error) {
	userID, ok, err := a.Tokens.Take(context.Background(), "refresh:"+token)
	if err != nil || !ok {
		return Session{}, ErrUnauthenticated
	}
	a.Store.mu.RLock()
	u, exists := a.Store.Users[userID]
	a.Store.mu.RUnlock()
	if !exists || u.Status != "active" {
		return Session{}, ErrUnauthenticated
	}
	s := a.issueLocked(u)
	if s.Access == "" {
		return Session{}, ErrUnauthenticated
	}
	return s, nil
}
func (a *AuthService) Me(token string) (User, error) {
	userID, ok, err := a.Tokens.Get(context.Background(), "access:"+token)
	if err != nil || !ok {
		return User{}, ErrUnauthenticated
	}
	a.Store.mu.RLock()
	u, exists := a.Store.Users[userID]
	a.Store.mu.RUnlock()
	if !exists || u.Status != "active" {
		return User{}, ErrUnauthenticated
	}
	return u, nil
}
func (a *AuthService) Logout(access, refresh string) {
	_ = a.Tokens.Delete(context.Background(), "access:"+access, "refresh:"+refresh)
}

func grantKey(g Grant) string { return g.SubjectType + "|" + g.SubjectID + "|" + g.ModelID }
func (s *Store) PutGrant(g Grant) error {
	if g.SubjectType != "user" && g.SubjectType != "group" {
		return errors.New("subject_type must be user or group")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Grants[grantKey(g)] = g
	s.persistLocked()
	return s.persistErr
}
func (s *Store) RemoveGrant(g Grant) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.Grants, grantKey(g))
	s.persistLocked()
}
func (s *Store) SetMembers(group string, add, remove []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Members[group] == nil {
		s.Members[group] = map[string]bool{}
	}
	for _, u := range add {
		s.Members[group][u] = true
	}
	for _, u := range remove {
		delete(s.Members[group], u)
	}
	s.persistLocked()
}

// EffectiveModels is the sole authorization calculation used by listing and prompts.
func (s *Store) EffectiveModels(userID string) []Model {
	s.mu.RLock()
	defer s.mu.RUnlock()
	candidate := map[string]bool{}
	for _, g := range s.Grants {
		if g.SubjectType == "user" && g.SubjectID == userID {
			candidate[g.ModelID] = true
		}
		if g.SubjectType == "group" && s.Members[g.SubjectID][userID] {
			if gr, ok := s.Groups[g.SubjectID]; ok && gr.Status == "active" {
				candidate[g.ModelID] = true
			}
		}
	}
	out := []Model{}
	for id := range candidate {
		if m, ok := s.Models[id]; ok && m.Enabled && m.Available {
			if p, ok := s.Providers[m.Provider]; ok && p.Status == "active" {
				out = append(out, m)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
func (s *Store) IsModelEffective(user, model string) bool {
	for _, m := range s.EffectiveModels(user) {
		if m.ID == model {
			return true
		}
	}
	return false
}

type ProviderSnapshot struct {
	Provider, Name, Status string
	Models                 []SnapshotModel
}
type SnapshotModel struct{ UpstreamModelID, Name string }
type ProviderCatalog interface {
	ListProviders(context.Context) ([]ProviderSnapshot, error)
}

func (s *Store) SyncProviders(ctx context.Context, c ProviderCatalog, now time.Time) error {
	list, err := c.ListProviders(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		for k, p := range s.Providers {
			p.Status = "stale"
			s.Providers[k] = p
		}
		return err
	}
	seen := map[string]bool{}
	for _, p := range list {
		s.Providers[p.Provider] = Provider{Provider: p.Provider, Name: p.Name, Status: p.Status, LastSyncedAt: now}
		for _, sm := range p.Models {
			key := p.Provider + "\x00" + sm.UpstreamModelID
			seen[key] = true
			var id string
			for mid, m := range s.Models {
				if m.Provider+"\x00"+m.UpstreamModelID == key {
					id = mid
					break
				}
			}
			if id == "" {
				id = randomID("m_")
				s.Models[id] = Model{ID: id, Provider: p.Provider, UpstreamModelID: sm.UpstreamModelID, Name: sm.Name, Available: true}
			} else {
				m := s.Models[id]
				m.Name = sm.Name
				m.Available = true
				s.Models[id] = m
			}
		}
	}
	for id, m := range s.Models {
		if !seen[m.Provider+"\x00"+m.UpstreamModelID] {
			m.Available = false
			s.Models[id] = m
		}
	}
	s.persistLocked()
	return s.persistErr
}

func (s *Store) CreateConversation(owner, model, title string, now time.Time) (Conversation, error) {
	if !s.IsModelEffective(owner, model) {
		return Conversation{}, ErrModelUnauthorized
	}
	if title == "" {
		title = "新会话"
	}
	c := Conversation{ID: randomID("c_"), OwnerID: owner, ModelID: model, SessionRef: randomID("session_"), Title: title, CreatedAt: now, UpdatedAt: now}
	s.mu.Lock()
	s.Conversations[c.ID] = c
	s.persistLocked()
	err := s.persistErr
	s.mu.Unlock()
	return c, err
}
func (s *Store) ConversationForUser(id, user string, includeHidden bool) (Conversation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.Conversations[id]
	if !ok || c.OwnerID != user || (!includeHidden && c.Hidden) {
		return Conversation{}, ErrNotFound
	}
	return c, nil
}
func (s *Store) HideConversation(id, user string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.Conversations[id]
	if !ok || c.OwnerID != user {
		return ErrNotFound
	}
	c.Hidden = true
	c.UpdatedAt = time.Now().UTC()
	s.Conversations[id] = c
	s.persistLocked()
	return s.persistErr
}
func (s *Store) RenameConversation(id, user, title string) error {
	title = strings.TrimSpace(title)
	if title == "" || len(title) > 200 {
		return errors.New("invalid title")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.Conversations[id]
	if !ok || c.OwnerID != user || c.Hidden {
		return ErrNotFound
	}
	c.Title = title
	c.UpdatedAt = time.Now().UTC()
	s.Conversations[id] = c
	s.persistLocked()
	return s.persistErr
}
func (s *Store) RecordUsage(u Usage) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.Usages[u.RequestID]; ok {
		return false
	}
	s.Usages[u.RequestID] = u
	s.persistLocked()
	return s.persistErr == nil
}
func (s *Store) AddAudit(a Audit) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a.CreatedAt = time.Now().UTC()
	s.Audits = append(s.Audits, a)
	s.persistLocked()
}

var sensitive = regexp.MustCompile(`(?i)(api[_-]?key|authorization|token|secret)\s*[:=]\s*[^\s,;]+`)

func Redact(v string) string { return sensitive.ReplaceAllString(v, "$1=[REDACTED]") }
func (s *Store) Review(ctx context.Context, actor, trace string, c Conversation, reader func(context.Context, string, string, int) (Page, error), since string, limit int) (Page, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	page, err := reader(ctx, c.SessionRef, since, limit)
	result := "success"
	if err != nil {
		result = "failed"
	}
	s.AddAudit(Audit{ActorID: actor, Action: "conversation.review", ObjectType: "conversation", ObjectID: c.ID, Result: result, TraceID: trace})
	for i := range page.Items {
		page.Items[i].Content = Redact(page.Items[i].Content)
	}
	return page, err
}
