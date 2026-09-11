/**
 * KV 边缘极速缓存与 D1 同步服务
 * 核心设计：KV 绝对优先读取 (分摊 99.9% 读流量与数据库并发)，D1 兜底与主持久化，双向主动回填
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
export const KEY_GLOBAL_BASE_YAML = 'data:yaml:global_base'
export const KEY_SYSTEM_SETTINGS = 'data:settings:system'
export const KEY_PROVIDER_MAP = 'data:meta:provider:map'
export const PREFIX_PROVIDER_ENCRYPTED = 'data:encrypted:provider:'
export const KEY_PROFILE_MAP = 'data:meta:profile:map'
export const PREFIX_PROFILE = 'data:profile:'
export const PREFIX_SUBTOKEN_MAP = 'data:map:subtoken:'
export const KEY_SUB_CACHE_VERSION = 'data:sub:cache_version'
export const PREFIX_SUB_YAML = 'data:cache:sub:'

/**
 * 健壮获取 KVNamespace (同时兼容 SUBS_KV 与 wrangler.toml 中自定义的 my_subs 命名)
 */
export function getKv(env: Env): KVNamespace | undefined {
  return env.SUBS_KV || (env as any).my_subs
}

/**
 * 1. 全局系统设置缓存
 */
export async function getSystemSettings(env: Env): Promise<SystemSettings> {
  const kv = getKv(env)
  if (kv) {
    const cached = await kv.get(KEY_SYSTEM_SETTINGS)
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch {}
    }
  }

  if (env.DB) {
    const settings = await dbGetSystemSettings(env.DB)
    if (settings && Object.keys(settings).length > 0) {
      if (kv) {
        await kv.put(KEY_SYSTEM_SETTINGS, JSON.stringify(settings))
      }
      return settings
    }
  }

  return {}
}

export async function saveSystemSettings(settings: SystemSettings, env: Env): Promise<void> {
  const kv = getKv(env)
  if (env.DB) {
    await dbSaveSystemSettings(env.DB, settings)
  }
  if (kv) {
    await kv.put(KEY_SYSTEM_SETTINGS, JSON.stringify(settings))
    await invalidateSubCache(env)
  }
}

/**
 * 2. 全局通用 Base YAML 缓存
 */
export async function getGlobalBaseYaml(env: Env): Promise<string> {
  const kv = getKv(env)
  if (kv) {
    const cached = await kv.get(KEY_GLOBAL_BASE_YAML)
    if (cached) return cached
  }

  if (env.DB) {
    const yaml = await dbGetGlobalBaseYaml(env.DB)
    if (yaml) {
      if (kv) {
        await kv.put(KEY_GLOBAL_BASE_YAML, yaml)
      }
      return yaml
    }
  }

  // 兜底使用默认模版
  if (kv) {
    await kv.put(KEY_GLOBAL_BASE_YAML, DEFAULT_TEMPLATE)
  }
  return DEFAULT_TEMPLATE
}

export async function saveGlobalBaseYaml(yamlString: string, env: Env): Promise<void> {
  const kv = getKv(env)
  if (env.DB) {
    await dbSaveGlobalBaseYaml(env.DB, yamlString)
  }
  if (kv) {
    await kv.put(KEY_GLOBAL_BASE_YAML, yamlString)
    await invalidateSubCache(env)
  }
}

/**
 * 3. Provider 缓存与读取 (KV 绝对优先，回填 D1)
 */
export async function getProviderById(id: string, env: Env): Promise<Provider | null> {
  if (!id) return null
  const kv = getKv(env)

  // 1. 优先从 KV 缓存获取
  if (kv) {
    const encrypted = await kv.get(`${PREFIX_PROVIDER_ENCRYPTED}${id}`)
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
    if (provider && kv) {
      try {
        const jsonStr = JSON.stringify(provider)
        const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET || '')
        await kv.put(`${PREFIX_PROVIDER_ENCRYPTED}${provider.id}`, encrypted)
      } catch {}
    }
    return provider
  }

  return null
}

export async function getProvidersByIds(ids: string[], env: Env): Promise<Provider[]> {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const results = await Promise.all(ids.map(id => getProviderById(id, env)))
  return results.filter((p): p is Provider => p !== null)
}

/**
 * 获取全部 Provider 列表 (KV 优先读取，大幅降低 D1 读压力)
 */
export async function getProvidersPool(env: Env): Promise<Provider[]> {
  const kv = getKv(env)

  // 1. 优先从 KV 缓存读取
  if (kv) {
    const mapRaw = await kv.get(KEY_PROVIDER_MAP)
    if (mapRaw) {
      try {
        const ids = JSON.parse(mapRaw)
        if (Array.isArray(ids) && ids.length > 0) {
          const cachedList = await getProvidersByIds(ids, env)
          if (cachedList.length === ids.length) {
            return cachedList
          }
        }
      } catch (err) {
        console.error('Failed to parse provider map:', err)
      }
    }
  }

  // 2. KV 未命中时，从 D1 读取并全量回填 KV
  if (env.DB) {
    const list = await dbGetProvidersPool(env.DB, env.APP_SECRET || '')
    if (list && list.length > 0) {
      if (kv) {
        await syncProvidersPoolToKv(list, env)
      }
      return list
    }
  }

  return []
}

