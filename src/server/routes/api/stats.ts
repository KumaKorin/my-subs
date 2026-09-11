/**
 * 运行指标与统计数据 API 控制器 (/api/stats)
 */
import { Hono } from 'hono'
import { AppContext } from '../../types/env.js'
import { dbGetStats } from '../../db/queries.js'

export const statsApi = new Hono<AppContext>()

statsApi.get('/', async (c) => {
  if (!c.env.DB) {
    return c.json({ success: true, data: { hasD1: false } })
  }

  const stats = await dbGetStats(c.env.DB)
  return c.json({ success: true, data: { ...stats, hasD1: true } })
})
