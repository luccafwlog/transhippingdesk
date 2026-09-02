import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, History, Mail, Paperclip, Send } from 'lucide-react'
import { Badge, type BadgeTone } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useAppSettings, useSetCommunicationsEnabled } from '../hooks/useAppSettings'
import { useAuth } from '../hooks/useAuth'
import { useCustomerCommunicationConference, useCustomerCommunicationHistory, useCustomerCommunicationSavedTemplates, useDispatchCustomerCommunication, useSaveCustomerCommunicationSavedTemplate } from '../hooks/useCustomerCommunications'
import {
  DEFAULT_CUSTOMER_COMMUNICATION_FILTERS,
  CUSTOMER_COMMUNICATION_NATURES,
  getCustomerCommunicationNature,
  type CustomerCommunicationConferenceRow,
  type CustomerCommunicationConference,
  type CustomerCommunicationFilters,
} from '../services/customerCommunications'
import {
  assertValidCommunicationAttachments,
  renderCustomerCommunicationTemplate,
  type CommunicationAttachment,
  type CustomerCommunicationKind,
} from '../services/customerCommunicationTemplates'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../services/customerCommunications'
import type { CustomerCommunicationNature } from '../types/database'

type CommunicationTab = 'disparo' | 'historico'

const KIND_OPTIONS: Array<{ value: CustomerCommunicationKind; label: string }> = [
  { value: 'aviso_chegada_noa', label: 'NOA · Aviso de Chegada' },
  { value: 'aviso_prontidao_nor', label: 'NOR · Prontidão de Descarga' },
  { value: 'aviso_atracacao_nob', label: 'NOB · Atracação e Operação' },
  { value: 'institucional', label: 'Institucional' },
  { value: 'livre', label: 'Livre · escrito no momento' },
]

const NATURE_LABELS: Record<CustomerCommunicationNature, string> = {
  avisos_gerais: 'Avisos gerais',
  avisos_operacionais: 'Avisos operacionais',
  documentacao: 'Documentação',
  demurrage: 'Demurrage',
}

function statusTone(status: string): BadgeTone {
  if (status === 'enviado') return 'green'
  if (status === 'falha') return 'red'
  return 'yellow'
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    return btoa(binary)
  })
}

