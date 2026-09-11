import React, { createContext, useContext, useState, useCallback } from 'react'
import clsx from 'clsx'
import { Icon } from './Icon'

interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastContextType {
  toast: (message: string, type?: 'success' | 'error' | 'info') => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      const id = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
      setToasts(prev => [...prev, { id, message, type }])
      setTimeout(() => removeToast(id), 3200)
    },
    [removeToast]
  )

  const success = useCallback((msg: string) => toast(msg, 'success'), [toast])
  const error = useCallback((msg: string) => toast(msg, 'error'), [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map(t => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium animate-in slide-in-from-bottom-5 duration-200',
              t.type === 'success' && 'bg-card border-success/40 text-foreground',
              t.type === 'error' && 'bg-card border-danger/40 text-foreground',
              t.type === 'info' && 'bg-card border-card-border text-foreground'
            )}
          >
            {t.type === 'success' && <Icon name="ri-checkbox-circle-fill text-success text-lg" />}
            {t.type === 'error' && <Icon name="ri-error-warning-fill text-danger text-lg" />}
            {t.type === 'info' && <Icon name="ri-information-fill text-primary text-lg" />}
            <span className="flex-1 text-xs sm:text-sm">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Icon name="ri-close-line" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
