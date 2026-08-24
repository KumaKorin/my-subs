/**
 * HTTP 请求与响应通用工具函数
 */
import { Env } from '../types/index.js'

export function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...headers
        }
    })
}

/**
 * 解析当前请求的对外 Origin (用于生成订阅链接与 Provider 代理链接)
 */
export function getPublicOrigin(request: Request, env: Env, url: URL): string {
    const cdnHeaderName = (env.CDN_HEADER_NAME || 'x-cdn-request-host').trim()
    const rawCdn = (request.headers.get(cdnHeaderName) || '').trim()

    let proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
    let host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host

    if (rawCdn) {
        const m = rawCdn.match(/^(https?):\/\/([^/]+)/i)
        if (m) {
            proto = m[1]
            host = m[2]
        } else {
            host = rawCdn
        }
    }

    return `${proto}://${host}`
}

/**
 * 校验目标 URL 是否为允许代理的 GitHub 域名
 */
export function isAllowedGithubUrl(rawUrl: string): boolean {
    try {
        const u = new URL(rawUrl)
        if (u.protocol !== 'https:') return false
        const host = u.hostname.toLowerCase()
        return (
            host === 'github.com' ||
            host.endsWith('.github.com') ||
            host === 'githubusercontent.com' ||
            host.endsWith('.githubusercontent.com')
        )
    } catch {
        return false
    }
}

export interface ClientInfo {
    clientIp: string
    clientCountry: string
    userAgent: string
}

/**
 * 提取请求的客户端基础信息 (IP, 国家, UA)
 */
export function extractClientInfo(request: Request): ClientInfo {
    const cf = (request as unknown as { cf?: { country?: string } }).cf
    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'Unknown'
    const clientCountry = cf?.country || request.headers.get('cf-ipcountry') || 'XX'
    const userAgent = request.headers.get('user-agent') || 'Unknown'
    return { clientIp, clientCountry, userAgent }
}
