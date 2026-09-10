import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import type { ImportFileInspection } from '../../services/importText'

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
  helper,
  onClose,
}: Props<T, TResult>) {
  const { showToast } = useToast()
  const [entries, setEntries] = useState<FilePreviewEntry<T>[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<TResult | undefined>(undefined)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setEntries([])
    setActiveIndex(0)
    setImportResult(undefined)
    if (!files.length) return
    setParsing(true)
    const parsedEntries: FilePreviewEntry<T>[] = []
    for (const file of files) {
      try {
        const inspection = inspectFile ? await inspectFile(file) : undefined
        parsedEntries.push({ file, preview: await parser(file), inspection })
      } catch (err) {
        showToast(`${file.name}: ${err instanceof Error ? err.message : 'Falha ao ler arquivo.'}`, 'error')
      }
    }
    setEntries(parsedEntries)
    setParsing(false)
  }

  async function handleImport() {
    const importableEntries = entries.filter((entry) => canImport(entry.preview))
    if (!importableEntries.length) return
    setImporting(true)
    let hasImportResult = false
    try {
      if (batchImporter) {
        await batchImporter(importableEntries)
      } else if (importer) {
        for (const entry of importableEntries) {
          const result = await importer(entry.preview, entry.file)
          if (renderImportResult && result !== undefined) {
            hasImportResult = true
            setImportResult(result as TResult)
          }
        }
      }
      if (!renderImportResult || !hasImportResult) onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setImporting(false)
    }
  }

  const activeEntry = entries[activeIndex] ?? null

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="grid gap-4">
        {subtitle ? <div className="app-panel app-panel--padded text-sm">{subtitle}</div> : null}
        {helper}
        {prerequisite}
        <Field label={`Arquivo ${accept}`}>
          <Input accept={accept} disabled={!ready || importing} multiple={multiple} type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="app-panel__meta">Processando...</div> : null}
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
        {importResult !== undefined && renderImportResult ? renderImportResult(importResult) : null}
        <div className="app-modal__actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
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
