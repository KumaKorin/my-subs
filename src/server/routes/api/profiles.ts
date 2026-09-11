/**
 * Profile 订阅配置管理 API 控制器 (/api/profiles)
 */
import { Hono } from 'hono'
import { AppContext } from '../../types/env.js'
import { getProfiles, saveProfiles } from '../../services/cache.js'
import { Profile } from '../../types/models.js'

export const profilesApi = new Hono<AppContext>()

profilesApi.get('/', async (c) => {
  const profiles = await getProfiles(c.env)
  return c.json({ success: true, data: profiles })
})

profilesApi.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { profiles?: Profile[] }
  const profiles = body.profiles

  if (!Array.isArray(profiles)) {
    return c.json({ success: false, error: 'Invalid profiles array' }, 400)
  }

  await saveProfiles(profiles, c.env)
  const updated = await getProfiles(c.env)
  return c.json({ success: true, data: updated })
})
