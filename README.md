# ⚡ Clash 订阅分发中心 (mySubs v2.0)

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Cloudflare-D1-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare D1" />
  <img src="https://img.shields.io/badge/Framework-Hono-E36209?style=flat-square&logo=hono&logoColor=white" alt="Hono" />
  <img src="https://img.shields.io/badge/Frontend-React_18_%2B_Vite-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/Styling-Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/TypeScript-100%25-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

基于 **Cloudflare Workers (Hono + 全量 TypeScript)** + **Cloudflare D1 (持久主库)** + **KV (边缘极速缓存)** + **React 18 SPA (Vite + Tailwind CSS + CDN Remix Icon)** 构建的现代化、全工程化、免运维 Clash / Mihomo 订阅管理与分发中心。

---

## 🌟 核心特性与 v2.0 升级

- 🚀 **前后端全栈 TypeScript 工程化**：
  - **后端**：采用 Cloudflare 官方推荐的 **Hono** 轻量框架，彻底实现中间件、路由控制器（Controller）、服务层（Service）、数据持久层（D1 Client / Queries）与强类型实体（Models）分层解耦。
  - **前端**：采用 **React 18 + React Router + Vite + Tailwind CSS** 打造现代专业单页应用（SPA）。全站组件自研精雕，包含毛玻璃微拟态 `<Select />` 动画下拉框、自定义模态窗、代码高亮等。
  - **沉浸式深浅双主题**：针对深色模式专门优化了深邃黑曜石底色与卡片表面对比度，白天与暗夜切换自如，视觉体验舒适。
- 📦 **一体化静态资产托管 (Workers Assets)**：
  - 前端 SPA 静态构建产物由 Cloudflare Workers Assets 原生资产流水线直接一体化托管与分发，一行命令 `npm run deploy` 即可全栈上线，彻底告别额外的 Pages 或独立静态服务器配置。
- 🛡️ **企业级安全与审计排障**：
  - **隐蔽安全入口 (`SECURE_ENTRANCE`)**：支持自定义后台路径（如 `/secret_gate/`）。未授权访问根目录 `/` 或静态直链直接伪装响应标准 HTTP 200 `Hello World`，杜绝恶意扫描。
  - **敏感链接 AES-256-GCM 硬件级加密**：上游机场订阅链接在入库 D1 时全程经过 Web Crypto 加密，保障资产安全。
  - **HMAC-SHA256 签名鉴权**：安全 Cookie 与 KV 双重有效性验证。
  - **实时请求流水大盘**：记录每次订阅拉取响应耗时（毫秒）、客户端 IP、国家地区代码、客户端设备类型（UA）与状态码。
- 🔄 **强劲订阅引擎与代理差分体系**：
  - **全局通用 Base YAML 与 Profile 差分**：统一管理通用规则模板，各 Profile（租户）亦可独立定制专属 Base YAML。
  - **灵活多模式订阅代理**：
    - 支持 Worker 原生直接向源站拉取；
    - 支持第三方自定义反向代理模板（例如 `https://proxy.example.com/secret?url={url}`）；
    - 支持每个 Profile 独立配置「继承全局」或「自定义代理覆盖」，并对 GitHub 规则代理 (`/gh/{path}`) 与机场订阅代理保持同步生效。
  - **UUID 规范与自愈机制**：全站订阅源统一采用标准 36 位 UUID 作为唯一标识，支持对旧版数据的自动级联自愈。
- 🎭 **伪装订阅与自建手动节点 (节点矩阵)**：
  - 拥有免落地、防探测的内置订阅服务 (`/provider/:id`)。
  - 支持免机场直接配置自建节点（Vmess、Vless、Trojan、Shadowsocks、Hysteria2、Tuic 等主流协议，支持 TLS/Reality/XTLS 等高级标记）。
  - 控制台首页以卡片形式直观预览节点矩阵，并通过紫罗兰（伪装源）与天空蓝（外部机场源）进行清晰视觉标签差分。

---

## 🛠️ 快速上手与部署步骤

