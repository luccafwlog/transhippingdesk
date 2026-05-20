import { useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyageOptions } from '../hooks/useBls'
import { supabase } from '../services/supabase'
import { parseBaplieFile } from '../services/baplieParser'
import { importBaplieStaging } from '../services/baplieImport'
import {
  reconcileBaplieWithManifest,
  applyBaplieAttribute,
  type BaplieReconciliationItem,
  type AttributeDivergence,
} from '../services/baplieReconciliation'
import {
  importVaziosFromBaplie,
  getBaplieManifestForVoyage,
  deleteBaplieManifestForVoyage,
} from '../services/vaziosImportacaoImport'
import type { BaplieContainer } from '../types/database'
import { formatDate } from '../lib/utils'

export function Baplie() {
  const [searchParams, setSearchParams] = useSearchParams()
  const voyageId = searchParams.get('voyage') ?? ''
  const { showToast } = useToast()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [uploadOpen, setUploadOpen] = useState(false)

  const { data: stagingData, isLoading: stagingLoading } = useQuery({
    queryKey: ['baplie-staging', voyageId],
    enabled: !!voyageId,
    queryFn: async () => {
      const PAGE = 1000
      let all: BaplieContainer[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('baplie_containers' as never)
          .select('*')
          .eq('voyage_id', Number(voyageId))
          .order('container_number')
          .range(from, from + PAGE - 1)
        if (error) throw error
        all = all.concat((data ?? []) as BaplieContainer[])
        if (!data || data.length < PAGE) break
        from += PAGE
      }
      return all
    },
  })

  const { data: blsExist } = useQuery({
    queryKey: ['baplie-bls-exist', voyageId],
    enabled: !!voyageId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bls')
        .select('id')
        .eq('voyage_id', Number(voyageId))
        .limit(1)
      if (error) throw error
      return (data ?? []).length > 0
    },
  })

  const { data: existingVaziosManifest } = useQuery({
    queryKey: ['baplie-vazios-manifest', voyageId],
    enabled: !!voyageId,
    queryFn: () => getBaplieManifestForVoyage(Number(voyageId)),
  })

  const { data: reconciliationData } = useQuery({
    queryKey: ['baplie-reconciliation', voyageId],
    enabled: !!voyageId && !!blsExist && (stagingData?.length ?? 0) > 0,
    queryFn: () => reconcileBaplieWithManifest(Number(voyageId)),
  })

  const containers = stagingData ?? []
  const fullContainers = containers.filter((c) => c.status === 'full')
  const emptyContainers = containers.filter((c) => c.status === 'empty')
  const imoCount = fullContainers.filter((c) => c.is_imo).length
  const oogCount = fullContainers.filter((c) => c.is_oog).length
  const divergenceCount = reconciliationData?.items.length ?? 0

  const hasStaging = containers.length > 0
  const hasManifest = !!blsExist
  const stateC = hasStaging && hasManifest
  const stateB = hasStaging && !hasManifest

  function handleVoyageChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('voyage', value)
    else next.delete('voyage')
    setSearchParams(next)
  }

  async function handleConfirmarVazios() {
    if (!user || !voyageId) return
    if (existingVaziosManifest) return
    try {
      await importVaziosFromBaplie({ voyageId: Number(voyageId), uploadedBy: user.id })
      await queryClient.invalidateQueries({ queryKey: ['baplie-vazios-manifest', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao'] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] })
      showToast(`${emptyContainers.length} container(s) vazio(s) cadastrados em Vazios Importacao.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao cadastrar vazios.', 'error')
    }
  }

  async function handleSubstituirVazios() {
    if (!user || !voyageId || !existingVaziosManifest) return
    try {
      await deleteBaplieManifestForVoyage(Number(voyageId))
      await importVaziosFromBaplie({ voyageId: Number(voyageId), uploadedBy: user.id })
      await queryClient.invalidateQueries({ queryKey: ['baplie-vazios-manifest', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao'] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] })
      showToast(`Manifesto de vazios substituido. ${emptyContainers.length} container(s) recadastrado(s).`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao substituir vazios.', 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Baplie EDI"
        description="Gestao centralizada do arquivo Baplie EDI por viagem."
      />

      <Card className="mb-5">
        <Field label="Viagem">
          <VoyageSelect value={voyageId} onChange={handleVoyageChange} />
        </Field>
      </Card>

      {!voyageId ? (
        <Card>
          <div className="py-6 text-center text-sm text-slate-400">Selecione uma viagem para continuar.</div>
        </Card>
      ) : stagingLoading ? (
        <Card>
          <div className="py-6 text-center text-sm text-slate-400">Carregando...</div>
        </Card>
      ) : !hasStaging ? (
        <StateA onUpload={() => setUploadOpen(true)} />
      ) : (
        <>
          <StatsSection
            total={containers.length}
            full={fullContainers.length}
            empty={emptyContainers.length}
            imo={imoCount}
            oog={oogCount}
            divergences={stateC ? divergenceCount : null}
          />

          {stateB ? (
            <VaziosSection
              emptyCount={emptyContainers.length}
              existingManifest={existingVaziosManifest ?? null}
              onConfirmar={handleConfirmarVazios}
              onSubstituir={handleSubstituirVazios}
            />
          ) : null}

          {stateC && reconciliationData ? (
            <ReconciliacaoSection
              items={reconciliationData.items}
              actorId={user?.id ?? null}
              onApplied={() => queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] })}
            />
          ) : stateC && !reconciliationData ? (
            <Card className="mb-5">
              <div className="py-4 text-center text-sm text-slate-400">Carregando divergencias...</div>
            </Card>
          ) : null}

          <ContainerList containers={containers} />

          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setUploadOpen(true)}>
              <Upload size={16} />
              Reimportar Baplie EDI
            </Button>
          </div>
        </>
      )}

      <BaplieUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ['baplie-staging', voyageId] })
          queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] })
        }}
        initialVoyageId={voyageId}
      />
    </>
  )
}

function StateA({ onUpload }: { onUpload: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 py-10">
        <div className="text-sm text-slate-400">Nenhum arquivo Baplie EDI importado para esta viagem.</div>
        <Button onClick={onUpload}>
          <Upload size={16} />
          Importar Baplie EDI
        </Button>
      </div>
    </Card>
  )
}

function StatsSection({
  total, full, empty, imo, oog, divergences,
}: {
  total: number; full: number; empty: number; imo: number; oog: number; divergences: number | null
}) {
  return (
    <div className="mb-5 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Total" value={total} />
      <StatCard label="Cheios" value={full} />
      <StatCard label="Vazios" value={empty} />
      <StatCard label="IMO" value={imo} />
      <StatCard label="OOG" value={oog} />
      {divergences !== null ? (
        <StatCard label="Divergencias" value={divergences} tone={divergences > 0 ? 'amber' : 'green'} />
      ) : null}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'green' }) {
  const valueClass = tone === 'amber' ? 'text-amber-400' : tone === 'green' ? 'text-emerald-400' : 'text-white'
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</div>
    </div>
  )
}

function VaziosSection({
  emptyCount,
  existingManifest,
  onConfirmar,
  onSubstituir,
}: {
  emptyCount: number
  existingManifest: { id: string; total_containers: number; imported_at: string } | null
  onConfirmar: () => Promise<void>
  onSubstituir: () => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()

  async function run(fn: () => Promise<void>) {
    setLoading(true)
    try { await fn() } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro.', 'error')
    } finally { setLoading(false) }
  }

  return (
    <Card className="mb-5">
      <div className="text-sm font-semibold text-white mb-3">Vazios de Importacao</div>
      {existingManifest ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="text-sm text-amber-300 mb-3">
            Ja existe um manifesto de vazios criado via Baplie em{' '}
            <span className="font-semibold">{formatDate(existingManifest.imported_at)}</span> com{' '}
            {existingManifest.total_containers} container(s). Deseja substituir ou manter?
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" loading={loading} onClick={() => run(onSubstituir)}>
              Substituir
            </Button>
            <Button variant="ghost">Manter existente</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-400">{emptyCount} container(s) vazio(s) aguardando cadastro em Vazios Importacao.</div>
          <Button loading={loading} onClick={() => run(onConfirmar)}>
            Confirmar cadastro de {emptyCount} vazio(s)
          </Button>
        </div>
      )}
    </Card>
  )
}

function ReconciliacaoSection({
  items,
  actorId,
  onApplied,
}: {
  items: BaplieReconciliationItem[]
  actorId: string | null
  onApplied: () => void
}) {
  const { showToast } = useToast()
  const [applying, setApplying] = useState<string | null>(null)

  const missing = items.filter(
    (item): item is Extract<BaplieReconciliationItem, { kind: 'missing_in_manifest' }> =>
      item.kind === 'missing_in_manifest',
  )
  const divergent = items.filter(
    (item): item is Extract<BaplieReconciliationItem, { kind: 'attribute_divergence' }> =>
      item.kind === 'attribute_divergence',
  )

  async function handleAccept(blContainerId: number, field: AttributeDivergence['field'], value: string | boolean | null) {
    const key = `${blContainerId}-${field}`
    setApplying(key)
    try {
      await applyBaplieAttribute(blContainerId, field, value, actorId)
      showToast(`Campo "${fieldLabel(field)}" atualizado com valor do Baplie.`, 'success')
      onApplied()
    } catch {
      showToast('Falha ao aplicar valor do Baplie.', 'error')
    } finally {
      setApplying(null)
    }
  }

  if (!items.length) {
    return (
      <Card className="mb-5">
        <div className="py-4 text-center text-sm text-emerald-400">Nenhuma divergencia entre Baplie e manifesto.</div>
      </Card>
    )
  }

  return (
    <Card className="mb-5 overflow-hidden p-0">
      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="text-sm font-semibold text-white">
          Divergencias Baplie x Manifesto
          <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-normal text-amber-400">
            {items.length}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">Revise e aceite os valores do Baplie para atualizar o manifesto.</div>
      </div>

      {missing.length > 0 ? (
        <div className="border-b border-[#30363d] p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
            Containers no Baplie sem B/L no manifesto ({missing.length})
          </div>
          <div className="overflow-auto rounded-xl border border-[#30363d]">
            <table className="app-table app-table--compact min-w-[400px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Container</th>
                  <th className="px-3 py-2">B/L ref. (Baplie)</th>
                  <th className="px-3 py-2">Slot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {missing.map((item) => (
                  <tr key={item.container_number}>
                    <td className="px-3 py-2 font-semibold text-white">{item.container_number}</td>
                    <td className="px-3 py-2">{item.baplie_bl_ref ?? '-'}</td>
                    <td className="px-3 py-2">{item.slot ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-500">Acao necessaria: acionar armador para verificar manifesto.</p>
        </div>
      ) : null}

      {divergent.length > 0 ? (
        <div className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
            Divergencias de atributos ({divergent.length})
          </div>
          <div className="overflow-auto rounded-xl border border-[#30363d]">
            <table className="app-table app-table--compact min-w-[560px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Container</th>
                  <th className="px-3 py-2">B/L</th>
                  <th className="px-3 py-2">Campo</th>
                  <th className="px-3 py-2">Baplie</th>
                  <th className="px-3 py-2">Manifesto</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {divergent.flatMap((item) =>
                  item.divergences.map((div) => {
                    const key = `${item.bl_container_id}-${div.field}`
                    return (
                      <tr key={key}>
                        <td className="px-3 py-2 font-semibold text-white">{item.container_number}</td>
                        <td className="px-3 py-2">{item.bl_number ?? '-'}</td>
                        <td className="px-3 py-2">{fieldLabel(div.field)}</td>
                        <td className="px-3 py-2 text-amber-300">{formatDivergenceValue(div.baplie_value)}</td>
                        <td className="px-3 py-2">{formatDivergenceValue(div.manifest_value)}</td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            loading={applying === key}
                            onClick={() => handleAccept(item.bl_container_id, div.field, div.baplie_value)}
                          >
                            Aceitar Baplie
                          </Button>
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function ContainerList({ containers }: { containers: BaplieContainer[] }) {
  const [page, setPage] = useState(1)
  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(containers.length / pageSize))
  const paginated = containers.slice((page - 1) * pageSize, page * pageSize)

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="text-sm font-semibold text-white">Containers em staging</div>
        <div className="text-xs text-slate-500 mt-0.5">{containers.length} container(s) importado(s) do arquivo EDI</div>
      </div>
      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[760px] text-left text-sm whitespace-nowrap">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Container</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">POL</th>
              <th className="px-4 py-3">POD</th>
              <th className="px-4 py-3">Slot</th>
              <th className="px-4 py-3">B/L ref.</th>
              <th className="px-4 py-3">Perfil</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363d]">
            {paginated.map((c) => (
              <tr key={c.id} className="hover:bg-[#21262d]/60">
                <td className="px-4 py-3 font-semibold text-white">{c.container_number}</td>
                <td className="px-4 py-3">
                  <Badge tone={c.status === 'empty' ? 'slate' : 'blue'}>
                    {c.status === 'empty' ? 'Vazio' : 'Cheio'}
                  </Badge>
                </td>
                <td className="px-4 py-3">{c.size_type ?? '-'}</td>
                <td className="px-4 py-3">{c.pol ?? '-'}</td>
                <td className="px-4 py-3">{c.pod ?? '-'}</td>
                <td className="px-4 py-3">{c.slot ?? '-'}</td>
                <td className="px-4 py-3">{c.bl_ref ?? '-'}</td>
                <td className="px-4 py-3">
                  {c.is_imo ? (
                    <Badge tone="red">IMO</Badge>
                  ) : c.is_oog ? (
                    <Badge tone="yellow">OOG</Badge>
                  ) : (
                    <Badge tone="blue">Padrao</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="app-table__footer">
          <span>Pagina {page} de {totalPages} · {containers.length} containers</span>
          <div className="app-table__footer-controls">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Proxima</Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function BaplieUploadModal({
  open,
  onClose,
  onImported,
  initialVoyageId,
}: {
  open: boolean
  onClose: () => void
  onImported: () => void
  initialVoyageId: string
}) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: voyages } = useVoyageOptions()
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const [parsed, setParsed] = useState<Awaited<ReturnType<typeof parseBaplieFile>> | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [excludedPods, setExcludedPods] = useState<Set<string>>(new Set())

  function handleClose() {
    setParsed(null)
    setExcludedPods(new Set())
    onClose()
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setParsed(null)
    setExcludedPods(new Set())
    if (!f) return
    setParsing(true)
    try {
      const result = await parseBaplieFile(f)
      setParsed(result)
    } catch {
      showToast('Não foi possível ler o arquivo. Verifique o formato EDI.', 'error')
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

  const filteredContainers = (parsed?.containers ?? []).filter((c) => !c.pod || !excludedPods.has(c.pod))

  async function handleImport() {
    if (!parsed || !voyageId || !user) return
    setSubmitting(true)
    try {
      const { staged } = await importBaplieStaging(Number(voyageId), filteredContainers, user.id)
      showToast(`Baplie importado: ${staged} container(s) em staging.`, 'success')
      onImported()
      handleClose()
    } catch {
      showToast('Falha ao importar Baplie EDI.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const pods = parsed?.pods ?? []

  return (
    <Modal open={open} onClose={handleClose} title="Importar Baplie EDI">
      <div className="grid gap-5">
        <Field label="Viagem de destino">
          <Select value={voyageId} onChange={(e) => setVoyageId(e.target.value)}>
            <option value="">Selecione uma viagem</option>
            {voyages?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vessel?.name ?? 'Navio'} / {v.voyage_number}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Arquivo .edi ou .txt">
          <Input accept=".edi,.txt,.edi2" type="file" onChange={handleFile} />
        </Field>

        {parsing ? <div className="text-sm text-slate-400">Processando arquivo EDI...</div> : null}

        {parsed ? (
          <div className="grid gap-3">
            {parsed.vessel_name || parsed.voyage_number ? (
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-wider text-slate-500">Detectado no arquivo</div>
                <div className="mt-1 font-semibold text-white">
                  {parsed.vessel_name ?? '-'} / {parsed.voyage_number ?? '-'}
                </div>
              </div>
            ) : null}

            {pods.length > 0 ? (
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">
                  Portos de descarga — desmarque os que deseja ignorar
                </div>
                <div className="flex flex-wrap gap-3">
                  {pods.map((pod) => (
                    <label key={pod} className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
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

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="text-xs uppercase text-slate-500">Containers</div>
                <div className="mt-1 text-2xl font-bold text-white">{filteredContainers.length}</div>
                {excludedPods.size > 0 ? (
                  <div className="mt-1 text-xs text-slate-500">de {parsed.containers.length} no arquivo</div>
                ) : null}
              </div>
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="text-xs uppercase text-slate-500">IMO</div>
                <div className="mt-1 text-2xl font-bold text-white">{filteredContainers.filter((c) => c.is_imo).length}</div>
              </div>
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="text-xs uppercase text-slate-500">OOG</div>
                <div className="mt-1 text-2xl font-bold text-white">{filteredContainers.filter((c) => c.is_oog).length}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
          <Button
            disabled={!parsed || !voyageId || filteredContainers.length === 0}
            loading={submitting}
            onClick={handleImport}
          >
            Confirmar importação
            {excludedPods.size > 0 ? ` (${filteredContainers.length} containers)` : ''}
          </Button>
        </div>
        {!voyageId ? (
          <div className="text-sm text-amber-200">Selecione uma viagem de destino para habilitar a confirmação.</div>
        ) : null}
      </div>
    </Modal>
  )
}

function VoyageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useVoyageOptions()
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecione uma viagem</option>
      {data?.map((v) => (
        <option key={v.id} value={v.id}>
          {v.vessel?.name ?? 'Navio'} / {v.voyage_number}
        </option>
      ))}
    </Select>
  )
}

function fieldLabel(field: AttributeDivergence['field']): string {
  switch (field) {
    case 'is_imo': return 'IMO'
    case 'is_oog': return 'OOG'
    case 'imo_class': return 'Classe IMO'
    case 'un_number': return 'No. ONU'
    case 'status': return 'Status'
  }
}

function formatDivergenceValue(v: string | boolean | null): string {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'boolean') return v ? 'Sim' : 'Nao'
  return String(v)
}
