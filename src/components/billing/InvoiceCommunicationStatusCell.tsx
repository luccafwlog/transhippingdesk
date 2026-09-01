import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { formatCommunicationDateTime } from '../../services/customerCommunicationTemplates'
import {
  dispatchCeMercanteTaxasCommunication,
  type CustomerVoyageCommunicationStatus,
} from '../../services/customerFinanceCommunications'
import { getInvoiceCommunicationContext, type InvoiceListRow } from '../../services/billing'
import { queryKeys } from '../../services/queryKeys'
import { useCustomerVoyageCommunicationStatus } from '../../hooks/useCustomerCommunicationReadiness'

type Props = { invoice: InvoiceListRow }

function statusText(status: CustomerVoyageCommunicationStatus['latest']): string {
  if (!status) return 'Aguardando envio automático'
  const when = formatCommunicationDateTime(status.createdAt)
  if (status.status === 'enviado') return `Enviado automaticamente em ${when}`
  if (status.status === 'simulado') return `Registrado em simulação em ${when}`
  if (status.status === 'falha') return `Falha no envio em ${when}`
  return `Status do comunicado: ${status.status}`
}

export function InvoiceCommunicationStatusCell({ invoice }: Props) {
  const context = getInvoiceCommunicationContext(invoice)
  const statusQuery = useCustomerVoyageCommunicationStatus(context.voyageId, context.customerId)
  const queryClient = useQueryClient()
  const [retryError, setRetryError] = useState<string | null>(null)
  const retryMutation = useMutation({
    mutationFn: () => dispatchCeMercanteTaxasCommunication(context.voyageId!, context.customerId, { forceRetry: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.status(context.voyageId, context.customerId) })
      setRetryError(null)
    },
    onError: (error) => setRetryError(error instanceof Error ? error.message : 'Falha ao reenviar o comunicado.'),
  })

  if (context.voyageId == null) return <span className="text-slate-500">Sem viagem vinculada</span>
  if (statusQuery.isLoading) return <span className="text-slate-400">Verificando comunicado...</span>
  if (statusQuery.error || !statusQuery.data) return <span className="text-amber-300">Status indisponível</span>

  const status = statusQuery.data
  const canRetry = status.latest != null
  function handleRetry() {
    if (!window.confirm('Confirma o reenvio assistido do comunicado de CE Mercante para este cliente?')) return
    void retryMutation.mutateAsync()
  }

  return (
    <div className="app-table__cell-stack min-w-[220px]" data-testid="customer-finance-communication-status">
      {status.blockedReason ? (
        <span className="text-amber-300">Prontidão bloqueada: {status.blockedReason}</span>
      ) : (
        <span className={status.latest?.status === 'enviado' ? 'text-green-400' : 'text-amber-300'}>{statusText(status.latest)}</span>
      )}
      {status.latest ? (
        <Link className="text-xs text-blue-400 hover:underline" to={`/clientes/comunicacao?tab=historico&customer=${context.customerId}`}>
          Ver comunicado
        </Link>
      ) : null}
      {canRetry ? (
        <Button type="button" variant="ghost" loading={retryMutation.isPending} onClick={handleRetry}>
          Reenviar comunicado
        </Button>
      ) : null}
      {retryError ? <span className="text-xs text-red-300">{retryError}</span> : null}
    </div>
  )
}
