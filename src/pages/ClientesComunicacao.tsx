import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Eye, History, Mail, Paperclip, Send } from 'lucide-react'
import { Badge, type BadgeTone } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useAppSettings, useSetCommunicationsEnabled } from '../hooks/useAppSettings'
import { useAuth } from '../hooks/useAuth'
import { useCustomerCommunicationConference, useCustomerCommunicationHistory, useCustomerCommunicationSavedTemplates, useDispatchCustomerCommunication, useSaveCustomerCommunicationSavedTemplate, useVoyageCommunicationCoverage } from '../hooks/useCustomerCommunications'
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
  type CustomerCommunicationTemplateInput,
} from '../services/customerCommunicationTemplates'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../services/customerCommunications'
import type { CustomerCommunicationNature } from '../types/database'

type CommunicationTab = 'cobertura' | 'disparo' | 'historico'

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

function getSamplePreviewInput(subject: string, body: string): CustomerCommunicationTemplateInput {
  return {
    customerId: 1,
    customerName: 'ACME LOGÍSTICA & IMPORTAÇÃO LTDA',
    vesselName: 'MSC ALTAIR',
    voyageNumber: '2401E',
    terminalName: 'BTP Santos',
    port: 'Santos (BRSSZ)',
    milestoneAt: new Date().toISOString(),
    bls: [
      { id: 'MSCU1234567', customerId: 1 },
      { id: 'MSCU7654321', customerId: 1 },
    ],
    subject: subject.trim() || undefined,
    body: body.trim() || undefined,
  }
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
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [customPreviewRow, setCustomPreviewRow] = useState<CustomerCommunicationConferenceRow | null>(null)
  const [coverageFilters, setCoverageFilters] = useState({ vessel: '', voyage: '', month: '' })
  const [historyFilters, setHistoryFilters] = useState({ vessel: '', month: '', kind: '', status: '', origin: '' })
  const { data: settings } = useAppSettings()
  const { effectiveRole, isAdmin } = useAuth()
  const canToggleCommunications = effectiveRole === 'administrativo' || isAdmin
  const setCommunicationsMutation = useSetCommunicationsEnabled()
  const conferenceQuery = useCustomerCommunicationConference({ filters, kind, nature, enabled: conferenceRequested })
  const customerHistoryId = Number(searchParams.get('customer'))
  const historyCustomerId = Number.isInteger(customerHistoryId) && customerHistoryId > 0 ? customerHistoryId : undefined
  const historyCommunicationId = Number(searchParams.get('communication'))
  const historyQuery = useCustomerCommunicationHistory({ id: Number.isInteger(historyCommunicationId) && historyCommunicationId > 0 ? historyCommunicationId : undefined, customerId: historyCustomerId, ...historyFilters })
  const coverageQuery = useVoyageCommunicationCoverage(coverageFilters)
  const savedTemplatesQuery = useCustomerCommunicationSavedTemplates()
  const saveTemplateMutation = useSaveCustomerCommunicationSavedTemplate()
  const dispatchMutation = useDispatchCustomerCommunication()
  const conference = conferenceQuery.data
  const tab: CommunicationTab = searchParams.get('tab') === 'historico' ? 'historico' : searchParams.get('tab') === 'disparo' ? 'disparo' : 'cobertura'

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
  const activePreviewRow = customPreviewRow ?? selectedRows[0] ?? conference?.rows.find((row) => !row.blocked) ?? conference?.rows[0] ?? null

  const activePreview = useMemo(() => {
    try {
      if (activePreviewRow) {
        const input = (kind === 'institucional' || kind === 'livre')
          ? { ...activePreviewRow.renderInput, subject: institutionalSubject, body: institutionalBody }
          : activePreviewRow.renderInput
        return renderCustomerCommunicationTemplate(kind, input)
      }
      const sampleInput = getSamplePreviewInput(institutionalSubject, institutionalBody)
      return renderCustomerCommunicationTemplate(kind, sampleInput)
    } catch {
      return null
    }
  }, [activePreviewRow, institutionalBody, institutionalSubject, kind])

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
    next.set('tab', nextTab)
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
      setDispatchMessage('Modelo institucional salvo com sucesso.')
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
    if (!activePreview) {
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
        <button type="button" className={`app-tab ${tab === 'cobertura' ? 'app-tab--active' : ''}`} onClick={() => selectTab('cobertura')}>
          <CheckCircle2 size={15} className="mr-2 inline" /> Cobertura de viagens
        </button>
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

      {tab === 'cobertura' ? (
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Painel de cobertura</h2><p className="text-sm text-[var(--app-muted)]">Acompanhe a régua automática e os clientes ainda pendentes por viagem.</p></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Navio"><Input value={coverageFilters.vessel} onChange={(e) => setCoverageFilters({ ...coverageFilters, vessel: e.target.value })} placeholder="Navio" /></Field>
              <Field label="Viagem"><Input value={coverageFilters.voyage} onChange={(e) => setCoverageFilters({ ...coverageFilters, voyage: e.target.value })} placeholder="Viagem" /></Field>
              <Field label="Mês"><Input type="month" value={coverageFilters.month} onChange={(e) => setCoverageFilters({ ...coverageFilters, month: e.target.value })} /></Field>
            </div>
          </div>
          {coverageQuery.isLoading ? <div className="mt-5 text-sm text-[var(--app-muted)]">Carregando cobertura...</div> : null}
          {coverageQuery.isError ? <div className="mt-5"><InlineError message="Não foi possível carregar a cobertura." /></div> : null}
          <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--app-border)] text-xs uppercase text-[var(--app-muted)]"><th className="p-3">Viagem</th><th className="p-3">Clientes</th><th className="p-3">NOA</th><th className="p-3">NOR</th><th className="p-3">NOB</th><th className="p-3">CE / Taxas</th></tr></thead><tbody>{(coverageQuery.data ?? []).map((row) => <tr key={row.voyageId} className="border-b border-[var(--app-border)]"><td className="p-3 font-medium">{row.vesselName} · {row.voyageNumber}</td><td className="p-3">{row.customers}</td><td className="p-3"><Badge tone={row.noa.sent >= row.noa.total ? 'green' : 'yellow'}>{row.noa.sent}/{row.noa.total}</Badge></td><td className="p-3"><Badge tone={row.nor.sent >= row.nor.total ? 'green' : 'yellow'}>{row.nor.sent}/{row.nor.total}</Badge></td><td className="p-3"><Badge tone={row.nob.sent >= row.nob.total ? 'green' : 'yellow'}>{row.nob.sent}/{row.nob.total}</Badge></td><td className="p-3"><Badge tone={row.finance.pending ? 'yellow' : 'green'}>{row.finance.sent}/{row.finance.ready} enviados · {row.finance.pending} pendentes</Badge></td></tr>)}{!coverageQuery.data?.length ? <tr><td colSpan={6} className="p-8 text-center text-[var(--app-muted)]">Nenhuma viagem encontrada.</td></tr> : null}</tbody></table></div>
        </Card>
      ) : tab === 'disparo' ? (
        <div className="space-y-6">
          <Card>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Critérios do disparo</h2>
              <p className="text-sm text-[var(--app-muted)]">
                {filters.mode === 'carga'
                  ? 'Selecione o modelo operacional e informe os filtros da viagem para localizar as cargas e seus respectivos clientes.'
                  : 'Selecione o modelo institucional ou escreva uma mensagem personalizada para os clientes comunicáveis.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Modo">
                <Select value={filters.mode} onChange={(event) => handleModeChange(event.target.value as CustomerCommunicationFilters['mode'])}>
                  <option value="carga">Carga (Avisos Operacionais)</option>
                  <option value="institucional">Institucional · Cliente Comunicável</option>
                </Select>
              </Field>
              <Field label="Modelo">
                <Select value={kind} onChange={(event) => handleKindChange(event.target.value as CustomerCommunicationKind)}>
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
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
                  {CUSTOMER_COMMUNICATION_NATURES.map((value) => (
                    <option key={value} value={value}>
                      {NATURE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {filters.mode === 'carga' ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Navio">
                  <Input
                    value={filters.vessel}
                    onChange={(event) => updateFilter('vessel', event.target.value)}
                    placeholder="Nome do navio"
                  />
                </Field>
                <Field label="Viagem">
                  <Input
                    value={filters.voyage}
                    onChange={(event) => updateFilter('voyage', event.target.value)}
                    placeholder="Número da viagem"
                  />
                </Field>
                <Field label="Escala">
                  <Input
                    value={filters.scale}
                    onChange={(event) => updateFilter('scale', event.target.value)}
                    placeholder="Número ou porto da escala"
                  />
                </Field>
                <Field label="POD (Porto de Descarga)">
                  <Input
                    value={filters.pod}
                    onChange={(event) => updateFilter('pod', event.target.value)}
                    placeholder="Ex.: Santos / BRSSZ"
                  />
                </Field>
                <Field label="POL (Porto de Embarque)">
                  <Input
                    value={filters.pol}
                    onChange={(event) => updateFilter('pol', event.target.value)}
                    placeholder="Ex.: Shanghai / CNSHA"
                  />
                </Field>
                <Field label="CNPJ do Cliente (opcional)">
                  <Input
                    value={filters.cnpj}
                    onChange={(event) => updateFilter('cnpj', event.target.value)}
                    placeholder="Filtrar por CNPJ específico"
                  />
                </Field>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="CNPJ do Cliente (opcional)">
                    <Input
                      value={filters.cnpj}
                      onChange={(event) => updateFilter('cnpj', event.target.value)}
                      placeholder="Filtrar por CNPJ específico"
                    />
                  </Field>
                  {kind === 'institucional' ? (
                    <>
                      <Field label="Modelo salvo">
                        <Select defaultValue="" onChange={(event) => applySavedTemplate(event.target.value)}>
                          <option value="">Selecionar modelo salvo...</option>
                          {(savedTemplatesQuery.data ?? []).map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Field label="Salvar novo modelo">
                            <Input
                              value={templateName}
                              onChange={(event) => setTemplateName(event.target.value)}
                              placeholder="Ex.: Aviso de recesso"
                            />
                          </Field>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          loading={saveTemplateMutation.isPending}
                          onClick={() => void saveCurrentTemplate()}
                        >
                          Salvar
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>

                <Field label="Assunto" required>
                  <Input
                    value={institutionalSubject}
                    onChange={(event) => {
                      setInstitutionalSubject(event.target.value)
                      setDispatchMessage(null)
                    }}
                    placeholder="Assunto do comunicado"
                  />
                </Field>

                <Field label="Mensagem" required>
                  <Textarea
                    rows={5}
                    value={institutionalBody}
                    onChange={(event) => {
                      setInstitutionalBody(event.target.value)
                      setDispatchMessage(null)
                    }}
                    placeholder="Escreva a mensagem para os clientes selecionados..."
                  />
                </Field>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    setConferenceRequested(true)
                    setDispatchError(null)
                    setDispatchMessage(null)
                  }}
                  loading={conferenceQuery.isFetching}
                >
                  <CheckCircle2 size={16} /> Conferir destinatários
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setCustomPreviewRow(null)
                    setPreviewModalOpen(true)
                  }}
                >
                  <Eye size={16} /> Visualizar prévia do e-mail
                </Button>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-surface-hover)]">
                  <Paperclip size={15} />
                  <span>Anexos (opcional)</span>
                  <input
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png,text/plain"
                    className="sr-only"
                    onChange={(event) => void handleAttachments(event)}
                  />
                </label>
                {attachments.length ? (
                  <span className="text-xs text-[var(--app-muted)]">
                    {attachments.length} arquivo(s) selecionado(s)
                  </span>
                ) : null}
              </div>

              {!conferenceRequested && filters.mode === 'carga' && !filters.vessel && !filters.voyage && !filters.scale && !filters.pod && !filters.pol ? (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  Preencha ao menos um filtro da viagem antes de conferir.
                </div>
              ) : null}
            </div>

            {attachmentError ? <div className="mt-3 text-sm text-red-600 dark:text-red-400">{attachmentError}</div> : null}
            {conferenceQuery.isError ? (
              <div className="mt-4">
                <InlineError message={conferenceQuery.error instanceof Error ? conferenceQuery.error.message : 'Falha ao conferir destinatários.'} />
              </div>
            ) : null}
          </Card>

          {conference ? (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Painel de conferência</h2>
                  <p className="mt-0.5 text-sm text-[var(--app-muted)]">
                    A seleção é mantida somente nesta conferência; desmarque os clientes que não devem receber o disparo.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setCustomPreviewRow(null)
                      setPreviewModalOpen(true)
                    }}
                  >
                    <Eye size={16} /> Ver prévia do e-mail
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleDispatch()}
                    loading={sending}
                    disabled={!selectedRows.length}
                  >
                    <Send size={16} /> Disparar selecionados ({selectedRows.length})
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <MetricCard label="Clientes" value={conference.totalCustomers} />
                <MetricCard label="E-mails elegíveis" value={conference.totalEligibleEmails} />
                <MetricCard label="Excluídos" value={conference.totalExcludedEmails} />
                <MetricCard label="Selecionados" value={selectedRows.length} />
              </div>

              {hasResend ? (
                <label className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100">
                  <input
                    type="checkbox"
                    checked={resendConfirmed}
                    onChange={(event) => setResendConfirmationScope(event.target.checked ? conference : undefined)}
                    className="mt-0.5"
                  />
                  <span>Confirmo o reenvio dos clientes que já possuem um disparo deste modelo. A nova tentativa usará outro discriminador de idempotência.</span>
                </label>
              ) : null}

              {dispatchError ? <div className="mt-4"><InlineError message={dispatchError} /></div> : null}
              {dispatchMessage ? (
                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-950 dark:text-emerald-100">
                  {dispatchMessage}
                </div>
              ) : null}

              <div className="mt-5 grid gap-3">
                {conference.rows.map((row) => (
                  <ConferenceRowCard
                    key={row.key}
                    row={row}
                    selected={selectedKeys.has(row.key)}
                    onToggle={() => toggleRow(row.key)}
                    onPreview={() => {
                      setCustomPreviewRow(row)
                      setPreviewModalOpen(true)
                    }}
                  />
                ))}
                {!conference.rows.length ? (
                  <div className="py-8 text-center text-sm text-[var(--app-muted)]">
                    Nenhuma carga atende aos critérios informados.
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Histórico de Comunicados</h2>
              <p className="mt-0.5 text-sm text-[var(--app-muted)]">O histórico é permanente e distingue enviados, simulados e falhas.</p>
            </div>
            <Badge tone="blue">{historyQuery.data?.length ?? 0} registros</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <Input placeholder="Navio" value={historyFilters.vessel} onChange={(e) => setHistoryFilters({ ...historyFilters, vessel: e.target.value })} />
            <Input type="month" value={historyFilters.month} onChange={(e) => setHistoryFilters({ ...historyFilters, month: e.target.value })} />
            <Select value={historyFilters.kind} onChange={(e) => setHistoryFilters({ ...historyFilters, kind: e.target.value })}><option value="">Todos os modelos</option>{KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <Select value={historyFilters.status} onChange={(e) => setHistoryFilters({ ...historyFilters, status: e.target.value })}><option value="">Todos os status</option><option value="enviado">Enviado</option><option value="simulado">Simulado</option><option value="falha">Falha</option></Select>
            <Select value={historyFilters.origin} onChange={(e) => setHistoryFilters({ ...historyFilters, origin: e.target.value as '' | 'manual' | 'automatico' })}><option value="">Todas as origens</option><option value="automatico">Robô automático</option><option value="manual">Operador</option></Select>
          </div>
          {historyQuery.isLoading ? <div className="mt-5 text-sm text-[var(--app-muted)]">Carregando histórico...</div> : null}
          {historyQuery.isError ? <div className="mt-5"><InlineError message="Não foi possível carregar o histórico." /></div> : null}
          <div className="mt-5 grid gap-3">
            {historyQuery.data?.map((item) => (
              <div key={item.id} className="app-surface rounded-xl border border-[var(--app-border)] p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(item.status)}>{customerCommunicationStatusLabel(item.status)}</Badge>
                  <Badge tone={item.origin === 'automatico' ? 'blue' : 'slate'}>{item.origin === 'automatico' ? 'Robô automático' : 'Operador'}</Badge>
                  <span className="font-semibold text-[var(--app-text-strong)]">{customerCommunicationKindLabel(item.kind)}</span>
                  <span className="text-xs text-[var(--app-muted)]">#{item.id} · tentativa {item.attempt_discriminator}</span>
                </div>
                <div className="mt-2 text-sm text-[var(--app-text)]">
                  {item.customer?.cnpj_cpf ? (
                    <Link to={`/clientes/${encodeURIComponent(item.customer.cnpj_cpf)}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                      {item.customer.name}
                    </Link>
                  ) : (
                    item.customer?.name ?? `Cliente ${item.customer_id}`
                  )}
                  {item.vessel_name ? ` · ${item.vessel_name}` : ''}
                  {item.voyage_number ? ` / ${item.voyage_number}` : ''}
                  {item.anchor_port ? ` · ${item.anchor_port}` : ''}
                  {item.terminal_name ? ` · ${item.terminal_name}` : ''}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--app-muted)]">
                  <span>{new Date(item.created_at).toLocaleString('pt-BR')}</span>
                  {item.bl_links.length ? <span>B/Ls: {item.bl_links.map((link) => link.bl_id).join(', ')}</span> : <span>Institucional</span>}
                  <span>{item.attempts.length} tentativa(s) registrada(s)</span>
                </div>
                {item.attachments.length ? (
                  <div className="mt-2 text-xs text-[var(--app-muted-soft)]">
                    Anexos: {item.attachments.map((attachment) => `${attachment.file_name} (${formatAttachmentSize(attachment.size_bytes)})`).join(', ')}
                  </div>
                ) : null}
              </div>
            ))}
            {!historyQuery.isLoading && !historyQuery.isError && !historyQuery.data?.length ? (
              <div className="py-8 text-center text-sm text-[var(--app-muted)]">{historyCommunicationId > 0 ? 'Comunicado não encontrado.' : 'Nenhum comunicado registrado ainda.'}</div>
            ) : null}
          </div>
        </Card>
      )}

      <Modal
        open={previewModalOpen}
        onClose={() => {
          setPreviewModalOpen(false)
          setCustomPreviewRow(null)
        }}
        title={`Pré-visualização do Comunicado: ${customerCommunicationKindLabel(kind)}`}
        className="max-w-3xl w-full"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3 text-xs space-y-1">
            <div className="text-[var(--app-text)]">
              <span className="font-semibold text-[var(--app-muted)]">Destinatário: </span>
              {activePreviewRow
                ? `${activePreviewRow.customerName} (${activePreviewRow.eligibleRecipients[0]?.email ?? 'sem e-mail'})`
                : 'Cliente Demonstração (exemplo@cliente.com.br)'}
            </div>
            <div className="text-[var(--app-text)]">
              <span className="font-semibold text-[var(--app-muted)]">Assunto: </span>
              <span className="font-medium text-[var(--app-text-strong)]">{activePreview?.subject ?? '—'}</span>
            </div>
          </div>

          {activePreview ? (
            <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--app-border)] bg-white p-6 text-slate-800 shadow-sm">
              <div
                className="prose prose-sm max-w-none text-slate-800"
                dangerouslySetInnerHTML={{
                  __html: activePreview.html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? activePreview.html,
                }}
              />
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-[var(--app-muted)]">
              Não foi possível renderizar a prévia deste comunicado.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPreviewModalOpen(false)
                setCustomPreviewRow(null)
              }}
            >
              Fechar
            </Button>
            {conference && selectedRows.length ? (
              <Button
                onClick={() => {
                  setPreviewModalOpen(false)
                  setCustomPreviewRow(null)
                  void handleDispatch()
                }}
                loading={sending}
              >
                <Send size={15} /> Disparar ({selectedRows.length})
              </Button>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="app-surface rounded-lg border border-[var(--app-border)] p-3 shadow-xs">
      <div className="text-xs uppercase tracking-wide text-[var(--app-muted)]">{label}</div>
      <div className="mt-1 text-xl font-bold text-[var(--app-text-strong)]">{value}</div>
    </div>
  )
}

function ConferenceRowCard({
  row,
  selected,
  onToggle,
  onPreview,
}: {
  row: CustomerCommunicationConferenceRow
  selected: boolean
  onToggle: () => void
  onPreview: () => void
}) {
  return (
    <div className={`app-surface rounded-xl border p-4 shadow-xs transition-all ${
      row.blocked
        ? 'border-red-400/30 bg-red-400/5'
        : selected
          ? 'border-blue-500/50 bg-blue-500/5 ring-1 ring-blue-500/20'
          : 'border-[var(--app-border)]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <input
            type="checkbox"
            checked={selected}
            disabled={row.blocked}
            onChange={onToggle}
            className="mt-1"
            aria-label={`Selecionar ${row.customerName}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-[var(--app-text-strong)] font-semibold">{row.customerName}</strong>
              <span className="text-xs text-[var(--app-muted)]">{row.customerCnpj || 'CNPJ não informado'}</span>
              {row.terminalName ? <Badge tone="blue">{row.terminalName}</Badge> : null}
              {row.nextAttemptDiscriminator > 0 ? <Badge tone="yellow">Reenvio {row.nextAttemptDiscriminator}</Badge> : null}
              {row.blocked ? <Badge tone="red">Bloqueado</Badge> : <Badge tone="green">Elegível</Badge>}
            </div>

            <div className="mt-1.5 text-xs text-[var(--app-muted)]">
              {row.bls.length
                ? `${row.bls.length} B/L(s) · ${row.bls.map((bl) => bl.id).join(', ')}`
                : `${row.sourceBls.length} carga(s) usada(s) para qualificação institucional`}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                {row.eligibleRecipients.length} e-mail(s) elegível(is)
              </span>
              {row.excludedRecipients.length ? (
                <span className="text-amber-700 dark:text-amber-300">
                  {row.excludedRecipients.length} excluído(s): {row.excludedRecipients.map((item) => excludedReasonLabel(item.reason)).join(', ')}
                </span>
              ) : null}
            </div>

            {row.eligibleRecipients.length ? (
              <div className="mt-1.5 text-xs text-[var(--app-muted-soft)]">
                {row.eligibleRecipients.map((contact) => contact.email).join(', ')}
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onPreview}
          className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 py-1.5 shadow-xs hover:bg-[var(--app-surface-hover)]"
        >
          <Eye size={13} />
          <span>Ver e-mail</span>
        </button>
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
