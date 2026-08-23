import { ProvidersComponent } from './providers.client.js'
import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1'
import { yaml } from 'https://esm.sh/@codemirror/lang-yaml@6.1.1'
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2'
import { linter, lintGutter } from 'https://esm.sh/@codemirror/lint@6.8.4'

// 全局应用状态
let appData = {
    globalBaseYaml: '',
    providersPool: [],
    profiles: [],
    publicOrigin: '',
    prefix: '',
    hasD1: false
}

let currentProfileId = null
let customYamlEditorView = null
let globalYamlEditorView = null
let previewEditorView = null
let poolProvidersComp = null
let logsTimer = null

// 生成 64 字符随机 Hex Token
function generateRandomHex(byteLength = 32) {
    const arr = new Uint8Array(byteLength)
    crypto.getRandomValues(arr)
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

// 创建 YAML Linter 实例
function createYamlLinter(statusElementId) {
    return linter(view => {
        const doc = view.state.doc.toString()
        const diagnostics = []
        const statusEl = document.getElementById(statusElementId)

        if (!doc.trim()) {
            if (statusEl) {
                statusEl.textContent = ''
                statusEl.style.display = 'none'
            }
            return diagnostics
        }

        if (!window.jsyaml) {
            return diagnostics
        }

        try {
            window.jsyaml.load(doc)
            if (statusEl) {
                statusEl.style.display = 'inline-flex'
                statusEl.innerHTML = '<i class="ri-checkbox-circle-line"></i> YAML 格式正确'
                statusEl.style.color = 'var(--success)'
            }
        } catch (e) {
            if (statusEl) {
                statusEl.style.display = 'inline-flex'
                const lineNum = e.mark?.line !== undefined ? e.mark.line + 1 : '?'
                statusEl.innerHTML = `<i class="ri-error-warning-line"></i> 第 ${lineNum} 行语法错误`
                statusEl.style.color = 'var(--danger)'
            }

            if (e.mark) {
                const lineIndex = Math.min(Math.max(1, e.mark.line + 1), view.state.doc.lines)
                const lineObj = view.state.doc.line(lineIndex)
                const from = Math.min(lineObj.from + (e.mark.column || 0), lineObj.to)
                const to = Math.max(from + 1, lineObj.to)

                diagnostics.push({
                    from,
                    to,
                    severity: 'error',
                    message: e.reason || e.message
                })
            }
        }
        return diagnostics
    })
}

// 创建 CodeMirror 实例
function createEditor(container, doc = '', readOnly = false, linterStatusId = null) {
    const extensions = [basicSetup, yaml(), oneDark, EditorView.lineWrapping]

    if (readOnly) {
        extensions.push(EditorView.editable.of(false))
    } else if (linterStatusId) {
        extensions.push(lintGutter(), createYamlLinter(linterStatusId))
    }

    return new EditorView({
        doc,
        extensions,
        parent: container
    })
}

// 设置编辑器内容
function setEditorContent(editorView, content) {
    if (!editorView) return
    editorView.dispatch({
        changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: content || ''
        }
    })
}

// 获取注入的 Base Prefix
const basePrefix = window.__BASE_PREFIX__ || ''
function apiUrl(path) {
    return `${basePrefix}${path}`
}

function showToast(msg, isError = false) {
    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--success)'
    toast.textContent = msg
    document.body.appendChild(toast)
    setTimeout(() => {
        toast.style.opacity = '0'
        setTimeout(() => toast.remove(), 300)
    }, 2500)
}

// 获取当前选中的 Profile 对象
function getCurrentProfile() {
    return appData.profiles.find(p => p.id === currentProfileId) || appData.profiles[0]
}

// 初始化应用并拉取数据
async function initApp() {
    try {
        const res = await fetch(apiUrl('/api/data'))
        if (res.status === 401) {
            window.location.href = `${basePrefix}/login`
            return
        }

        const resData = await res.json()
        if (resData.success) {
            appData = resData.data

            if (!currentProfileId || !appData.profiles.find(p => p.id === currentProfileId)) {
                currentProfileId = appData.profiles[0]?.id || null
            }

            renderAll()
            checkMigrationStatus()
        } else {
            showToast(`加载数据失败: ${resData.error || '未知错误'}`, true)
        }
    } catch (e) {
        showToast(`网络或数据异常: ${e.message}`, true)
    }
}

