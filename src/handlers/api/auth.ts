/**
 * 认证与会话 API 控制器
 */
import { handleLogin, handleLogout } from '../../auth.js'
import { jsonResponse } from '../../utils/http.js'
import { Env } from '../../types/index.js'

export async function handleAuthApi(pathname: string, request: Request, env: Env): Promise<Response | null> {
    if (pathname === '/api/login' && request.method === 'POST') {
        try {
            const body = await request.json<{ token?: string }>()
            const token = body.token
            if (!token) {
                return jsonResponse({ success: false, error: 'Token is required' }, 400)
            }

            const loginResult = await handleLogin(token, env)
            if (!loginResult.success) {
                return jsonResponse({ success: false, error: 'Invalid admin token' }, 401)
            }

            return jsonResponse({ success: true, message: 'Logged in successfully' }, 200, {
                'Set-Cookie': loginResult.cookie || ''
            })
        } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e)
            return jsonResponse({ success: false, error: err }, 500)
        }
    }

    if (pathname === '/api/logout' && request.method === 'POST') {
        const clearCookie = await handleLogout(request, env)
        return jsonResponse({ success: true }, 200, { 'Set-Cookie': clearCookie })
    }

    return null
}
