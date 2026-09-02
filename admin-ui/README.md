# Terminal Agent Hub · 后台 UI（admin-ui / B 线）

面向管理员的独立 SPA：管理员登录、用户/用户组管理、Provider 无密钥登记与同步、
Model 启停与用户/组授权、有效模型预览、全局用量、会话正文审阅与审计。

- 契约来源：`docs/program-design.md` §6–§7、`docs/task-breakdown.md` §3.2（阶段 0 冻结）。
- 默认 **MSW mock 独立闭环**：不启动 Go / PI / 数据库，不访问任何真实后端、Provider 或外网。
- mock 网关**逐字段镜像真实后端的线格式**（见下文「真实后端线格式对照」），
  因此 mock 模式与真实模式走完全相同的归一与请求代码。
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

注意：mock 种子账号的短密码只用于登录演示；**新建用户 / 重置密码必须至少 12 位**
（与真实后端 pbkdf2 哈希前的策略一致）。

## 命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 开发服务器（mock 网关 + SPA） |
| `pnpm build` | `vue-tsc` 类型检查 + 生产构建 |
| `pnpm typecheck` | 仅类型检查 |
| `pnpm lint` | ESLint（vue + typescript-eslint） |
| `pnpm test` | Vitest 单元测试（纯逻辑 + 守卫 + 登录组件 + 线格式归一 + 客户端刷新重试 + mock 网关契约） |
| `pnpm preview` | 预览生产构建 |

## 切换真实后端（F9：只改环境变量）

真实后端 = `backend/`（Core API，默认 `:8080`）。启动方式见 `docs/deployment.md`：

```bash
cd backend
TAH_COOKIE_SECURE=false \
TAH_BOOTSTRAP_ADMIN_USERNAME=admin \
TAH_BOOTSTRAP_ADMIN_PASSWORD=<至少12位> \
go run ./api            # 或用 docker-compose.dev.yml 的 core-api
```

然后：

```bash
cd admin-ui
VITE_USE_MOCK=false VITE_PROXY_TARGET=http://localhost:8080 pnpm dev
```

- 请求统一走 `src/api/client.ts`（`credentials: 'include'` 携带 HttpOnly Cookie）；
- 后端不输出 CORS 头、Cookie 绑定 `/api/v1` 路径，开发态由 Vite 把 `/api`
  代理到 `VITE_PROXY_TARGET` 保持同源（`vite.config.ts`，仅 `USE_MOCK=false` 时启用）；
- Access Cookie 15 分钟过期：客户端收到 401 时先 `POST /auth/refresh`（合并并发），
  成功后重放原请求，失败回到登录页；
- mock 模式额外的 `X-Mock-Session` 头仅由 `src/config.ts` 的开关控制，真实模式不参与。

## 真实后端线格式对照（B 线适配记录）

真实后端（`backend/api/internal/handler/hub`）用未打 json tag 的 Go 结构体直接序列化，
与 `docs/program-design.md` §6 的 snake_case 冻结契约存在以下**已适配**的差异，
`src/api/wire.ts` 对两种拼写都兼容（读取按候选键取值；请求体按后端白名单生成）：

| 差异点 | 真实后端行为 | 前端适配 |
|---|---|---|
| 字段键名 | `ID/Name/Status/Provider/LastSyncedAt/SubjectType/RequestID/StartedAt…` Go 风格 | 归一层候选键匹配 |
| 列表形态 | users/grants/usage/audit 是数组；groups/providers/models/conversations 是「以 ID 为键的对象」；空列表可为 `items:null` | `normalizeItems` 兼容三种 |
| 错误信封 | `{"error":{"Code","Message","RequestID"}}`；参数校验/重名是 `{"error":"<字符串>"}` | `parseErrorShape` 兼容并本地化 |
| 请求体白名单 | `DisallowUnknownFields`：出现 nickname/email/description 等额外字段一律 400 | 请求体只发送白名单字段（表单已移除昵称/邮箱/组描述） |
| grants 键名 | POST/DELETE 必须用 `SubjectType/SubjectID/ModelID`（snake_case 键是未知字段 → 400）；DELETE 从请求体（不是查询串）解码 | `providers.ts` 按后端键发送 |
| 密码策略 | 至少 12 位（`password must be at least 12 characters`） | 前端同策略校验 |
| 用量状态 | `completed/aborted/failed`（非 success/error） | 状态映射兼容两套 |
| 审计动作 | `user.create/provider.sync/model.update/grant.create/conversation.review`（小写点分；登录/登出/重置密码不写审计） | 动作文案映射按已知值，未知原样展示 |
| Provider 响应 | 不含 `models` 字段 | `listProviders` 同时拉 `/admin/models` 按 provider 合并展示 |
| 会话索引 | 原始行含 `SessionRef`、无计算 status / 消息数 | 归一层丢弃 `SessionRef`（永不展示）；status 列显示「未知」 |
| 审阅反馈 | 读正文先写审计但不回传 trace | 界面展示通用「已记录审阅」提示（mock 提供 trace 时展示 trace） |
| 组成员 | 无读取接口 | 成员抽屉降级为「勾选加入 / 勾选移除」全量用户表 |
| 分页 | 后端一次返回全量列表 | 过滤、汇总、分页在客户端完成（`buildPaged` / `summarizeUsage`） |

仍在后端侧、前端无法弥补的差异（已向 C 线回流）：

