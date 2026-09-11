/**
 * KV 边缘极速缓存与 D1 同步服务
 */
import { encryptAesGcm, decryptAesGcm, generateRandomHexToken } from './crypto.js'
import { DEFAULT_TEMPLATE } from '../constants/default-template.js'
import {
  dbGetGlobalBaseYaml,
  dbSaveGlobalBaseYaml,
  dbGetProvidersPool,
  dbGetProvidersByIds,
  dbSaveProvidersPool,
  dbGetProfiles,
  dbGetProfileByToken,
  dbSaveProfiles,
  dbGetSystemSettings,
  dbSaveSystemSettings
} from '../db/queries.js'
import { Env } from '../types/env.js'
import { Profile, Provider, SystemSettings } from '../types/models.js'

// KV 缓存 Key 规范定义
const KEY_GLOBAL_BASE_YAML = 'data:yaml:global_base'
const KEY_SYSTEM_SETTINGS = 'data:settings:system'
const KEY_PROVIDER_MAP = 'data:meta:provider:map'
const PREFIX_PROVIDER_ENCRYPTED = 'data:encrypted:provider:'
const KEY_PROFILE_MAP = 'data:meta:profile:map'
const PREFIX_PROFILE = 'data:profile:'
const PREFIX_SUBTOKEN_MAP = 'data:map:subtoken:'

/**
 * 获取全局系统设置 (代理配置、GitHub加速等)
 */
export async function getSystemSettings(env: Env): Promise<SystemSettings> {
  if (env.SUBS_KV) {
    const cached = await env.SUBS_KV.get(KEY_SYSTEM_SETTINGS)
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch {}
    }
  }

  if (env.DB) {
    const settings = await dbGetSystemSettings(env.DB)
    if (settings && Object.keys(settings).length > 0) {
      if (env.SUBS_KV) {
        await env.SUBS_KV.put(KEY_SYSTEM_SETTINGS, JSON.stringify(settings))
      }
      return settings
    }
  }

  return {}
}

/**
 * 保存全局系统设置并刷新 KV 缓存
 */
export async function saveSystemSettings(settings: SystemSettings, env: Env): Promise<void> {
  if (env.DB) {
    await dbSaveSystemSettings(env.DB, settings)
  }
  if (env.SUBS_KV) {
    await env.SUBS_KV.put(KEY_SYSTEM_SETTINGS, JSON.stringify(settings))
  }
}

/**
 * 获取全局通用的 Base YAML (D1 主库 + KV 边缘缓存)
 */
export async function getGlobalBaseYaml(env: Env): Promise<string> {
  if (env.SUBS_KV) {
    const cached = await env.SUBS_KV.get(KEY_GLOBAL_BASE_YAML)
    if (cached) return cached
  }

  if (env.DB) {
    const yaml = await dbGetGlobalBaseYaml(env.DB)
    if (yaml) {
      if (env.SUBS_KV) {
        await env.SUBS_KV.put(KEY_GLOBAL_BASE_YAML, yaml)
      }
      return yaml
    }
  }

  // 兜底使用默认模版
  if (env.SUBS_KV) {
    await env.SUBS_KV.put(KEY_GLOBAL_BASE_YAML, DEFAULT_TEMPLATE)
  }
  return DEFAULT_TEMPLATE
}

/**
 * 保存全局 Base YAML 并刷新 KV 缓存
 */
export async function saveGlobalBaseYaml(yamlString: string, env: Env): Promise<void> {
  if (env.DB) {
    await dbSaveGlobalBaseYaml(env.DB, yamlString)
  }
  if (env.SUBS_KV) {
    await env.SUBS_KV.put(KEY_GLOBAL_BASE_YAML, yamlString)
  }
}

/**
 * 获取单个 Provider
 */
export async function getProviderById(id: string, env: Env): Promise<Provider | null> {
  if (!id) return null

  // 1. 优先从 KV 缓存获取
  if (env.SUBS_KV) {
    const encrypted = await env.SUBS_KV.get(`${PREFIX_PROVIDER_ENCRYPTED}${id}`)
    if (encrypted) {
      try {
        const decryptedJson = await decryptAesGcm(encrypted, env.APP_SECRET || '')
        const provider: Provider = JSON.parse(decryptedJson)
        if (!provider.id) provider.id = id
        return provider
      } catch (err) {
        console.error(`Failed to decrypt cached provider ${id}:`, err)
      }
    }
  }

  // 2. 从 D1 读取并回填缓存
  if (env.DB) {
    const list = await dbGetProvidersByIds(env.DB, [id], env.APP_SECRET || '')
    const provider = list[0] || null
    if (provider && env.SUBS_KV) {
      try {
        const jsonStr = JSON.stringify(provider)
        const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET || '')
        await env.SUBS_KV.put(`${PREFIX_PROVIDER_ENCRYPTED}${provider.id}`, encrypted)
      } catch {}
    }
    return provider
  }

  return null
}

