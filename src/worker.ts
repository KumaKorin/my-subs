/**
 * Cloudflare Worker 订阅分发中心主入口
 */
import { handleSecureEntrance } from './middleware/entrance.js'
import { authenticateRequest } from './auth.js'
import { handleStatic } from './handlers/static.js'
import { handleSub } from './handlers/sub.js'
import { handleProxy } from './handlers/proxy.js'
import { handleAuthApi } from './handlers/api/auth.js'
import { handleConfigApi } from './handlers/api/config.js'
import { handleLogsApi } from './handlers/api/logs.js'
import { handleStatsApi } from './handlers/api/stats.js'
import { jsonResponse } from './utils/http.js'
import { Env } from './types/index.js'

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const reqStartTime = Date.now()
        const url = new URL(request.url)
        let pathname = url.pathname

        // 1. 安全入口校验 (SECURE_ENTRANCE)
        const entrance = handleSecureEntrance(pathname, url, env)
        if (!entrance.ok) {
            return entrance.response || new Response('Forbidden', { status: 403 })
        }
        pathname = entrance.pathname || '/'
        const prefix = entrance.prefix || ''

        // 2. 公开订阅下发 (/sub)
        const subRes = await handleSub(request, env, ctx, pathname, url, prefix, reqStartTime)
        if (subRes) return subRes

        // 3. 反向代理 (/provider-proxy, /gh-proxy)
        const proxyRes = await handleProxy(request, env, ctx, pathname, url, reqStartTime)
        if (proxyRes) return proxyRes

        // 4. 页面与静态资源分发 (HTML, CSS, JS 模块)
        const staticRes = await handleStatic(pathname, request, env, prefix)
        if (staticRes) return staticRes

        // 5. 认证 API (/api/login, /api/logout)
        const authApiRes = await handleAuthApi(pathname, request, env)
        if (authApiRes) return authApiRes

        // 6. 需登录鉴权的 WebUI API 控制器
        if (pathname.startsWith('/api/')) {
            const isAuthed = await authenticateRequest(request, env)
            if (!isAuthed) {
                return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
            }

            try {
                // 配置类 API (/api/data, /api/profiles, /api/providers-pool, /api/global-base-yaml, /api/preview)
                const configRes = await handleConfigApi(pathname, request, env, url, prefix)
                if (configRes) return configRes

                // 日志类 API (/api/logs, /api/logs/clear)
                const logsRes = await handleLogsApi(pathname, request, env, url)
                if (logsRes) return logsRes

                // 统计类 API (/api/stats)
                const statsRes = await handleStatsApi(pathname, request, env)
                if (statsRes) return statsRes

                return jsonResponse({ success: false, error: 'Not Found' }, 404)
            } catch (err: unknown) {
                console.error('API execution error:', err)
                const msg = err instanceof Error ? err.message : String(err)
                return jsonResponse({ success: false, error: msg }, 500)
            }
        }

        return new Response('Not Found', { status: 404 })
    }
}
