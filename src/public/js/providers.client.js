/**
 * Proxy Providers 资源池可视化管理独立组件
 */

function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

function parseTrafficInfo(headerStr) {
    if (!headerStr) return null
    try {
        const parts = headerStr.split(';').map(s => s.trim())
        const info = {}
        for (const p of parts) {
            const [k, v] = p.split('=')
            if (k && v !== undefined) info[k.trim()] = parseInt(v.trim(), 10) || 0
        }
        const used = (info.upload || 0) + (info.download || 0)
        const total = info.total || 0
        let expireDate = '无限制'
        if (info.expire && info.expire > 0) {
            expireDate = new Date(info.expire * 1000).toLocaleDateString()
        }
        return {
            usedStr: formatBytes(used),
            totalStr: formatBytes(total),
            percent: total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
            expireDate
        }
    } catch {
        return null
    }
}

export class ProvidersComponent {
    /**
     * @param {HTMLElement} container 挂载容器
     * @param {Function} onChange 数据变化回调
     */
    constructor(container, onChange) {
        this.container = container
        this.onChange = onChange
        this.providers = []
    }

    setProviders(providers) {
        this.providers = Array.isArray(providers) ? JSON.parse(JSON.stringify(providers)) : []
        this.render()
    }

    getProviders() {
        return this.providers
    }

