/**
 * /provider-proxy 与 /gh-proxy 反向代理请求处理器
 */
import { getProfileByToken, getProviderById, getProvidersPool } from '../kv.js'
import { logRequest } from '../db.js'
import { extractClientInfo, isAllowedGithubUrl } from '../utils/http.js'
import { fetchViaProxy } from '../utils/proxy-client.js'
import { Env, Provider } from '../types/index.js'

export async function handleProxy(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    pathname: string,
    url: URL,
    reqStartTime: number
): Promise<Response | null> {
    const { clientIp, clientCountry, userAgent } = extractClientInfo(request)

    // -------------------------------------------------------------
    // 1. Provider 反向代理 (/provider-proxy?token=xxx&id=xxx)
    // -------------------------------------------------------------
    if (pathname === '/provider-proxy') {
        const queryToken = url.searchParams.get('token')
        const providerId = url.searchParams.get('id')
        if (!queryToken || !providerId) {
            return new Response('Missing token or id parameter', { status: 400 })
        }

        const targetProfile = await getProfileByToken(queryToken, env)
        if (!targetProfile || targetProfile.isDeleted) {
            return new Response('Invalid subscription token or profile deleted', { status: 403 })
        }

        const enabledIds = new Set(targetProfile.enabledProviderIds || [])
        if (!enabledIds.has(providerId)) {
            return new Response('Provider not enabled for this profile', { status: 403 })
        }

        let targetProvider: Provider | null = null
        if (env.DB) {
            targetProvider = await getProviderById(providerId, env)
        } else {
            const pool = await getProvidersPool(env)
            targetProvider = pool.find(
                p => (p.id === providerId || p.name === providerId) && enabledIds.has(p.id)
            ) || null
        }

        if (!targetProvider || !targetProvider.url) {
            ctx.waitUntil(
                logRequest(env.DB, {
                    request_type: 'provider-proxy',
                    profile_id: targetProfile.id,
                    profile_name: targetProfile.name,
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

            let currentUrl = targetProvider.url
            let maxRedirects = 5
            let upstreamRes: Response | null = null

            while (maxRedirects > 0) {
                maxRedirects--
                if (targetProvider.useFetchProxy && targetProvider.fetchProxyUrl) {
                    upstreamRes = await fetchViaProxy(currentUrl, targetProvider.fetchProxyUrl, {
                        headers: forwardHeaders,
                        redirect: 'manual'
                    })
                } else {
                    upstreamRes = await fetch(currentUrl, {
                        headers: forwardHeaders,
                        redirect: 'manual'
                    })
                }

                // 检查是否为 301/302/303/307/308 重定向
                if ([301, 302, 303, 307, 308].includes(upstreamRes.status)) {
                    const location = upstreamRes.headers.get('Location')
                    if (location) {
                        const nextUrl = new URL(location, currentUrl).toString()
                        if (targetProvider.proxyRedirect !== false) {
                            // 继续由 Worker / 代理拉取重定向目标
                            currentUrl = nextUrl
                            continue
                        } else {
                            // 不代理重定向，直接把重定向状态与 Location 透传给客户端
                            break
                        }
                    }
                }
                break
            }

            if (!upstreamRes) {
                throw new Error('No response received from upstream provider')
            }

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
                    profile_id: targetProfile.id,
                    profile_name: targetProfile.name,
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
        } catch (err: unknown) {
            const durationMs = Date.now() - reqStartTime
            const errorMessage = err instanceof Error ? err.message : String(err)
            ctx.waitUntil(
                logRequest(env.DB, {
                    request_type: 'provider-proxy',
                    profile_id: targetProfile.id,
                    profile_name: targetProfile.name,
                    target_id: targetProvider?.id || providerId,
                    target_name: targetProvider?.name || 'Unknown',
                    client_ip: clientIp,
                    client_country: clientCountry,
                    user_agent: userAgent,
                    status_code: 502,
                    duration_ms: durationMs,
                    error_message: errorMessage
                })
            )
            return new Response(`Failed to proxy provider: ${errorMessage}`, { status: 502 })
        }
    }

    // -------------------------------------------------------------
    // 2. GitHub 规则代理 (/gh-proxy?token=xxx&url=xxx)
    // -------------------------------------------------------------
    if (pathname === '/gh-proxy') {
        const queryToken = url.searchParams.get('token')
        const targetUrl = url.searchParams.get('url')
        if (!queryToken || !targetUrl) {
            return new Response('Missing token or url parameter', { status: 400 })
        }

        const targetProfile = await getProfileByToken(queryToken, env)
        if (!targetProfile || targetProfile.isDeleted) {
            return new Response('Invalid subscription token or profile deleted', { status: 403 })
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
                    profile_id: targetProfile.id,
                    profile_name: targetProfile.name,
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
        } catch (err: unknown) {
            const durationMs = Date.now() - reqStartTime
            const errorMessage = err instanceof Error ? err.message : String(err)
            ctx.waitUntil(
                logRequest(env.DB, {
                    request_type: 'gh-proxy',
                    profile_id: targetProfile.id,
                    profile_name: targetProfile.name,
                    target_id: targetProfile.id,
                    target_name: targetUrl,
                    client_ip: clientIp,
                    client_country: clientCountry,
                    user_agent: userAgent,
                    status_code: 502,
                    duration_ms: durationMs,
                    error_message: errorMessage
                })
            )
            return new Response(`Failed to proxy github resource: ${errorMessage}`, { status: 502 })
        }
    }

    return null
}
