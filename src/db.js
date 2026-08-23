import { encryptAesGcm, decryptAesGcm, generateRandomHexToken } from './crypto.js'
import DEFAULT_TEMPLATE from './default-template.yaml'

let tablesInitPromise = null

/**
 * 确保 D1 数据库表与索引初始化
 */
export async function initD1Tables(db) {
    if (!db) return
    await db.batch([
        db.prepare(`
            CREATE TABLE IF NOT EXISTS global_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `),
        db.prepare(`
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT DEFAULT 'http',
                proxy TEXT DEFAULT 'DIRECT',
                url_encrypted TEXT NOT NULL,
                interval INTEGER DEFAULT 36000,
                health_check_enable INTEGER DEFAULT 1,
                health_check_interval INTEGER DEFAULT 36000,
                use_worker_proxy INTEGER DEFAULT 0,
                last_status INTEGER,
                last_traffic_info TEXT,
                last_fetched_at TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `),
        db.prepare(`
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                use_global_yaml INTEGER DEFAULT 1,
                custom_base_yaml TEXT DEFAULT '',
                enabled_provider_ids TEXT DEFAULT '[]',
                settings_json TEXT DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_profiles_token ON profiles(token);`),
        db.prepare(`
            CREATE TABLE IF NOT EXISTS pull_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                request_type TEXT NOT NULL,
                target_id TEXT,
                target_name TEXT,
                client_ip TEXT,
                client_country TEXT,
                user_agent TEXT,
                status_code INTEGER NOT NULL,
                duration_ms INTEGER,
                error_message TEXT,
                user_info TEXT
            );
        `),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_logs_created ON pull_logs(created_at DESC);`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_logs_type ON pull_logs(request_type);`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_logs_target ON pull_logs(target_id);`)
    ])
}

export async function ensureD1Tables(db) {
    if (!db) return
    if (!tablesInitPromise) {
        tablesInitPromise = initD1Tables(db).catch(err => {
            console.error('Failed to init D1 tables:', err)
            tablesInitPromise = null
        })
    }
    await tablesInitPromise
}

// -------------------------------------------------------------
// 1. Global Base YAML
// -------------------------------------------------------------

export async function dbGetGlobalBaseYaml(db) {
    if (!db) return null
    await ensureD1Tables(db)
    try {
        const row = await db.prepare('SELECT value FROM global_settings WHERE key = ?').bind('global_base_yaml').first()
        if (row && row.value) {
            return row.value
        }
        return null
    } catch (err) {
        console.error('dbGetGlobalBaseYaml error:', err)
        return null
    }
}

export async function dbSaveGlobalBaseYaml(db, yamlString) {
    if (!db) return
    await ensureD1Tables(db)
    try {
        await db.prepare('INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
            .bind('global_base_yaml', yamlString)
            .run()
    } catch (err) {
        console.error('dbSaveGlobalBaseYaml error:', err)
    }
}

// -------------------------------------------------------------
// 2. Providers
// -------------------------------------------------------------

export async function dbGetProvidersPool(db, appSecret) {
    if (!db) return []
    await ensureD1Tables(db)
    try {
        const { results } = await db.prepare('SELECT * FROM providers ORDER BY updated_at ASC').all()
        if (!results || results.length === 0) return []

        const decryptedList = await Promise.all(
            results.map(async row => {
                let url = ''
                if (row.url_encrypted) {
                    try {
                        url = await decryptAesGcm(row.url_encrypted, appSecret)
                    } catch (err) {
                        console.error(`Failed to decrypt provider URL for ${row.id}:`, err)
                    }
                }
                return {
                    id: row.id,
                    name: row.name,
                    type: row.type || 'http',
                    proxy: row.proxy || 'DIRECT',
                    url,
                    interval: row.interval || 36000,
                    healthCheckEnable: row.health_check_enable === 1,
                    healthCheckInterval: row.health_check_interval || 36000,
                    useWorkerProxy: row.use_worker_proxy === 1,
                    lastStatus: row.last_status,
                    lastTrafficInfo: row.last_traffic_info,
                    lastFetchedAt: row.last_fetched_at,
                    updatedAt: row.updated_at
                }
            })
        )
        return decryptedList
    } catch (err) {
        console.error('dbGetProvidersPool error:', err)
        return []
    }
}

export async function dbGetProviderById(db, id, appSecret) {
    if (!db || !id) return null
    await ensureD1Tables(db)
    try {
        const row = await db.prepare('SELECT * FROM providers WHERE id = ?').bind(id).first()
        if (!row) return null

        let url = ''
        if (row.url_encrypted) {
            try {
                url = await decryptAesGcm(row.url_encrypted, appSecret)
            } catch (err) {
                console.error(`Failed to decrypt provider ${id}:`, err)
            }
        }

        return {
            id: row.id,
            name: row.name,
            type: row.type || 'http',
            proxy: row.proxy || 'DIRECT',
            url,
            interval: row.interval || 36000,
            healthCheckEnable: row.health_check_enable === 1,
            healthCheckInterval: row.health_check_interval || 36000,
            useWorkerProxy: row.use_worker_proxy === 1,
            lastStatus: row.last_status,
            lastTrafficInfo: row.last_traffic_info,
            lastFetchedAt: row.last_fetched_at,
            updatedAt: row.updated_at
        }
    } catch (err) {
        console.error('dbGetProviderById error:', err)
        return null
    }
}

export async function dbSaveProvidersPool(db, providersArray, appSecret) {
    if (!db || !Array.isArray(providersArray)) return
    await ensureD1Tables(db)

    try {
        const { results } = await db.prepare('SELECT id FROM providers').all()
        const existingIds = new Set((results || []).map(r => r.id))

        const newIds = new Set()
        const statements = []

        for (const p of providersArray) {
            if (!p.id) p.id = crypto.randomUUID()
            newIds.add(p.id)

            const encryptedUrl = p.url ? await encryptAesGcm(p.url, appSecret) : ''
            statements.push(
                db.prepare(`
                    INSERT INTO providers (
                        id, name, type, proxy, url_encrypted, interval, health_check_enable, 
                        health_check_interval, use_worker_proxy, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        type = excluded.type,
                        proxy = excluded.proxy,
                        url_encrypted = excluded.url_encrypted,
                        interval = excluded.interval,
                        health_check_enable = excluded.health_check_enable,
                        health_check_interval = excluded.health_check_interval,
                        use_worker_proxy = excluded.use_worker_proxy,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(
                    p.id,
                    p.name || 'Unnamed',
                    p.type || 'http',
                    p.proxy || 'DIRECT',
                    encryptedUrl,
                    p.interval || 36000,
                    p.healthCheckEnable !== false ? 1 : 0,
                    p.healthCheckInterval || 36000,
                    p.useWorkerProxy ? 1 : 0
                )
            )
        }

        for (const oldId of existingIds) {
            if (!newIds.has(oldId)) {
                statements.push(db.prepare('DELETE FROM providers WHERE id = ?').bind(oldId))
            }
        }

        if (statements.length > 0) {
            await db.batch(statements)
        }
    } catch (err) {
        console.error('dbSaveProvidersPool error:', err)
    }
}

