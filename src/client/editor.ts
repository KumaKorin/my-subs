/**
 * CodeMirror 6 编辑器与 YAML 实时语法校验模块
 */
import { EditorView, basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { linter, lintGutter } from '@codemirror/lint'

export function createYamlLinter(statusElementId: string) {
    return linter((view: any) => {
        const doc = view.state.doc.toString()
        const diagnostics: any[] = []
        const statusEl = document.getElementById(statusElementId)

        if (!doc.trim()) {
            if (statusEl) {
                statusEl.textContent = ''
                statusEl.style.display = 'none'
            }
            return diagnostics
        }

        if (!window.jsyaml) {
            return diagnostics
        }

        try {
            window.jsyaml.load(doc)
            if (statusEl) {
                statusEl.style.display = 'inline-flex'
                statusEl.innerHTML = '<i class="ri-checkbox-circle-line"></i> YAML 格式正确'
                statusEl.style.color = 'var(--success)'
            }
        } catch (e: any) {
            if (statusEl) {
                statusEl.style.display = 'inline-flex'
                const lineNum = e.mark?.line !== undefined ? e.mark.line + 1 : '?'
                statusEl.innerHTML = `<i class="ri-error-warning-line"></i> 第 ${lineNum} 行语法错误`
                statusEl.style.color = 'var(--danger)'
            }

            if (e.mark) {
                const lineIndex = Math.min(Math.max(1, e.mark.line + 1), view.state.doc.lines)
                const lineObj = view.state.doc.line(lineIndex)
                const from = Math.min(lineObj.from + (e.mark.column || 0), lineObj.to)
                const to = Math.max(from + 1, lineObj.to)

                diagnostics.push({
                    from,
                    to,
                    severity: 'error',
                    message: e.reason || e.message
                })
            }
        }
        return diagnostics
    })
}

export function createEditor(
    container: HTMLElement | null,
    doc = '',
    readOnly = false,
    linterStatusId: string | null = null
): any {
    if (!container) return null

    const extensions = [basicSetup, yaml(), oneDark, EditorView.lineWrapping]

    if (readOnly) {
        extensions.push(EditorView.editable.of(false))
    } else if (linterStatusId) {
        extensions.push(lintGutter(), createYamlLinter(linterStatusId))
    }

    return new EditorView({
        doc,
        extensions,
        parent: container
    })
}

export function setEditorContent(editorView: any, content: string): void {
    if (!editorView) return
    editorView.dispatch({
        changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: content || ''
        }
    })
}

export function getEditorContent(editorView: any): string {
    if (!editorView) return ''
    return editorView.state.doc.toString()
}
