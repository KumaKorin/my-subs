/**
 * YAML 构建与 Proxy-Providers 拼接逻辑
 */

/**
 * 将 Provider 数组转换为 YAML proxy-providers 节点文本
 * @param {Array} providers
 * @param {string} proxyBaseUrl 可选的代理前缀，例如 "https://domain.com/gate/provider-proxy?name="
 */
export function buildProxyProvidersYaml(providers, proxyBaseUrl = '') {
    if (!providers || providers.length === 0) {
        return ''
    }

    const lines = ['proxy-providers:']

    for (const p of providers) {
        if (!p.name || !p.url) continue

        const interval = p.interval || 36000
        const healthCheckInterval = p.healthCheckInterval || 36000
        const healthCheckEnable = p.healthCheckEnable !== false
        const proxy = p.proxy || 'DIRECT'
        const type = p.type || 'http'
        const path = p.path ? `    path: ${p.path}\n` : ''

        // 如果开启了 useWorkerProxy 且传入了 proxyBaseUrl，则使用代理链接
        let targetUrl = p.url
        if (p.useWorkerProxy && proxyBaseUrl) {
            targetUrl = `${proxyBaseUrl}${encodeURIComponent(p.name)}`
        }

        lines.push(`  ${p.name}:`)
        lines.push(`    type: ${type}`)
        lines.push(`    interval: ${interval}`)
        if (path) lines.push(path.trimEnd())
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
 * 保证 proxy-providers 插入到 YAML 头部或合理位置
 */
export function assembleFinalYaml(baseYaml, providers, proxyBaseUrl = '') {
    const providersYaml = buildProxyProvidersYaml(providers, proxyBaseUrl)
    if (!providersYaml) {
        return baseYaml
    }

    let cleanBaseYaml = baseYaml.trim()

    // 如果 baseYaml 已经存在 proxy-providers 段落，则移除现有段落再重新注入
    const regex = /^proxy-providers:\s*[\r\n]+(?:(?:\s+.*|[\r\n]+)*)(?=\r?\n[^\s#]|\s*$)/m
    if (regex.test(cleanBaseYaml)) {
        cleanBaseYaml = cleanBaseYaml.replace(regex, '').trim()
    }

    // 拼接在头部
    return `${providersYaml}\n\n${cleanBaseYaml}\n`
}
