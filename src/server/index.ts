/**
 * Cloudflare Worker 后端主入口 (Hono + TypeScript)
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { AppContext, Env } from './types/env.js'
import { authMiddleware } from './middlewares/auth.js'
import { subRoute } from './routes/sub.js'
import { customProviderRoute } from './routes/provider.js'
import { ghRoute } from './routes/gh.js'
import { authApi } from './routes/api/auth.js'
import { configApi } from './routes/api/config.js'
import { profilesApi } from './routes/api/profiles.js'
import { providersApi } from './routes/api/providers.js'
import { logsApi } from './routes/api/logs.js'
import { statsApi } from './routes/api/stats.js'

const app = new Hono<AppContext>()

// 1. 全局中间件
app.use('*', logger())
app.use('*', cors({
  origin: (origin) => origin || '*',
  credentials: true
}))

app.use('*', async (c, next) => {
  const rawEntrance = c.env.SECURE_ENTRANCE?.trim()
  let prefix = ''
  if (rawEntrance) {
    prefix = rawEntrance.startsWith('/') ? rawEntrance : `/${rawEntrance}`
    if (prefix.endsWith('/') && prefix.length > 1) {
      prefix = prefix.slice(0, -1)
    }
  }
  c.set('entrancePrefix', prefix)
  await next()
})

// 2. 核心订阅分发路由 (公开接口，Token 校验)
app.route('/sub', subRoute)

// 3. 订阅伪装 (手动节点) 与 隐藏真实 Provider 路由
app.route('/provider', customProviderRoute)

// 4. GitHub 规则集加速代理路由
app.route('/gh-proxy', ghRoute)

// 4. 认证相关 API
app.route('/api/auth', authApi)

// 4. 受保护的后台管理 API (统一挂载 authMiddleware 鉴权)
const protectedApi = new Hono<AppContext>()
protectedApi.use('*', authMiddleware)
protectedApi.route('/config', configApi)
protectedApi.route('/profiles', profilesApi)
protectedApi.route('/providers', providersApi)
protectedApi.route('/logs', logsApi)
protectedApi.route('/stats', statsApi)

// 兼容老路径 /api/data, /api/global-base-yaml, /api/preview
protectedApi.route('/', configApi)

app.route('/api', protectedApi)

// 5. 静态资源与前端 SPA 托管 (Cloudflare Workers Assets)
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    const res = await c.env.ASSETS.fetch(c.req.raw)
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('text/html')) {
      const html = await res.text()
      const prefix = c.get('entrancePrefix') || ''
      const injectedHtml = html.replace(
        '<head>',
        `<head><script>window.__ENTRANCE_PREFIX__ = ${JSON.stringify(prefix)};</script>`
      )
      return new Response(injectedHtml, {
        status: res.status,
        headers: res.headers
      })
    }
    return res
  }
  return c.text('Not Found', 404)
})

// 全局异常捕获
app.onError((err, c) => {
  console.error('Unhandled Worker Error:', err)
  return c.json(
    {
      success: false,
      error: err instanceof Error ? err.message : 'Internal Server Error'
    },
    500
  )
})

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const rawEntrance = env.SECURE_ENTRANCE?.trim()
    let prefix = ''

    if (rawEntrance) {
      prefix = rawEntrance.startsWith('/') ? rawEntrance : `/${rawEntrance}`
      if (prefix.endsWith('/') && prefix.length > 1) {
        prefix = prefix.slice(0, -1)
      }

      // 根前缀重定向至带斜杠
      if (url.pathname === prefix) {
        return Response.redirect(`${url.origin}${prefix}/${url.search}`, 301)
      }

      // 未匹配隐蔽前缀时伪装返回 200 OK
      if (!url.pathname.startsWith(`${prefix}/`)) {
        return new Response('Hello World', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      }

      // 剥离安全前缀，透传给 Hono 处理内部纯净路径
      const strippedPath = url.pathname.slice(prefix.length) || '/'
      url.pathname = strippedPath
      request = new Request(url.toString(), request)
    }

    return app.fetch(request, env, ctx)
  }
}
