/**
 * 请求审计流水日志模块
 */
import { apiRequest } from './api.js'
import { formatLocalTime, showToast } from './ui.js'
import { loadStats } from './stats.js'
import { PullLog } from '../types/index.js'

let logsCurrentPage = 1
const logsPageSize = 25
let logsTotalCount = 0
let logsTotalPages = 1
let logsTimer: any = null

export async function loadLogs(page: number | null = null): Promise<void> {
    if (page !== null) logsCurrentPage = page
    const tbody = document.getElementById('logs-tbody')
    if (!tbody) return

    const typeSelect = document.getElementById('log-filter-type') as HTMLSelectElement | null
    const errorOnlyCheckbox = document.getElementById('log-filter-error-only') as HTMLInputElement | null

    const type = typeSelect ? typeSelect.value : 'all'
    const errorOnly = errorOnlyCheckbox && errorOnlyCheckbox.checked ? '1' : '0'
    const offset = (logsCurrentPage - 1) * logsPageSize

    try {
        const result = await apiRequest<{ logs?: PullLog[], total?: number, hasD1?: boolean }>(
            `/api/logs?limit=${logsPageSize}&offset=${offset}&type=${encodeURIComponent(type)}&errorOnly=${errorOnly}`
        )
        const { logs, total, hasD1 } = result.data || {}
        logsTotalCount = total || 0
        logsTotalPages = Math.max(1, Math.ceil(logsTotalCount / logsPageSize))

        // 更新分页指示与按钮状态
        const elTotal = document.getElementById('logs-total-count')
        const elCurrent = document.getElementById('logs-current-page')
        const elPages = document.getElementById('logs-total-pages')
        const btnPrev = document.getElementById('btn-logs-prev') as HTMLButtonElement | null
        const btnNext = document.getElementById('btn-logs-next') as HTMLButtonElement | null

        if (elTotal) elTotal.textContent = String(logsTotalCount)
        if (elCurrent) elCurrent.textContent = String(logsCurrentPage)
        if (elPages) elPages.textContent = String(logsTotalPages)
        if (btnPrev) btnPrev.disabled = logsCurrentPage <= 1
        if (btnNext) btnNext.disabled = logsCurrentPage >= logsTotalPages

        if (!hasD1 && (!logs || logs.length === 0)) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
                        <i class="ri-database-2-line" style="font-size: 1.5rem; display:block; margin-bottom: 0.5rem;"></i>
                        未绑定 Cloudflare D1 数据库，日志功能暂未激活。<br>
                        请在 <code>wrangler.toml</code> 中添加 <code>[[d1_databases]]</code> 绑定。
                    </td>
                </tr>
            `
            return
        }

        if (!logs || logs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                        暂无请求日志记录
                    </td>
                </tr>
            `
            return
        }

        tbody.innerHTML = logs
            .map(log => {
                let typeBadge = `<span class="log-badge log-badge-sub"><i class="ri-file-download-line"></i> /sub 分发</span>`
                if (log.request_type === 'provider-proxy') {
                    typeBadge = `<span class="log-badge log-badge-provider"><i class="ri-route-line"></i> /provider 代理</span>`
                } else if (log.request_type === 'gh-proxy') {
                    typeBadge = `<span class="log-badge log-badge-gh"><i class="ri-github-line"></i> /gh 规则代理</span>`
                }

                let statusBadge = `<span class="status-pill status-pill-ok"><i class="ri-check-line"></i> ${log.status_code}</span>`
                if (log.status_code >= 400) {
                    statusBadge = `<span class="status-pill status-pill-err"><i class="ri-close-line"></i> ${log.status_code}</span>`
                }

                let durationClass = 'latency-fast'
                if ((log.duration_ms || 0) > 400) durationClass = 'latency-slow'
                else if ((log.duration_ms || 0) > 150) durationClass = 'latency-med'

                const durationStr = log.duration_ms !== null && log.duration_ms !== undefined ? `<span class="${durationClass}">${log.duration_ms} ms</span>` : '-'
                
                // 归属 Profile 展示
                const profileDisplay = log.profile_name || (log.request_type === 'sub' ? log.target_name : '-') || '-'

                // 目标/资源 展示
                let targetCell = ''
                if (log.request_type === 'sub') {
                    targetCell = `<span style="font-weight: 600; color: var(--text-main); display: inline-flex; align-items: center; gap: 0.3rem"><i class="ri-file-download-line" style="color: #60a5fa"></i> 订阅全量配置</span>`
                } else if (log.request_type === 'provider-proxy') {
                    targetCell = `<span style="font-weight: 600; color: var(--text-main); display: inline-flex; align-items: center; gap: 0.3rem" title="${log.target_name || ''}"><i class="ri-plug-line" style="color: #34d399"></i> ${log.target_name || log.target_id || '-'}</span>`
                } else if (log.request_type === 'gh-proxy') {
                    const rawUrl = log.target_name || ''
                    const shortName = rawUrl ? rawUrl.split('/').slice(-2).join('/') : '-'
                    targetCell = `<span style="font-size: 0.78rem; font-family: 'JetBrains Mono', monospace; color: var(--text-muted); max-width: 220px; display: inline-flex; align-items: center; gap: 0.3rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" title="${rawUrl}"><i class="ri-github-line" style="color: #c084fc"></i> ${shortName}</span>`
                } else {
                    targetCell = `<span title="${log.target_name || ''}">${log.target_name || '-'}</span>`
                }

                // 流量与错误悬浮小 icon
                let infoIcon = ''
                if (log.user_info) {
                    infoIcon += `<span class="log-info-circle" title="节点流量: ${log.user_info}"><i class="ri-information-line"></i></span>`
                }
                if (log.error_message) {
                    infoIcon += `<span class="log-err-circle" title="异常信息: ${log.error_message}"><i class="ri-error-warning-line"></i></span>`
                }

                const lua = (log.user_agent || '').toLowerCase()
                let devIcon = '<i class="ri-global-line"></i>'
                if (lua.includes('android') || lua.includes('iphone') || lua.includes('mobile')) {
                    devIcon = '<i class="ri-smartphone-line" style="color:#38bdf8"></i>'
                } else if (lua.includes('windows') || lua.includes('macintosh') || lua.includes('mac os') || lua.includes('linux')) {
                    devIcon = '<i class="ri-computer-line" style="color:#818cf8"></i>'
                } else if (lua.includes('clash') || lua.includes('meta') || lua.includes('stash')) {
                    devIcon = '<i class="ri-flashlight-line" style="color:#34d399"></i>'
                }

                return `
                    <tr>
                        <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.76rem; color: var(--text-muted); white-space: nowrap">
                            ${formatLocalTime(log.created_at)}
                        </td>
                        <td>${typeBadge}</td>
                        <td>${statusBadge}</td>
                        <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem">${durationStr}</td>
                        <td>
                            <span class="profile-chip" title="归属 Profile: ${profileDisplay}"><i class="ri-user-smile-line"></i> ${profileDisplay}</span>
                        </td>
                        <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                            ${targetCell}
                        </td>
                        <td style="white-space: nowrap">
                            <div style="display: inline-flex; align-items: center; gap: 0.45rem; white-space: nowrap">
                                <span class="country-tag">${log.client_country || 'XX'}</span>
                                <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text-muted)">${log.client_ip || '-'}</span>
                            </div>
                        </td>
                        <td>
                            <div style="font-size: 0.76rem; color: var(--text-muted); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.35rem" title="${log.user_agent || ''}">
                                ${devIcon}
                                <span>${log.user_agent || '-'}</span>
                                ${infoIcon}
                            </div>
                        </td>
                    </tr>
                `
            })
            .join('')
    } catch (e: any) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--danger); padding: 2rem;">
                    获取日志失败: ${e.message}
                </td>
            </tr>
        `
    }
}

export function refreshLogsAndStats(): void {
    loadStats()
    loadLogs()
}

export function startLogsPolling(): void {
    refreshLogsAndStats()
    if (!logsTimer) {
        logsTimer = setInterval(refreshLogsAndStats, 10000)
    }
}

export function stopLogsPolling(): void {
    if (logsTimer) {
        clearInterval(logsTimer)
        logsTimer = null
    }
}

export function bindLogsEvents(): void {
    const btnRefreshLogs = document.getElementById('btn-refresh-logs')
    if (btnRefreshLogs) {
        btnRefreshLogs.addEventListener('click', () => {
            refreshLogsAndStats()
            showToast('已刷新最新请求日志')
        })
    }

    const logFilterType = document.getElementById('log-filter-type')
    if (logFilterType) {
        logFilterType.addEventListener('change', () => loadLogs(1))
    }

    const logFilterErrorOnly = document.getElementById('log-filter-error-only')
    if (logFilterErrorOnly) {
        logFilterErrorOnly.addEventListener('change', () => loadLogs(1))
    }

    const btnLogsPrev = document.getElementById('btn-logs-prev')
    if (btnLogsPrev) {
        btnLogsPrev.addEventListener('click', () => {
            if (logsCurrentPage > 1) {
                loadLogs(logsCurrentPage - 1)
            }
        })
    }

    const btnLogsNext = document.getElementById('btn-logs-next')
    if (btnLogsNext) {
        btnLogsNext.addEventListener('click', () => {
            if (logsCurrentPage < logsTotalPages) {
                loadLogs(logsCurrentPage + 1)
            }
        })
    }

    const btnClearLogs = document.getElementById('btn-clear-logs')
    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', async () => {
            const confirm1 = confirm('确定要清空全部请求日志流水记录吗？')
            if (!confirm1) return

            const confirm2 = confirm('⚠️ 再次确认：清空后所有访问流水及节点流量监控历史将不可恢复！\n\n是否立即执行清空？')
            if (!confirm2) return

            const data = await apiRequest('/api/logs/clear', { method: 'POST' })
            if (data.success) {
                showToast('全部日志已清空')
                refreshLogsAndStats()
            } else {
                showToast(data.error || '清空失败', true)
            }
        })
    }
}
