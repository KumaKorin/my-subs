/**
 * /sub 订阅动态装配与分发控制器
 */
import { Hono } from 'hono'
import { AppContext } from '../types/env.js'
import {
  getProfileByToken,
  getGlobalBaseYaml,
  getProvidersByIds,
  getSystemSettings,
  getSubCachedYaml,
  setSubCachedYaml
} from '../services/cache.js'
import { assembleFinalYaml } from '../services/yaml.js'
import { logRequest } from '../db/queries.js'
import { extractClientInfo } from '../utils/http.js'

export const subRoute = new Hono<AppContext>()

subRoute.get('/', async (c) => {
  const reqStartTime = Date.now()
  const { clientIp, clientCountry, userAgent } = extractClientInfo(c)
  const queryToken = c.req.query('token')

  if (!queryToken) {
    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
        request_type: 'sub',
        client_ip: clientIp,
        client_country: clientCountry,
        user_agent: userAgent,
        status_code: 400,
        duration_ms: Date.now() - reqStartTime,
        error_message: 'Missing token parameter'
      })
    )
    return c.text('Missing token parameter', 400)
  }

  try {
    // 1. 优先从 KV 边缘缓存直出已组装的完整 Clash YAML (0 DB 读，0 CPU 消耗)
    const cachedYaml = await getSubCachedYaml(queryToken, c.env)
    if (cachedYaml) {
      const durationMs = Date.now() - reqStartTime
      c.executionCtx?.waitUntil(
        logRequest(c.env.DB, {
          request_type: 'sub',
          client_ip: clientIp,
          client_country: clientCountry,
          user_agent: userAgent,
          status_code: 200,
          duration_ms: durationMs,
          user_info: 'X-Cache: HIT (KV 极速直出)'
        })
      )
      return new Response(cachedYaml, {
        status: 200,
        headers: {
          'Content-Type': 'text/yaml; charset=utf-8',
          'Content-Disposition': `inline; filename="clash.yaml"`,
          'Profile-Update-Interval': '24',
          'X-Cache': 'HIT'
        }
      })
    }

    const targetProfile = await getProfileByToken(queryToken, c.env)
    if (!targetProfile || targetProfile.isDeleted) {
      c.executionCtx?.waitUntil(
        logRequest(c.env.DB, {
          request_type: 'sub',
          client_ip: clientIp,
          client_country: clientCountry,
          user_agent: userAgent,
          status_code: 403,
          duration_ms: Date.now() - reqStartTime,
          error_message: 'Invalid subscription token or profile deleted'
        })
      )
      return c.text('Invalid subscription token or profile deleted', 403)
    }

    let baseYaml = ''
    if (targetProfile.useGlobalYaml !== false) {
      baseYaml = await getGlobalBaseYaml(c.env)
    } else {
      baseYaml = targetProfile.customBaseYaml || (await getGlobalBaseYaml(c.env))
    }

    const [activeProviders, settings] = await Promise.all([
      getProvidersByIds(targetProfile.enabledProviderIds || [], c.env),
      getSystemSettings(c.env)
    ])

    const currentOrigin = c.req.url ? new URL(c.req.url).origin : ''
    const prefix = c.get('entrancePrefix') || ''
    const tokenParam = encodeURIComponent(queryToken)

    const finalYaml = assembleFinalYaml(baseYaml, activeProviders, {
      customBaseUrl: `${currentOrigin}${prefix}/provider/custom/{id}?token=${tokenParam}`,
      proxyBaseUrl: `${currentOrigin}${prefix}/provider/proxy/{id}?token=${tokenParam}`,
      ghWorkerUrl: `${currentOrigin}${prefix}/gh-proxy?token=${tokenParam}`,
      settings,
      profile: targetProfile
    })

    // 写入 KV 边缘极速缓存
    c.executionCtx?.waitUntil(setSubCachedYaml(queryToken, finalYaml, c.env))

    const durationMs = Date.now() - reqStartTime
    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
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
      status: 200,
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        'Profile-Update-Interval': '24'
      }
    })
  } catch (err: unknown) {
    const durationMs = Date.now() - reqStartTime
    const errorMessage = err instanceof Error ? err.message : String(err)

    c.executionCtx?.waitUntil(
      logRequest(c.env.DB, {
        request_type: 'sub',
        client_ip: clientIp,
        client_country: clientCountry,
        user_agent: userAgent,
        status_code: 500,
        duration_ms: durationMs,
        error_message: errorMessage
      })
    )

    return c.text(`Error assembling configuration: ${errorMessage}`, 500)
  }
})
