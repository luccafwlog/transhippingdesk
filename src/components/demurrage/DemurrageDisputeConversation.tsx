import { useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { Textarea } from '../ui/Input'
import { formatDate } from '../../lib/utils'
import { portalErrorMessage } from '../../lib/portalErrorMessage'
import { addDemurrageDisputeMessage, listDemurrageDisputes, reopenDemurrageDispute, type DemurrageDispute } from '../../services/demurrage/demurrageDisputes'

export function DemurrageDisputeConversation() {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['demurrage-disputes'],
    queryFn: () => listDemurrageDisputes(),
    staleTime: 30_000,
  })
  const messageMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => addDemurrageDisputeMessage(id, body, 'cliente'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['demurrage-disputes'] }),
  })
  const reopenMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => reopenDemurrageDispute(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['demurrage-disputes'] }),
  })

  async function submit(dispute: DemurrageDispute) {
    const body = (drafts[dispute.id] ?? '').trim()
    if (!body) {
      setErrors((current) => ({ ...current, [dispute.id]: 'Escreva uma mensagem antes de enviar.' }))
      return
    }
    setErrors((current) => ({ ...current, [dispute.id]: '' }))
    try {
      if (dispute.state === 'resolvida') await reopenMutation.mutateAsync({ id: dispute.id, body })
      else await messageMutation.mutateAsync({ id: dispute.id, body })
      setDrafts((current) => ({ ...current, [dispute.id]: '' }))
    } catch (cause) {
      setErrors((current) => ({ ...current, [dispute.id]: portalErrorMessage(cause, 'Falha ao atualizar a Dispute.') }))
    }
  }

  if (isLoading) return <Card className="mb-4"><p className="text-sm text-[var(--app-muted)]">Carregando Disputes...</p></Card>
  if (error) return <InlineError message="Não foi possível carregar as Disputes." />
  if (!data.length) return null

  return (
    <Card className="mb-4">
      <div className="mb-4 flex items-center gap-2"><MessageSquare size={18} /><div><h2 className="font-semibold text-[var(--app-text-strong)]">Fila de Disputes</h2><p className="text-xs text-[var(--app-muted)]">A conversa é o registro operacional e cada resposta define o próximo responsável.</p></div></div>
      <div className="grid gap-4">
        {data.map((dispute) => (
          <article key={dispute.id} className="rounded-xl border border-[var(--app-border)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold text-[var(--app-text-strong)]">{dispute.doc_number} · {dispute.customer_name}</div><div className="text-xs text-[var(--app-muted)]">Atualizada em {formatDate(dispute.updated_at)} · próximo: {dispute.next_responder}</div></div><Badge tone={dispute.state === 'aberta' ? 'yellow' : dispute.state === 'resolvida' ? 'green' : 'slate'}>{dispute.state}</Badge></div>
            <div className="grid gap-2">{dispute.messages.map((message) => <div key={message.id} className="rounded-lg bg-[var(--app-surface-muted)] px-3 py-2 text-sm"><div className="mb-1 flex justify-between gap-2 text-xs text-[var(--app-muted)]"><span>{message.author_type}</span><span>{formatDate(message.created_at)}</span></div><p className="whitespace-pre-wrap">{message.body}</p></div>)}</div>
            {dispute.state !== 'cancelada' ? <div className="mt-3 grid gap-2"><Textarea rows={2} value={drafts[dispute.id] ?? ''} onChange={(event) => setDrafts((current) => ({ ...current, [dispute.id]: event.target.value }))} placeholder={dispute.state === 'resolvida' ? 'Justifique a reabertura...' : 'Responder ao cliente...'} />{errors[dispute.id] ? <InlineError message={errors[dispute.id]} /> : null}<div className="flex justify-end"><Button loading={messageMutation.isPending || reopenMutation.isPending} onClick={() => void submit(dispute)}><Send size={14} />{dispute.state === 'resolvida' ? 'Reabrir Dispute' : 'Enviar resposta'}</Button></div></div> : null}
          </article>
        ))}
      </div>
    </Card>
  )
}
