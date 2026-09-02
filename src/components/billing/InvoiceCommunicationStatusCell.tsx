import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { formatCommunicationDateTime } from '../../services/customerCommunicationTemplates'
import {
  dispatchCeMercanteTaxasCommunication,
  type CustomerVoyageCommunicationStatus,
} from '../../services/customerFinanceCommunications'
import { getInvoiceCommunicationContext, getInvoiceCommunicationContexts, type InvoiceListRow } from '../../services/billing'
import { queryKeys } from '../../services/queryKeys'
import { useCustomerVoyageCommunicationStatuses } from '../../hooks/useCustomerCommunicationReadiness'

type Props = { invoice: InvoiceListRow }

function statusText(status: CustomerVoyageCommunicationStatus['latest']): string {
  if (!status) return 'Aguardando envio automático'
  const when = formatCommunicationDateTime(status.createdAt)
  const action = status.attemptDiscriminator === 0 ? 'Enviado automaticamente' : 'Reenviado manualmente'
  if (status.status === 'enviado') return `${action} em ${when}`
  if (status.status === 'simulado') return `${action} em simulação em ${when}`
  if (status.status === 'falha') return `Falha no ${status.attemptDiscriminator === 0 ? 'envio automático' : 'reenvio manual'} em ${when}`
  return `Status do comunicado: ${status.status}`
}

export function InvoiceCommunicationStatusCell({ invoice }: Props) {
  const contexts = getInvoiceCommunicationContexts(invoice)
  const context = getInvoiceCommunicationContext(invoice)
  const statusQueries = useCustomerVoyageCommunicationStatuses(contexts)
  const queryClient = useQueryClient()
  const [retryError, setRetryError] = useState<string | null>(null)
  const retryMutation = useMutation({
    mutationFn: (retryContext: { voyageId: number; customerId: number }) => dispatchCeMercanteTaxasCommunication(retryContext.voyageId, retryContext.customerId, { forceRetry: true }),
    onSuccess: async (_, retryContext) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.status(retryContext.voyageId, retryContext.customerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.statusRoot() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.all() }),
      ])
      setRetryError(null)
    },
    onError: (error) => setRetryError(error instanceof Error ? error.message : 'Falha ao reenviar o comunicado.'),
  })

  if (!contexts.length || context.voyageId == null) return <span className="text-slate-500">Sem viagem vinculada</span>

  return (
    <div className="app-table__cell-stack min-w-[220px]" data-testid="customer-finance-communication-status">
      {contexts.map((voyageContext, index) => {
        const statusQuery = statusQueries[index]
        const status = statusQuery?.data
        const canRetry = Boolean(status?.readiness.ready)
        return (
          <div key={voyageContext.voyageId} className="border-b border-[var(--app-border)] pb-2 last:border-b-0 last:pb-0">
            <div className="text-xs font-semibold text-slate-400">{voyageContext.vesselName ?? 'Viagem'}{voyageContext.voyageNumber ? ` / ${voyageContext.voyageNumber}` : ''}</div>
            {statusQuery?.isLoading ? <span className="text-slate-400">Verificando comunicado...</span> : null}
            {statusQuery?.error || !status ? <span className="text-amber-300">Status indisponível</span> : null}
            {status ? (
              <>
                {status.blockedReason ? <span className="text-amber-300">Prontidão bloqueada: {status.blockedReason}</span> : <span className={status.latest?.status === 'enviado' ? 'text-green-400' : 'text-amber-300'}>{statusText(status.latest)}</span>}
                {status.latest ? <Link className="block text-xs text-blue-400 hover:underline" to={`/clientes/comunicacao?tab=historico&customer=${voyageContext.customerId}&communication=${status.latest.id}`}>Ver comunicado</Link> : null}
                {canRetry ? <Button type="button" variant="ghost" loading={retryMutation.isPending} onClick={() => {
                  if (window.confirm('Confirma o reenvio assistido do comunicado de CE Mercante para este cliente?')) void retryMutation.mutateAsync({ voyageId: voyageContext.voyageId!, customerId: voyageContext.customerId! })
                }}>Reenviar comunicado</Button> : null}
              </>
            ) : null}
          </div>
        )
      })}
      {retryError ? <span className="text-xs text-red-300">{retryError}</span> : null}
    </div>
  )
}
