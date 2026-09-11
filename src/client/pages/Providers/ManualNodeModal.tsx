import React, { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { Input } from '../../components/common/Input'
import { Switch } from '../../components/common/Switch'
import { Icon } from '../../components/common/Icon'
import { Select } from '../../components/common/Select'
import { YamlEditor } from '../../components/editor/YamlEditor'
import { ManualNodeConfig, ManualNodeProtocol } from '../../types'

interface ManualNodeModalProps {
  isOpen: boolean
  onClose: () => void
  initialYaml: string
  providerName: string
  onSave: (yaml: string) => void
}

const PROTOCOL_OPTIONS: { value: ManualNodeProtocol; label: string; icon: string }[] = [
  { value: 'socks5', label: 'SOCKS5 代理', icon: 'ri-shuffle-line' },
  { value: 'http', label: 'HTTP / HTTPS 代理', icon: 'ri-global-line' },
  { value: 'ss', label: 'Shadowsocks (SS)', icon: 'ri-shield-keyhole-line' },
  { value: 'vmess', label: 'VMess', icon: 'ri-server-line' },
  { value: 'vless', label: 'VLESS (XTLS / Reality)', icon: 'ri-flashlight-line' },
  { value: 'trojan', label: 'Trojan', icon: 'ri-lock-line' },
  { value: 'hysteria2', label: 'Hysteria2 (Hy2)', icon: 'ri-rocket-line' },
  { value: 'tuic', label: 'TUIC (QUIC)', icon: 'ri-speed-up-line' }
]

const DEFAULT_PORTS: Record<ManualNodeProtocol, number> = {
  socks5: 1080,
  http: 8080,
  ss: 8388,
  vmess: 443,
  vless: 443,
  trojan: 443,
  hysteria2: 443,
  tuic: 443
}

// 将节点对象转为 Clash 节点 YAML 字典
function configToClashProxy(node: ManualNodeConfig): Record<string, any> {
  const p: Record<string, any> = {
    name: node.name.trim() || '未命名节点',
    type: node.type,
    server: node.server.trim(),
    port: Number(node.port) || DEFAULT_PORTS[node.type]
  }

  if (node.type === 'socks5' || node.type === 'http') {
    if (node.username) p.username = node.username
    if (node.password) p.password = node.password
    if (node.tls) {
      p.tls = true
      if (node.skipCertVerify) p['skip-cert-verify'] = true
    }
    if (node.type === 'socks5') {
      p.udp = node.udp !== false
    }
  } else if (node.type === 'ss') {
    p.cipher = node.cipher || 'aes-256-gcm'
    p.password = node.password || ''
    p.udp = node.udp !== false
  } else if (node.type === 'vmess') {
    p.uuid = node.uuid || ''
    p.alterId = Number(node.alterId) || 0
    p.cipher = node.cipher || 'auto'
    p.udp = node.udp !== false
    p.tls = !!node.tls
    if (node.tls && node.skipCertVerify) p['skip-cert-verify'] = true
    if (node.servername) p.servername = node.servername
    p.network = node.network || 'ws'
    if (node.network === 'ws') {
      p['ws-opts'] = {
        path: node.wsPath || '/'
      }
    }
  } else if (node.type === 'vless') {
    p.uuid = node.uuid || ''
    p.udp = true
    p.tls = !!node.tls
    if (node.flow && node.flow !== 'none') p.flow = node.flow
    if (node.servername) p.servername = node.servername
    p.network = node.network || 'tcp'
    if (node.realityPublicKey) {
      p['reality-opts'] = {
        'public-key': node.realityPublicKey
      }
    }
  } else if (node.type === 'trojan') {
    p.password = node.password || ''
    p.udp = node.udp !== false
    if (node.sni) p.sni = node.sni
    if (node.skipCertVerify) p['skip-cert-verify'] = true
    p.network = node.network || 'tcp'
  } else if (node.type === 'hysteria2') {
    p.password = node.password || ''
    if (node.sni) p.sni = node.sni
    if (node.skipCertVerify) p['skip-cert-verify'] = true
    if (node.up) p.up = node.up
    if (node.down) p.down = node.down
  } else if (node.type === 'tuic') {
    p.uuid = node.uuid || ''
    p.password = node.password || ''
    if (node.sni) p.sni = node.sni
    if (node.congestionController) p['congestion-controller'] = node.congestionController
    if (node.skipCertVerify) p['skip-cert-verify'] = true
  }

  // 链式代理与 Clash / Mihomo 扩展参数
  if (node.dialerProxy && node.dialerProxy.trim()) {
    p['dialer-proxy'] = node.dialerProxy.trim()
  }
  if (node.interfaceName && node.interfaceName.trim()) {
    p['interface-name'] = node.interfaceName.trim()
  }
  if (node.routingMark !== undefined && node.routingMark !== '') {
    p['routing-mark'] = Number(node.routingMark) || node.routingMark
  }
  if (node.tfo) {
    p.tfo = true
  }
  if (node.mptcp) {
    p.mptcp = true
  }

  // 自定义扩展 YAML 参数 (例如 client-fingerprint, smux, packet-encoding 等)
  if (node.customFieldsYaml && node.customFieldsYaml.trim()) {
    try {
      const extraObj = yaml.load(node.customFieldsYaml)
      if (extraObj && typeof extraObj === 'object' && !Array.isArray(extraObj)) {
        Object.assign(p, extraObj)
      }
    } catch (e) {
      console.warn('解析自定义节点 YAML 参数失败:', e)
    }
  }

  return p
}

// 将节点列表转为 YAML 文本
function nodesListToYaml(nodes: ManualNodeConfig[]): string {
  if (nodes.length === 0) return 'proxies: []'
  const proxies = nodes.map(configToClashProxy)
  return yaml.dump({ proxies }, { indent: 2, lineWidth: -1 })
}

// 从 YAML 文本反向解析为节点列表
export function yamlToNodesList(yamlText: string): ManualNodeConfig[] {
  if (!yamlText || !yamlText.trim()) return []
  try {
    let raw = yaml.load(yamlText) as any
    if (Array.isArray(raw)) {
      raw = { proxies: raw }
    }
    if (!raw || !Array.isArray(raw.proxies)) return []

    const KNOWN_PROPS = new Set([
      'name', 'type', 'server', 'port', 'username', 'password', 'tls',
      'skip-cert-verify', 'udp', 'cipher', 'uuid', 'alterId', 'network',
      'flow', 'reality-opts', 'sni', 'servername', 'up', 'down',
      'congestion-controller', 'ws-opts', 'dialer-proxy', 'interface-name',
      'routing-mark', 'tfo', 'mptcp'
    ])

    return raw.proxies.map((p: any, idx: number) => {
      const type = (p.type || 'socks5').toLowerCase() as ManualNodeProtocol

      const remaining: Record<string, any> = {}
      for (const [k, v] of Object.entries(p)) {
        if (!KNOWN_PROPS.has(k)) {
          remaining[k] = v
        }
      }
      let customFieldsYaml = ''
      if (Object.keys(remaining).length > 0) {
        try {
          customFieldsYaml = yaml.dump(remaining, { indent: 2, lineWidth: -1 }).trim()
        } catch {}
      }

      return {
        id: crypto.randomUUID(),
        name: p.name || `节点-${idx + 1}`,
        type: PROTOCOL_OPTIONS.some(o => o.value === type) ? type : 'socks5',
        server: p.server || '',
        port: p.port || DEFAULT_PORTS[type] || 1080,
        username: p.username || '',
        password: p.password || '',
        tls: !!p.tls,
        skipCertVerify: !!p['skip-cert-verify'],
        udp: p.udp !== false,
        cipher: p.cipher || '',
        uuid: p.uuid || '',
        alterId: p.alterId || 0,
        network: p.network || 'ws',
        flow: p.flow || '',
        realityPublicKey: p['reality-opts']?.['public-key'] || '',
        sni: p.sni || p.servername || '',
        up: p.up || '',
        down: p.down || '',
        congestionController: p['congestion-controller'] || '',
        wsPath: p['ws-opts']?.path || '/',
        dialerProxy: p['dialer-proxy'] || '',
        interfaceName: p['interface-name'] || '',
        routingMark: p['routing-mark'] ?? '',
        tfo: !!p.tfo,
        mptcp: !!p.mptcp,
        customFieldsYaml
      }
    })
  } catch {
    return []
  }
}

export const ManualNodeModal: React.FC<ManualNodeModalProps> = ({
  isOpen,
  onClose,
  initialYaml,
  providerName,
  onSave
}) => {
  const [activeTab, setActiveTab] = useState<'visual' | 'yaml'>('visual')
  const [nodes, setNodes] = useState<ManualNodeConfig[]>([])
  const [yamlText, setYamlText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)

  // 当前编辑的节点
  const [editingNode, setEditingNode] = useState<ManualNodeConfig>({
    id: '',
    name: '我的节点-1',
    type: 'socks5',
    server: '',
    port: 1080,
    udp: true
  })

  // 初始化加载
  useEffect(() => {
    if (isOpen) {
      const clean = (initialYaml || '').trim() || 'proxies: []'
      setYamlText(clean)
      const parsed = yamlToNodesList(clean)
      setNodes(parsed)
      if (parsed.length > 0) {
        setSelectedIndex(0)
        setEditingNode({ ...parsed[0] })
      } else {
        setSelectedIndex(-1)
        setEditingNode({
          id: `node-${Date.now()}`,
          name: '自建SOCKS5-01',
          type: 'socks5',
          server: '1.2.3.4',
          port: 1080,
          udp: true
        })
      }
    }
  }, [isOpen, initialYaml])

  // 切换 Tab 同步
  const handleTabChange = (tab: 'visual' | 'yaml') => {
    if (tab === 'yaml') {
      // 从可视化生成 YAML
      const generated = nodesListToYaml(nodes)
      setYamlText(generated)
    } else {
      // 从 YAML 解析回可视化
      const parsed = yamlToNodesList(yamlText)
      setNodes(parsed)
      if (parsed.length > 0) {
        setSelectedIndex(0)
        setEditingNode({ ...parsed[0] })
      }
    }
    setActiveTab(tab)
  }

  // 保存当前编辑中的节点到 nodes 列表
  const handleApplyNodeChanges = () => {
    if (!editingNode.name.trim()) {
      alert('请填写节点名称')
      return
    }
    if (!editingNode.server.trim()) {
      alert('请填写节点服务器地址')
      return
    }

    if (selectedIndex >= 0 && selectedIndex < nodes.length) {
      const updated = [...nodes]
      updated[selectedIndex] = { ...editingNode }
      setNodes(updated)
      setYamlText(nodesListToYaml(updated))
    } else {
      const updated = [...nodes, { ...editingNode, id: `node-${Date.now()}` }]
      setNodes(updated)
      setSelectedIndex(updated.length - 1)
      setYamlText(nodesListToYaml(updated))
    }
  }

  // 新建空白节点
  const handleAddNewNode = () => {
    const newNode: ManualNodeConfig = {
      id: `node-${Date.now()}`,
      name: `节点-${nodes.length + 1}`,
      type: 'socks5',
      server: '',
      port: 1080,
      udp: true,
      dialerProxy: '',
      customFieldsYaml: ''
    }
    setEditingNode(newNode)
    setSelectedIndex(-1)
  }

  // 删除节点
  const handleDeleteNode = (idx: number) => {
    const updated = nodes.filter((_, i) => i !== idx)
    setNodes(updated)
    setYamlText(nodesListToYaml(updated))
    if (selectedIndex === idx) {
      if (updated.length > 0) {
        setSelectedIndex(0)
        setEditingNode({ ...updated[0] })
      } else {
        handleAddNewNode()
      }
    } else if (selectedIndex > idx) {
      setSelectedIndex(selectedIndex - 1)
    }
  }

  // 协议切换更新默认端口
  const handleProtocolChange = (type: ManualNodeProtocol) => {
    setEditingNode(prev => ({
      ...prev,
      type,
      port: DEFAULT_PORTS[type] || prev.port
    }))
  }

  const handleFinalSave = () => {
    let finalYaml = yamlText
    if (activeTab === 'visual') {
      finalYaml = nodesListToYaml(nodes)
    }
    onSave(finalYaml)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 font-mono text-sm">
          <Icon name="ri-cpu-line text-primary" />
          <span>伪装手动节点源：{providerName || '未命名'}</span>
        </div>
      }
      maxWidth="6xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTabChange('visual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'visual'
                  ? 'bg-primary/10 text-primary font-bold border border-primary/20'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon name="ri-list-check-2" /> 可视化配置 ({nodes.length} 个节点)
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('yaml')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'yaml'
                  ? 'bg-primary/10 text-primary font-bold border border-primary/20'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon name="ri-code-s-slash-line" /> YAML 源码预览/编辑
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" size="sm" icon="ri-save-line" onClick={handleFinalSave}>
              保存节点配置
            </Button>
          </div>
        </div>
      }
    >
      {activeTab === 'yaml' ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">
            可以在此直接查看并编辑 Clash 节点 YAML 源码，切换回「可视化配置」将自动解析同步：
          </div>
          <YamlEditor value={yamlText} onChange={setYamlText} height="60vh" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[62vh]">
          {/* 左侧节点列表 */}
          <div className="lg:col-span-4 border-r border-border pr-4 flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">节点列表 ({nodes.length})</span>
              <Button variant="secondary" size="sm" icon="ri-add-line" onClick={handleAddNewNode}>
                添加节点
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
              {nodes.length === 0 ? (
                <div className="text-center py-12 text-xs text-muted-foreground">
                  暂无节点，请点击上方「添加节点」
                </div>
              ) : (
                nodes.map((n, idx) => (
                  <div
                    key={n.id || idx}
                    onClick={() => {
                      setSelectedIndex(idx)
                      setEditingNode({ ...n })
                    }}
                    className={`group p-2.5 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between ${
                      selectedIndex === idx
                        ? 'border-primary bg-primary/5 shadow-xs'
                        : 'border-card-border hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="text-xs font-bold truncate text-foreground">{n.name}</span>
                      <span className="text-[11px] font-mono text-muted-foreground truncate">
                        <span className="uppercase text-primary font-bold mr-1">{n.type}</span>
                        {n.server}:{n.port}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteNode(idx)
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-danger hover:bg-danger/10"
                        title="删除节点"
                      >
                        <Icon name="ri-delete-bin-line" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 右侧节点表单配置 */}
          <div className="lg:col-span-8 flex flex-col gap-4 overflow-y-auto pl-1 pr-2">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Icon name="ri-edit-line text-primary" />
                {selectedIndex >= 0 ? `编辑节点 #${selectedIndex + 1}` : '新建手动节点'}
              </span>
              <Button variant="primary" size="sm" icon="ri-check-line" onClick={handleApplyNodeChanges}>
                {selectedIndex >= 0 ? '保存当前节点' : '确认添加'}
              </Button>
            </div>

            {/* 协议选择 Dropdown */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">代理协议类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PROTOCOL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleProtocolChange(opt.value)}
                    className={`px-3 py-2 rounded-lg border text-left text-xs font-medium transition-all flex items-center gap-2 ${
                      editingNode.type === opt.value
                        ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon name={opt.icon} className="text-sm" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 基础参数 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="节点名称 (Clash 别名)"
                placeholder="例如：自建-US-01"
                value={editingNode.name}
                onChange={e => setEditingNode(prev => ({ ...prev, name: e.target.value }))}
                required
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Input
                    label="服务器 IP 或域名"
                    placeholder="1.2.3.4 或 example.com"
                    value={editingNode.server}
                    onChange={e => setEditingNode(prev => ({ ...prev, server: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Input
                    label="端口"
                    type="number"
                    value={editingNode.port}
                    onChange={e => setEditingNode(prev => ({ ...prev, port: Number(e.target.value) || 0 }))}
                    required
                  />
                </div>
              </div>
            </div>

            {/* 协议动态参数表单 */}
            <div className="p-4 rounded-xl bg-muted/20 border border-border flex flex-col gap-3">
              <span className="text-xs font-bold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Icon name="ri-settings-4-line text-primary" />
                {editingNode.type} 协议专属配置
              </span>

              {/* SOCKS5 / HTTP */}
              {(editingNode.type === 'socks5' || editingNode.type === 'http') && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="认证用户名 (可选)"
                      placeholder="无密码留空"
                      value={editingNode.username || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, username: e.target.value }))}
                    />
                    <Input
                      label="认证密码 (可选)"
                      type="password"
                      placeholder="无密码留空"
                      value={editingNode.password || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, password: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-center gap-6 pt-1">
                    <Switch
                      checked={!!editingNode.tls}
                      onChange={c => setEditingNode(prev => ({ ...prev, tls: c }))}
                      label="开启 TLS 加密传输"
                    />
                    {editingNode.type === 'socks5' && (
                      <Switch
                        checked={editingNode.udp !== false}
                        onChange={c => setEditingNode(prev => ({ ...prev, udp: c }))}
                        label="启用 UDP 转发"
                      />
                    )}
                    {editingNode.tls && (
                      <Switch
                        checked={!!editingNode.skipCertVerify}
                        onChange={c => setEditingNode(prev => ({ ...prev, skipCertVerify: c }))}
                        label="跳过证书校验 (skip-cert-verify)"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Shadowsocks */}
              {editingNode.type === 'ss' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-foreground">加密算法 (cipher)</label>
                      <Select
                        value={editingNode.cipher || 'aes-256-gcm'}
                        onChange={val => setEditingNode(prev => ({ ...prev, cipher: val }))}
                        options={[
                          { value: 'aes-256-gcm', label: 'aes-256-gcm' },
                          { value: 'aes-128-gcm', label: 'aes-128-gcm' },
                          { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305' },
                          { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
                          { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm' }
                        ]}
                        size="sm"
                      />
                    </div>
                    <Input
                      label="SS 节点密码"
                      type="password"
                      placeholder="输入节点密码..."
                      value={editingNode.password || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, password: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="pt-1">
                    <Switch
                      checked={editingNode.udp !== false}
                      onChange={c => setEditingNode(prev => ({ ...prev, udp: c }))}
                      label="启用 UDP 转发"
                    />
                  </div>
                </div>
              )}

              {/* VMess */}
              {editingNode.type === 'vmess' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <Input
                        label="用户 UUID"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        value={editingNode.uuid || ''}
                        onChange={e => setEditingNode(prev => ({ ...prev, uuid: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <Input
                        label="AlterId"
                        type="number"
                        value={editingNode.alterId || 0}
                        onChange={e => setEditingNode(prev => ({ ...prev, alterId: Number(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-foreground">传输层协议 (network)</label>
                      <Select
                        value={editingNode.network || 'ws'}
                        onChange={val => setEditingNode(prev => ({ ...prev, network: val as any }))}
                        options={[
                          { value: 'ws', label: 'WebSocket (ws)' },
                          { value: 'tcp', label: 'TCP' },
                          { value: 'grpc', label: 'gRPC' },
                          { value: 'h2', label: 'HTTP/2' }
                        ]}
                        size="sm"
                      />
                    </div>
                    <Input
                      label="SNI / ServerName (可选)"
                      placeholder="example.com"
                      value={editingNode.servername || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, servername: e.target.value }))}
                    />
                  </div>

                  {editingNode.network === 'ws' && (
                    <Input
                      label="WebSocket 路径 (Path)"
                      placeholder="/ 或 /ws"
                      value={editingNode.wsPath || '/'}
                      onChange={e => setEditingNode(prev => ({ ...prev, wsPath: e.target.value }))}
                    />
                  )}

                  <div className="flex items-center gap-6 pt-1">
                    <Switch
                      checked={!!editingNode.tls}
                      onChange={c => setEditingNode(prev => ({ ...prev, tls: c }))}
                      label="开启 TLS"
                    />
                    <Switch
                      checked={editingNode.udp !== false}
                      onChange={c => setEditingNode(prev => ({ ...prev, udp: c }))}
                      label="开启 UDP"
                    />
                    {editingNode.tls && (
                      <Switch
                        checked={!!editingNode.skipCertVerify}
                        onChange={c => setEditingNode(prev => ({ ...prev, skipCertVerify: c }))}
                        label="跳过证书验证"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* VLESS */}
              {editingNode.type === 'vless' && (
                <div className="flex flex-col gap-3">
                  <Input
                    label="用户 UUID"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={editingNode.uuid || ''}
                    onChange={e => setEditingNode(prev => ({ ...prev, uuid: e.target.value }))}
                    required
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-foreground">流控 (flow)</label>
                      <Select
                        value={editingNode.flow || 'none'}
                        onChange={val => setEditingNode(prev => ({ ...prev, flow: val }))}
                        options={[
                          { value: 'none', label: '无 (None)' },
                          { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }
                        ]}
                        size="sm"
                      />
                    </div>
                    <Input
                      label="SNI / ServerName"
                      placeholder="伪装域名例如：cloud.google.com"
                      value={editingNode.servername || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, servername: e.target.value }))}
                    />
                  </div>

                  <Input
                    label="Reality Public Key (公钥，如开启Reality)"
                    placeholder="Reality public key 字符串"
                    value={editingNode.realityPublicKey || ''}
                    onChange={e => setEditingNode(prev => ({ ...prev, realityPublicKey: e.target.value }))}
                  />

                  <div className="flex items-center gap-6 pt-1">
                    <Switch
                      checked={editingNode.tls !== false}
                      onChange={c => setEditingNode(prev => ({ ...prev, tls: c }))}
                      label="开启 TLS / Reality"
                    />
                  </div>
                </div>
              )}

              {/* Trojan */}
              {editingNode.type === 'trojan' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Trojan 密码"
                      type="password"
                      placeholder="节点密码"
                      value={editingNode.password || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, password: e.target.value }))}
                      required
                    />
                    <Input
                      label="SNI 域名 (可选)"
                      placeholder="留空默认使用服务器地址"
                      value={editingNode.sni || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, sni: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-center gap-6 pt-1">
                    <Switch
                      checked={editingNode.udp !== false}
                      onChange={c => setEditingNode(prev => ({ ...prev, udp: c }))}
                      label="开启 UDP"
                    />
                    <Switch
                      checked={!!editingNode.skipCertVerify}
                      onChange={c => setEditingNode(prev => ({ ...prev, skipCertVerify: c }))}
                      label="跳过证书校验"
                    />
                  </div>
                </div>
              )}

              {/* Hysteria2 */}
              {editingNode.type === 'hysteria2' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="认证 Auth / Password"
                      type="password"
                      placeholder="Hy2 密码"
                      value={editingNode.password || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, password: e.target.value }))}
                      required
                    />
                    <Input
                      label="SNI 域名"
                      placeholder="例如：hy2.example.com"
                      value={editingNode.sni || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, sni: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="上行速率限制 (up，可选)"
                      placeholder="例如：50 Mbps"
                      value={editingNode.up || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, up: e.target.value }))}
                    />
                    <Input
                      label="下行速率限制 (down，可选)"
                      placeholder="例如：200 Mbps"
                      value={editingNode.down || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, down: e.target.value }))}
                    />
                  </div>
                  <div className="pt-1">
                    <Switch
                      checked={!!editingNode.skipCertVerify}
                      onChange={c => setEditingNode(prev => ({ ...prev, skipCertVerify: c }))}
                      label="跳过证书验证"
                    />
                  </div>
                </div>
              )}

              {/* TUIC */}
              {editingNode.type === 'tuic' && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="UUID"
                      placeholder="用户 UUID"
                      value={editingNode.uuid || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, uuid: e.target.value }))}
                      required
                    />
                    <Input
                      label="Password"
                      type="password"
                      placeholder="TUIC 密码"
                      value={editingNode.password || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, password: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="SNI 域名"
                      placeholder="例如：tuic.example.com"
                      value={editingNode.sni || ''}
                      onChange={e => setEditingNode(prev => ({ ...prev, sni: e.target.value }))}
                    />
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-foreground">拥塞控制 (congestion-controller)</label>
                      <Select
                        value={editingNode.congestionController || 'bbr'}
                        onChange={val => setEditingNode(prev => ({ ...prev, congestionController: val }))}
                        options={[
                          { value: 'bbr', label: 'bbr' },
                          { value: 'cubic', label: 'cubic' },
                          { value: 'new_reno', label: 'new_reno' }
                        ]}
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 高级与链式代理扩展配置 (dialer-proxy / 任意 YAML 字段) */}
            <div className="p-4 rounded-xl bg-muted/20 border border-border flex flex-col gap-3">
              <span className="text-xs font-bold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Icon name="ri-links-line text-primary" />
                链式代理与 Clash / Mihomo 扩展参数 (dialer-proxy 等)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="前置代理 / 链式代理 (dialer-proxy)"
                  placeholder="如: 节点名 或 策略组名 (流量经由该代理发出)"
                  value={editingNode.dialerProxy || ''}
                  onChange={e => setEditingNode(prev => ({ ...prev, dialerProxy: e.target.value }))}
                />
                <Input
                  label="绑定指定网卡 (interface-name，可选)"
                  placeholder="例如: eth0 或 wlan0"
                  value={editingNode.interfaceName || ''}
                  onChange={e => setEditingNode(prev => ({ ...prev, interfaceName: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <Input
                  label="路由标记 (routing-mark，可选)"
                  placeholder="例如: 666"
                  value={editingNode.routingMark !== undefined ? String(editingNode.routingMark) : ''}
                  onChange={e => setEditingNode(prev => ({ ...prev, routingMark: e.target.value }))}
                />
                <div className="flex items-center gap-6 pt-5">
                  <Switch
                    checked={!!editingNode.tfo}
                    onChange={c => setEditingNode(prev => ({ ...prev, tfo: c }))}
                    label="TCP Fast Open (TFO)"
                  />
                  <Switch
                    checked={!!editingNode.mptcp}
                    onChange={c => setEditingNode(prev => ({ ...prev, mptcp: c }))}
                    label="Multipath TCP (MPTCP)"
                  />
                </div>
              </div>

              {/* 自定义附加 YAML 扩展字段 */}
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1">
                    <Icon name="ri-code-line text-primary" /> 自定义扩展字段 (YAML 格式，任意 Clash / Mihomo 参数)
                  </label>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    自动合并到节点属性字典中
                  </span>
                </div>
                <textarea
                  className="w-full h-24 p-2.5 rounded-lg border border-input bg-card text-foreground font-mono text-xs focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y"
                  placeholder={`# 可直接书写任意扩展字段，保存时自动合并，例如:
client-fingerprint: chrome
smux:
  enabled: true
packet-encoding: xudp`}
                  value={editingNode.customFieldsYaml || ''}
                  onChange={e => setEditingNode(prev => ({ ...prev, customFieldsYaml: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