/**
 * 将 Provider 资源池全量同步至 KV
 */
export async function syncProvidersPoolToKv(providersArray: Provider[], env: Env): Promise<void> {
  const kv = getKv(env)
  if (!kv || !Array.isArray(providersArray)) return

  const ids: string[] = []
  const tasks: Promise<void>[] = []

  for (const p of providersArray) {
    if (!p.id) continue
    ids.push(p.id)
    const jsonStr = JSON.stringify(p)
    const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET || '')
    tasks.push(kv.put(`${PREFIX_PROVIDER_ENCRYPTED}${p.id}`, encrypted))
  }

  tasks.push(kv.put(KEY_PROVIDER_MAP, JSON.stringify(ids)))
  await Promise.all(tasks)
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  // 2. 级联同步 Profile
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

  // 3. 写入 D1 主库
  if (env.DB) {
    await dbSaveProvidersPool(env.DB, providersArray, env.APP_SECRET || '')
  }

  // 4. 写入 KV 边缘缓存
  const kv = getKv(env)
  if (kv) {
    let oldIds: string[] = []
    const mapRaw = await kv.get(KEY_PROVIDER_MAP)
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
      saveTasks.push(kv.put(`${PREFIX_PROVIDER_ENCRYPTED}${p.id}`, encrypted))
    }

    const newIdSet = new Set(newIds)
    for (const oldId of oldIds) {
      if (!newIdSet.has(oldId)) {
        saveTasks.push(kv.delete(`${PREFIX_PROVIDER_ENCRYPTED}${oldId}`))
      }
    }

    saveTasks.push(kv.put(KEY_PROVIDER_MAP, JSON.stringify(newIds)))
    await Promise.all(saveTasks)
    await invalidateSubCache(env)
  }
}

/**
 * 4. Profile 缓存与读取 (KV 绝对优先)
 */
export async function getProfiles(env: Env): Promise<Profile[]> {
  const kv = getKv(env)

  // 1. 优先从 KV 缓存获取
  if (kv) {
    const mapRaw = await kv.get(KEY_PROFILE_MAP)
    if (mapRaw) {
      try {
        const ids = JSON.parse(mapRaw)
        if (Array.isArray(ids) && ids.length > 0) {
          const results = await Promise.all(
            ids.map(async (id: string) => {
              const raw = await kv.get(`${PREFIX_PROFILE}${id}`)
              return raw ? (JSON.parse(raw) as Profile) : null
            })
          )
          const valid = results.filter((p): p is Profile => p !== null)
          if (valid.length === ids.length) {
            return valid
          }
        }
      } catch (err) {
        console.error('Failed to parse profile map:', err)
      }
    }
  }

  // 2. 从 D1 读取并全量回填 KV
  if (env.DB) {
    const profiles = await dbGetProfiles(env.DB)
    if (profiles && profiles.length > 0) {
      if (kv) {
        await syncProfilesToKv(profiles, env)
      }
      return profiles
    }
  }

  const defaultProfile: Profile = {
    id: crypto.randomUUID(),
    name: '默认订阅配置',
    token: generateRandomHexToken(32),
    useGlobalYaml: true,
    customBaseYaml: '',
    enabledProviderIds: []
  }

  const initialProfiles = [defaultProfile]
  await saveProfiles(initialProfiles, env)
  return initialProfiles
}

/**
 * 将 Profile 列表全量同步至 KV
 */
