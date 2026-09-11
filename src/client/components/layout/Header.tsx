import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../common/Icon'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'
import { YamlEditor } from '../editor/YamlEditor'
import { SettingsModal } from './SettingsModal'
import { useTheme } from '../../hooks/useTheme'
import { apiRequest } from '../../services/api'
import { useToast } from '../common/Toast'

export const Header: React.FC<{ prefix?: string }> = ({ prefix = '' }) => {
  const { theme, toggleTheme } = useTheme()
  const { success, error } = useToast()
  const navigate = useNavigate()

  const [previewOpen, setPreviewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [previewYaml, setPreviewYaml] = useState('')
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const handleLogout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' })
    success('已成功退出登录')
    setTimeout(() => {
      navigate('/login')
    }, 400)
  }

  const handleOpenPreview = async () => {
    setPreviewLoading(true)
    try {
      const res = await apiRequest<{ yaml?: string; profileName?: string; providerCount?: number }>(
        '/api/config/preview'
      )
      const payload = res.data || (res as any)
      if (res.success && payload && typeof payload.yaml === 'string') {
        setPreviewYaml(payload.yaml || '')
        setPreviewTitle(`「${payload.profileName || '默认'}」预览 (挂载 ${payload.providerCount || 0} 个源)`)
        setPreviewOpen(true)
      } else {
        error(res.error || '获取分发 YAML 失败')
      }
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <>
      <header className="flex items-center justify-between px-6 h-14 bg-card border-b border-border sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
            <Icon name="ri-flashlight-fill" />
          </div>
          <span className="font-bold text-base tracking-tight text-foreground">
            mySubs <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded font-mono">v2.0</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={theme === 'dark' ? 'ri-sun-line' : 'ri-moon-line'}
            onClick={toggleTheme}
            title="切换深浅主题"
          />

          <Button
            variant="secondary"
            size="sm"
            icon="ri-settings-3-line"
            onClick={() => setSettingsOpen(true)}
            title="全局请求代理与 GitHub 加速设置"
          >
            代理配置
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon="ri-eye-line"
            loading={previewLoading}
            onClick={handleOpenPreview}
          >
            预览分发
          </Button>

          <Button
            variant="danger"
            size="sm"
            icon="ri-logout-box-r-line"
            onClick={handleLogout}
          >
            退出
          </Button>
        </div>
      </header>

      {/* 全局代理与 GitHub 加速配置 Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 预览 YAML Modal */}
      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={
          <span className="flex items-center gap-2 font-mono text-sm">
            <Icon name="ri-file-text-line text-primary" /> {previewTitle}
          </span>
        }
        maxWidth="4xl"
        footer={
          <div className="flex justify-between items-center w-full">
            <span className="text-xs text-muted-foreground font-mono">
              只读预览模式：此内容为客户端请求 /sub 时动态下发的完整配置
            </span>
            <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(false)}>
              关闭
            </Button>
          </div>
        }
      >
        <YamlEditor value={previewYaml} readOnly height="62vh" showLintStatus={false} />
      </Modal>
    </>
  )
}