export async function dbUpdateProviderFetchStatus(db, id, statusCode, userInfo = null) {
    if (!db || !id) return
    await ensureD1Tables(db)
    try {
        const updates = ['last_status = ?', 'last_fetched_at = CURRENT_TIMESTAMP']
        const binds = [statusCode]

        if (userInfo) {
            updates.push('last_traffic_info = ?')
            binds.push(userInfo)
        }

        binds.push(id)
        await db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run()
    } catch (err) {
        console.error('dbUpdateProviderFetchStatus error:', err)
    }
}

// -------------------------------------------------------------
// 3. Profiles
// -------------------------------------------------------------

export async function dbGetProfiles(db) {
    if (!db) return []
    await ensureD1Tables(db)
    try {
        const { results } = await db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all()
        if (!results || results.length === 0) return []

        return results.map(row => {
            let enabledProviderIds = []
            let settings = { proxyGithub: false, proxyGithubusercontent: false }
            try {
                if (row.enabled_provider_ids) enabledProviderIds = JSON.parse(row.enabled_provider_ids)
            } catch {}
            try {
                if (row.settings_json) settings = JSON.parse(row.settings_json)
            } catch {}

            return {
                id: row.id,
                name: row.name,
                token: row.token,
                useGlobalYaml: row.use_global_yaml === 1,
                customBaseYaml: row.custom_base_yaml || '',
                enabledProviderIds,
                settings,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }
        })
    } catch (err) {
        console.error('dbGetProfiles error:', err)
        return []
    }
}

export async function dbGetProfileByToken(db, token) {
    if (!db || !token) return null
    await ensureD1Tables(db)
    try {
        const row = await db.prepare('SELECT * FROM profiles WHERE token = ?').bind(token).first()
        if (!row) return null

        let enabledProviderIds = []
        let settings = { proxyGithub: false, proxyGithubusercontent: false }
        try {
            if (row.enabled_provider_ids) enabledProviderIds = JSON.parse(row.enabled_provider_ids)
        } catch {}
        try {
            if (row.settings_json) settings = JSON.parse(row.settings_json)
        } catch {}

        return {
            id: row.id,
            name: row.name,
            token: row.token,
            useGlobalYaml: row.use_global_yaml === 1,
            customBaseYaml: row.custom_base_yaml || '',
            enabledProviderIds,
            settings,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }
    } catch (err) {
        console.error('dbGetProfileByToken error:', err)
        return null
    }
}

