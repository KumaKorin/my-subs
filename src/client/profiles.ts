/**
 * Profile 订阅配置管理模块
 */
import { getState, setState, getCurrentProfile, getCurrentProfileId, setCurrentProfileId } from './state.js'
import { showToast, copyToClipboard, generateRandomHex } from './ui.js'
import { apiRequest } from './api.js'
import { createEditor, setEditorContent, getEditorContent } from './editor.js'
import { Profile } from '../types/index.js'

let customYamlEditorView: any = null
let previewEditorView: any = null

export function getCustomYamlEditor(): any {
    return customYamlEditorView
}

export function renderProfileSelect(): void {
    const select = document.getElementById('profile-select') as HTMLSelectElement | null
    if (!select) return

    const { profiles } = getState()
    const currentId = getCurrentProfileId()

    select.innerHTML = (profiles || [])
        .map(
            p =>
                `<option value="${p.id}" ${p.id === currentId ? 'selected' : ''}>${p.name || '未命名 Profile'}</option>`
        )
        .join('')
}

export function renderCurrentProfile(): void {
    const profile = getCurrentProfile()
    if (!profile) return

    setCurrentProfileId(profile.id)
    const { publicOrigin, prefix } = getState()

    // 1. 订阅链接与 Token
    const subUrlInput = document.getElementById('sub-url-input') as HTMLInputElement | null
    const subTokenInput = document.getElementById('sub-token-input') as HTMLInputElement | null
    const subUrl = `${publicOrigin}${prefix}/sub?token=${encodeURIComponent(profile.token || '')}`
    if (subUrlInput) subUrlInput.value = subUrl
    if (subTokenInput) subTokenInput.value = profile.token || ''

    // 2. Profile 名称与设置
    const nameInput = document.getElementById('profile-name-input') as HTMLInputElement | null
    if (nameInput) nameInput.value = profile.name || ''

    const toggleGithub = document.getElementById('profile-proxy-github') as HTMLInputElement | null
    const toggleGithubusercontent = document.getElementById('profile-proxy-githubusercontent') as HTMLInputElement | null
    const settings = profile.settings || {}
    if (toggleGithub) toggleGithub.checked = !!settings.proxyGithub
    if (toggleGithubusercontent) toggleGithubusercontent.checked = !!settings.proxyGithubusercontent

    // 3. 全局 YAML 开关与编辑器联动
    const toggleGlobalYaml = document.getElementById('toggle-use-global-yaml') as HTMLInputElement | null
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

export function renderProfileProvidersList(profile: Profile): void {
    const container = document.getElementById('profile-providers-list')
    if (!container) return

    const { providersPool } = getState()
    const pool = providersPool || []

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
            btn.addEventListener('click', () => {
                const provTab = document.querySelector('.nav-tab[data-tab="tab-providers"]') as HTMLElement | null
                if (provTab) provTab.click()
            })
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
        const provId = el.getAttribute('data-provider-id') || ''
        const toggle = el.querySelector('.profile-provider-toggle') as HTMLInputElement | null
        if (!toggle) return

        toggle.addEventListener('change', (e: any) => {
            if (!profile.enabledProviderIds) profile.enabledProviderIds = []
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

export function collectCurrentProfileFormData(): Profile | null {
    const profile = getCurrentProfile()
    if (!profile) return null

    const nameInput = document.getElementById('profile-name-input') as HTMLInputElement | null
    const subTokenInput = document.getElementById('sub-token-input') as HTMLInputElement | null
    const toggleGlobalYaml = document.getElementById('toggle-use-global-yaml') as HTMLInputElement | null
    const toggleGithub = document.getElementById('profile-proxy-github') as HTMLInputElement | null
    const toggleGithubusercontent = document.getElementById('profile-proxy-githubusercontent') as HTMLInputElement | null

    profile.name = nameInput ? nameInput.value.trim() || '未命名 Profile' : profile.name
    profile.token = subTokenInput ? subTokenInput.value.trim() : profile.token
    profile.useGlobalYaml = toggleGlobalYaml ? toggleGlobalYaml.checked : true

    if (!profile.useGlobalYaml && customYamlEditorView) {
        profile.customBaseYaml = getEditorContent(customYamlEditorView)
    }

    profile.settings = {
        proxyGithub: toggleGithub ? toggleGithub.checked : false,
        proxyGithubusercontent: toggleGithubusercontent ? toggleGithubusercontent.checked : false
    }

    return profile
}

export function bindProfileEvents(): void {
    // 1. Profile 切换
    const profileSelect = document.getElementById('profile-select')
    if (profileSelect) {
        profileSelect.addEventListener('change', (e: any) => {
            collectCurrentProfileFormData()
            setCurrentProfileId(e.target.value)
            renderCurrentProfile()
        })
    }

    // 2. 新建 Profile
    const btnNewProfile = document.getElementById('btn-new-profile')
    if (btnNewProfile) {
        btnNewProfile.addEventListener('click', () => {
            const { profiles, providersPool } = getState()
            const name = prompt('请输入新 Profile 名称:', `Profile_${(profiles || []).length + 1}`)
            if (!name || !name.trim()) return

            collectCurrentProfileFormData()

            const newProfile: Profile = {
                id: crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}`,
                name: name.trim(),
                token: generateRandomHex(32),
                useGlobalYaml: true,
                customBaseYaml: '',
                enabledProviderIds: (providersPool || []).map(p => p.id),
                settings: { proxyGithub: false, proxyGithubusercontent: false },
                createdAt: Date.now()
            }

            profiles.push(newProfile)
            setCurrentProfileId(newProfile.id)
            renderProfileSelect()
            renderCurrentProfile()
            showToast(`已创建「${newProfile.name}」，请点击保存提交到服务端`)
        })
    }

    // 3. 删除 Profile
    const btnDeleteProfile = document.getElementById('btn-delete-profile')
    if (btnDeleteProfile) {
        btnDeleteProfile.addEventListener('click', () => {
            const { profiles } = getState()
            if ((profiles || []).length <= 1) {
                showToast('至少需要保留一个 Profile', true)
                return
            }
            const profile = getCurrentProfile()
            if (profile && confirm(`确定要删除 Profile「${profile.name}」吗？`)) {
                const newProfiles = profiles.filter(p => p.id !== profile.id)
                setState({ profiles: newProfiles })
                setCurrentProfileId(newProfiles[0].id)
                renderProfileSelect()
                renderCurrentProfile()
                showToast(`已删除「${profile.name}」，请点击保存提交到服务端`)
            }
        })
    }

    // 4. 保存当前 Profile 配置
    const btnSaveCurrentProfile = document.getElementById('btn-save-current-profile')
    if (btnSaveCurrentProfile) {
        btnSaveCurrentProfile.addEventListener('click', async () => {
            const profile = collectCurrentProfileFormData()
            if (!profile) return

            if (!profile.useGlobalYaml && window.jsyaml && profile.customBaseYaml?.trim()) {
                try {
                    window.jsyaml.load(profile.customBaseYaml)
                } catch (err: any) {
                    const lineInfo = err.mark?.line !== undefined ? ` (第 ${err.mark.line + 1} 行)` : ''
                    const confirmSave = confirm(
                        `检测到自定义 Base YAML 存在语法错误${lineInfo}：\n${err.reason || err.message}\n\n确定仍要强制保存吗？`
                    )
                    if (!confirmSave) return
                }
            }

            const { profiles } = getState()
            const result = await apiRequest('/api/profiles', {
                method: 'POST',
                body: { profiles }
            })

            if (result.success) {
                showToast(`Profile「${profile.name}」配置已保存`)
                renderProfileSelect()
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 5. 重新生成 64 位 Hex Token
    const btnRegenToken = document.getElementById('btn-regen-token')
    if (btnRegenToken) {
        btnRegenToken.addEventListener('click', () => {
            const newToken = generateRandomHex(32)
            const tokenInput = document.getElementById('sub-token-input') as HTMLInputElement | null
            const urlInput = document.getElementById('sub-url-input') as HTMLInputElement | null
            const { publicOrigin, prefix } = getState()
            if (tokenInput) tokenInput.value = newToken
            if (urlInput) {
                urlInput.value = `${publicOrigin}${prefix}/sub?token=${encodeURIComponent(newToken)}`
            }
            const profile = getCurrentProfile()
            if (profile) profile.token = newToken
            showToast('已生成新的 64 位 Token，请记得点击保存')
        })
    }

    // 6. 复制订阅链接
    const btnCopySub = document.getElementById('btn-copy-sub')
    if (btnCopySub) {
        btnCopySub.addEventListener('click', async () => {
            const subUrl = (document.getElementById('sub-url-input') as HTMLInputElement | null)?.value
            if (subUrl) {
                await copyToClipboard(subUrl)
                showToast('订阅链接已复制到剪贴板')
                const originalHtml = btnCopySub.innerHTML
                btnCopySub.innerHTML = '<i class="ri-check-line"></i> 已复制'
                setTimeout(() => {
                    btnCopySub.innerHTML = originalHtml
                }, 2000)
            }
        })
    }

    // 7. 全局 Base YAML 切换开关
    const toggleGlobalYaml = document.getElementById('toggle-use-global-yaml') as HTMLInputElement | null
    if (toggleGlobalYaml) {
        toggleGlobalYaml.addEventListener('change', (e: any) => {
            const profile = getCurrentProfile()
            if (profile) profile.useGlobalYaml = e.target.checked
            renderCurrentProfile()
        })
    }

    // 8. 预览分发 YAML
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
            const data = (await apiRequest(
                `/api/preview?profileId=${encodeURIComponent(profileId)}`
            )) as { success: boolean; profileName?: string; providerCount?: number; yaml?: string; error?: string }
            if (data.success) {
                if (previewModal) previewModal.style.display = 'flex'
                if (previewTitle) {
                    previewTitle.innerHTML = `<i class="ri-file-text-line"></i> 「${data.profileName || 'Profile'}」最终分发 YAML 预览 (包含 ${data.providerCount || 0} 个订阅源)`
                }
                const previewYaml = data.yaml || ''
                if (!previewEditorView && previewContainer) {
                    previewEditorView = createEditor(previewContainer, previewYaml, true)
                } else if (previewEditorView) {
                    setEditorContent(previewEditorView, previewYaml)
                }
            } else {
                showToast(data.error || '获取预览失败', true)
            }
        })
    }

    if (btnCloseModal && previewModal) {
        btnCloseModal.addEventListener('click', () => {
            previewModal.style.display = 'none'
        })
    }
}
