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

- 确认统一调试策略：Agent 使用自己的 Dockerfile 或已有镜像，通过源码 bind mount 在容器内完成测试、lint、build 和 dev server 闭环；依赖使用 named volume。
- 尝试启动完整开发 Compose 时，Docker daemon 初始未运行；启动 OrbStack 后恢复。
- 完整构建/拉取因镜像网络下载超时未完成；随后先启动共用基础组件。
- 已成功启动 `mysql:8.4` 和 `redis:7.4.2-alpine`，并确认两者健康。
- 迁移容器已执行成功并退出码为 0。
- session-ui Docker 容器已启动并可返回 HTTP 200；admin-ui 容器仍在首次依赖安装，core-api/core-rpc 镜像构建因网络下载超时尚未完成。
- 调试方法、组件复用、挂载路径和常用命令已补充到 `docs/deployment.md`。
- 本次文档与 Compose 更新已提交并推送：`214c733 chore: document docker development workflow`。
- Agent 收口后，后端与两个前端的测试、类型检查、构建、Go vet/race 全部通过；Docker Compose 已执行 `down` 后重新 `up -d --build`，MySQL/Redis/迁移/core-rpc/core-api/session-ui/admin-ui 全部启动，健康检查通过。
- 使用 Docker 内 fake PI fixture 验证了 Core API 登录、Provider 同步、模型授权、REST/SSE 生成、凭据字段不泄漏、refresh token 重放拒绝、普通用户访问 admin 403，以及 core-api 重启后的 MySQL 状态恢复。
- 需要注意：完整 Simple Admin/go-zero zRPC/Ent/Casbin 框架仍未引入；当前是兼容接口和持久化适配层，core-rpc 仍复用 Hub API 二进制，这是 V1 发布前必须明确的架构残余风险。

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
