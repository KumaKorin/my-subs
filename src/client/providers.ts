/**
 * Proxy Providers 资源池可视化管理独立组件
 */
import { formatLocalTime, parseTrafficInfo } from './ui.js'
import { Provider } from '../types/index.js'

export class ProvidersComponent {
    private container: HTMLElement
    private onChange?: (providers: Provider[]) => void
    private providers: Provider[]

    constructor(container: HTMLElement, onChange?: (providers: Provider[]) => void) {
        this.container = container
        this.onChange = onChange
        this.providers = []
    }

    setProviders(providers: Provider[]): void {
        this.providers = Array.isArray(providers) ? JSON.parse(JSON.stringify(providers)) : []
        this.render()
    }

    getProviders(): Provider[] {
        return this.providers
    }

    addProvider(): void {
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
            useWorkerProxy: false,
            useFetchProxy: false,
            fetchProxyUrl: '',
            proxyRedirect: true
        })
        this.render()
        if (this.onChange) this.onChange(this.providers)
    }

    removeProvider(index: number): void {
        this.providers.splice(index, 1)
        this.render()
        if (this.onChange) this.onChange(this.providers)
    }

    updateProvider(index: number, field: keyof Provider, value: any): void {
        if (field === 'interval' || field === 'healthCheckInterval') {
            this.providers[index][field] = parseInt(value, 10) || 36000
        } else if (
            field === 'healthCheckEnable' ||
            field === 'useWorkerProxy' ||
            field === 'useFetchProxy' ||
            field === 'proxyRedirect'
        ) {
            this.providers[index][field] = value === 'true' || value === true
        } else {
            ;(this.providers[index] as any)[field] = value
        }
        if (this.onChange) this.onChange(this.providers)
    }

    render(): void {
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
                        statusBadge = `<span class="health-badge health-ok" title="最近拉取: ${formatLocalTime(p.lastFetchedAt)}"><i class="ri-checkbox-circle-fill"></i> ${p.lastStatus} OK</span>`
                    } else {
                        statusBadge = `<span class="health-badge health-err" title="最近拉取失败: ${formatLocalTime(p.lastFetchedAt)}"><i class="ri-error-warning-fill"></i> ${p.lastStatus} Error</span>`
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

                        ${p.useWorkerProxy ? `
                        <div class="provider-proxy-subbox" style="background: rgba(255,255,255,0.03); border: 1px dashed rgba(255,255,255,0.12); border-radius: 8px; padding: 0.85rem; margin-top: 0.25rem;">
                            <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-main); margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.35rem;">
                                <i class="ri-shield-flash-line" style="color: var(--primary)"></i> Worker 上游高级抓取代理设置
                            </div>
                            <div class="provider-row">
                                <div class="field-group">
                                    <label>上游 HTTPS / HTTP 代理:</label>
                                    <select class="input-field provider-use-fetch-proxy">
                                        <option value="false" ${!p.useFetchProxy ? 'selected' : ''}>禁用代理 (Worker 直连抓取)</option>
                                        <option value="true" ${p.useFetchProxy ? 'selected' : ''}>启用代理 (经由 HTTPS/HTTP 代理抓取)</option>
                                    </select>
                                </div>
                                <div class="field-group">
                                    <label>代理 301/302 重定向:</label>
                                    <select class="input-field provider-proxy-redirect">
                                        <option value="true" ${p.proxyRedirect !== false ? 'selected' : ''}>开启 (Worker 跟随并代理拉取跳转)</option>
                                        <option value="false" ${p.proxyRedirect === false ? 'selected' : ''}>关闭 (透传 302 给客户端)</option>
                                    </select>
                                </div>
                            </div>
                            ${p.useFetchProxy ? `
                            <div class="provider-row full" style="margin-top: 0.25rem;">
                                <div class="field-group" style="margin-bottom: 0;">
                                    <label>代理服务器地址 (HTTPS/HTTP Proxy / 网关):</label>
                                    <input type="text" class="input-field provider-fetch-proxy-url" value="${p.fetchProxyUrl || ''}" placeholder="例如: https://user:pass@proxy.example.com:8443 或 http://user:pass@1.2.3.4:8080">
                                    <span style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.25rem; display: block;">
                                        <i class="ri-shield-keyhole-line"></i> 支持 <b>HTTPS 代理 (TLS+鉴权)</b> (如 <code>https://user:pass@domain:443</code>)、<b>HTTP 代理</b> (如 <code>http://user:pass@ip:port</code>) 或 Web 代理网关 (带 <code>%s</code>/<code>?url=</code>)。
                                    </span>
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        ` : ''}
                    </div>
                `
            })
            .join('')

        this.container.innerHTML = html
        this.bindEvents()
    }

    bindEvents(): void {
        this.container.querySelectorAll('.provider-item').forEach(itemEl => {
            const idx = parseInt(itemEl.getAttribute('data-index') || '0', 10)

            itemEl.querySelector('.provider-name')?.addEventListener('input', (e: any) => {
                this.updateProvider(idx, 'name', e.target.value)
                const badge = itemEl.querySelector('.provider-badge')
                if (badge) badge.textContent = e.target.value || `Provider #${idx + 1}`
            })

            itemEl.querySelector('.provider-proxy')?.addEventListener('input', (e: any) => {
                this.updateProvider(idx, 'proxy', e.target.value)
            })

            itemEl.querySelector('.provider-url')?.addEventListener('input', (e: any) => {
                this.updateProvider(idx, 'url', e.target.value)
            })

            itemEl.querySelector('.provider-interval')?.addEventListener('input', (e: any) => {
                this.updateProvider(idx, 'interval', e.target.value)
            })

            itemEl.querySelector('.provider-health-enable')?.addEventListener('change', (e: any) => {
                this.updateProvider(idx, 'healthCheckEnable', e.target.value)
            })

            itemEl.querySelector('.provider-worker-proxy')?.addEventListener('change', (e: any) => {
                this.updateProvider(idx, 'useWorkerProxy', e.target.value)
                this.render()
            })

            itemEl.querySelector('.provider-use-fetch-proxy')?.addEventListener('change', (e: any) => {
                this.updateProvider(idx, 'useFetchProxy', e.target.value)
                this.render()
            })

            itemEl.querySelector('.provider-fetch-proxy-url')?.addEventListener('input', (e: any) => {
                this.updateProvider(idx, 'fetchProxyUrl', e.target.value)
            })

            itemEl.querySelector('.provider-proxy-redirect')?.addEventListener('change', (e: any) => {
                this.updateProvider(idx, 'proxyRedirect', e.target.value)
            })

            itemEl.querySelector('.btn-delete-provider')?.addEventListener('click', () => {
                const prov = this.providers[idx]
                if (confirm(`确定要从资源池中删除订阅源「${prov?.name || '未命名'}」吗？`)) {
                    this.removeProvider(idx)
                }
            })
        })
    }
}
