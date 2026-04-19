import { useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { computeFileHash, importManifest } from '../../services/manifestImport'
import { countDistinctManifestContainers, parseManifestFile } from '../../services/manifestParser'
import { importBreakbulkManifest, parseBreakbulkManifestFile } from '../../services/breakbulkImport'
import { importGraniteManifest, parseGraniteManifestFile } from '../../services/graniteImport'
import { importVaziosImportacaoManifest, parseVaziosImportacaoFile } from '../../services/vaziosImportacaoImport'
import { importVehicleRows, parseVehicleImportFile } from '../../services/vehicleImport'

type ImportType = 'cntr' | 'bb' | 'granite' | 'vazios' | 'vehicles'

const IMPORT_LABELS: Record<ImportType, string> = {
  cntr: 'Manifesto CNTR',
  bb: 'Manifesto BB',
  granite: 'Manifesto Granito',
  vazios: 'Manifesto Vazios Imp.',
  vehicles: 'Planilha Veiculos',
}

export function VoyageImportActions({
  voyageId,
  voyageLabel,
  userId,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
}) {
  const [activeType, setActiveType] = useState<ImportType | null>(null)

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(['cntr', 'bb', 'granite', 'vazios', 'vehicles'] as ImportType[]).map((type) => (
          <Button key={type} variant="secondary" className="text-xs" onClick={() => setActiveType(type)}>
            <Upload size={13} />
            {IMPORT_LABELS[type]}
          </Button>
        ))}
      </div>

      {activeType === 'cntr' ? (
        <CntrImportModal voyageId={voyageId} voyageLabel={voyageLabel} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}
      {activeType === 'bb' ? (
        <BbImportModal voyageId={voyageId} voyageLabel={voyageLabel} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}
      {activeType === 'granite' ? (
        <GraniteImportModal voyageId={voyageId} voyageLabel={voyageLabel} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}
      {activeType === 'vazios' ? (
        <VaziosImportModal voyageId={voyageId} voyageLabel={voyageLabel} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}
      {activeType === 'vehicles' ? (
        <VehiclesImportModal voyageId={voyageId} voyageLabel={voyageLabel} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}
    </>
  )
}

function VoyageContext({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
      Viagem: <span className="font-semibold text-white">{label}</span>
    </div>
  )
}

function CntrImportModal({
  voyageId,
  voyageLabel,
  userId,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseManifestFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
    if (!f) return
    setParsing(true)
    try {
      setPreview(await parseManifestFile(f))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!file || !preview) return
    setImporting(true)
    try {
      const fileHash = await computeFileHash(file).catch(() => null)
      await importManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId, fileHash })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
      showToast(`Manifesto CNTR importado: ${preview.bls.length} B/L(s), ${countDistinctManifestContainers(preview)} container(s).`, 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar manifesto.', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Importar Manifesto CNTR">
      <div className="grid gap-4">
        <VoyageContext label={voyageLabel} />
        <Field label="Arquivo .xlsx / .xls">
          <Input accept=".xlsx,.xls" type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="text-sm text-slate-400">Processando...</div> : null}
        {preview ? (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="B/Ls" value={preview.bls.length} />
            <Stat label="Containers" value={countDistinctManifestContainers(preview)} />
            <Stat label="Erros" value={preview.rowErrors.length} />
          </div>
        ) : null}
        <ModalActions disabled={!preview?.bls.length} loading={importing} onConfirm={() => void handleImport()} onCancel={onClose} />
      </div>
    </Modal>
  )
}

function BbImportModal({
  voyageId,
  voyageLabel,
  userId,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseBreakbulkManifestFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
    if (!f) return
    setParsing(true)
    try {
      setPreview(await parseBreakbulkManifestFile(f))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!file || !preview) return
    setImporting(true)
    try {
      await importBreakbulkManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
      showToast(`Manifesto BB importado: ${preview.bls.length} B/L(s).`, 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar manifesto BB.', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Importar Manifesto BB (Break Bulk)">
      <div className="grid gap-4">
        <VoyageContext label={voyageLabel} />
        <Field label="Arquivo .xlsx / .xls / .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="text-sm text-slate-400">Processando...</div> : null}
        {preview ? (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="B/Ls" value={preview.bls.length} />
            <Stat label="Erros" value={preview.rowErrors.length} />
            <Stat label="Linhas" value={preview.bls.length + preview.rowErrors.length} />
          </div>
        ) : null}
        <ModalActions disabled={!preview?.bls.length} loading={importing} onConfirm={() => void handleImport()} onCancel={onClose} />
      </div>
    </Modal>
  )
}

function GraniteImportModal({
  voyageId,
  voyageLabel,
  userId,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseGraniteManifestFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
    if (!f) return
    setParsing(true)
    try {
      setPreview(await parseGraniteManifestFile(f))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!file || !preview) return
    setImporting(true)
    try {
      await importGraniteManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['granite-manifests'] }),
      ])
      showToast(`Manifesto Granito importado: ${preview.bls.length} B/L(s).`, 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar manifesto Granito.', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Importar Manifesto Granito">
      <div className="grid gap-4">
        <VoyageContext label={voyageLabel} />
        <Field label="Arquivo .xlsx / .xls">
          <Input accept=".xlsx,.xls" type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="text-sm text-slate-400">Processando...</div> : null}
        {preview ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="B/Ls" value={preview.bls.length} />
            <Stat label="Erros" value={preview.rowErrors.length} />
          </div>
        ) : null}
        <ModalActions disabled={!preview?.bls.length} loading={importing} onConfirm={() => void handleImport()} onCancel={onClose} />
      </div>
    </Modal>
  )
}

function VaziosImportModal({
  voyageId,
  voyageLabel,
  userId,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseVaziosImportacaoFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
    if (!f) return
    setParsing(true)
    try {
      setPreview(await parseVaziosImportacaoFile(f))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!preview) return
    setImporting(true)
    try {
      await importVaziosImportacaoManifest({ manifest: preview, uploadedBy: userId, voyageId })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
      showToast(`Manifesto Vazios Imp. importado: ${preview.containers.length} container(s).`, 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar manifesto Vazios.', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Importar Manifesto Vazios Importacao">
      <div className="grid gap-4">
        <VoyageContext label={voyageLabel} />
        <Field label="Arquivo .xlsx / .xls / .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="text-sm text-slate-400">Processando...</div> : null}
        {preview ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Containers" value={preview.containers.length} />
            <Stat label="Erros" value={preview.rowErrors.length} />
          </div>
        ) : null}
        <ModalActions disabled={!preview?.containers.length} loading={importing} onConfirm={() => void handleImport()} onCancel={onClose} />
      </div>
    </Modal>
  )
}

function VehiclesImportModal({
  voyageId,
  voyageLabel,
  userId,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseVehicleImportFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

  // userId is not used by importVehicleRows but accepted for consistency
  void userId

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setPreview(null)
    if (!f) return
    setParsing(true)
    try {
      setPreview(await parseVehicleImportFile(f))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao ler arquivo.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!preview?.rows.length) return
    setImporting(true)
    try {
      const result = await importVehicleRows({ voyageId, rows: preview.rows })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
        queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
      ])
      showToast(`Veiculos importados: ${result.successCount} sucesso(s), ${result.errorCount} erro(s).`, result.errorCount ? 'info' : 'success')
      if (!result.errorCount) onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar veiculos.', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Importar Planilha de Veiculos">
      <div className="grid gap-4">
        <VoyageContext label={voyageLabel} />
        <Field label="Arquivo .xlsx / .xls / .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="text-sm text-slate-400">Processando...</div> : null}
        {preview ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Veiculos" value={preview.rows.length} />
            <Stat label="Erros" value={preview.rowErrors.length} />
          </div>
        ) : null}
        <ModalActions disabled={!preview?.rows.length} loading={importing} onConfirm={() => void handleImport()} onCancel={onClose} />
      </div>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-center">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
    </div>
  )
}

function ModalActions({
  disabled,
  loading,
  onConfirm,
  onCancel,
}: {
  disabled: boolean
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
      <Button disabled={disabled} loading={loading} onClick={onConfirm}>Confirmar</Button>
    </div>
  )
}
