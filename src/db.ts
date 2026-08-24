import { encryptAesGcm, decryptAesGcm, generateRandomHexToken } from './utils/crypto.js'
import { Profile, Provider, PullLog, SystemStats } from './types/index.js'
import DEFAULT_TEMPLATE from './default-template.yaml'

let tablesInitPromise: Promise<void> | null = null

/**
 * 确保 D1 数据库表与索引初始化
 */
export async function initD1Tables(db: D1Database): Promise<void> {
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
                use_fetch_proxy INTEGER DEFAULT 0,
                fetch_proxy_url TEXT DEFAULT '',
                proxy_redirect INTEGER DEFAULT 1,
                last_status INTEGER,
                last_traffic_info TEXT,
                last_fetched_at TIMESTAMP,
                is_deleted INTEGER DEFAULT 0,
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
                is_deleted INTEGER DEFAULT 0,
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
                profile_id TEXT,
                profile_name TEXT,
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

export async function ensureD1Tables(db: D1Database): Promise<void> {
    if (!db) return
    if (!tablesInitPromise) {
        tablesInitPromise = (async () => {
            try {
                await initD1Tables(db)
                try {
                    await db.prepare('ALTER TABLE providers ADD COLUMN is_deleted INTEGER DEFAULT 0').run()
                } catch {}
                try {
                    await db.prepare('ALTER TABLE providers ADD COLUMN use_fetch_proxy INTEGER DEFAULT 0').run()
                } catch {}
                try {
                    await db.prepare("ALTER TABLE providers ADD COLUMN fetch_proxy_url TEXT DEFAULT ''").run()
                } catch {}
                try {
                    await db.prepare('ALTER TABLE providers ADD COLUMN proxy_redirect INTEGER DEFAULT 1').run()
                } catch {}
                try {
                    await db.prepare('ALTER TABLE profiles ADD COLUMN is_deleted INTEGER DEFAULT 0').run()
                } catch {}
                try {
                    await db.prepare('ALTER TABLE pull_logs ADD COLUMN profile_name TEXT').run()
                } catch {}
                try {
                    await db.prepare('ALTER TABLE pull_logs ADD COLUMN profile_id TEXT').run()
                } catch {}
            } catch (err) {
                console.error('Failed to init D1 tables:', err)
                tablesInitPromise = null
            }
        })()
    }
    await tablesInitPromise
}

// -------------------------------------------------------------
// 1. Global Base YAML
// -------------------------------------------------------------

export async function dbGetGlobalBaseYaml(db: D1Database): Promise<string | null> {
    if (!db) return null
    await ensureD1Tables(db)
    try {
        const row = await db.prepare('SELECT value FROM global_settings WHERE key = ?').bind('global_base_yaml').first<{ value: string }>()
        if (row && row.value) {
            return row.value
        }
        return null
    } catch (err) {
        console.error('dbGetGlobalBaseYaml error:', err)
        return null
    }
}

export async function dbSaveGlobalBaseYaml(db: D1Database, yamlString: string): Promise<void> {
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

interface ProviderRow {
    id: string
    name: string
    type?: string
    proxy?: string
    url_encrypted: string
    interval?: number
    health_check_enable?: number
    health_check_interval?: number
    use_worker_proxy?: number
    use_fetch_proxy?: number
    fetch_proxy_url?: string
    proxy_redirect?: number
    last_status?: number | null
    last_traffic_info?: string | null
    last_fetched_at?: string | null
    is_deleted?: number
    updated_at?: string
}

export async function dbGetProvidersPool(db: D1Database, appSecret: string): Promise<Provider[]> {
    if (!db) return []
    await ensureD1Tables(db)
    try {
        const { results } = await db.prepare('SELECT * FROM providers WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY updated_at ASC').all<ProviderRow>()
        if (!results || results.length === 0) return []

        const decryptedList = await Promise.all(
            results.map(async (row): Promise<Provider> => {
                let url = ''
                if (row.url_encrypted) {
                    try {
                        url = await decryptAesGcm(row.url_encrypted, appSecret)
                    } catch {
                        url = ''
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
                    useFetchProxy: row.use_fetch_proxy === 1,
                    fetchProxyUrl: row.fetch_proxy_url || '',
                    proxyRedirect: row.proxy_redirect !== 0,
                    lastStatus: row.last_status,
                    lastTrafficInfo: row.last_traffic_info,
                    lastFetchedAt: row.last_fetched_at,
                    isDeleted: !!row.is_deleted
                }
            })
        )

        return decryptedList
    } catch (err) {
        console.error('dbGetProvidersPool error:', err)
        return []
    }
}

export async function dbSaveProvidersPool(db: D1Database, providersList: Provider[], appSecret: string): Promise<void> {
    if (!db || !Array.isArray(providersList)) return
    await ensureD1Tables(db)

    try {
        const activeIds = providersList.map(p => p.id)
        const statements: D1PreparedStatement[] = []

        if (activeIds.length > 0) {
            const placeholders = activeIds.map(() => '?').join(',')
            statements.push(
                db.prepare(`UPDATE providers SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id NOT IN (${placeholders})`).bind(...activeIds)
            )
        } else {
            statements.push(db.prepare('UPDATE providers SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP'))
        }

        for (const p of providersList) {
            const encryptedUrl = await encryptAesGcm(p.url || '', appSecret)
            statements.push(
                db.prepare(`
                    INSERT INTO providers (
                        id, name, type, proxy, url_encrypted, interval, 
                        health_check_enable, health_check_interval, use_worker_proxy, 
                        use_fetch_proxy, fetch_proxy_url, proxy_redirect,
                        is_deleted, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        type = excluded.type,
                        proxy = excluded.proxy,
                        url_encrypted = excluded.url_encrypted,
                        interval = excluded.interval,
                        health_check_enable = excluded.health_check_enable,
                        health_check_interval = excluded.health_check_interval,
                        use_worker_proxy = excluded.use_worker_proxy,
                        use_fetch_proxy = excluded.use_fetch_proxy,
                        fetch_proxy_url = excluded.fetch_proxy_url,
                        proxy_redirect = excluded.proxy_redirect,
                        is_deleted = 0,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(
                    p.id,
                    p.name,
                    p.type || 'http',
                    p.proxy || 'DIRECT',
                    encryptedUrl,
                    p.interval || 36000,
                    p.healthCheckEnable !== false ? 1 : 0,
                    p.healthCheckInterval || 36000,
                    p.useWorkerProxy ? 1 : 0,
                    p.useFetchProxy ? 1 : 0,
                    p.fetchProxyUrl || '',
                    p.proxyRedirect !== false ? 1 : 0
                )
            )
        }

        await db.batch(statements)
    } catch (err) {
        console.error('dbSaveProvidersPool error:', err)
        throw err
    }
}

export async function dbGetProvidersByIds(db: D1Database, providerIds: string[], appSecret: string): Promise<Provider[]> {
    if (!db || !providerIds || providerIds.length === 0) return []
    await ensureD1Tables(db)

    try {
        const placeholders = providerIds.map(() => '?').join(',')
        const { results } = await db.prepare(`SELECT * FROM providers WHERE id IN (${placeholders}) AND (is_deleted = 0 OR is_deleted IS NULL)`).bind(...providerIds).all<ProviderRow>()
        if (!results || results.length === 0) return []

        return await Promise.all(
            results.map(async (row): Promise<Provider> => {
                let url = ''
                if (row.url_encrypted) {
                    try {
                        url = await decryptAesGcm(row.url_encrypted, appSecret)
                    } catch {
                        url = ''
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
                    useFetchProxy: row.use_fetch_proxy === 1,
                    fetchProxyUrl: row.fetch_proxy_url || '',
                    proxyRedirect: row.proxy_redirect !== 0,
                    lastStatus: row.last_status,
                    lastTrafficInfo: row.last_traffic_info,
                    lastFetchedAt: row.last_fetched_at,
                    isDeleted: !!row.is_deleted
                }
            })
        )
    } catch (err) {
        console.error('dbGetProvidersByIds error:', err)
        return []
    }
}

export async function dbGetProviderById(db: D1Database, providerId: string, appSecret: string): Promise<Provider | null> {
    if (!db || !providerId) return null
    await ensureD1Tables(db)

    try {
        const row = await db.prepare('SELECT * FROM providers WHERE id = ?').bind(providerId).first<ProviderRow>()
        if (!row) return null

        let url = ''
        if (row.url_encrypted) {
            try {
                url = await decryptAesGcm(row.url_encrypted, appSecret)
            } catch {
                url = ''
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
            useFetchProxy: row.use_fetch_proxy === 1,
            fetchProxyUrl: row.fetch_proxy_url || '',
            proxyRedirect: row.proxy_redirect !== 0,
            lastStatus: row.last_status,
            lastTrafficInfo: row.last_traffic_info,
            lastFetchedAt: row.last_fetched_at,
            isDeleted: !!row.is_deleted
        }
    } catch (err) {
        console.error('dbGetProviderById error:', err)
        return null
    }
}

// -------------------------------------------------------------
// 3. Profiles
// -------------------------------------------------------------

interface ProfileRow {
    id: string
    name: string
    token: string
    use_global_yaml?: number
    custom_base_yaml?: string
    enabled_provider_ids?: string
    settings_json?: string
    is_deleted?: number
    created_at?: string
    updated_at?: string
}

export async function dbGetProfiles(db: D1Database): Promise<Profile[]> {
    if (!db) return []
    await ensureD1Tables(db)

    try {
        const { results } = await db.prepare('SELECT * FROM profiles WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY created_at ASC').all<ProfileRow>()
        if (!results || results.length === 0) return []

        return results.map(row => {
            let enabledIds: string[] = []
            try {
                enabledIds = JSON.parse(row.enabled_provider_ids || '[]')
            } catch {}

            let settings = {}
            try {
                settings = JSON.parse(row.settings_json || '{}')
            } catch {}

            return {
                id: row.id,
                name: row.name,
                token: row.token,
                useGlobalYaml: row.use_global_yaml === 1,
                customBaseYaml: row.custom_base_yaml || '',
                enabledProviderIds: enabledIds,
                settings,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                isDeleted: !!row.is_deleted
            }
        })
    } catch (err) {
        console.error('dbGetProfiles error:', err)
        return []
    }
}

export async function dbSaveProfiles(db: D1Database, profilesList: Profile[]): Promise<void> {
    if (!db || !Array.isArray(profilesList)) return
    await ensureD1Tables(db)

    try {
        const activeIds = profilesList.map(p => p.id)
        const statements: D1PreparedStatement[] = []

        if (activeIds.length > 0) {
            const placeholders = activeIds.map(() => '?').join(',')
            statements.push(
                db.prepare(`UPDATE profiles SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id NOT IN (${placeholders})`).bind(...activeIds)
            )
        } else {
            statements.push(db.prepare('UPDATE profiles SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP'))
        }

        for (const p of profilesList) {
            const enabledJson = JSON.stringify(p.enabledProviderIds || [])
            const settingsJson = JSON.stringify(p.settings || {})
            statements.push(
                db.prepare(`
                    INSERT INTO profiles (
                        id, name, token, use_global_yaml, custom_base_yaml, 
                        enabled_provider_ids, settings_json, is_deleted, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        token = excluded.token,
                        use_global_yaml = excluded.use_global_yaml,
                        custom_base_yaml = excluded.custom_base_yaml,
                        enabled_provider_ids = excluded.enabled_provider_ids,
                        settings_json = excluded.settings_json,
                        is_deleted = 0,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(
                    p.id,
                    p.name,
                    p.token || generateRandomHexToken(32),
                    p.useGlobalYaml !== false ? 1 : 0,
                    p.customBaseYaml || '',
                    enabledJson,
                    settingsJson
                )
            )
        }

        await db.batch(statements)
    } catch (err) {
        console.error('dbSaveProfiles error:', err)
        throw err
    }
}

export async function dbGetProfileByToken(db: D1Database, token: string): Promise<Profile | null> {
    if (!db || !token) return null
    await ensureD1Tables(db)

    try {
        const row = await db.prepare('SELECT * FROM profiles WHERE token = ? AND (is_deleted = 0 OR is_deleted IS NULL)').bind(token).first<ProfileRow>()
        if (!row) return null

        let enabledIds: string[] = []
        try {
            enabledIds = JSON.parse(row.enabled_provider_ids || '[]')
        } catch {}

        let settings = {}
        try {
            settings = JSON.parse(row.settings_json || '{}')
        } catch {}

        return {
            id: row.id,
            name: row.name,
            token: row.token,
            useGlobalYaml: row.use_global_yaml === 1,
            customBaseYaml: row.custom_base_yaml || '',
            enabledProviderIds: enabledIds,
            settings,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            isDeleted: !!row.is_deleted
        }
    } catch (err) {
        console.error('dbGetProfileByToken error:', err)
        return null
    }
}

// -------------------------------------------------------------
// 4. Request Logging & Analytics
// -------------------------------------------------------------

export async function logRequest(db: D1Database | undefined, logEntry: PullLog): Promise<void> {
    if (!db) return
    try {
        await ensureD1Tables(db)

        await db.prepare(`
            INSERT INTO pull_logs (
                request_type, profile_id, profile_name, target_id, target_name,
                client_ip, client_country, user_agent, status_code,
                duration_ms, error_message, user_info, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
            logEntry.request_type,
            logEntry.profile_id || null,
            logEntry.profile_name || null,
            logEntry.target_id || null,
            logEntry.target_name || null,
            logEntry.client_ip || null,
            logEntry.client_country || null,
            logEntry.user_agent || null,
            logEntry.status_code,
            logEntry.duration_ms || null,
            logEntry.error_message || null,
            logEntry.user_info || null
        ).run()

        if (logEntry.request_type === 'provider-proxy' && logEntry.target_id) {
            const updates: string[] = ['last_fetched_at = CURRENT_TIMESTAMP', 'last_status = ?']
            const binds: (string | number)[] = [logEntry.status_code]

            if (logEntry.user_info) {
                updates.push('last_traffic_info = ?')
                binds.push(logEntry.user_info)
            }
            binds.push(logEntry.target_id)

            await db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run()
        }
    } catch (err) {
        console.error('logRequest error:', err)
    }
}

export interface GetLogsOptions {
    limit?: number
    offset?: number
    type?: string
    statusOnlyError?: boolean
}

export async function dbGetLogs(db: D1Database, { limit = 50, offset = 0, type = 'all', statusOnlyError = false }: GetLogsOptions = {}): Promise<{ logs: PullLog[], total: number }> {
    if (!db) return { logs: [], total: 0 }
    await ensureD1Tables(db)

    try {
        const conditions: string[] = []
        const binds: (string | number)[] = []

        if (type && type !== 'all') {
            conditions.push('request_type = ?')
            binds.push(type)
        }

        if (statusOnlyError) {
            conditions.push('status_code >= 400')
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

        const totalRow = await db.prepare(`SELECT COUNT(*) as count FROM pull_logs ${whereClause}`).bind(...binds).first<{ count: number }>()
        const total = totalRow ? totalRow.count : 0

        const query = `
            SELECT * FROM pull_logs 
            ${whereClause} 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `
        const queryBinds = [...binds, limit, offset]
        const { results } = await db.prepare(query).bind(...queryBinds).all<PullLog>()

        return {
            logs: results || [],
            total
        }
    } catch (err) {
        console.error('dbGetLogs error:', err)
        return { logs: [], total: 0 }
    }
}

export async function dbClearLogs(db: D1Database, { beforeDays = null }: { beforeDays?: number | null } = {}): Promise<void> {
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

export async function dbGetStats(db: D1Database): Promise<SystemStats> {
    if (!db) return { todayRequests: 0, todayErrors: 0, totalRequests: 0, todayTypeBreakdown: {} }
    await ensureD1Tables(db)

    try {
        const totalRow = await db.prepare('SELECT COUNT(*) as count FROM pull_logs').first<{ count: number }>()
        const todayRow = await db.prepare("SELECT COUNT(*) as count FROM pull_logs WHERE created_at >= date('now')").first<{ count: number }>()
        const errorRow = await db.prepare("SELECT COUNT(*) as count FROM pull_logs WHERE status_code >= 400 AND created_at >= date('now')").first<{ count: number }>()

        const { results: typeStats } = await db.prepare("SELECT request_type, COUNT(*) as count FROM pull_logs WHERE created_at >= date('now') GROUP BY request_type").all<{ request_type: string, count: number }>()

        const todayTypeBreakdown: Record<string, number> = {}
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
