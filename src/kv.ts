import { encryptAesGcm, decryptAesGcm, generateRandomHexToken } from './utils/crypto.js'
import DEFAULT_TEMPLATE from './default-template.yaml'
import {
    dbGetGlobalBaseYaml,
    dbSaveGlobalBaseYaml,
    dbGetProvidersPool,
    dbGetProviderById,
    dbSaveProvidersPool,
    dbGetProfiles,
    dbGetProfileByToken,
    dbSaveProfiles
} from './db.js'
import { Env, Profile, Provider } from './types/index.js'

// KV 缓存 Key 规范
const KEY_GLOBAL_BASE_YAML = 'data:yaml:global_base'
const KEY_PROVIDER_MAP = 'data:meta:provider:map'
const PREFIX_PROVIDER_ENCRYPTED = 'data:encrypted:provider:'
const KEY_PROFILE_MAP = 'data:meta:profile:map'
const PREFIX_PROFILE = 'data:profile:'
const PREFIX_SUBTOKEN_MAP = 'data:map:subtoken:'

/**
 * 获取全局通用的 Global Base YAML 模板 (D1 主库 + KV 边缘缓存)
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

    // 兜底
    if (env.SUBS_KV) {
        let yaml = await env.SUBS_KV.get(KEY_GLOBAL_BASE_YAML)
        if (!yaml) {
            yaml = DEFAULT_TEMPLATE
            await env.SUBS_KV.put(KEY_GLOBAL_BASE_YAML, yaml)
        }
        return yaml
    }

    return DEFAULT_TEMPLATE
}

/**
 * 保存全局通用的 Global Base YAML (D1 主库 + 刷新 KV 缓存)
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
 * 获取单个 Provider (AES 解密)
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

    // 2. KV 缓存未命中，从 D1 读取并回填缓存
    if (env.DB) {
        const provider = await dbGetProviderById(env.DB, id, env.APP_SECRET || '')
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
 * 加密并保存单个 Provider 到 KV 缓存
 */
export async function saveProvider(provider: Provider, env: Env): Promise<void> {
    if (!provider || !provider.id) return
    if (env.SUBS_KV) {
        const jsonStr = JSON.stringify(provider)
        const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET || '')
        await env.SUBS_KV.put(`${PREFIX_PROVIDER_ENCRYPTED}${provider.id}`, encrypted)
    }
}

/**
 * 删除单个 Provider 缓存
 */
export async function deleteProvider(id: string, env: Env): Promise<void> {
    if (!id) return
    if (env.SUBS_KV) {
        await env.SUBS_KV.delete(`${PREFIX_PROVIDER_ENCRYPTED}${id}`)
    }
}

/**
 * 批量获取指定 IDs 的 Provider 列表
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

/**
 * 保存全局 Provider 资源池 (D1 主库 + 刷新 KV 缓存)
 */
export async function saveProvidersPool(providersArray: Provider[], env: Env): Promise<void> {
    if (!Array.isArray(providersArray)) return

    // 1. 写入 D1 主库
    if (env.DB) {
        await dbSaveProvidersPool(env.DB, providersArray, env.APP_SECRET || '')
    }

    // 2. 同步写入/更新 KV 缓存
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
            if (!p.id) p.id = crypto.randomUUID()
            newIds.push(p.id)
            saveTasks.push(saveProvider(p, env))
        }

        const newIdSet = new Set(newIds)
        for (const oldId of oldIds) {
            if (!newIdSet.has(oldId)) {
                saveTasks.push(deleteProvider(oldId, env))
            }
        }

        await Promise.all(saveTasks)
        await env.SUBS_KV.put(KEY_PROVIDER_MAP, JSON.stringify(newIds))
    }
}

/**
 * 获取单个 Profile (明文 JSON)
 */
export async function getProfileById(id: string, env: Env): Promise<Profile | null> {
    if (!id) return null

    if (env.SUBS_KV) {
        const raw = await env.SUBS_KV.get(`${PREFIX_PROFILE}${id}`)
        if (raw) {
            try {
                const profile: Profile = JSON.parse(raw)
                if (!profile.id) profile.id = id
                return profile
            } catch (err) {}
        }
    }

    if (env.DB) {
        const profiles = await dbGetProfiles(env.DB)
        const profile = profiles.find(p => p.id === id)
        if (profile && env.SUBS_KV) {
            await env.SUBS_KV.put(`${PREFIX_PROFILE}${profile.id}`, JSON.stringify(profile))
        }
        return profile || null
    }

    return null
}

/**
 * 保存单个 Profile 并维护 subtoken 映射
 */
