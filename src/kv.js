import { encryptAesGcm, decryptAesGcm } from './crypto.js'
import DEFAULT_TEMPLATE from './default-template.yaml'

const KEY_BASE_YAML = 'data:base_yaml'
const KEY_PROVIDERS = 'data:providers_encrypted'
const KEY_SUB_TOKEN = 'data:sub_token_encrypted'
const KEY_SETTINGS = 'data:settings'

/**
 * 获取分发设置 (GitHub 代理开关等)
 * @returns {Promise<{proxyGithub: boolean, proxyGithubusercontent: boolean}>}
 */
export async function getSettings(env) {
    const raw = await env.SUBS_KV.get(KEY_SETTINGS)
    if (!raw) {
        return { proxyGithub: false, proxyGithubusercontent: false }
    }
    try {
        const parsed = JSON.parse(raw)
        return {
            proxyGithub: !!parsed.proxyGithub,
            proxyGithubusercontent: !!parsed.proxyGithubusercontent
        }
    } catch (err) {
        console.error('Failed to parse settings:', err)
        return { proxyGithub: false, proxyGithubusercontent: false }
    }
}

/**
 * 保存分发设置
 */
export async function saveSettings(settings, env) {
    const clean = {
        proxyGithub: !!settings?.proxyGithub,
        proxyGithubusercontent: !!settings?.proxyGithubusercontent
    }
    await env.SUBS_KV.put(KEY_SETTINGS, JSON.stringify(clean))
}

/**
 * 获取 Base YAML 基础配置
 * 若 KV 中尚未保存过，则使用 src/default-template.yaml 中的默认模板
 */
export async function getBaseYaml(env) {
    const yaml = await env.SUBS_KV.get(KEY_BASE_YAML)
    if (!yaml) {
        return DEFAULT_TEMPLATE
    }
    return yaml
}

/**
 * 保存 Base YAML
 */
export async function saveBaseYaml(yamlString, env) {
    await env.SUBS_KV.put(KEY_BASE_YAML, yamlString)
}

/**
 * 获取并解密 Proxy Providers 列表
 * @returns {Promise<Array>} 返回 provider 对象列表
 */
export async function getProviders(env) {
    const encrypted = await env.SUBS_KV.get(KEY_PROVIDERS)
    if (!encrypted) return []

    try {
        const decryptedJson = await decryptAesGcm(encrypted, env.APP_SECRET)
        return JSON.parse(decryptedJson)
    } catch (err) {
        console.error('Failed to decrypt providers:', err)
        return []
    }
}

/**
 * 加密并保存 Proxy Providers 列表
 */
export async function saveProviders(providersArray, env) {
    const jsonStr = JSON.stringify(providersArray)
    const encrypted = await encryptAesGcm(jsonStr, env.APP_SECRET)
    await env.SUBS_KV.put(KEY_PROVIDERS, encrypted)
}

/**
 * 获取并解密对外订阅 Token
 */
export async function getSubscriptionToken(env) {
    const encrypted = await env.SUBS_KV.get(KEY_SUB_TOKEN)
    if (!encrypted) {
        // 若未初始化，生成默认随机 Token 并保存
        const defaultToken = crypto.randomUUID().replace(/-/g, '')
        await saveSubscriptionToken(defaultToken, env)
        return defaultToken
    }

    try {
        return await decryptAesGcm(encrypted, env.APP_SECRET)
    } catch (err) {
        console.error('Failed to decrypt subscription token:', err)
        return null
    }
}

/**
 * 加密并保存对外订阅 Token
 */
export async function saveSubscriptionToken(token, env) {
    const encrypted = await encryptAesGcm(token, env.APP_SECRET)
    await env.SUBS_KV.put(KEY_SUB_TOKEN, encrypted)
}