// 检查是否需要迁移提示
async function checkMigrationStatus() {
    try {
        const res = await fetch(apiUrl('/api/migration-status'))
        const data = await res.json()
        const banner = document.getElementById('migration-banner')
        if (banner && data.canMigrate) {
            banner.style.display = 'flex'
        } else if (banner) {
            banner.style.display = 'none'
        }
    } catch {}
}

// 渲染全部界面
function renderAll() {
    renderProfileSelect()
    renderCurrentProfile()
    renderPoolProviders()
}

// 渲染 Profile 选择下拉框
function renderProfileSelect() {
    const select = document.getElementById('profile-select')
    if (!select) return

    select.innerHTML = appData.profiles
        .map(
            p =>
                `<option value="${p.id}" ${p.id === currentProfileId ? 'selected' : ''}>${p.name || '未命名 Profile'}</option>`
        )
        .join('')
}

// 渲染当前选中的 Profile 详情
function renderCurrentProfile() {
    const profile = getCurrentProfile()
    if (!profile) return

    currentProfileId = profile.id

    // 1. 订阅链接和 Token
    const subUrlInput = document.getElementById('sub-url-input')
    const subTokenInput = document.getElementById('sub-token-input')
    const subUrl = `${appData.publicOrigin}${appData.prefix}/sub?token=${encodeURIComponent(profile.token || '')}`
    if (subUrlInput) subUrlInput.value = subUrl
    if (subTokenInput) subTokenInput.value = profile.token || ''

    // 2. Profile 名称与设置
    const nameInput = document.getElementById('profile-name-input')
    if (nameInput) nameInput.value = profile.name || ''

    const toggleGithub = document.getElementById('profile-proxy-github')
    const toggleGithubusercontent = document.getElementById('profile-proxy-githubusercontent')
    const settings = profile.settings || {}
    if (toggleGithub) toggleGithub.checked = !!settings.proxyGithub
    if (toggleGithubusercontent) toggleGithubusercontent.checked = !!settings.proxyGithubusercontent

    // 3. 全局 YAML 开关与编辑器联动
    const toggleGlobalYaml = document.getElementById('toggle-use-global-yaml')
    const globalBanner = document.getElementById('global-yaml-active-banner')
    const customYamlArea = document.getElementById('custom-yaml-editor-area')

    const isGlobal = profile.useGlobalYaml !== false
    if (toggleGlobalYaml) toggleGlobalYaml.checked = isGlobal

    if (isGlobal) {
        if (globalBanner) globalBanner.style.display = 'block'
        if (customYamlArea) customYamlArea.style.display = 'none'
    } else {
        if (globalBanner) globalBanner.style.display = 'none'
        if (customYamlArea) customYamlArea.style.display = 'block'

        // 挂载/更新 Custom YAML 编辑器
        const editorContainer = document.getElementById('custom-yaml-editor')
        if (editorContainer) {
            if (!customYamlEditorView) {
                customYamlEditorView = createEditor(
                    editorContainer,
                    profile.customBaseYaml || '',
                    false,
                    'yaml-lint-status'
                )
            } else {
                setEditorContent(customYamlEditorView, profile.customBaseYaml || '')
            }
        }
    }

    // 4. 渲染 Profile 关联的 Provider 勾选开关列表
    renderProfileProvidersList(profile)
}

