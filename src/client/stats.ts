/**
 * 运行分析与指标统计模块
 */
import { apiRequest } from './api.js'
import { SystemStats } from '../types/index.js'

export async function loadStats(): Promise<void> {
    try {
        const result = await apiRequest<SystemStats>('/api/stats')
        const data = result.data || { totalRequests: 0, todayRequests: 0, todayErrors: 0, todayTypeBreakdown: {} }

        const elTodayReq = document.getElementById('stat-today-requests')
        const elTodayErr = document.getElementById('stat-today-errors')
        const elSubCount = document.getElementById('stat-sub-count')
        const elProvCount = document.getElementById('stat-provider-count')
        const elGhCount = document.getElementById('stat-gh-count')

        if (elTodayReq) elTodayReq.textContent = String(data.todayRequests || 0)
        if (elTodayErr) elTodayErr.textContent = String(data.todayErrors || 0)
        if (elSubCount) elSubCount.textContent = String(data.todayTypeBreakdown?.['sub'] || 0)
        if (elProvCount) elProvCount.textContent = String(data.todayTypeBreakdown?.['provider-proxy'] || 0)
        if (elGhCount) elGhCount.textContent = String(data.todayTypeBreakdown?.['gh-proxy'] || 0)
    } catch {}
}