/**
 * 批量获取 Providers
 */
export async function getProvidersByIds(ids: string[], env: Env): Promise<Provider[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const results = await Promise.all(ids.map(id => getProviderById(id, env)))
  return results.filter((p): p is Provider => p !== null)
}

/**
 * 获取全部 Provider 列表
 */
export async function getProvidersPool(env: Env): Promise<Provider[]> {
  if (env.DB) {
    const list = await dbGetProvidersPool(env.DB, env.APP_SECRET || '')
    if (list && list.length > 0) {
      return list
    }
  }

  if (env.SUBS_KV) {
    const mapRaw = await env.SUBS_KV.get(KEY_PROVIDER_MAP)
    if (mapRaw) {
      try {
        const ids = JSON.parse(mapRaw)
        if (Array.isArray(ids)) {
          return await getProvidersByIds(ids, env)
        }
      } catch (err) {
        console.error('Failed to parse provider map:', err)
      }
    }
  }

  return []
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 保存 Provider 资源池 (统一强制 UUID 规范)
 */
export async function saveProvidersPool(providersArray: Provider[], env: Env): Promise<void> {
  if (!Array.isArray(providersArray)) return

  // 1. 统一确保所有 provider id 均为标准 UUID
  const idMigrationMap = new Map<string, string>()
  for (const p of providersArray) {
    if (!p.id || !UUID_REGEX.test(p.id)) {
      const oldId = p.id
      p.id = crypto.randomUUID()
      if (oldId) {
        idMigrationMap.set(oldId, p.id)
      }
    }
  }

  // 2. 如果存在非 UUID 格式的 ID 被更新，级联更新 profiles 中的引用映射
  if (idMigrationMap.size > 0) {
    try {
      const profiles = await getProfiles(env)
      let profileUpdated = false
      for (const prof of profiles) {
        if (Array.isArray(prof.enabledProviderIds)) {
          let changed = false
          const newIds = prof.enabledProviderIds.map(id => {
            if (idMigrationMap.has(id)) {
              changed = true
              return idMigrationMap.get(id)!
            }
            return id
          })
          if (changed) {
            prof.enabledProviderIds = newIds
            profileUpdated = true
          }
        }
        if (prof.settings?.providerOverrides) {
          for (const [oldId, newId] of idMigrationMap.entries()) {
            if (prof.settings.providerOverrides[oldId]) {
              prof.settings.providerOverrides[newId] = prof.settings.providerOverrides[oldId]
              delete prof.settings.providerOverrides[oldId]
              profileUpdated = true
            }
          }
        }
      }
      if (profileUpdated) {
        await saveProfiles(profiles, env)
      }
    } catch (e) {
      console.warn('Failed to cascade migrate provider IDs in profiles:', e)
    }
  }

  // 3. 写入 D1
  if (env.DB) {
    await dbSaveProvidersPool(env.DB, providersArray, env.APP_SECRET || '')
  }

  // 4. 刷新 KV 缓存
  if (env.SUBS_KV) {
    let oldIds: string[] = []
    const mapRaw = await env.SUBS_KV.get(KEY_PROVIDER_MAP)
    if (mapRaw) {
      try {
        oldIds = JSON.parse(mapRaw) || []
      } catch {}
    }

    const newIds: string[] = []
    const saveTasks: Promise<void>[] = []

    for (const p of providersArray) {
      newIds.push(p.id)

      const jsonStr = JSON.stringify(p)
      const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET || '')
      saveTasks.push(env.SUBS_KV.put(`${PREFIX_PROVIDER_ENCRYPTED}${p.id}`, encrypted))
    }

    const newIdSet = new Set(newIds)
    for (const oldId of oldIds) {
      if (!newIdSet.has(oldId)) {
        saveTasks.push(env.SUBS_KV.delete(`${PREFIX_PROVIDER_ENCRYPTED}${oldId}`))
      }
    }

    await Promise.all(saveTasks)
    await env.SUBS_KV.put(KEY_PROVIDER_MAP, JSON.stringify(newIds))
  }
}

/**
 * 获取全部 Profile 列表
 */