    addProvider() {
        this.providers.push({
            id: crypto.randomUUID
                ? crypto.randomUUID()
                : `prov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: `Provider_${this.providers.length + 1}`,
            type: 'http',
            interval: 36000,
            healthCheckEnable: true,
            healthCheckInterval: 36000,
            proxy: 'DIRECT',
            url: '',
            useWorkerProxy: false
        })
        this.render()
        if (this.onChange) this.onChange(this.providers)
    }

    removeProvider(index) {
        this.providers.splice(index, 1)
        this.render()
        if (this.onChange) this.onChange(this.providers)
    }

    updateProvider(index, field, value) {
        if (field === 'interval' || field === 'healthCheckInterval') {
            this.providers[index][field] = parseInt(value, 10) || 36000
        } else if (field === 'healthCheckEnable' || field === 'useWorkerProxy') {
            this.providers[index][field] = value === 'true' || value === true
        } else {
            this.providers[index][field] = value
        }
        if (this.onChange) this.onChange(this.providers)
    }

    render() {
        if (this.providers.length === 0) {
            this.container.innerHTML = `
                <div style="text-align:center; padding: 3rem 1rem; color: var(--text-muted);">
                    <p>暂无 Provider 订阅源定义</p>
                    <button class="btn btn-secondary" id="btn-add-first-pool-provider" style="margin-top:1rem;">+ 添加第一个订阅源</button>
                </div>
            `
            const btnAdd = this.container.querySelector('#btn-add-first-pool-provider')
            if (btnAdd) {
                btnAdd.addEventListener('click', () => this.addProvider())
            }
            return
        }

        const html = this.providers
            .map((p, idx) => {
                let statusBadge = `<span class="health-badge health-idle"><i class="ri-indeterminate-circle-line"></i> 暂未拉取</span>`
                if (p.lastStatus) {
                    if (p.lastStatus >= 200 && p.lastStatus < 300) {
                        statusBadge = `<span class="health-badge health-ok" title="最近拉取: ${p.lastFetchedAt || '刚刚'}"><i class="ri-checkbox-circle-fill"></i> ${p.lastStatus} OK</span>`
                    } else {
                        statusBadge = `<span class="health-badge health-err" title="最近拉取失败: ${p.lastFetchedAt || '刚刚'}"><i class="ri-error-warning-fill"></i> ${p.lastStatus} Error</span>`
                    }
                }

                const traffic = parseTrafficInfo(p.lastTrafficInfo)
                let trafficHtml = ''
                if (traffic) {
                    trafficHtml = `
                        <div class="provider-traffic-box">
                            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.2rem">
                                <span><i class="ri-pie-chart-line"></i> 已用流量: <b>${traffic.usedStr}</b> / ${traffic.totalStr}</span>
                                <span><i class="ri-time-line"></i> 到期: ${traffic.expireDate}</span>
                            </div>
                            <div class="traffic-progress-bg">
                                <div class="traffic-progress-bar" style="width: ${traffic.percent}%"></div>
                            </div>
                        </div>
                    `
                }

                return `
                    <div class="provider-item" data-index="${idx}">
                        <div class="provider-header-row">
                            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <span class="provider-badge">${p.name || `Provider #${idx + 1}`}</span>
                                ${statusBadge}
                                <span style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">ID: ${p.id || 'N/A'}</span>
                            </div>
                            <button class="btn btn-danger btn-delete-provider" data-index="${idx}" style="padding: 0.25rem 0.6rem; font-size: 0.8rem;">
                                <i class="ri-delete-bin-line"></i> 删除
                            </button>
                        </div>

                        ${trafficHtml}

                        <div class="provider-row">
                            <div class="field-group">
                                <label>Provider 名称 (Clash Proxy 组 Key):</label>
                                <input type="text" class="input-field provider-name" value="${p.name || ''}" placeholder="例如: Name / LiangXin">
                            </div>
                            <div class="field-group">
                                <label>代理方式 (Proxy 策略):</label>
                                <input type="text" class="input-field provider-proxy" value="${p.proxy || 'DIRECT'}" placeholder="例如: ➡️ Direct 或 DIRECT">
                            </div>
                        </div>

                        <div class="provider-row full">
                            <div class="field-group">
                                <label>外部订阅链接 (URL):</label>
                                <input type="url" class="input-field provider-url" value="${p.url || ''}" placeholder="https://example.com/api/v1/client/subscribe?token=xxx">
                            </div>
                        </div>

                        <div class="provider-row">
                            <div class="field-group">
                                <label>更新间隔 (Interval 秒):</label>
                                <input type="number" class="input-field provider-interval" value="${p.interval || 36000}">
                            </div>
                            <div class="field-group">
                                <label>健康检查 (Health Check):</label>
                                <select class="input-field provider-health-enable">
                                    <option value="true" ${p.healthCheckEnable !== false ? 'selected' : ''}>启用 (true)</option>
                                    <option value="false" ${p.healthCheckEnable === false ? 'selected' : ''}>禁用 (false)</option>
                                </select>
                            </div>
                        </div>

                        <div class="provider-row full">
                            <div class="field-group">
                                <label>Worker 代理订阅 (由本 Worker 代拉取源内容):</label>
                                <select class="input-field provider-worker-proxy">
                                    <option value="false" ${!p.useWorkerProxy ? 'selected' : ''}>直连源链接 (默认)</option>
                                    <option value="true" ${p.useWorkerProxy ? 'selected' : ''}>通过本 Worker 代理转发 (加速/隐藏真实源)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                `
            })
            .join('')

        this.container.innerHTML = html
        this.bindEvents()
    }

    bindEvents() {
        this.container.querySelectorAll('.provider-item').forEach(itemEl => {
            const idx = parseInt(itemEl.getAttribute('data-index'), 10)

            itemEl.querySelector('.provider-name').addEventListener('input', e => {
                this.updateProvider(idx, 'name', e.target.value)
                const badge = itemEl.querySelector('.provider-badge')
                if (badge) badge.textContent = e.target.value || `Provider #${idx + 1}`
            })

            itemEl.querySelector('.provider-proxy').addEventListener('input', e => {
                this.updateProvider(idx, 'proxy', e.target.value)
            })

            itemEl.querySelector('.provider-url').addEventListener('input', e => {
                this.updateProvider(idx, 'url', e.target.value)
            })

            itemEl.querySelector('.provider-interval').addEventListener('input', e => {
                this.updateProvider(idx, 'interval', e.target.value)
            })

            itemEl.querySelector('.provider-health-enable').addEventListener('change', e => {
                this.updateProvider(idx, 'healthCheckEnable', e.target.value)
            })

            itemEl.querySelector('.provider-worker-proxy').addEventListener('change', e => {
                this.updateProvider(idx, 'useWorkerProxy', e.target.value)
            })

            itemEl.querySelector('.btn-delete-provider').addEventListener('click', () => {
                const prov = this.providers[idx]
                if (confirm(`确定要从资源池中删除订阅源「${prov.name || '未命名'}」吗？`)) {
                    this.removeProvider(idx)
                }
            })
        })
    }
}
