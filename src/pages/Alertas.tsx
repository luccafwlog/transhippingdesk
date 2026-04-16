import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, CheckCheck } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import { acknowledgeAlert, closeAlert, listAlerts, type AlertStatusFilter } from '../services/alerts'

const STATUS_LABELS: Record<string, { label: string; tone: 'yellow' | 'blue' | 'slate' }> = {
  open: { label: 'Aberto', tone: 'yellow' },
  acknowledged: { label: 'Reconhecido', tone: 'blue' },
  closed: { label: 'Fechado', tone: 'slate' },
}

const FILTER_TABS: { value: AlertStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos os abertos' },
  { value: 'open', label: 'Novos' },
  { value: 'acknowledged', label: 'Reconhecidos' },
]

export function Alertas() {
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all')
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts', statusFilter],
    queryFn: () => listAlerts(statusFilter),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('Alerta reconhecido.', 'success')
    },
    onError: () => showToast('Erro ao reconhecer alerta.', 'error'),
  })

  const closeMutation = useMutation({
    mutationFn: closeAlert,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('Alerta fechado.', 'success')
    },
    onError: () => showToast('Erro ao fechar alerta.', 'error'),
  })

  const isMutating = acknowledgeMutation.isPending || closeMutation.isPending

  return (
    <>
      <PageHeader
        title="Alertas operacionais"
        description="Eventos criticos e pendencias registradas automaticamente pelo sistema."
      />

      <div className="mb-4 flex gap-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-[#30363d] text-white'
                : 'text-slate-400 hover:bg-[#21262d] hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar alertas." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[780px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Mensagem</th>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Carregando alertas...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <CheckCheck size={28} className="text-emerald-500" />
                      <span>Nenhum alerta aberto no momento.</span>
                    </div>
                  </td>
                </tr>
              ) : null}
              {data?.map((alert) => {
                const statusMeta = STATUS_LABELS[alert.status] ?? STATUS_LABELS.open
                return (
                  <tr key={alert.id} className="hover:bg-[#21262d]/60">
                    <td className="px-4 py-3">
                      <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                        <span className="font-mono text-xs text-slate-300">{alert.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-sm text-slate-200">{alert.message}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {alert.entity_type ? (
                        <span className="font-mono text-xs">
                          {alert.entity_type}
                          {alert.entity_id ? ` / ${alert.entity_id}` : ''}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {formatDate(alert.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {alert.status === 'open' ? (
                          <Button
                            variant="secondary"
                            disabled={isMutating}
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                          >
                            <Bell size={14} />
                            Reconhecer
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          disabled={isMutating}
                          onClick={() => closeMutation.mutate(alert.id)}
                        >
                          Fechar
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
