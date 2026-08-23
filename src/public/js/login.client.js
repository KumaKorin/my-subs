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

document.addEventListener('DOMContentLoaded', () => {
    // 主题切换逻辑
    const btnTheme = document.getElementById('btn-login-theme-toggle')
    const themeIcon = document.getElementById('login-theme-icon')
    function updateLoginThemeIcon(theme) {
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

    const loginForm = document.getElementById('login-form')
    if (loginForm) {
        loginForm.addEventListener('submit', async e => {
            e.preventDefault()
            const token = document.getElementById('admin-token-input').value.trim()
            if (!token) return

            try {
                const res = await fetch(apiUrl('/api/login'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                })

                const result = await res.json()
                if (result.success) {
                    showToast('登录成功，正在跳转...')
                    setTimeout(() => {
                        window.location.href = `${basePrefix}/control`
                    }, 500)
                } else {
                    showToast(result.error || '登录失败', true)
                }
            } catch (err) {
                showToast('网络错误，请稍后重试', true)
            }
        })
    }
})