// 渲染 Profile 中的 Provider 选择列表
function renderProfileProvidersList(profile) {
    const container = document.getElementById('profile-providers-list')
    if (!container) return

    const pool = appData.providersPool || []
    if (pool.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 2.5rem 1rem; color: var(--text-muted); border: 1px dashed var(--card-border); border-radius: var(--radius);">
                <p>Provider 资源池为空</p>
                <button class="btn btn-secondary" id="btn-empty-goto-pool" style="margin-top:0.75rem; font-size:0.85rem;">
                    去添加订阅源
                </button>
            </div>
        `
        const btn = container.querySelector('#btn-empty-goto-pool')
        if (btn) {
            btn.addEventListener('click', () => switchTab('tab-providers'))
        }
        return
    }

    const enabledSet = new Set(profile.enabledProviderIds || [])

    container.innerHTML = pool
        .map(p => {
            const isChecked = enabledSet.has(p.id)
            let statusDot = ''
            if (p.lastStatus) {
                statusDot = p.lastStatus >= 200 && p.lastStatus < 300 
                    ? '<span class="status-dot-ok" title="200 OK"></span>' 
                    : '<span class="status-dot-err" title="异常"></span>'
            }

            return `
                <div class="profile-provider-checkbox-item ${isChecked ? 'checked' : ''}" data-provider-id="${p.id}">
                    <div class="profile-provider-info">
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                            ${statusDot}
                            <span class="profile-provider-name">${p.name || '未命名源'}</span>
                        </div>
                        <span class="profile-provider-url" title="${p.url || ''}">${p.url || '未配置 URL'}</span>
                    </div>
                    <label class="switch-item">
                        <input type="checkbox" class="profile-provider-toggle" ${isChecked ? 'checked' : ''} />
                    </label>
                </div>
            `
        })
        .join('')

    container.querySelectorAll('.profile-provider-checkbox-item').forEach(el => {
        const provId = el.getAttribute('data-provider-id')
        const toggle = el.querySelector('.profile-provider-toggle')

        toggle.addEventListener('change', e => {
            if (e.target.checked) {
                el.classList.add('checked')
                if (!profile.enabledProviderIds.includes(provId)) {
                    profile.enabledProviderIds.push(provId)
                }
            } else {
                el.classList.remove('checked')
                profile.enabledProviderIds = profile.enabledProviderIds.filter(id => id !== provId)
            }
        })
    })
}

// 渲染 Provider 资源池管理组件 (Tab 2)
function renderPoolProviders() {
    const container = document.getElementById('pool-providers-container')
    if (!container) return

    if (!poolProvidersComp) {
        poolProvidersComp = new ProvidersComponent(container, updatedProviders => {
            appData.providersPool = updatedProviders
        })
    }
    poolProvidersComp.setProviders(appData.providersPool || [])
}

// -------------------------------------------------------------
// Tab 3: 请求日志与统计
// -------------------------------------------------------------

async function loadStats() {
    try {
        const res = await fetch(apiUrl('/api/stats'))
        const { data } = await res.json()
        if (!data) return

        const elTodayReq = document.getElementById('stat-today-requests')
        const elTodayErr = document.getElementById('stat-today-errors')
        const elSubCount = document.getElementById('stat-sub-count')
        const elProvCount = document.getElementById('stat-provider-count')
        const elGhCount = document.getElementById('stat-gh-count')

        if (elTodayReq) elTodayReq.textContent = data.todayRequests || 0
        if (elTodayErr) elTodayErr.textContent = data.todayErrors || 0
        if (elSubCount) elSubCount.textContent = data.todayTypeBreakdown?.['sub'] || 0
        if (elProvCount) elProvCount.textContent = data.todayTypeBreakdown?.['provider-proxy'] || 0
        if (elGhCount) elGhCount.textContent = data.todayTypeBreakdown?.['gh-proxy'] || 0
    } catch {}
}

async function loadLogs() {
    const tbody = document.getElementById('logs-tbody')
    if (!tbody) return

    const typeSelect = document.getElementById('log-filter-type')
    const errorOnlyCheckbox = document.getElementById('log-filter-error-only')

    const type = typeSelect ? typeSelect.value : 'all'
    const errorOnly = errorOnlyCheckbox && errorOnlyCheckbox.checked ? '1' : '0'

    try {
        const res = await fetch(apiUrl(`/api/logs?limit=50&type=${encodeURIComponent(type)}&errorOnly=${errorOnly}`))
        const result = await res.json()
        const { logs, total, hasD1 } = result.data || {}

        if (!hasD1 && logs?.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
                        <i class="ri-database-2-line" style="font-size: 1.5rem; display:block; margin-bottom: 0.5rem;"></i>
                        未绑定 Cloudflare D1 数据库，日志功能暂未激活。<br>
                        请在 <code>wrangler.toml</code> 中添加 <code>[[d1_databases]]</code> 绑定。
                    </td>
                </tr>
            `
            return
        }

        if (!logs || logs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                        暂无请求日志记录
                    </td>
                </tr>
            `
            return
        }

        tbody.innerHTML = logs
            .map(log => {
                let typeBadge = `<span class="log-badge log-badge-sub"><i class="ri-file-download-line"></i> /sub 分发</span>`
                if (log.request_type === 'provider-proxy') {
                    typeBadge = `<span class="log-badge log-badge-provider"><i class="ri-route-line"></i> /provider 代理</span>`
                } else if (log.request_type === 'gh-proxy') {
                    typeBadge = `<span class="log-badge log-badge-gh"><i class="ri-github-line"></i> /gh 规则代理</span>`
                }

                let statusBadge = `<span class="status-pill status-pill-ok"><i class="ri-check-line"></i> ${log.status_code}</span>`
                if (log.status_code >= 400) {
                    statusBadge = `<span class="status-pill status-pill-err"><i class="ri-close-line"></i> ${log.status_code}</span>`
                }

                let durationClass = 'latency-fast'
                if (log.duration_ms > 400) durationClass = 'latency-slow'
                else if (log.duration_ms > 150) durationClass = 'latency-med'

                const durationStr = log.duration_ms !== null ? `<span class="${durationClass}">${log.duration_ms} ms</span>` : '-'
                const targetDisplay = log.target_name || log.target_id || '-'

                let extraInfo = ''
                if (log.user_info) {
                    extraInfo += `<div class="log-user-info" title="${log.user_info}"><i class="ri-pie-chart-line"></i> ${log.user_info}</div>`
                }
                if (log.error_message) {
                    extraInfo += `<div class="log-error-msg"><i class="ri-error-warning-line"></i> ${log.error_message}</div>`
                }

                const lua = (log.user_agent || '').toLowerCase()
                let devIcon = '<i class="ri-global-line"></i>'
                if (lua.includes('android') || lua.includes('iphone') || lua.includes('mobile')) {
                    devIcon = '<i class="ri-smartphone-line" style="color:#38bdf8"></i>'
                } else if (lua.includes('windows') || lua.includes('macintosh') || lua.includes('mac os') || lua.includes('linux')) {
                    devIcon = '<i class="ri-computer-line" style="color:#818cf8"></i>'
                } else if (lua.includes('clash') || lua.includes('meta') || lua.includes('stash')) {
                    devIcon = '<i class="ri-flashlight-line" style="color:#34d399"></i>'
                }

                return `
                    <tr>
                        <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.76rem; color: var(--text-muted); white-space: nowrap">
                            ${log.created_at || '-'}
                        </td>
                        <td>${typeBadge}</td>
                        <td>${statusBadge}</td>
                        <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem">${durationStr}</td>
                        <td style="font-weight: 600; font-size: 0.85rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" title="${targetDisplay}">
                            ${targetDisplay}
                        </td>
                        <td>
                            <span class="country-tag">${log.client_country || 'XX'}</span>
                            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text-muted)">${log.client_ip || '-'}</span>
                        </td>
                        <td>
                            <div style="font-size: 0.76rem; color: var(--text-muted); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 0.35rem" title="${log.user_agent || ''}">
                                ${devIcon}
                                <span>${log.user_agent || '-'}</span>
                            </div>
                            ${extraInfo}
                        </td>
                    </tr>
                `
            })
            .join('')
    } catch (e) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--danger); padding: 2rem;">
                    获取日志失败: ${e.message}
                </td>
            </tr>
        `
    }
}