export function ClientesComunicacao() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [kind, setKind] = useState<CustomerCommunicationKind>('aviso_chegada_noa')
  const [nature, setNature] = useState<CustomerCommunicationNature>('avisos_operacionais')
  const [filters, setFilters] = useState<CustomerCommunicationFilters>(DEFAULT_CUSTOMER_COMMUNICATION_FILTERS)
  const [conferenceRequested, setConferenceRequested] = useState(false)
  const [selectionState, setSelectionState] = useState<{ scope: CustomerCommunicationConference | undefined; keys: Set<string> }>({ scope: undefined, keys: new Set() })
  const [institutionalSubject, setInstitutionalSubject] = useState('')
  const [institutionalBody, setInstitutionalBody] = useState('')
  const [resendConfirmationScope, setResendConfirmationScope] = useState<CustomerCommunicationConference | undefined>(undefined)
  const [attachments, setAttachments] = useState<Array<CommunicationAttachment & { contentBase64: string }>>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const { data: settings } = useAppSettings()
  const { effectiveRole, isAdmin } = useAuth()
  const canToggleCommunications = effectiveRole === 'administrativo' || isAdmin
  const setCommunicationsMutation = useSetCommunicationsEnabled()
  const conferenceQuery = useCustomerCommunicationConference({ filters, kind, nature, enabled: conferenceRequested })
  const customerHistoryId = Number(searchParams.get('customer'))
  const historyCustomerId = Number.isInteger(customerHistoryId) && customerHistoryId > 0 ? customerHistoryId : undefined
  const historyCommunicationId = Number(searchParams.get('communication'))
  const historyQuery = useCustomerCommunicationHistory(historyCustomerId)
  const savedTemplatesQuery = useCustomerCommunicationSavedTemplates()
  const saveTemplateMutation = useSaveCustomerCommunicationSavedTemplate()
  const dispatchMutation = useDispatchCustomerCommunication()
  const conference = conferenceQuery.data
  const tab: CommunicationTab = searchParams.get('tab') === 'historico' ? 'historico' : 'disparo'

  const defaultSelectedKeys = useMemo(
    () => new Set((conference?.rows ?? []).filter((row) => row.selected).map((row) => row.key)),
    [conference],
  )
  const selectedKeys = selectionState.scope === conference ? selectionState.keys : defaultSelectedKeys
  const resendConfirmed = resendConfirmationScope === conference && conference !== undefined

  const selectedRows = useMemo(
    () => (conference?.rows ?? []).filter((row) => selectedKeys.has(row.key) && !row.blocked),
    [conference?.rows, selectedKeys],
  )
  const hasResend = selectedRows.some((row) => row.nextAttemptDiscriminator > 0)
  const previewRow = selectedRows[0] ?? conference?.rows.find((row) => !row.blocked) ?? conference?.rows[0]
  const preview = useMemo(() => {
    if (!previewRow) return null
    try {
      const input = kind === 'institucional' || kind === 'livre'
        ? { ...previewRow.renderInput, subject: institutionalSubject, body: institutionalBody }
        : previewRow.renderInput
      return renderCustomerCommunicationTemplate(kind, input)
    } catch {
      return null
    }
  }, [institutionalBody, institutionalSubject, kind, previewRow])

  function updateFilter<K extends keyof CustomerCommunicationFilters>(field: K, value: CustomerCommunicationFilters[K]) {
    setFilters((current) => ({ ...current, [field]: value }))
    setConferenceRequested(false)
    setDispatchMessage(null)
  }

  function handleKindChange(nextKind: CustomerCommunicationKind) {
    setKind(nextKind)
    setNature(getCustomerCommunicationNature(nextKind))
    updateFilter('mode', nextKind === 'institucional' ? 'institucional' : 'carga')
    setConferenceRequested(false)
  }

  function handleModeChange(mode: CustomerCommunicationFilters['mode']) {
    updateFilter('mode', mode)
    if (mode === 'institucional') {
      setKind('institucional')
      setNature('avisos_gerais')
    } else {
      setKind('aviso_chegada_noa')
      setNature('avisos_operacionais')
    }
  }

  function selectTab(nextTab: CommunicationTab) {
    const next = new URLSearchParams(searchParams)
    if (nextTab === 'historico') next.set('tab', 'historico')
    else next.delete('tab')
    setSearchParams(next, { replace: true })
  }

  function applySavedTemplate(templateId: string) {
    const template = savedTemplatesQuery.data?.find((item) => String(item.id) === templateId)
    if (!template) return
    setInstitutionalSubject(template.subject)
    setInstitutionalBody(template.body)
    setDispatchMessage(null)
  }

  async function saveCurrentTemplate() {
    if (!templateName.trim() || !institutionalSubject.trim() || !institutionalBody.trim()) {
      setDispatchError('Informe nome, assunto e mensagem para salvar o modelo.')
      return
    }
    setDispatchError(null)
    try {
      await saveTemplateMutation.mutateAsync({ name: templateName, subject: institutionalSubject, body: institutionalBody })
      setTemplateName('')
      setDispatchMessage('Modelo institucional salvo.')
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : 'Falha ao salvar o modelo.')
    }
  }

  function toggleRow(key: string) {
    if (!conference) return
    setSelectionState((current) => {
      const next = current.scope === conference ? new Set(current.keys) : new Set(defaultSelectedKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { scope: conference, keys: next }
    })
    setDispatchMessage(null)
  }

  async function handleAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setAttachmentError(null)
    if (!files.length) {
      setAttachments([])
      return
    }
    try {
      const encoded = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        contentType: file.type,
        size: file.size,
        contentBase64: await fileToBase64(file),
      })))
      assertValidCommunicationAttachments(kind, encoded)
      setAttachments(encoded)
    } catch (error) {
      setAttachments([])
      setAttachmentError(error instanceof Error ? error.message : 'Anexos inválidos.')
    }
  }

  async function handleDispatch() {
    setDispatchError(null)
    setDispatchMessage(null)
    if ((kind === 'institucional' || kind === 'livre') && (!institutionalSubject.trim() || !institutionalBody.trim())) {
      setDispatchError('Informe o assunto e a mensagem antes de disparar.')
      return
    }
    if (!selectedRows.length) {
      setDispatchError('Selecione ao menos um cliente elegível.')
      return
    }
    if (hasResend && !resendConfirmed) {
      setDispatchError('Confirme o reenvio para clientes que já receberam este comunicado.')
      return
    }
    if (!preview) {
      setDispatchError('Não foi possível renderizar o comunicado selecionado.')
      return
    }
    setSending(true)
    let sent = 0
    let simulated = 0
    try {
      const dispatchId = kind === 'institucional' || kind === 'livre' ? crypto.randomUUID() : null
      const dispatchAnchored = kind === 'institucional' || kind === 'livre'
      for (const row of selectedRows) {
        const input = kind === 'institucional' || kind === 'livre'
          ? { ...row.renderInput, subject: institutionalSubject, body: institutionalBody }
          : row.renderInput
        const rendered = renderCustomerCommunicationTemplate(kind, input)
        for (const contact of row.eligibleRecipients) {
          const result = await dispatchMutation.mutateAsync({
            customerId: row.customerId,
            kind,
            nature,
            recipient: contact.email!.trim(),
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            blIds: row.bls.map((bl) => bl.id),
            anchorVoyageId: dispatchAnchored ? null : row.sourceBls[0]?.voyageId ?? null,
            anchorPort: dispatchAnchored ? null : row.sourceBls[0]?.pod ?? null,
            anchorAtracacaoId: kind === 'aviso_atracacao_nob' ? row.sourceBls[0]?.terminalStateId ?? null : null,
            attemptDiscriminator: row.nextAttemptDiscriminator,
            dispatchId,
            vesselName: input.vesselName,
            voyageNumber: input.voyageNumber,
            terminalName: input.terminalName,
            attachments,
          })
          sent += 1
          if (result.status === 'simulado') simulated += 1
        }
      }
      setDispatchMessage(settings?.communications_enabled === false
        ? `${sent} tentativa(s) registrada(s) em simulação; nenhum e-mail saiu do sistema.`
        : `${sent} e-mail(s) encaminhado(s)${simulated ? `, ${simulated} em simulação` : ''}.`)
      setConferenceRequested(false)
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : 'Falha ao disparar os comunicados.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Comunicação com Clientes"
        description="Conferência e envio controlado de avisos operacionais e institucionais."
        action={
          <Link to="/clientes" className="app-btn app-btn--secondary">
            Voltar para Clientes
          </Link>
        }
      />

      {settings?.communications_enabled === false ? (
        <div role="status" className="app-surface mb-6 flex flex-col gap-3 rounded-xl border border-l-4 border-[var(--app-border)] border-l-amber-500 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
              <AlertTriangle size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--app-text-strong)]">Modo de simulação permanente</div>
              <p className="mt-0.5 text-xs text-[var(--app-muted)]">A chave global está desligada. Os comunicados serão registrados como simulados e nenhum e-mail será enviado ao Resend.</p>
            </div>
          </div>
          {canToggleCommunications ? (
            <Button
              type="button"
              variant="secondary"
              loading={setCommunicationsMutation.isPending}
              onClick={() => {
                if (window.confirm('Confirma a ativação da chave global de envio? Os próximos disparos de comunicados e cobranças enviarão e-mails reais aos clientes via Resend.')) {
                  void setCommunicationsMutation.mutateAsync(true)
                }
              }}
            >
              Ativar envio real
            </Button>
          ) : null}
        </div>
      ) : settings?.communications_enabled === true ? (
        <div role="status" className="app-surface mb-6 flex flex-col gap-3 rounded-xl border border-l-4 border-[var(--app-border)] border-l-emerald-500 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--app-text-strong)]">Canal de envio real ativo</div>
              <p className="mt-0.5 text-xs text-[var(--app-muted)]">A chave global está ligada. E-mails reais são disparados aos contatos elegíveis via Resend.</p>
            </div>
          </div>
          {canToggleCommunications ? (
            <Button
              type="button"
              variant="secondary"
              loading={setCommunicationsMutation.isPending}
              onClick={() => {
                if (window.confirm('Deseja desativar a chave global de envio e retornar ao modo de simulação?')) {
                  void setCommunicationsMutation.mutateAsync(false)
                }
              }}
            >
              Desativar envio real
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          className={`app-tab ${tab === 'disparo' ? 'app-tab--active' : ''}`}
          onClick={() => selectTab('disparo')}
        >
          <Mail size={15} className="mr-2 inline" /> Disparo
        </button>
        <button
          type="button"
          className={`app-tab ${tab === 'historico' ? 'app-tab--active' : ''}`}
          onClick={() => selectTab('historico')}
        >
          <History size={15} className="mr-2 inline" /> Histórico
        </button>
      </div>

      {tab === 'disparo' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="grid gap-5">
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-white">Critérios do disparo</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Modo">
                  <Select value={filters.mode} onChange={(event) => handleModeChange(event.target.value as CustomerCommunicationFilters['mode'])}>
                    <option value="carga">Carga</option>
                    <option value="institucional">Institucional · Cliente Comunicável</option>
                  </Select>
                </Field>
                <Field label="Modelo">
                  <Select value={kind} onChange={(event) => handleKindChange(event.target.value as CustomerCommunicationKind)}>
                    {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </Field>
                <Field label="Natureza">
                    <Select
                      value={nature}
                      disabled={kind !== 'livre'}
                      onChange={(event) => {
                        setNature(event.target.value as CustomerCommunicationNature)
                        setConferenceRequested(false)
                        setDispatchMessage(null)
                      }}
                    >
                    {CUSTOMER_COMMUNICATION_NATURES.map((value) => <option key={value} value={value}>{NATURE_LABELS[value]}</option>)}
                  </Select>
                </Field>
                <Field label="CNPJ">
                  <Input value={filters.cnpj} onChange={(event) => updateFilter('cnpj', event.target.value)} placeholder="CNPJ do cliente" />
                </Field>
                <Field label="Navio" hint="No modo carga, este ou outro filtro operacional é obrigatório.">
                  <Input value={filters.vessel} onChange={(event) => updateFilter('vessel', event.target.value)} placeholder="Nome do navio" disabled={filters.mode === 'institucional'} />
                </Field>
                <Field label="Viagem">
                  <Input value={filters.voyage} onChange={(event) => updateFilter('voyage', event.target.value)} placeholder="Número da viagem" disabled={filters.mode === 'institucional'} />
                </Field>
                <Field label="Escala">
                  <Input value={filters.scale} onChange={(event) => updateFilter('scale', event.target.value)} placeholder="Número ou porto da escala" disabled={filters.mode === 'institucional'} />
                </Field>
                <Field label="POD">
                  <Input value={filters.pod} onChange={(event) => updateFilter('pod', event.target.value)} placeholder="Porto de descarga" disabled={filters.mode === 'institucional'} />
                </Field>
                <Field label="POL">
                  <Input value={filters.pol} onChange={(event) => updateFilter('pol', event.target.value)} placeholder="Porto de embarque" disabled={filters.mode === 'institucional'} />
                </Field>
              </div>

              {kind === 'institucional' || kind === 'livre' ? (
                <div className="mt-4 grid gap-4">
                  <Field label="Assunto" required>
                    <Input value={institutionalSubject} onChange={(event) => { setInstitutionalSubject(event.target.value); setDispatchMessage(null) }} placeholder="Assunto do comunicado" />
                  </Field>
                  <Field label="Mensagem" required>
                    <Textarea rows={5} value={institutionalBody} onChange={(event) => { setInstitutionalBody(event.target.value); setDispatchMessage(null) }} placeholder="Escreva a mensagem para os clientes selecionados." />
                  </Field>
                  {kind === 'institucional' ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="Modelo salvo">
                        <Select defaultValue="" onChange={(event) => applySavedTemplate(event.target.value)}>
                          <option value="">Selecionar modelo...</option>
                          {(savedTemplatesQuery.data ?? []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Nome do novo modelo">
                        <Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Ex.: Aviso de recesso" />
                      </Field>
                      <Button type="button" variant="secondary" loading={saveTemplateMutation.isPending} onClick={() => void saveCurrentTemplate()}>Salvar modelo</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => { setConferenceRequested(true); setDispatchError(null); setDispatchMessage(null) }} loading={conferenceQuery.isFetching}>
                  <CheckCircle2 size={16} /> Conferir destinatários
                </Button>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <Paperclip size={15} />
                  Anexos (opcional)
                  <input type="file" multiple accept="application/pdf,image/jpeg,image/png,text/plain" className="sr-only" onChange={(event) => void handleAttachments(event)} />
                </label>
                {attachments.length ? <span className="text-xs text-slate-400">{attachments.length} arquivo(s) selecionado(s)</span> : null}
              </div>
              {attachmentError ? <div className="mt-3 text-sm text-red-300">{attachmentError}</div> : null}
              {!conferenceRequested && filters.mode === 'carga' && !filters.vessel && !filters.voyage && !filters.scale && !filters.pod && !filters.pol ? (
                <div className="mt-4 text-sm text-amber-200">Informe um filtro operacional antes da conferência.</div>
              ) : null}
              {conferenceQuery.isError ? <div className="mt-4"><InlineError message={conferenceQuery.error instanceof Error ? conferenceQuery.error.message : 'Falha ao conferir destinatários.'} /></div> : null}
            </Card>

            {conference ? (
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Painel de conferência</h2>
                    <p className="mt-1 text-sm text-slate-400">A seleção é mantida somente nesta conferência; desmarque os clientes que não devem receber o disparo.</p>
                  </div>
                  <Button type="button" onClick={() => void handleDispatch()} loading={sending} disabled={!selectedRows.length}>
                    <Send size={16} /> Disparar selecionados
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <Metric label="Clientes" value={conference.totalCustomers} />
                  <Metric label="E-mails elegíveis" value={conference.totalEligibleEmails} />
                  <Metric label="Excluídos" value={conference.totalExcludedEmails} />
                  <Metric label="Selecionados" value={selectedRows.length} />
                </div>
                {hasResend ? (
                  <label className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                    <input type="checkbox" checked={resendConfirmed} onChange={(event) => setResendConfirmationScope(event.target.checked ? conference : undefined)} />
                    <span>Confirmo o reenvio dos clientes que já possuem um disparo deste modelo. A nova tentativa usará outro discriminador de idempotência.</span>
                  </label>
                ) : null}
                {dispatchError ? <div className="mt-4"><InlineError message={dispatchError} /></div> : null}
                {dispatchMessage ? <div className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">{dispatchMessage}</div> : null}
                <div className="mt-5 grid gap-3">
                  {conference.rows.map((row) => (
                    <ConferenceRow key={row.key} row={row} selected={selectedKeys.has(row.key)} onToggle={() => toggleRow(row.key)} />
                  ))}
                  {!conference.rows.length ? <div className="text-sm text-slate-400">Nenhuma carga atende aos critérios informados.</div> : null}
                </div>
              </Card>
            ) : null}
          </div>

          <Card>
            <h2 className="mb-2 text-lg font-semibold text-white">Preview</h2>
            <p className="mb-4 text-sm text-slate-400">O preview usa o primeiro cliente selecionado e respeita a âncora de terminal do NOB.</p>
            {preview ? (
              <div className="rounded-xl border border-[var(--app-border)] bg-white p-4 text-slate-800">
                <div className="border-b border-slate-200 pb-3 text-sm font-semibold">{preview.subject}</div>
                <div className="prose prose-sm mt-4 max-w-none" dangerouslySetInnerHTML={{ __html: preview.html.slice(preview.html.indexOf('<main'), preview.html.indexOf('</main>')).replace(/^<main[^>]*>/, '') }} />
              </div>
            ) : <div className="text-sm text-slate-400">Conferir os destinatários para gerar o preview.</div>}
          </Card>
        </div>
      ) : (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Histórico de Comunicados</h2>
              <p className="mt-1 text-sm text-slate-400">O histórico é permanente e distingue enviados, simulados e falhas.</p>
            </div>
            <Badge tone="blue">{historyQuery.data?.length ?? 0} registros</Badge>
          </div>
          {historyQuery.isLoading ? <div className="mt-5 text-sm text-slate-400">Carregando histórico...</div> : null}
          {historyQuery.isError ? <div className="mt-5"><InlineError message="Não foi possível carregar o histórico." /></div> : null}
          <div className="mt-5 grid gap-3">
            {historyQuery.data?.filter((item) => !Number.isInteger(historyCommunicationId) || historyCommunicationId <= 0 || item.id === historyCommunicationId).map((item) => (
              <div key={item.id} className="rounded-xl border border-[var(--app-border)] bg-[#0d1117] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(item.status)}>{customerCommunicationStatusLabel(item.status)}</Badge>
                  <span className="font-semibold text-white">{customerCommunicationKindLabel(item.kind)}</span>
                  <span className="text-xs text-slate-500">#{item.id} · tentativa {item.attempt_discriminator}</span>
                </div>
                <div className="mt-2 text-sm text-slate-300">
                  {item.customer?.cnpj_cpf ? <Link to={`/clientes/${encodeURIComponent(item.customer.cnpj_cpf)}`} className="text-cyan-200 hover:text-cyan-100">{item.customer.name}</Link> : item.customer?.name ?? `Cliente ${item.customer_id}`}
                  {item.vessel_name ? ` · ${item.vessel_name}` : ''}{item.voyage_number ? ` / ${item.voyage_number}` : ''}{item.anchor_port ? ` · ${item.anchor_port}` : ''}{item.terminal_name ? ` · ${item.terminal_name}` : ''}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{new Date(item.created_at).toLocaleString('pt-BR')}</span>
                  {item.bl_links.length ? <span>B/Ls: {item.bl_links.map((link) => link.bl_id).join(', ')}</span> : <span>Institucional</span>}
                  <span>{item.attempts.length} tentativa(s) registrada(s)</span>
                </div>
                {item.attachments.length ? (
                  <div className="mt-2 text-xs text-slate-400">
                    Anexos: {item.attachments.map((attachment) => `${attachment.file_name} (${formatAttachmentSize(attachment.size_bytes)})`).join(', ')}
                  </div>
                ) : null}
              </div>
            ))}
            {!historyQuery.isLoading && !historyQuery.isError && !historyQuery.data?.length ? <div className="text-sm text-slate-400">Nenhum comunicado registrado ainda.</div> : null}
          </div>
        </Card>
      )}
    </>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-[var(--app-border)] bg-[#0d1117] p-3"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold text-white">{value}</div></div>
}

function ConferenceRow({ row, selected, onToggle }: { row: CustomerCommunicationConferenceRow; selected: boolean; onToggle: () => void }) {
  return (
    <div className={`rounded-xl border p-4 ${row.blocked ? 'border-red-400/30 bg-red-400/5' : selected ? 'border-cyan-400/40 bg-cyan-400/5' : 'border-[var(--app-border)] bg-[#0d1117]'}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} disabled={row.blocked} onChange={onToggle} className="mt-1" aria-label={`Selecionar ${row.customerName}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-white">{row.customerName}</strong>
            <span className="text-xs text-slate-500">{row.customerCnpj || 'CNPJ não informado'}</span>
            {row.terminalName ? <Badge tone="blue">{row.terminalName}</Badge> : null}
            {row.nextAttemptDiscriminator > 0 ? <Badge tone="yellow">Reenvio {row.nextAttemptDiscriminator}</Badge> : null}
            {row.blocked ? <Badge tone="red">Bloqueado</Badge> : <Badge tone="green">Elegível</Badge>}
          </div>
          <div className="mt-2 text-xs text-slate-400">{row.bls.length ? `${row.bls.length} B/L(s) · ${row.bls.map((bl) => bl.id).join(', ')}` : `${row.sourceBls.length} carga(s) usada(s) para qualificação institucional`}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-emerald-200">{row.eligibleRecipients.length} e-mail(s) elegível(is)</span>
            {row.excludedRecipients.length ? <span className="text-amber-200">{row.excludedRecipients.length} excluído(s): {row.excludedRecipients.map((item) => excludedReasonLabel(item.reason)).join(', ')}</span> : null}
          </div>
          {row.eligibleRecipients.length ? <div className="mt-2 text-xs text-slate-500">{row.eligibleRecipients.map((contact) => contact.email).join(', ')}</div> : null}
        </div>
      </div>
    </div>
  )
}

function excludedReasonLabel(reason: string): string {
  if (reason === 'preferencia_desligada') return 'preferência desligada'
  if (reason === 'email_ausente') return 'sem e-mail'
  if (reason === 'suprimido_complaint') return 'complaint'
  if (reason === 'suprimido_bounce') return 'bounce'
  return reason
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
