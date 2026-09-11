import React, { useState } from 'react'
import { useAppData } from '../../context/DataContext'
import { Provider } from '../../types'
import { Icon } from '../../components/common/Icon'
import { Button } from '../../components/common/Button'
import { Input } from '../../components/common/Input'
import { Switch } from '../../components/common/Switch'
import { Select } from '../../components/common/Select'
import { ManualNodeModal, yamlToNodesList } from './ManualNodeModal'
import { apiRequest } from '../../services/api'
import { useToast } from '../../components/common/Toast'
import { useDialog } from '../../context/DialogContext'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getProtocolBadgeClass(type: string): string {
  switch (type?.toLowerCase()) {
    case 'socks5':
      return 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
    case 'http':
      return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
    case 'ss':
      return 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
    case 'vmess':
      return 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
    case 'vless':
      return 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
    case 'trojan':
      return 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
    case 'hysteria2':
      return 'bg-pink-500/15 text-pink-400 border border-pink-500/30'
    case 'tuic':
      return 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
    default:
      return 'bg-muted text-muted-foreground border border-border'
  }
}

const DEFAULT_MANUAL_NODES_TEMPLATE = `proxies:
  - name: "示例 SOCKS5 节点"
    type: socks5
    server: 1.1.1.1
    port: 1080
    udp: true
`

