# ⚡ Clash 订阅分发中心 (mySubs v2.0)

基于 **Cloudflare Workers (Hono + 全量 TypeScript)** + **Cloudflare D1 (持久主库)** + **KV (边缘极速缓存)** + **React Router SPA (Vite + Tailwind CSS + CDN Remix Icon)** 构建的现代化、全工程化、免运维 Clash / Mihomo 订阅管理与分发中心。

---

## 🌟 核心特性与 v2.0 升级

1. **前后端全量 TypeScript 工程化**：
   - **后端**：采用 Cloudflare 官方推荐的 **Hono** 轻量框架，按中间件、路由控制器（Controller）、服务层（Service）、数据访问层（DB）、实体类型（Models）彻底领域化拆分，解耦清晰。
   - **前端**：采用 **Vite + React 18 + React Router + Tailwind CSS** 打造现代专业单页应用（SPA）。
2. **纯净核心分发引擎**：
   - 移除 v1.0 复杂的出站代理与网关拉取逻辑，专注打造健壮、快速、标准的 `/sub` 订阅动态合并与下发服务。
   - 自动维护 `proxy-providers:` 头部注入，支持全局通用 Base YAML 规则或单个 Profile 专属自定义规则自由切换。
3. **零 JS 体积 CDN 图标方案**：
   - 彻底告别杂乱 Emoji，全站采用现代科技质感的 **Remix Icon**，且完全通过公共 CDN 动态引入，JS 打包产物无任何图标冗余，极速秒开。
4. **Cloudflare Workers Assets 原生静态托管**：
   - 前端构建产物与后端 Worker 代码一体化分发，单一命令 `npm run deploy` 即可部署全栈，免去额外托管服务器或复杂域名配置。
5. **企业级安全与审计排障**：
   - 上游敏感机场 URL 在 D1 落库时全程经过 **Web Crypto AES-256-GCM** 对称加密。
   - 后台管理接口采用 **HMAC-SHA256** 签名 Cookie 与 KV 双重验证。
   - 支持自定义隐蔽安全入口 (`SECURE_ENTRANCE`)，非法探测直接伪装返回 200 "Hello World"。
   - 实时请求流水审计大盘，记录耗时（毫秒）、客户端 IP、国家地区代码、客户端设备类型（UA）与状态码。

---

## 📂 目录结构说明

```
v2.0/
├── wrangler.toml              # Cloudflare Workers 配置 (D1, KV, Workers Assets)
├── package.json               # 统一工程依赖与命令脚本
├── tsconfig.json              # TypeScript 严格配置
├── vite.config.ts             # Vite 客户端打包配置 (输出至 dist/client)
├── schema.sql                 # D1 数据库初始化结构
├── src/
│   ├── server/                # 【后端 Cloudflare Worker (Hono + TypeScript)】
│   │   ├── index.ts           # Worker 入口，挂载 Hono 路由与安全伪装中间件
│   │   ├── constants/         # 默认 Base Clash 基础配置模板
│   │   ├── middlewares/       # entrance.ts, auth.ts 等中间件
│   │   ├── routes/            # sub.ts, api/auth.ts, profiles.ts, providers.ts, config.ts, logs.ts, stats.ts
│   │   ├── services/          # yaml.ts (拼接引擎), crypto.ts (加密服务), cache.ts (KV+D1)
│   │   ├── db/                # client.ts (初始化), queries.ts (CRUD)
│   │   ├── utils/             # http.ts (IP、国家与 Origin 解析)
│   │   └── types/             # env.ts, models.ts
│   │
│   └── client/                # 【前端 React SPA (Vite + React Router + Tailwind)】
│       ├── index.html         # HTML 入口 (CDN 引入 Remix Icon 字体)
│       ├── main.tsx           # React 挂载入口
│       ├── App.tsx            # React Router 路由体系
│       ├── context/           # DataContext 全局应用状态
│       ├── components/        # Icon (CDN封装), Button, Input, Switch, Modal, Toast, YamlEditor
│       ├── pages/             # Login, Profiles, Providers, BaseYaml, Logs
│       ├── services/          # api.ts 强类型客户端
│       └── styles/            # Tailwind CSS 与深浅主题
```

---

## 🚀 快速上手与部署

### 1. 安装依赖

```bash
cd v2.0
npm install
```

### 2. 准备 Cloudflare D1 数据库与 KV 命名空间

```bash
# 1. 创建 D1 数据库
npx wrangler d1 create subs_db

# 2. 执行数据库表初始化
npx wrangler d1 execute subs_db --file=./schema.sql

# 3. 创建 KV 缓存命名空间
npx wrangler kv:namespace create SUBS_KV
```

将创建成功后输出的 `database_id` 和 KV `id` 填入 `wrangler.toml` 对应字段中。

### 3. 配置密钥 (Secrets)

```bash
# 设置后台管理员密码
npx wrangler secret put ADMIN_TOKEN

# 设置加密主密钥 (32 位以上随机字符)
npx wrangler secret put APP_SECRET

# (可选) 设置隐蔽安全入口前缀，例如 "/secret_gate"
npx wrangler secret put SECURE_ENTRANCE
```

### 4. 本地开发与联调

```bash
# 构建前端并启动 Worker 本地模拟器
npm run dev

# 或单独启动前端热更新开发服务 (代理到后端 8787 端口)
npm run dev:client
```

### 5. 一键打包并部署至 Cloudflare

```bash
npm run deploy
```

---

## 📄 接口说明

| 路径 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/sub?token=<TOKEN>` | `GET` | 客户端拉取组装完成的 Clash YAML 订阅 |
| `/api/auth/login` | `POST` | 管理员凭证登录 |
| `/api/auth/logout` | `POST` | 注销退出并清除 Session |
| `/api/config/data` | `GET` | 控制台初始化数据拉取 (Base YAML, Providers, Profiles) |
| `/api/config/global-base-yaml` | `POST` | 保存全局通用 Base YAML |
| `/api/config/preview` | `GET` | 在线实时预览特定 Profile 下发 YAML |
| `/api/profiles` | `GET/POST` | 维护 Profile 订阅租户与挂载源 |
| `/api/providers` | `GET/POST` | 集中维护 Provider 订阅节点资源池 |
| `/api/logs` | `GET` | 分页与筛选审计流水日志 |
| `/api/logs/clear` | `POST` | 清空请求审计日志 |
| `/api/stats` | `GET` | 获取今日请求/异常/分类型统计大盘 |
