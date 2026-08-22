import { authenticateRequest, handleLogin, handleLogout } from './auth.js'
import { timingSafeEqual } from './crypto.js'
import {
    getBaseYaml,
    saveBaseYaml,
    getProviders,
    saveProviders,
    getSubscriptionToken,
    saveSubscriptionToken
} from './kv.js'
import { assembleFinalYaml } from './yaml.js'

// 导入前端静态资源 (作为 Text 纯文本模块导入)
import HTML_ADMIN from './public/index.html'
import JS_APP from './public/js/app.client.js'
import JS_PROVIDERS from './public/js/providers.client.js'
import CSS_STYLE from './public/css/style.css'

function jsonResponse(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...headers
        }
    })
}

/**
 * 解析当前请求的对外 Origin (用于生成订阅链接与 Provider 代理链接)
 *
 * 优先级:
 * 1. 自定义 CDN 请求头 (头名称通过 env.CDN_HEADER_NAME 配置，默认 x-cdn-request-host)
 *    头值为 CDN 域名，如 "cdn.example.com"，也允许携带完整 URL "https://cdn.example.com"
 * 2. 反向代理透传头 X-Forwarded-Proto / X-Forwarded-Host (EdgeOne 等)
 * 3. 兜底使用 Worker 自身 Host
 */
