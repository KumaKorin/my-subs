/**
 * 请求审计流水日志 API 控制器 (/api/logs)
 */
import { Hono } from 'hono'
import { AppContext } from '../../types/env.js'
import { dbGetLogs, dbClearLogs } from '../../db/queries.js'

export const logsApi = new Hono<AppContext>()

logsApi.get('/', async (c) => {
  if (!c.env.DB) {
    return c.json({ success: true, data: { logs: [], total: 0, hasD1: false } })
  }

  const limit = parseInt(c.req.query('limit') || '50', 10)
  const offset = parseInt(c.req.query('offset') || '0', 10)
  const type = c.req.query('type') || 'all'
  const statusOnlyError = c.req.query('errorOnly') === '1'

  const result = await dbGetLogs(c.env.DB, { limit, offset, type, statusOnlyError })
  return c.json({
    success: true,
    data: {
      logs: result.logs,
      total: result.total,
      hasD1: true
    }
  })
})

logsApi.post('/clear', async (c) => {
  if (!c.env.DB) {
    return c.json({ success: false, error: 'D1 database is not bound' }, 400)
  }

  const body = (await c.req.json().catch(() => ({}))) as { beforeDays?: number | string }
  const beforeDays = body.beforeDays ? parseInt(String(body.beforeDays), 10) : null

  await dbClearLogs(c.env.DB, { beforeDays })
  return c.json({ success: true })
})
