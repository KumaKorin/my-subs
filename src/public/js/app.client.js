import { ProvidersComponent } from './providers.client.js'
import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1'
import { yaml } from 'https://esm.sh/@codemirror/lang-yaml@6.1.1'
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2'
import { linter, lintGutter } from 'https://esm.sh/@codemirror/lint@6.8.4'
import { EditorState } from 'https://esm.sh/@codemirror/state@6.5.2'

let providersComp = null
let currentBaseYaml = ''
let baseYamlEditorView = null
let previewEditorView = null

// YAML 语法检查诊断扩展 (基于 window.jsyaml)
const yamlLinter = linter(view => {
    const doc = view.state.doc.toString()
    const diagnostics = []
    const statusEl = document.getElementById('yaml-lint-status')

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
            statusEl.textContent = '✅ YAML 格式正确'
            statusEl.style.color = 'var(--success)'
        }
    } catch (e) {
        if (statusEl) {
            statusEl.style.display = 'inline-flex'
            const lineNum = e.mark?.line !== undefined ? e.mark.line + 1 : '?'
            statusEl.textContent = `❌ 第 ${lineNum} 行语法错误`
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

// 创建 CodeMirror 实例
function createEditor(container, doc = '', readOnly = false) {
    const extensions = [basicSetup, yaml(), oneDark, EditorView.lineWrapping]

    if (readOnly) {
        extensions.push(EditorState.readOnly.of(true))
    } else {
        extensions.push(lintGutter(), yamlLinter)
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

    // 2. Base YAML 基础配置 (Section 2 - CodeMirror 编辑器)
    currentBaseYaml = data.baseYaml || ''
    const editorContainer = document.getElementById('base-yaml-editor')
    if (editorContainer) {
        if (!baseYamlEditorView) {
            baseYamlEditorView = createEditor(editorContainer, currentBaseYaml, false)
        } else {
            setEditorContent(baseYamlEditorView, currentBaseYaml)
        }
    }

    // 3. Proxy Providers 组件挂载 (Section 1)
    const providersContainer = document.getElementById('providers-container')
    if (providersContainer) {
        providersComp = new ProvidersComponent(providersContainer, newProviders => {
            // 变化时可触发预览或标记修改
        })
        providersComp.setProviders(data.providers || [])
    }

    // 4. GitHub 代理设置开关
    const settings = data.settings || {}
    const toggleGithub = document.getElementById('toggle-proxy-github')
    const toggleGithubusercontent = document.getElementById('toggle-proxy-githubusercontent')
    if (toggleGithub) toggleGithub.checked = !!settings.proxyGithub
    if (toggleGithubusercontent) toggleGithubusercontent.checked = !!settings.proxyGithubusercontent
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
            const yaml = baseYamlEditorView ? baseYamlEditorView.state.doc.toString() : ''

            // 语法校验拦截
            if (window.jsyaml && yaml.trim()) {
                try {
                    window.jsyaml.load(yaml)
                } catch (err) {
                    const lineInfo = err.mark?.line !== undefined ? ` (第 ${err.mark.line + 1} 行)` : ''
                    const confirmSave = confirm(
                        `检测到 YAML 存在语法错误${lineInfo}：\n${err.reason || err.message}\n\n确定仍要强制保存吗？`
                    )
                    if (!confirmSave) return
                }
            }

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

    // GitHub 代理设置开关 (变更即保存)
    const toggleGithub = document.getElementById('toggle-proxy-github')
    const toggleGithubusercontent = document.getElementById('toggle-proxy-githubusercontent')
    if (toggleGithub && toggleGithubusercontent) {
        const saveSettingsRequest = async () => {
            const res = await fetch(apiUrl('/api/config/settings'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    settings: {
                        proxyGithub: toggleGithub.checked,
                        proxyGithubusercontent: toggleGithubusercontent.checked
                    }
                })
            })
            const result = await res.json()
            if (result.success) {
                showToast('GitHub 代理设置已保存，重新拉取订阅后生效')
            } else {
                showToast(result.error || '保存失败', true)
            }
        }
        toggleGithub.addEventListener('change', saveSettingsRequest)
        toggleGithubusercontent.addEventListener('change', saveSettingsRequest)
    }

    // 预览最终 YAML 弹窗
    const btnPreview = document.getElementById('btn-preview-yaml')
    const previewModal = document.getElementById('preview-modal')
    const btnCloseModal = document.getElementById('btn-close-modal')
    const previewContainer = document.getElementById('preview-editor')

    if (btnPreview) {
        btnPreview.addEventListener('click', async () => {
            const res = await fetch(apiUrl('/api/preview'))
            const data = await res.json()
            if (data.success) {
                previewModal.style.display = 'flex'
                if (!previewEditorView && previewContainer) {
                    previewEditorView = createEditor(previewContainer, data.yaml || '', true)
                } else if (previewEditorView) {
                    setEditorContent(previewEditorView, data.yaml || '')
                }
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
