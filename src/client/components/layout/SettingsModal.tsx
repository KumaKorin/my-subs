import React, { useState, useEffect } from 'react'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { Icon } from '../common/Icon'
import { apiRequest } from '../../services/api'
import { useToast } from '../common/Toast'
import { useAppData } from '../../context/DataContext'
import { SystemSettings } from '../../types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { data, setSettings } = useAppData()
  const { success, error } = useToast()

  const [proxyUrlTemplate, setProxyUrlTemplate] = useState('')
  const [githubProxyMode, setGithubProxyMode] = useState<'none' | 'worker' | 'proxy'>('none')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (isOpen) {
      setProxyUrlTemplate(data?.settings?.proxyUrlTemplate || '')
      setGithubProxyMode(data?.settings?.githubProxyMode || 'none')
      setTestResult(null)
    }
  }, [isOpen, data?.settings])

  const hasProxyConfigured = !!proxyUrlTemplate.trim() && proxyUrlTemplate.includes('{url}')

  const handleTestProxy = async () => {
    if (!hasProxyConfigured) {
      error('请输入合法的代理模板，必须包含 {url} 占位符')
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const res = await apiRequest<{ status: number; durationMs: number }>('/api/config/test-proxy', {
        method: 'POST',
        body: JSON.stringify({ proxyUrlTemplate: proxyUrlTemplate.trim() })
      })
      if (res.success && res.data) {
        setTestResult({
          success: true,
          msg: `代理测试成功！HTTP 状态码: ${res.data.status}，连通耗时: ${res.data.durationMs}ms`
        })
        success('代理连通性测试通过')
      } else {
        setTestResult({
          success: false,
          msg: res.error || '代理测试失败'
        })
        error(res.error || '代理测试失败')
      }
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    // 限制：在没有配置 Proxy 代理的情况下，不允许设置 Proxy 代理
    let actualGhMode = githubProxyMode
    if (githubProxyMode === 'proxy' && !hasProxyConfigured) {
      error('尚未配置有效的请求代理模板，无法启用 Proxy 模式！')
      return
    }

    setSaving(true)
    try {
      const newSettings: SystemSettings = {
        proxyUrlTemplate: proxyUrlTemplate.trim(),
        githubProxyMode: actualGhMode
      }
      const res = await apiRequest('/api/config/settings', {
        method: 'POST',
        body: JSON.stringify(newSettings)
      })
      if (res.success) {
        setSettings(newSettings)
        success('系统全局代理设置已保存并生效')
        onClose()
      } else {
        error(res.error || '保存设置失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 font-mono text-sm">
          <Icon name="ri-settings-line text-primary" />
          <span>全局请求代理与 GitHub 加速设置</span>
        </div>
      }
      maxWidth="xl"
      footer={
        <div className="flex justify-end items-center gap-2 w-full">
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" icon="ri-save-line" loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 py-1">
        {/* 1. 请求代理配置 */}
        <div className="p-4 rounded-xl bg-muted/20 border border-border flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Icon name="ri-server-line text-primary" /> 自定义请求代理服务 (Request Proxy)
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            用于解决 Cloudflare Worker 无法直接访问自签名 IP 或套了 CF 盾的节点源。格式必须包含{' '}
            <code className="bg-muted px-1.5 py-0.5 rounded text-primary font-mono">{'{url}'}</code> 占位符。
          </p>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                placeholder="https://proxy.example.com/secret?url={url}"
                value={proxyUrlTemplate}
                onChange={e => {
                  setProxyUrlTemplate(e.target.value)
                  setTestResult(null)
                }}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon="ri-pulse-line"
              loading={testing}
              disabled={!hasProxyConfigured}
              onClick={handleTestProxy}
            >
              测试连通
            </Button>
          </div>

          {testResult && (
            <div
              className={`p-2.5 rounded-lg text-xs font-mono flex items-center gap-2 ${
                testResult.success
                  ? 'bg-success/10 text-success border border-success/20'
                  : 'bg-danger/10 text-danger border border-danger/20'
              }`}
            >
              <Icon name={testResult.success ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
              <span>{testResult.msg}</span>
            </div>
          )}
        </div>

        {/* 2. GitHub 规则集加速代理 */}
        <div className="p-4 rounded-xl bg-muted/20 border border-border flex flex-col gap-3">
          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Icon name="ri-github-line text-primary" /> GitHub 规则集加速分发
          </span>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            自动代理 Base YAML 中的 GitHub 规则集下载链接（raw.githubusercontent.com 与 github.com release）：
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setGithubProxyMode('none')}
              className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                githubProxyMode === 'none'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <span className="text-xs font-bold">关闭加速</span>
              <span className="text-[10px] opacity-75">直连原始 GitHub 链接</span>
            </button>

            <button
              type="button"
              onClick={() => setGithubProxyMode('worker')}
              className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                githubProxyMode === 'worker'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <span className="text-xs font-bold">Worker 代理</span>
              <span className="text-[10px] opacity-75">由 Worker 自身中转加速</span>
            </button>

            <button
              type="button"
              disabled={!hasProxyConfigured}
              onClick={() => {
                if (hasProxyConfigured) {
                  setGithubProxyMode('proxy')
                }
              }}
              className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                !hasProxyConfigured
                  ? 'opacity-40 cursor-not-allowed border-border text-muted-foreground'
                  : githubProxyMode === 'proxy'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <span className="text-xs font-bold flex items-center justify-between">
                Proxy 代理
                {!hasProxyConfigured && <span className="text-[9px] text-danger font-mono font-normal">未配置</span>}
              </span>
              <span className="text-[10px] opacity-75">
                {!hasProxyConfigured ? '需先配置上方请求代理' : '使用自定义请求代理'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
