/**
 * HTTP 请求解析与 Origin 计算通用工具
 */
import { Context } from 'hono'
import { AppContext } from '../types/env.js'

export interface ClientInfo {
  clientIp: string
  clientCountry: string
  userAgent: string
}

/**
 * 获取请求客户端信息 (IP, 国家, UA)
 */
export function extractClientInfo(c: Context<AppContext>): ClientInfo {
  const req = c.req.raw
  const cf = (req as unknown as { cf?: { country?: string } }).cf
  const clientIp =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    'Unknown'
  const clientCountry = cf?.country || c.req.header('cf-ipcountry') || 'XX'
  const userAgent = c.req.header('user-agent') || 'Unknown'

  return { clientIp, clientCountry, userAgent }
}

/**
 * 解析当前请求对外展示的 Origin 域名
 */
export function getPublicOrigin(c: Context<AppContext>): string {
  const cdnHeaderName = (c.env.CDN_HEADER_NAME || 'x-cdn-request-host').trim()
  const rawCdn = (c.req.header(cdnHeaderName) || '').trim()
  const url = new URL(c.req.url)

  let proto = c.req.header('x-forwarded-proto') || url.protocol.replace(':', '')
  let host = c.req.header('x-forwarded-host') || c.req.header('host') || url.host

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
