# Terminal Agent Hub Worklog

## 2026-09-02

### 当前进度

- 已完成并行 Agent A/B/C/D 的第一轮任务。
- `session-ui/`：mock 登录、模型选择、SSE 对话、中止、历史、只读会话和用量页面已完成。
- `admin-ui/`：独立 Vite + Vue 3 + TypeScript + Ant Design Vue + MSW 后台页面已完成，覆盖用户、组、Provider、Model、授权、用量、会话审阅和审计。
- `backend/`：最小 Go API、认证/RBAC、模型授权、会话索引、SSE 编排、用量幂等、审计、PI JSONL Adapter、迁移和 Compose 骨架已完成。
- 已创建部署文档：`docs/deployment.md`。
- 最后一次验证：前后端测试、静态检查、构建和 `docker compose config` 通过。

### 本次准备工作

- 新增 `docker-compose.dev.yml`，将开发所需 MySQL、Redis、迁移、core-api、core-rpc、session-ui 和 admin-ui 统一容器化。
- 新增项目根目录 `data/`，用于本地开发的 MySQL、Redis、PI Session 数据挂载：
  - `data/mysql/`
  - `data/redis/`
  - `data/pi-sessions/`
- 更新 `.gitignore`，忽略整个 `/data/`，避免测试数据进入版本库。
- 本地数据目录权限设置为 `0700`；Compose 开发配置使用独立开发密码，不使用真实 Provider Key。

### 当前未闭环事项

1. API 运行时业务 Store 仍是内存实现，尚未完成 Core API → Core RPC/MySQL 的生产持久化 wiring。
2. `core-rpc` 当前仍为最小健康服务，尚未替换为完整 Simple Admin Core/RPC 进程。
3. PI CLI 的安装版本尚未固定到开发/生产镜像；默认测试继续使用 fake/fixture。
4. 尚未执行真实 Docker Compose 启动、重启恢复和真实 GLM/DeepSeek Provider 验收。
5. 前端默认使用 mock，开发 Compose 也保持 mock 独立闭环。

### 下一步

- 先用 `docker compose -f docker-compose.dev.yml config` 校验开发编排。
- 按 `docs/deployment.md` 完成数据卷、迁移、健康检查和首个管理员验收。
- 完成 MySQL/Redis wiring、固定 PI CLI 版本后，再进行 Compose 重启持久化和 Provider fixture 全量验收。
