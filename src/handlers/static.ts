/**
 * 页面与静态资源路由处理器
 */
import { authenticateRequest } from '../auth.js'
import { Env } from '../types/index.js'

// HTML 页面
import HTML_LOGIN from '../public/login.html'
import HTML_CONTROL from '../public/control.html'

// CSS 样式
import CSS_STYLE from '../public/css/style.css'

// 客户端 JS 打包产物
import JS_LOGIN from '../public/js/login.client.js'
import JS_APP from '../public/js/app.client.js'

interface StaticAsset {
    content: string
    type: string
    auth: boolean
}

const STATIC_ASSETS: Record<string, StaticAsset> = {
    '/public/css/style.css': {
        content: CSS_STYLE,
        type: 'text/css; charset=utf-8',
        auth: false
    },
    '/public/js/login.client.js': {
        content: JS_LOGIN,
        type: 'application/javascript; charset=utf-8',
        auth: false
    },
    '/public/js/app.client.js': {
        content: JS_APP,
        type: 'application/javascript; charset=utf-8',
        auth: true
    }
}

/**
 * 处理静态资源与页面请求
 */
export async function handleStatic(pathname: string, request: Request, env: Env, prefix: string): Promise<Response | null> {
    const isAuthed = await authenticateRequest(request, env)

    // 1. 根路径重定向
    if (pathname === '/') {
        const target = isAuthed ? `${prefix}/control` : `${prefix}/login`
        return new Response(null, {
            status: 302,
            headers: { Location: target }
        })
    }

    // 2. 登录页
    if (pathname === '/login') {
        if (isAuthed) {
            return new Response(null, {
                status: 302,
                headers: { Location: `${prefix}/control` }
            })
        }
        const injectedHtml = HTML_LOGIN.replace(
            '<head>',
            `<head>\n  <script>window.__BASE_PREFIX__ = ${JSON.stringify(prefix)};</script>`
        )
        return new Response(injectedHtml, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
    }

    // 3. 控制台页
    if (pathname === '/control') {
        if (!isAuthed) {
            return new Response(null, {
                status: 302,
                headers: { Location: `${prefix}/login` }
            })
        }
        const injectedHtml = HTML_CONTROL.replace(
            '<head>',
            `<head>\n  <script>window.__BASE_PREFIX__ = ${JSON.stringify(prefix)};</script>`
        )
        return new Response(injectedHtml, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
    }

    // 4. 静态资源分发
    const asset = STATIC_ASSETS[pathname]
    if (asset) {
        if (asset.auth && !isAuthed) {
            return new Response('Unauthorized', { status: 401 })
        }
        return new Response(asset.content, {
            headers: {
                'Content-Type': asset.type,
                'Cache-Control': 'public, max-age=300'
            }
        })
    }

    return null
}
