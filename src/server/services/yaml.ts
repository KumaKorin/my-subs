import { Profile, Provider, SystemSettings } from '../types/models.js'

export interface YamlBuildOptions {
  customBaseUrl?: string
  proxyBaseUrl?: string
  ghWorkerUrl?: string
  settings?: SystemSettings
  profile?: Profile
}

/**
 * 解析当前 Profile 最终生效的代理配置 (优先使用 Profile 手动配置，否则继承全局系统设置)
 */
export function resolveEffectiveProfileProxy(
  profile?: Profile,
  globalSettings?: SystemSettings
): {
  proxyUrlTemplate: string
  githubProxyMode: 'none' | 'worker' | 'proxy'
} {
  const profileProxy = profile?.settings?.proxySettings
  if (profileProxy && profileProxy.mode === 'custom') {
    return {
      proxyUrlTemplate: profileProxy.proxyUrlTemplate || '',
      githubProxyMode: profileProxy.githubProxyMode || 'none'
    }
  }

  return {
    proxyUrlTemplate: globalSettings?.proxyUrlTemplate || '',
    githubProxyMode: globalSettings?.githubProxyMode || 'none'
  }
}

/**
 * 解析特定 Provider 在特定 Profile 下最终生效的订阅分发模式与请求代理配置
 */
export function resolveEffectiveProviderSettings(
  provider: Provider,
  profile?: Profile
): {
  urlMode: 'direct' | 'proxy' | 'redirect'
  useCustomProxy: boolean
} {
  const override = profile?.settings?.providerOverrides?.[provider.id]

  // 1. urlMode: direct | proxy | redirect
  let urlMode: 'direct' | 'proxy' | 'redirect' = provider.urlMode || 'direct'
  if (override?.urlMode && override.urlMode !== 'default') {
    urlMode = override.urlMode
  }

  // 2. useCustomProxy: boolean
  let useCustomProxy = Boolean(provider.useCustomProxy)
  if (override?.useCustomProxy === 'true') {
    useCustomProxy = true
  } else if (override?.useCustomProxy === 'false') {
    useCustomProxy = false
  }

  return { urlMode, useCustomProxy }
}

/**
 * 将 Provider 实体数组转换为标准 Clash proxy-providers 节点文本
 */
export function buildProxyProvidersYaml(
  providers: Provider[],
  options: YamlBuildOptions = {}
): string {
  if (!providers || providers.length === 0) {
    return ''
  }

  const { customBaseUrl = '', proxyBaseUrl = '', profile } = options
  const lines = ['proxy-providers:']

  for (const p of providers) {
    if (!p.name || p.isDeleted) continue

    const interval = p.interval || 36000
    const healthCheckInterval = p.healthCheckInterval || 36000
    const healthCheckEnable = p.healthCheckEnable !== false
    const proxy = p.proxy || 'DIRECT'
    const type = p.type || 'http'

    // 计算当前 Provider 在该 Profile 下生效的 urlMode
    const { urlMode } = resolveEffectiveProviderSettings(p, profile)

    let targetUrl = p.url
    if (p.providerType === 'custom') {
      if (customBaseUrl) {
        targetUrl = customBaseUrl.includes('{id}')
          ? customBaseUrl.replace('{id}', encodeURIComponent(p.id))
          : `${customBaseUrl}${encodeURIComponent(p.id)}`
      } else {
        targetUrl = ''
      }
    } else if (urlMode === 'proxy' || urlMode === 'redirect') {
      // 隐藏真实订阅 URL (走 Worker 代理中转或 302 防扫描跳转)
      if (proxyBaseUrl) {
        targetUrl = proxyBaseUrl.includes('{id}')
          ? proxyBaseUrl.replace('{id}', encodeURIComponent(p.id))
          : `${proxyBaseUrl}${encodeURIComponent(p.id)}`
      }
    }

    if (!targetUrl) continue

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
 * 转换 Base YAML 中的 GitHub 规则集 URL 实现加速
 */
export function applyGithubProxy(
  yamlContent: string,
  mode: 'none' | 'worker' | 'proxy' = 'none',
  ghWorkerUrl = '',
  proxyUrlTemplate = ''
): string {
  if (!yamlContent || mode === 'none') return yamlContent

  const ghRegex = /https?:\/\/(?:raw\.githubusercontent\.com|github\.com)\/[^\s"'\)]+/g

  if (mode === 'worker' && ghWorkerUrl) {
    return yamlContent.replace(ghRegex, (match) => {
      const sep = ghWorkerUrl.includes('?') ? '&' : '?'
      return `${ghWorkerUrl}${sep}url=${encodeURIComponent(match)}`
    })
  }

  if (mode === 'proxy' && proxyUrlTemplate && proxyUrlTemplate.includes('{url}')) {
    return yamlContent.replace(ghRegex, (match) => {
      return proxyUrlTemplate.replace('{url}', encodeURIComponent(match))
    })
  }

  return yamlContent
}

/**
 * 组装 Base YAML 与 Proxy-Providers 生成最终下发的完整配置
 */
export function assembleFinalYaml(
  baseYaml: string,
  providers: Provider[],
  options: YamlBuildOptions = {}
): string {
  const providersYaml = buildProxyProvidersYaml(providers, options)
  let cleanBaseYaml = (baseYaml || '').trim()

  // 1. 如果启用了 GitHub 规则集加速，处理 Base YAML 中的 GitHub 资源链接 (按 Profile 差分代理计算)
  const effectiveProxy = resolveEffectiveProfileProxy(options.profile, options.settings)
  const ghMode = effectiveProxy.githubProxyMode
  const proxyTemplate = effectiveProxy.proxyUrlTemplate
  cleanBaseYaml = applyGithubProxy(cleanBaseYaml, ghMode, options.ghWorkerUrl, proxyTemplate)

  if (!providersYaml) {
    return cleanBaseYaml
  }

  // 2. 如果 baseYaml 已经存在 proxy-providers 段落，则移除现有旧段落再重新注入
  const regex = /^proxy-providers:\s*[\r\n]+(?:(?:\s+.*|[\r\n]+)*)(?=\r?\n[^\s#]|\s*$)/m
  if (regex.test(cleanBaseYaml)) {
    cleanBaseYaml = cleanBaseYaml.replace(regex, '').trim()
  }

  // 拼接在头部
  return `${providersYaml}\n\n${cleanBaseYaml}\n`
}
