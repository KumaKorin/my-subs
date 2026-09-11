import React from 'react'
import clsx from 'clsx'
import { Icon } from './Icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  loading?: boolean
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed select-none gap-2'

  const variantStyles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm',
    secondary: 'bg-muted text-foreground hover:bg-accent border border-border',
    danger: 'bg-danger text-danger-foreground hover:bg-danger/90 shadow-sm',
    ghost: 'hover:bg-muted text-foreground',
    outline: 'border border-border text-foreground hover:bg-muted'
  }

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-1.5',
    md: 'text-sm px-3.5 py-2',
    lg: 'text-base px-5 py-2.5'
  }

  return (
    <button
      className={clsx(baseStyles, variantStyles[variant], sizeStyles[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="ri-loader-4-line animate-spin" />
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      {children}
    </button>
  )
}
