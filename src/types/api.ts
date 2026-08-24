/**
 * RESTful API 响应与载荷结构定义
 */

export interface ApiResponse<T = unknown> {
    success: boolean
    message?: string
    error?: string
    data?: T
    [key: string]: unknown
}

export interface LogsQueryResult {
    logs: import('./models.js').PullLog[]
    total: number
    hasD1: boolean
}
