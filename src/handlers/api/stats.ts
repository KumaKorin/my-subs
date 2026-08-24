/**
 * 运行指标与统计分析 API 控制器
 */
import { dbGetStats } from '../../db.js'
import { jsonResponse } from '../../utils/http.js'
import { Env } from '../../types/index.js'

export async function handleStatsApi(
    pathname: string,
    request: Request,
    env: Env
): Promise<Response | null> {
    if (pathname === '/api/stats' && request.method === 'GET') {
        if (!env.DB) {
            return jsonResponse({ success: true, data: { hasD1: false } })
        }
        const stats = await dbGetStats(env.DB)
        return jsonResponse({ success: true, data: { ...stats, hasD1: true } })
    }

    return null
}
