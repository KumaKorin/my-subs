/**
 * 核心实体模型定义
 */

export interface ProfileSettings {
    proxyGithub?: boolean
    proxyGithubusercontent?: boolean
    [key: string]: unknown
}

export interface Profile {
    id: string
    name: string
    token: string
    useGlobalYaml: boolean
    customBaseYaml?: string
    enabledProviderIds: string[]
    settings?: ProfileSettings
    createdAt?: number | string
    updatedAt?: number | string
    isDeleted?: boolean | number
}

export interface Provider {
    id: string
    name: string
    type?: string
    proxy?: string
    url: string
    interval?: number
    healthCheckEnable?: boolean
    healthCheckInterval?: number
    useWorkerProxy?: boolean
    useFetchProxy?: boolean
    fetchProxyUrl?: string
    proxyRedirect?: boolean
    lastStatus?: number | null
    lastTrafficInfo?: string | null
    lastFetchedAt?: string | number | null
    isDeleted?: boolean | number
    updatedAt?: string | number
}

export interface PullLog {
    id?: number
    created_at?: string
    request_type: 'sub' | 'provider-proxy' | 'gh-proxy' | string
    profile_id?: string | null
    profile_name?: string | null
    target_id?: string | null
    target_name?: string | null
    client_ip?: string | null
    client_country?: string | null
    user_agent?: string | null
    status_code: number
    duration_ms?: number | null
    error_message?: string | null
    user_info?: string | null
}

export interface SystemStats {
    totalRequests: number
    todayRequests: number
    todayErrors: number
    todayTypeBreakdown: Record<string, number>
    hasD1?: boolean
}

export interface AppData {
    globalBaseYaml: string
    providersPool: Provider[]
    profiles: Profile[]
    publicOrigin: string
    prefix: string
    hasD1: boolean
}
