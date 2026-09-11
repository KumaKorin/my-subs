/**
 * Cloudflare D1 客户端初始化与表结构自愈
 */

let tablesInitPromise: Promise<void> | null = null

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
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_logs_profile ON pull_logs(profile_id);`)
  ])
}

export async function ensureD1Tables(db: D1Database): Promise<void> {
  if (!db) return
  if (!tablesInitPromise) {
    tablesInitPromise = (async () => {
      try {
        await initD1Tables(db)
        try {
          await db.prepare("ALTER TABLE providers ADD COLUMN provider_type TEXT DEFAULT 'external'").run()
        } catch {}
        try {
          await db.prepare("ALTER TABLE providers ADD COLUMN custom_nodes_yaml TEXT DEFAULT ''").run()
        } catch {}
        try {
          await db.prepare("ALTER TABLE providers ADD COLUMN url_mode TEXT DEFAULT 'direct'").run()
        } catch {}
        try {
          await db.prepare("ALTER TABLE providers ADD COLUMN use_custom_proxy INTEGER DEFAULT 0").run()
        } catch {}
      } catch (err) {
        console.error('Failed to init D1 tables:', err)
        tablesInitPromise = null
      }
    })()
  }
  await tablesInitPromise
}
