import { useEffect, useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { FileImportModal, type FilePreviewEntry } from './FileImportModal'
import { computeFileHash, importManifest } from '../../services/manifestImport'
import { supabase } from '../../services/supabase'
import { countDistinctManifestContainers, parseManifestFile } from '../../services/manifestParser'
import { importBreakbulkManifest, parseBreakbulkManifestFile } from '../../services/breakbulkImport'
import { importGraniteManifest, parseGraniteManifestFile } from '../../services/graniteImport'
import { importVaziosManifest, parseVaziosManifestFile } from '../../services/vaziosImport'
import { importVaziosImportacaoManifest, parseVaziosImportacaoFile } from '../../services/vaziosImportacaoImport'
import { importVehicleRows, parseVehicleImportFile } from '../../services/vehicleImport'
import { parseBaplieFile } from '../../services/baplieParser'
import { importBaplieStaging } from '../../services/baplieImport'
import { buildCntrManifestImportSummary } from './voyageImportSummary'

type ImportType = 'cntr' | 'bb' | 'granite' | 'vaziosImp' | 'vaziosExp' | 'vehicles' | 'baplie'

const IMPORT_LABELS: Record<ImportType, string> = {
  cntr: 'Manifesto CNTR',
  bb: 'Manifesto BB',
  granite: 'Manifesto Granito',
  vaziosImp: 'Manifesto Vazios Imp.',
  vaziosExp: 'Vazios Exp',
  vehicles: 'Planilha Veiculos',
  baplie: 'Baplie EDI',
}

export function VoyageImportActions({
  voyageId,
  voyageLabel,
  userId,
  types,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  types: ImportType[]
}) {
  const [activeType, setActiveType] = useState<ImportType | null>(null)
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const invalidateAfterBLImport = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bls'] }),
      queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
      queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
    ])
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {types.map((type) => (
          <Button key={type} variant="secondary" className="text-xs" onClick={() => setActiveType(type)}>
            <Upload size={13} />
            {IMPORT_LABELS[type]}
          </Button>
        ))}
      </div>

      {activeType === 'cntr' ? (
        <CntrImportModal
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          userId={userId}
          onClose={() => setActiveType(null)}
          onImported={invalidateAfterBLImport}
        />
      ) : null}

      {activeType === 'bb' ? (
        <FileImportModal
          title="Importar Manifesto BB (Break Bulk)"
          voyageLabel={voyageLabel}
          accept=".xlsx,.xls,.csv"
          parser={parseBreakbulkManifestFile}
          canImport={(p) => p.bls.length > 0}
          importer={async (preview, file) => {
            await importBreakbulkManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId })
            await invalidateAfterBLImport()
            showToast(`Manifesto BB importado: ${preview.bls.length} B/L(s).`, 'success')
          }}
          renderPreview={(preview) => (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="B/Ls" value={preview.bls.length} />
              <Stat label="Erros" value={preview.rowErrors.length} />
              <Stat label="Linhas" value={preview.bls.length + preview.rowErrors.length} />
            </div>
          )}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'granite' ? (
        <FileImportModal
          title="Importar Manifesto Granito"
          voyageLabel={voyageLabel}
          accept=".xlsx,.xls"
          parser={parseGraniteManifestFile}
          canImport={(p) => p.bls.length > 0}
          importer={async (preview, file) => {
            await importGraniteManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
              queryClient.invalidateQueries({ queryKey: ['granite-manifests'] }),
            ])
            showToast(`Manifesto Granito importado: ${preview.bls.length} B/L(s).`, 'success')
          }}
          renderPreview={(preview) => (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="B/Ls" value={preview.bls.length} />
              <Stat label="Erros" value={preview.rowErrors.length} />
            </div>
          )}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vaziosImp' ? (
        <FileImportModal
          title="Importar Manifesto Vazios Importacao"
          voyageLabel={voyageLabel}
          accept=".xlsx,.xls,.csv"
          parser={parseVaziosImportacaoFile}
          canImport={(p) => p.containers.length > 0}
          importer={async (preview) => {
            await importVaziosImportacaoManifest({ manifest: preview, uploadedBy: userId, voyageId })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] }),
              queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] }),
            ])
            showToast(`Manifesto Vazios Imp. importado: ${preview.containers.length} container(s).`, 'success')
          }}
          renderPreview={(preview) => (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Containers" value={preview.containers.length} />
              <Stat label="Erros" value={preview.rowErrors.length} />
            </div>
          )}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vaziosExp' ? (
        <FileImportModal
          title="Importar Vazios Exportacao"
          voyageLabel={voyageLabel}
          accept=".xlsx,.xls,.csv"
          parser={parseVaziosManifestFile}
          canImport={(p) => p.bookings.length > 0}
          importer={async (preview, file) => {
            await importVaziosManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId, description: file.name })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
              queryClient.invalidateQueries({ queryKey: ['vazios-bookings'] }),
            ])
            showToast(`Vazios Exp importado: ${preview.bookings.length} booking(s).`, 'success')
          }}
          renderPreview={(preview) => (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Bookings" value={preview.bookings.length} />
              <Stat label="Erros" value={preview.rowErrors.length} />
              <Stat label="Linhas" value={preview.bookings.length + preview.rowErrors.length} />
            </div>
          )}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'baplie' ? (
        <FileImportModal
          title="Importar Baplie EDI"
          voyageLabel={voyageLabel}
          accept=".edi,.txt,.bpl"
          parser={parseBaplieFile}
          canImport={(p) => p.containers.length > 0}
          importer={async (preview) => {
            const { staged } = await importBaplieStaging(voyageId, preview.containers, userId)
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['baplie-staging', voyageId] }),
              queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] }),
            ])
            showToast(`Baplie importado: ${staged} container(s) em staging.`, 'success')
          }}
          renderPreview={(preview) => (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Containers" value={preview.containers.length} />
                <Stat label="Cheios" value={preview.containers.filter((c) => c.status === 'full').length} />
                <Stat label="PODs" value={preview.pods.length} />
              </div>
              {preview.vessel_name || preview.voyage_number ? (
                <div className="app-panel__meta text-sm">
                  Navio/Viagem detectado: <span className="font-semibold text-[var(--app-text-strong)]">{preview.vessel_name ?? '-'} / {preview.voyage_number ?? '-'}</span>
                </div>
              ) : null}
            </div>
          )}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vehicles' ? (
        <VehiclesImportModal voyageId={voyageId} voyageLabel={voyageLabel} onClose={() => setActiveType(null)} />
      ) : null}
    </>
  )
}

