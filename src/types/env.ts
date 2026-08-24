/**
 * Cloudflare Workers 环境变量与 Bindings 类型定义
 */

export interface Env {
    DB: D1Database
    SUBS_KV?: KVNamespace
    ADMIN_TOKEN?: string
    APP_SECRET?: string
    SECURE_ENTRANCE?: string
    CDN_HEADER_NAME?: string
}