### 前置要求
1. 安装 **[Node.js](https://nodejs.org/)** (v18.0.0 及以上版本)
2. 一个 **[Cloudflare](https://dash.cloudflare.com/)** 账户，已安装并完成登录的 Wrangler CLI (`npx wrangler login`)

---

### 第一步：克隆并安装依赖

```bash
git clone -b v2 https://github.com/KumaKorin/my-subs.git
cd my-subs

npm install
```

---

### 第二步：创建 Cloudflare D1 数据库与 KV 命名空间

1. **创建 D1 数据库**：
   ```bash
   npx wrangler d1 create subs_db
   ```
   > 终端会打印出类似以下配置块：
   > ```toml
   > [[d1_databases]]
   > binding = "DB"
   > database_name = "subs_db"
   > database_id = "xxxx-xxxx-xxxx-xxxx"
   > ```

2. **创建 KV 命名空间**：
   ```bash
   npx wrangler kv:namespace create SUBS_KV
   ```
   > 终端会输出 KV ID，如：
   > ```toml
   > [[kv_namespaces]]
   > binding = "SUBS_KV"
   > id = "yyyyyyyyyyyyyyyyyyyyyyyy"
   > ```

---

### 第三步：配置 `wrangler.toml`

打开项目根目录下的 `wrangler.toml`，将第二步中生成的 D1 和 KV ID 填入对应字段中：

```toml
name = "my-subs"
main = "src/server/index.ts"
compatibility_date = "2024-09-01"

# 静态前端 SPA 资产托管 (Cloudflare Workers Assets)
[assets]
directory = "./dist/client"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true

# D1 数据库绑定 (主数据存储与请求日志)
[[d1_databases]]
binding = "DB"
database_name = "subs_db"
database_id = "<你的_D1_DATABASE_ID>"

# KV 命名空间绑定 (边缘极速缓存层)
[[kv_namespaces]]
binding = "SUBS_KV"
id = "<你的_KV_ID>"

[vars]
ADMIN_TOKEN = "admin123456"               # 管理员登录密码（可后续通过 secret 覆写）
APP_SECRET = "a_secure_random_key_32bytes_long" # 加密密钥（至少32位随机字符串）
SECURE_ENTRANCE = "/secret_gate"           # 安全隐蔽入口路径，必须以 / 开头
```

---

### 第四步：初始化 D1 数据库表结构

运行 `schema.sql` 完成数据库表初始化（**注意：部署到生产环境必须添加 `--remote` 参数**）：

```bash
# 1. 本地开发环境初始化 (Local D1，开发调试使用)
npx wrangler d1 execute subs_db --local --file=./schema.sql

# 2. 生产远程环境初始化 (Remote D1，生产上线必须执行！) ⚠️
npx wrangler d1 execute subs_db --remote --file=./schema.sql
```

---

### 第五步：设置密钥环境变量 (Secrets，推荐)

生产环境中，强烈建议使用 Cloudflare Secrets 存放管理员密码与加密密钥，避免明文泄露：

```bash
# 设置后台管理员密码
npx wrangler secret put ADMIN_TOKEN

# 设置数据加密主密钥 (32 位以上随机字符)
npx wrangler secret put APP_SECRET

# (可选) 自定义隐蔽安全入口前缀，例如 "/my_secret_portal"
npx wrangler secret put SECURE_ENTRANCE
```

---

### 第六步：本地开发与联调

```bash
# 自动编译前端并启动本地 Workers 模拟器（访问 http://localhost:8787/secret_gate）
npm run dev

# 或单独启动前端 Vite 热更新开发服务 (代理到后端 8787 端口)
npm run dev:client
```

---

### 第七步：一键打包并部署至 Cloudflare 生产环境

只需运行一行命令，脚本将自动完成 Vite 前端生产打包并将产物与 Worker 一并推送到 Cloudflare：

```bash
npm run deploy
```

部署成功后，终端将输出你的线上访问域名，例如：
`https://my-subs.your-subdomain.workers.dev`

---

## 🔒 访问与使用指南

### 1. 访问后台控制面板
在浏览器中打开：
`https://<你的域名><SECURE_ENTRANCE>/`
（例如 `https://my-subs.your-subdomain.workers.dev/secret_gate/`）

输入您设置的 `ADMIN_TOKEN`（默认 `admin123456`）即可登录控制台。

> [!NOTE]
> 任何未携带 `<SECURE_ENTRANCE>` 前缀的直接请求（如访问根路径 `https://<你的域名>/`），均会统一返回 `Hello World` 纯文本伪装响应，有效避免被扫描与探测。

### 2. 客户端获取 Clash 订阅
在「Profile 配置」页面中，为目标 Profile 勾选启用的订阅源，保存后点击「复制订阅链接」，格式如下：
`https://<你的域名>/sub?token=<PROFILE_TOKEN>`

客户端（如 Clash Verge Rev / Mihomo Party / Clash Nyanpasu / Flclash / Box / Sing-box 转化等）直接订阅此 URL 即可享受动态组合下发服务。

---

## 📂 目录结构说明

```text
my-subs/
├── wrangler.toml              # Cloudflare Workers、D1、KV、Assets 配置文件
├── package.json               # 统一依赖与构建命令 (Vite, Hono, Tailwind)
├── schema.sql                 # D1 数据库初始化表结构与索引定义
├── tsconfig.json              # TypeScript 严格模式配置
├── vite.config.ts             # 前端 Vite 打包配置 (产物输出至 dist/client)
├── tailwind.config.js         # Tailwind 样式定制与暗黑主题设计系统
├── src/
│   ├── server/                # 【后端 Cloudflare Worker (Hono + TypeScript)】
│   │   ├── index.ts           # Worker 统一入口，挂载中间件与各路由模块
│   │   ├── constants/         # 默认 Base Clash 基础配置模板
│   │   ├── middlewares/       # entrance.ts (安全伪装守卫), auth.ts (鉴权认证)
│   │   ├── routes/            # sub.ts, gh.ts, provider.ts 以及 api/ REST 接口
│   │   ├── services/          # yaml.ts (规则合并引擎), crypto.ts (AES对称加密), cache.ts (KV+D1缓存)
│   │   ├── db/                # client.ts (D1客户端), queries.ts (CRUD 与事务操作)
│   │   ├── utils/             # http.ts (客户端 IP、国家与 Origin 解析)
│   │   └── types/             # env.ts, models.ts
│   │
│   └── client/                # 【前端 React SPA (Vite + React Router + Tailwind)】
│       ├── index.html         # HTML 入口 (CDN 载入 Remix Icon 字体)
│       ├── main.tsx           # React 应用挂载入口
│       ├── App.tsx            # React Router 路由体系与主题挂载
│       ├── components/        # Select, Modal, Switch, Button, Input, YamlEditor, Icon 等组件
│       ├── context/           # DataContext (全局数据池), DialogContext (弹窗状态)
│       ├── pages/             # Profiles, Providers, BaseYaml, Logs, Login
│       ├── services/          # api.ts (强类型请求客户端)
│       └── styles/            # index.css (Tailwind CSS 变量与主题配色)
```

---

## 📄 核心 API 接口说明

| 路径 | 方法 | 鉴权要求 | 说明 |
| :--- | :--- | :--- | :--- |
| `/sub?token=<TOKEN>` | `GET` | Token 校验 | 客户端拉取组装完成的 Clash YAML 订阅 |
| `/gh/*` | `GET` | 免登录 | GitHub 规则集代理镜像加速分发 |
| `/provider/:id` | `GET` | 伪装免登 | 内置免落地节点源 / 伪装订阅下发 |
| `<SECURE_ENTRANCE>/api/auth/login` | `POST` | 免登录 | 管理员凭证登录并写入会话 Cookie |
| `<SECURE_ENTRANCE>/api/auth/logout` | `POST` | Cookie | 注销退出并清除会话 |
| `<SECURE_ENTRANCE>/api/config/data` | `GET` | Cookie | 控制台初始化拉取全部数据 (Base YAML, Providers, Profiles, Settings) |
| `<SECURE_ENTRANCE>/api/config/preview`| `GET` | Cookie | 在线实时差分预览指定 Profile 下发的 Clash YAML |
| `<SECURE_ENTRANCE>/api/config/settings`| `POST` | Cookie | 保存全局代理模板等系统偏好设置 |
| `<SECURE_ENTRANCE>/api/profiles` | `GET/POST` | Cookie | 维护 Profile 订阅分组与挂载源 |
| `<SECURE_ENTRANCE>/api/providers`| `GET/POST` | Cookie | 集中维护 Provider 外部订阅与手动自建节点池 |
| `<SECURE_ENTRANCE>/api/logs` | `GET` | Cookie | 分页与筛选审计流水日志 |
| `<SECURE_ENTRANCE>/api/logs/clear` | `POST` | Cookie | 清空请求审计日志 |
| `<SECURE_ENTRANCE>/api/stats` | `GET` | Cookie | 获取今日请求量、异常率与分客户端类型统计大盘 |

---

## 📄 License

MIT License © 2026 [KumaKorin](https://github.com/KumaKorin)
