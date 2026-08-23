import { authenticateRequest, handleLogin, handleLogout } from './auth.js'
import { timingSafeEqual, generateRandomHexToken } from './crypto.js'
import {
    getGlobalBaseYaml,
    saveGlobalBaseYaml,
    getProvidersPool,
    saveProvidersPool,
    getProvidersByIds,
    getProviderById,
    getProfiles,
    saveProfiles,
    getProfileByToken
} from './kv.js'
import {
    logRequest,
    dbGetLogs,
    dbClearLogs,
    dbGetStats,
    migrateKvToD1,
    initD1Tables,
    dbGetProfiles
} from './db.js'
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
 * 校验目标 URL 是否为允许代理的 GitHub 域名
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

/**
 * 提取请求的客户端基础信息 (IP, 国家, UA)
 */
function extractClientInfo(request) {
    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'Unknown'
    const clientCountry = request.cf?.country || request.headers.get('cf-ipcountry') || 'XX'
    const userAgent = request.headers.get('user-agent') || 'Unknown'
    return { clientIp, clientCountry, userAgent }
}

export default {
    async fetch(request, env, ctx) {
        const reqStartTime = Date.now()
        const url = new URL(request.url)
        let pathname = url.pathname

        const { clientIp, clientCountry, userAgent } = extractClientInfo(request)

        // -------------------------------------------------------------
        // 安全入口路由校验 (SECURE_ENTRANCE)
        // -------------------------------------------------------------
        let prefix = ''
        if (env.SECURE_ENTRANCE) {
            prefix = env.SECURE_ENTRANCE.startsWith('/') ? env.SECURE_ENTRANCE : `/${env.SECURE_ENTRANCE}`
            if (prefix.endsWith('/') && prefix.length > 1) {
                prefix = prefix.slice(0, -1)
            }

            if (pathname === prefix) {
                const search = url.search || ''
                return new Response(null, {
                    status: 301,
                    headers: {
                        Location: `${prefix}/${search}`
                    }
                })
            }

            if (!pathname.startsWith(`${prefix}/`)) {
                return new Response('Hello World', {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                })
            }

            pathname = pathname.slice(prefix.length) || '/'
        }

        const currentOrigin = getPublicOrigin(request, env, url)

        // -------------------------------------------------------------
        // 1. 公开接口：获取订阅 YAML (/sub?token=xxx)
        // -------------------------------------------------------------
        if (pathname === '/sub') {
            const queryToken = url.searchParams.get('token')
            if (!queryToken) {
                ctx.waitUntil(
                    logRequest(env.DB, {
                        request_type: 'sub',
                        client_ip: clientIp,
                        client_country: clientCountry,
                        user_agent: userAgent,
                        status_code: 400,
                        duration_ms: Date.now() - reqStartTime,
                        error_message: 'Missing token parameter'
                    })
                )
                return new Response('Missing token parameter', { status: 400 })
            }

            const targetProfile = await getProfileByToken(queryToken, env)
            if (!targetProfile) {
                ctx.waitUntil(
                    logRequest(env.DB, {
                        request_type: 'sub',
                        client_ip: clientIp,
                        client_country: clientCountry,
                        user_agent: userAgent,
                        status_code: 403,
                        duration_ms: Date.now() - reqStartTime,
                        error_message: 'Invalid subscription token'
                    })
                )
                return new Response('Invalid subscription token', { status: 403 })
            }

            let baseYaml = ''
            if (targetProfile.useGlobalYaml !== false) {
                baseYaml = await getGlobalBaseYaml(env)
            } else {
                baseYaml = targetProfile.customBaseYaml || (await getGlobalBaseYaml(env))
            }

            const activeProviders = await getProvidersByIds(targetProfile.enabledProviderIds || [], env)

            const settings = targetProfile.settings || {}
            const proxyBaseUrl = `${currentOrigin}${prefix}/provider-proxy?token=${encodeURIComponent(queryToken)}&id=`
            const ghProxyBaseUrl = `${currentOrigin}${prefix}/gh-proxy?token=${encodeURIComponent(queryToken)}&url=`
            let finalYaml = assembleFinalYaml(baseYaml, activeProviders, proxyBaseUrl)

            finalYaml = rewriteGithubUrls(finalYaml, {
                proxyGithub: !!settings.proxyGithub,
                proxyGithubusercontent: !!settings.proxyGithubusercontent,
                proxyUrlPrefix: ghProxyBaseUrl
            })

            const durationMs = Date.now() - reqStartTime
            ctx.waitUntil(
                logRequest(env.DB, {
                    request_type: 'sub',
                    target_id: targetProfile.id,
                    target_name: targetProfile.name,
                    client_ip: clientIp,
                    client_country: clientCountry,
                    user_agent: userAgent,
                    status_code: 200,
                    duration_ms: durationMs
                })
            )

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
        // 2. 公开接口：代理拉取指定 Provider 的内容 (/provider-proxy?token=xxx&id=xxx)
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

            const enabledIds = new Set(targetProfile.enabledProviderIds || [])
            let targetProvider = null

            if (enabledIds.has(providerId)) {
                targetProvider = await getProviderById(providerId, env)
            } else {
                const pool = await getProvidersPool(env)
                targetProvider = pool.find(
                    p => (p.id === providerId || p.name === providerId) && enabledIds.has(p.id)
                )
            }

            if (!targetProvider || !targetProvider.url) {
                ctx.waitUntil(
                    logRequest(env.DB, {
                        request_type: 'provider-proxy',
                        target_id: providerId,
                        target_name: targetProvider?.name || 'Unknown',
                        client_ip: clientIp,
                        client_country: clientCountry,
                        user_agent: userAgent,
                        status_code: 404,
                        duration_ms: Date.now() - reqStartTime,
                        error_message: 'Provider not found or not enabled'
                    })
                )
                return new Response('Provider not found or not enabled in this profile', { status: 404 })
            }

            try {
                const forwardHeaders = new Headers()
                for (const [key, val] of request.headers.entries()) {
                    const lk = key.toLowerCase()
                    if (
                        lk !== 'host' &&
                        lk !== 'cookie' &&
                        lk !== 'x-forwarded-host' &&
                        lk !== 'x-forwarded-proto' &&
                        lk !== 'x-real-ip' &&
                        !lk.startsWith('cf-')
                    ) {
                        forwardHeaders.set(key, val)
                    }
                }
                if (!forwardHeaders.get('User-Agent')) {
                    forwardHeaders.set('User-Agent', 'Clash/1.18.0')
                }

                const upstreamRes = await fetch(targetProvider.url, {
                    headers: forwardHeaders
                })

                const responseHeaders = new Headers(upstreamRes.headers)
                responseHeaders.set('Access-Control-Allow-Origin', '*')
                if (!responseHeaders.get('Content-Type')) {
                    responseHeaders.set('Content-Type', 'text/yaml; charset=utf-8')
                }

                const userInfoHeader = upstreamRes.headers.get('subscription-userinfo') || null
                const durationMs = Date.now() - reqStartTime

                ctx.waitUntil(
                    logRequest(env.DB, {
                        request_type: 'provider-proxy',
                        target_id: targetProvider.id,
                        target_name: targetProvider.name,
                        client_ip: clientIp,
                        client_country: clientCountry,
                        user_agent: userAgent,
                        status_code: upstreamRes.status,
                        duration_ms: durationMs,
                        user_info: userInfoHeader
                    })
                )

                return new Response(upstreamRes.body, {
                    status: upstreamRes.status,
                    headers: responseHeaders
                })
            } catch (err) {
                const durationMs = Date.now() - reqStartTime
                ctx.waitUntil(
                    logRequest(env.DB, {
                        request_type: 'provider-proxy',
                        target_id: targetProvider.id,
                        target_name: targetProvider.name,
                        client_ip: clientIp,
                        client_country: clientCountry,
                        user_agent: userAgent,
                        status_code: 502,
                        duration_ms: durationMs,
                        error_message: err.message
                    })
                )
                return new Response(`Failed to proxy provider: ${err.message}`, { status: 502 })
            }
        }

        // -------------------------------------------------------------
        // 2.1 公开接口：代理拉取 GitHub 资源 (/gh-proxy?token=xxx&url=xxx)
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

                const durationMs = Date.now() - reqStartTime
                ctx.waitUntil(
                    logRequest(env.DB, {
                        request_type: 'gh-proxy',
                        target_id: targetProfile.id,
                        target_name: targetUrl,
                        client_ip: clientIp,
                        client_country: clientCountry,
                        user_agent: userAgent,
                        status_code: upstreamRes.status,
                        duration_ms: durationMs
                    })
                )

                return new Response(upstreamRes.body, {
                    status: upstreamRes.status,
                    headers: responseHeaders
                })
            } catch (err) {
                const durationMs = Date.now() - reqStartTime
                ctx.waitUntil(
                    logRequest(env.DB, {
                        request_type: 'gh-proxy',
                        target_id: targetProfile.id,
                        target_name: targetUrl,
                        client_ip: clientIp,
                        client_country: clientCountry,
                        user_agent: userAgent,
                        status_code: 502,
                        duration_ms: durationMs,
                        error_message: err.message
                    })
                )
                return new Response(`Failed to proxy github resource: ${err.message}`, { status: 502 })
            }
        }

        // -------------------------------------------------------------
        // 3. 页面与静态资源路由
        // -------------------------------------------------------------
        const isAuthed = await authenticateRequest(request, env)

        if (pathname === '/') {
            const target = isAuthed ? `${prefix}/control` : `${prefix}/login`
            return new Response(null, {
                status: 302,
                headers: { Location: target }
            })
        }

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
        // 4. 登录与登出接口
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
        // 5. 需要鉴权的 WebUI API
        // -------------------------------------------------------------
        if (pathname.startsWith('/api/')) {
            if (!isAuthed) {
                return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
            }

            try {
                const currentOrigin = getPublicOrigin(request, env, url)

                // API: 获取全部完整数据
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
                            prefix,
                            hasD1: !!env.DB
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

                // 保存 Provider 资源池
                if (pathname === '/api/providers-pool' && request.method === 'POST') {
                    const { providers } = await request.json()
                    if (!Array.isArray(providers)) {
                        return jsonResponse({ success: false, error: 'Providers must be an array' }, 400)
                    }
                    for (const p of providers) {
                        if (!p.id) p.id = crypto.randomUUID()
                    }
                    await saveProvidersPool(providers, env)
                    return jsonResponse({ success: true, providers })
                }

                // 保存所有 Profile 列表
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

                // 预览指定 Profile 的最终分发 YAML
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

                    const activeProviders = await getProvidersByIds(targetProfile.enabledProviderIds || [], env)

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

                // API: 获取请求日志列表 (/api/logs?limit=50&offset=0&type=all&errorOnly=0)
                if (pathname === '/api/logs' && request.method === 'GET') {
                    if (!env.DB) {
                        return jsonResponse({ success: true, data: { logs: [], total: 0, hasD1: false } })
                    }
                    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
                    const offset = parseInt(url.searchParams.get('offset') || '0', 10)
                    const type = url.searchParams.get('type') || 'all'
                    const statusOnlyError = url.searchParams.get('errorOnly') === '1'

                    const result = await dbGetLogs(env.DB, { limit, offset, type, statusOnlyError })
                    return jsonResponse({
                        success: true,
                        data: {
                            logs: result.logs,
                            total: result.total,
                            hasD1: true
                        }
                    })
                }

                // API: 清除日志 (/api/logs/clear)
                if (pathname === '/api/logs/clear' && request.method === 'POST') {
                    if (!env.DB) {
                        return jsonResponse({ success: false, error: 'D1 database is not bound' }, 400)
                    }
                    const body = await request.json().catch(() => ({}))
                    const beforeDays = body.beforeDays ? parseInt(body.beforeDays, 10) : null
                    await dbClearLogs(env.DB, { beforeDays })
                    return jsonResponse({ success: true })
                }

                // API: 获取运行统计指标 (/api/stats)
                if (pathname === '/api/stats' && request.method === 'GET') {
                    if (!env.DB) {
                        return jsonResponse({ success: true, data: { hasD1: false } })
                    }
                    const stats = await dbGetStats(env.DB)
                    return jsonResponse({ success: true, data: { ...stats, hasD1: true } })
                }

                // API: 执行 KV 到 D1 数据迁移 (/api/migrate-kv-to-d1)
                if (pathname === '/api/migrate-kv-to-d1' && request.method === 'POST') {
                    const res = await migrateKvToD1(env)
                    return jsonResponse(res, res.success ? 200 : 500)
                }

                // API: 检查迁移状态 (/api/migration-status)
                if (pathname === '/api/migration-status' && request.method === 'GET') {
                    if (!env.DB || !env.SUBS_KV) {
                        return jsonResponse({ success: true, canMigrate: false, reason: 'Missing DB or KV' })
                    }
                    const d1Profiles = await dbGetProfiles(env.DB).catch(() => [])
                    const kvMap = await env.SUBS_KV.get('data:meta:profile:map')
                    const kvHasData = !!kvMap
                    const d1IsEmpty = d1Profiles.length === 0

                    return jsonResponse({
                        success: true,
                        canMigrate: kvHasData && d1IsEmpty,
                        d1ProfilesCount: d1Profiles.length,
                        kvHasData
                    })
                }

                return jsonResponse({ success: false, error: 'Not Found' }, 404)
            } catch (err) {
                console.error('API execution error:', err)
                return jsonResponse({ success: false, error: err.message }, 500)
            }
        }

        return new Response('Not Found', { status: 404 })
    }
}
