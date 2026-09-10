import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import type { ImportFileInspection } from '../../services/importText'
import type { ImportIssue } from '../../services/importValidation'
import type { FileReadProgress } from '../../hooks/useCancellableFileRead'
import { ImportIssuesPanel } from './ImportIssuesPanel'
import { ImportReadProgress } from './ImportReadProgress'

export type FilePreviewEntry<T> = {
  file: File
  preview: T
  inspection?: ImportFileInspection
}

type Props<T, TResult = void> = {
  title: string
  subtitle?: ReactNode
  prerequisite?: ReactNode
  ready?: boolean
  accept: string
  multiple?: boolean
  parser: (file: File) => Promise<T>
  inspectFile?: (file: File) => Promise<ImportFileInspection>
  importer?: (preview: T, file: File) => Promise<TResult>
  batchImporter?: (entries: FilePreviewEntry<T>[]) => Promise<void>
  canImport: (preview: T) => boolean
  getIssues?: (preview: T) => readonly ImportIssue[]
  issuesFilename?: string
  renderPreview: (preview: T, file: File) => ReactNode
  renderBatchSummary?: (entries: FilePreviewEntry<T>[]) => ReactNode
  renderImportResult?: (result: TResult) => ReactNode
  helper?: ReactNode
  onClose: () => void
}

