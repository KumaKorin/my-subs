# Clash 订阅分发 Worker (mySubs)

基于 Cloudflare Worker + D1 (主数据库) + KV (边缘缓存) + Web Crypto (AES-GCM / HMAC) 实现的现代化 Clash 订阅管理与全链路代理分发中心。

---

## 🌟 功能特性

1. **D1 主数据库 + KV 边缘缓存分层架构**：
    - **Cloudflare D1**：持久化存储 Profile 订阅配置、Provider 节点资源池、Base YAML 规则与全量请求日志，告别 KV 写配额限制。
    - **Cloudflare KV**：充当 L1 边缘极速缓存层，保障客户端分发拉取的毫秒级响应。
2. **全链路请求流水与可观测性**：
    - **全场景打点**：全量记录 `/sub`（Clash 订阅分发）、`/provider-proxy`（节点代理拉取）与 `/gh-proxy`（GitHub 规则加速）的请求日志。
    - **诊断维度**：包含请求时间、耗时、状态码（200/502）、客户端真实 IP、国家地区、客户端 UA 与异常原因。
    - **上游流量解析**：自动解析节点返回的 `subscription-userinfo` 并在 Web 面板直观展示已用/总流量与到期时间。
3. **可视化管理面板**：
    - **Profile 订阅管理**：支持多 Profile 配置、独立 Token、全局/自定义 Base YAML 自由切换。
    - **Provider 资源池管理**：统一维护机场节点源，支持一键切换直连与 Worker 代理，实时健康状态指示灯（🟢 / 🔴）。
    - **请求日志与排障中心**：实时请求流水、今日请求统计、多维度类型与异常筛选。
4. **安全与鉴权机制**：
    - **双 Token 鉴权**：`ADMIN_TOKEN` 登录验证，`APP_SECRET` 用于 HMAC 签名 Session 与 AES 加密。
    - **Cookie 校验**：优先校验客户端签名的 `auth_session`，未登录时重定向至 Admin 登录界面。
    - **敏感数据加密存储**：敏感 Provider URL 均采用 **AES-GCM 256 位加密**存储。
5. **平滑迁移与降级兼容**：
    - 提供 WebUI 一键迁移与 CLI 迁移脚本，已在运行的 KV 历史数据可一键无损同步至 D1。

---

## 🚀 部署指引

### 1. 安装依赖并登录 wrangler

```bash
npm install

npx wrangler login
```

### 2. 创建 Cloudflare D1 数据库与 KV 命名空间

1. **创建 D1 数据库**：
   ```bash
   npx wrangler d1 create subs-db
   ```
   根据终端输出的 `database_id`，更新 `wrangler.toml` 中的 `[[d1_databases]]`。

2. **创建 KV 命名空间 (用于边缘缓存)**：
   ```bash
   npx wrangler kv:namespace create SUBS_KV
   ```
   根据终端输出的 `id`，更新 `wrangler.toml` 中的 `[[kv_namespaces]]`。

### 3. 设置生产 Secrets 与安全入口

```bash
# 设置管理员登录密码/Token
npx wrangler secret put ADMIN_TOKEN

# 设置用于 Cookie 签名与 AES-GCM 加密的应用主密钥 (建议 32 位以上随机字符)
npx wrangler secret put APP_SECRET

# (可选) 设置隐蔽安全入口路由，例如输入 "/secret_gate"
# 设置后未匹配该前缀的请求将全部伪装返回 200 "Hello World"
npx wrangler secret put SECURE_ENTRANCE

# (可选) 自定义 CDN 域名请求头名称 (默认 x-cdn-request-host)
npx wrangler secret put CDN_HEADER_NAME
```

### 4. 部署到 Cloudflare

```bash
npm run deploy
```

---

## 🔄 现有 KV 数据一键迁移至 D1

如果你此前已在运行纯 KV 版本的 mySubs，升级后无需手动重新录入配置：

### 方式 A：WebUI 一键迁移 (最简单)
1. 登录 Worker 管理面板；
2. 页面顶部将自动弹出 **「检测到现有 KV 中有配置数据，D1 数据库尚未导入」** 提示横幅；
3. 点击 **「一键迁移至 D1」**，系统将在后台自动读取、解密并导入所有历史数据。

### 方式 B：CLI 迁移脚本
```bash
npm run migrate -- --url=https://your-worker.workers.dev --token=YOUR_ADMIN_TOKEN
```
迁移完成后，该脚本可随时安全删除。

---

## 📡 接口与安全入口机制

如果设置了 `SECURE_ENTRANCE`（如 `/secret_gate`）：

- **普通请求伪装**：直接访问根路径 `/`、`/sub` 等未带入口前缀的请求将返回 `200` 状态码与 `Hello World`。
- **管理面板**：必须访问 `https://your-worker.workers.dev/secret_gate/`
- **订阅接口**：分发链接将自动带上入口路径 `https://your-worker.workers.dev/secret_gate/sub?token=<SUB_TOKEN>`
- `GET /sub?token=<SUB_TOKEN>`：Clash 客户端订阅获取接口
- `GET /provider-proxy?token=<SUB_TOKEN>&id=<PROVIDER_ID>`：上游节点内容代理拉取接口
- `GET /gh-proxy?token=<SUB_TOKEN>&url=<GITHUB_URL>`：GitHub 规则集与资源加速代理接口

---

## 🌐 CDN 域名透传 (EdgeOne / 反向代理)

Worker 生成订阅链接与 `provider-proxy` 代理链接时，默认使用请求的 `Host` / `X-Forwarded-Host` 头。

如果你通过 CDN (如 EdgeOne) 反向代理 Worker，并希望 YAML 中的资源代理链接使用 CDN 域名而不是 Worker 原始域名：

1. 在 CDN 的回源/转发配置中，添加一个**自定义请求头**：
    - 头名称：默认 `x-cdn-request-host`（可通过环境变量 `CDN_HEADER_NAME` 修改）
    - 头值：你的 CDN 域名，如 `cdn.example.com`（也支持完整 URL，如 `https://cdn.example.com`）
2. Worker 在生成订阅链接、`provider-proxy` 代理链接时，会**优先使用该请求头携带的 CDN 域名**；
   若请求头不存在，则自动回退使用 Worker 自身域名（`workers.dev` 或经 `X-Forwarded-Host` 透传的域名）。