export async function getProfiles(env: Env): Promise<Profile[]> {
  if (env.DB) {
    const profiles = await dbGetProfiles(env.DB)
    if (profiles && profiles.length > 0) {
      return profiles
    }
  }

  if (env.SUBS_KV) {
    const mapRaw = await env.SUBS_KV.get(KEY_PROFILE_MAP)
    if (mapRaw) {
      try {
        const ids = JSON.parse(mapRaw)
        if (Array.isArray(ids) && ids.length > 0) {
          const results = await Promise.all(
            ids.map(async (id: string) => {
              const raw = await env.SUBS_KV.get(`${PREFIX_PROFILE}${id}`)
              return raw ? (JSON.parse(raw) as Profile) : null
            })
          )
          const valid = results.filter((p): p is Profile => p !== null)
          if (valid.length > 0) return valid
        }
      } catch (err) {
        console.error('Failed to parse profile map:', err)
      }
    }
  }

  // 首次运行，自动初始化默认 Profile
  const providers = await getProvidersPool(env)
  const defaultProfile: Profile = {
    id: crypto.randomUUID(),
    name: '默认配置',
    token: generateRandomHexToken(32),
    useGlobalYaml: true,
    customBaseYaml: '',
    enabledProviderIds: providers.map(p => p.id),
    settings: {},
    createdAt: Date.now()
  }

  const initialProfiles = [defaultProfile]
  await saveProfiles(initialProfiles, env)
  return initialProfiles
}

/**
 * 保存全部 Profile 列表
 */
export async function saveProfiles(profilesArray: Profile[], env: Env): Promise<void> {
  if (!Array.isArray(profilesArray)) return

  for (const p of profilesArray) {
    if (!p.id) p.id = crypto.randomUUID()
    if (!p.token) p.token = generateRandomHexToken(32)
    if (!Array.isArray(p.enabledProviderIds)) p.enabledProviderIds = []
    if (p.useGlobalYaml === undefined) p.useGlobalYaml = true
    if (typeof p.customBaseYaml !== 'string') p.customBaseYaml = ''
    if (!p.settings || typeof p.settings !== 'object') p.settings = {}
  }

  if (env.DB) {
    await dbSaveProfiles(env.DB, profilesArray)
  }

  if (env.SUBS_KV) {
    let oldProfiles: Profile[] = []
    try {
      const oldMapRaw = await env.SUBS_KV.get(KEY_PROFILE_MAP)
      if (oldMapRaw) {
        const oldIds = JSON.parse(oldMapRaw) || []
        const oldList = await Promise.all(
          oldIds.map(async (id: string) => {
            const raw = await env.SUBS_KV.get(`${PREFIX_PROFILE}${id}`)
            return raw ? (JSON.parse(raw) as Profile) : null
          })
        )
        oldProfiles = oldList.filter((p): p is Profile => p !== null)
      }
    } catch {}

    const oldMap = new Map(oldProfiles.map(p => [p.id, p]))
    const newIds: string[] = []
    const tasks: Promise<void>[] = []

    for (const p of profilesArray) {
      newIds.push(p.id)
      tasks.push(env.SUBS_KV.put(`${PREFIX_PROFILE}${p.id}`, JSON.stringify(p)))
      if (p.token) {
        tasks.push(env.SUBS_KV.put(`${PREFIX_SUBTOKEN_MAP}${p.token}`, p.id))
      }
    }

    const newIdSet = new Set(newIds)
    for (const [oldId, oldP] of oldMap.entries()) {
      if (!newIdSet.has(oldId)) {
        tasks.push(env.SUBS_KV.delete(`${PREFIX_PROFILE}${oldId}`))
        if (oldP.token) {
          tasks.push(env.SUBS_KV.delete(`${PREFIX_SUBTOKEN_MAP}${oldP.token}`))
        }
      }
    }

    await Promise.all(tasks)
    await env.SUBS_KV.put(KEY_PROFILE_MAP, JSON.stringify(newIds))
  }
}

/**
 * 根据 Token 查找 Profile (O(1) 极速索引)
 */
export async function getProfileByToken(token: string, env: Env): Promise<Profile | null> {
  if (!token) return null

  // 1. 优先通过 KV 索引查找
  if (env.SUBS_KV) {
    const profileId = await env.SUBS_KV.get(`${PREFIX_SUBTOKEN_MAP}${token}`)
    if (profileId) {
      const raw = await env.SUBS_KV.get(`${PREFIX_PROFILE}${profileId}`)
      if (raw) {
        try {
          return JSON.parse(raw) as Profile
        } catch {}
      }
    }
  }

  // 2. D1 查询
  if (env.DB) {
    const profile = await dbGetProfileByToken(env.DB, token)
    if (profile) {
      if (env.SUBS_KV) {
        await env.SUBS_KV.put(`${PREFIX_SUBTOKEN_MAP}${token}`, profile.id)
        await env.SUBS_KV.put(`${PREFIX_PROFILE}${profile.id}`, JSON.stringify(profile))
      }
      return profile
    }
  }

  return null
}
