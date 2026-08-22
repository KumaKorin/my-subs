import { hmacSign, hmacVerify, timingSafeEqual } from './crypto.js'

const COOKIE_NAME = 'auth_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 天过期

/**
 * 从 Request 解析 Cookie
 */
export function getCookies(request) {
    const cookieHeader = request.headers.get('Cookie')
    const cookies = {}
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
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<boolean>}
 */
export async function authenticateRequest(request, env) {
    const cookies = getCookies(request)
    const cookieVal = cookies[COOKIE_NAME]
    if (!cookieVal || !cookieVal.includes('.')) {
        return false
    }

    const [sessionId, signature] = cookieVal.split('.')
    if (!sessionId || !signature) return false

    // 1. 验证 Cookie HMAC 签名
    const isValidSig = await hmacVerify(sessionId, signature, env.APP_SECRET)
    if (!isValidSig) {
        return false
    }

    // 2. 查询 KV 校验 Session 是否存在
    const sessionData = await env.SUBS_KV.get(`session:${sessionId}`)
    if (!sessionData) {
        return false
    }

    return true
}

/**
 * 使用 ADMIN_TOKEN 执行登录
 * 登录成功后在 KV 写入 Session 并返回 Set-Cookie 响应头
 */
export async function handleLogin(tokenInput, env) {
    if (!timingSafeEqual(tokenInput, env.ADMIN_TOKEN)) {
        return { success: false, error: 'Invalid admin token' }
    }

    // 生成 Session ID
    const sessionId = crypto.randomUUID()
    const signature = await hmacSign(sessionId, env.APP_SECRET)
    const signedCookieValue = `${sessionId}.${signature}`

    // 写入 KV (带 TTL)
    await env.SUBS_KV.put(`session:${sessionId}`, JSON.stringify({ createdAt: Date.now() }), {
        expirationTtl: SESSION_TTL_SECONDS
    })

    const cookieHeader = `${COOKIE_NAME}=${encodeURIComponent(signedCookieValue)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`

    return {
        success: true,
        cookie: cookieHeader
    }
}

/**
 * 退出登录，注销 Session
 */
export async function handleLogout(request, env) {
    const cookies = getCookies(request)
    const cookieVal = cookies[COOKIE_NAME]
    if (cookieVal && cookieVal.includes('.')) {
        const [sessionId] = cookieVal.split('.')
        await env.SUBS_KV.delete(`session:${sessionId}`)
    }

    const clearCookieHeader = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    return clearCookieHeader
}
