# Terminal Agent Hub 部署与验收

> V1 当前提供两套 mock 前端和一个可测试的最小 Go API。生产使用前必须完成文末“已知限制”中的持久化与完整 Simple Admin 接入。

## 1. 环境依赖

- Docker Engine 26+、Docker Compose v2.30+
- 原生部署：Go 1.25+、Node.js 20+（前端构建）、MySQL 8.4、Redis 7.4
- Linux/macOS 均可开发；生产建议 Linux、独立非 root 用户、反向代理（Caddy/Nginx）和 HTTPS
- 默认测试不需要外网、GLM/DeepSeek 或真实 Provider Key

## 2. 开发调试方案（统一使用 Docker）

所有开发工作项和 Agent 均应优先在 Docker 容器内完成自己的调试闭环：

- 有专用 Dockerfile 的组件使用自己的 Dockerfile 构建；没有专用镜像的组件直接使用已有镜像（例如 `node:22-alpine`、`mysql:8.4`、`redis:7.4.2-alpine`）。
- 源码通过 bind mount 挂载到容器，容器内执行测试、lint、build 或 dev server；依赖目录使用 Docker named volume，避免污染宿主机。
- 统一组件由项目根目录 `docker-compose.dev.yml` 提供：MySQL、Redis、迁移、core-api、core-rpc、session-ui 和 admin-ui。
- 开发 Compose 只使用本地开发配置和 mock，不使用真实 Provider、真实凭据或外网模型调用。

启动开发环境：

```bash
# 项目根目录
mkdir -p data/mysql data/redis data/pi-sessions
chmod 700 data data/mysql data/redis data/pi-sessions
docker compose -f docker-compose.dev.yml config
docker compose -f docker-compose.dev.yml up -d
```

只启动所有 Agent 共用的基础组件：

```bash
docker compose -f docker-compose.dev.yml up -d mysql redis
# 等待健康状态
docker compose -f docker-compose.dev.yml ps
```

常用调试命令：

```bash
docker compose -f docker-compose.dev.yml logs -f mysql redis
# 指定服务日志
docker compose -f docker-compose.dev.yml logs -f core-api session-ui
# 进入容器执行命令
docker compose -f docker-compose.dev.yml exec core-api sh
docker compose -f docker-compose.dev.yml exec mysql mysql -utah -ptah-dev-password tah
# 停止但保留 data 数据
docker compose -f docker-compose.dev.yml stop
# 删除容器但保留 data 数据
docker compose -f docker-compose.dev.yml down
```

数据挂载到项目根目录的 `data/`：`data/mysql`、`data/redis`、`data/pi-sessions`。该目录已在 `.gitignore` 中整体忽略，测试数据不会进入 Git。开发 Compose 的源代码挂载和基础组件可供所有 Agent 共用；Agent 不应各自启动另一套 MySQL/Redis。

## 3. Docker Compose 部署

进入 `backend/deploy/docker-compose/`，创建未纳入 Git 的 `secrets/`：

```bash
mkdir -p secrets
umask 077
printf '%s\n' 'change-this-mysql-password' > secrets/mysql_password
printf '%s\n' 'change-this-root-password' > secrets/mysql_root_password
printf '%s\n' 'change-this-bootstrap-password' > secrets/bootstrap_admin_password
cat > secrets/pi_models.json <<'EOF'
{"providers":{}}
EOF
chmod 600 secrets/*
./check-secrets.sh
```

`pi_models.json` 使用 PI 支持的 `models.json`/受保护凭据格式；真实凭据只应通过受保护文件或 Docker Secret 注入，不能写入命令行、浏览器、数据库或日志。配置真实 Provider 前先确认区域、Base URL 和模型 ID。

