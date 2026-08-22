import { ProvidersComponent } from './providers.client.js'

let providersComp = null
let currentBaseYaml = ''

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

// 检查登录状态并加载数据
async function initApp() {
    const loginSection = document.getElementById('login-section')
    const appSection = document.getElementById('app-section')

    try {
        const res = await fetch(apiUrl('/api/config'))
        if (res.status === 401) {
            loginSection.style.display = 'flex'
            appSection.style.display = 'none'
            return
        }

        const data = await res.json()
        if (data.success) {
            loginSection.style.display = 'none'
            appSection.style.display = 'block'
            renderDashboard(data.data)
        } else {
            loginSection.style.display = 'flex'
            appSection.style.display = 'none'
        }
    } catch (e) {
        loginSection.style.display = 'flex'
        appSection.style.display = 'none'
    }
}

function renderDashboard(data) {
    // 1. 订阅链接和 Token
    const subUrlInput = document.getElementById('sub-url-input')
    const subTokenInput = document.getElementById('sub-token-input')
    if (subUrlInput) subUrlInput.value = data.subUrl || ''
    if (subTokenInput) subTokenInput.value = data.subToken || ''

    // 2. Base YAML 基础配置 (Section 2)
    const yamlTextarea = document.getElementById('base-yaml-textarea')
    if (yamlTextarea) {
        yamlTextarea.value = data.baseYaml || ''
        currentBaseYaml = data.baseYaml || ''
    }

    // 3. Proxy Providers 组件挂载 (Section 1)
    const providersContainer = document.getElementById('providers-container')
    if (providersContainer) {
        providersComp = new ProvidersComponent(providersContainer, newProviders => {
            // 变化时可触发预览或标记修改
        })
        providersComp.setProviders(data.providers || [])
    }
}

// 绑定全局事件
function bindGlobalEvents() {
    // 登录表单
    const loginForm = document.getElementById('login-form')
    if (loginForm) {
        loginForm.addEventListener('submit', async e => {
            e.preventDefault()
            const token = document.getElementById('admin-token-input').value.trim()
            if (!token) return

            const res = await fetch(apiUrl('/api/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            })

            const result = await res.json()
            if (result.success) {
                showToast('登录成功')
                initApp()
            } else {
                showToast(result.error || '登录失败', true)
            }
        })
    }

    // 退出登录
    const btnLogout = document.getElementById('btn-logout')
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await fetch(apiUrl('/api/logout'), { method: 'POST' })
            showToast('已退出登录')
            initApp()
        })
    }

    // 添加 Provider 按钮
    const btnAddProvider = document.getElementById('btn-add-provider')
    if (btnAddProvider) {
        btnAddProvider.addEventListener('click', () => {
            if (providersComp) providersComp.addProvider()
        })
    }

    // 保存 Provider (AES 加密)
    const btnSaveProviders = document.getElementById('btn-save-providers')
    if (btnSaveProviders) {
        btnSaveProviders.addEventListener('click', async () => {
            if (!providersComp) return
            const providers = providersComp.getProviders()

            const res = await fetch(apiUrl('/api/config/providers'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providers })
            })
            const result = await res.json()
            if (result.success) {
                showToast('Proxy Providers 已加密保存')
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 保存 Base YAML
    const btnSaveYaml = document.getElementById('btn-save-yaml')
    if (btnSaveYaml) {
        btnSaveYaml.addEventListener('click', async () => {
            const yaml = document.getElementById('base-yaml-textarea').value
            const res = await fetch(apiUrl('/api/config/base-yaml'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml })
            })
            const result = await res.json()
            if (result.success) {
                showToast('基础 YAML 保存成功')
            } else {
                showToast(result.error || '保存失败', true)
            }
        })
    }

    // 更新 Token
    const btnUpdateToken = document.getElementById('btn-update-token')
    if (btnUpdateToken) {
        btnUpdateToken.addEventListener('click', async () => {
            const token = document.getElementById('sub-token-input').value.trim()
            if (!token) {
                showToast('Token 不能为空', true)
                return
            }
            const res = await fetch(apiUrl('/api/config/sub-token'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            })
            const result = await res.json()
            if (result.success) {
                document.getElementById('sub-url-input').value = result.subUrl
                showToast('订阅 Token 已加密更新')
            } else {
                showToast(result.error || '更新失败', true)
            }
        })
    }

    // 复制订阅链接
    const btnCopySub = document.getElementById('btn-copy-sub')
    if (btnCopySub) {
        btnCopySub.addEventListener('click', () => {
            const subUrl = document.getElementById('sub-url-input').value
            if (subUrl) {
                navigator.clipboard.writeText(subUrl)
                showToast('订阅链接已复制到剪贴板')
            }
        })
    }

    // 预览最终 YAML 弹窗
    const btnPreview = document.getElementById('btn-preview-yaml')
    const previewModal = document.getElementById('preview-modal')
    const btnCloseModal = document.getElementById('btn-close-modal')
    const previewContent = document.getElementById('preview-content')

    if (btnPreview) {
        btnPreview.addEventListener('click', async () => {
            const res = await fetch(apiUrl('/api/preview'))
            const data = await res.json()
            if (data.success) {
                previewContent.textContent = data.yaml
                previewModal.style.display = 'flex'
            }
        })
    }

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            previewModal.style.display = 'none'
        })
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindGlobalEvents()
    initApp()
})
