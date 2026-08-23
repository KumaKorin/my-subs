import { encryptAesGcm, decryptAesGcm, generateRandomHexToken } from './crypto.js'
import DEFAULT_TEMPLATE from './default-template.yaml'

// 全局/公共配置 Key
const KEY_GLOBAL_BASE_YAML = 'data:global_base_yaml'
const KEY_PROVIDERS_POOL = 'data:providers_pool_encrypted'
const KEY_PROFILES = 'data:profiles_encrypted'

// 兼容旧版单一配置 Key
const LEGACY_KEY_BASE_YAML = 'data:base_yaml'
const LEGACY_KEY_PROVIDERS = 'data:providers_encrypted'
const LEGACY_KEY_SUB_TOKEN = 'data:sub_token_encrypted'
const LEGACY_KEY_SETTINGS = 'data:settings'

/**
 * 获取全局通用的 Global Base YAML 模板
 */
export async function getGlobalBaseYaml(env) {
    let yaml = await env.SUBS_KV.get(KEY_GLOBAL_BASE_YAML)
    if (!yaml) {
        // 尝试从旧版 Base YAML 迁移
        const legacyYaml = await env.SUBS_KV.get(LEGACY_KEY_BASE_YAML)
        yaml = legacyYaml || DEFAULT_TEMPLATE
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
 * 获取全局 Provider 资源池 (AES 加密)
 * @returns {Promise<Array>} Provider 对象列表 (包含 id, name, type, url, etc.)
 */
export async function getProvidersPool(env) {
    const encrypted = await env.SUBS_KV.get(KEY_PROVIDERS_POOL)
    if (encrypted) {
        try {
            const decryptedJson = await decryptAesGcm(encrypted, env.APP_SECRET)
            const list = JSON.parse(decryptedJson)
            // 确保每个 Provider 都有唯一 random uuid
            let changed = false
            for (const p of list) {
                if (!p.id) {
                    p.id = crypto.randomUUID()
                    changed = true
                }
            }
            if (changed) {
                await saveProvidersPool(list, env)
            }
            return list
        } catch (err) {
            console.error('Failed to decrypt providers pool:', err)
            return []
        }
    }

    // 尝试平滑迁移旧版 providers
    const legacyEncrypted = await env.SUBS_KV.get(LEGACY_KEY_PROVIDERS)
    if (legacyEncrypted) {
        try {
            const decryptedJson = await decryptAesGcm(legacyEncrypted, env.APP_SECRET)
            const legacyList = JSON.parse(decryptedJson)
            const migratedList = legacyList.map(p => ({
                id: p.id || crypto.randomUUID(),
                name: p.name || 'Provider',
                type: p.type || 'http',
                interval: p.interval || 36000,
                healthCheckEnable: p.healthCheckEnable !== false,
                healthCheckInterval: p.healthCheckInterval || 36000,
                proxy: p.proxy || 'DIRECT',
                url: p.url || '',
                useWorkerProxy: !!p.useWorkerProxy,
                path: p.path || ''
            }))
            await saveProvidersPool(migratedList, env)
            return migratedList
        } catch (err) {
            console.error('Failed to migrate legacy providers:', err)
        }
    }

    return []
}

/**
 * 加密并保存全局 Provider 资源池
 */
export async function saveProvidersPool(providersArray, env) {
    const jsonStr = JSON.stringify(providersArray)
    const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET)
    await env.SUBS_KV.put(KEY_PROVIDERS_POOL, encrypted)
}

/**
 * 获取所有 Profile 列表 (AES 加密)
 * @returns {Promise<Array>} Profile 对象列表
 */
export async function getProfiles(env) {
    const encrypted = await env.SUBS_KV.get(KEY_PROFILES)
    if (encrypted) {
        try {
            const decryptedJson = await decryptAesGcm(encrypted, env.APP_SECRET)
            return JSON.parse(decryptedJson)
        } catch (err) {
            console.error('Failed to decrypt profiles:', err)
            return []
        }
    }

    // 若未初始化，尝试迁移旧版数据创建 Default Profile
    const providers = await getProvidersPool(env)
    const legacyTokenEncrypted = await env.SUBS_KV.get(LEGACY_KEY_SUB_TOKEN)
    let token = ''
    if (legacyTokenEncrypted) {
        try {
            token = await decryptAesGcm(legacyTokenEncrypted, env.APP_SECRET)
        } catch {}
    }
    if (!token) {
        token = generateRandomHexToken(32) // 64-char hex
    }

    let legacySettings = { proxyGithub: false, proxyGithubusercontent: false }
    const rawSettings = await env.SUBS_KV.get(LEGACY_KEY_SETTINGS)
    if (rawSettings) {
        try {
            legacySettings = JSON.parse(rawSettings)
        } catch {}
    }

    const defaultProfile = {
        id: crypto.randomUUID(),
        name: '默认配置',
        token,
        useGlobalYaml: true,
        customBaseYaml: '',
        enabledProviderIds: providers.map(p => p.id),
        settings: {
            proxyGithub: !!legacySettings.proxyGithub,
            proxyGithubusercontent: !!legacySettings.proxyGithubusercontent
        },
        createdAt: Date.now()
    }

    const initialProfiles = [defaultProfile]
    await saveProfiles(initialProfiles, env)
    return initialProfiles
}

/**
 * 加密并保存所有 Profile 列表
 */
export async function saveProfiles(profilesArray, env) {
    const jsonStr = JSON.stringify(profilesArray)
    const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET)
    await env.SUBS_KV.put(KEY_PROFILES, encrypted)
}

/**
 * 根据 Token 查找对应的 Profile
 */
export async function getProfileByToken(token, env) {
    if (!token) return null
    const profiles = await getProfiles(env)
    return profiles.find(p => p.token === token) || null
}