function CntrImportModal({
  voyageId,
  voyageLabel,
  userId,
  onClose,
  onImported,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  onClose: () => void
  onImported: () => Promise<void>
}) {
  const { showToast } = useToast()
  return (
    <FileImportModal
      title="Importar Manifesto CNTR"
      voyageLabel={voyageLabel}
      accept=".xlsx,.xls"
      multiple
      parser={parseManifestFile}
      canImport={(p) => p.bls.length > 0}
      importer={async (preview, file) => {
        const fileHash = await file.arrayBuffer().then((buf) => computeFileHash(buf)).catch(() => null)
        await importManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId, fileHash })
        await onImported()
        showToast(`Manifesto CNTR importado: ${preview.bls.length} B/L(s), ${countDistinctManifestContainers(preview)} container(s).`, 'success')
      }}
      renderBatchSummary={(entries) => <CntrConsolidatedSummary entries={entries} />}
      renderPreview={(preview) => <CntrPreview preview={preview} voyageId={voyageId} />}
      onClose={onClose}
    />
  )
}

type ManifestPreview = Awaited<ReturnType<typeof parseManifestFile>>

function CntrConsolidatedSummary({ entries }: { entries: FilePreviewEntry<ManifestPreview>[] }) {
  const summary = buildCntrManifestImportSummary(entries.map((entry) => ({ filename: entry.file.name, preview: entry.preview })))

  return (
    <div className="rounded-xl border border-[#30363d] bg-[#0d1117]">
      <div className="border-b border-[#30363d] px-3 py-2 text-sm font-semibold text-white">
        Manifestos selecionados
      </div>
      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[620px] text-left text-sm">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">Arquivo</th>
              <th scope="col" className="px-3 py-2">POL</th>
              <th scope="col" className="px-3 py-2">POD</th>
              <th scope="col" className="px-3 py-2">B/Ls</th>
              <th scope="col" className="px-3 py-2">Containers distintos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363d]">
            {summary.rows.map((row) => (
              <tr key={row.filename}>
                <td className="px-3 py-2 font-semibold text-white">{row.filename}</td>
                <td className="px-3 py-2">{row.pol}</td>
                <td className="px-3 py-2">{row.pod}</td>
                <td className="px-3 py-2">{row.blCount}</td>
                <td className="px-3 py-2">{row.containerCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[#30363d] px-3 py-2 text-sm text-slate-300">
        Total consolidado de containers distintos: <span className="font-semibold text-white">{summary.totalDistinctContainers}</span>
      </div>
    </div>
  )
}

function CntrPreview({ preview, voyageId }: { preview: ManifestPreview; voyageId: number }) {
  const [existingBlIds, setExistingBlIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!preview.bls.length || !voyageId) {
      setExistingBlIds(new Set())
      return
    }
    const blNumbers = preview.bls.map((bl) => bl.id).filter(Boolean)
    if (!blNumbers.length) return

    supabase
      .from('bls')
      .select('id')
      .eq('voyage_id', voyageId)
      .in('id', blNumbers)
      .then(({ data }) => {
        setExistingBlIds(new Set((data ?? []).map((r) => String(r.id ?? ''))))
      })
  }, [preview, voyageId])

  const newBls = preview.bls.filter((bl) => !existingBlIds.has(bl.id ?? '')).length
  const updatedBls = preview.bls.filter((bl) => existingBlIds.has(bl.id ?? '')).length

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="B/Ls" value={preview.bls.length} />
        <Stat label="Containers" value={countDistinctManifestContainers(preview)} />
        <Stat label="Erros" value={preview.rowErrors.length} />
      </div>
      {(newBls > 0 || updatedBls > 0) ? (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-sm">
          <span className="text-green-400 font-semibold">{newBls} novo(s)</span>
          {updatedBls > 0 && (
            <span className="ml-3 text-amber-400 font-semibold">{updatedBls} será(ão) atualizado(s)</span>
          )}
          <span className="ml-2 text-[var(--app-muted)] text-xs">— revisão de impacto antes de confirmar</span>
        </div>
      ) : null}
    </>
  )
}

function VehiclesImportModal({
  voyageId,
  voyageLabel,
  onClose,
}: {
  voyageId: number
  voyageLabel: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof parseVehicleImportFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)

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
        <div className="app-panel app-panel--padded text-sm">
          Viagem: <span className="font-semibold text-[var(--app-text-strong)]">{voyageLabel}</span>
        </div>
        <Field label="Arquivo .xlsx / .xls / .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="app-panel__meta">Processando...</div> : null}
        {preview ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Veiculos" value={preview.rows.length} />
            <Stat label="Erros" value={preview.rowErrors.length} />
          </div>
        ) : null}
        <div className="app-modal__actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={!preview?.rows.length} loading={importing} onClick={() => void handleImport()}>Confirmar</Button>
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="app-metric-tile text-center">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value}</div>
    </div>
  )
}
