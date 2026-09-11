/**
 * GitHub 规则集加速代理路由 (/gh-proxy)
 */
import { Hono } from 'hono'
import { AppContext } from '../types/env.js'
import { getProfileByToken } from '../services/cache.js'
import { logRequest } from '../db/queries.js'
import { extractClientInfo } from '../utils/http.js'

export const ghRoute = new Hono<AppContext>()

ghRoute.get('/', async (c) => {
  const reqStartTime = Date.now()
  const { clientIp, clientCountry, userAgent } = extractClientInfo(c)
  const queryToken = c.req.query('token')
  const targetUrl = c.req.query('url')

  if (!queryToken || !targetUrl) {
    return c.text('Missing token or url parameter', 400)
  }

  const targetProfile = await getProfileByToken(queryToken, c.env)
  if (!targetProfile || targetProfile.isDeleted) {
    return c.text('Invalid subscription token or profile deleted', 403)
  }

  // 安全域名校验: 仅允许 GitHub 相关资源 (raw.githubusercontent.com, github.com)
  try {
    const parsed = new URL(targetUrl)
    const host = parsed.hostname.toLowerCase()
    if (host !== 'raw.githubusercontent.com' && host !== 'github.com' && !host.endsWith('.github.com')) {
      return c.text('Target host is not allowed for github proxy', 403)
    }
  } catch {
    return c.text('Invalid target url', 400)
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': userAgent || 'Clash/1.18.0',
        'Accept': '*/*'
      },
      redirect: 'follow'
    })

    const durationMs = Date.now() - reqStartTime
    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
        request_type: 'gh-proxy',
        profile_id: targetProfile.id,
        profile_name: targetProfile.name,
        target_name: targetUrl,
        client_ip: clientIp,
        client_country: clientCountry,
        user_agent: userAgent,
        status_code: upstreamRes.status,
        duration_ms: durationMs
      })
    )

    const responseHeaders = new Headers(upstreamRes.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Cache-Control', 'public, max-age=86400')

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders
    })
  } catch (err: any) {
    const durationMs = Date.now() - reqStartTime
    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
        request_type: 'gh-proxy',
        profile_id: targetProfile.id,
        profile_name: targetProfile.name,
        target_name: targetUrl,
        client_ip: clientIp,
        client_country: clientCountry,
        user_agent: userAgent,
        status_code: 502,
        duration_ms: durationMs,
        error_message: err.message || 'Failed to fetch github resource'
      })
    )
    return c.text(`Failed to fetch github resource: ${err.message || 'Unknown error'}`, 502)
  }
})
