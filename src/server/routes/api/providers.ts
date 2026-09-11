/**
 * Provider 节点资源池管理 API 控制器 (/api/providers)
 */
import { Hono } from 'hono'
import { AppContext } from '../../types/env.js'
import { getProvidersPool, saveProvidersPool } from '../../services/cache.js'
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
