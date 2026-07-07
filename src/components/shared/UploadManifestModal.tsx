import { useMemo, useState, type ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PreviewBox } from '../ui/PreviewBox'
import { useToast } from '../ui/Toast'
import { TruncationNote } from './TruncationNote'
import { VoyageCombobox } from './VoyageCombobox'
import { VoyageCreateModal } from './VoyageCreateModal'
import { useAuth } from '../../hooks/useAuth'
import { countDistinctContainerNumbers } from '../../lib/containerCounts'
import { formatCnpjCpf } from '../../lib/utils'
import { computeFileHash, DuplicateManifestImportError, importManifest, RateLimitImportError } from '../../services/manifestImport'
import { countDistinctManifestContainers, parseManifestFile, type ParsedManifest } from '../../services/manifestParser'
import { computeManifestOverwriteDiff } from '../../services/manifestOverwritePreview'
import { logOperationalEvent } from '../../services/operationalEvents'
import { supabase } from '../../services/supabase'
export function UploadManifestModal({
  open,
  onClose,
  initialVoyageId = '',
}: {
  open: boolean
  onClose: () => void
  initialVoyageId?: string
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const [files, setFiles] = useState<File[]>([])
  const [manifestsByFile, setManifestsByFile] = useState<Record<string, ParsedManifest>>({})
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createVoyageOpen, setCreateVoyageOpen] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [importSummary, setImportSummary] = useState<Array<{ file: string; status: 'success' | 'error'; message: string }>>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [applyOverwrites, setApplyOverwrites] = useState(false)
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null)
  const [waitMessage, setWaitMessage] = useState<string | null>(null)

  const primaryManifest = files.length ? manifestsByFile[files[previewIndex]?.name] ?? null : null
  const totals = useMemo(
    () => ({
      bls: primaryManifest?.bls.length ?? 0,
      containerOccurrences: primaryManifest?.bls.reduce((sum, bl) => sum + (bl.containers?.length ?? 0), 0) ?? 0,
      containers: countDistinctManifestContainers(primaryManifest),
      pending: primaryManifest?.bls.filter((bl) => bl.review_status === 'pending_review').length ?? 0,
    }),
    [primaryManifest],
  )
  const routeSummary = useMemo(() => summarizeManifestRoutes(primaryManifest), [primaryManifest])

  // Preview de sobrescrita (#307): B/Ls já existentes na viagem que este
  // manifesto mudaria. Read-only — só dá transparência antes de confirmar.
  const previewFileName = files[previewIndex]?.name ?? null
  const { data: existingOverwriteBls } = useQuery({
    queryKey: ['manifest-overwrite-existing', voyageId, previewFileName],
    enabled: Boolean(voyageId) && Boolean(primaryManifest?.bls.length),
    queryFn: async () => {
      const ids = primaryManifest?.bls.map((bl) => bl.id) ?? []
      if (!ids.length) return [] as Parameters<typeof computeManifestOverwriteDiff>[1]
      const { data, error } = await supabase
        .from('bls')
        .select('id, shipper, consignee, cargo_description, pol, pod, total_weight_kg, total_cbm')
        .eq('voyage_id', Number(voyageId))
        .in('id', ids)
      if (error) throw error
      return (data ?? []) as unknown as Parameters<typeof computeManifestOverwriteDiff>[1]
    },
  })
  const overwrites = useMemo(
    () => computeManifestOverwriteDiff(primaryManifest?.bls ?? [], existingOverwriteBls ?? []),
    [primaryManifest, existingOverwriteBls],
  )

  function resetModalState() {
    setFiles([])
    setManifestsByFile({})
    setParsing(false)
    setSubmitting(false)
    setProgress({ current: 0, total: 0 })
    setImportSummary([])
    setPreviewIndex(0)
    setApplyOverwrites(false)
    setImportStatusMessage(null)
    setWaitMessage(null)
  }

  function closeModal() {
    resetModalState()
    onClose()
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? [])
    setFiles(nextFiles)
    setManifestsByFile({})
    setImportSummary([])
    setProgress({ current: 0, total: 0 })
    setPreviewIndex(0)
    if (!nextFiles.length) return

    setParsing(true)
    try {
      const parsedEntries = await Promise.all(
        nextFiles.map(async (currentFile) => ({
          name: currentFile.name,
          manifest: await parseManifestFile(currentFile),
        })),
      )
      const nextManifests: Record<string, ParsedManifest> = {}
      for (const entry of parsedEntries) nextManifests[entry.name] = entry.manifest
      setManifestsByFile(nextManifests)
      showToast(
        nextFiles.length === 1 ? 'Preview do manifesto carregado.' : `Preview de ${nextFiles.length} manifestos carregado.`,
        'success',
      )
    } catch {
      showToast('Não foi possível ler o arquivo. Confira o formato .xlsx ou .csv.', 'error')
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!files.length || !voyageId || !user) return

    setSubmitting(true)
    setImportSummary([])
    setImportStatusMessage(null)
    setWaitMessage(null)
    setProgress({ current: 0, total: files.length })
    const results: Array<{ file: string; status: 'success' | 'error'; message: string }> = []
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const manifest = manifestsByFile[file.name]
        setProgress({ current: index + 1, total: files.length })
        if (!manifest) {
          results.push({ file: file.name, status: 'error', message: 'Preview não carregado para este arquivo.' })
          continue
        }
        try {
          const fileHash = await computeFileHash(await file.arrayBuffer())
          if (!fileHash) {
            results.push({ file: file.name, status: 'error', message: 'Nao foi possivel calcular o hash do arquivo para deduplicacao.' })
            continue
          }
          await importManifestWithRetry({
            filename: file.name,
            voyageId: Number(voyageId),
            manifest,
            uploadedBy: user.id,
            fileHash,
            applyOverwrites,
            onRateLimitWait: (seconds) => setWaitMessage(`Limite atingido. Aguardando ${seconds}s para retomar...`),
            onResume: () => setWaitMessage(null),
          })
          results.push({ file: file.name, status: 'success', message: 'Importado com sucesso.' })
          if (index < files.length - 1) {
            setWaitMessage('Aguardando alguns segundos antes do proximo arquivo...')
            await sleep(3000)
            setWaitMessage(null)
          }
        } catch (error) {
          if (error instanceof DuplicateManifestImportError) {
            void logOperationalEvent({
              code: 'manifest_import_duplicate_hash',
              message: error.message,
              changedBy: user?.id ?? null,
              entityId: file.name,
              context: { voyageId: Number(voyageId), filename: file.name },
            })
            results.push({ file: file.name, status: 'error', message: error.message })
            continue
          }
          if (error instanceof RateLimitImportError) {
            void logOperationalEvent({
              code: 'manifest_import_rate_limited',
              message: error.message,
              changedBy: user?.id ?? null,
              entityId: file.name,
              context: { voyageId: Number(voyageId), filename: file.name },
            })
            results.push({ file: file.name, status: 'error', message: error.message })
            continue
          }
          console.error('Erro ao importar manifesto:', error)
          results.push({ file: file.name, status: 'error', message: String(error instanceof Error ? error.message : error) })
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['bls'] })
      await queryClient.invalidateQueries({ queryKey: ['bl-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['invoice-links'] })
      await queryClient.invalidateQueries({ queryKey: ['voyages'] })
      setImportSummary(results)
      const successCount = results.filter((item) => item.status === 'success').length
      const errorCount = results.length - successCount
      const allProcessed = results.length === files.length
      const allSucceeded = allProcessed && successCount === files.length

      if (allSucceeded) {
        setImportStatusMessage(
          successCount === 1 ? 'Manifesto importado com sucesso.' : `${successCount} manifestos importados com sucesso.`,
        )
        showToast(
          successCount === 1 ? 'Manifesto importado com sucesso.' : `${successCount} manifestos importados com sucesso.`,
          'success',
        )
        closeModal()
        return
      } else if (successCount > 0) {
        setImportStatusMessage(`Importacao parcial: ${successCount} sucesso(s), ${errorCount} erro(s).`)
        showToast(`Importacao concluida com ${successCount} sucesso(s) e ${errorCount} erro(s).`, 'info')
      } else {
        setImportStatusMessage('Falha na importação: nenhum manifesto foi importado.')
        showToast('Nenhum manifesto foi importado. Revise os erros abaixo.', 'error')
      }
      if (files.length > 1) {
        const nextPendingIndex = files.findIndex((file, index) => index > previewIndex && !results.some((row) => row.file === file.name))
        if (nextPendingIndex >= 0) setPreviewIndex(nextPendingIndex)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={closeModal} title="Importar Manifesto CNTR">
      <div className="grid gap-5">
        <VoyageCombobox
          required
          label="Viagem de destino"
          selectedVoyageId={voyageId}
          onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
        />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setCreateVoyageOpen(true)}>
            Criar viagem agora
          </Button>
        </div>
        <Field label="Arquivos .xlsx ou .csv">
          <Input accept=".xlsx,.xls,.csv" type="file" multiple onChange={handleFile} />
        </Field>

        <div className="app-panel app-panel--padded text-sm">
          Clientes sao vinculados por CNPJ/CPF ja existente em <span className="font-semibold text-[var(--app-text-strong)]">Clientes &gt; Importar base</span>.
          Manifestos não criam novos cadastros automaticamente.
        </div>

        {parsing ? <div className="app-panel__meta">Processando arquivo com SheetJS sob demanda...</div> : null}

        {files.length > 0 ? (
          <div className="app-panel app-panel--padded text-sm">
            {files.length} arquivo(s) selecionado(s). O preview detalhado abaixo mostra o arquivo {Math.min(previewIndex + 1, files.length)}.
          </div>
        ) : null}

        {primaryManifest ? (
          <div className="grid gap-4">
            <div className="app-panel app-panel--padded text-sm">
              <div className="app-metric-tile__label">Trecho detectado no manifesto</div>
              <div className="mt-1 font-semibold text-[var(--app-text-strong)]">{routeSummary.label}</div>
              <div className="app-panel__meta mt-1">
                A viagem agrupa navio e número da viagem. O POL/POD permanece registrado nos B/Ls deste manifesto.
              </div>
            </div>

            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <PreviewBox label="B/Ls" value={totals.bls} />
              <PreviewBox label="Ocorrencias CNTR" value={totals.containerOccurrences} />
              <PreviewBox label="Containers distintos" value={totals.containers} />
              <PreviewBox label="Pendentes revisão" value={totals.pending} />
            </div>

            {overwrites.length > 0 ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-semibold">
                  {overwrites.length} B/L(s) já existente(s) nesta viagem serão sobrescritos por este manifesto:
                </div>
                <ul className="mt-1 space-y-1">
                  {overwrites.slice(0, 10).map((ow) => (
                    <li key={ow.bl_number}>
                      <span className="font-mono text-xs font-semibold">{ow.bl_number}</span>{' '}
                      <span className="text-amber-800">
                        {ow.diffs.map((d) => `${d.field}: "${d.from}" → "${d.to}"`).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
                {overwrites.length > 10 ? (
                  <div className="mt-1 text-xs">… e mais {overwrites.length - 10} B/L(s).</div>
                ) : null}
                <label className="mt-2 flex items-start gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={applyOverwrites}
                    onChange={(e) => setApplyOverwrites(e.target.checked)}
                    className="mt-0.5 accent-amber-600"
                  />
                  <span>
                    Aplicar estas sobrescritas ao confirmar (auditado como FONTE_SOBRESCRITO). Desmarcado, o B/L é
                    <strong> mantido</strong> — nada é sobrescrito em silêncio (ADR 0017).
                  </span>
                </label>
              </div>
            ) : null}

            {routeSummary.multipleRoutes ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                O arquivo trouxe mais de uma combinacao POL/POD. Revise o parsing antes de importar.
              </div>
            ) : null}

            <div className="app-table-scroll app-table-scroll--sticky rounded-xl border border-[var(--app-border)]">
              <table className="app-table app-table--compact min-w-[720px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">B/L</th>
                    <th scope="col" className="px-3 py-2">Consignatário</th>
                    <th scope="col" className="px-3 py-2">CNPJ</th>
                    <th scope="col" className="px-3 py-2">Containers distintos</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {primaryManifest.bls.slice(0, 25).map((bl) => (
                    <tr key={bl.id}>
                      <td className="px-3 py-2 font-semibold text-[var(--app-text-strong)]">{bl.id}</td>
                      <td className="px-3 py-2">{bl.consignee ?? '-'}</td>
                      <td className="px-3 py-2">{formatCnpjCpf(bl.cnpj_cpf)}</td>
                      <td className="px-3 py-2">{countDistinctContainerNumbers(bl.containers)}</td>
                      <td className="px-3 py-2">
                        <ReviewBadge status={bl.review_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TruncationNote shown={25} total={primaryManifest.bls.length} noun="B/L" nounPlural="B/Ls" />

            {primaryManifest.rowErrors.length ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {primaryManifest.rowErrors.length} linha(s) com erro serao registradas em import_errors.
              </div>
            ) : null}
          </div>
        ) : null}

        {submitting ? (
          <div className="rounded-xl border border-blue-500/40 bg-blue-500/15 p-3 text-sm font-bold text-blue-900">
            Importando arquivo {progress.current} de {progress.total}...
          </div>
        ) : null}

        {waitMessage ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 text-sm font-semibold text-amber-900">
            {waitMessage}
          </div>
        ) : null}

        {importSummary.length ? (
            <div className="app-panel app-panel--padded max-h-44 overflow-auto text-sm">
            <div className="app-metric-tile__label mb-2">Resumo da importação</div>
            <div className="grid gap-1">
              {importSummary.map((item) => (
                <div key={`${item.file}-${item.message}`} className={item.status === 'success' ? 'text-green-700' : 'text-red-700'}>
                  {item.status === 'success' ? 'OK' : 'ERRO'} | {item.file} | {item.message}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {importStatusMessage ? (
          <div className="app-panel px-3 py-2 text-sm">
            {importStatusMessage}
          </div>
        ) : null}

        {files.length > 1 ? (
          <div className="app-panel flex items-center justify-between gap-3 px-3 py-2 text-xs text-[var(--app-muted)]">
            <span>
              Arquivo em preview: <span className="font-semibold text-[var(--app-text-strong)]">{files[previewIndex]?.name ?? '-'}</span>
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={previewIndex <= 0} onClick={() => setPreviewIndex((current) => Math.max(0, current - 1))}>
                Anterior
              </Button>
              <Button
                variant="ghost"
                disabled={previewIndex >= files.length - 1}
                onClick={() => setPreviewIndex((current) => Math.min(files.length - 1, current + 1))}
              >
                Proximo
              </Button>
            </div>
          </div>
        ) : null}

        <div className="app-modal__actions">
            <Button variant="secondary" onClick={closeModal}>
            Cancelar
          </Button>
          <Button disabled={!files.length || !voyageId} loading={submitting} onClick={handleImport}>
            Confirmar importação
          </Button>
        </div>
        {!voyageId ? (
          <div className="text-sm text-amber-700">Selecione ou crie uma viagem de destino para habilitar a confirmação.</div>
        ) : null}
      </div>

      <VoyageCreateModal
        open={createVoyageOpen}
        onClose={() => setCreateVoyageOpen(false)}
        title="Criar viagem para este manifesto"
        initialValues={primaryManifest?.suggestedVoyage}
        note={
          primaryManifest
            ? `Trecho detectado neste arquivo: ${routeSummary.label}. A viagem sera criada sem amarrar esse trecho, porque cada manifesto da viagem carrega seu proprio POL/POD.`
            : undefined
        }
        onSaved={(createdVoyageId) => {
          setVoyageId(String(createdVoyageId))
          setCreateVoyageOpen(false)
        }}
      />

    </Modal>
  )
}

async function importManifestWithRetry(payload: {
  filename: string
  voyageId: number
  manifest: ParsedManifest
  uploadedBy: string
  fileHash: string | null
  applyOverwrites: boolean
  onRateLimitWait?: (seconds: number) => void
  onResume?: () => void
}) {
  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      payload.onResume?.()
      await importManifest(payload)
      return
    } catch (error) {
      const isRateLimit = error instanceof RateLimitImportError
      const isLast = attempt === maxAttempts
      if (!isRateLimit || isLast) throw error
      payload.onRateLimitWait?.(60)
      await sleep(60000)
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ReviewBadge({ status }: { status: string }) {
  if (status === 'pending_review') return <Badge tone="yellow">Pendente</Badge>
  if (status === 'reviewed') return <Badge tone="green">Revisado</Badge>
  return <Badge tone="blue">OK</Badge>
}

function summarizeManifestRoutes(manifest: ParsedManifest | null) {
  const routeLabels = Array.from(
    new Set(
      (manifest?.bls ?? [])
        .map((bl) => {
          if (!bl.pol && !bl.pod) return null
          return `${bl.pol ?? '-'} -> ${bl.pod ?? '-'}`
        })
        .filter((route): route is string => Boolean(route)),
    ),
  )

  if (routeLabels.length === 0) {
    return { label: 'Não identificado', multipleRoutes: false }
  }

  if (routeLabels.length === 1) {
    return { label: routeLabels[0], multipleRoutes: false }
  }

  return { label: routeLabels.join(' | '), multipleRoutes: true }
}
