import { useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

type Props<T> = {
  title: string
  voyageLabel: string
  accept: string
  parser: (file: File) => Promise<T>
  importer: (preview: T, file: File) => Promise<void>
  canImport: (preview: T) => boolean
  renderPreview: (preview: T, file: File) => ReactNode
  onClose: () => void
}

export function FileImportModal<T>({
  title,
  voyageLabel,
  accept,
  parser,
  importer,
  canImport,
  renderPreview,
  onClose,
}: Props<T>) {
  const { showToast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<T | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
    if (!f) return
    setParsing(true)
    try {
      setPreview(await parser(f))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!preview || !file) return
    setImporting(true)
    try {
      await importer(preview, file)
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar.', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="grid gap-4">
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
          Viagem: <span className="font-semibold text-white">{voyageLabel}</span>
        </div>
        <Field label={`Arquivo ${accept}`}>
          <Input accept={accept} type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="text-sm text-slate-400">Processando...</div> : null}
        {preview && file ? renderPreview(preview, file) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!preview || !canImport(preview)}
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
