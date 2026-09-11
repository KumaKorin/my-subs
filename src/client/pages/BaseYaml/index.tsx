import React, { useState } from 'react'
import { useAppData } from '../../context/DataContext'
import { Icon } from '../../components/common/Icon'
import { Button } from '../../components/common/Button'
import { YamlEditor } from '../../components/editor/YamlEditor'
import { apiRequest } from '../../services/api'
import { useToast } from '../../components/common/Toast'
import { useDialog } from '../../context/DialogContext'
import yamlParser from 'js-yaml'

export const BaseYamlPage: React.FC = () => {
  const { data, setGlobalBaseYaml } = useAppData()
  const { success, error } = useToast()
  const { confirm } = useDialog()

  const [yamlContent, setYamlContent] = useState(data?.globalBaseYaml || '')
  const [saving, setSaving] = useState(false)

  // 当外部加载完成后初始化本地草稿
  React.useEffect(() => {
    if (data?.globalBaseYaml && !yamlContent) {
      setYamlContent(data.globalBaseYaml)
    }
  }, [data?.globalBaseYaml])

  const handleSave = async () => {
    // 基础语法强校验提示
    if (yamlContent.trim()) {
      try {
        yamlParser.load(yamlContent)
      } catch (err: any) {
        const line = err.mark?.line !== undefined ? ` (第 ${err.mark.line + 1} 行)` : ''
        const ok = await confirm({
          title: 'YAML 语法异常警告',
          message: `检测到全局 Base YAML 存在语法错误${line}：\n${err.reason || err.message}\n\n语法错误可能导致 Clash 客户端无法正常启动，确定仍要强制保存吗？`,
          variant: 'danger',
          confirmText: '强制保存',
          cancelText: '返回修改'
        })
        if (!ok) return
      }
    }

    setSaving(true)
    try {
      const res = await apiRequest('/api/config/global-base-yaml', {
        method: 'POST',
        body: JSON.stringify({ yaml: yamlContent })
      })

      if (res.success) {
        setGlobalBaseYaml(yamlContent)
        success('全局 Base YAML 配置已成功保存')
      } else {
        error(res.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-card border border-card-border shadow-sm">
        <div>
          <h2 className="font-bold text-base text-foreground flex items-center gap-2">
            <Icon name="ri-file-code-line text-primary" /> 全局通用 Base Clash YAML 维护
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            在此处集中维护默认的策略组、DNS、Tun 及分流规则。所有开启了「使用全局通用 YAML」的 Profile 均自动继承此模板。
          </p>
        </div>

        <Button variant="primary" size="md" icon="ri-save-line" loading={saving} onClick={handleSave}>
          保存全局 Base YAML
        </Button>
      </div>

      <div className="rounded-xl bg-card border border-card-border shadow-sm overflow-hidden p-4">
        <YamlEditor
          value={yamlContent}
          onChange={setYamlContent}
          height="68vh"
        />
      </div>
    </div>
  )
}