```bash
export TAH_BOOTSTRAP_ADMIN_USERNAME=admin
# 生产必须保持 true；本地 HTTP 才可设 false
# export TAH_COOKIE_SECURE=false
docker compose config
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

停止/重启：

```bash
docker compose stop
docker compose start
docker compose restart core-api
# 删除容器但保留卷
docker compose down
# 破坏性删除所有数据（谨慎）
docker compose down -v
```

Compose 会先启动 MySQL/Redis，执行 `migrate`，再启动 API。健康检查覆盖 MySQL、Redis、core-rpc、core-api。当前 PI CLI 需存在于 core-api 镜像并由 `PI_COMMAND` 指定；部署镜像安装 PI CLI 的版本应在发布时固定。

## 4. 原生部署

1. 准备 MySQL、Redis 和受保护的 PI Session 目录（目录权限 0700，服务用户可读写）。
2. 在 `backend/` 执行：

```bash
go test ./...
go build -o bin/hub-api ./api
PI_DATA_DIR=/var/lib/tah/pi-sessions \
PI_COMMAND=pi \
TAH_LISTEN_ADDR=:8080 \
TAH_COOKIE_SECURE=true \
TAH_BOOTSTRAP_ADMIN_USERNAME=admin \
TAH_BOOTSTRAP_ADMIN_PASSWORD_FILE=/etc/tah/bootstrap_admin_password \
./bin/hub-api
```

3. 前端分别在 `session-ui/`、`admin-ui/` 执行 `pnpm install`、`pnpm build`，将产物交给同一个 HTTPS 反向代理。生产将 `VITE_USE_MOCK=false`、`VITE_API_BASE_URL=/api/v1`（或明确的同源 API 路径）。
4. 以 systemd/supervisor 管理 API，禁止把 Provider Key 放进 `ExecStart` 参数或普通环境日志；PI 凭据文件使用 0600。

## 5. 配置与环境变量

| 变量 | 用途 |
|---|---|
| `TAH_LISTEN_ADDR` | API 监听地址，默认 `:8080` |
| `TAH_COOKIE_SECURE` | Cookie Secure；生产必须 `true` |
| `TAH_MAX_INFLIGHT_PER_USER` | 用户并发生成上限，默认 2 |
| `TAH_MAX_INFLIGHT_SYSTEM` | 系统并发生成上限，默认 20 |
| `TAH_BOOTSTRAP_ADMIN_USERNAME` | 首个管理员用户名 |
| `TAH_BOOTSTRAP_ADMIN_PASSWORD_FILE` | 首个管理员密码文件路径，优先于明文变量 |
| `PI_COMMAND` | PI 可执行文件，默认 `pi` |
| `PI_DATA_DIR` | PI Session 持久化目录 |
| `PI_MODELS_FILE` | PI 受保护 models 配置路径；不由浏览器/API 管理 |
| `VITE_USE_MOCK` | 前端是否启用 mock，开发默认 true，真实后端必须 false |
| `VITE_API_BASE_URL` | 前端唯一 API 基址 |

身份 Cookie 为 `tah_access`、`tah_refresh`，HttpOnly、SameSite=Lax；生产必须 HTTPS/Secure。不要把 `ZAI_API_KEY`、`DEEPSEEK_API_KEY` 或其他凭据传给 Simple Admin。

## 6. 数据库迁移与持久化

Compose 的 `migrate` 执行 `backend/rpc/ent/migrate/001_hub.sql`。原生部署应使用最小权限数据库账号执行迁移，并在升级前备份。持久化位置：

- `mysql_data`：MySQL 数据
- `redis_data`：Token/运行时状态
- `pi_sessions`：PI JSONL 会话正文
- `backend/deploy/docker-compose/secrets/`：仅本机 Secret 文件，不提交 Git

会话正文不应复制到 MySQL；`pi_session_ref` 只能是不透明相对引用。

## 7. 首个管理员

通过 `TAH_BOOTSTRAP_ADMIN_USERNAME` + `TAH_BOOTSTRAP_ADMIN_PASSWORD_FILE` 引导创建。密码至少 12 位，首次启动后应移除 bootstrap 环境配置并通过管理员流程轮换密码。没有完整凭据时不会创建管理员。

## 8. HTTPS 与反向代理

推荐单域名路径：`/chat/`、`/admin/`、`/api/`，将 `/api/` 代理到 core-api，并保留 `text/event-stream`、`Cache-Control: no-store` 和禁用代理缓冲：

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8080/api/;
  proxy_http_version 1.1;
  proxy_buffering off;
  proxy_read_timeout 300s;
}
```