function refreshLogsAndStats() {
    loadStats()
    loadLogs()
}

// Tab 切换
function switchTab(tabId) {
    document.querySelectorAll('.nav-tab').forEach(t => {
        if (t.getAttribute('data-tab') === tabId) {
            t.classList.add('active')
        } else {
            t.classList.remove('active')
        }
    })

    document.querySelectorAll('.tab-pane').forEach(p => {
        if (p.id === tabId) {
            p.classList.add('active')
        } else {
            p.classList.remove('active')
        }
    })

    if (tabId === 'tab-logs') {
        refreshLogsAndStats()
        if (!logsTimer) {
            logsTimer = setInterval(refreshLogsAndStats, 10000)
        }
    } else {
        if (logsTimer) {
            clearInterval(logsTimer)
            logsTimer = null
        }
    }
}

// 收集当前 Profile 界面表单数据同步回 Profile 对象
function collectCurrentProfileFormData() {
    const profile = getCurrentProfile()
    if (!profile) return null

    const nameInput = document.getElementById('profile-name-input')
    const subTokenInput = document.getElementById('sub-token-input')
    const toggleGlobalYaml = document.getElementById('toggle-use-global-yaml')
    const toggleGithub = document.getElementById('profile-proxy-github')
    const toggleGithubusercontent = document.getElementById('profile-proxy-githubusercontent')

    profile.name = nameInput ? nameInput.value.trim() || '未命名 Profile' : profile.name
    profile.token = subTokenInput ? subTokenInput.value.trim() : profile.token
    profile.useGlobalYaml = toggleGlobalYaml ? toggleGlobalYaml.checked : true

    if (!profile.useGlobalYaml && customYamlEditorView) {
        profile.customBaseYaml = customYamlEditorView.state.doc.toString()
    }

    profile.settings = {
        proxyGithub: toggleGithub ? toggleGithub.checked : false,
        proxyGithubusercontent: toggleGithubusercontent ? toggleGithubusercontent.checked : false
    }

    return profile
}

