import React, { useState, useRef, useEffect } from 'react'
import { Icon } from './Icon'

export interface SelectOption<T extends string | number = string> {
  value: T
  label: string
  icon?: string
  badge?: string
}

export interface SelectProps<T extends string | number = string> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
  icon?: string
  width?: string
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
  className = '',
  size = 'md',
  icon,
  width
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(o => o.value === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const isSmall = size === 'sm'

  return (
    <div
      ref={containerRef}
      className={`relative inline-block text-left ${width ? width : 'w-full'} ${className}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(prev => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border transition-all select-none ${
          isSmall ? 'px-2.5 py-1.5 text-xs font-medium' : 'px-3 py-2 text-sm font-medium'
        } ${
          open
            ? 'bg-card border-primary ring-2 ring-primary/20 text-foreground shadow-sm'
            : 'bg-muted/40 hover:bg-muted/70 text-foreground border-border hover:border-border/80'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className="flex items-center gap-2 min-w-0 truncate">
          {(selectedOption?.icon || icon) && (
            <Icon name={selectedOption?.icon || icon || ''} className="text-primary shrink-0" />
          )}
          <span className="truncate text-left">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <Icon
          name={`ri-arrow-down-s-line text-muted-foreground shrink-0 text-sm transition-transform duration-200 ${
            open ? 'rotate-180 text-primary' : ''
          }`}
        />
      </button>

      {open && (
        <div
          className={`absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-card-border bg-card/98 backdrop-blur-md shadow-2xl p-1 focus:outline-none`}
          style={{ minWidth: 'max-content', maxWidth: '340px' }}
        >
          {options.map(option => {
            const isSelected = option.value === value
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                  isSmall ? 'text-xs' : 'text-sm'
                } ${
                  isSelected
                    ? 'bg-primary/15 text-primary font-semibold'
                    : 'text-foreground hover:bg-muted/80'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {option.icon && (
                    <Icon
                      name={option.icon}
                      className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                    />
                  )}
                  <span className="truncate">{option.label}</span>
                </div>
                {isSelected && (
                  <Icon name="ri-check-line text-primary shrink-0 text-sm font-bold" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
