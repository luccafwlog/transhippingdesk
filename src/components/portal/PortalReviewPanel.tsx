import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { Field, Input, Textarea } from '../ui/Input'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../services/supabase'
import type { QueueRow } from '../../services/portalProvisioning'
import { usePortalEvents } from '../../hooks/usePortalProvisioning'

type Props = {
  row: QueueRow
  onSaved?: () => void
  onClose?: () => void
}

export function PortalReviewPanel({ row, onSaved, onClose }: Props) {
  const { can, isAdmin } = useAuth()
  const canProvision = can ? can('portal_provisioning') : isAdmin
  const confirm = useConfirm()
  const { showToast } = useToast()
  const [email, setEmail] = useState(row.recovery_email ?? '')
  const [newCnpj, setNewCnpj] = useState(row.cnpj_cpf)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { data: events = [] } = usePortalEvents(row.customer_id)

  async function invoke(name: string, body: Record<string, unknown>) {
    setBusy(true); setError('')
    try {
      const { error: invokeError } = await supabase.functions.invoke(name, { body })
      if (invokeError) throw invokeError
      showToast('Ação do Portal concluída.', 'success')
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.')
    } finally { setBusy(false) }
  }

  async function sendInvite() {
    if (!email.trim()) return
    const authorized = await confirm({
      title: 'Autorizar email de recuperação',
      message: 'Você confirma que este email pertence à pessoa autorizada pelo Cliente?',
      confirmLabel: 'Enviar convite',
    })
    if (!authorized) return
    await invoke('portal-invite-send', { customer_id: row.customer_id, recovery_email: email.trim(), recovery_email_source: row.candidates.some((candidate) => candidate.email === email.trim()) ? 'candidato' : 'informado_manualmente' })
  }

  async function cancelInvite() {
    if (!reason.trim()) { setError('Informe a justificativa.'); return }
    const { error: rpcError } = await supabase.rpc('portal_cancel_invite', { p_customer_id: row.customer_id, p_reason: reason.trim() })
    if (rpcError) { setError(rpcError.message); return }
    showToast('Convite cancelado.', 'success'); onSaved?.()
  }

  async function changeAccount(action: 'suspend' | 'reactivate') {
    if (!reason.trim()) { setError('Informe a justificativa.'); return }
    await invoke('portal-account-suspend', { customer_id: row.customer_id, action, reason: reason.trim() })
  }

  async function changeDecision(action: 'exception' | 'analysis') {
    if (!reason.trim()) { setError('Informe a justificativa.'); return }
    const { error: rpcError } = action === 'exception'
      ? await supabase.rpc('portal_set_exception', { p_customer_id: row.customer_id, p_reason: reason.trim() })
      : await supabase.rpc('portal_return_to_analysis', { p_customer_id: row.customer_id, p_reason: reason.trim() })
    if (rpcError) { setError(rpcError.message); return }
    showToast('Decisão do Portal atualizada.', 'success'); onSaved?.()
  }

  async function assistedEmailChange() {
    if (!email.trim() || !reason.trim()) { setError('Informe email e justificativa.'); return }
    const { error: rpcError } = await supabase.rpc('portal_assisted_email_change', { p_customer_id: row.customer_id, p_new_email: email.trim(), p_reason: reason.trim() })
    if (rpcError) { setError(rpcError.message); return }
    showToast('Email alterado por atendimento.', 'success'); onSaved?.()
  }

  async function adminCnpjChange() {
    if (!newCnpj.trim() || !reason.trim()) { setError('Informe CNPJ e justificativa.'); return }
    const { error: rpcError } = await supabase.rpc('portal_admin_change_cnpj', { p_customer_id: row.customer_id, p_new_cnpj: newCnpj.trim(), p_reason: reason.trim() })
    if (rpcError) { setError(rpcError.message); return }
    showToast('CNPJ alterado de forma auditada.', 'success'); onSaved?.()
  }

  return (
    <Card className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto rounded-none border-y-0 border-r-0 shadow-2xl" aria-label="Revisão do Portal">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--app-muted)]">Revisão do Portal</div>
          <h2 className="mt-1 text-xl font-semibold">{row.customer_name}</h2>
          <p className="font-mono text-sm text-[var(--app-muted)]">{row.cnpj_cpf}</p>
        </div>
        {onClose ? <Button variant="ghost" onClick={onClose}>Fechar</Button> : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div><div className="text-xs text-[var(--app-muted)]">Situação</div><div>{row.account_situation}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Decisão</div><div>{row.provisioning_decision}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Email atual</div><div>{row.recovery_email ?? 'Não informado'}</div></div>
        <div><div className="text-xs text-[var(--app-muted)]">Origem</div><div>{row.recovery_email_source ?? '—'}</div></div>
      </div>

      <section className="mt-6 grid gap-3">
        <h3 className="font-semibold">Candidatos de email</h3>
        {row.candidates.length ? row.candidates.map((candidate) => (
          <button key={`${candidate.email}-${candidate.purpose}`} type="button" className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-left hover:border-cyan-400" onClick={() => setEmail(candidate.email)}>
            <div className="font-medium">{candidate.email}</div>
            <div className="text-xs text-[var(--app-muted)]">{candidate.purpose} · {candidate.origin}</div>
          </button>
        )) : <p className="text-sm text-[var(--app-muted)]">Nenhum contato com email disponível.</p>}
      </section>

      {row.sharedEmailCnpjs.length ? <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-950/20 p-3 text-sm text-amber-100">Este email também aparece nos CNPJs: {row.sharedEmailCnpjs.join(', ')}. A análise manual continua obrigatória.</p> : null}
      <div className="mt-5 grid gap-3">
        <Field label="Email de Recuperação"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        {email && !row.candidates.some((candidate) => candidate.email === email) ? <p className="text-xs text-amber-200">Email informado manualmente; será usado apenas como Email de Recuperação.</p> : null}
        {error ? <InlineError message={error} /> : null}
        <Button onClick={sendInvite} disabled={!canProvision || !email.trim() || busy}>Enviar convite</Button>
        {row.account_situation === 'ativo' ? <Button variant="secondary" onClick={() => void assistedEmailChange()} disabled={!canProvision || !email.trim() || busy}>Trocar email assistido</Button> : null}
      </div>

      {isAdmin ? <div className="mt-5 grid gap-3 border-t border-[var(--app-border)] pt-5"><Field label="Novo CNPJ"><Input value={newCnpj} onChange={(event) => setNewCnpj(event.target.value)} /></Field><Button variant="secondary" onClick={() => void adminCnpjChange()} disabled={!newCnpj.trim() || newCnpj === row.cnpj_cpf || busy}>Alterar CNPJ auditado</Button></div> : null}

      {row.account_situation === 'convite_pendente' ? (
        <div className="mt-6 grid gap-3 border-t border-[var(--app-border)] pt-5">
          <Field label="Justificativa"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <Button variant="secondary" onClick={cancelInvite} disabled={!canProvision || busy}>Cancelar convite</Button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 border-t border-[var(--app-border)] pt-5">
        <Field label="Justificativa para ações administrativas"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <div className="flex flex-wrap gap-2">
          {row.account_situation === 'ativo' || row.account_situation === 'suspenso' ? <Button variant="secondary" onClick={() => void changeAccount(row.account_situation === 'ativo' ? 'suspend' : 'reactivate')} disabled={!canProvision || busy}>{row.account_situation === 'ativo' ? 'Suspender conta' : 'Reativar conta'}</Button> : null}
          {row.provisioning_decision === 'aguardando_analise' && row.account_situation === 'sem_conta' ? <Button variant="secondary" onClick={() => void changeDecision('exception')} disabled={!canProvision || busy}>Registrar exceção</Button> : null}
          {row.provisioning_decision !== 'aguardando_analise' ? <Button variant="secondary" onClick={() => void changeDecision('analysis')} disabled={!canProvision || busy}>Retornar à análise</Button> : null}
        </div>
      </div>

      <section className="mt-6 border-t border-[var(--app-border)] pt-5">
        <h3 className="font-semibold">Histórico</h3>
        {events.length ? <ol className="mt-3 grid gap-2 text-sm">{events.slice(0, 10).map((event) => <li key={event.id} className="rounded border border-[var(--app-border)] p-2"><div>{event.reason ?? 'Evento do Portal'}</div><div className="text-xs text-[var(--app-muted)]">{event.new_situation ?? '—'} · {event.created_at ? new Date(event.created_at).toLocaleString('pt-BR') : '—'}</div></li>)}</ol> : <p className="mt-2 text-sm text-[var(--app-muted)]">Nenhum evento registrado.</p>}
      </section>

      <Link className="mt-6 inline-block text-sm text-cyan-300 hover:text-cyan-200" to={`/clientes/${row.cnpj_cpf}`}>Abrir ficha completa →</Link>
    </Card>
  )
}