function getPublicOrigin(request, env, url) {
    const cdnHeaderName = (env.CDN_HEADER_NAME || 'x-cdn-request-host').trim()
    const rawCdn = (request.headers.get(cdnHeaderName) || '').trim()

    let proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
    let host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host

    if (rawCdn) {
        const m = rawCdn.match(/^(https?):\/\/([^/]+)/i)
        if (m) {
            proto = m[1]
            host = m[2]
        } else {
            host = rawCdn
        }
    }

    return `${proto}://${host}`
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url)
        let pathname = url.pathname

        // -------------------------------------------------------------
        // 安全入口路由校验 (SECURE_ENTRANCE)
        // -------------------------------------------------------------
        let prefix = ''
        if (env.SECURE_ENTRANCE) {
            // 规范化入口路径格式，例如 "mysecret" -> "/mysecret"
            prefix = env.SECURE_ENTRANCE.startsWith('/') ? env.SECURE_ENTRANCE : `/${env.SECURE_ENTRANCE}`
            // 去除末尾斜杠
            if (prefix.endsWith('/') && prefix.length > 1) {
                prefix = prefix.slice(0, -1)
            }

            // 如果访问的是 /gate 且没有末尾斜杠，使用相对路径重定向，避免反向代理 (如 EdgeOne) 暴露上游 Worker 真实域名
            if (pathname === prefix) {
                const search = url.search || ''
                return new Response(null, {
                    status: 301,
                    headers: {
                        Location: `${prefix}/${search}`
                    }
                })
            }

            // 如果请求路径不以该入口为前缀，直接伪装返回 Hello World (状态码 200)
            if (!pathname.startsWith(`${prefix}/`)) {
                return new Response('Hello World', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                })
            }

            // 剥离安全入口前缀，映射到内部标准路由
            pathname = pathname.slice(prefix.length) || '/'
        }

        // 获取当前请求的对外 Origin (优先读取 CDN 请求头，其次 X-Forwarded-Proto / Host)
        const currentOrigin = getPublicOrigin(request, env, url)

        // -------------------------------------------------------------
        // 1. 公开接口：获取订阅 YAML (/sub?token=xxx 或 /<entrance>/sub?token=xxx)
        // -------------------------------------------------------------
        if (pathname === '/sub') {
            const queryToken = url.searchParams.get('token')
            if (!queryToken) {
                return new Response('Missing token parameter', { status: 400 })
            }

            const currentSubToken = await getSubscriptionToken(env)
            if (!currentSubToken || !timingSafeEqual(queryToken, currentSubToken)) {
                return new Response('Invalid subscription token', { status: 403 })
            }

            const baseYaml = await getBaseYaml(env)
            const providers = await getProviders(env)
            const proxyBaseUrl = `${currentOrigin}${prefix}/provider-proxy?token=${encodeURIComponent(queryToken)}&name=`
            const finalYaml = assembleFinalYaml(baseYaml, providers, proxyBaseUrl)

            return new Response(finalYaml, {
                status: 200,
                headers: {
                    'Content-Type': 'text/yaml; charset=utf-8',
                    'Content-Disposition': 'inline; filename="clash_config.yaml"',
                    'profile-update-interval': '24',
                    'subscription-userinfo': 'upload=0; download=0; total=1073741824000; expire=0'
                }
            })
        }

        // -------------------------------------------------------------
        // 2. 公开接口：代理拉取指定 Provider 的内容 (/provider-proxy?token=xxx&name=xxx)
        // -------------------------------------------------------------
        if (pathname === '/provider-proxy') {
            const queryToken = url.searchParams.get('token')
            const providerName = url.searchParams.get('name')
            if (!queryToken || !providerName) {
                return new Response('Missing token or name parameter', { status: 400 })
            }

            const currentSubToken = await getSubscriptionToken(env)
            if (!currentSubToken || !timingSafeEqual(queryToken, currentSubToken)) {
                return new Response('Invalid subscription token', { status: 403 })
            }

            const providers = await getProviders(env)
            const targetProvider = providers.find(p => p.name === providerName)
            if (!targetProvider || !targetProvider.url) {
                return new Response('Provider not found', { status: 404 })
            }

            try {
                // 由 Worker 代表发起外部订阅拉取请求
                const upstreamRes = await fetch(targetProvider.url, {
                    headers: {
                        'User-Agent': request.headers.get('User-Agent') || 'Clash/1.18.0',
                        Accept: '*/*'
                    }
                })

                const responseHeaders = new Headers(upstreamRes.headers)
                // 确保跨域或格式正常返回
                responseHeaders.set('Access-Control-Allow-Origin', '*')
                if (!responseHeaders.get('Content-Type')) {
                    responseHeaders.set('Content-Type', 'text/yaml; charset=utf-8')
                }

                return new Response(upstreamRes.body, {
                    status: upstreamRes.status,
                    headers: responseHeaders
                })
            } catch (err) {
                return new Response(`Failed to proxy provider: ${err.message}`, { status: 502 })
            }
        }

        // -------------------------------------------------------------
        // 2. 静态资源路由 (分开部署/模块化)
        // -------------------------------------------------------------
        if (pathname === '/' || pathname === '/admin' || pathname === '/admin.html') {
            // 将当前 prefix 注入到前端页面中，方便前端发起相对 API 请求
            const injectedHtml = HTML_ADMIN.replace(
                '<head>',
                `<head>\n  <script>window.__BASE_PREFIX__ = ${JSON.stringify(prefix)};</script>`
            )
            return new Response(injectedHtml, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            })
        }

        if (pathname === '/public/css/style.css') {
            return new Response(CSS_STYLE, {
                headers: { 'Content-Type': 'text/css; charset=utf-8' }
            })
        }

        if (pathname === '/public/js/app.client.js') {
            return new Response(JS_APP, {
                headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
            })
        }

        if (pathname === '/public/js/providers.client.js') {
            return new Response(JS_PROVIDERS, {
                headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
            })
        }

        // -------------------------------------------------------------
        // 3. 登录与登出接口
        // -------------------------------------------------------------
        if (pathname === '/api/login' && request.method === 'POST') {
            try {
                const body = await request.json()
                const token = body.token
                if (!token) {
                    return jsonResponse({ success: false, error: 'Token is required' }, 400)
                }

                const loginResult = await handleLogin(token, env)
                if (!loginResult.success) {
                    return jsonResponse({ success: false, error: 'Invalid admin token' }, 401)
                }

                return jsonResponse({ success: true, message: 'Logged in successfully' }, 200, {
                    'Set-Cookie': loginResult.cookie
                })
            } catch (e) {
                return jsonResponse({ success: false, error: e.message }, 500)
            }
        }

        if (pathname === '/api/logout' && request.method === 'POST') {
            const clearCookie = await handleLogout(request, env)
            return jsonResponse({ success: true }, 200, { 'Set-Cookie': clearCookie })
        }

        // -------------------------------------------------------------
        // 4. 需要鉴权的 WebUI API
        // -------------------------------------------------------------
        const isAuthed = await authenticateRequest(request, env)

        if (pathname.startsWith('/api/')) {
            if (!isAuthed) {
                return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
            }

            // 获取当前请求的对外 Origin (优先读取 CDN 请求头，其次 X-Forwarded-Proto / Host)
            const currentOrigin = getPublicOrigin(request, env, url)

            // 获取当前所有配置数据
            if (pathname === '/api/config' && request.method === 'GET') {
                const baseYaml = await getBaseYaml(env)
                const providers = await getProviders(env)
                const subToken = await getSubscriptionToken(env)

                return jsonResponse({
                    success: true,
                    data: {
                        baseYaml,
                        providers,
                        subToken,
                        subUrl: `${currentOrigin}${prefix}/sub?token=${subToken}`
                    }
                })
            }

            // 保存 Base YAML
            if (pathname === '/api/config/base-yaml' && request.method === 'POST') {
                const { yaml } = await request.json()
                if (typeof yaml !== 'string') {
                    return jsonResponse({ success: false, error: 'Invalid yaml content' }, 400)
                }
                await saveBaseYaml(yaml, env)
                return jsonResponse({ success: true })
            }

            // 保存 Proxy Providers (AES 加密存储)
            if (pathname === '/api/config/providers' && request.method === 'POST') {
                const { providers } = await request.json()
                if (!Array.isArray(providers)) {
                    return jsonResponse({ success: false, error: 'Providers must be an array' }, 400)
                }
                await saveProviders(providers, env)
                return jsonResponse({ success: true })
            }

            // 更新 Subscription Token (AES 加密存储)
            if (pathname === '/api/config/sub-token' && request.method === 'POST') {
                const { token } = await request.json()
                if (!token || typeof token !== 'string') {
                    return jsonResponse({ success: false, error: 'Invalid token' }, 400)
                }
                await saveSubscriptionToken(token, env)
                return jsonResponse({
                    success: true,
                    subUrl: `${currentOrigin}${prefix}/sub?token=${token}`
                })
            }

            // 预览最终拼接生成的 YAML
            if (pathname === '/api/preview' && request.method === 'GET') {
                const baseYaml = await getBaseYaml(env)
                const providers = await getProviders(env)
                const subToken = await getSubscriptionToken(env)
                const proxyBaseUrl = `${currentOrigin}${prefix}/provider-proxy?token=${encodeURIComponent(subToken || '')}&name=`
                const finalYaml = assembleFinalYaml(baseYaml, providers, proxyBaseUrl)
                return jsonResponse({ success: true, yaml: finalYaml })
            }

            return jsonResponse({ success: false, error: 'Not Found' }, 404)
        }

        return new Response('Not Found', { status: 404 })
    }
}
