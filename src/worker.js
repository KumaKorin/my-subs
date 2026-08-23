import { authenticateRequest, handleLogin, handleLogout } from './auth.js'
import { timingSafeEqual, generateRandomHexToken } from './crypto.js'
import {
    getGlobalBaseYaml,
    saveGlobalBaseYaml,
    getProvidersPool,
    saveProvidersPool,
    getProfiles,
    saveProfiles,
    getProfileByToken
} from './kv.js'
import { assembleFinalYaml, rewriteGithubUrls } from './yaml.js'

// 导入前端静态资源 (作为 Text 纯文本模块导入)
import HTML_LOGIN from './public/login.html'
import HTML_CONTROL from './public/control.html'
import JS_LOGIN from './public/js/login.client.js'
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

/**
 * 校验目标 URL 是否为允许代理的 GitHub 域名 (https 且属于 github.com / githubusercontent.com 及其子域)
 */
function isAllowedGithubUrl(rawUrl) {
    try {
        const u = new URL(rawUrl)
        if (u.protocol !== 'https:') return false
        const host = u.hostname.toLowerCase()
        return (
            host === 'github.com' ||
            host.endsWith('.github.com') ||
            host === 'githubusercontent.com' ||
            host.endsWith('.githubusercontent.com')
        )
    } catch {
        return false
    }
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

            const targetProfile = await getProfileByToken(queryToken, env)
            if (!targetProfile) {
                return new Response('Invalid subscription token', { status: 403 })
            }

            // 获取使用的 Base YAML (全局 or 自定义)
            let baseYaml = ''
            if (targetProfile.useGlobalYaml !== false) {
                baseYaml = await getGlobalBaseYaml(env)
            } else {
                baseYaml = targetProfile.customBaseYaml || (await getGlobalBaseYaml(env))
            }

            // 获取启用的 Providers
            const pool = await getProvidersPool(env)
            const enabledIds = new Set(targetProfile.enabledProviderIds || [])
            const activeProviders = pool.filter(p => enabledIds.has(p.id))

            const settings = targetProfile.settings || {}
            const proxyBaseUrl = `${currentOrigin}${prefix}/provider-proxy?token=${encodeURIComponent(queryToken)}&id=`
            const ghProxyBaseUrl = `${currentOrigin}${prefix}/gh-proxy?token=${encodeURIComponent(queryToken)}&url=`
            let finalYaml = assembleFinalYaml(baseYaml, activeProviders, proxyBaseUrl)

            // 根据设置重写 GitHub 相关 URL 为 Worker 代理链接
            finalYaml = rewriteGithubUrls(finalYaml, {
                proxyGithub: !!settings.proxyGithub,
                proxyGithubusercontent: !!settings.proxyGithubusercontent,
                proxyUrlPrefix: ghProxyBaseUrl
            })

            return new Response(finalYaml, {
                status: 200,
                headers: {
                    'Content-Type': 'text/yaml; charset=utf-8',
                    'Content-Disposition': `inline; filename="${encodeURIComponent(targetProfile.name || 'clash')}.yaml"`,
                    'profile-update-interval': '24',
                    'subscription-userinfo': 'upload=0; download=0; total=1073741824000; expire=0'
                }
            })
        }

        // -------------------------------------------------------------
        // 2. 公开接口：代理拉取指定 Provider 的内容 (/provider-proxy?token=xxx&id=xxx 或 name=xxx 兼容)
        // -------------------------------------------------------------
        if (pathname === '/provider-proxy') {
            const queryToken = url.searchParams.get('token')
            const providerId = url.searchParams.get('id') || url.searchParams.get('name')
            if (!queryToken || !providerId) {
                return new Response('Missing token or id parameter', { status: 400 })
            }

            const targetProfile = await getProfileByToken(queryToken, env)
            if (!targetProfile) {
                return new Response('Invalid subscription token', { status: 403 })
            }

            const pool = await getProvidersPool(env)
            const enabledIds = new Set(targetProfile.enabledProviderIds || [])
            const targetProvider = pool.find(
                p => (p.id === providerId || p.name === providerId) && enabledIds.has(p.id)
            )
            if (!targetProvider || !targetProvider.url) {
                return new Response('Provider not found or not enabled in this profile', { status: 404 })
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
        // 2.1 公开接口：代理拉取 GitHub / GitHubusercontent 资源 (/gh-proxy?token=xxx&url=xxx)
        // -------------------------------------------------------------
        if (pathname === '/gh-proxy') {
            const queryToken = url.searchParams.get('token')
            const targetUrl = url.searchParams.get('url')
            if (!queryToken || !targetUrl) {
                return new Response('Missing token or url parameter', { status: 400 })
            }

            const targetProfile = await getProfileByToken(queryToken, env)
            if (!targetProfile) {
                return new Response('Invalid subscription token', { status: 403 })
            }

            if (!isAllowedGithubUrl(targetUrl)) {
                return new Response('Target url is not allowed', { status: 403 })
            }

            try {
                const upstreamRes = await fetch(targetUrl, {
                    headers: {
                        'User-Agent': request.headers.get('User-Agent') || 'Clash/1.18.0',
                        Accept: '*/*'
                    }
                })

                const responseHeaders = new Headers(upstreamRes.headers)
                responseHeaders.set('Access-Control-Allow-Origin', '*')
                responseHeaders.set('Cache-Control', 'public, max-age=300')
                if (!responseHeaders.get('Content-Type')) {
                    responseHeaders.set('Content-Type', 'application/octet-stream')
                }

                return new Response(upstreamRes.body, {
                    status: upstreamRes.status,
                    headers: responseHeaders
                })
            } catch (err) {
                return new Response(`Failed to proxy github resource: ${err.message}`, { status: 502 })
            }
        }

        // -------------------------------------------------------------
        // 2. 页面与静态资源路由 (登录 /login 与 控制台 /control 物理隔离)
        // -------------------------------------------------------------
        const isAuthed = await authenticateRequest(request, env)

        // 根路径访问智能重定向
        if (pathname === '/') {
            const target = isAuthed ? `${prefix}/control` : `${prefix}/login`
            return new Response(null, {
                status: 302,
                headers: { Location: target }
            })
        }

        // 登录页面路由
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

        // 控制面板页面路由 (严格鉴权，未登录直接 302 重定向到登录页，物理隔离不泄露页面 DOM)
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

        if (pathname === '/public/css/style.css') {
            return new Response(CSS_STYLE, {
                headers: { 'Content-Type': 'text/css; charset=utf-8' }
            })
        }

        if (pathname === '/public/js/login.client.js') {
            return new Response(JS_LOGIN, {
                headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
            })
        }

        if (pathname === '/public/js/app.client.js') {
            if (!isAuthed) {
                return new Response('Unauthorized', { status: 401 })
            }
            return new Response(JS_APP, {
                headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
            })
        }

        if (pathname === '/public/js/providers.client.js') {
            if (!isAuthed) {
                return new Response('Unauthorized', { status: 401 })
            }
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
        if (pathname.startsWith('/api/')) {
            if (!isAuthed) {
                return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
            }

            // 获取当前请求的对外 Origin (优先读取 CDN 请求头，其次 X-Forwarded-Proto / Host)
            const currentOrigin = getPublicOrigin(request, env, url)

            // ---------------------------------------------------------
            // API: 获取全部完整数据 (Profile 列表、Provider 池、Global Base YAML)
            // ---------------------------------------------------------
            if (pathname === '/api/data' && request.method === 'GET') {
                const globalBaseYaml = await getGlobalBaseYaml(env)
                const providersPool = await getProvidersPool(env)
                const profiles = await getProfiles(env)

                return jsonResponse({
                    success: true,
                    data: {
                        globalBaseYaml,
                        providersPool,
                        profiles,
                        publicOrigin: currentOrigin,
                        prefix
                    }
                })
            }

            // 保存全局 Base YAML
            if (pathname === '/api/global-base-yaml' && request.method === 'POST') {
                const { yaml } = await request.json()
                if (typeof yaml !== 'string') {
                    return jsonResponse({ success: false, error: 'Invalid YAML content' }, 400)
                }
                await saveGlobalBaseYaml(yaml, env)
                return jsonResponse({ success: true })
            }

            // 保存 Provider 资源池 (AES 加密)
            if (pathname === '/api/providers-pool' && request.method === 'POST') {
                const { providers } = await request.json()
                if (!Array.isArray(providers)) {
                    return jsonResponse({ success: false, error: 'Providers must be an array' }, 400)
                }
                // 为没有 ID 的 provider 分配 UUID
                for (const p of providers) {
                    if (!p.id) p.id = crypto.randomUUID()
                }
                await saveProvidersPool(providers, env)
                return jsonResponse({ success: true, providers })
            }

            // 保存所有 Profile 列表及配置 (AES 加密)
            if (pathname === '/api/profiles' && request.method === 'POST') {
                const { profiles } = await request.json()
                if (!Array.isArray(profiles)) {
                    return jsonResponse({ success: false, error: 'Profiles must be an array' }, 400)
                }
                for (const p of profiles) {
                    if (!p.id) p.id = crypto.randomUUID()
                    if (!p.token) p.token = generateRandomHexToken(32)
                    if (!Array.isArray(p.enabledProviderIds)) p.enabledProviderIds = []
                    if (p.useGlobalYaml === undefined) p.useGlobalYaml = true
                    if (typeof p.customBaseYaml !== 'string') p.customBaseYaml = ''
                    if (!p.settings || typeof p.settings !== 'object') {
                        p.settings = { proxyGithub: false, proxyGithubusercontent: false }
                    }
                }
                await saveProfiles(profiles, env)
                return jsonResponse({ success: true, profiles })
            }

            // 预览指定 Profile 的最终分发 YAML (/api/preview?profileId=xxx)
            if (pathname === '/api/preview' && request.method === 'GET') {
                const profileId = url.searchParams.get('profileId')
                const profiles = await getProfiles(env)
                const targetProfile = profiles.find(p => p.id === profileId) || profiles[0]

                if (!targetProfile) {
                    return jsonResponse({ success: false, error: 'Profile not found' }, 404)
                }

                let baseYaml = ''
                if (targetProfile.useGlobalYaml !== false) {
                    baseYaml = await getGlobalBaseYaml(env)
                } else {
                    baseYaml = targetProfile.customBaseYaml || (await getGlobalBaseYaml(env))
                }

                const pool = await getProvidersPool(env)
                const enabledIds = new Set(targetProfile.enabledProviderIds || [])
                const activeProviders = pool.filter(p => enabledIds.has(p.id))

                const token = targetProfile.token
                const settings = targetProfile.settings || {}
                const proxyBaseUrl = `${currentOrigin}${prefix}/provider-proxy?token=${encodeURIComponent(token || '')}&id=`
                const ghProxyBaseUrl = `${currentOrigin}${prefix}/gh-proxy?token=${encodeURIComponent(token || '')}&url=`
                let finalYaml = assembleFinalYaml(baseYaml, activeProviders, proxyBaseUrl)
                finalYaml = rewriteGithubUrls(finalYaml, {
                    proxyGithub: !!settings.proxyGithub,
                    proxyGithubusercontent: !!settings.proxyGithubusercontent,
                    proxyUrlPrefix: ghProxyBaseUrl
                })
                return jsonResponse({
                    success: true,
                    yaml: finalYaml,
                    profileName: targetProfile.name,
                    providerCount: activeProviders.length
                })
            }

            return jsonResponse({ success: false, error: 'Not Found' }, 404)
        }

        return new Response('Not Found', { status: 404 })
    }
}
