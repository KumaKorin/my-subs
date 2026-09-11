-- Cloudflare D1 Schema for mySubs v2.0
-- 1. 全局配置 (Base YAML 等)
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 节点订阅资源池 (Providers)
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

-- 3. Profile 订阅配置 (Profiles)
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

CREATE INDEX IF NOT EXISTS idx_profiles_token ON profiles(token);

-- 4. 请求审计流水日志 (Logs)
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

CREATE INDEX IF NOT EXISTS idx_logs_created ON pull_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_type ON pull_logs(request_type);
CREATE INDEX IF NOT EXISTS idx_logs_profile ON pull_logs(profile_id);
