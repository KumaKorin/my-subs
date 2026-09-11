import React, { useState, useEffect, useCallback } from 'react'
import { PullLog, SystemStats } from '../../types'
import { Icon } from '../../components/common/Icon'
import { Button } from '../../components/common/Button'
import { apiRequest } from '../../services/api'
import { useToast } from '../../components/common/Toast'
import { useDialog } from '../../context/DialogContext'

export const LogsPage: React.FC = () => {
  const [logs, setLogs] = useState<PullLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [errorOnly, setErrorOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const { success, error } = useToast()
  const { confirm } = useDialog()

  const loadStats = async () => {
    const res = await apiRequest<SystemStats>('/api/stats')
    if (res.success && res.data) {
      setStats(res.data)
    }
  }

  const loadLogs = useCallback(
    async (targetPage = page) => {
      setLoading(true)
      const offset = (targetPage - 1) * pageSize
      try {
        const res = await apiRequest<{ logs?: PullLog[]; total?: number; hasD1?: boolean }>(
          `/api/logs?limit=${pageSize}&offset=${offset}&type=all&errorOnly=${errorOnly ? '1' : '0'}`
        )
        if (res.success && res.data) {
          setLogs(res.data.logs || [])
          setTotal(res.data.total || 0)
          setPage(targetPage)
        } else {
          error(res.error || '获取日志失败')
        }
      } finally {
        setLoading(false)
      }
    },
    [page, pageSize, errorOnly, error]
  )

  useEffect(() => {
    loadStats()
    loadLogs(1)
    const timer = setInterval(() => {
      loadStats()
      loadLogs(1)
    }, 15000)
    return () => clearInterval(timer)
  }, [errorOnly])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleClearLogs = async () => {
    const confirmed = await confirm({
      title: '清空请求审计流水确认',
      message: '确定要彻底清空全部请求日志审计流水记录吗？\n\n⚠️ 清空后所有历史访问记录、客户端 IP 与节点拉取统计将不可恢复！',
      variant: 'danger',
      confirmText: '立即清空',
      cancelText: '取消'
    })
    if (!confirmed) return

    const res = await apiRequest('/api/logs/clear', { method: 'POST' })
    if (res.success) {
      success('全部请求审计流水已清空')
      loadStats()
      loadLogs(1)
    } else {
      error(res.error || '清空失败')
    }
  }

  const formatTime = (timeStr?: string) => {
    if (!timeStr) return '-'
    try {
      const d = new Date(timeStr.includes('Z') ? timeStr : `${timeStr}Z`)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const ss = String(d.getSeconds()).padStart(2, '0')
      return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
    } catch {
      return timeStr
    }
  }

  const getTypeInfo = (log: PullLog) => {
    const reqType = (log.request_type || '').toLowerCase()
    if (reqType === 'sub') {
      return {
        label: '分发',
        endpoint: '/sub',
        colorClass: 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
      }
    }
    if (reqType === 'provider') {
      return {
        label: '订阅',
        endpoint: log.target_id ? `/provider/custom/${log.target_id}` : '/provider',
        colorClass: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
      }
    }
    if (reqType === 'provider-proxy') {
      return {
        label: '订阅(代理)',
        endpoint: log.target_id ? `/provider/proxy/${log.target_id} (通过自定义请求代理)` : '/provider/proxy',
        colorClass: 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
      }
    }
    if (reqType === 'gh-proxy') {
      return {
        label: '代理(gh)',
        endpoint: '/gh-proxy',
        colorClass: 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
      }
    }
    if (reqType === 'auth' || reqType === 'login') {
      return {
        label: '登录',
        endpoint: '/api/auth/login',
        colorClass: 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20'
      }
    }
    return {
      label: log.request_type,
      endpoint: `/${log.request_type}`,
      colorClass: 'bg-muted text-muted-foreground border border-border'
    }
  }

  const parseTraffic = (userInfo?: string | null) => {
    if (!userInfo) return null
    try {
      const parts = Object.fromEntries(
        userInfo.split(';').map(kv => kv.trim().split('='))
      )
      const upload = Number(parts.upload || 0)
      const download = Number(parts.download || 0)
      const total = Number(parts.total || 0)
      const usedGb = ((upload + download) / 1024 / 1024 / 1024).toFixed(1)
      const totalGb = (total / 1024 / 1024 / 1024).toFixed(0)
      return `${usedGb}G / ${totalGb}G`
    } catch {
      return null
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 统计指标卡片大盘 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-card border border-card-border shadow-sm flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Icon name="ri-calendar-todo-line text-primary" /> 今日请求总量
          </span>
          <span className="text-2xl font-bold font-mono text-foreground">
            {stats?.todayRequests ?? 0}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-card border border-card-border shadow-sm flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Icon name="ri-error-warning-line text-danger" /> 今日请求异常
          </span>
          <span className="text-2xl font-bold font-mono text-danger">
            {stats?.todayErrors ?? 0}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-card border border-card-border shadow-sm flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Icon name="ri-file-download-line text-primary" /> 分发 (/sub) 请求量
          </span>
          <span className="text-2xl font-bold font-mono text-foreground">
            {stats?.todayTypeBreakdown?.['sub'] ?? 0}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-card border border-card-border shadow-sm flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Icon name="ri-database-2-line text-primary" /> 累计流水总计
          </span>
          <span className="text-2xl font-bold font-mono text-foreground">
            {stats?.totalRequests ?? 0}
          </span>
        </div>
      </div>

      {/* 审计日志列表 */}
      <div className="p-5 rounded-xl bg-card border border-card-border shadow-sm flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Icon name="ri-history-line text-primary text-lg" />
            <span className="font-bold text-sm text-foreground">实时请求审计流水</span>
            <span className="text-xs font-mono text-muted-foreground">({total} 条记录)</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={errorOnly}
                onChange={e => setErrorOnly(e.target.checked)}
                className="rounded border-border"
              />
              <span>仅看异常 (≥400)</span>
            </label>

            <Button
              variant="secondary"
              size="sm"
              icon="ri-refresh-line"
              loading={loading}
              onClick={() => {
                loadStats()
                loadLogs(1)
              }}
            >
              刷新
            </Button>

            <Button
              variant="danger"
              size="sm"
              icon="ri-delete-bin-line"
              onClick={handleClearLogs}
            >
              清空日志
            </Button>
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground font-semibold">
                <th className="py-2 px-3">时间</th>
                <th className="py-2 px-3">类型</th>
                <th className="py-2 px-3">状态</th>
                <th className="py-2 px-3">耗时</th>
                <th className="py-2 px-3">归属 Profile / 订阅源</th>
                <th className="py-2 px-3">客户端 IP / 地区</th>
                <th className="py-2 px-3">客户端设备 (UA)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground">
                    {loading ? '加载中...' : '暂无请求审计日志'}
                  </td>
                </tr>
              ) : (
                logs.map((log, i) => {
                  const isErr = log.status_code >= 400
                  const ua = (log.user_agent || '').toLowerCase()
                  const typeInfo = getTypeInfo(log)
                  const traffic = parseTraffic(log.user_info)

                  let devIcon = 'ri-computer-line'
                  if (ua.includes('clash') || ua.includes('meta') || ua.includes('stash')) {
                    devIcon = 'ri-flashlight-line text-success'
                  } else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
                    devIcon = 'ri-smartphone-line text-primary'
                  }

                  return (
                    <tr key={log.id || i} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-muted-foreground whitespace-nowrap">
                        {formatTime(log.created_at)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1 cursor-help ${typeInfo.colorClass}`}
                          title={`请求端点: ${typeInfo.endpoint}`}
                        >
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                            isErr ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
                          }`}
                        >
                          {log.status_code}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap text-foreground">
                        {log.duration_ms !== null && log.duration_ms !== undefined ? `${log.duration_ms} ms` : '-'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{log.profile_name || log.target_name || '-'}</span>
                          {traffic && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-500 border border-purple-500/20"
                              title={`订阅流量: ${traffic}`}
                            >
                              {traffic}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="px-1 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                            {log.client_country || 'XX'}
                          </span>
                          <span className="text-muted-foreground">{log.client_ip || '-'}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 max-w-xs truncate text-muted-foreground" title={log.user_agent || ''}>
                        <span className="inline-flex items-center gap-1">
                          <Icon name={devIcon} />
                          <span className="truncate">{log.user_agent || '-'}</span>
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 分页条 */}
        <div className="flex items-center justify-between pt-3 border-t border-border/70 text-xs text-muted-foreground">
          <span>
            当前第 <b className="text-foreground">{page}</b> / {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon="ri-arrow-left-s-line"
              disabled={page <= 1}
              onClick={() => loadLogs(page - 1)}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="ri-arrow-right-s-line"
              disabled={page >= totalPages}
              onClick={() => loadLogs(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
