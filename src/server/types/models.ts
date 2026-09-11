/**
 * mySubs v2.0 核心业务实体模型定义
 */

export type ManualNodeProtocol =
  | 'socks5'
  | 'http'
  | 'ss'
  | 'vmess'
  | 'vless'
  | 'trojan'
  | 'hysteria2'
  | 'tuic'

export interface ManualNodeConfig {
  id: string
  name: string
  type: ManualNodeProtocol
  server: string
  port: number
  // SOCKS5 & HTTP
  username?: string
  password?: string
  tls?: boolean
  skipCertVerify?: boolean
  udp?: boolean
  // Shadowsocks
  cipher?: string
  // VMess / VLESS / TUIC
  uuid?: string
  alterId?: number
  network?: 'ws' | 'tcp' | 'grpc' | 'h2' | 'http'
  flow?: string
  realityPublicKey?: string
  // Trojan / Hysteria2 / Common TLS
  sni?: string
  servername?: string
  // Hysteria2
  up?: string
  down?: string
  // TUIC
  congestionController?: string
  // WS / gRPC
  wsPath?: string
  wsHeaders?: Record<string, string>
  grpcServiceName?: string
}

export interface SystemSettings {
  proxyUrlTemplate?: string // e.g. https://proxy.example.com/secret?url={url}
  githubProxyMode?: 'none' | 'worker' | 'proxy'
}

export interface ProfileProxySettings {
  mode: 'inherit' | 'custom' // 继承全局 还是 手动配置
  proxyUrlTemplate?: string // 手动独立配置时的请求代理服务模板
  githubProxyMode?: 'none' | 'worker' | 'proxy' // 手动独立配置时的 GitHub 加速模式
}

export interface ProfileProviderOverride {
  urlMode?: 'default' | 'direct' | 'proxy' | 'redirect' // 继承订阅源默认 | 直接暴露 | Worker代理 | 302跳转
  useCustomProxy?: 'default' | 'true' | 'false' // 继承源默认 | 强制启用请求代理 | 强制直连
}

export interface ProfileSettings {
  proxySettings?: ProfileProxySettings
  providerOverrides?: Record<string, ProfileProviderOverride>
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
  providerType?: 'external' | 'custom'
  urlMode?: 'direct' | 'proxy' | 'redirect' // 隐藏真实订阅分发模式: direct(直接暴露) | proxy(Worker拉取) | redirect(302跳转)
  useCustomProxy?: boolean // 在代理模式下，是否通过配置的请求代理 proxyUrlTemplate 拉取
  type?: string
  proxy?: string
  url: string
  customNodesYaml?: string
  interval?: number
  healthCheckEnable?: boolean
  healthCheckInterval?: number
  lastStatus?: number | null
  lastTrafficInfo?: string | null
  lastFetchedAt?: string | number | null
  isDeleted?: boolean | number
  updatedAt?: string | number
}

export interface PullLog {
  id?: number
  created_at?: string
  request_type: 'sub' | 'provider' | 'provider-proxy' | 'gh-proxy' | 'auth' | string
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
  settings?: SystemSettings
  publicOrigin: string
  prefix: string
  hasD1: boolean
}
