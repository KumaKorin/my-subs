/**
 * 订阅流量统计与报头解析工具
 */

export interface TrafficDisplay {
  usedBytes: number
  totalBytes: number
  remainingBytes: number
  usedStr: string
  totalStr: string
  remainingStr: string
  percent: number
  expireDate: string
  isExpired: boolean
  raw: {
    upload: number
    download: number
    total: number
    expire?: number
  }
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const idx = Math.min(i, sizes.length - 1)
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(dm))} ${sizes[idx]}`
}

/**
 * 解析 subscription-userinfo 报头
 * 样例: upload=1073741824; download=5368709120; total=107374182400; expire=1893456000
 */
export function parseTrafficInfo(headerStr: string | null | undefined): TrafficDisplay | null {
  if (!headerStr || typeof headerStr !== 'string') return null
  try {
    const parts = headerStr.split(';').map(s => s.trim())
    const info: Record<string, number> = {}
    for (const p of parts) {
      const [k, v] = p.split('=')
      if (k && v !== undefined) {
        info[k.trim().toLowerCase()] = parseInt(v.trim(), 10) || 0
      }
    }

    const upload = info.upload || 0
    const download = info.download || 0
    const usedBytes = upload + download
    const totalBytes = info.total || 0
    const remainingBytes = Math.max(0, totalBytes - usedBytes)

    let expireDate = '无限制'
    let isExpired = false
    if (info.expire && info.expire > 0) {
      const expTime = info.expire * 1000
      expireDate = new Date(expTime).toLocaleDateString()
      isExpired = Date.now() > expTime
    }

    const percent = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0

    return {
      usedBytes,
      totalBytes,
      remainingBytes,
      usedStr: formatBytes(usedBytes),
      totalStr: formatBytes(totalBytes),
      remainingStr: formatBytes(remainingBytes),
      percent,
      expireDate,
      isExpired,
      raw: {
        upload,
        download,
        total: totalBytes,
        expire: info.expire
      }
    }
  } catch {
    return null
  }
}

export function formatRelativeTime(timeStr: string | number | null | undefined): string {
  if (!timeStr) return '暂未拉取'
  try {
    const d = new Date(timeStr)
    if (isNaN(d.getTime())) return String(timeStr)
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diffSec < 60) return '刚刚'
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return String(timeStr)
  }
}
