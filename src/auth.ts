import { hmacSign, hmacVerify, timingSafeEqual } from './utils/crypto.js'
import { Env } from './types/index.js'

const COOKIE_NAME = 'auth_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 天过期

/**
 * 从 Request 解析 Cookie
 */
export function getCookies(request: Request): Record<string, string> {
    const cookieHeader = request.headers.get('Cookie')
    const cookies: Record<string, string> = {}
    if (!cookieHeader) return cookies

    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=')
        if (parts.length >= 2) {
            const name = parts[0].trim()
            const val = parts.slice(1).join('=').trim()
            cookies[name] = decodeURIComponent(val)
        }
    })
    return cookies
}

/**
 * 校验请求中的 Cookie 签名与 KV 中的 Session
 */
export async function authenticateRequest(request: Request, env: Env): Promise<boolean> {
    const cookies = getCookies(request)
    const cookieVal = cookies[COOKIE_NAME]
    if (!cookieVal || !cookieVal.includes('.')) {
        return false
    }

    const [sessionId, signature] = cookieVal.split('.')
    if (!sessionId || !signature) return false

    // 1. 验证 Cookie HMAC 签名
    const appSecret = env.APP_SECRET || ''
    const isValidSig = await hmacVerify(sessionId, signature, appSecret)
    if (!isValidSig) {
        return false
    }

    // 2. 查询 KV 校验 Session 是否存在
    if (env.SUBS_KV) {
        const sessionData = await env.SUBS_KV.get(`session:${sessionId}`)
        if (!sessionData) {
            return false
        }
    }

    return true
}

export interface LoginResult {
    success: boolean
    cookie?: string
    error?: string
}

/**
 * 使用 ADMIN_TOKEN 执行登录
 */
export async function handleLogin(tokenInput: string, env: Env): Promise<LoginResult> {
    if (!timingSafeEqual(tokenInput, env.ADMIN_TOKEN || '')) {
        return { success: false, error: 'Invalid admin token' }
    }

    // 生成 Session ID
    const sessionId = crypto.randomUUID()
    const signature = await hmacSign(sessionId, env.APP_SECRET || '')
    const signedCookieValue = `${sessionId}.${signature}`

    // 写入 KV (带 TTL)
    if (env.SUBS_KV) {
        await env.SUBS_KV.put(`session:${sessionId}`, JSON.stringify({ createdAt: Date.now() }), {
            expirationTtl: SESSION_TTL_SECONDS
        })
    }

    const cookieHeader = `${COOKIE_NAME}=${encodeURIComponent(signedCookieValue)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`

    return {
        success: true,
        cookie: cookieHeader
    }
}

/**
 * 退出登录，注销 Session
 */
export async function handleLogout(request: Request, env: Env): Promise<string> {
    const cookies = getCookies(request)
    const cookieVal = cookies[COOKIE_NAME]
    if (cookieVal && cookieVal.includes('.')) {
        const [sessionId] = cookieVal.split('.')
        if (env.SUBS_KV) {
            await env.SUBS_KV.delete(`session:${sessionId}`)
        }
    }

    return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}
