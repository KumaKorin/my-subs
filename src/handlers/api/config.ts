/**
 * 订阅配置与 YAML 维护 API 控制器
 */
import {
    getGlobalBaseYaml,
    saveGlobalBaseYaml,
    getProvidersPool,
    saveProvidersPool,
    getProfiles,
    saveProfiles,
    getProvidersByIds
} from '../../kv.js'
import { assembleFinalYaml, rewriteGithubUrls } from '../../yaml.js'
import { jsonResponse, getPublicOrigin } from '../../utils/http.js'
import { Env, Profile, Provider } from '../../types/index.js'

export async function handleConfigApi(
    pathname: string,
    request: Request,
    env: Env,
    url: URL,
    prefix: string
): Promise<Response | null> {
    const currentOrigin = getPublicOrigin(request, env, url)

    // 1. 获取全量后台数据 (/api/data)
    if (pathname === '/api/data' && request.method === 'GET') {
        const [globalBaseYaml, providersPool, profiles] = await Promise.all([
            getGlobalBaseYaml(env),
            getProvidersPool(env),
            getProfiles(env)
        ])

        return jsonResponse({
            success: true,
            data: {
                globalBaseYaml,
                providersPool,
                profiles,
                publicOrigin: currentOrigin,
                prefix,
                hasD1: !!env.DB
            }
        })
    }

    // 2. 更新全局 Base YAML (/api/global-base-yaml)
    if (pathname === '/api/global-base-yaml' && request.method === 'POST') {
        const body = await request.json<{ yaml?: string }>()
        const yaml = body.yaml
        if (typeof yaml !== 'string') {
            return jsonResponse({ success: false, error: 'Invalid YAML content' }, 400)
        }

        await saveGlobalBaseYaml(yaml, env)
        return jsonResponse({ success: true })
    }

    // 3. 更新 Providers 资源池 (/api/providers-pool)
    if (pathname === '/api/providers-pool' && request.method === 'POST') {
        const body = await request.json<{ providers?: Provider[] }>()
        const providers = body.providers
        if (!Array.isArray(providers)) {
            return jsonResponse({ success: false, error: 'Invalid providers array' }, 400)
        }

        await saveProvidersPool(providers, env)
        const updatedPool = await getProvidersPool(env)
        return jsonResponse({ success: true, providers: updatedPool })
    }

    // 4. 更新 Profiles 列表 (/api/profiles)
    if (pathname === '/api/profiles' && request.method === 'POST') {
        const body = await request.json<{ profiles?: Profile[] }>()
        const profiles = body.profiles
        if (!Array.isArray(profiles)) {
            return jsonResponse({ success: false, error: 'Invalid profiles array' }, 400)
        }

        await saveProfiles(profiles, env)
        return jsonResponse({ success: true })
    }

    // 5. 预览最终生成的 Clash YAML (/api/preview?profileId=xxx)
    if (pathname === '/api/preview' && request.method === 'GET') {
        const profileId = url.searchParams.get('profileId')
        const profiles = await getProfiles(env)
        const targetProfile = profiles.find(p => p.id === profileId) || profiles[0]

        if (!targetProfile) {
            return jsonResponse({ success: false, error: 'No profile found' }, 404)
        }

        let baseYaml = ''
        if (targetProfile.useGlobalYaml !== false) {
            baseYaml = await getGlobalBaseYaml(env)
        } else {
            baseYaml = targetProfile.customBaseYaml || (await getGlobalBaseYaml(env))
        }

        const activeProviders = await getProvidersByIds(targetProfile.enabledProviderIds || [], env)

        const token = targetProfile.token
        const settings = targetProfile.settings || {}
        const proxyBaseUrl = `${currentOrigin}${prefix}/provider-proxy?token=${encodeURIComponent(token || '')}&id=`
        const ghProxyBaseUrl = `${currentOrigin}${prefix}/gh-proxy?token=${encodeURIComponent(token || '')}&url=`
        let finalYaml = assembleFinalYaml(baseYaml, activeProviders, proxyBaseUrl)
        finalYaml = rewriteGithubUrls(finalYaml, {
            proxyGithub: !!settings.proxyGithub,
            proxyGithubusercontent: !!settings.proxyGithubusercontent,
            proxyUrlPrefix: ghProxyBaseUrl
        })
        return jsonResponse({
            success: true,
            yaml: finalYaml,
            profileName: targetProfile.name,
            providerCount: activeProviders.length
        })
    }

    return null
}
