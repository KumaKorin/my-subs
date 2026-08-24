/**
 * 安全入口路由中间件 (SECURE_ENTRANCE)
 */
import { Env } from '../types/index.js'

export interface EntranceResult {
    ok: boolean
    pathname?: string
    prefix?: string
    response?: Response
}

export function handleSecureEntrance(pathname: string, url: URL, env: Env): EntranceResult {
    let prefix = ''
    if (!env.SECURE_ENTRANCE) {
        return { ok: true, pathname, prefix: '' }
    }

    prefix = env.SECURE_ENTRANCE.startsWith('/') ? env.SECURE_ENTRANCE : `/${env.SECURE_ENTRANCE}`
    if (prefix.endsWith('/') && prefix.length > 1) {
        prefix = prefix.slice(0, -1)
    }

    if (pathname === prefix) {
        const search = url.search || ''
        return {
            ok: false,
            response: new Response(null, {
                status: 301,
                headers: { Location: `${prefix}/${search}` }
            })
        }
    }

    if (!pathname.startsWith(`${prefix}/`)) {
        return {
            ok: false,
            response: new Response('Hello World', {
                status: 200,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            })
        }
    }

    const strippedPathname = pathname.slice(prefix.length) || '/'
    return { ok: true, pathname: strippedPathname, prefix }
}
