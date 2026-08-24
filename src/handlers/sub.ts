/**
 * /sub 订阅分发请求处理器
 */
import { getGlobalBaseYaml, getProfileByToken, getProvidersByIds } from '../kv.js'
import { logRequest } from '../db.js'
import { assembleFinalYaml, rewriteGithubUrls } from '../yaml.js'
import { extractClientInfo, getPublicOrigin } from '../utils/http.js'
import { Env } from '../types/index.js'

export async function handleSub(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    pathname: string,
    url: URL,
    prefix: string,
    reqStartTime: number
): Promise<Response | null> {
    if (pathname !== '/sub') return null

    const { clientIp, clientCountry, userAgent } = extractClientInfo(request)
    const currentOrigin = getPublicOrigin(request, env, url)

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

    try {
        const targetProfile = await getProfileByToken(queryToken, env)
        if (!targetProfile || targetProfile.isDeleted) {
            ctx.waitUntil(
                logRequest(env.DB, {
                    request_type: 'sub',
                    client_ip: clientIp,
                    client_country: clientCountry,
                    user_agent: userAgent,
                    status_code: 403,
                    duration_ms: Date.now() - reqStartTime,
                    error_message: 'Invalid subscription token or profile deleted'
                })
            )
            return new Response('Invalid subscription token or profile deleted', { status: 403 })
        }

        let baseYaml = ''
        if (targetProfile.useGlobalYaml !== false) {
            baseYaml = await getGlobalBaseYaml(env)
        } else {
            baseYaml = targetProfile.customBaseYaml || (await getGlobalBaseYaml(env))
        }

        const activeProviders = await getProvidersByIds(targetProfile.enabledProviderIds || [], env)

        const proxyBaseUrl = `${currentOrigin}${prefix}/provider-proxy?token=${encodeURIComponent(queryToken)}&id=`
        const ghProxyBaseUrl = `${currentOrigin}${prefix}/gh-proxy?token=${encodeURIComponent(queryToken)}&url=`
        let finalYaml = assembleFinalYaml(baseYaml, activeProviders, proxyBaseUrl)

        const settings = targetProfile.settings || {}
        finalYaml = rewriteGithubUrls(finalYaml, {
            proxyGithub: !!settings.proxyGithub,
            proxyGithubusercontent: !!settings.proxyGithubusercontent,
            proxyUrlPrefix: ghProxyBaseUrl
        })

        const durationMs = Date.now() - reqStartTime
        ctx.waitUntil(
            logRequest(env.DB, {
                request_type: 'sub',
                profile_id: targetProfile.id,
                profile_name: targetProfile.name,
                target_id: targetProfile.id,
                target_name: targetProfile.name,
                client_ip: clientIp,
                client_country: clientCountry,
                user_agent: userAgent,
                status_code: 200,
                duration_ms: durationMs
            })
        )

        const fileName = `${targetProfile.name || 'clash'}.yaml`
        return new Response(finalYaml, {
            headers: {
                'Content-Type': 'text/yaml; charset=utf-8',
                'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
                'Profile-Update-Interval': '24'
            }
        })
    } catch (err: unknown) {
        const durationMs = Date.now() - reqStartTime
        const errorMessage = err instanceof Error ? err.message : String(err)
        ctx.waitUntil(
            logRequest(env.DB, {
                request_type: 'sub',
                client_ip: clientIp,
                client_country: clientCountry,
                user_agent: userAgent,
                status_code: 500,
                duration_ms: durationMs,
                error_message: errorMessage
            })
        )
        return new Response(`Error assembling configuration: ${errorMessage}`, { status: 500 })
    }
}
