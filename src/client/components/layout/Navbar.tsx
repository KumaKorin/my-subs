import React from 'react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { Icon } from '../common/Icon'

export const Navbar: React.FC = () => {
  const navItems = [
    { to: '/profiles', label: 'Profile 订阅配置', icon: 'ri-file-list-3-line' },
    { to: '/providers', label: 'Provider 资源池', icon: 'ri-archive-line' },
    { to: '/base-yaml', label: '全局 Base YAML', icon: 'ri-file-code-line' },
    { to: '/logs', label: '请求流水与大盘', icon: 'ri-history-line' }
  ]

  return (
    <nav className="flex items-center gap-1 border-b border-border bg-card/60 backdrop-blur-md px-6 py-2 sticky top-14 z-30 overflow-x-auto">
      {navItems.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
              isActive
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )
          }
        >
          <Icon name={item.icon} className="text-base" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