使用 HTTPS 证书（ACME/Caddy 或企业证书），只允许 TLS 1.2+，设置 HSTS、CSP、X-Content-Type-Options、X-Frame-Options，并限制 CORS 为明确来源。跨子域部署时必须明确 Cookie Domain、SameSite、CORS 和 CSRF 策略。

## 9. 健康检查

```bash
curl -i http://127.0.0.1:8080/healthz
# Compose
cd backend/deploy/docker-compose && docker compose ps
# API 日志（不得出现 Provider Key）
docker compose logs --tail=100 core-api
```

## 10. 常见故障

- **Secret 权限错误**：执行 `chmod 600 secrets/*` 和 `./check-secrets.sh`。
- **迁移失败**：确认 MySQL healthy、账号密码一致，查看 `docker compose logs migrate`，不要跳过迁移。
- **Cookie 登录失败**：本地 HTTP 设 `TAH_COOKIE_SECURE=false`；生产检查 HTTPS、代理 `X-Forwarded-Proto` 与同源路径。
- **SSE 不出字**：检查代理 buffering、read timeout 和响应 `text/event-stream`；确认 PI 进程能启动且 Session 目录可写。
- **PI_UNAVAILABLE**：检查 `PI_COMMAND`、`PI_DATA_DIR`、models 配置和服务用户权限；Adapter 只接受安全的不透明 session ref。
- **模型为空**：检查 Provider 在 PI 侧已配置并同步；新同步模型默认停用，需管理员启用并授权。
- **403/只读**：重新计算用户/组授权、Model enabled/available 状态；撤权后历史仍可读但不能发新消息。
- **429/409**：检查同会话生成锁和用户/系统并发设置；不要隐式重试 prompt。

## 11. 完整验收流程

1. `docker compose config`、`docker compose up -d`、所有健康检查通过。
2. 使用引导管理员登录后台；普通用户访问 `/admin` 得 403。
3. 在 PI 侧配置 fixture 或受保护 Provider，后台同步；确认响应无 key/token/secret。
4. 创建用户、两个组，将用户加入多组；启用模型并通过组授权，验证有效模型为直接授权与组授权并集。
5. 会话 UI 登录，创建固定模型会话，发送多轮消息；验证 `text_delta → usage(可选) → done`，中止为 `done(aborted)`，错误不同时出现 done。
6. 在生成期间重复发送得到 409，超并发得到 429；撤销授权后下一次发送被拒绝，历史会话变只读。
7. 刷新恢复历史；用户软删除后列表隐藏，管理员仍能看到并分页审阅；每次成功/失败审阅均有 trace ID 审计。
8. 核对用量 request ID 幂等、未知 Token 为 null/未知；运行跨用户、禁用账号、Token 刷新/退出、XSS、CSRF、错误脱敏测试。
9. 重启服务后检查 MySQL/Redis/PI 卷与健康状态，并执行 Provider fixture 的 401/429/5xx/超时/缺 Usage 测试。
10. 扫描仓库、HTTP 响应、日志和数据库导出，不得出现 Provider Key、认证头或内部路径。

## 12. 当前已知限制与发布前门禁

当前实现是可测试的最小骨架：API 运行时业务 Store 仍为内存实现，尚未完成 Core API→Core RPC/MySQL 的生产 wiring；Compose 中 core-rpc/core-api 仍需按最终 Simple Admin 进程拆分；PI Adapter 已有实现但需在正式镜像中固定并验证 PI CLI 版本；GLM/DeepSeek live 测试和真实 Compose 重启持久化测试尚未执行。上述项目完成并通过空环境部署、权限、密钥扫描、Provider fixture、并发及恢复验收前，不得宣称生产可交付。
