import { encryptAesGcm, decryptAesGcm, generateRandomHexToken } from './crypto.js'
import DEFAULT_TEMPLATE from './default-template.yaml'

// 存储 Key 规范
const KEY_GLOBAL_BASE_YAML = 'data:yaml:global_base'
const KEY_PROVIDER_MAP = 'data:meta:provider:map'
const PREFIX_PROVIDER_ENCRYPTED = 'data:encrypted:provider:'
const KEY_PROFILE_MAP = 'data:meta:profile:map'
const PREFIX_PROFILE = 'data:profile:'
const PREFIX_SUBTOKEN_MAP = 'data:map:subtoken:'

/**
 * 获取全局通用的 Global Base YAML 模板
 */
export async function getGlobalBaseYaml(env) {
    let yaml = await env.SUBS_KV.get(KEY_GLOBAL_BASE_YAML)
    if (!yaml) {
        yaml = DEFAULT_TEMPLATE
        await env.SUBS_KV.put(KEY_GLOBAL_BASE_YAML, yaml)
    }
    return yaml
}

/**
 * 保存全局通用的 Global Base YAML
 */
export async function saveGlobalBaseYaml(yamlString, env) {
    await env.SUBS_KV.put(KEY_GLOBAL_BASE_YAML, yamlString)
}

/**
 * 获取单个 Provider (AES 解密)
 */
export async function getProviderById(id, env) {
    if (!id) return null
    const encrypted = await env.SUBS_KV.get(`${PREFIX_PROVIDER_ENCRYPTED}${id}`)
    if (!encrypted) return null
    try {
        const decryptedJson = await decryptAesGcm(encrypted, env.APP_SECRET)
        const provider = JSON.parse(decryptedJson)
        if (!provider.id) provider.id = id
        return provider
    } catch (err) {
        console.error(`Failed to decrypt provider ${id}:`, err)
        return null
    }
}

/**
 * 加密并保存单个 Provider
 */
export async function saveProvider(provider, env) {
    if (!provider || !provider.id) return
    const jsonStr = JSON.stringify(provider)
    const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET)
    await env.SUBS_KV.put(`${PREFIX_PROVIDER_ENCRYPTED}${provider.id}`, encrypted)
}

/**
 * 删除单个 Provider
 */
export async function deleteProvider(id, env) {
    if (!id) return
    await env.SUBS_KV.delete(`${PREFIX_PROVIDER_ENCRYPTED}${id}`)
}

/**
 * 批量获取指定 IDs 的 Provider 列表 (按 ID 顺序返回有效项)
 */
export async function getProvidersByIds(ids, env) {
    if (!Array.isArray(ids) || ids.length === 0) return []
    const results = await Promise.all(ids.map(id => getProviderById(id, env)))
    return results.filter(Boolean)
}

/**
 * 获取全部 Provider 列表
 */
export async function getProvidersPool(env) {
    const mapRaw = await env.SUBS_KV.get(KEY_PROVIDER_MAP)
    if (!mapRaw) return []
    try {
        const ids = JSON.parse(mapRaw)
        if (Array.isArray(ids)) {
            return await getProvidersByIds(ids, env)
        }
    } catch (err) {
        console.error('Failed to parse provider map:', err)
    }
    return []
}

/**
 * 保存全局 Provider 资源池 (更新 map，加密写入每个 Provider，清理已删除项)
 */
export async function saveProvidersPool(providersArray, env) {
    if (!Array.isArray(providersArray)) return

    // 1. 获取旧的 provider ID 列表用于对比删除
    let oldIds = []
    const mapRaw = await env.SUBS_KV.get(KEY_PROVIDER_MAP)
    if (mapRaw) {
        try {
            oldIds = JSON.parse(mapRaw) || []
        } catch {}
    }

    const newIds = []
    const saveTasks = []

    for (const p of providersArray) {
        if (!p.id) p.id = crypto.randomUUID()
        newIds.push(p.id)
        saveTasks.push(saveProvider(p, env))
    }

    // 2. 找出被删除的 ID 并执行删除
    const newIdSet = new Set(newIds)
    for (const oldId of oldIds) {
        if (!newIdSet.has(oldId)) {
            saveTasks.push(deleteProvider(oldId, env))
        }
    }

    // 3. 并行执行所有写入与删除
    await Promise.all(saveTasks)

    // 4. 更新 ID 映射数组
    await env.SUBS_KV.put(KEY_PROVIDER_MAP, JSON.stringify(newIds))
}

/**
 * 获取单个 Profile (明文 JSON)
 */
