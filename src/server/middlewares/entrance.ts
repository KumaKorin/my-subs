/**
 * 安全隐蔽入口中间件 (SECURE_ENTRANCE)
 */
import { MiddlewareHandler } from 'hono'
import { AppContext } from '../types/env.js'

export const secureEntranceMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const secureEntrance = c.env.SECURE_ENTRANCE?.trim()
  if (!secureEntrance) {
    c.set('entrancePrefix', '')
    return await next()
  }

  let prefix = secureEntrance.startsWith('/') ? secureEntrance : `/${secureEntrance}`
  if (prefix.endsWith('/') && prefix.length > 1) {
    prefix = prefix.slice(0, -1)
  }

  const url = new URL(c.req.url)
  const pathname = url.pathname

  if (pathname === prefix) {
    return c.redirect(`${prefix}/${url.search}`, 301)
  }

  if (!pathname.startsWith(`${prefix}/`)) {
    // 伪装返回纯文本 200 OK，混淆自动化扫描器
    return c.text('Hello World', 200)
  }

  c.set('entrancePrefix', prefix)
  return await next()
}
