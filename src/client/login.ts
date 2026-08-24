/**
 * 登录页 TypeScript 脚本
 */
import { apiRequest } from './api.js'
import { showToast } from './ui.js'

const basePrefix = window.__BASE_PREFIX__ || ''

document.addEventListener('DOMContentLoaded', () => {
    // 1. 主题切换逻辑
    const btnTheme = document.getElementById('btn-login-theme-toggle')
    const themeIcon = document.getElementById('login-theme-icon')
    function updateLoginThemeIcon(theme: string) {
        if (themeIcon) {
            themeIcon.className = theme === 'light' ? 'ri-moon-line' : 'ri-sun-line'
        }
    }
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark'
    updateLoginThemeIcon(currentTheme)

    if (btnTheme) {
        btnTheme.addEventListener('click', () => {
            const now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
            document.documentElement.setAttribute('data-theme', now)
            localStorage.setItem('theme', now)
            updateLoginThemeIcon(now)
        })
    }

    // 2. 密码可见性切换
    const btnTogglePwd = document.getElementById('btn-toggle-pwd')
    const tokenInput = document.getElementById('admin-token-input') as HTMLInputElement | null
    const togglePwdIcon = document.getElementById('toggle-pwd-icon')
    if (btnTogglePwd && tokenInput) {
        btnTogglePwd.addEventListener('click', () => {
            const isPassword = tokenInput.type === 'password'
            tokenInput.type = isPassword ? 'text' : 'password'
            if (togglePwdIcon) {
                togglePwdIcon.className = isPassword ? 'ri-eye-off-line' : 'ri-eye-line'
            }
        })
    }

    // 3. 表单登录提交
    const loginForm = document.getElementById('login-form')
    const btnSubmit = document.getElementById('btn-submit-login') as HTMLButtonElement | null

    if (loginForm) {
        loginForm.addEventListener('submit', async e => {
            e.preventDefault()
            const token = tokenInput ? tokenInput.value.trim() : ''
            if (!token) return

            if (btnSubmit) {
                btnSubmit.disabled = true
                btnSubmit.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> <span>验证中...</span>'
            }

            try {
                const result = await apiRequest('/api/login', {
                    method: 'POST',
                    body: { token }
                })

                if (result.success) {
                    showToast('登录成功，正在进入控制台...')
                    setTimeout(() => {
                        window.location.href = `${basePrefix}/control`
                    }, 400)
                } else {
                    showToast(result.error || 'Token 验证失败，请检查密码', true)
                    if (btnSubmit) {
                        btnSubmit.disabled = false
                        btnSubmit.innerHTML = '<span>进入管理面板</span> <i class="ri-arrow-right-line"></i>'
                    }
                }
            } catch {
                showToast('网络请求异常，请稍后重试', true)
                if (btnSubmit) {
                    btnSubmit.disabled = false
                    btnSubmit.innerHTML = '<span>进入管理面板</span> <i class="ri-arrow-right-line"></i>'
                }
            }
        })
    }
})
