import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { AppData, Profile, Provider } from '../types'
import { apiRequest } from '../services/api'
import { useToast } from '../components/common/Toast'

interface DataContextType {
  data: AppData | null
  loading: boolean
  refreshData: () => Promise<void>
  setProfiles: (profiles: Profile[]) => void
  setProvidersPool: (providers: Provider[]) => void
  setGlobalBaseYaml: (yaml: string) => void
  setSettings: (settings: any) => void
}

const DataContext = createContext<DataContextType | null>(null)

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<AppData | null>(null)
  const [loading, setLoading] = useState(true)
  const { error } = useToast()

  const refreshData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<AppData>('/api/config/data')
      if (res.success && res.data) {
        setData(res.data)
      } else {
        error(res.error || '加载配置数据失败')
      }
    } finally {
      setLoading(false)
    }
  }, [error])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  const setProfiles = (profiles: Profile[]) => {
    setData(prev => (prev ? { ...prev, profiles } : null))
  }

  const setProvidersPool = (providersPool: Provider[]) => {
    setData(prev => (prev ? { ...prev, providersPool } : null))
  }

  const setGlobalBaseYaml = (globalBaseYaml: string) => {
    setData(prev => (prev ? { ...prev, globalBaseYaml } : null))
  }

  const setSettings = (settings: any) => {
    setData(prev => (prev ? { ...prev, settings } : null))
  }

  return (
    <DataContext.Provider
      value={{
        data,
        loading,
        refreshData,
        setProfiles,
        setProvidersPool,
        setGlobalBaseYaml,
        setSettings
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export function useAppData(): DataContextType {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useAppData must be used within DataProvider')
  }
  return context
}
