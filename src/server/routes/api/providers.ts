/**
 * Provider 节点资源池管理 API 控制器 (/api/providers)
 */
import { Hono } from 'hono'
import { AppContext } from '../../types/env.js'
import { getProvidersPool, getProviderById, getSystemSettings, saveProvidersPool } from '../../services/cache.js'
import { dbUpdateProviderTraffic } from '../../db/queries.js'
import { Provider } from '../../types/models.js'

export const providersApi = new Hono<AppContext>()

providersApi.get('/', async (c) => {
  const providers = await getProvidersPool(c.env)
  return c.json({ success: true, data: providers })
})

providersApi.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { providers?: Provider[] }
  const providers = body.providers

  if (!Array.isArray(providers)) {
    return c.json({ success: false, error: 'Invalid providers array' }, 400)
  }

  await saveProvidersPool(providers, c.env)
  const updated = await getProvidersPool(c.env)
  return c.json({ success: true, data: updated })
})

// 单个 Provider 实时拉取最新状态与订阅流量
providersApi.post('/:id/refresh-traffic', async (c) => {
  const providerId = c.req.param('id')
  if (!providerId) {
    return c.json({ success: false, error: 'Missing provider id' }, 400)
  }

  const provider = await getProviderById(providerId, c.env)
  if (!provider || provider.isDeleted) {
    return c.json({ success: false, error: 'Provider not found' }, 404)
  }

  if (provider.providerType === 'custom') {
    return c.json({
      success: true,
      data: {
        id: providerId,
        status: 200,
        lastTrafficInfo: null,
        lastFetchedAt: new Date().toISOString()
      }
    })
  }

  if (!provider.url) {
    return c.json({ success: false, error: 'Provider has no URL' }, 400)
  }

  const settings = await getSystemSettings(c.env)
  let fetchUrl = provider.url
  if (provider.useCustomProxy && settings.proxyUrlTemplate && settings.proxyUrlTemplate.includes('{url}')) {
    fetchUrl = settings.proxyUrlTemplate.replace('{url}', encodeURIComponent(provider.url))
  }

  try {
    const upstreamRes = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Clash/1.18.0',
        'Accept': '*/*'
      },
      redirect: 'follow'
    })

    const userInfoHeader = upstreamRes.headers.get('subscription-userinfo') || null
    const statusCode = upstreamRes.status

    try {
      await upstreamRes.body?.cancel()
    } catch {}

    if (c.env.DB) {
      await dbUpdateProviderTraffic(c.env.DB, providerId, statusCode, userInfoHeader)
    }

    if (c.env.SUBS_KV) {
      await c.env.SUBS_KV.delete(`data:encrypted:provider:${providerId}`)
      await c.env.SUBS_KV.delete('data:meta:provider:map')
    }

    return c.json({
      success: true,
      data: {
        id: providerId,
        status: statusCode,
        lastTrafficInfo: userInfoHeader,
        lastFetchedAt: new Date().toISOString()
      }
    })
  } catch (err: any) {
    return c.json({
      success: false,
      error: `拉取失败: ${err.message || '网络连接超时或无法访问'}`
    }, 502)
  }
})
