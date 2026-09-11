/**
 * Cloudflare Worker 环境变量与绑定接口
 */
export interface Env {
  // Cloudflare D1 关系型数据库绑定
  DB: D1Database

  // Cloudflare KV 边缘缓存命名空间绑定 (支持 SUBS_KV 与 my_subs 双命名兼容)
  SUBS_KV?: KVNamespace
  my_subs?: KVNamespace

  // 静态前端资源绑定 (Cloudflare Workers Assets)
  ASSETS?: Fetcher

  // 生产环境安全密钥与配置
  ADMIN_TOKEN?: string
  APP_SECRET?: string
  SECURE_ENTRANCE?: string
  CDN_HEADER_NAME?: string
}

/**
 * Hono App 上下文类型变量绑定
 */
export type AppVariables = {
  sessionId?: string
  entrancePrefix?: string
}

export type AppContext = {
  Bindings: Env
  Variables: AppVariables
}
