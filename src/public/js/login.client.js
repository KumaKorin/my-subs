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