export async function syncProfilesToKv(profilesArray: Profile[], env: Env): Promise<void> {
  const kv = getKv(env)
  if (!kv || !Array.isArray(profilesArray)) return

  const ids: string[] = []
  const tasks: Promise<void>[] = []

  for (const p of profilesArray) {
    if (!p.id) continue
    ids.push(p.id)
    tasks.push(kv.put(`${PREFIX_PROFILE}${p.id}`, JSON.stringify(p)))
    if (p.token) {
      tasks.push(kv.put(`${PREFIX_SUBTOKEN_MAP}${p.token}`, p.id))
    }
  }

  tasks.push(kv.put(KEY_PROFILE_MAP, JSON.stringify(ids)))
  await Promise.all(tasks)
}

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

  const kv = getKv(env)
  if (kv) {
    let oldProfiles: Profile[] = []
    try {
      const oldMapRaw = await kv.get(KEY_PROFILE_MAP)
      if (oldMapRaw) {
        const oldIds = JSON.parse(oldMapRaw) || []
        const oldList = await Promise.all(
          oldIds.map(async (id: string) => {
            const raw = await kv.get(`${PREFIX_PROFILE}${id}`)
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
      tasks.push(kv.put(`${PREFIX_PROFILE}${p.id}`, JSON.stringify(p)))
      if (p.token) {
        tasks.push(kv.put(`${PREFIX_SUBTOKEN_MAP}${p.token}`, p.id))
      }
    }

    const newIdSet = new Set(newIds)
    for (const [oldId, oldP] of oldMap.entries()) {
      if (!newIdSet.has(oldId)) {
        tasks.push(kv.delete(`${PREFIX_PROFILE}${oldId}`))
        if (oldP.token) {
          tasks.push(kv.delete(`${PREFIX_SUBTOKEN_MAP}${oldP.token}`))
        }
      }
    }

    tasks.push(kv.put(KEY_PROFILE_MAP, JSON.stringify(newIds)))
    await Promise.all(tasks)
    await invalidateSubCache(env)
  }
}

/**
 * 根据 Token 查找 Profile (O(1) 极速索引，完全由 KV 承载，0 DB 读)
 */
export async function getProfileByToken(token: string, env: Env): Promise<Profile | null> {
  if (!token) return null
  const kv = getKv(env)

  // 1. 优先通过 KV 索引查找 (极速无锁)
  if (kv) {
    const profileId = await kv.get(`${PREFIX_SUBTOKEN_MAP}${token}`)
    if (profileId) {
      const raw = await kv.get(`${PREFIX_PROFILE}${profileId}`)
      if (raw) {
        try {
          return JSON.parse(raw) as Profile
        } catch {}
      }
    }
  }

  // 2. KV 未命中时，D1 查询并回填 KV
  if (env.DB) {
    const profile = await dbGetProfileByToken(env.DB, token)
    if (profile) {
      if (kv) {
        await kv.put(`${PREFIX_SUBTOKEN_MAP}${token}`, profile.id)
        await kv.put(`${PREFIX_PROFILE}${profile.id}`, JSON.stringify(profile))
      }
      return profile
    }
  }

  return null
}

/**
 * 5. /sub 组装产物极速缓存 (Compiled Clash YAML Edge Cache)
 * 客户端频繁轮询拉取时，直接从边缘 KV 秒级返回完整 YAML，避免重复耗费 CPU 拼接与数据库读取
 */
export async function getSubCachedYaml(token: string, env: Env): Promise<string | null> {
  const kv = getKv(env)
  if (!kv || !token) return null
  try {
    const version = (await kv.get(KEY_SUB_CACHE_VERSION)) || '1'
    return await kv.get(`${PREFIX_SUB_YAML}${token}:${version}`)
  } catch {
    return null
  }
}

export async function setSubCachedYaml(token: string, yaml: string, env: Env): Promise<void> {
  const kv = getKv(env)
  if (!kv || !token || !yaml) return
  try {
    const version = (await kv.get(KEY_SUB_CACHE_VERSION)) || '1'
    // 缓存 1 小时，足够应对高频客户端拉取，同时配置修改时立刻失效
    await kv.put(`${PREFIX_SUB_YAML}${token}:${version}`, yaml, { expirationTtl: 3600 })
  } catch {}
}

export async function invalidateSubCache(env: Env): Promise<void> {
  const kv = getKv(env)
  if (!kv) return
  try {
    // 改变缓存版本号，使得所有已有分发缓存瞬间失效，0 额外删除操作
    await kv.put(KEY_SUB_CACHE_VERSION, String(Date.now()))
  } catch {}
}

/**
 * 6. 全量预热/同步 D1 数据至 KV (彻底激活 KV 分流)
 */
export async function warmUpAllToKv(env: Env): Promise<{
  providersCount: number
  profilesCount: number
}> {
  const kv = getKv(env)
  if (!kv || !env.DB) return { providersCount: 0, profilesCount: 0 }

  const [settings, yaml, providers, profiles] = await Promise.all([
    dbGetSystemSettings(env.DB),
    dbGetGlobalBaseYaml(env.DB),
    dbGetProvidersPool(env.DB, env.APP_SECRET || ''),
    dbGetProfiles(env.DB)
  ])

  const tasks: Promise<void>[] = []

  if (settings && Object.keys(settings).length > 0) {
    tasks.push(kv.put(KEY_SYSTEM_SETTINGS, JSON.stringify(settings)))
  }

  if (yaml) {
    tasks.push(kv.put(KEY_GLOBAL_BASE_YAML, yaml))
  }

  if (providers && providers.length > 0) {
    tasks.push(syncProvidersPoolToKv(providers, env))
  }

  if (profiles && profiles.length > 0) {
    tasks.push(syncProfilesToKv(profiles, env))
  }

  tasks.push(invalidateSubCache(env))

  await Promise.all(tasks)

  return {
    providersCount: providers?.length || 0,
    profilesCount: profiles?.length || 0
  }
}
