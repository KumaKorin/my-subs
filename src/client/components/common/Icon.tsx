import React from 'react'
import clsx from 'clsx'

interface IconProps extends React.HTMLAttributes<HTMLElement> {
  name: string
  className?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}

const sizeMap = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl'
}

/**
 * 纯 CDN Remix Icon 字体组件封装
 * 零 JS Bundle 打包开销，无额外依赖
 */
export const Icon: React.FC<IconProps> = ({ name, className, size, ...props }) => {
  return (
    <i
      className={clsx(name, size && sizeMap[size], className)}
      aria-hidden="true"
      {...props}
    />
  )
}
