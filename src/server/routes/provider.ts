/**
 * 订阅伪装 (手动节点) Provider 下发控制器 (/provider/custom/:id)
 */
import { Hono } from 'hono'
import { AppContext } from '../types/env.js'
import { getProfileByToken, getProviderById, getSystemSettings } from '../services/cache.js'
import { resolveEffectiveProfileProxy, resolveEffectiveProviderSettings } from '../services/yaml.js'
import { logRequest } from '../db/queries.js'
import { extractClientInfo } from '../utils/http.js'

export const customProviderRoute = new Hono<AppContext>()

customProviderRoute.get('/custom/:id', async (c) => {
  const reqStartTime = Date.now()
  const { clientIp, clientCountry, userAgent } = extractClientInfo(c)
  const providerId = c.req.param('id')
  const queryToken = c.req.query('token')

  if (!providerId || !queryToken) {
    return c.text('Missing provider id or token parameter', 400)
  }

  const targetProfile = await getProfileByToken(queryToken, c.env)
  if (!targetProfile || targetProfile.isDeleted) {
    return c.text('Invalid subscription token or profile deleted', 403)
  }

  // 验证此 Profile 是否启用了该 Provider
  if (!targetProfile.enabledProviderIds?.includes(providerId)) {
    return c.text('Provider not enabled in this profile', 403)
  }

  const targetProvider = await getProviderById(providerId, c.env)
  if (!targetProvider || targetProvider.isDeleted) {
    return c.text('Provider not found', 404)
  }

  let nodesYaml = (targetProvider.customNodesYaml || '').trim()
  if (!nodesYaml) {
    nodesYaml = 'proxies: []'
  } else if (!nodesYaml.startsWith('proxies:')) {
    // 自动补全 proxies: 根属性
    const indented = nodesYaml
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n')
    nodesYaml = `proxies:\n${indented}`
  }

  const durationMs = Date.now() - reqStartTime
  c.executionCtx?.waitUntil(
    logRequest(c.env.DB, {
      request_type: 'provider',
      profile_id: targetProfile.id,
      profile_name: targetProfile.name,
      target_id: targetProvider.id,
      target_name: targetProvider.name,
      client_ip: clientIp,
      client_country: clientCountry,
      user_agent: userAgent,
      status_code: 200,
      duration_ms: durationMs,
      user_info: 'upload=1073741824; download=5368709120; total=107374182400; expire=1893456000'
    })
  )

  const fileName = `${targetProvider.name || 'custom_provider'}.yaml`
  return new Response(nodesYaml, {
    status: 200,
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'Profile-Update-Interval': '24',
      // 伪装返回机场流量报头 (100GB 虚拟容量，让客户端美观展示)
      'subscription-userinfo': 'upload=1073741824; download=5368709120; total=107374182400; expire=1893456000'
    }
  })
})

/**
 * 隐藏真实机场订阅 URL 下发路由 (/provider/proxy/:id)
 * 支持「代理中转模式 (Worker 或 自定义请求代理拉取)」与「302 跳转模式 (客户端 UA 防扫描伪装)」
 */
