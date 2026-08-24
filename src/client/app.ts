/**
 * 控制台主入口 (Client Entry Point)
 */
import { getState, setState, getCurrentProfileId, setCurrentProfileId, getCurrentProfile } from './state.js'
import { showToast } from './ui.js'
import { apiRequest, getBasePrefix } from './api.js'
import { createEditor, setEditorContent } from './editor.js'
import { ProvidersComponent } from './providers.js'
import {
    renderProfileSelect,
    renderCurrentProfile,
    renderProfileProvidersList,
    bindProfileEvents,
    collectCurrentProfileFormData
} from './profiles.js'
import { bindLogsEvents, startLogsPolling, stopLogsPolling } from './logs.js'
import { AppData, Profile, Provider } from '../types/index.js'

let poolProvidersComp: ProvidersComponent | null = null
let globalYamlEditorView: any = null

function renderPoolProviders(): void {
    const container = document.getElementById('pool-providers-container')
    if (!container) return

    const { providersPool } = getState()
    if (!poolProvidersComp) {
        poolProvidersComp = new ProvidersComponent(container, (updatedProviders: Provider[]) => {
            setState({ providersPool: updatedProviders })
        })
    }
    poolProvidersComp.setProviders(providersPool || [])
}

function renderAll(): void {
    renderProfileSelect()
    renderCurrentProfile()
    renderPoolProviders()
}

async function initApp(): Promise<void> {
    try {
        const resData = await apiRequest<AppData>('/api/data')
        if (resData.success && resData.data) {
            setState(resData.data)

            const { profiles } = getState()
            const currentId = getCurrentProfileId()
            if (!currentId || !profiles.find((p: Profile) => p.id === currentId)) {
                setCurrentProfileId(profiles[0]?.id || null)
            }

            renderAll()
        } else {
            showToast(`加载数据失败: ${resData.error || '未知错误'}`, true)
        }
    } catch (e: any) {
        showToast(`网络或数据异常: ${e.message}`, true)
    }
}

function switchTab(tabId: string): void {
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
        startLogsPolling()
    } else {
        stopLogsPolling()
    }

    if (tabId === 'tab-profiles') {
        const profile = getCurrentProfile()
        if (profile) renderProfileProvidersList(profile)
    }
}

function bindGlobalEvents(): void {
    const basePrefix = getBasePrefix()

    // 1. 主题切换
    const btnThemeToggle = document.getElementById('btn-theme-toggle')
    const themeToggleIcon = document.getElementById('theme-toggle-icon')
    function updateThemeIcon(theme: string) {
        if (themeToggleIcon) {
            themeToggleIcon.className = theme === 'light' ? 'ri-moon-line' : 'ri-sun-line'
        }
    }
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark'
    updateThemeIcon(currentTheme)

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
            document.documentElement.setAttribute('data-theme', now)
            localStorage.setItem('theme', now)
            updateThemeIcon(now)
            showToast(now === 'light' ? '已切换至浅色模式' : '已切换至深色模式')
        })
    }

    // 2. 退出登录
    const btnLogout = document.getElementById('btn-logout')
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await apiRequest('/api/logout', { method: 'POST' })
            showToast('已退出登录，正在跳转...')
            setTimeout(() => {
                window.location.href = `${basePrefix}/login`
            }, 300)
        })
    }

    // 3. Tab 导航切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab') || ''
            switchTab(target)
        })
    })

    const btnGotoPool = document.getElementById('btn-goto-providers-tab')
    if (btnGotoPool) {
        btnGotoPool.addEventListener('click', () => switchTab('tab-providers'))
    }

    // 4. Provider 资源池管理 (Tab 2)
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

            const result = await apiRequest<{ providers?: Provider[] }>('/api/providers-pool', {
                method: 'POST',
                body: { providers }
            })

            if (result.success) {
                setState({ providersPool: (result.providers || providers) as Provider[] })
                showToast('Provider 资源池已保存')
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 5. 全局 Base YAML 维护弹窗
    const btnOpenGlobalYaml = document.getElementById('btn-open-global-yaml')
    const btnBannerEditGlobal = document.getElementById('btn-banner-edit-global')
    const globalModal = document.getElementById('global-yaml-modal')
    const btnCloseGlobalModal = document.getElementById('btn-close-global-yaml-modal')
    const btnSaveGlobalYaml = document.getElementById('btn-save-global-yaml')
    const globalEditorContainer = document.getElementById('global-yaml-editor')

    const openGlobalModal = () => {
        if (globalModal) globalModal.style.display = 'flex'
        const { globalBaseYaml } = getState()
        if (!globalYamlEditorView && globalEditorContainer) {
            globalYamlEditorView = createEditor(
                globalEditorContainer,
                globalBaseYaml || '',
                false,
                'global-yaml-lint-status'
            )
        } else if (globalYamlEditorView) {
            setEditorContent(globalYamlEditorView, globalBaseYaml || '')
        }
    }

    if (btnOpenGlobalYaml) btnOpenGlobalYaml.addEventListener('click', openGlobalModal)
    if (btnBannerEditGlobal) btnBannerEditGlobal.addEventListener('click', openGlobalModal)

    if (btnCloseGlobalModal && globalModal) {
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
                } catch (err: any) {
                    const lineInfo = err.mark?.line !== undefined ? ` (第 ${err.mark.line + 1} 行)` : ''
                    const confirmSave = confirm(
                        `检测到全局 Base YAML 存在语法错误${lineInfo}：\n${err.reason || err.message}\n\n确定仍要强制保存吗？`
                    )
                    if (!confirmSave) return
                }
            }

            const result = await apiRequest('/api/global-base-yaml', {
                method: 'POST',
                body: { yaml }
            })

            if (result.success) {
                setState({ globalBaseYaml: yaml })
                showToast('全局 Base YAML 保存成功')
                if (globalModal) globalModal.style.display = 'none'
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 6. 绑定 Profile 模块与日志模块事件
    bindProfileEvents()
    bindLogsEvents()
}

document.addEventListener('DOMContentLoaded', () => {
    bindGlobalEvents()
    initApp()
})
