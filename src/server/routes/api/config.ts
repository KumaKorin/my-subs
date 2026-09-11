/**
 * 系统配置与 YAML 维护 API 控制器 (/api/config)
 */
import { Hono } from 'hono'
import { AppContext } from '../../types/env.js'
import {
  getGlobalBaseYaml,
  saveGlobalBaseYaml,
  getProvidersPool,
  getProfiles,
  getProvidersByIds,
  getSystemSettings,
  saveSystemSettings,
  warmUpAllToKv
} from '../../services/cache.js'
import { assembleFinalYaml } from '../../services/yaml.js'
import { getPublicOrigin } from '../../utils/http.js'
import { SystemSettings } from '../../types/models.js'

export const configApi = new Hono<AppContext>()

/**
 * 获取全量后台数据 (SPA 初始化)
 */
configApi.get('/data', async (c) => {
  const [globalBaseYaml, providersPool, profiles, settings] = await Promise.all([
    getGlobalBaseYaml(c.env),
    getProvidersPool(c.env),
    getProfiles(c.env),
    getSystemSettings(c.env)
  ])

  // 后台自动异步触发 KV 全量热同步，确保 KV 永远填满 D1 最新数据
  c.executionCtx?.waitUntil(warmUpAllToKv(c.env))

  const publicOrigin = getPublicOrigin(c)
  const prefix = c.get('entrancePrefix') || ''

  return c.json({
    success: true,
    data: {
      globalBaseYaml,
      providersPool,
      profiles,
      settings,
      publicOrigin,
      prefix,
      hasD1: !!c.env.DB
    }
  })
})

/**
 * 手动强制将 D1 数据全量刷入 KV 边缘缓存
 */
configApi.post('/sync-kv', async (c) => {
  const result = await warmUpAllToKv(c.env)
  return c.json({
    success: true,
    message: '已将 D1 数据库全量数据同步预热至 KV 边缘缓存',
    data: result
  })
})

/**
 * 获取与保存系统代理设置
 */
configApi.get('/settings', async (c) => {
  const settings = await getSystemSettings(c.env)
  return c.json({ success: true, data: settings })
})

configApi.post('/settings', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as SystemSettings
  await saveSystemSettings(body, c.env)
  return c.json({ success: true, data: body })
})

/**
 * 测试请求代理连通性
 */
configApi.post('/test-proxy', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { proxyUrlTemplate?: string }
  const template = body.proxyUrlTemplate?.trim()
  if (!template || !template.includes('{url}')) {
    return c.json({ success: false, error: '代理模板必须包含 {url} 占位符' }, 400)
  }

  const testTarget = 'https://httpbin.org/ip'
  const testUrl = template.replace('{url}', encodeURIComponent(testTarget))
  const startTime = Date.now()

  try {
    const res = await fetch(testUrl, {
      headers: { 'User-Agent': 'Clash/1.18.0' }
    })
    const durationMs = Date.now() - startTime
    if (res.ok) {
      return c.json({ success: true, data: { status: res.status, durationMs } })
    } else {
      return c.json({ success: false, error: `代理服务返回状态码: ${res.status}` }, 400)
    }
  } catch (err: any) {
    return c.json({ success: false, error: `代理连接失败: ${err.message || '网络连接异常'}` }, 502)
  }
})

/**
 * 保存全局通用 Base YAML
 */
configApi.post('/global-base-yaml', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { yaml?: string }
  const yaml = body.yaml
  if (typeof yaml !== 'string') {
    return c.json({ success: false, error: 'Invalid YAML content' }, 400)
  }

  await saveGlobalBaseYaml(yaml, c.env)
  return c.json({ success: true })
})

/**
 * 预览当前 Profile 拼接后的最终 Clash YAML
 */
configApi.get('/preview', async (c) => {
  const profileId = c.req.query('profileId')
  const [profiles, settings] = await Promise.all([
    getProfiles(c.env),
    getSystemSettings(c.env)
  ])
  const targetProfile = profiles.find(p => p.id === profileId) || profiles[0]

  if (!targetProfile) {
    return c.json({ success: false, error: 'No profile found' }, 404)
  }

  let baseYaml = ''
  if (targetProfile.useGlobalYaml !== false) {
    baseYaml = await getGlobalBaseYaml(c.env)
  } else {
    baseYaml = targetProfile.customBaseYaml || (await getGlobalBaseYaml(c.env))
  }

  const activeProviders = await getProvidersByIds(targetProfile.enabledProviderIds || [], c.env)
  const publicOrigin = getPublicOrigin(c)
  const prefix = c.get('entrancePrefix') || ''
  const tokenParam = encodeURIComponent(targetProfile.token || '')

  const finalYaml = assembleFinalYaml(baseYaml, activeProviders, {
    customBaseUrl: `${publicOrigin}${prefix}/provider/custom/{id}?token=${tokenParam}`,
    proxyBaseUrl: `${publicOrigin}${prefix}/provider/proxy/{id}?token=${tokenParam}`,
    ghWorkerUrl: `${publicOrigin}${prefix}/gh-proxy?token=${tokenParam}`,
    settings,
    profile: targetProfile
  })

  return c.json({
    success: true,
    data: {
      yaml: finalYaml,
      profileName: targetProfile.name,
      providerCount: activeProviders.length
    },
    yaml: finalYaml,
    profileName: targetProfile.name,
    providerCount: activeProviders.length
  })
})