export async function saveProfile(profile: Profile, env: Env, oldToken: string | null = null): Promise<void> {
    if (!profile || !profile.id) return
    if (env.SUBS_KV) {
        await env.SUBS_KV.put(`${PREFIX_PROFILE}${profile.id}`, JSON.stringify(profile))

        if (oldToken && oldToken !== profile.token) {
            await env.SUBS_KV.delete(`${PREFIX_SUBTOKEN_MAP}${oldToken}`)
        }
        if (profile.token) {
            await env.SUBS_KV.put(`${PREFIX_SUBTOKEN_MAP}${profile.token}`, profile.id)
        }
    }
}

/**
 * 删除单个 Profile 及对应的 subtoken 映射
 */
export async function deleteProfile(profile: Profile | string, env: Env): Promise<void> {
    if (!profile) return
    const id = typeof profile === 'string' ? profile : profile.id
    const token = typeof profile === 'object' ? profile.token : null

    if (env.SUBS_KV) {
        await env.SUBS_KV.delete(`${PREFIX_PROFILE}${id}`)
        if (token) {
            await env.SUBS_KV.delete(`${PREFIX_SUBTOKEN_MAP}${token}`)
        }
    }
}

/**
 * 获取全部 Profile 列表 (未初始化时自动创建默认 Profile)
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
                    const results = await Promise.all(ids.map((id: string) => getProfileById(id, env)))
                    const validProfiles = results.filter((p): p is Profile => p !== null)
                    if (validProfiles.length > 0) {
                        return validProfiles
                    }
                }
            } catch (err) {
                console.error('Failed to parse profile map:', err)
            }
        }
    }

    // 首次使用，自动初始化默认 Profile
    const providers = await getProvidersPool(env)
    const token = generateRandomHexToken(32)

    const defaultProfile: Profile = {
        id: crypto.randomUUID(),
        name: '默认配置',
        token,
        useGlobalYaml: true,
        customBaseYaml: '',
        enabledProviderIds: providers.map(p => p.id),
        settings: {
            proxyGithub: false,
            proxyGithubusercontent: false
        },
        createdAt: Date.now()
    }

    const initialProfiles = [defaultProfile]
    await saveProfiles(initialProfiles, env)
    return initialProfiles
}

/**
 * 保存所有 Profile 列表 (D1 主库 + 刷新 KV 缓存)
 */
export async function saveProfiles(profilesArray: Profile[], env: Env): Promise<void> {
    if (!Array.isArray(profilesArray)) return

    // 1. 规范化
    for (const p of profilesArray) {
        if (!p.id) p.id = crypto.randomUUID()
        if (!p.token) p.token = generateRandomHexToken(32)
        if (!Array.isArray(p.enabledProviderIds)) p.enabledProviderIds = []
        if (p.useGlobalYaml === undefined) p.useGlobalYaml = true
        if (typeof p.customBaseYaml !== 'string') p.customBaseYaml = ''
        if (!p.settings || typeof p.settings !== 'object') {
            p.settings = { proxyGithub: false, proxyGithubusercontent: false }
        }
    }

    // 2. 写入 D1 主库
    if (env.DB) {
        await dbSaveProfiles(env.DB, profilesArray)
    }

    // 3. 同步更新 KV 缓存
    if (env.SUBS_KV) {
        let oldProfiles: Profile[] = []
        try {
            const oldMapRaw = await env.SUBS_KV.get(KEY_PROFILE_MAP)
            if (oldMapRaw) {
                const oldIds = JSON.parse(oldMapRaw) || []
                const oldList = await Promise.all(oldIds.map((id: string) => getProfileById(id, env)))
                oldProfiles = oldList.filter((p): p is Profile => p !== null)
            }
        } catch {}

        const oldMap = new Map(oldProfiles.map(p => [p.id, p]))
        const newIds: string[] = []
        const tasks: Promise<void>[] = []

        for (const p of profilesArray) {
            newIds.push(p.id)
            const oldP = oldMap.get(p.id)
            tasks.push(saveProfile(p, env, oldP ? oldP.token : null))
        }

        const newIdSet = new Set(newIds)
        for (const [oldId, oldP] of oldMap.entries()) {
            if (!newIdSet.has(oldId)) {
                tasks.push(deleteProfile(oldP, env))
            }
        }

        await Promise.all(tasks)
        await env.SUBS_KV.put(KEY_PROFILE_MAP, JSON.stringify(newIds))
    }
}

/**
 * 根据 Token 查找对应的 Profile (O(1) 快速索引，免解密)
 */
export async function getProfileByToken(token: string, env: Env): Promise<Profile | null> {
    if (!token) return null

    // 1. 优先通过 KV subtoken 缓存索引极速查找
    if (env.SUBS_KV) {
        const profileId = await env.SUBS_KV.get(`${PREFIX_SUBTOKEN_MAP}${token}`)
        if (profileId) {
            const profile = await getProfileById(profileId, env)
            if (profile) return profile
        }
    }

    // 2. D1 数据库查询
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
