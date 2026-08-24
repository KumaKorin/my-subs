/**
 * 请求日志审计 API 控制器
 */
import { dbGetLogs, dbClearLogs } from '../../db.js'
import { jsonResponse } from '../../utils/http.js'
import { Env } from '../../types/index.js'

export async function handleLogsApi(
    pathname: string,
    request: Request,
    env: Env,
    url: URL
): Promise<Response | null> {
    // 1. 获取请求日志列表 (/api/logs?limit=50&offset=0&type=all&errorOnly=0)
    if (pathname === '/api/logs' && request.method === 'GET') {
        if (!env.DB) {
            return jsonResponse({ success: true, data: { logs: [], total: 0, hasD1: false } })
        }
        const limit = parseInt(url.searchParams.get('limit') || '50', 10)
        const offset = parseInt(url.searchParams.get('offset') || '0', 10)
        const type = url.searchParams.get('type') || 'all'
        const statusOnlyError = url.searchParams.get('errorOnly') === '1'

        const result = await dbGetLogs(env.DB, { limit, offset, type, statusOnlyError })
        return jsonResponse({
            success: true,
            data: {
                logs: result.logs,
                total: result.total,
                hasD1: true
            }
        })
    }

    // 2. 清除日志 (/api/logs/clear)
    if (pathname === '/api/logs/clear' && request.method === 'POST') {
        if (!env.DB) {
            return jsonResponse({ success: false, error: 'D1 database is not bound' }, 400)
        }
        const body = ((await request.json().catch(() => ({}))) || {}) as { beforeDays?: number | string }
        const beforeDays = body.beforeDays ? parseInt(String(body.beforeDays), 10) : null
        await dbClearLogs(env.DB, { beforeDays })
        return jsonResponse({ success: true })
    }

    return null
}
