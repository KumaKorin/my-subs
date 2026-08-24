/**
 * 客户端通用 UI 与格式化工具库
 */

export interface TrafficDisplay {
    usedStr: string
    totalStr: string
    percent: number
    expireDate: string
}

/**
 * 转换 UTC 时间字符串为用户浏览器本地时区格式
 */
export function formatLocalTime(utcStr: string | number | null | undefined): string {
    if (!utcStr) return '-'
    try {
        let str = String(utcStr).trim()
        if (!str.endsWith('Z') && !str.includes('+')) {
            str = str.replace(' ', 'T') + 'Z'
        }
        const date = new Date(str)
        if (isNaN(date.getTime())) return String(utcStr)

        const pad = (n: number) => String(n).padStart(2, '0')
        const y = date.getFullYear()
        const m = pad(date.getMonth() + 1)
        const d = pad(date.getDate())
        const hh = pad(date.getHours())
        const mm = pad(date.getMinutes())
        const ss = pad(date.getSeconds())

        return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
    } catch {
        return String(utcStr)
    }
}

/**
 * 格式化字节大小 (B, KB, MB, GB, TB)
 */
export function formatBytes(bytes: number): string {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

/**
 * 解析订阅响应头中的 subscription-userinfo 流量信息
 */
export function parseTrafficInfo(headerStr: string | null | undefined): TrafficDisplay | null {
    if (!headerStr) return null
    try {
        const parts = headerStr.split(';').map(s => s.trim())
        const info: Record<string, number> = {}
        for (const p of parts) {
            const [k, v] = p.split('=')
            if (k && v !== undefined) info[k.trim()] = parseInt(v.trim(), 10) || 0
        }
        const used = (info.upload || 0) + (info.download || 0)
        const total = info.total || 0
        let expireDate = '无限制'
        if (info.expire && info.expire > 0) {
            expireDate = new Date(info.expire * 1000).toLocaleDateString()
        }
        return {
            usedStr: formatBytes(used),
            totalStr: formatBytes(total),
            percent: total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
            expireDate
        }
    } catch {
        return null
    }
}

/**
 * 生成指定字节长度的随机 Hex Token
 */
export function generateRandomHex(byteLength = 32): string {
    const arr = new Uint8Array(byteLength)
    crypto.getRandomValues(arr)
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

/**
 * 弹出轻量 Toast 提示框
 */
export function showToast(msg: string, isError = false): void {
    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--success)'
    toast.textContent = msg
    document.body.appendChild(toast)
    setTimeout(() => {
        toast.style.opacity = '0'
        setTimeout(() => toast.remove(), 300)
    }, 2500)
}

/**
 * 复制文本到剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    if (!navigator.clipboard) {
        const textArea = document.createElement('textarea')
        textArea.value = text
        document.body.appendChild(textArea)
        textArea.select()
        try {
            document.execCommand('copy')
        } catch {}
        document.body.removeChild(textArea)
        return true
    }
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}
