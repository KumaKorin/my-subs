/**
 * 客户端 API 请求封装层
 */
import { ApiResponse } from '../types/index.js'

const basePrefix = window.__BASE_PREFIX__ || ''

/**
 * 拼接完整的 API 路由路径
 */
export function getApiUrl(path: string): string {
    return `${basePrefix}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * 获取 Base Prefix (如安全入口前缀)
 */
export function getBasePrefix(): string {
    return basePrefix
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
    body?: any
}

/**
 * 统一封装 Fetch 请求
 */
export async function apiRequest<T = any>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    const url = getApiUrl(path)
    const fetchOptions: RequestInit = { ...options }

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        fetchOptions.headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
        fetchOptions.body = JSON.stringify(options.body)
    }

    const res = await fetch(url, fetchOptions)

    if (res.status === 401) {
        window.location.href = `${basePrefix}/login`
        throw new Error('未授权或登录已过期，正在跳转登录页...')
    }

    const contentType = res.headers.get('Content-Type') || ''
    if (contentType.includes('application/json')) {
        const data = await res.json() as ApiResponse<T>
        return { ok: res.ok, status: res.status, ...data }
    }

    const text = await res.text()
    return { ok: res.ok, status: res.status, text } as unknown as ApiResponse<T>
}
