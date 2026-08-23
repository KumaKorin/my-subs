-- D1 Database Schema for mySubs
-- Global Settings (Base YAML, App configs)
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Providers Pool (Proxy Providers)
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

-- Profiles (Clash Profile Configurations)
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    use_global_yaml INTEGER DEFAULT 1,
    custom_base_yaml TEXT DEFAULT '',
    enabled_provider_ids TEXT DEFAULT '[]', -- JSON Array of IDs
    settings_json TEXT DEFAULT '{}',        -- JSON Object (e.g. proxyGithub, proxyGithubusercontent)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_profiles_token ON profiles(token);

-- Pull & Proxy Request Logs (/sub, /provider-proxy, /gh-proxy)
CREATE TABLE IF NOT EXISTS pull_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    request_type TEXT NOT NULL,       -- 'sub' | 'provider-proxy' | 'gh-proxy'
    target_id TEXT,                  -- profileId 或 providerId
    target_name TEXT,                -- 配置名称 / 机场名称 / 资源标识
    client_ip TEXT,                  -- 客户端 IP
    client_country TEXT,             -- 国家/地区代码 (CF 自动获取)
    user_agent TEXT,                 -- 客户端 UA
    status_code INTEGER NOT NULL,    -- 200, 404, 502 等
    duration_ms INTEGER,             -- 耗时 (毫秒)
    error_message TEXT,              -- 异常原因 (若有)
    user_info TEXT                   -- 机场返回的 subscription-userinfo 流量字符串
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON pull_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_type ON pull_logs(request_type);
CREATE INDEX IF NOT EXISTS idx_logs_target ON pull_logs(target_id);
