# Clash 订阅分发 Worker (mySubs)

基于 Cloudflare Worker + KV + Web Crypto (AES-GCM / HMAC) 实现的 Clash 订阅管理与分发中心。

---

## 🌟 功能特性

1. **可视化双 Section 管理面板**：
    - **Section 1 (Proxy Providers)**：可视化组件，动态添加/修改/删除订阅源。
    - **Section 2 (Base YAML)**：基础规则、策略组配置，最终订阅接口自动将 Providers 注入头部 `proxy-providers:`。
2. **安全与鉴权机制**：
    - **双 Token 鉴权**：`ADMIN_TOKEN` 登录验证，`APP_SECRET` 用于 HMAC 签名 Session 与 AES 加密。
    - **Cookie 校验**：优先校验客户端签名的 `auth_session`，未登录时转到 Admin 登录界面。
    - **敏感数据加密存储**：KV 中的 Proxy-Providers 数据与订阅分发 Token 均使用 **AES-GCM 256 位加密**。
3. **独立分发展望**：
    - 暴露 `/sub?token=xxx`，支持客户端自动更新与标准 Clash 订阅流量响应头。
4. **模块化与分离部署**：
    - 前端 WebUI (`index.html`, `style.css`, `app.js`, `providers.js`) 与核心后端逻辑 (`worker.js`, `auth.js`, `crypto.js`, `kv.js`, `yaml.js`) 模块化分离。

---

## 🚀 部署指引

### 1. 安装依赖并登录 wrangler

```bash
npm install

npx wrangler login
```

### 2. 创建 Cloudflare KV 命名空间

运行以下命令创建用于存储配置的 KV 命名空间:

```bash
npx wrangler kv:namespace create SUBS_KV
```

根据终端输出的 `id`，更新 `wrangler.toml` 中的 `kv_namespaces`:

```toml
kv_namespaces = [
  { binding = "SUBS_KV", id = "填入你的_kv_namespace_id" }
]
```

### 3. 设置生产 Secrets 与安全入口

设置管理员登录 Token、加密密钥及可选的安全路径入口：

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

### 4. 本地调试与部署

- **本地调试**：
    ```bash
    npm run dev
    ```
- **一键部署到 Cloudflare**：
    ```bash
    npm run deploy
    ```

---

## 📡 接口与安全入口机制

如果设置了 `SECURE_ENTRANCE`（如 `/secret_gate`）：

- **普通请求伪装**：直接访问根路径 `/`、`/sub` 等未带入口前缀的请求将返回 `200` 状态码与 `Hello World`。
- **管理面板**：必须访问 `https://your-worker.workers.dev/secret_gate/`
- **订阅接口**：分发链接将自动带上入口路径 `https://your-worker.workers.dev/secret_gate/sub?token=<SUB_TOKEN>`
- `GET /api/preview`：预览最终拼接的 Clash YAML
- `GET /sub?token=<SUB_TOKEN>`：Clash 客户端订阅获取接口

---

## 🌐 CDN 域名透传 (EdgeOne / 反向代理)

Worker 生成订阅链接与 `provider-proxy` 代理链接时，默认使用请求的 `Host` / `X-Forwarded-Host` 头。

如果你通过 CDN (如 EdgeOne) 反向代理 Worker，并希望 YAML 中的资源代理链接使用 CDN 域名而不是 Worker 原始域名：

1. 在 CDN 的回源/转发配置中，添加一个**自定义请求头**：
    - 头名称：默认 `x-cdn-request-host`（可通过环境变量 `CDN_HEADER_NAME` 修改）
    - 头值：你的 CDN 域名，如 `cdn.example.com`（也支持完整 URL，如 `https://cdn.example.com`）
2. Worker 在生成订阅链接、`provider-proxy` 代理链接时，会**优先使用该请求头携带的 CDN 域名**；
   若请求头不存在，则自动回退使用 Worker 自身域名（`workers.dev` 或经 `X-Forwarded-Host` 透传的域名）。
