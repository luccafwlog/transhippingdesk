import { useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Box, Car, Download, FileText, Mountain, Package, PackageOpen, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { FileImportModal } from './FileImportModal'
import { BlImportModal } from './BlImportModal'
import { BlDocumentImportModal } from './BlDocumentImportModal'
import { CeMercanteImportModal } from './CeMercanteImportModal'
import { importBreakbulkManifest, parseBreakbulkManifestFile } from '../../services/breakbulkImport'
import { importGraniteManifest, parseGraniteManifestFile } from '../../services/graniteImport'
import { importVaziosImportacaoManifest, parseVaziosImportacaoFile } from '../../services/vaziosImportacaoImport'
import { importVehicleRows, parseVehicleImportFile } from '../../services/vehicleImport'
import { parseBaplieFile } from '../../services/baplieParser'
import { importBaplieStaging } from '../../services/baplieImport'

type ImportType = 'bb' | 'granite' | 'ceMercanteGranite' | 'vaziosImp' | 'vaziosExp' | 'vehicles' | 'baplie' | 'blFreight' | 'blBreakbulk' | 'ceMercante'

type ImportGroup = 'baplie' | 'bls' | 'importEquipment' | 'exportManifest' | 'exportVazios'

const IMPORT_LABELS: Record<ImportType, string> = {
  bb: 'Manifesto BB',
  granite: 'Manifesto Granito',
  ceMercanteGranite: 'CE Mercante (Granito)',
  vaziosImp: 'Vazios IMP',
  vaziosExp: 'Novo embarque de vazios',
  vehicles: 'Veículos',
  baplie: 'Baplie EDI',
  blFreight: 'B/L container',
  blBreakbulk: 'B/L carga solta',
  ceMercante: 'CE Mercante',
}

const IMPORT_ORDER: ImportType[] = ['baplie', 'blFreight', 'blBreakbulk', 'ceMercante', 'bb', 'vehicles', 'vaziosImp', 'granite', 'ceMercanteGranite', 'vaziosExp']

const IMPORT_GROUP_BY_TYPE: Record<ImportType, ImportGroup> = {
  baplie: 'baplie',
  blFreight: 'bls',
  blBreakbulk: 'bls',
  ceMercante: 'bls',
  bb: 'bls',
  vehicles: 'importEquipment',
  vaziosImp: 'importEquipment',
  granite: 'exportManifest',
  ceMercanteGranite: 'exportManifest',
  vaziosExp: 'exportVazios',
}

const IMPORT_ICONS: Record<ImportType, LucideIcon> = {
  baplie: Package,
  blFreight: Box,
  blBreakbulk: FileText,
  ceMercante: ShieldCheck,
  bb: FileText,
  vehicles: Car,
  vaziosImp: PackageOpen,
  granite: Mountain,
  ceMercanteGranite: ShieldCheck,
  vaziosExp: PackageOpen,
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { profile } = useAuth()
  const canEditVazios = Boolean(profile || userId)
  const canEditVehicles = Boolean(profile || userId)
  const allowedTypes = IMPORT_ORDER.filter((type) => {
    if (!types.includes(type)) return false
    if (type === 'vaziosExp') return canEditVazios
    if (type === 'vehicles') return canEditVehicles
    return Boolean(profile || userId)
  })
  const actionGroups: Array<{ group: ImportGroup; types: ImportType[] }> = []
  for (const type of allowedTypes) {
    const group = IMPORT_GROUP_BY_TYPE[type]
    const current = actionGroups[actionGroups.length - 1]
    if (current?.group === group) current.types.push(type)
    else actionGroups.push({ group, types: [type] })
  }

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
      <div className="flex flex-wrap items-center gap-2">
        {actionGroups.map(({ group, types: groupTypes }, groupIndex) => (
          <div key={group} className="flex flex-wrap items-center gap-2">
            {groupIndex > 0 ? <span aria-hidden="true" className="mx-1 h-6 w-px bg-[var(--app-border)]" /> : null}
            {groupTypes.map((type) => {
              const Icon = IMPORT_ICONS[type]
              const highlight = type === 'blFreight' || type === 'blBreakbulk'
              return (
                <Button key={type} variant="secondary" className={`text-xs ${highlight ? 'border-[var(--app-blue-btn)] text-[var(--app-blue-btn)]' : ''}`} onClick={() => type === 'vaziosExp' ? navigate(`/embarquevazios?voyage=${voyageId}`) : setActiveType(type)}>
                  <Icon size={13} />
                  {IMPORT_LABELS[type]}
                </Button>
              )
            })}
          </div>
        ))}
      </div>

      {activeType === 'bb' ? (
        <FileImportModal
          title="Importar Manifesto BB (Break Bulk)"
          subtitle={<>Viagem: <span className="font-semibold text-[var(--app-text-strong)]">{voyageLabel}</span></>}
          accept=".xlsx,.xls,.csv"
          parser={parseBreakbulkManifestFile}
          helper={<TemplateLinks baseName="manifesto-bb-modelo" />}
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
        <FileImportModal<Awaited<ReturnType<typeof parseGraniteManifestFile>>, Awaited<ReturnType<typeof importGraniteManifest>>>
          title="Importar Manifesto Granito"
          subtitle={<>Viagem: <span className="font-semibold text-[var(--app-text-strong)]">{voyageLabel}</span></>}
          accept=".xlsx,.xls"
          parser={parseGraniteManifestFile}
          canImport={(p) => p.bls.length > 0}
          importer={async (preview, file) => {
            const result = await importGraniteManifest({ filename: file.name, voyageId, manifest: preview, uploadedBy: userId })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
              queryClient.invalidateQueries({ queryKey: ['granite-manifests'] }),
            ])
            showToast(`Manifesto Granito importado: ${preview.bls.length} B/L(s).`, 'success')
            return result
          }}
          renderPreview={(preview) => (
            <div className="grid gap-3">
              <div className="app-panel app-panel--padded grid gap-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-muted)]">Viagem de destino</span><span className="font-semibold text-[var(--app-text-strong)]">{voyageLabel}</span></div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--app-border)] pt-2"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-muted)]">Declarado na planilha</span><span className="font-[var(--app-font-mono)] text-[13px] text-[var(--app-text)]">{preview.vesselVoyage || 'Não informado'}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="B/Ls" value={preview.bls.length} />
                <Stat label="Blocos" value={preview.bls.reduce((sum, bl) => sum + Number(bl.blocks_qty ?? 0), 0)} />
                <Stat label="Peso" value={preview.bls.reduce((sum, bl) => sum + Number(bl.real_weight_kg ?? 0), 0) / 1000} suffix="ton" />
                <Stat label="Erros" value={preview.rowErrors.length} />
              </div>
              {preview.bls.some((bl) => bl.reconciliationStatus !== 'matched') ? <div className="flex items-start gap-2 rounded-lg border border-[var(--app-gold)] bg-[var(--app-gold-soft)] p-3 text-xs text-[var(--app-gold-strong)]"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span><b>{preview.bls.filter((bl) => bl.reconciliationStatus !== 'matched').length} B/L(s) entra(m) pendente(s) de reconciliação.</b> O consignatário ainda não casou com um cliente.</span></div> : null}
            </div>
          )}
          renderImportResult={(result) => result.pendingCount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--app-gold)] bg-[var(--app-gold-soft)] p-3 text-xs text-[var(--app-gold-strong)]">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" />
              <span><b>{result.pendingCount} B/L(s) entra(m) pendente(s) de reconciliação.</b> Revise o vínculo do consignatário antes de faturar.</span>
            </div>
          ) : <div className="app-panel__meta">Importação concluída sem pendências de reconciliação.</div>}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vaziosImp' ? (
        <FileImportModal
          title="Importar Manifesto Vazios Importacao"
          subtitle={<>Viagem: <span className="font-semibold text-[var(--app-text-strong)]">{voyageLabel}</span></>}
          accept=".xlsx,.xls,.csv"
          parser={parseVaziosImportacaoFile}
          canImport={(p) => p.containers.length > 0}
          importer={async (preview) => {
            await importVaziosImportacaoManifest({ manifest: preview, uploadedBy: userId, voyageId })
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['voyages'] }),
              queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] }),
              queryClient.invalidateQueries({ queryKey: ['vazios-importacao-manifests'] }),
              queryClient.invalidateQueries({ queryKey: ['vazios-importacao-containers'] }),
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

      {activeType === 'baplie' ? (
        <BaplieImportModal
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          userId={userId}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'vehicles' && canEditVehicles ? (
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

      {activeType === 'blBreakbulk' ? (
        <BlDocumentImportModal
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'ceMercante' ? (
        <CeMercanteImportModal open lockedVoyageId={voyageId} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'ceMercanteGranite' ? (
        <CeMercanteImportModal open target="granite" lockedVoyageId={voyageId} onClose={() => setActiveType(null)} />
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

function TemplateLinks({ baseName }: { baseName: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {['xlsx', 'csv'].map((extension) => (
        <a key={extension} className="app-btn app-btn--secondary" href={`/templates/${baseName}.${extension}`} download={`${baseName}.${extension}`}>
          <Download size={16} />
          Baixar modelo .{extension}
        </a>
      ))}
    </div>
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
        <TemplateLinks baseName="veiculos-modelo" />
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

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="app-metric-tile text-center">
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}{suffix ? ` ${suffix}` : ''}</div>
    </div>
  )
}
