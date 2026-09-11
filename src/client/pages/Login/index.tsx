import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { Button } from '../../components/common/Button'
import { Input } from '../../components/common/Input'
import { apiRequest } from '../../services/api'
import { useToast } from '../../components/common/Toast'

export const LoginPage: React.FC = () => {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { success, error } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return

    setLoading(true)
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() })
      })

      if (res.success) {
        success('登录成功，正在进入控制台...')
        setTimeout(() => {
          navigate('/profiles')
        }, 300)
      } else {
        error(res.error || 'Token 验证失败')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md bg-card border border-card-border rounded-2xl p-8 shadow-xl">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold mb-3">
            <Icon name="ri-flashlight-fill" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Clash 订阅分发控制台</h1>
          <p className="text-xs text-muted-foreground mt-1">请输入管理员 ADMIN_TOKEN 访问后台</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            type="password"
            label="管理员密钥 (ADMIN_TOKEN)"
            placeholder="输入管理员密码..."
            value={token}
            onChange={e => setToken(e.target.value)}
            autoFocus
            required
          />

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            icon="ri-login-box-line"
            className="w-full mt-2"
          >
            安全登录
          </Button>
        </form>

        <div className="mt-8 pt-4 border-t border-border/50 text-center">
          <span className="text-[11px] font-mono text-muted-foreground">
            mySubs v2.0 • Cloudflare Serverless Architecture
          </span>
        </div>
      </div>
    </div>
  )
}