export async function getProfileById(id, env) {
    if (!id) return null
    const raw = await env.SUBS_KV.get(`${PREFIX_PROFILE}${id}`)
    if (!raw) return null
    try {
        const profile = JSON.parse(raw)
        if (!profile.id) profile.id = id
        return profile
    } catch (err) {
        console.error(`Failed to parse profile ${id}:`, err)
        return null
    }
}

/**
 * 保存单个 Profile 并维护 subtoken 映射
 */
export async function saveProfile(profile, env, oldToken = null) {
    if (!profile || !profile.id) return
    // 写入明文 Profile JSON
    await env.SUBS_KV.put(`${PREFIX_PROFILE}${profile.id}`, JSON.stringify(profile))

    // 维护 Token 索引
    if (oldToken && oldToken !== profile.token) {
        await env.SUBS_KV.delete(`${PREFIX_SUBTOKEN_MAP}${oldToken}`)
    }
    if (profile.token) {
        await env.SUBS_KV.put(`${PREFIX_SUBTOKEN_MAP}${profile.token}`, profile.id)
    }
}

/**
 * 删除单个 Profile 及对应的 subtoken 映射
 */
export async function deleteProfile(profile, env) {
    if (!profile) return
    const id = typeof profile === 'string' ? profile : profile.id
    const token = typeof profile === 'object' ? profile.token : null

    await env.SUBS_KV.delete(`${PREFIX_PROFILE}${id}`)
    if (token) {
        await env.SUBS_KV.delete(`${PREFIX_SUBTOKEN_MAP}${token}`)
    }
}

/**
 * 获取全部 Profile 列表 (未初始化时自动创建默认 Profile)
 */
export async function getProfiles(env) {
    const mapRaw = await env.SUBS_KV.get(KEY_PROFILE_MAP)
    if (mapRaw) {
        try {
            const ids = JSON.parse(mapRaw)
            if (Array.isArray(ids) && ids.length > 0) {
                const results = await Promise.all(ids.map(id => getProfileById(id, env)))
                const validProfiles = results.filter(Boolean)
                if (validProfiles.length > 0) {
                    return validProfiles
                }
            }
        } catch (err) {
            console.error('Failed to parse profile map:', err)
        }
    }

    // 首次使用，自动初始化默认 Profile
    const providers = await getProvidersPool(env)
    const token = generateRandomHexToken(32) // 64-char hex

    const defaultProfile = {
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
 * 保存所有 Profile 列表
 */
export async function saveProfiles(profilesArray, env) {
    if (!Array.isArray(profilesArray)) return

    // 1. 获取现有 Profiles 以比对旧 Token 和被删除的 Profile
    let oldProfiles = []
    try {
        const oldMapRaw = await env.SUBS_KV.get(KEY_PROFILE_MAP)
        if (oldMapRaw) {
            const oldIds = JSON.parse(oldMapRaw) || []
            const oldList = await Promise.all(oldIds.map(id => getProfileById(id, env)))
            oldProfiles = oldList.filter(Boolean)
        }
    } catch {}

    const oldMap = new Map(oldProfiles.map(p => [p.id, p]))
    const newIds = []
    const tasks = []

    for (const p of profilesArray) {
        if (!p.id) p.id = crypto.randomUUID()
        if (!p.token) p.token = generateRandomHexToken(32)
        if (!Array.isArray(p.enabledProviderIds)) p.enabledProviderIds = []
        if (p.useGlobalYaml === undefined) p.useGlobalYaml = true
        if (typeof p.customBaseYaml !== 'string') p.customBaseYaml = ''
        if (!p.settings || typeof p.settings !== 'object') {
            p.settings = { proxyGithub: false, proxyGithubusercontent: false }
        }

        newIds.push(p.id)
        const oldP = oldMap.get(p.id)
        tasks.push(saveProfile(p, env, oldP ? oldP.token : null))
    }

    // 2. 清理已被删除的 Profile
    const newIdSet = new Set(newIds)
    for (const [oldId, oldP] of oldMap.entries()) {
        if (!newIdSet.has(oldId)) {
            tasks.push(deleteProfile(oldP, env))
        }
    }

    // 3. 并行执行所有写入与删除
    await Promise.all(tasks)

    // 4. 更新 Profile Map
    await env.SUBS_KV.put(KEY_PROFILE_MAP, JSON.stringify(newIds))
}

/**
 * 根据 Token 查找对应的 Profile (O(1) 快速索引，免解密)
 */
export async function getProfileByToken(token, env) {
    if (!token) return null

    // 1. 优先通过 subtoken 索引快速查找
    const profileId = await env.SUBS_KV.get(`${PREFIX_SUBTOKEN_MAP}${token}`)
    if (profileId) {
        const profile = await getProfileById(profileId, env)
        if (profile) return profile
    }

    return null
}