// 绑定全局事件
function bindGlobalEvents() {
    // 1. 退出登录
    const btnLogout = document.getElementById('btn-logout')
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await fetch(apiUrl('/api/logout'), { method: 'POST' })
            showToast('已退出登录，正在跳转...')
            setTimeout(() => {
                window.location.href = `${basePrefix}/login`
            }, 300)
        })
    }

    // 2. Tab 导航切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab')
            switchTab(target)
            if (target === 'tab-profiles') {
                renderProfileProvidersList(getCurrentProfile())
            }
        })
    })

    const btnGotoPool = document.getElementById('btn-goto-providers-tab')
    if (btnGotoPool) {
        btnGotoPool.addEventListener('click', () => switchTab('tab-providers'))
    }

    // 3. Profile 切换
    const profileSelect = document.getElementById('profile-select')
    if (profileSelect) {
        profileSelect.addEventListener('change', e => {
            collectCurrentProfileFormData()
            currentProfileId = e.target.value
            renderCurrentProfile()
        })
    }

    // 4. 新建 Profile
    const btnNewProfile = document.getElementById('btn-new-profile')
    if (btnNewProfile) {
        btnNewProfile.addEventListener('click', () => {
            const name = prompt('请输入新 Profile 名称:', `Profile_${appData.profiles.length + 1}`)
            if (!name || !name.trim()) return

            collectCurrentProfileFormData()

            const newProfile = {
                id: crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}`,
                name: name.trim(),
                token: generateRandomHex(32),
                useGlobalYaml: true,
                customBaseYaml: '',
                enabledProviderIds: (appData.providersPool || []).map(p => p.id),
                settings: { proxyGithub: false, proxyGithubusercontent: false },
                createdAt: Date.now()
            }

            appData.profiles.push(newProfile)
            currentProfileId = newProfile.id
            renderAll()
            showToast(`已创建「${newProfile.name}」，请点击保存提交到服务端`)
        })
    }

    // 5. 删除 Profile
    const btnDeleteProfile = document.getElementById('btn-delete-profile')
    if (btnDeleteProfile) {
        btnDeleteProfile.addEventListener('click', () => {
            if (appData.profiles.length <= 1) {
                showToast('至少需要保留一个 Profile', true)
                return
            }
            const profile = getCurrentProfile()
            if (confirm(`确定要删除 Profile「${profile.name}」吗？`)) {
                appData.profiles = appData.profiles.filter(p => p.id !== profile.id)
                currentProfileId = appData.profiles[0].id
                renderAll()
                showToast(`已删除「${profile.name}」，请点击保存提交到服务端`)
            }
        })
    }

    // 6. 保存当前 Profile 配置
    const btnSaveCurrentProfile = document.getElementById('btn-save-current-profile')
    if (btnSaveCurrentProfile) {
        btnSaveCurrentProfile.addEventListener('click', async () => {
            const profile = collectCurrentProfileFormData()
            if (!profile) return

            if (!profile.useGlobalYaml && window.jsyaml && profile.customBaseYaml.trim()) {
                try {
                    window.jsyaml.load(profile.customBaseYaml)
                } catch (err) {
                    const lineInfo = err.mark?.line !== undefined ? ` (第 ${err.mark.line + 1} 行)` : ''
                    const confirmSave = confirm(
                        `检测到自定义 Base YAML 存在语法错误${lineInfo}：\n${err.reason || err.message}\n\n确定仍要强制保存吗？`
                    )
                    if (!confirmSave) return
                }
            }

            const res = await fetch(apiUrl('/api/profiles'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profiles: appData.profiles })
            })

            const result = await res.json()
            if (result.success) {
                showToast(`Profile「${profile.name}」配置已保存`)
                renderProfileSelect()
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 7. 重新生成 64 位 Hex Token
    const btnRegenToken = document.getElementById('btn-regen-token')
    if (btnRegenToken) {
        btnRegenToken.addEventListener('click', () => {
            const newToken = generateRandomHex(32)
            const tokenInput = document.getElementById('sub-token-input')
            const urlInput = document.getElementById('sub-url-input')
            if (tokenInput) tokenInput.value = newToken
            if (urlInput) {
                urlInput.value = `${appData.publicOrigin}${appData.prefix}/sub?token=${encodeURIComponent(newToken)}`
            }
            const profile = getCurrentProfile()
            if (profile) profile.token = newToken
            showToast('已生成新的 64 位 Token，请记得点击保存')
        })
    }

    // 8. 复制订阅链接
    const btnCopySub = document.getElementById('btn-copy-sub')
    if (btnCopySub) {
        btnCopySub.addEventListener('click', () => {
            const subUrl = document.getElementById('sub-url-input').value
            if (subUrl) {
                navigator.clipboard.writeText(subUrl)
                showToast('订阅链接已复制到剪贴板')
                const originalHtml = btnCopySub.innerHTML
                btnCopySub.innerHTML = '<i class="ri-check-line"></i> 已复制'
                setTimeout(() => {
                    btnCopySub.innerHTML = originalHtml
                }, 2000)
            }
        })
    }

    // 9. 全局 Base YAML 切换开关
    const toggleGlobalYaml = document.getElementById('toggle-use-global-yaml')
    if (toggleGlobalYaml) {
        toggleGlobalYaml.addEventListener('change', e => {
            const profile = getCurrentProfile()
            if (profile) profile.useGlobalYaml = e.target.checked
            renderCurrentProfile()
        })
    }

    // 10. Provider 资源池管理 (Tab 2)
    const btnAddPoolProvider = document.getElementById('btn-add-pool-provider')
    if (btnAddPoolProvider) {
        btnAddPoolProvider.addEventListener('click', () => {
            if (poolProvidersComp) poolProvidersComp.addProvider()
        })
    }

    const btnSavePool = document.getElementById('btn-save-providers-pool')
    if (btnSavePool) {
        btnSavePool.addEventListener('click', async () => {
            if (!poolProvidersComp) return
            const providers = poolProvidersComp.getProviders()

            const res = await fetch(apiUrl('/api/providers-pool'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providers })
            })

            const result = await res.json()
            if (result.success) {
                appData.providersPool = result.providers || providers
                showToast('Provider 资源池已保存')
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 11. 全局 Base YAML 维护弹窗
    const btnOpenGlobalYaml = document.getElementById('btn-open-global-yaml')
    const btnBannerEditGlobal = document.getElementById('btn-banner-edit-global')
    const globalModal = document.getElementById('global-yaml-modal')
    const btnCloseGlobalModal = document.getElementById('btn-close-global-yaml-modal')
    const btnSaveGlobalYaml = document.getElementById('btn-save-global-yaml')
    const globalEditorContainer = document.getElementById('global-yaml-editor')

    const openGlobalModal = () => {
        globalModal.style.display = 'flex'
        if (!globalYamlEditorView && globalEditorContainer) {
            globalYamlEditorView = createEditor(
                globalEditorContainer,
                appData.globalBaseYaml || '',
                false,
                'global-yaml-lint-status'
            )
        } else if (globalYamlEditorView) {
            setEditorContent(globalYamlEditorView, appData.globalBaseYaml || '')
        }
    }

    if (btnOpenGlobalYaml) btnOpenGlobalYaml.addEventListener('click', openGlobalModal)
    if (btnBannerEditGlobal) btnBannerEditGlobal.addEventListener('click', openGlobalModal)

    if (btnCloseGlobalModal) {
        btnCloseGlobalModal.addEventListener('click', () => {
            globalModal.style.display = 'none'
        })
    }

    if (btnSaveGlobalYaml) {
        btnSaveGlobalYaml.addEventListener('click', async () => {
            const yaml = globalYamlEditorView ? globalYamlEditorView.state.doc.toString() : ''

            if (window.jsyaml && yaml.trim()) {
                try {
                    window.jsyaml.load(yaml)
                } catch (err) {
                    const lineInfo = err.mark?.line !== undefined ? ` (第 ${err.mark.line + 1} 行)` : ''
                    const confirmSave = confirm(
                        `检测到全局 Base YAML 存在语法错误${lineInfo}：\n${err.reason || err.message}\n\n确定仍要强制保存吗？`
                    )
                    if (!confirmSave) return
                }
            }

            const res = await fetch(apiUrl('/api/global-base-yaml'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml })
            })

            const result = await res.json()
            if (result.success) {
                appData.globalBaseYaml = yaml
                showToast('全局 Base YAML 保存成功')
                globalModal.style.display = 'none'
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 12. 最终 YAML 预览弹窗
    const btnPreview = document.getElementById('btn-preview-yaml')
    const previewModal = document.getElementById('preview-modal')
    const btnCloseModal = document.getElementById('btn-close-modal')
    const previewContainer = document.getElementById('preview-editor')
    const previewTitle = document.getElementById('preview-modal-title')

    if (btnPreview) {
        btnPreview.addEventListener('click', async () => {
            collectCurrentProfileFormData()
            const profile = getCurrentProfile()
            const profileId = profile?.id || ''
            const res = await fetch(apiUrl(`/api/preview?profileId=${encodeURIComponent(profileId)}`))
            const data = await res.json()
            if (data.success) {
                previewModal.style.display = 'flex'
                if (previewTitle) {
                    previewTitle.innerHTML = `<i class="ri-file-text-line"></i> 「${data.profileName || 'Profile'}」最终分发 YAML 预览 (包含 ${data.providerCount || 0} 个订阅源)`
                }
                if (!previewEditorView && previewContainer) {
                    previewEditorView = createEditor(previewContainer, data.yaml || '', true)
                } else if (previewEditorView) {
                    setEditorContent(previewEditorView, data.yaml || '')
                }
            } else {
                showToast(data.error || '获取预览失败', true)
            }
        })
    }

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            previewModal.style.display = 'none'
        })
    }

    // 13. 日志与统计操作
    const btnRefreshLogs = document.getElementById('btn-refresh-logs')
    if (btnRefreshLogs) {
        btnRefreshLogs.addEventListener('click', () => {
            refreshLogsAndStats()
            showToast('已刷新最新请求日志')
        })
    }

    const logFilterType = document.getElementById('log-filter-type')
    if (logFilterType) {
        logFilterType.addEventListener('change', () => loadLogs())
    }

    const logFilterErrorOnly = document.getElementById('log-filter-error-only')
    if (logFilterErrorOnly) {
        logFilterErrorOnly.addEventListener('change', () => loadLogs())
    }

    const btnClearLogs = document.getElementById('btn-clear-logs')
    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', async () => {
            if (confirm('确定要清空全部请求日志流水记录吗？')) {
                const res = await fetch(apiUrl('/api/logs/clear'), { method: 'POST' })
                const data = await res.json()
                if (data.success) {
                    showToast('日志已清空')
                    refreshLogsAndStats()
                } else {
                    showToast(data.error || '清空失败', true)
                }
            }
        })
    }

    // 14. 一键迁移至 D1
    const btnStartMigration = document.getElementById('btn-start-migration')
    if (btnStartMigration) {
        btnStartMigration.addEventListener('click', async () => {
            if (confirm('确定开始将 KV 中的历史配置数据无缝同步至 D1 数据库吗？')) {
                btnStartMigration.disabled = true
                btnStartMigration.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> 迁移中...'
                try {
                    const res = await fetch(apiUrl('/api/migrate-kv-to-d1'), { method: 'POST' })
                    const result = await res.json()
                    if (result.success) {
                        alert(`迁移完成！\nProviders: ${result.report?.providersCount || 0} 个\nProfiles: ${result.report?.profilesCount || 0} 个\nBase YAML: ${result.report?.baseYamlMigrated ? '已同步' : '默认'}`)
                        const banner = document.getElementById('migration-banner')
                        if (banner) banner.style.display = 'none'
                        initApp()
                    } else {
                        showToast(result.error || '迁移失败', true)
                    }
                } catch (e) {
                    showToast(`迁移请求异常: ${e.message}`, true)
                } finally {
                    btnStartMigration.disabled = false
                    btnStartMigration.innerHTML = '<i class="ri-upload-cloud-line"></i> 一键迁移至 D1'
                }
            }
        })
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindGlobalEvents()
    initApp()
})