export async function dbSaveProfiles(db, profilesArray) {
    if (!db || !Array.isArray(profilesArray)) return
    await ensureD1Tables(db)

    try {
        const { results } = await db.prepare('SELECT id FROM profiles').all()
        const existingIds = new Set((results || []).map(r => r.id))

        const newIds = new Set()
        const statements = []

        for (const p of profilesArray) {
            if (!p.id) p.id = crypto.randomUUID()
            if (!p.token) p.token = generateRandomHexToken(32)
            newIds.add(p.id)

            const enabledJson = JSON.stringify(p.enabledProviderIds || [])
            const settingsJson = JSON.stringify(p.settings || { proxyGithub: false, proxyGithubusercontent: false })

            statements.push(
                db.prepare(`
                    INSERT INTO profiles (
                        id, name, token, use_global_yaml, custom_base_yaml, enabled_provider_ids, settings_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        token = excluded.token,
                        use_global_yaml = excluded.use_global_yaml,
                        custom_base_yaml = excluded.custom_base_yaml,
                        enabled_provider_ids = excluded.enabled_provider_ids,
                        settings_json = excluded.settings_json,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(
                    p.id,
                    p.name || 'Unnamed Profile',
                    p.token,
                    p.useGlobalYaml !== false ? 1 : 0,
                    p.customBaseYaml || '',
                    enabledJson,
                    settingsJson
                )
            )
        }

        for (const oldId of existingIds) {
            if (!newIds.has(oldId)) {
                statements.push(db.prepare('DELETE FROM profiles WHERE id = ?').bind(oldId))
            }
        }

        if (statements.length > 0) {
            await db.batch(statements)
        }
    } catch (err) {
        console.error('dbSaveProfiles error:', err)
    }
}

// -------------------------------------------------------------
// 4. Request Logs & Monitoring
// -------------------------------------------------------------

export async function logRequest(db, {
    request_type,
    target_id = null,
    target_name = null,
    client_ip = null,
    client_country = null,
    user_agent = null,
    status_code,
    duration_ms = null,
    error_message = null,
    user_info = null
}) {
    if (!db) return
    try {
        await ensureD1Tables(db)
        await db.prepare(`
            INSERT INTO pull_logs (
                request_type, target_id, target_name, client_ip, client_country,
                user_agent, status_code, duration_ms, error_message, user_info, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
            request_type,
            target_id,
            target_name,
            client_ip,
            client_country,
            user_agent ? user_agent.substring(0, 255) : null,
            status_code,
            duration_ms,
            error_message ? error_message.substring(0, 500) : null,
            user_info
        ).run()

        if (request_type === 'provider-proxy' && target_id) {
            await dbUpdateProviderFetchStatus(db, target_id, status_code, user_info)
        }
    } catch (err) {
        console.error('Failed to write pull log to D1:', err)
    }
}

export async function dbGetLogs(db, { limit = 50, offset = 0, type = null, statusOnlyError = false } = {}) {
    if (!db) return { logs: [], total: 0 }
    await ensureD1Tables(db)

    try {
        const conditions = []
        const binds = []

        if (type && type !== 'all') {
            conditions.push('request_type = ?')
            binds.push(type)
        }

        if (statusOnlyError) {
            conditions.push('status_code >= 400')
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        const totalRow = await db.prepare(`SELECT COUNT(*) as count FROM pull_logs ${whereClause}`).bind(...binds).first()
        const total = totalRow ? totalRow.count : 0

        const query = `
            SELECT * FROM pull_logs 
            ${whereClause} 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `
        const queryBinds = [...binds, limit, offset]
        const { results } = await db.prepare(query).bind(...queryBinds).all()

        return {
            logs: results || [],
            total
        }
    } catch (err) {
        console.error('dbGetLogs error:', err)
        return { logs: [], total: 0 }
    }
}

export async function dbClearLogs(db, { beforeDays = null } = {}) {
    if (!db) return
    await ensureD1Tables(db)
    try {
        if (beforeDays && typeof beforeDays === 'number') {
            await db.prepare(`DELETE FROM pull_logs WHERE created_at < datetime('now', '-${beforeDays} days')`).run()
        } else {
            await db.prepare('DELETE FROM pull_logs').run()
        }
    } catch (err) {
        console.error('dbClearLogs error:', err)
    }
}

export async function dbGetStats(db) {
    if (!db) return { todayRequests: 0, errorCount: 0, totalRequests: 0, todayTypeBreakdown: {} }
    await ensureD1Tables(db)

    try {
        const totalRow = await db.prepare('SELECT COUNT(*) as count FROM pull_logs').first()
        const todayRow = await db.prepare("SELECT COUNT(*) as count FROM pull_logs WHERE created_at >= date('now')").first()
        const errorRow = await db.prepare("SELECT COUNT(*) as count FROM pull_logs WHERE status_code >= 400 AND created_at >= date('now')").first()

        const { results: typeStats } = await db.prepare("SELECT request_type, COUNT(*) as count FROM pull_logs WHERE created_at >= date('now') GROUP BY request_type").all()

        const todayTypeBreakdown = {}
        if (typeStats) {
            for (const row of typeStats) {
                todayTypeBreakdown[row.request_type] = row.count
            }
        }

        return {
            totalRequests: totalRow?.count || 0,
            todayRequests: todayRow?.count || 0,
            todayErrors: errorRow?.count || 0,
            todayTypeBreakdown
        }
    } catch (err) {
        console.error('dbGetStats error:', err)
        return { totalRequests: 0, todayRequests: 0, todayErrors: 0, todayTypeBreakdown: {} }
    }
}

// -------------------------------------------------------------
// 5. KV -> D1 数据迁移
// -------------------------------------------------------------

export async function migrateKvToD1(env) {
    if (!env.DB || !env.SUBS_KV) {
        return { success: false, error: 'DB (D1) or SUBS_KV binding is missing' }
    }

    await ensureD1Tables(env.DB)

    const report = {
        baseYamlMigrated: false,
        providersCount: 0,
        profilesCount: 0,
        details: []
    }

    // 1. 迁移 Global Base YAML
    const KEY_GLOBAL_BASE_YAML = 'data:yaml:global_base'
    const kvYaml = await env.SUBS_KV.get(KEY_GLOBAL_BASE_YAML)
    if (kvYaml) {
        await dbSaveGlobalBaseYaml(env.DB, kvYaml)
        report.baseYamlMigrated = true
        report.details.push('Base YAML migrated successfully from KV')
    } else {
        report.details.push('No Base YAML found in KV, kept default')
    }

    // 2. 迁移 Providers 资源池
    const KEY_PROVIDER_MAP = 'data:meta:provider:map'
    const PREFIX_PROVIDER_ENCRYPTED = 'data:encrypted:provider:'
    const mapRaw = await env.SUBS_KV.get(KEY_PROVIDER_MAP)
    let providerIds = []
    if (mapRaw) {
        try {
            providerIds = JSON.parse(mapRaw) || []
        } catch {}
    }

    const providers = []
    for (const id of providerIds) {
        const encrypted = await env.SUBS_KV.get(`${PREFIX_PROVIDER_ENCRYPTED}${id}`)
        if (encrypted) {
            try {
                const decryptedJson = await decryptAesGcm(encrypted, env.APP_SECRET)
                const provider = JSON.parse(decryptedJson)
                if (!provider.id) provider.id = id
                providers.push(provider)
            } catch (e) {
                report.details.push(`Failed to decrypt provider ${id} from KV: ${e.message}`)
            }
        }
    }

    if (providers.length > 0) {
        await dbSaveProvidersPool(env.DB, providers, env.APP_SECRET)
        report.providersCount = providers.length
        report.details.push(`Migrated ${providers.length} providers from KV to D1`)
    }

    // 3. 迁移 Profiles 列表
    const KEY_PROFILE_MAP = 'data:meta:profile:map'
    const PREFIX_PROFILE = 'data:profile:'
    const profileMapRaw = await env.SUBS_KV.get(KEY_PROFILE_MAP)
    let profileIds = []
    if (profileMapRaw) {
        try {
            profileIds = JSON.parse(profileMapRaw) || []
        } catch {}
    }

    const profiles = []
    for (const id of profileIds) {
        const raw = await env.SUBS_KV.get(`${PREFIX_PROFILE}${id}`)
        if (raw) {
            try {
                const p = JSON.parse(raw)
                if (!p.id) p.id = id
                profiles.push(p)
            } catch (e) {
                report.details.push(`Failed to parse profile ${id} from KV: ${e.message}`)
            }
        }
    }

    if (profiles.length > 0) {
        await dbSaveProfiles(env.DB, profiles)
        report.profilesCount = profiles.length
        report.details.push(`Migrated ${profiles.length} profiles from KV to D1`)
    }

    return { success: true, report }
}
