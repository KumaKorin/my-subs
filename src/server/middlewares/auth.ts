/**
 * 管理员后台 HMAC Cookie 鉴权中间件
 */
import { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { hmacVerify } from '../services/crypto.js'
import { AppContext } from '../types/env.js'

export const COOKIE_NAME = 'auth_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 天过期

export const authMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const cookieVal = getCookie(c, COOKIE_NAME)
  if (!cookieVal || !cookieVal.includes('.')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }

  const [sessionId, signature] = cookieVal.split('.')
  if (!sessionId || !signature) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }

  const appSecret = c.env.APP_SECRET || ''
  const isValidSig = await hmacVerify(sessionId, signature, appSecret)
  if (!isValidSig) {
    return c.json({ success: false, error: 'Invalid Session Signature' }, 401)
  }

  if (c.env.SUBS_KV) {
    const sessionData = await c.env.SUBS_KV.get(`session:${sessionId}`)
    if (!sessionData) {
      return c.json({ success: false, error: 'Session Expired' }, 401)
    }
  }

  c.set('sessionId', sessionId)
  return await next()
}