customProviderRoute.get('/proxy/:id', async (c) => {
  const reqStartTime = Date.now()
  const { clientIp, clientCountry, userAgent } = extractClientInfo(c)
  const providerId = c.req.param('id')
  const queryToken = c.req.query('token')

  if (!providerId || !queryToken) {
    return c.text('Missing provider id or token parameter', 400)
  }

  const targetProfile = await getProfileByToken(queryToken, c.env)
  if (!targetProfile || targetProfile.isDeleted) {
    return c.text('Invalid subscription token or profile deleted', 403)
  }

  if (!targetProfile.enabledProviderIds?.includes(providerId)) {
    return c.text('Provider not enabled in this profile', 403)
  }

  const targetProvider = await getProviderById(providerId, c.env)
  if (!targetProvider || targetProvider.isDeleted || !targetProvider.url) {
    return c.text('Provider not found or invalid URL', 404)
  }

  // 解析当前 Provider 在该 Profile 下差分生效的设置，以及 Profile 最终生效的代理模板
  const settings = await getSystemSettings(c.env)
  const effectiveProvider = resolveEffectiveProviderSettings(targetProvider, targetProfile)
  const effectiveProfileProxy = resolveEffectiveProfileProxy(targetProfile, settings)

  // 1. 跳转模式 (Redirect Mode): 校验客户端 UA，非主流代理客户端直接返回 200 Hello World 伪装
  if (effectiveProvider.urlMode === 'redirect') {
    const ua = (userAgent || '').toLowerCase()
    const isProxyClient = /clash|mihomo|stash|meta|shadowrocket|sing-box|surge|quantumult|v2ray|ss/.test(ua)

    if (!isProxyClient) {
      c.executionCtx?.waitUntil(
        logRequest(c.env.DB, {
          request_type: 'provider',
          profile_id: targetProfile.id,
          profile_name: targetProfile.name,
          target_id: targetProvider.id,
          target_name: targetProvider.name,
          client_ip: clientIp,
          client_country: clientCountry,
          user_agent: userAgent,
          status_code: 200,
          duration_ms: Date.now() - reqStartTime,
          error_message: 'Redirect mode: Non-client UA blocked with Hello World'
        })
      )
      return new Response('Hello World', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }

    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
        request_type: 'provider',
        profile_id: targetProfile.id,
        profile_name: targetProfile.name,
        target_id: targetProvider.id,
        target_name: targetProvider.name,
        client_ip: clientIp,
        client_country: clientCountry,
        user_agent: userAgent,
        status_code: 302,
        duration_ms: Date.now() - reqStartTime
      })
    )
    return Response.redirect(targetProvider.url, 302)
  }

  // 2. 代理拉取模式 (Proxy Mode): Worker 直接拉取 或 走配置的请求代理 proxyUrlTemplate 拉取
  let fetchUrl = targetProvider.url
  let isViaCustomProxy = false

  if (effectiveProvider.useCustomProxy) {
    if (effectiveProfileProxy.proxyUrlTemplate && effectiveProfileProxy.proxyUrlTemplate.includes('{url}')) {
      fetchUrl = effectiveProfileProxy.proxyUrlTemplate.replace('{url}', encodeURIComponent(targetProvider.url))
      isViaCustomProxy = true
    }
  }

  try {
    const forwardHeaders = new Headers()
    for (const [key, val] of c.req.raw.headers.entries()) {
      const lk = key.toLowerCase()
      if (lk !== 'host' && lk !== 'cookie' && !lk.startsWith('cf-') && lk !== 'x-real-ip') {
        forwardHeaders.set(key, val)
      }
    }
    if (!forwardHeaders.get('User-Agent')) {
      forwardHeaders.set('User-Agent', userAgent || 'Clash/1.18.0')
    }

    let upstreamRes = await fetch(fetchUrl, {
      headers: forwardHeaders,
      redirect: 'follow'
    })

    const userInfoHeader = upstreamRes.headers.get('subscription-userinfo') || null
    const responseHeaders = new Headers(upstreamRes.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    if (!responseHeaders.get('Content-Type')) {
      responseHeaders.set('Content-Type', 'text/yaml; charset=utf-8')
    }

    const durationMs = Date.now() - reqStartTime
    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
        request_type: isViaCustomProxy ? 'provider-proxy' : 'provider',
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
  } catch (err: any) {
    const durationMs = Date.now() - reqStartTime
    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
        request_type: isViaCustomProxy ? 'provider-proxy' : 'provider',
        profile_id: targetProfile.id,
        profile_name: targetProfile.name,
        target_id: targetProvider.id,
        target_name: targetProvider.name,
        client_ip: clientIp,
        client_country: clientCountry,
        user_agent: userAgent,
        status_code: 502,
        duration_ms: durationMs,
        error_message: err.message || 'Failed to fetch upstream provider'
      })
    )
    return c.text(`Failed to proxy provider: ${err.message || 'Unknown error'}`, 502)
  }
})
