/**
 * YAML 构建与 Proxy-Providers 拼接逻辑
 */
import { Provider } from './types/index.js'

/**
 * 将 Provider 数组转换为 YAML proxy-providers 节点文本
 */
export function buildProxyProvidersYaml(providers: Provider[], proxyBaseUrl = ''): string {
    if (!providers || providers.length === 0) {
        return ''
    }

    const lines = ['proxy-providers:']

    for (const p of providers) {
        if (!p.name || !p.url || p.isDeleted) continue

        const interval = p.interval || 36000
        const healthCheckInterval = p.healthCheckInterval || 36000
        const healthCheckEnable = p.healthCheckEnable !== false
        const proxy = p.proxy || 'DIRECT'
        const type = p.type || 'http'

        // 如果开启了 useWorkerProxy 且传入了 proxyBaseUrl，则使用代理链接 (优先使用 Provider UUID)
        let targetUrl = p.url
        if (p.useWorkerProxy && proxyBaseUrl) {
            targetUrl = `${proxyBaseUrl}${encodeURIComponent(p.id || p.name)}`
        }

        lines.push(`  ${p.name}:`)
        lines.push(`    type: ${type}`)
        lines.push(`    interval: ${interval}`)
        lines.push(`    health-check:`)
        lines.push(`      enable: ${healthCheckEnable}`)
        lines.push(`      interval: ${healthCheckInterval}`)
        lines.push(`    proxy: ${proxy}`)
        lines.push(`    url: "${targetUrl}"`)
    }

    return lines.join('\n')
}

/**
 * 组装 Base YAML 与 Proxy-Providers 生成最终分发 YAML
 */
export function assembleFinalYaml(baseYaml: string, providers: Provider[], proxyBaseUrl = ''): string {
    const providersYaml = buildProxyProvidersYaml(providers, proxyBaseUrl)
    if (!providersYaml) {
        return baseYaml
    }

    let cleanBaseYaml = (baseYaml || '').trim()

    // 如果 baseYaml 已经存在 proxy-providers 段落，则移除现有段落再重新注入
    const regex = /^proxy-providers:\s*[\r\n]+(?:(?:\s+.*|[\r\n]+)*)(?=\r?\n[^\s#]|\s*$)/m
    if (regex.test(cleanBaseYaml)) {
        cleanBaseYaml = cleanBaseYaml.replace(regex, '').trim()
    }

    // 拼接在头部
    return `${providersYaml}\n\n${cleanBaseYaml}\n`
}

export interface RewriteGithubOptions {
    proxyGithub?: boolean
    proxyGithubusercontent?: boolean
    proxyUrlPrefix?: string
}

/**
 * 将最终 YAML 中的 GitHub / GitHubusercontent 直连 URL 重写为 Worker 代理链接
 */
export function rewriteGithubUrls(
    yaml: string,
    { proxyGithub = false, proxyGithubusercontent = false, proxyUrlPrefix = '' }: RewriteGithubOptions = {}
): string {
    if ((!proxyGithub && !proxyGithubusercontent) || !proxyUrlPrefix) {
        return yaml
    }

    return (yaml || '').replace(/(?<=["'\s])(https:\/\/[^\s"'<>]+)/g, match => {
        let host: string
        try {
            host = new URL(match).hostname.toLowerCase()
        } catch {
            return match
        }

        const isGithubusercontent = host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com')
        const isGithub = host === 'github.com' || host.endsWith('.github.com')

        if (isGithubusercontent && proxyGithubusercontent) {
            return `${proxyUrlPrefix}${encodeURIComponent(match)}`
        }
        if (isGithub && proxyGithub) {
            return `${proxyUrlPrefix}${encodeURIComponent(match)}`
        }
        return match
    })
}