export const ProvidersPage: React.FC = () => {
  const { data, setProvidersPool } = useAppData()
  const { success, error } = useToast()
  const { confirm, alert } = useDialog()

  const providers = data?.providersPool || []
  const hasGlobalProxy = !!data?.settings?.proxyUrlTemplate
  const [saving, setSaving] = useState(false)
  const [activeModalProviderId, setActiveModalProviderId] = useState<string | null>(null)

  const activeModalProvider = providers.find(p => p.id === activeModalProviderId) || null

  const handleAddProvider = (providerType: 'external' | 'custom' = 'external') => {
    const newProv: Provider = {
      id: crypto.randomUUID(),
      name: providerType === 'custom' ? `伪装节点_${providers.length + 1}` : `Provider_${providers.length + 1}`,
      providerType,
      urlMode: 'direct',
      useCustomProxy: false,
      type: 'http',
      proxy: 'DIRECT',
      url: '',
      customNodesYaml: providerType === 'custom' ? DEFAULT_MANUAL_NODES_TEMPLATE : '',
      interval: 36000,
      healthCheckEnable: true,
      healthCheckInterval: 36000
    }
    setProvidersPool([...providers, newProv])
    success(
      providerType === 'custom'
        ? '已创建订阅伪装卡片，填写您的自定义节点后点击右上角保存'
        : '已添加外部订阅源卡片，完善信息后点击保存'
    )
  }

  const handleRemoveProvider = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: '删除订阅源确认',
      message: `确定要从资源池中移除「${name}」吗？如果已有 Profile 引用该源，分发配置将自动解绑。`,
      variant: 'danger',
      confirmText: '确认移除'
    })

    if (confirmed) {
      setProvidersPool(providers.filter(p => p.id !== id))
      success(`已从资源池移除「${name}」`)
    }
  }

  const handleUpdateProvider = (id: string, fields: Partial<Provider>) => {
    const updated = providers.map(p => (p.id === id ? { ...p, ...fields } : p))
    setProvidersPool(updated)
  }

  const handleSave = async () => {
    // 统一确保所有 Provider ID 均为标准 UUID 规范
    const normalizedProviders = providers.map(p => {
      if (!p.id || !UUID_REGEX.test(p.id)) {
        return { ...p, id: crypto.randomUUID() }
      }
      return p
    })
    setProvidersPool(normalizedProviders)

    setSaving(true)
    try {
      const res = await apiRequest<Provider[]>('/api/providers', {
        method: 'POST',
        body: JSON.stringify({ providers: normalizedProviders })
      })

      if (res.success) {
        if (res.data) setProvidersPool(res.data)
        success('Provider 资源池配置已成功保存')
      } else {
        error(res.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部操作卡 */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-card border border-card-border shadow-sm">
        <div>
          <h2 className="font-bold text-base text-foreground flex items-center gap-2">
            <Icon name="ri-archive-line text-primary" /> Provider 节点资源池与订阅伪装
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            在此集中维护外部机场订阅或手动添加 SOCKS/HTTP 伪装节点，修改后所有引用的 Profile 自动同步生效。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            icon="ri-add-line"
            onClick={() => handleAddProvider('external')}
          >
            外部机场订阅
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon="ri-shield-user-line"
            onClick={() => handleAddProvider('custom')}
          >
            伪装手动节点源
          </Button>
          <Button
            variant="primary"
            size="md"
            icon="ri-save-line"
            loading={saving}
            onClick={handleSave}
          >
            保存资源池
          </Button>
        </div>
      </div>

      {/* 列表渲染 */}
      {providers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-card border border-dashed border-border rounded-xl">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl mb-3">
            <Icon name="ri-plug-line" />
          </div>
          <h3 className="font-semibold text-sm text-foreground">资源池中暂无订阅源</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            您可以添加常规机场的订阅链接，也可以创建包含 SOCKS/HTTP 手动节点的「订阅伪装」源。
          </p>
          <div className="flex items-center gap-3 mt-4">
            <Button variant="primary" size="sm" onClick={() => handleAddProvider('external')}>
              外部机场订阅
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handleAddProvider('custom')}>
              伪装手动节点源
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {providers.map((p, idx) => {
            const isCustom = p.providerType === 'custom'

            return (
              <div
                key={p.id}
                className="flex flex-col gap-4 p-5 rounded-xl bg-card border border-card-border shadow-sm"
              >
                {/* 卡片头部 */}
                <div className="flex items-center justify-between border-b border-border/70 pb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-mono font-bold">
                      #{idx + 1}
                    </span>
                    <span className="font-semibold text-sm text-foreground">
                      {p.name || '未命名 Provider'}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        isCustom
                          ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                          : 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                      }`}
                    >
                      <Icon name={isCustom ? 'ri-shield-user-line text-xs' : 'ri-flight-takeoff-line text-xs'} />
                      <span>{isCustom ? '订阅伪装 (手动节点)' : '外部订阅源'}</span>
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground" title={p.id}>
                      ID: {p.id.length > 18 ? `${p.id.slice(0, 8)}...${p.id.slice(-4)}` : p.id}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Select
                      value={p.providerType || 'external'}
                      onChange={val =>
                        handleUpdateProvider(p.id, {
                          providerType: val as 'external' | 'custom',
                          customNodesYaml:
                            val === 'custom' && !p.customNodesYaml
                              ? DEFAULT_MANUAL_NODES_TEMPLATE
                              : p.customNodesYaml
                        })
                      }
                      options={[
                        { value: 'external', label: '外部机场订阅', icon: 'ri-flight-takeoff-line' },
                        { value: 'custom', label: '订阅伪装 (手动节点)', icon: 'ri-shield-user-line' }
                      ]}
                      size="sm"
                      width="w-[185px]"
                    />

                    <Button
                      variant="ghost"
                      size="sm"
                      icon="ri-delete-bin-line text-danger"
                      onClick={() => handleRemoveProvider(p.id, p.name)}
                    >
                      <span className="text-xs text-danger">删除</span>
                    </Button>
                  </div>
                </div>

                {/* 字段输入 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Provider 标识名称 (Clash 策略组引用名称)"
                    value={p.name || ''}
                    placeholder="如: LiangXin / My_VPS_Nodes"
                    onChange={e => handleUpdateProvider(p.id, { name: e.target.value })}
                  />
                  <Input
                    label="代理策略组 (Proxy)"
                    value={p.proxy || 'DIRECT'}
                    placeholder="DIRECT"
                    onChange={e => handleUpdateProvider(p.id, { proxy: e.target.value })}
                  />
                </div>

                {/* 外部 URL 或 伪装节点卡片展示区 */}
                {isCustom ? (
                  (() => {
                    const nodes = yamlToNodesList(p.customNodesYaml || '')
                    return (
                      <div className="flex flex-col gap-3 p-4 rounded-xl border border-purple-500/25 bg-purple-500/5">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-500/15 pb-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs">
                              <Icon name="ri-shield-user-line" />
                            </div>
                            <span className="text-xs font-semibold text-foreground">伪装代理节点卡片池</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/20 text-purple-300 font-mono">
                              {nodes.length} 个节点
                            </span>
                          </div>

                          <Button
                            variant="primary"
                            size="sm"
                            icon="ri-settings-4-line"
                            onClick={() => setActiveModalProviderId(p.id)}
                            className="bg-purple-600 hover:bg-purple-700 text-white border-purple-500 text-xs"
                          >
                            配置节点
                          </Button>
                        </div>

                        {nodes.length === 0 ? (
                          <div
                            onClick={() => setActiveModalProviderId(p.id)}
                            className="flex flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed border-purple-500/30 bg-purple-500/5 cursor-pointer hover:bg-purple-500/10 transition-colors text-center gap-2"
                          >
                            <div className="w-9 h-9 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-base">
                              <Icon name="ri-add-line" />
                            </div>
                            <span className="text-xs text-foreground font-medium">暂无节点，点击此处打开配置面板添加节点</span>
                            <span className="text-[11px] text-muted-foreground">支持 SOCKS5 / HTTP / SS / VMess / VLESS / Trojan / Hy2 / TUIC 多协议可视化维护</span>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {nodes.map(node => (
                              <div
                                key={node.id}
                                onClick={() => setActiveModalProviderId(p.id)}
                                className="p-3 rounded-lg border border-border bg-card hover:border-purple-500/50 hover:bg-card/90 transition-all cursor-pointer flex flex-col justify-between gap-2 shadow-xs group"
                                title="点击打开节点配置弹窗编辑"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                                    {node.name || '未命名节点'}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${getProtocolBadgeClass(node.type)}`}>
                                    {node.type}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                                  <span className="truncate max-w-[170px]" title={`${node.server}:${node.port}`}>
                                    {node.server || '0.0.0.0'}:{node.port || 1080}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    {node.tls && (
                                      <span className="px-1 rounded bg-green-500/10 text-green-400 text-[9px] font-sans">
                                        TLS
                                      </span>
                                    )}
                                    {node.realityPublicKey && (
                                      <span className="px-1 rounded bg-cyan-500/10 text-cyan-400 text-[9px] font-sans">
                                        Reality
                                      </span>
                                    )}
                                    {node.udp && (
                                      <span className="px-1 rounded bg-blue-500/10 text-blue-400 text-[9px] font-sans">
                                        UDP
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()
                ) : (
                  <div className="flex flex-col gap-4 p-4 rounded-xl border border-border bg-muted/10">
                    <Input
                      label="外部机场订阅直链 (URL)"
                      value={p.url || ''}
                      placeholder="https://example.com/api/v1/client/subscribe?token=xxx"
                      onChange={e => handleUpdateProvider(p.id, { url: e.target.value })}
                    />

                    {/* 隐藏真实订阅 URL 模式 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                          <Icon name="ri-shield-keyhole-line text-primary" /> 隐藏真实订阅 URL 模式
                        </label>
                        <Select
                          value={p.urlMode || 'direct'}
                          onChange={val =>
                            handleUpdateProvider(p.id, {
                              urlMode: val as 'direct' | 'proxy' | 'redirect'
                            })
                          }
                          options={[
                            { value: 'direct', label: '直接暴露真实 URL (客户端直连)' },
                            { value: 'proxy', label: 'Worker 代理拉取 (隐藏真实订阅)' },
                            { value: 'redirect', label: '客户端 302 跳转 (防扫伪装)' }
                          ]}
                          size="sm"
                        />
                      </div>

                      {p.urlMode === 'proxy' && (
                        <div className="flex flex-col justify-center gap-1 p-3 rounded-lg bg-card border border-card-border">
                          <Switch
                            checked={!!p.useCustomProxy}
                            onChange={c => handleUpdateProvider(p.id, { useCustomProxy: c })}
                            label="通过自定义请求代理拉取订阅 (Request Proxy)"
                          />
                          <span className="text-[10px] text-muted-foreground ml-6">
                            {hasGlobalProxy
                              ? '开启后将通过顶栏「代理配置」中的模板地址拉取该节点源'
                              : '⚠️ 尚未在顶栏「代理配置」中配置代理模板，开启后将回退为 Worker 直连拉取'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 间隔与健康检查 */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Input
                    type="number"
                    label="客户端更新间隔 (Interval 秒)"
                    value={p.interval || 36000}
                    onChange={e =>
                      handleUpdateProvider(p.id, {
                        interval: parseInt(e.target.value, 10) || 36000
                      })
                    }
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">健康检查</label>
                    <Select
                      value={p.healthCheckEnable !== false ? 'true' : 'false'}
                      onChange={val =>
                        handleUpdateProvider(p.id, { healthCheckEnable: val === 'true' })
                      }
                      options={[
                        { value: 'true', label: '启用 (true)' },
                        { value: 'false', label: '禁用 (false)' }
                      ]}
                      size="md"
                    />
                  </div>
                  <Input
                    type="number"
                    label="检查间隔 (Check Interval 秒)"
                    value={p.healthCheckInterval || 36000}
                    onChange={e =>
                      handleUpdateProvider(p.id, {
                        healthCheckInterval: parseInt(e.target.value, 10) || 36000
                      })
                    }
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 伪装手动节点可视化配置 Modal */}
      {activeModalProvider && (
        <ManualNodeModal
          isOpen={!!activeModalProvider}
          onClose={() => setActiveModalProviderId(null)}
          providerName={activeModalProvider.name}
          initialYaml={activeModalProvider.customNodesYaml || ''}
          onSave={yaml => {
            handleUpdateProvider(activeModalProvider.id, { customNodesYaml: yaml })
            success(`已更新「${activeModalProvider.name}」的节点配置`)
          }}
        />
      )}
    </div>
  )
}
