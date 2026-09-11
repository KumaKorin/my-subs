import React from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Navbar } from './Navbar'
import { useAppData } from '../../context/DataContext'
import { Icon } from '../common/Icon'

export const AppLayout: React.FC = () => {
  const { data, loading } = useAppData()

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-muted-foreground gap-3">
        <Icon name="ri-loader-4-line animate-spin text-3xl text-primary" />
        <span className="text-sm font-mono tracking-wide">正在加载分发配置...</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header prefix={data?.prefix} />
      <Navbar />
      <main className="flex-1 px-4 sm:px-8 py-6 max-w-7xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
