# Terminal Agent Hub · 后台 UI（admin-ui / B 线）

面向管理员的独立 SPA：管理员登录、用户/用户组管理、Provider 无密钥登记与同步、
Model 启停与用户/组授权、有效模型预览、全局用量、会话正文审阅与审计。

- 契约来源：`docs/program-design.md` §6–§7、`docs/task-breakdown.md` §3.2（阶段 0 冻结）。
- 默认 **MSW mock 独立闭环**：不启动 Go / PI / 数据库，不访问任何真实后端、Provider 或外网。
- 页面不出现任何 Provider Key 输入或展示；Provider/Model 响应按字段白名单映射。

## 快速开始

```bash
cd admin-ui
pnpm install          # 首次安装（pnpm >= 10）
pnpm dev              # http://localhost:5174 ，mock 网关自动启用
```

Mock 账号（登录页可点击填充）：

| 账号 | 密码 | 说明 |
|---|---|---|
| `admin` | `admin123` | 管理员，可进入后台 |
| `alice` | `alice123` | 普通用户，登录后台会被拒（403 无权限页） |
| `bob` | `bob123` | 已禁用账号，登录返回 403 |

## 命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 开发服务器（mock 网关 + SPA） |
| `pnpm build` | `vue-tsc` 类型检查 + 生产构建（默认仍打 mock） |
| `pnpm typecheck` | 仅类型检查 |
| `pnpm lint` | ESLint（vue + typescript-eslint） |
| `pnpm test` | Vitest 单元测试（纯逻辑 + 守卫 + 登录组件） |
| `pnpm preview` | 预览生产构建 |

## 切换真实后端（F9：只改一处配置）

修改 `.env.production`（或构建时注入环境变量）：

```
VITE_USE_MOCK=false
VITE_API_BASE_URL=https://<core-api-host>/api/v1
```

页面与请求逻辑不变：请求统一走 `src/api/client.ts`（`credentials: 'include'` 携带
HttpOnly Cookie）；mock 模式额外的 `X-Mock-Session` 头仅由 `src/config.ts` 的开关控制，
真实后端模式下不参与任何请求。

## Mock 场景控制台

页面右下角（仅 mock 模式）可切换验收场景：

- **Provider 同步失败**：`POST /admin/providers/sync` 返回 502 `PI_UNAVAILABLE`，
  页面保留上次快照并把 Provider 状态标记为「已过期」（AU-05）。
- **会话 c_5 正文 PI 暂不可读**：读取正文返回 502，界面提示「会话正文暂不可读」，
  同时失败审阅写入审计（AU-10 / AU-11）。
- **空数据模式**：列表接口返回空结果，用于检查空态展示（F3 / F9）。
- **重置数据**：恢复初始种子数据并回到登录页。

## 功能与验收对照

| 任务 | 覆盖 | 页面 / 行为 |
|---|---|---|
| F0 后台工程 | AUTH-01/04 前端侧 | Vite + Vue3 + TS + Ant Design Vue；MSW 网关实现 `/api/v1` 全部后台契约路径；仪表盘加载即命中 mock |
| F2 登录与入口 | AU-01、AUTH-02/05 | 登录页（错误密码 401、禁用 403、限流 429）；路由守卫：未登录跳登录页、普通用户 URL 直达也被拦到 403；退出回登录页 |
| F3 用户与组 | AU-02、AU-03 | 用户列表/创建/编辑/禁用/重置密码；组列表/创建/编辑/停用；成员批量加入与移除（抽屉勾选，一次请求 `PATCH /groups/{id}/members`）；用户可属多组；表单校验与服务端错误提示；空态 |
| F4 Provider/Model/授权 | AU-04~AU-07 | Provider 只读表（无密钥字段）；进入页面自动同步 + 手动刷新；失败保留旧快照并标「已过期」；Model 启停（新模型默认停用、缺失模型标「清单缺失」且不删授权）；对用户/组新增与撤销授权；有效模型预览 |
| F8 用量/审阅/审计 | AU-08~AU-12 | 全局用量（用户/模型/时间筛选，未知 Token 显示「未知」）；全量会话筛选（含用户已隐藏）；正文按 `since/limit` 游标分页加载；打开正文显示「已记录审阅（trace ID）」；PI 暂不可读错误态；审计列表（动作筛选） |
| F9 收口 | CU-09、§9 | 错误文案统一脱敏（无堆栈/路径/凭据，`src/api/errors.ts` + 测试）；所有列表空态；CSP 与安全响应头（`vite.config.ts` + `index.html` meta）；API 基址唯一配置点 |

## 安全约束（本仓库要求）

- 任何页面、表单、响应中不出现 Key/Token/Secret；Provider 快照字段白名单：
  `provider/name/status/models/last_synced_at`（模型：`id/name/provider/upstream_model_id/enabled/available`）。
- 会话正文只渲染白名单字段（`id/role/content/status/created_at`），
  thinking、PI 控制事件、tool call 在 mock 服务端即被过滤（`src/mocks/logic.ts`，含测试）。
- 错误信息经 `sanitizeErrorMessage` 脱敏后才展示。
- 审计不记录密码明文；重置密码审计只写「已重置」。

## 工程说明与偏差记录

- `docs/program-design.md` §3.3 的原始设想是从 `third_party/simple-admin-vben5-ui`
  monorepo fork 改造。实施评估（见仓库会话记录）后采用**方案 B**：独立
  Vite + Vue 3 + TypeScript 工程，UI 库沿用 simple-admin-core 同款
  **Ant Design Vue**，登录壳 / 路由守卫 / 表格 / 表单 / 分页 / 通知 / 布局等交互范式
  与 Vben5 保持一致。契约路径、请求与响应结构完全按 §6–§7 实现，
  后续若替换为 Vben5 壳，页面逻辑与 mock 契约可直接复用。
- mock 的「Cookie」以 sessionStorage + `X-Mock-Session` 头桥接（Service Worker
  合成响应无法写 Cookie）；真实后端走 HttpOnly Cookie，页面代码无感知。

## 目录结构

```
admin-ui/
├── src/
│   ├── api/            # 契约类型 + 统一请求客户端 + 各资源模块
│   ├── components/     # Mock 场景控制台等
│   ├── config.ts       # USE_MOCK / API_BASE_URL 唯一配置出口
│   ├── layouts/        # 管理壳（侧边菜单 + 头部）
│   ├── mocks/          # MSW 网关：fixtures / db / 纯逻辑 / handlers
│   ├── router/         # 路由与守卫
│   ├── stores/         # pinia（auth）
│   ├── styles/         # 全局样式
│   ├── utils/          # 格式化工具
│   └── views/          # 登录 / 403 / 404 / 仪表盘 / 用户 / 组 / Provider / Model / 用量 / 会话审阅 / 审计
└── public/mockServiceWorker.js
```
