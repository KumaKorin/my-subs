import React, { useState, useEffect } from 'react'
import { useAppData } from '../../context/DataContext'
import { Profile, ProfileProxySettings, ProfileProviderOverride } from '../../types'
import { Icon } from '../../components/common/Icon'
import { Button } from '../../components/common/Button'
import { Input } from '../../components/common/Input'
import { Switch } from '../../components/common/Switch'
import { Select } from '../../components/common/Select'
import { YamlEditor } from '../../components/editor/YamlEditor'
import { apiRequest } from '../../services/api'
import { useToast } from '../../components/common/Toast'
import { useDialog } from '../../context/DialogContext'
import { Modal } from '../../components/common/Modal'
import { Link } from 'react-router-dom'

function generateHexToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export const ProfilesPage: React.FC = () => {
  const { data, setProfiles } = useAppData()
  const { success, error } = useToast()
  const { confirm, prompt, alert } = useDialog()

  const profiles = data?.profiles || []
  const providersPool = data?.providersPool || []
  const publicOrigin = data?.publicOrigin || window.location.origin
  const prefix = data?.prefix || ''
  const globalSettings = data?.settings || {}

  const [currentId, setCurrentId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isUrlHovered, setIsUrlHovered] = useState(false)

  // 当前选中的 profile
  const currentProfile = profiles.find(p => p.id === currentId) || profiles[0] || null

  useEffect(() => {
    if (!currentId && profiles.length > 0) {
      setCurrentId(profiles[0].id)
    }
  }, [profiles, currentId])

  // 更新当前 profile 属性
  const updateCurrentProfile = (fields: Partial<Profile>) => {
    if (!currentProfile) return
    const updated = profiles.map(p => (p.id === currentProfile.id ? { ...p, ...fields } : p))
    setProfiles(updated)
  }

  // 更新当前 Profile 专属代理设置
  const updateProxySettings = (partial: Partial<ProfileProxySettings>) => {
    if (!currentProfile) return
    const currentSettings = currentProfile.settings || {}
    const currentProxy = currentSettings.proxySettings || { mode: 'inherit' }
    updateCurrentProfile({
      settings: {
        ...currentSettings,
        proxySettings: {
          ...currentProxy,
          ...partial
        }
      }
    })
  }

  // 更新当前 Profile 下某个 Provider 的差分配置
  const updateProviderOverride = (providerId: string, partial: Partial<ProfileProviderOverride>) => {
    if (!currentProfile) return
    const currentSettings = currentProfile.settings || {}
    const currentOverrides = currentSettings.providerOverrides || {}
    const existing = currentOverrides[providerId] || {}
    updateCurrentProfile({
      settings: {
        ...currentSettings,
        providerOverrides: {
          ...currentOverrides,
          [providerId]: {
            ...existing,
            ...partial
          }
        }
      }
    })
  }

  const [credentialModalOpen, setCredentialModalOpen] = useState(false)

  // 真实完整订阅链接
  const realSubUrl = currentProfile
    ? `${publicOrigin}${prefix}/sub?token=${encodeURIComponent(currentProfile.token || '')}`
    : ''

  // 复制订阅链接 (始终复制真实链接)
  const handleCopySubUrl = async () => {
    if (!realSubUrl) return
    await navigator.clipboard.writeText(realSubUrl)
    setCopied(true)
    success('完整分发订阅链接已复制到剪贴板')
    setTimeout(() => setCopied(false), 2000)
  }

  // 点击刷新生成新 Token (带确认 Modal)
  const handleRegenToken = async () => {
    const confirmed = await confirm({
      title: '重置订阅 Token 确认',
      message: '确定要为当前 Profile 生成新的安全 Token 吗？\n\n⚠️ 重置后旧的订阅链接将立即失效，需要在客户端重新配置订阅地址。',
      variant: 'danger',
      confirmText: '确认重置'
    })
    if (!confirmed) return

    const newToken = generateHexToken(32)
    updateCurrentProfile({ token: newToken })
    success('已生成新的安全 Token，请记得点击右上角保存生效')
  }

  // 新建 Profile (使用统一 Modal Prompt)
  const handleCreateProfile = async () => {
    const name = await prompt({
      title: '新建 Profile 订阅配置',
      message: '请输入新 Profile 的名称：',
      defaultValue: `Profile_${profiles.length + 1}`,
      placeholder: '例如: 我的手机订阅 / 备用节点组'
    })

    if (!name || !name.trim()) return

    const newP: Profile = {
      id: crypto.randomUUID(),
      name: name.trim(),
      token: generateHexToken(32),
      useGlobalYaml: true,
      customBaseYaml: '',
      enabledProviderIds: providersPool.map(p => p.id),
      settings: {},
      createdAt: Date.now()
    }

    const updated = [...profiles, newP]
    setProfiles(updated)
    setCurrentId(newP.id)
    success(`已创建「${newP.name}」，请点击保存提交到服务端`)
  }

  // 删除 Profile (使用统一 Modal Confirm)
  const handleDeleteProfile = async () => {
    if (!currentProfile) return
    if (profiles.length <= 1) {
      await alert('至少需要保留一个 Profile 订阅配置', '无法删除')
      return
    }

    const confirmed = await confirm({
      title: '删除订阅配置确认',
      message: `确定要彻底删除 Profile 配置「${currentProfile.name}」吗？删除后该订阅链接将立即失效！`,
      variant: 'danger',
      confirmText: '确认删除'
    })

    if (confirmed) {
      const remaining = profiles.filter(p => p.id !== currentProfile.id)
      setProfiles(remaining)
      setCurrentId(remaining[0].id)
      success(`已删除「${currentProfile.name}」，请点击保存提交到服务端`)
    }
  }

  // 切换 Provider 挂载状态
  const toggleProvider = (providerId: string, enabled: boolean) => {
    if (!currentProfile) return
    let ids = [...(currentProfile.enabledProviderIds || [])]
    if (enabled) {
      if (!ids.includes(providerId)) ids.push(providerId)
    } else {
      ids = ids.filter(id => id !== providerId)
    }
    updateCurrentProfile({ enabledProviderIds: ids })
  }

  // 保存所有配置
  const handleSave = async () => {
    // 校验当前 Profile 的代理设置
    const proxySettings = currentProfile?.settings?.proxySettings
    if (proxySettings?.mode === 'custom' && proxySettings.githubProxyMode === 'proxy') {
      if (!proxySettings.proxyUrlTemplate || !proxySettings.proxyUrlTemplate.includes('{url}')) {
        await alert(
          '在没有配置包含 {url} 的有效 Proxy 代理模板的情况下，不允许将 GitHub 加速设置为请求代理模式。',
          '配置校验失败'
        )
        return
      }
    }

    setSaving(true)
    try {
      const res = await apiRequest('/api/profiles', {
        method: 'POST',
        body: JSON.stringify({ profiles })
      })

      if (res.success) {
        success('Profile 订阅配置已成功持久化')
      } else {
        error(res.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!currentProfile) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>暂无 Profile，请点击新建配置</p>
        <Button variant="primary" className="mt-4" onClick={handleCreateProfile}>
          新建 Profile
        </Button>
      </div>
    )
  }

  const enabledSet = new Set(currentProfile.enabledProviderIds || [])

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部操作与 Profile 切换条 */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-card border border-card-border shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
            当前 Profile:
          </span>
          <Select
            value={currentId}
            onChange={val => setCurrentId(val)}
            options={profiles.map(p => ({
              value: p.id,
              label: p.name || '未命名 Profile',
              icon: 'ri-user-settings-line'
            }))}
            width="w-[190px]"
            size="sm"
          />

          <Button variant="secondary" size="sm" icon="ri-add-line" onClick={handleCreateProfile}>
            新建
          </Button>
          <Button variant="danger" size="sm" icon="ri-delete-bin-line" onClick={handleDeleteProfile}>
            删除
          </Button>
        </div>

        <Button
          variant="primary"
          size="md"
          icon="ri-save-line"
          loading={saving}
          onClick={handleSave}
        >
          保存当前配置
        </Button>
      </div>

      {/* 配置基本信息 (随时改名) 与 订阅快捷操作栏 */}
      <div className="p-5 rounded-xl bg-card border border-card-border shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Profile 改名输入区 */}
        <div className="flex-1 w-full sm:max-w-md flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Icon name="ri-edit-line text-primary" /> Profile 配置名称 (随时修改)
          </label>
          <input
            type="text"
            value={currentProfile.name || ''}
            onChange={e => updateCurrentProfile({ name: e.target.value })}
            placeholder="例如: 默认配置 / iOS设备专线"
            className="w-full bg-muted/50 border border-border rounded-lg px-3.5 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
          />
        </div>

        {/* 订阅操作区: 复制订阅, 重置 TOKEN, 小眼睛查看凭证 */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end flex-wrap pt-2 sm:pt-0">
          <Button
            variant="primary"
            size="md"
            icon={copied ? 'ri-check-line' : 'ri-file-copy-line'}
            onClick={handleCopySubUrl}
            title="一键复制完整 Clash 分发订阅链接"
          >
            {copied ? '已复制' : '复制订阅'}
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon="ri-refresh-line"
            onClick={handleRegenToken}
            title="重置当前 Profile 的 64 位安全 Token"
          >
            重置 TOKEN
          </Button>

          <button
            type="button"
            onClick={() => setCredentialModalOpen(true)}
            className="p-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center text-base"
            title="点击查看完整订阅凭证详情 (包含订阅 URL 与完整 Token)"
          >
            <Icon name="ri-eye-line" />
          </button>
        </div>
      </div>

      {/* 订阅凭证详情 Modal (小眼睛触发) */}
      <Modal
        isOpen={credentialModalOpen}
        onClose={() => setCredentialModalOpen(false)}
        title={
          <div className="flex items-center gap-2 font-mono text-sm">
            <Icon name="ri-shield-keyhole-line text-primary" />
            <span>「{currentProfile.name}」分发凭证详情</span>
          </div>
        }
        maxWidth="2xl"
        footer={
          <div className="flex justify-end w-full">
            <Button variant="secondary" size="sm" onClick={() => setCredentialModalOpen(false)}>
              关闭
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>完整分发订阅链接 (客户端拉取地址)</span>
              <button
                type="button"
                onClick={handleCopySubUrl}
                className="text-xs text-primary hover:underline flex items-center gap-1 font-sans cursor-pointer"
              >
                <Icon name="ri-file-copy-line" /> 复制链接
              </button>
            </label>
            <textarea
              readOnly
              rows={3}
              value={realSubUrl}
              className="w-full bg-muted/70 border border-border rounded-lg p-2.5 text-xs font-mono text-foreground select-all focus:outline-hidden"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>64 位随机安全 Token</span>
              <button
                type="button"
                onClick={async () => {
                  if (currentProfile.token) {
                    await navigator.clipboard.writeText(currentProfile.token)
                    success('Token 已复制到剪贴板')
                  }
                }}
                className="text-xs text-primary hover:underline flex items-center gap-1 font-sans cursor-pointer"
              >
                <Icon name="ri-file-copy-line" /> 复制 Token
              </button>
            </label>
            <input
              type="text"
              readOnly
              value={currentProfile.token || ''}
              className="w-full bg-muted/70 border border-border rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground select-all focus:outline-hidden"
            />
          </div>

          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
            <Icon name="ri-information-line text-primary text-base mt-0.5 shrink-0" />
            <div>
              该 Token 用于在边缘 Worker 鉴权，客户端直接将订阅链接导入 Clash / Mihomo / Stash 等客户端即可自动同步最新节点与规则。若发生泄漏，可点击主界面的「重置 TOKEN」按钮立即吊销旧凭证。
            </div>
          </div>
        </div>
      </Modal>

      {/* Profile 专属代理与加速差分配置 */}
      <div className="p-5 rounded-xl bg-card border border-card-border shadow-sm flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-lg">
              <Icon name="ri-git-merge-line" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Profile 专属代理与加速差分配置</h3>
              <p className="text-xs text-muted-foreground">可直接继承全局系统设置，或为当前 Profile 独立定制请求代理与 GitHub 规则加速</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-muted p-1 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => updateProxySettings({ mode: 'inherit' })}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                (currentProfile.settings?.proxySettings?.mode || 'inherit') === 'inherit'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              继承全局设置
            </button>
            <button
              type="button"
              onClick={() => updateProxySettings({ mode: 'custom' })}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                currentProfile.settings?.proxySettings?.mode === 'custom'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              手动独立配置
            </button>
          </div>
        </div>

        {(currentProfile.settings?.proxySettings?.mode || 'inherit') === 'inherit' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 rounded-lg bg-muted/40 border border-border text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground font-medium">当前继承全局请求代理模板:</span>
              <span className="font-mono text-foreground break-all">
                {globalSettings.proxyUrlTemplate || '(未配置全局代理服务)'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground font-medium">当前继承全局 GitHub 加速模式:</span>
              <span className="font-medium text-foreground">
                {globalSettings.githubProxyMode === 'worker'
                  ? '⚡ Cloudflare Worker 代理加速'
                  : globalSettings.githubProxyMode === 'proxy'
                  ? '🚀 请求代理服务加速'
                  : '直连 GitHub (不加速)'}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Profile 专属请求代理服务模板 (proxyUrlTemplate)</span>
                {currentProfile.settings?.proxySettings?.proxyUrlTemplate && (
                  <span className="text-[11px] text-green-500 flex items-center gap-1">
                    <Icon name="ri-checkbox-circle-line" /> 已配置独立代理
                  </span>
                )}
              </label>
              <input
                type="text"
                value={currentProfile.settings?.proxySettings?.proxyUrlTemplate || ''}
                onChange={e => updateProxySettings({ proxyUrlTemplate: e.target.value })}
                placeholder="例如: https://proxy.example.com/secret?url={url}"
                className="w-full bg-muted/50 border border-border rounded-lg px-3.5 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
              <span className="text-[11px] text-muted-foreground">
                必须包含 <code className="text-primary font-mono">{'{url}'}</code> 占位符。本 Profile 下启用请求代理的 Provider 源或规则集拉取将优先使用此模板。
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-foreground">
                Profile 专属 GitHub 规则集加速模式
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                    (currentProfile.settings?.proxySettings?.githubProxyMode || 'none') === 'none'
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-muted/20 hover:bg-muted/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="profileGhProxyMode"
                    checked={(currentProfile.settings?.proxySettings?.githubProxyMode || 'none') === 'none'}
                    onChange={() => updateProxySettings({ githubProxyMode: 'none' })}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-foreground">不加速 (none)</span>
                    <span className="text-[11px] text-muted-foreground">保持原始 GitHub / raw 链接不变</span>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                    currentProfile.settings?.proxySettings?.githubProxyMode === 'worker'
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-muted/20 hover:bg-muted/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="profileGhProxyMode"
                    checked={currentProfile.settings?.proxySettings?.githubProxyMode === 'worker'}
                    onChange={() => updateProxySettings({ githubProxyMode: 'worker' })}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-foreground">Worker 代理加速</span>
                    <span className="text-[11px] text-muted-foreground">由 Cloudflare Worker (/gh-proxy) 中转</span>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                    currentProfile.settings?.proxySettings?.githubProxyMode === 'proxy'
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-muted/20 hover:bg-muted/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="profileGhProxyMode"
                    checked={currentProfile.settings?.proxySettings?.githubProxyMode === 'proxy'}
                    onChange={() => updateProxySettings({ githubProxyMode: 'proxy' })}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-foreground">请求代理服务加速</span>
                    <span className="text-[11px] text-muted-foreground">通过上方配置的专属代理拉取</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 主配置左右分栏 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 左侧：Base YAML 模式与编辑器 (占 7 列) */}
        <div className="lg:col-span-7 flex flex-col gap-4 p-5 rounded-xl bg-card border border-card-border shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Icon name="ri-file-code-line text-primary text-lg" />
              <span className="font-semibold text-sm text-foreground">Base Clash YAML 配置</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">使用全局通用 Base YAML</span>
              <Switch
                checked={currentProfile.useGlobalYaml !== false}
                onChange={checked => updateCurrentProfile({ useGlobalYaml: checked })}
              />
            </div>
          </div>

          {currentProfile.useGlobalYaml !== false ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center border border-dashed border-border rounded-xl bg-muted/20 gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl">
                <Icon name="ri-global-line" />
              </div>
              <h3 className="font-semibold text-sm text-foreground">已启用「全局 Base YAML」模版</h3>
              <p className="text-xs text-muted-foreground max-w-md">
                当前 Profile 下发时将统一继承全局基础规则与策略组。
              </p>
              <Link to="/base-yaml">
                <Button variant="secondary" size="sm" icon="ri-edit-line">
                  前往维护全局 Base YAML
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                当前为本 Profile 专属 Base YAML，仅供该订阅使用：
              </span>
              <YamlEditor
                value={currentProfile.customBaseYaml || ''}
                onChange={val => updateCurrentProfile({ customBaseYaml: val })}
                height="500px"
              />
            </div>
          )}
        </div>

        {/* 右侧：挂载 Provider 列表 (占 5 列) - 隐去订阅 URL，提供差分配置 */}
        <div className="lg:col-span-5 flex flex-col gap-4 p-5 rounded-xl bg-card border border-card-border shadow-sm">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Icon name="ri-plug-line text-primary text-lg" />
              <span className="font-semibold text-sm text-foreground">
                启用的 Provider 源 ({enabledSet.size}/{providersPool.length})
              </span>
            </div>
            <Link to="/providers">
              <Button variant="ghost" size="sm" icon="ri-settings-line">
                管理资源池
              </Button>
            </Link>
          </div>

          {providersPool.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl">
              <p className="text-xs">资源池中暂无任何节点订阅源</p>
              <Link to="/providers">
                <Button variant="secondary" size="sm" className="mt-3">
                  + 去添加订阅源
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 max-h-[580px] overflow-y-auto pr-1">
              {providersPool.map(p => {
                const isEnabled = enabledSet.has(p.id)
                const isCustom = p.providerType === 'custom'
                const override = currentProfile.settings?.providerOverrides?.[p.id]

                // 生效的分发模式
                const effectiveUrlMode = (override?.urlMode && override.urlMode !== 'default')
                  ? override.urlMode
                  : (p.urlMode || 'direct')

                const hasOverride = (override?.urlMode && override.urlMode !== 'default') ||
                  (override?.useCustomProxy && override.useCustomProxy !== 'default')

                return (
                  <div
                    key={p.id}
                    className={`flex flex-col p-3 rounded-lg border transition-all gap-2.5 ${
                      isEnabled
                        ? 'bg-primary/5 border-primary/30'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <Icon
                          name={isCustom ? 'ri-shield-user-line text-primary' : 'ri-flight-takeoff-line text-muted-foreground'}
                          className="text-base shrink-0"
                        />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">
                              {p.name || '未命名源'}
                            </span>
                            {hasOverride && isEnabled && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                已差分
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isCustom ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/25">
                                <Icon name="ri-shield-user-line" />
                                <span>订阅伪装</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/25">
                                <Icon name="ri-flight-takeoff-line" />
                                <span>外部订阅</span>
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {p.proxy || 'DIRECT'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Switch
                        checked={isEnabled}
                        onChange={checked => toggleProvider(p.id, checked)}
                      />
                    </div>

                    {/* 仅在已启用且为外部订阅源时，展示差分配置选项 */}
                    {isEnabled && !isCustom && (
                      <div className="pt-2 border-t border-border/40 flex flex-col gap-2 bg-card/60 p-2.5 rounded-md">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                            <Icon name="ri-git-branch-line text-primary" /> 分发差分:
                          </span>
                          <Select
                            value={override?.urlMode || 'default'}
                            onChange={val => updateProviderOverride(p.id, { urlMode: val as any })}
                            options={[
                              {
                                value: 'default',
                                label: `继承源默认 (${p.urlMode === 'proxy' ? 'Worker代理' : p.urlMode === 'redirect' ? '302防扫跳转' : '直连暴露'})`
                              },
                              { value: 'direct', label: '直连暴露' },
                              { value: 'proxy', label: 'Worker代理' },
                              { value: 'redirect', label: '302防扫跳转' }
                            ]}
                            size="sm"
                            width="w-[180px]"
                          />
                        </div>

                        {effectiveUrlMode === 'proxy' && (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                              <Icon name="ri-route-line text-primary" /> 代理通道:
                            </span>
                            <Select
                              value={override?.useCustomProxy || 'default'}
                              onChange={val => updateProviderOverride(p.id, { useCustomProxy: val as any })}
                              options={[
                                {
                                  value: 'default',
                                  label: `继承源默认 (${p.useCustomProxy ? '请求代理' : 'Worker直连'})`
                                },
                                { value: 'true', label: '强制走请求代理模板' },
                                { value: 'false', label: '强制 Worker 直连拉取' }
                              ]}
                              size="sm"
                              width="w-[180px]"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
