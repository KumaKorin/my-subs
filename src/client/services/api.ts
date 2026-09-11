/**
 * 统一强类型前端 API 请求客户端
 */
import { ApiResponse } from '../types'

/**
 * 获取当前部署的安全隐蔽入口前缀 (如 /secret_gate)
 */
export function getEntrancePrefix(): string {
  if (typeof window !== 'undefined' && (window as any).__ENTRANCE_PREFIX__ !== undefined) {
    return (window as any).__ENTRANCE_PREFIX__
  }
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname
    const knownPages = ['login', 'profiles', 'providers', 'base-yaml', 'logs', 'assets', 'api', 'sub', 'provider']
    const segments = pathname.split('/').filter(Boolean)
    const idx = segments.findIndex(s => knownPages.includes(s))
    if (idx > 0) {
      return '/' + segments.slice(0, idx).join('/')
    }
    if (segments.length === 1 && !knownPages.includes(segments[0])) {
      return '/' + segments[0]
    }
  }
  return ''
}

export async function apiRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const prefix = getEntrancePrefix()
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    const fullUrl = `${prefix}${cleanEndpoint}`

    const res = await fetch(fullUrl, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    })

    if (res.status === 401) {
      // 未登录拦截
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = `${prefix}/login`
      }
      return { success: false, error: 'Unauthorized' }
    }

    const json = (await res.json().catch(() => ({}))) as ApiResponse<T>
    if (!res.ok && !json.error) {
      json.error = `HTTP error ${res.status}: ${res.statusText}`
    }
    return json
  } catch (err: any) {
    return {
      success: false,
      error: err.message || '网络连接异常'
    }
  }
}
