/**
 * 身份认证 API 控制器 (/api/auth)
 */
import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { AppContext } from '../../types/env.js'
import { hmacSign, hmacVerify, timingSafeEqual } from '../../services/crypto.js'
import { COOKIE_NAME, SESSION_TTL_SECONDS } from '../../middlewares/auth.js'

export const authApi = new Hono<AppContext>()

/**
 * 登录
 */
authApi.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string }
  const tokenInput = body.token || ''

  if (!timingSafeEqual(tokenInput, c.env.ADMIN_TOKEN || '')) {
    return c.json({ success: false, error: 'Invalid admin token' }, 401)
  }

  const sessionId = crypto.randomUUID()
  const signature = await hmacSign(sessionId, c.env.APP_SECRET || '')
  const signedCookieValue = `${sessionId}.${signature}`

  if (c.env.SUBS_KV) {
    await c.env.SUBS_KV.put(
      `session:${sessionId}`,
      JSON.stringify({ createdAt: Date.now() }),
      { expirationTtl: SESSION_TTL_SECONDS }
    )
  }

  setCookie(c, COOKIE_NAME, signedCookieValue, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: SESSION_TTL_SECONDS
  })

  return c.json({ success: true })
})

/**
 * 登出
 */
authApi.post('/logout', async (c) => {
  const cookieVal = getCookie(c, COOKIE_NAME)
  if (cookieVal && cookieVal.includes('.')) {
    const [sessionId] = cookieVal.split('.')
    if (c.env.SUBS_KV) {
      await c.env.SUBS_KV.delete(`session:${sessionId}`)
    }
  }

  deleteCookie(c, COOKIE_NAME, {
    path: '/',
    secure: true,
    sameSite: 'Strict'
  })

  return c.json({ success: true })
})

/**
 * 检查当前登录状态
 */
authApi.get('/me', async (c) => {
  const cookieVal = getCookie(c, COOKIE_NAME)
  if (!cookieVal || !cookieVal.includes('.')) {
    return c.json({ authenticated: false })
  }

  const [sessionId, signature] = cookieVal.split('.')
  if (!sessionId || !signature) {
    return c.json({ authenticated: false })
  }

  const isValidSig = await hmacVerify(sessionId, signature, c.env.APP_SECRET || '')
  if (!isValidSig) {
    return c.json({ authenticated: false })
  }

  if (c.env.SUBS_KV) {
    const sessionData = await c.env.SUBS_KV.get(`session:${sessionId}`)
    if (!sessionData) {
      return c.json({ authenticated: false })
    }
  }

  return c.json({ authenticated: true })
})
