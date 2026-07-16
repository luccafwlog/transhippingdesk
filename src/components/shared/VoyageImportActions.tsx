import { useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { FileImportModal } from './FileImportModal'
import { BlImportModal } from './BlImportModal'
import { importBreakbulkManifest, parseBreakbulkManifestFile } from '../../services/breakbulkImport'
import { importGraniteManifest, parseGraniteManifestFile } from '../../services/graniteImport'
import { importVaziosManifest, parseVaziosManifestFile } from '../../services/vaziosImport'
import { importVaziosImportacaoManifest, parseVaziosImportacaoFile } from '../../services/vaziosImportacaoImport'
import { importVehicleRows, parseVehicleImportFile } from '../../services/vehicleImport'
import { parseBaplieFile } from '../../services/baplieParser'
import { importBaplieStaging } from '../../services/baplieImport'

type ImportType = 'bb' | 'granite' | 'vaziosImp' | 'vaziosExp' | 'vehicles' | 'baplie' | 'blFreight'

const IMPORT_LABELS: Record<ImportType, string> = {
  bb: 'Manifesto BB',
  granite: 'Manifesto Granito',
  vaziosImp: 'Manifesto Vazios Imp.',
  vaziosExp: 'Vazios Exp',
  vehicles: 'Planilha Veiculos',
  baplie: 'Baplie EDI',
  blFreight: 'B/L',
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
          title="Importar Vazios Exportação"
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
        <BaplieImportModal
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          userId={userId}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vehicles' ? (
        <VehiclesImportModal voyageId={voyageId} voyageLabel={voyageLabel} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'blFreight' ? (
        <BlImportModal
          open
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          onClose={() => setActiveType(null)}
        />
      ) : null}
    </>
  )
}

function BaplieImportModal({
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
  const [parsed, setParsed] = useState<Awaited<ReturnType<typeof parseBaplieFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [excludedPods, setExcludedPods] = useState<Set<string>>(new Set())

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setParsed(null)
    setExcludedPods(new Set())
    if (!f) return
    setParsing(true)
    try {
      setParsed(await parseBaplieFile(f))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível ler o arquivo. Verifique o formato EDI.', 'error')
    } finally {
      setParsing(false)
    }
  }

  function togglePod(pod: string) {
    setExcludedPods((prev) => {
      const next = new Set(prev)
      if (next.has(pod)) next.delete(pod)
      else next.add(pod)
      return next
    })
  }

  const pods = parsed?.pods ?? []
  const filteredContainers = (parsed?.containers ?? []).filter((c) => !c.pod || !excludedPods.has(c.pod))
  const includedPods = pods.filter((pod) => !excludedPods.has(pod)).length

  async function handleImport() {
    if (!filteredContainers.length) return
    setImporting(true)
    try {
      const { staged } = await importBaplieStaging(voyageId, filteredContainers, userId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['baplie-staging', voyageId] }),
        queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] }),
      ])
      showToast(`Baplie importado: ${staged} container(s) em staging.`, 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao importar Baplie EDI.', 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Importar Baplie EDI">
      <div className="grid gap-4">
        <div className="app-panel app-panel--padded text-sm">
          Viagem: <span className="font-semibold text-[var(--app-text-strong)]">{voyageLabel}</span>
        </div>
        <Field label="Arquivo .edi,.txt,.bpl">
          <Input accept=".edi,.txt,.bpl" type="file" onChange={handleFile} />
        </Field>
        {parsing ? <div className="app-panel__meta">Processando...</div> : null}
        {parsed ? (
          <div className="grid gap-3">
            {pods.length > 0 ? (
              <div className="app-panel app-panel--padded">
                <div className="mb-2 text-xs uppercase tracking-wider text-[var(--app-muted)]">
                  Portos de descarga — desmarque os que deseja ignorar
                </div>
                <div className="flex flex-wrap gap-3">
                  {pods.map((pod) => (
                    <label key={pod} className="flex cursor-pointer items-center gap-2 text-sm text-[var(--app-text-strong)]">
                      <input
                        type="checkbox"
                        checked={!excludedPods.has(pod)}
                        onChange={() => togglePod(pod)}
                        className="accent-blue-500"
                      />
                      {pod}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Containers" value={filteredContainers.length} />
              <Stat label="Cheios" value={filteredContainers.filter((c) => c.status === 'full').length} />
              <Stat label="PODs" value={includedPods} />
            </div>
            {parsed.vessel_name || parsed.voyage_number ? (
              <div className="app-panel__meta text-sm">
                Navio/Viagem detectado: <span className="font-semibold text-[var(--app-text-strong)]">{parsed.vessel_name ?? '-'} / {parsed.voyage_number ?? '-'}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="app-modal__actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={filteredContainers.length === 0} loading={importing} onClick={() => void handleImport()}>
            Confirmar{excludedPods.size > 0 ? ` (${filteredContainers.length} containers)` : ''}
          </Button>
        </div>
      </div>
    </Modal>
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
        queryClient.invalidateQueries({ queryKey: ['vehicle-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-vehicle-stats'] }),
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
            <Stat label="Veículos" value={preview.rows.length} />
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
