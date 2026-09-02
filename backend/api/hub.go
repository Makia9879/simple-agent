package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	handler "terminal-agent-hub/backend/api/internal/handler/hub"
	logic "terminal-agent-hub/backend/api/internal/logic/hub"
	piadapter "terminal-agent-hub/backend/api/internal/pi"
)

type unavailablePI struct{}

func (unavailablePI) Prompt(context.Context, string, string, string, string) (<-chan logic.PIEvent, error) {
	return nil, logic.ErrPIUnavailable
}
func (unavailablePI) Abort(context.Context, string) error { return logic.ErrPIUnavailable }
func (unavailablePI) Messages(context.Context, string, string, int) (logic.Page, error) {
	return logic.Page{}, logic.ErrPIUnavailable
}
func (unavailablePI) ListProviders(context.Context) ([]logic.ProviderSnapshot, error) {
	return nil, logic.ErrPIUnavailable
}
func secretEnv(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	if file := os.Getenv(key + "_FILE"); file != "" {
		if b, err := os.ReadFile(file); err == nil {
			return strings.TrimSpace(string(b))
		}
	}
	return ""
}
func envInt(k string, d int) int {
	v, e := strconv.Atoi(os.Getenv(k))
	if e != nil || v < 1 {
		return d
	}
	return v
}
func main() {
	s := logic.NewStore()
	var mysqlRepo *logic.MySQLRepository
	dsn := secretEnv("TAH_MYSQL_DSN")
	if dsn == "" && os.Getenv("TAH_MYSQL_HOST") != "" {
		dsn = logic.MySQLDSN(os.Getenv("TAH_MYSQL_USER"), secretEnv("TAH_MYSQL_PASSWORD"), os.Getenv("TAH_MYSQL_HOST"), os.Getenv("TAH_MYSQL_DATABASE"))
	}
	if dsn != "" {
		var err error
		mysqlRepo, err = logic.OpenMySQL(dsn)
		if err != nil {
			log.Fatalf("mysql: %v", err)
		}
		defer mysqlRepo.Close()
		if err = s.AttachPersistence(context.Background(), mysqlRepo); err != nil {
			log.Fatalf("load mysql state: %v", err)
		}
	}
	auth := logic.NewAuth(s)
	var redisRuntime *logic.RedisRuntime
	if addr := os.Getenv("TAH_REDIS_ADDR"); addr != "" {
		var err error
		redisRuntime, err = logic.OpenRedis(addr, secretEnv("TAH_REDIS_PASSWORD"), logic.RedisDB(os.Getenv("TAH_REDIS_DB")))
		if err != nil {
			log.Fatalf("redis: %v", err)
		}
		defer redisRuntime.Close()
		auth.SetTokenStore(redisRuntime)
	}
	user := os.Getenv("TAH_BOOTSTRAP_ADMIN_USERNAME")
	pass := os.Getenv("TAH_BOOTSTRAP_ADMIN_PASSWORD")
	if file := os.Getenv("TAH_BOOTSTRAP_ADMIN_PASSWORD_FILE"); pass == "" && file != "" {
		if b, e := os.ReadFile(file); e == nil {
			pass = string(b)
			for len(pass) > 0 && (pass[len(pass)-1] == '\n' || pass[len(pass)-1] == '\r') {
				pass = pass[:len(pass)-1]
			}
		}
	}
	if user != "" && pass != "" {
		if _, e := auth.BootstrapAdmin(user, pass); e != nil && !errors.Is(e, context.Canceled) {
			log.Printf("bootstrap: %v", e)
		}
	}
	var piClient logic.PI = unavailablePI{}
	var catalog logic.ProviderCatalog = unavailablePI{}
	if dataDir := os.Getenv("PI_DATA_DIR"); dataDir != "" {
		if adapter, e := piadapter.New(piadapter.Config{Command: os.Getenv("PI_COMMAND"), DataDir: dataDir}); e != nil {
			log.Printf("PI adapter disabled: %v", e)
		} else {
			piClient = adapter
			catalog = adapter
		}
	}
	orch := logic.NewOrchestrator(s, piClient)
	if redisRuntime != nil {
		orch.SetRuntime(redisRuntime)
	}
	orch.MaxPerUser = envInt("TAH_MAX_INFLIGHT_PER_USER", 2)
	orch.MaxSystem = envInt("TAH_MAX_INFLIGHT_SYSTEM", 20)
	orch.DisconnectGrace = 120 * time.Second
	secure := os.Getenv("TAH_COOKIE_SECURE") != "false"
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.Handle("/api/v1/", handler.New(s, auth, orch, catalog, secure))
	addr := os.Getenv("TAH_LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 120 * time.Second}
	log.Printf("hub api listening on %s", srv.Addr)
	log.Fatal(srv.ListenAndServe())
}
