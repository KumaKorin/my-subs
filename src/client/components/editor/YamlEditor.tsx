import React, { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { yaml } from '@codemirror/lang-yaml'
import { linter, lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import yamlParser from 'js-yaml'
import clsx from 'clsx'

interface YamlEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  height?: string
  className?: string
  showLintStatus?: boolean
}

export const YamlEditor: React.FC<YamlEditorProps> = ({
  value,
  onChange,
  readOnly = false,
  height = '500px',
  className,
  showLintStatus = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [lintError, setLintError] = useState<string | null>(null)

  // YAML 语法校验器
  const yamlLinter = linter((view) => {
    const doc = view.state.doc.toString()
    if (!doc.trim()) {
      setLintError(null)
      return []
    }

    try {
      yamlParser.load(doc)
      setLintError(null)
      return []
    } catch (e: any) {
      const line = e.mark?.line || 0
      const col = e.mark?.column || 0
      const message = e.reason || e.message || 'YAML 语法错误'

      setLintError(`第 ${line + 1} 行: ${message}`)

      try {
        const lineObj = view.state.doc.line(Math.min(line + 1, view.state.doc.lines))
        const from = Math.min(lineObj.from + col, lineObj.to)
        return [
          {
            from,
            to: lineObj.to,
            severity: 'error',
            message
          }
        ]
      } catch {
        return []
      }
    }
  })

  useEffect(() => {
    if (!containerRef.current) return

    const isDark =
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.documentElement.classList.contains('dark')

    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      yaml(),
      lintGutter(),
      yamlLinter,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          height: '100%',
          backgroundColor: 'transparent'
        },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: '1px solid var(--border)',
          color: 'hsl(var(--muted-foreground))'
        },
        '.cm-activeLine': {
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)'
        }
      })
    ]

    if (isDark) {
      extensions.push(oneDark)
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true))
    }

    if (onChange) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString())
          }
        })
      )
    }

    const state = EditorState.create({
      doc: value,
      extensions
    })

    const view = new EditorView({
      state,
      parent: containerRef.current
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [readOnly])

  // 同步外部传入的 value
  useEffect(() => {
    if (!viewRef.current) return
    const curValue = viewRef.current.state.doc.toString()
    if (value !== curValue) {
      viewRef.current.dispatch({
        changes: { from: 0, to: curValue.length, insert: value || '' }
      })
    }
  }, [value])

  return (
    <div className={clsx('relative flex flex-col rounded-xl border border-card-border overflow-hidden bg-card shadow-sm', className)}>
      {showLintStatus && (
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-card-border bg-muted/40 text-xs">
          <span className="font-mono text-muted-foreground flex items-center gap-1.5">
            <i className="ri-file-code-line text-primary" /> YAML Editor
          </span>
          {lintError ? (
            <span className="text-danger flex items-center gap-1 font-mono font-medium">
              <i className="ri-error-warning-fill" /> {lintError}
            </span>
          ) : (
            <span className="text-success flex items-center gap-1 font-mono font-medium">
              <i className="ri-checkbox-circle-fill" /> 语法正确
            </span>
          )}
        </div>
      )}
      <div ref={containerRef} style={{ height }} className="overflow-auto" />
    </div>
  )
}