export function FileImportModal<T, TResult = void>({
  title,
  subtitle,
  prerequisite,
  ready = true,
  accept,
  multiple = false,
  parser,
  inspectFile,
  importer,
  batchImporter,
  canImport,
  renderPreview,
  renderBatchSummary,
  renderImportResult,
  getIssues,
  issuesFilename,
  helper,
  onClose,
}: Props<T, TResult>) {
  const { showToast } = useToast()
  const [entries, setEntries] = useState<FilePreviewEntry<T>[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<FileReadProgress>({ completed: 0, total: 0, currentFile: null })
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<TResult | undefined>(undefined)
  const parseControllerRef = useRef<AbortController | null>(null)
  const importControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    parseControllerRef.current?.abort()
    importControllerRef.current?.abort()
  }, [])

  function closeModal() {
    parseControllerRef.current?.abort()
    importControllerRef.current?.abort()
    onClose()
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    parseControllerRef.current?.abort()
    setEntries([])
    setActiveIndex(0)
    setImportResult(undefined)
    setParseProgress({ completed: 0, total: files.length, currentFile: files[0]?.name ?? null })
    if (!files.length) {
      parseControllerRef.current = null
      setParsing(false)
      return
    }
    const controller = new AbortController()
    parseControllerRef.current = controller
    setParsing(true)
    const parsedEntries: FilePreviewEntry<T>[] = []
    for (const file of files) {
      if (controller.signal.aborted) break
      try {
        const inspection = inspectFile ? await inspectFile(file) : undefined
        const preview = await parser(file)
        if (controller.signal.aborted) break
        parsedEntries.push({ file, preview, inspection })
        setParseProgress((progress) => ({
          ...progress,
          completed: progress.completed + 1,
          currentFile: files[progress.completed + 1]?.name ?? file.name,
        }))
      } catch (err) {
        if (controller.signal.aborted) break
        showToast(`${file.name}: ${err instanceof Error ? err.message : 'Falha ao ler arquivo.'}`, 'error')
        setParseProgress((progress) => ({
          ...progress,
          completed: progress.completed + 1,
          currentFile: files[progress.completed + 1]?.name ?? file.name,
        }))
      }
    }
    if (!controller.signal.aborted) setEntries(parsedEntries)
    if (parseControllerRef.current === controller) {
      setParsing(false)
      parseControllerRef.current = null
    }
  }

  async function handleImport() {
    const importableEntries = entries.filter((entry) => canImport(entry.preview))
    if (!importableEntries.length) return
    const controller = new AbortController()
    importControllerRef.current = controller
    setImporting(true)
    let hasImportResult = false
    try {
      if (batchImporter) {
        await batchImporter(importableEntries)
      } else if (importer) {
        for (const entry of importableEntries) {
          if (controller.signal.aborted) return
          const result = await importer(entry.preview, entry.file)
          if (renderImportResult && result !== undefined) {
            hasImportResult = true
            setImportResult(result as TResult)
          }
        }
      }
      if (!controller.signal.aborted && (!renderImportResult || !hasImportResult)) closeModal()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setImporting(false)
      if (importControllerRef.current === controller) importControllerRef.current = null
    }
  }

  function cancelParsing() {
    parseControllerRef.current?.abort()
    setParsing(false)
  }

  const activeEntry = entries[activeIndex] ?? null
  const activeIssues = activeEntry && getIssues ? getIssues(activeEntry.preview) : []

  return (
    <Modal open onClose={closeModal} title={title}>
      <div className="grid gap-4">
        {subtitle ? <div className="app-panel app-panel--padded text-sm">{subtitle}</div> : null}
        {helper}
        {prerequisite}
        <Field label={`Arquivo ${accept}`}>
          <Input accept={accept} disabled={!ready || importing} multiple={multiple} type="file" onChange={handleFile} />
        </Field>
        {parsing ? <ImportReadProgress progress={parseProgress} /> : null}
        {entries.length > 0 && renderBatchSummary ? renderBatchSummary(entries) : null}
        {activeEntry && entries.length > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2 text-sm">
            <span className="text-[var(--app-muted)]">
              Prévia {activeIndex + 1} de {entries.length}: <span className="font-semibold text-[var(--app-text-strong)]">{activeEntry.file.name}</span>
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={activeIndex <= 0} onClick={() => setActiveIndex((index) => index - 1)}>
                Anterior
              </Button>
              <Button variant="secondary" disabled={activeIndex >= entries.length - 1} onClick={() => setActiveIndex((index) => index + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        ) : null}
        {activeEntry?.inspection ? <ImportInspection inspection={activeEntry.inspection} /> : null}
        {activeEntry ? renderPreview(activeEntry.preview, activeEntry.file) : null}
        {activeIssues.length ? <ImportIssuesPanel issues={activeIssues} filename={issuesFilename} /> : null}
        {importResult !== undefined && renderImportResult ? renderImportResult(importResult) : null}
        <div className="app-modal__actions">
          <Button variant="secondary" disabled={importing} onClick={parsing ? cancelParsing : closeModal}>{parsing ? 'Cancelar leitura' : 'Cancelar'}</Button>
          <Button
            disabled={importResult !== undefined ? false : !ready || !entries.some((entry) => canImport(entry.preview))}
            loading={importing}
            onClick={() => importResult !== undefined ? onClose() : void handleImport()}
          >
            {importResult !== undefined ? 'Concluir' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ImportInspection({ inspection }: { inspection: ImportFileInspection }) {
  const formatLabel: Record<ImportFileInspection['format'], string> = {
    xlsx: 'XLSX',
    xls: 'XLS',
    csv: 'CSV',
    edi: 'EDI',
  }
  const encodingLabel = inspection.encoding === null
    ? 'binário'
    : inspection.encoding === 'utf-8-sig'
      ? 'UTF-8 com BOM'
      : inspection.encoding === 'windows-1252'
        ? 'Windows-1252'
        : inspection.encoding.toUpperCase()

  return (
    <div className="app-panel app-panel--padded grid gap-2 text-xs" role="status" aria-label="Diagnóstico do arquivo">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>Formato detectado: <strong>{formatLabel[inspection.format]}</strong></span>
        <span>Encoding: <strong>{encodingLabel}</strong></span>
        <span>BOM: <strong>{inspection.hadBom ? 'presente' : 'ausente'}</strong></span>
        <span>{inspection.byteLength.toLocaleString('pt-BR')} bytes</span>
      </div>
      {inspection.preview ? (
        <details>
          <summary className="cursor-pointer font-semibold">Prévia do conteúdo decodificado</summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-2 font-mono text-[11px]">{inspection.preview}</pre>
        </details>
      ) : null}
    </div>
  )
}
