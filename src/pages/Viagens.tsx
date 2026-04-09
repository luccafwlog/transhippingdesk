import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { VoyageCreateModal } from '../components/shared/VoyageCreateModal'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { countDistinctContainersAcrossGroups } from '../lib/containerCounts'
import { formatDate } from '../lib/utils'
import { deleteVoyage } from '../services/voyages'

export function Viagens() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { isAdmin } = useAuth()
  const { data, isLoading, error } = useVoyages()
  const [open, setOpen] = useState(false)
  const [editingVoyageId, setEditingVoyageId] = useState<number | null>(null)
  const [deletingVoyageId, setDeletingVoyageId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const summary = useMemo(
    () => ({
      active: data?.filter((voyage) => voyage.status === 'active').length ?? 0,
      totalBls: data?.reduce((sum, voyage) => sum + (voyage.bls?.length ?? 0), 0) ?? 0,
      totalContainers: countDistinctContainersAcrossGroups(
        data ?? [],
        (voyage) => voyage.bls?.flatMap((bl) => bl.bl_containers ?? []) ?? [],
      ),
    }),
    [data],
  )
  const deletingVoyage = data?.find((voyage) => voyage.id === deletingVoyageId)

  async function handleDeleteVoyage() {
    if (!deletingVoyageId) return

    setDeleting(true)
    try {
      await deleteVoyage(deletingVoyageId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
        queryClient.invalidateQueries({ queryKey: ['voyage-options'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['containers'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ])

      showToast('Viagem excluida com sucesso.', 'success')
      setDeletingVoyageId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao excluir viagem.'
      showToast(message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Viagens"
        description="Cadastro de navio/viagem. Cada manifesto importado define seu proprio trecho POL/POD dentro da viagem."
        action={
          isAdmin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Nova Viagem
            </Button>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Viagens ativas" value={summary.active} />
        <MetricCard label="B/Ls vinculados" value={summary.totalBls} />
        <MetricCard label="Containers distintos vinculados" value={summary.totalContainers} />
      </div>

      {error ? <Card className="mb-5 text-red-200">Erro ao carregar viagens.</Card> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {isLoading ? <Card>Carregando viagens...</Card> : null}
        {data?.map((voyage) => {
          const totalBls = voyage.bls?.length ?? 0
          const totalContainers = countDistinctContainersAcrossGroups(voyage.bls, (bl) => bl.bl_containers)
          const originPorts = collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null)
          const destinationPorts = collectVoyagePorts(voyage.bls, 'pod', voyage.pod?.name ?? null)
          const routeRows = collectVoyageRoutes(voyage.bls)

          return (
            <Card key={voyage.id} className="grid gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    {voyage.vessel?.carrier?.name ?? 'Armador nao informado'}
                  </div>
                  <h2 className="text-xl font-bold text-white">
                    {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                  </h2>
                </div>
                <span className="rounded-full border border-[#1f6feb]/30 bg-[#1f6feb]/10 px-3 py-1 text-xs font-semibold text-[#8cc8ff]">
                  {voyage.status ?? 'active'}
                </span>
              </div>

              <dl className="grid gap-2 text-sm text-slate-300">
                <Info label="Portos de Origem" value={originPorts.join(' | ') || 'Definidos por manifesto'} />
                <Info label="Portos de Destino" value={destinationPorts.join(' | ') || 'Definidos por manifesto'} />
                <Info label="ETD do manifesto" value={formatDate(voyage.etd)} />
                <Info label="ETA informado" value={formatDate(voyage.eta)} />
                <Info label="ATA" value={formatDate(voyage.ata)} />
                <Info label="B/Ls" value={String(totalBls)} />
                <Info label="Containers distintos" value={String(totalContainers)} />
              </dl>

              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">Trechos consolidados</div>
                    <div className="text-sm text-slate-400">
                      O ETD vem do manifesto importado. O ETA e mantido pelo usuario na viagem.
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2">POL</th>
                        <th className="px-3 py-2">POD</th>
                        <th className="px-3 py-2">ETD manifesto</th>
                        <th className="px-3 py-2">ETA informado</th>
                        <th className="px-3 py-2">B/Ls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {routeRows.length ? (
                        routeRows.map((route) => (
                          <tr key={`${voyage.id}-${route.pol}-${route.pod}`}>
                            <td className="px-3 py-2">{route.pol}</td>
                            <td className="px-3 py-2">{route.pod}</td>
                            <td className="px-3 py-2">{formatDate(voyage.etd)}</td>
                            <td className="px-3 py-2">{formatDate(voyage.eta)}</td>
                            <td className="px-3 py-2">{route.blCount}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="px-3 py-3 text-slate-400">
                            Nenhum trecho identificado nos manifestos desta viagem.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => navigate(`/manifestos?voyage=${voyage.id}`)}>
                    Ver manifestos desta viagem
                  </Button>
                  {isAdmin ? (
                    <>
                      <Button variant="secondary" onClick={() => setEditingVoyageId(voyage.id)}>
                        <Pencil size={16} />
                        Editar viagem
                      </Button>
                      <Button variant="danger" onClick={() => setDeletingVoyageId(voyage.id)}>
                        <Trash2 size={16} />
                        Excluir viagem
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <VoyageCreateModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(voyageId) => navigate(`/manifestos?voyage=${voyageId}`)}
      />

      <VoyageCreateModal
        open={editingVoyageId !== null}
        onClose={() => setEditingVoyageId(null)}
        voyageId={editingVoyageId ?? undefined}
        title="Editar Viagem"
        initialValues={makeVoyageInitialValues(data?.find((voyage) => voyage.id === editingVoyageId))}
        onSaved={() => setEditingVoyageId(null)}
      />

      <Modal open={deletingVoyageId !== null} onClose={() => setDeletingVoyageId(null)} title="Excluir Viagem">
        <div className="grid gap-4">
          <div className="rounded-xl border border-red-400/30 bg-red-950/30 p-3 text-sm text-red-100">
            Esta exclusao e permanente. Ela so sera permitida se a viagem nao tiver importacoes nem B/Ls vinculados.
          </div>

          <div className="text-sm text-slate-300">
            {deletingVoyage ? (
              <>
                Confirme a exclusao de <span className="font-semibold text-white">{deletingVoyage.vessel?.name ?? 'Navio'} / {deletingVoyage.voyage_number}</span>.
              </>
            ) : (
              'Confirme a exclusao da viagem selecionada.'
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeletingVoyageId(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDeleteVoyage}>
              Excluir viagem
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </Card>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#30363d] pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-white">{value}</span>
    </div>
  )
}

function collectVoyagePorts(
  bls: Array<{ pol: string | null; pod: string | null }> | null | undefined,
  field: 'pol' | 'pod',
  fallback: string | null,
) {
  const ports = Array.from(
    new Set(
      (bls ?? [])
        .map((bl) => bl[field]?.trim() ?? '')
        .filter(Boolean),
    ),
  )

  if (!ports.length && fallback) {
    return [fallback]
  }

  return ports
}

function collectVoyageRoutes(bls: Array<{ pol: string | null; pod: string | null }> | null | undefined) {
  const routes = new Map<string, { pol: string; pod: string; blCount: number }>()

  for (const bl of bls ?? []) {
    const pol = bl.pol?.trim() || '-'
    const pod = bl.pod?.trim() || '-'
    const key = `${pol}::${pod}`
    const current = routes.get(key)

    routes.set(
      key,
      current
        ? { ...current, blCount: current.blCount + 1 }
        : {
            pol,
            pod,
            blCount: 1,
          },
    )
  }

  return Array.from(routes.values())
}

function makeVoyageInitialValues(
  voyage:
    | {
        voyage_number: string
        etd: string | null
        eta: string | null
        status: string | null
        vessel?: {
          name: string
          imo: string | null
          carrier?: { name: string; scac: string | null } | null
        } | null
      }
    | undefined,
) {
  if (!voyage) return undefined

  return {
    carrierName: voyage.vessel?.carrier?.name ?? '',
    carrierScac: voyage.vessel?.carrier?.scac ?? '',
    vesselName: voyage.vessel?.name ?? '',
    vesselImo: voyage.vessel?.imo ?? '',
    voyageNumber: voyage.voyage_number,
    etd: voyage.etd ? toLocalDatetimeInput(voyage.etd) : '',
    eta: voyage.eta ? toLocalDatetimeInput(voyage.eta) : '',
    status: normalizeVoyageStatus(voyage.status),
  }
}

function normalizeVoyageStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status
  return 'active'
}

function toLocalDatetimeInput(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60_000)
  return localDate.toISOString().slice(0, 16)
}
