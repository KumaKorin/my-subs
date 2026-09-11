import React, { createContext, useContext, useState, useRef } from 'react'
import { Modal } from '../components/common/Modal'
import { Button } from '../components/common/Button'
import { Input } from '../components/common/Input'
import { Icon } from '../components/common/Icon'

interface ConfirmOptions {
  title?: string
  message: string | React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'primary'
}

interface PromptOptions {
  title?: string
  message?: string | React.ReactNode
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
}

interface DialogContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  alert: (message: string, title?: string) => Promise<void>
}

const DialogContext = createContext<DialogContextType | null>(null)

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Confirm State
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmConfig, setConfirmConfig] = useState<ConfirmOptions>({ message: '' })
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null)

  // Prompt State
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptConfig, setPromptConfig] = useState<PromptOptions>({})
  const [promptValue, setPromptValue] = useState('')
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null)

  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    setConfirmConfig(options)
    setConfirmOpen(true)
    return new Promise(resolve => {
      confirmResolveRef.current = resolve
    })
  }

  const prompt = (options: PromptOptions): Promise<string | null> => {
    setPromptConfig(options)
    setPromptValue(options.defaultValue || '')
    setPromptOpen(true)
    return new Promise(resolve => {
      promptResolveRef.current = resolve
    })
  }

  const alert = async (message: string, title: string = '提示'): Promise<void> => {
    await confirm({
      title,
      message,
      confirmText: '我知道了',
      cancelText: '',
      variant: 'primary'
    })
  }

  const handleConfirmClose = (result: boolean) => {
    setConfirmOpen(false)
    if (confirmResolveRef.current) {
      confirmResolveRef.current(result)
      confirmResolveRef.current = null
    }
  }

  const handlePromptClose = (result: string | null) => {
    setPromptOpen(false)
    if (promptResolveRef.current) {
      promptResolveRef.current(result)
      promptResolveRef.current = null
    }
  }

  return (
    <DialogContext.Provider value={{ confirm, prompt, alert }}>
      {children}

      {/* 统一 Confirm 对话框 Modal */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => handleConfirmClose(false)}
        title={
          <span className="flex items-center gap-2">
            <Icon
              name={
                confirmConfig.variant === 'danger'
                  ? 'ri-error-warning-fill text-danger text-lg'
                  : 'ri-information-fill text-primary text-lg'
              }
            />
            <span>{confirmConfig.title || '操作确认'}</span>
          </span>
        }
        maxWidth="md"
        footer={
          <div className="flex items-center justify-end gap-2.5 w-full">
            {confirmConfig.cancelText !== '' && (
              <Button variant="secondary" size="sm" onClick={() => handleConfirmClose(false)}>
                {confirmConfig.cancelText || '取消'}
              </Button>
            )}
            <Button
              variant={confirmConfig.variant === 'danger' ? 'danger' : 'primary'}
              size="sm"
              onClick={() => handleConfirmClose(true)}
            >
              {confirmConfig.confirmText || '确定'}
            </Button>
          </div>
        }
      >
        <div className="text-sm text-foreground leading-relaxed whitespace-pre-line py-1">
          {confirmConfig.message}
        </div>
      </Modal>

      {/* 统一 Prompt 输入对话框 Modal */}
      <Modal
        isOpen={promptOpen}
        onClose={() => handlePromptClose(null)}
        title={
          <span className="flex items-center gap-2">
            <Icon name="ri-edit-circle-line text-primary text-lg" />
            <span>{promptConfig.title || '请输入'}</span>
          </span>
        }
        maxWidth="md"
        footer={
          <div className="flex items-center justify-end gap-2.5 w-full">
            <Button variant="secondary" size="sm" onClick={() => handlePromptClose(null)}>
              {promptConfig.cancelText || '取消'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handlePromptClose(promptValue.trim() || null)}
            >
              {promptConfig.confirmText || '确定'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 py-1">
          {promptConfig.message && (
            <div className="text-sm text-foreground">{promptConfig.message}</div>
          )}
          <Input
            value={promptValue}
            onChange={e => setPromptValue(e.target.value)}
            placeholder={promptConfig.placeholder || '请输入...'}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') handlePromptClose(promptValue.trim() || null)
            }}
          />
        </div>
      </Modal>
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogContextType {
  const context = useContext(DialogContext)
  if (!context) {
    throw new Error('useDialog must be used within DialogProvider')
  }
  return context
}