1. `GET /admin/conversations` 响应包含 `SessionRef`（PI 会话引用），违反
   `program-design.md` §4.2「pi_session_ref 不返回浏览器」；前端不读取该字段。
2. 管理员会话列表不返回计算后的 `status`（active/readonly/generating）。
3. 组成员无读取接口；重置密码 / 用户组变更不写审计。

## Mock 场景控制台

页面右下角（仅 mock 模式）可切换验收场景：

- **Provider 同步失败**：`POST /admin/providers/sync` 返回 502 `PI_UNAVAILABLE`，
  页面保留上次快照并把 Provider 状态标记为「已过期」（AU-05）。
- **会话 c_5 正文 PI 暂不可读**：读取正文返回 502，界面提示「服务暂时不可用」，
  同时失败审阅写入审计（AU-10 / AU-11）。
- **空数据模式**：列表接口返回空结果（`items:[]` / `items:{}` / `items:null`，与后端空态一致）。
- **重置数据**：恢复初始种子数据并回到登录页。

## 功能与验收对照

| 任务 | 覆盖 | 页面 / 行为 |
|---|---|---|
| F0 后台工程 | AUTH-01/04 前端侧 | Vite + Vue3 + TS + Ant Design Vue；MSW 网关实现 `/api/v1` 全部后台契约路径；仪表盘加载即命中 mock |
| F2 登录与入口 | AU-01、AUTH-02/05 | 登录页（错误密码 401、禁用 403、限流 429）；路由守卫：未登录跳登录页、普通用户 URL 直达也被拦到 403；退出回登录页 |
| F3 用户与组 | AU-02、AU-03 | 用户列表/创建（12 位密码）/编辑角色/禁用/重置密码；组列表/创建/编辑/停用；成员批量加入与移除（一次请求 `PATCH /groups/{id}/members`）；后端无成员读取接口时抽屉降级为全量勾选；空态 |
| F4 Provider/Model/授权 | AU-04~AU-07 | Provider 只读表（无密钥字段，模型清单由 `/admin/models` 合并）；进入页面自动同步 + 手动刷新；失败保留旧快照并标「已过期」；Model 启停（新模型默认停用、缺失模型标「清单缺失」且不删授权）；对用户/组新增与撤销授权（Go 风格请求键 + DELETE 请求体）；有效模型预览 |
| F8 用量/审阅/审计 | AU-08~AU-12 | 全局用量（用户/模型/时间筛选 + 客户端汇总，未知 Token 显示「未知」）；全量会话筛选（含用户已隐藏）；正文按 `since/limit` 游标分页；打开正文显示「已记录审阅」；PI 暂不可读错误态；审计列表（动作筛选） |
| F9 收口 | CU-09、§9 | 错误文案统一脱敏（无堆栈/路径/凭据，`src/api/errors.ts` + 测试）；所有列表空态；CSP 与安全响应头（`vite.config.ts` + `index.html` meta）；API 基址与代理目标唯一配置点 |

## 安全约束（本仓库要求）

- 任何页面、表单、响应中不出现 Key/Token/Secret；Provider 快照字段白名单：
  `provider/name/status/models/last_synced_at`（模型：`id/name/provider/upstream_model_id/enabled/available`）。
- 会话正文只渲染白名单字段（`id/role/content/status/created_at`），
  thinking、PI 控制事件、tool call 在 mock 服务端即被过滤（`src/mocks/logic.ts`，含测试）。
- `pi_session_ref`/`SessionRef` 在归一层被丢弃，任何页面不读取、不展示。
- 错误信息经 `sanitizeErrorMessage` 脱敏后才展示；审计不记录密码明文。

## 工程说明与偏差记录

- `docs/program-design.md` §3.3 的原始设想是从 `third_party/simple-admin-vben5-ui`
  monorepo fork 改造。实施评估后采用**方案 B**：独立 Vite + Vue 3 + TypeScript 工程，
  UI 库沿用 simple-admin-core 同款 **Ant Design Vue**，登录壳 / 路由守卫 / 表格 / 表单 /
  分页 / 通知 / 布局等交互范式与 Vben5 保持一致。
- mock 的「Cookie」以 sessionStorage + `X-Mock-Session` 头桥接（Service Worker
  合成响应无法写 Cookie）；真实后端走 HttpOnly Cookie，页面代码无感知。
- `.npmrc` 放宽 pnpm 网络重试：开发 Compose 的 node 容器内首次安装曾因 registry
  超时退出（非代码问题）。

## 目录结构

```
admin-ui/
├── .npmrc               # pnpm 网络重试（Docker 开发闭环）
├── src/
│   ├── api/             # 契约类型 + 统一请求客户端 + 线格式归一层（wire.ts）+ 各资源模块
│   ├── components/      # Mock 场景控制台等
│   ├── config.ts        # USE_MOCK / API_BASE_URL / PROXY_TARGET 唯一配置出口
│   ├── layouts/         # 管理壳（侧边菜单 + 头部）
│   ├── mocks/           # MSW 网关（镜像真实后端线格式）：fixtures / db / 纯逻辑 / handlers
│   ├── router/          # 路由与守卫
│   ├── stores/          # pinia（auth）
│   ├── styles/          # 全局样式
│   ├── utils/           # 格式化工具
│   └── views/           # 登录 / 403 / 404 / 仪表盘 / 用户 / 组 / Provider / Model / 用量 / 会话审阅 / 审计
└── public/mockServiceWorker.js
```
