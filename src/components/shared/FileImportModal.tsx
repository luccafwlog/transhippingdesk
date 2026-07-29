import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

export type FilePreviewEntry<T> = {
  file: File
  preview: T
}

type Props<T> = {
  title: string
  subtitle?: ReactNode
  prerequisite?: ReactNode
  ready?: boolean
  accept: string
  multiple?: boolean
  parser: (file: File) => Promise<T>
  importer: (preview: T, file: File) => Promise<void>
  canImport: (preview: T) => boolean
  renderPreview: (preview: T, file: File) => ReactNode
  renderBatchSummary?: (entries: FilePreviewEntry<T>[]) => ReactNode
  helper?: ReactNode
  onClose: () => void
}

export function FileImportModal<T>({
  title,
  subtitle,
  prerequisite,
  ready = true,
  accept,
  multiple = false,
  parser,
  importer,
  canImport,
  renderPreview,
  renderBatchSummary,
  helper,
  onClose,
}: Props<T>) {
  const { showToast } = useToast()
  const [entries, setEntries] = useState<FilePreviewEntry<T>[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setEntries([])
    setActiveIndex(0)
    if (!files.length) return
    setParsing(true)
    const parsedEntries: FilePreviewEntry<T>[] = []
    for (const file of files) {
      try {
        parsedEntries.push({ file, preview: await parser(file) })
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
    try {
      for (const entry of importableEntries) {
        await importer(entry.preview, entry.file)
      }
      onClose()
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
          <Input accept={accept} disabled={!ready} multiple={multiple} type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="app-panel__meta">Processando...</div> : null}
        {entries.length > 0 && renderBatchSummary ? renderBatchSummary(entries) : null}
        {activeEntry && entries.length > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm">
            <span className="text-slate-300">
              Prévia {activeIndex + 1} de {entries.length}: <span className="font-semibold text-white">{activeEntry.file.name}</span>
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
        {activeEntry ? renderPreview(activeEntry.preview, activeEntry.file) : null}
        <div className="app-modal__actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!ready || !entries.some((entry) => canImport(entry.preview))}
            loading={importing}
            onClick={() => void handleImport()}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
