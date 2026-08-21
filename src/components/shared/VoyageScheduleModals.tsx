import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Field, Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/ConfirmDialog'
import {
  getEditableVoyagePodCeStatus,
  POD_CE_STATUS_OPTIONS,
  type EditableVoyagePodCeStatus,
  type VoyagePodCeStatus,
} from '../../services/voyageRouteSchedules'
import { normalizePortCode } from '../../services/portCode'
import { normalizeDischargePorts } from '../../services/voyageExportSchedules'
import type {
  ClosedAdrBlocker,
  OperationFront,
  OperationFrontDirection,
  OperationFrontKind,
  TerminalOption,
  TerminalScaleState,
} from '../../services/escalaTerminalAllocation'

// Portos brasileiros de escala, na ordem em que a operação os lê.
const ESCALA_PORT_SUGGESTIONS = [
  'BRVIX', 'BRSSA', 'BRPEC', 'BRSUA', 'BRSSZ', 'BRIGI', 'BRNVT',
  'BRPNG', 'BRRIG', 'BRRIO', 'BRITJ', 'BRMCZ', 'BRFOR', 'BRBEL', 'BRREC',
  'BRNAT', 'BRSLZ', 'BRMAO', 'BRSFS', 'BRIOS',
] as const

export type EscalaExportPayload = {
  temExportacao: boolean
  hasGranite: boolean
  hasEmpty: boolean
  containersQty: number | null
  movementsQty: number | null
  dischargePorts: string[]
}

export type EscalaModalPayload = {
  voyageId: number
  port: string
  temImportacao: boolean
  eta: string | null
  etb: string | null
  ata: string | null
  atb: string | null
  etd: string | null
  atd: string | null
  rtw: number | null
  ceStatus: EditableVoyagePodCeStatus
  linked: boolean
  escalaNumber: string | null
  exportacao: EscalaExportPayload
  exportExistingId: string | null
  terminalState?: {
    expectedRevision: number
    fronts: Array<{
      sentido: OperationFrontDirection
      modalidade: OperationFrontKind
      terminalId: string | null
      source: OperationFront['source']
    }>
    terminals: Array<{
      terminalId: string
      atb: string | null
      atd: string | null
      restow: number | null
    }>
    exportExpectation: Record<string, unknown>
    justification: string | null
  }
}

export type EscalaModalTerminalScale = TerminalScaleState & {
  loading?: boolean
  error?: string | null
}

export type EscalaModalData = {
  voyageId: number
  voyageLabel: string
  /** `null` cria uma escala nova; preenchido edita a escala daquele porto. */
  port: string | null
  temImportacao: boolean
  eta: string | null
  etb: string | null
  ata: string | null
  atb: string | null
  etd: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  escalaNumber: string | null
  exportExistingId: string | null
  temExportacao: boolean
  hasGranite: boolean
  hasEmpty: boolean
  containersQty: number | null
  movementsQty: number | null
  dischargePorts: string[]
  /**
   * Há granito ou Embarque de Vazios nesta escala: a exportação não pode ser
   * desdeclarada enquanto a carga existir.
   */
  exportLocked: boolean
  /** Bloqueios por natureza: granito não deve ser travado por vazios vinculados. */
  graniteLocked?: boolean
  emptyLocked?: boolean
  terminalScale?: EscalaModalTerminalScale | null
}

// Modais apresentacionais de escala e de manifesto; a persistência fica no
// callback do pai.

export function PolScheduleModal({
  open,
  polSchedule,
  onClose,
  onSaved,
}: {
  open: boolean
  polSchedule: {
    voyageId: number
    voyageLabel: string
    pol: string
    pod: string
    etd: string | null
    atd: string | null
    ceMaster: string | null
    batchIds: number[]
  } | null
  onClose: () => void
  onSaved: (payload: { voyageId: number; pol: string; pod: string; etd: string | null; atd: string | null; ceMaster: string | null; batchIds: number[] }) => Promise<void>
}) {
  const [etd, setEtd] = useState('')
  const [atd, setAtd] = useState('')
  const [ceMaster, setCeMaster] = useState('')
  const [saving, setSaving] = useState(false)

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // identidade do payload, durante o render (sem useEffect).
  const [prevSchedule, setPrevSchedule] = useState<typeof polSchedule>(null)
  if (open && polSchedule && polSchedule !== prevSchedule) {
    setPrevSchedule(polSchedule)
    setEtd(polSchedule.etd ?? '')
    setAtd(polSchedule.atd ?? '')
    setCeMaster(polSchedule.ceMaster ?? '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!polSchedule) return

    setSaving(true)
    try {
      await onSaved({
        voyageId: polSchedule.voyageId,
        pol: polSchedule.pol,
        pod: polSchedule.pod,
        etd: etd || null,
        atd: atd || null,
        ceMaster: ceMaster.trim() || null,
        batchIds: polSchedule.batchIds,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Editar ETD + ATD e CE Master">
      {polSchedule ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="app-panel app-panel--padded text-sm">
            <div className="font-semibold text-[var(--app-text-strong)]">{polSchedule.voyageLabel}</div>
            <div className="mt-1">Rota: {polSchedule.pol} -&gt; {polSchedule.pod}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="ETD">
              <Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} />
            </Field>
            <Field label="ATD">
              <Input type="date" value={atd} onChange={(event) => setAtd(event.target.value)} />
            </Field>
            <Field label="CE Master">
              <Input value={ceMaster} onChange={(event) => setCeMaster(event.target.value)} placeholder="Ex.: 25BR00481" />
            </Field>
          </div>

          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} type="submit">
              Salvar
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}

const FRONT_LABELS: Record<OperationFrontKind, string> = {
  carga_cheia: 'Carga cheia',
  carga_solta: 'Carga solta',
  vazio: 'Vazios',
  veiculo: 'Veículos',
  granito: 'Granito',
}

const DIRECTION_LABELS: Record<OperationFrontDirection, string> = {
  importacao: 'Importação',
  exportacao: 'Exportação',
}

function frontKey(front: Pick<OperationFront, 'sentido' | 'modalidade'>) {
  return `${front.sentido}:${front.modalidade}`
}

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
}

function mergeTerminalOptions(active: TerminalOption[], historical: TerminalOption[]) {
  const options = new Map<string, TerminalOption>()
  for (const option of [...active, ...historical]) {
    const existing = options.get(option.id)
    options.set(option.id, existing && existing.active ? existing : option)
  }
  return [...options.values()].sort((left, right) => left.code.localeCompare(right.code))
}

function orderTerminalIds(
  scale: TerminalScaleState,
  fronts: Record<string, string>,
  dates: Record<string, { atb: string; atd: string; restow: string }>,
  terminalById: Map<string, TerminalOption>,
) {
  const ids = new Set(scale.terminals.map((terminal) => terminal.terminalId))
  for (const terminalId of Object.values(fronts)) if (terminalId) ids.add(terminalId)
  return [...ids].sort((leftId, rightId) => {
    const leftAtb = dates[leftId]?.atb || ''
    const rightAtb = dates[rightId]?.atb || ''
    if (leftAtb && rightAtb && leftAtb !== rightAtb) return leftAtb.localeCompare(rightAtb)
    if (leftAtb && !rightAtb) return -1
    if (!leftAtb && rightAtb) return 1
    return (terminalById.get(leftId)?.code ?? leftId).localeCompare(terminalById.get(rightId)?.code ?? rightId)
  })
}

function sameDraft(left: Record<string, unknown>, right: Record<string, unknown>) {
  const normalize = (value: Record<string, unknown>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function sameExportExpectation(left: Record<string, unknown>, right: Record<string, unknown>) {
  const normalize = (value: Record<string, unknown>) => ({
    ...value,
    discharge_ports: Array.isArray(value.discharge_ports)
      ? value.discharge_ports.map(String).map((port) => port.trim().toUpperCase()).sort()
      : [],
  })
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function isRevisionConflictError(error: unknown) {
  const value = error as { code?: string; message?: string } | null
  return value?.code === 'ESCALA_REVISION_CONFLICT'
    || value?.code === 'P0001'
    || /REVISAO_OBSOLETA|revis[aã]o.*(obsoleta|atualizada)|vers[aã]o.*(obsoleta|atualizada)/i.test(value?.message ?? '')
}

function isClosedAdrError(error: unknown): error is { blockers: ClosedAdrBlocker[] } {
  const value = error as { code?: string; blockers?: ClosedAdrBlocker[]; message?: string } | null
  return value?.code === 'ADR_CLOSED_BLOCKED'
    || (Array.isArray(value?.blockers) && value.blockers.length > 0)
    || /ADR fechado/i.test(value?.message ?? '')
}

function buildTerminalPayload({
  terminalScale,
  terminalFronts,
  terminalDates,
  terminalStateChanged,
  justification,
  exportExpectation,
  initialExportExpectation,
}: {
  terminalScale: EscalaModalTerminalScale | null
  terminalFronts: Record<string, string>
  terminalDates: Record<string, { atb: string; atd: string; restow: string }>
  terminalStateChanged: boolean
  justification: string
  exportExpectation: Record<string, unknown>
  initialExportExpectation: Record<string, unknown>
}): { value?: EscalaModalPayload['terminalState']; error?: string } {
  if (!terminalScale) return {}
  if (terminalScale.loading) return { error: 'Aguarde o carregamento das frentes e terminais antes de salvar a escala.' }
  if (terminalScale.error) return { error: terminalScale.error }

  const frontsByKey = new Map(terminalScale.fronts.map((front) => [frontKey(front), front]))
  const fronts = terminalScale.fronts.flatMap((front) => {
    if (front.sentido === 'exportacao') {
      if (exportExpectation.tem_exportacao !== true) return []
      if (front.modalidade === 'granito' && exportExpectation.granito !== true) return []
      if (front.modalidade === 'vazio' && exportExpectation.has_empty !== true) return []
    }
    const terminalId = terminalFronts[frontKey(front)] || null
    return [{ sentido: front.sentido, modalidade: front.modalidade, terminalId, source: front.source }]
  })
  for (const modalidade of ['granito', 'vazio'] as const) {
    if (exportExpectation.tem_exportacao === true && exportExpectation[modalidade === 'vazio' ? 'has_empty' : modalidade] === true && !frontsByKey.has(`exportacao:${modalidade}`)) {
      fronts.push({ sentido: 'exportacao', modalidade, terminalId: null, source: 'export_declaration' })
    }
  }

  // O payload representa o estado atual das frentes. Manter todos os IDs que
  // vieram do state anterior deixava terminais sem frente persistidos depois
  // de uma realocação completa.
  const terminalIds = new Set<string>(
    fronts.flatMap((front) => front.terminalId ? [front.terminalId] : []),
  )
  const terminals: NonNullable<EscalaModalPayload['terminalState']>['terminals'] = []
  for (const terminalId of terminalIds) {
    const draft = terminalDates[terminalId] ?? { atb: '', atd: '', restow: '' }
    if (draft.atd && (!draft.atb || draft.atd < draft.atb)) {
      const code = [...terminalScale.activeTerminals, ...terminalScale.historicalTerminals].find((option) => option.id === terminalId)?.code ?? terminalId
      return { error: `Informe o ATB antes do ATD do terminal ${code}; o ATD não pode ser anterior ao ATB.` }
    }
    const restow = draft.restow.trim() ? Number(draft.restow) : null
    if (restow !== null && (!Number.isInteger(restow) || restow < 0)) {
      return { error: `Restow inválido para o terminal ${terminalId}.` }
    }
    terminals.push({ terminalId, atb: draft.atb || null, atd: draft.atd || null, restow })
  }

  const submittedFronts = fronts
    .map((front) => `${front.sentido}:${front.modalidade}:${front.terminalId ?? ''}:${front.source}`)
    .sort()
  const persistedFronts = terminalScale.fronts
    .map((front) => `${front.sentido}:${front.modalidade}:${front.terminalId ?? ''}:${front.source}`)
    .sort()
  const submittedTerminals = terminals
    .map((terminal) => `${terminal.terminalId}:${terminal.atb ?? ''}:${terminal.atd ?? ''}:${terminal.restow ?? ''}`)
    .sort()
  const persistedTerminals = terminalScale.terminals
    .map((terminal) => `${terminal.terminalId}:${dateInputValue(terminal.atb)}:${dateInputValue(terminal.atd)}:${terminal.restow ?? ''}`)
    .sort()
  const terminalizedStateChanged = terminalStateChanged
    || JSON.stringify(submittedFronts) !== JSON.stringify(persistedFronts)
    || JSON.stringify(submittedTerminals) !== JSON.stringify(persistedTerminals)
  const exportExpectationChanged = !sameExportExpectation(exportExpectation, initialExportExpectation)
  if (terminalScale.revision > 0 && (terminalizedStateChanged || exportExpectationChanged) && !justification.trim()) {
    return { error: 'Informe a justificativa para alterar o estado terminalizado existente da escala.' }
  }

  return {
    value: {
      expectedRevision: terminalScale.revision,
      fronts,
      terminals,
      exportExpectation,
      justification: justification.trim() || null,
    },
  }
}

function TerminalFrontEditor({
  scale,
  terminalFronts,
  terminalDates,
  terminalOptions,
  terminalById,
  terminalIds,
  onTerminalChange,
  onDateChange,
  justification,
  onJustificationChange,
  showJustification,
  error,
  blockers,
  onReopenAdr,
}: {
  scale: EscalaModalTerminalScale
  terminalFronts: Record<string, string>
  terminalDates: Record<string, { atb: string; atd: string; restow: string }>
  terminalOptions: TerminalOption[]
  terminalById: Map<string, TerminalOption>
  terminalIds: string[]
  onTerminalChange: (front: OperationFront, terminalId: string) => void
  onDateChange: (terminalId: string, field: 'atb' | 'atd' | 'restow', value: string) => void
  justification: string
  onJustificationChange: (value: string) => void
  showJustification: boolean
  error: string | null
  blockers: ClosedAdrBlocker[]
  onReopenAdr?: (blocker: ClosedAdrBlocker) => void
}) {
  const grouped = (['importacao', 'exportacao'] as OperationFrontDirection[]).map((sentido) => ({
    sentido,
    fronts: scale.fronts.filter((front) => front.sentido === sentido),
  })).filter((group) => group.fronts.length > 0)

  return (
    <section aria-label="Frentes operacionais" className="grid gap-4 rounded-lg border border-[var(--app-border)] p-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">Frentes operacionais</h3>
        <p className="mt-1 text-xs text-[var(--app-muted)]">Terminais disponíveis somente para o porto {scale.port}. Sem terminal, a frente fica em TBC e não cria placeholder.</p>
      </div>
      {grouped.map((group) => (
        <div key={group.sentido} className="grid gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{DIRECTION_LABELS[group.sentido]}</h4>
          {group.fronts.map((front) => {
            const selected = terminalFronts[frontKey(front)] ?? ''
            return (
              <div key={frontKey(front)} className="grid gap-2 rounded-md border border-[var(--app-border)] p-2 md:grid-cols-[1fr_15rem] md:items-center">
                <div>
                  <div className="text-sm text-[var(--app-text-strong)]">{FRONT_LABELS[front.modalidade]}</div>
                  {selected ? null : <div className="text-xs text-amber-200">TBC — pendente de atribuição de terminal</div>}
                </div>
                <label className="text-xs text-[var(--app-muted)]">
                  Terminal
                  <select
                    aria-label={`Terminal ${group.sentido} ${FRONT_LABELS[front.modalidade]}`}
                    className="app-input mt-1"
                    value={selected}
                    onChange={(event) => onTerminalChange(front, event.target.value)}
                  >
                    <option value="">TBC</option>
                    {terminalOptions.map((option) => {
                      const isCurrent = option.id === selected
                      return (
                        <option key={option.id} value={option.id} disabled={!option.active && !isCurrent}>
                          {option.code}{!option.active ? ' (inativo · histórico)' : ''}
                        </option>
                      )
                    })}
                  </select>
                </label>
              </div>
            )
          })}
        </div>
      ))}

      <div className="grid gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">Datas por terminal</h4>
        {terminalIds.length === 0 ? <p className="text-xs text-[var(--app-muted)]">Nenhum terminal atribuído. As datas globais ATA/ATD permanecem acima.</p> : null}
        {terminalIds.map((terminalId) => {
          const option = terminalById.get(terminalId)
          const draft = terminalDates[terminalId] ?? { atb: '', atd: '', restow: '' }
          const code = option?.code ?? terminalId
          return (
            <div key={terminalId} className="grid gap-3 rounded-md border border-[var(--app-border)] p-2 md:grid-cols-[1fr_1fr_1fr_8rem] md:items-end">
              <div className="text-sm font-medium text-[var(--app-text-strong)]">
                {code}
                {option?.active === false ? <div className="text-xs text-amber-200">Terminal inativo · histórico</div> : null}
              </div>
              <Field label={`ATB ${code}`}><Input type="date" value={draft.atb} onChange={(event) => onDateChange(terminalId, 'atb', event.target.value)} /></Field>
              <Field label={`ATD ${code}`}><Input type="date" value={draft.atd} onChange={(event) => onDateChange(terminalId, 'atd', event.target.value)} /></Field>
              <Field label={`Restow ${code}`}><Input type="number" min="0" step="1" value={draft.restow} onChange={(event) => onDateChange(terminalId, 'restow', event.target.value)} /></Field>
            </div>
          )
        })}
      </div>

      {showJustification ? (
        <Field label="Justificativa da alteração">
          <Input value={justification} onChange={(event) => onJustificationChange(event.target.value)} placeholder="Explique a troca de terminal, remoção ou ajuste de data" />
        </Field>
      ) : null}
      {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
      {blockers.length > 0 ? (
        <div className="grid gap-2 rounded-md border border-red-400/30 bg-red-950/20 p-2 text-xs text-red-100">
          {blockers.map((blocker) => (
            <div key={`${blocker.reportId ?? 'report'}-${blocker.terminalId ?? 'terminal'}`} className="flex flex-wrap items-center justify-between gap-2">
              <span>ADR fechado{blocker.terminalCode ? ` · terminal ${blocker.terminalCode}` : ''}{blocker.reportId ? ` · ${blocker.reportId}` : ''}</span>
              <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => onReopenAdr?.(blocker)}>Reabrir ADR</Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Um porto, uma escala, um modal: importação e exportação da mesma escala são
 * declaradas aqui (ADR 0035, nota editorial de 2026-08-03).
 */
export function EscalaModal({
  open,
  escala,
  onClose,
  onSaved,
  onReopenAdr,
}: {
  open: boolean
  escala: EscalaModalData | null
  onClose: () => void
  onSaved: (payload: EscalaModalPayload) => Promise<void>
  onReopenAdr?: (blocker: ClosedAdrBlocker) => void
}) {
  const [port, setPort] = useState('')
  const [eta, setEta] = useState('')
  const [etb, setEtb] = useState('')
  const [ata, setAta] = useState('')
  const [atb, setAtb] = useState('')
  const [etd, setEtd] = useState('')
  const [atd, setAtd] = useState('')
  const [rtw, setRtw] = useState('')
  const [ceStatus, setCeStatus] = useState<EditableVoyagePodCeStatus>('waiting')
  const [linked, setLinked] = useState<'true' | 'false'>('false')
  const [escalaNumber, setEscalaNumber] = useState('')
  const [temImportacao, setTemImportacao] = useState(true)
  const [temExportacao, setTemExportacao] = useState(false)
  const [hasGranite, setHasGranite] = useState(false)
  const [hasEmpty, setHasEmpty] = useState(false)
  const [containersQty, setContainersQty] = useState('')
  const [movementsQty, setMovementsQty] = useState('')
  const [dischargePorts, setDischargePorts] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [terminalFronts, setTerminalFronts] = useState<Record<string, string>>({})
  const [terminalDates, setTerminalDates] = useState<Record<string, { atb: string; atd: string; restow: string }>>({})
  const [justification, setJustification] = useState('')
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [closedBlockers, setClosedBlockers] = useState<ClosedAdrBlocker[]>([])
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()
  const [touchedTerminalFronts, setTouchedTerminalFronts] = useState<Set<string>>(() => new Set())
  const [touchedTerminalDates, setTouchedTerminalDates] = useState<Set<string>>(() => new Set())

  const terminalScale = escala?.terminalScale ?? null
  const terminalScaleSourceKey = terminalScale
    ? [
        terminalScale.loading ? 'loading' : 'ready',
        terminalScale.error ?? '',
        terminalScale.revision,
        terminalScale.fronts.map((front) => `${frontKey(front)}:${front.terminalId ?? ''}`).join(','),
        terminalScale.terminals.map((terminal) => `${terminal.terminalId}:${terminal.atb ?? ''}:${terminal.atd ?? ''}:${terminal.restow ?? ''}`).join(','),
      ].join('|')
    : 'none'

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // escala, durante o render (sem useEffect). O estado remoto dos terminais
  // chega depois do placeholder; nessa transição só campos ainda não tocados
  // pelo operador são hidratados.
  const [prevEscalaKey, setPrevEscalaKey] = useState<string | null>(null)
  const [prevTerminalScaleSourceKey, setPrevTerminalScaleSourceKey] = useState<string | null>(null)
  const escalaKey = escala ? `${escala.voyageId}:${escala.port ?? 'new'}` : null
  if (open && escala && escalaKey !== prevEscalaKey) {
    setPrevEscalaKey(escalaKey)
    setPrevTerminalScaleSourceKey(terminalScaleSourceKey)
    setTouchedTerminalFronts(new Set())
    setTouchedTerminalDates(new Set())
    setPort(escala.port ?? '')
    setEta(escala.eta ?? '')
    setEtb(escala.etb ?? '')
    setAta(escala.ata ?? '')
    setAtb(escala.atb ?? '')
    setEtd(escala.etd ?? '')
    setAtd(escala.atd ?? '')
    setRtw(escala.rtw === null ? '' : String(escala.rtw))
    setCeStatus(getEditableVoyagePodCeStatus(escala.ceStatus))
    setLinked(escala.linked ? 'true' : 'false')
    setEscalaNumber(escala.escalaNumber ?? '')
    setTemImportacao(escala.temImportacao)
    setTemExportacao(escala.temExportacao)
    setHasGranite(escala.hasGranite)
    setHasEmpty(escala.hasEmpty)
    setContainersQty(escala.containersQty === null ? '' : String(escala.containersQty))
    setMovementsQty(escala.movementsQty === null ? '' : String(escala.movementsQty))
    setDischargePorts(escala.dischargePorts.join(', '))
    setPortError(null)
    setExportError(null)
    setTerminalError(null)
    setClosedBlockers([])
    setJustification('')
    const state = escala.terminalScale
    setTerminalFronts(Object.fromEntries(
      (state?.fronts ?? []).map((front) => [frontKey(front), front.terminalId ?? '']),
    ))
    setTerminalDates(Object.fromEntries(
      (state?.terminals ?? []).map((terminal) => [terminal.terminalId, {
        atb: dateInputValue(terminal.atb),
        atd: dateInputValue(terminal.atd),
        restow: terminal.restow == null ? '' : String(terminal.restow),
      }]),
    ))
  } else if (open && escala && terminalScaleSourceKey !== prevTerminalScaleSourceKey) {
    const wasLoading = prevTerminalScaleSourceKey?.startsWith('loading|') ?? false
    setPrevTerminalScaleSourceKey(terminalScaleSourceKey)
    if (wasLoading && terminalScale && !terminalScale.loading && !terminalScale.error) {
      const hydratedFronts = { ...terminalFronts }
      for (const front of terminalScale.fronts) {
        const key = frontKey(front)
        if (!touchedTerminalFronts.has(key)) hydratedFronts[key] = front.terminalId ?? ''
      }
      const hydratedDates = { ...terminalDates }
      for (const terminal of terminalScale.terminals) {
        const current = hydratedDates[terminal.terminalId] ?? { atb: '', atd: '', restow: '' }
        const next = { ...current }
        for (const field of ['atb', 'atd', 'restow'] as const) {
          if (!touchedTerminalDates.has(`${terminal.terminalId}:${field}`)) {
            next[field] = field === 'restow'
              ? (terminal.restow == null ? '' : String(terminal.restow))
              : dateInputValue(terminal[field])
          }
        }
        hydratedDates[terminal.terminalId] = next
      }
      setTerminalFronts(hydratedFronts)
      setTerminalDates(hydratedDates)
    }
  }

  const isNew = escala?.port === null
  const terminalOptions = terminalScale
    ? mergeTerminalOptions(terminalScale.activeTerminals, terminalScale.historicalTerminals)
      .filter((option) => terminalScale.portId == null || option.portId == null || option.portId === terminalScale.portId)
    : []
  const terminalById = new Map(terminalOptions.map((option) => [option.id, option]))
  const terminalIds = terminalScale
    ? orderTerminalIds(terminalScale, terminalFronts, terminalDates, terminalById)
    : []
  const initialTerminalFronts = Object.fromEntries(
    (terminalScale?.fronts ?? []).map((front) => [frontKey(front), front.terminalId ?? '']),
  )
  const initialTerminalDates = Object.fromEntries(
    (terminalScale?.terminals ?? []).map((terminal) => [terminal.terminalId, {
      atb: dateInputValue(terminal.atb),
      atd: dateInputValue(terminal.atd),
      restow: terminal.restow == null ? '' : String(terminal.restow),
    }]),
  )
  const terminalStateChanged = terminalScale
    ? !sameDraft(terminalFronts, initialTerminalFronts) || !sameDraft(terminalDates, initialTerminalDates)
    : false
  const hasPriorTerminalAssignment = Boolean(
    terminalScale?.fronts.some((front) => front.terminalId !== null) || terminalScale?.terminals.length,
  )
  async function handleToggleExportacao(next: boolean) {
    if (!next && escala?.exportLocked) return
    if (!next) {
      const confirmed = await confirm({
        title: 'Retirar a exportação desta escala',
        message: 'As frentes de exportação e o planejamento digitado (containers, movimentos e portos de descarga) serão removidos ao salvar. Continuar?',
        confirmLabel: 'Retirar',
        tone: 'danger',
      })
      if (!confirmed) return
    }
    setTemExportacao(next)
    if (!next) {
      setHasGranite(false)
      setHasEmpty(false)
      setContainersQty('')
      setMovementsQty('')
      setDischargePorts('')
    }
    setExportError(null)
  }

  async function handleDeclarationChange(kind: 'granito' | 'vazios', next: boolean) {
    if (!next && kind === 'granito' && (escala?.graniteLocked ?? escala?.exportLocked)) return
    if (!next && kind === 'vazios' && (escala?.emptyLocked ?? escala?.exportLocked)) return

    const nextHasGranite = kind === 'granito' ? next : hasGranite
    const nextHasEmpty = kind === 'vazios' ? next : hasEmpty
    if (next) setTemExportacao(true)
    setExportError(null)
    const hasPlanning = containersQty.trim() !== '' || movementsQty.trim() !== '' || dischargePorts.trim() !== ''
    if (!nextHasGranite && !nextHasEmpty && hasPlanning) {
      const confirmed = await confirm({
        title: 'Retirar a exportação desta escala',
        message: 'O planejamento de exportação digitado (containers, movimentos e portos de descarga) será descartado. Continuar?',
        confirmLabel: 'Retirar',
        tone: 'danger',
      })
      if (!confirmed) return
      setContainersQty('')
      setMovementsQty('')
      setDischargePorts('')
    }
    setHasGranite(nextHasGranite)
    setHasEmpty(nextHasEmpty)
  }

  function handleTerminalChange(front: OperationFront, nextTerminalId: string) {
    const key = frontKey(front)
    setTouchedTerminalFronts((current) => new Set(current).add(key))
    setTerminalFronts((current) => ({ ...current, [key]: nextTerminalId }))
    if (nextTerminalId) {
      setTerminalDates((current) => current[nextTerminalId] ? current : {
        ...current,
        [nextTerminalId]: { atb: '', atd: '', restow: '' },
      })
    }
    setTerminalError(null)
    setClosedBlockers([])
  }

  function handleTerminalDateChange(terminalId: string, field: 'atb' | 'atd' | 'restow', value: string) {
    setTouchedTerminalDates((current) => new Set(current).add(`${terminalId}:${field}`))
    setTerminalDates((current) => ({
      ...current,
      [terminalId]: { ...(current[terminalId] ?? { atb: '', atd: '', restow: '' }), [field]: value },
    }))
    setTerminalError(null)
    setClosedBlockers([])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!escala) return

    const normalizedPort = normalizePortCode(port) ?? port.trim().toUpperCase()
    if (!normalizedPort) {
      setPortError('Informe o porto da escala.')
      return
    }
    if (!normalizedPort.startsWith('BR')) {
      setPortError('A escala é de porto brasileiro; portos estrangeiros da rota não são escalas.')
      return
    }
    setPortError(null)
    const isLegacyUnclassifiedExport = Boolean(
      escala.exportExistingId && escala.temExportacao && !escala.hasGranite && !escala.hasEmpty,
    )
    if (temExportacao && !hasGranite && !hasEmpty && !isLegacyUnclassifiedExport) {
      setExportError('Uma nova declaração de exportação exige granito ou vazios.')
      return
    }
    if (!temImportacao && temExportacao) {
      if (eta.trim() || ata.trim() || etb.trim() || atb.trim()) {
        setExportError('Uma escala marcada como somente exportação não pode ter POD ou datas de importação.')
        return
      }
    }

    const terminalPayload = buildTerminalPayload({
      terminalScale,
      terminalFronts,
      terminalDates,
      terminalStateChanged,
      justification,
      exportExpectation: {
        tem_exportacao: temExportacao,
        granito: temExportacao ? hasGranite : false,
        vazios: temExportacao ? hasEmpty : false,
        has_empty: temExportacao ? hasEmpty : false,
        containers_qty: temExportacao && containersQty.trim() ? Number(containersQty) : null,
        movements_qty: temExportacao && movementsQty.trim() ? Number(movementsQty) : null,
        discharge_ports: temExportacao ? normalizeDischargePorts(dischargePorts.split(/[,;/\s]+/)) : [],
        ce_status: ceStatus,
        linked: linked === 'true',
      },
      initialExportExpectation: {
        tem_exportacao: escala.temExportacao,
        granito: escala.temExportacao ? escala.hasGranite : false,
        vazios: escala.temExportacao ? escala.hasEmpty : false,
        has_empty: escala.temExportacao ? escala.hasEmpty : false,
        containers_qty: escala.temExportacao ? escala.containersQty : null,
        movements_qty: escala.temExportacao ? escala.movementsQty : null,
        discharge_ports: escala.temExportacao ? escala.dischargePorts : [],
        ce_status: getEditableVoyagePodCeStatus(escala.ceStatus),
        linked: Boolean(escala.linked),
      },
    })
    if (terminalPayload.error) {
      setTerminalError(terminalPayload.error)
      return
    }

    setSaving(true)
    try {
      await onSaved({
        voyageId: escala.voyageId,
        port: normalizedPort,
        temImportacao,
        eta: eta || null,
        etb: etb || null,
        ata: ata || null,
        atb: atb || null,
        etd: etd || null,
        atd: atd || null,
        rtw: rtw.trim() ? Number(rtw) : null,
        ceStatus,
        linked: linked === 'true',
        escalaNumber: escalaNumber.trim() || null,
        exportacao: {
          temExportacao,
          hasGranite: temExportacao ? hasGranite : false,
          hasEmpty: temExportacao ? hasEmpty : false,
          containersQty: temExportacao && containersQty.trim() ? Number(containersQty) : null,
          movementsQty: temExportacao && movementsQty.trim() ? Number(movementsQty) : null,
          dischargePorts: temExportacao ? normalizeDischargePorts(dischargePorts.split(/[,;/\s]+/)) : [],
        },
        exportExistingId: escala.exportExistingId,
        terminalState: terminalPayload.value,
      })
      setTerminalError(null)
      setClosedBlockers([])
    } catch (error) {
      if (isClosedAdrError(error)) {
        setClosedBlockers(error.blockers)
        setTerminalError('A alteração não foi aplicada porque existe ADR fechado. Reabra o ADR indicado e tente novamente.')
      } else if (isRevisionConflictError(error)) {
        setTerminalError('A escala foi atualizada por outra pessoa. Seus dados foram preservados; recarregue a escala antes de salvar novamente.')
      } else {
        setTerminalError(error instanceof Error ? error.message : 'Falha ao salvar a escala.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Adicionar escala' : 'Editar escala'}>
      {escala ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="app-panel app-panel--padded text-sm">
            <div className="font-semibold text-[var(--app-text-strong)]">{escala.voyageLabel}</div>
            <div className="app-panel__meta mt-1">
              {isNew
                ? 'Uma escala pode descarregar importação, embarcar exportação ou as duas.'
                : `Escala: ${escala.port}`}
            </div>
          </div>

          {isNew ? (
            <Field label="Porto da escala" error={portError ?? undefined}>
              <Input
                list="escala-port-suggestions"
                value={port}
                onChange={(event) => setPort(event.target.value.toUpperCase())}
                placeholder="Ex.: BRVIX"
              />
              <datalist id="escala-port-suggestions">
                {ESCALA_PORT_SUGGESTIONS.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="ETA">
              <Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} />
            </Field>
            <Field label="ATA">
              <Input type="date" value={ata} onChange={(event) => setAta(event.target.value)} />
            </Field>
            <Field label="ETB">
              <Input type="date" value={etb} onChange={(event) => setEtb(event.target.value)} />
            </Field>
            <Field label="ATB">
              <Input type="date" value={atb} onChange={(event) => setAtb(event.target.value)} />
            </Field>
            <Field label="ETD">
              <Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} />
            </Field>
            <Field label="ATD">
              <Input type="date" value={atd} onChange={(event) => setAtd(event.target.value)} />
            </Field>
          </div>

          {terminalScale?.loading ? (
            <div className="rounded-lg border border-[var(--app-border)] p-3 text-sm text-[var(--app-muted)]">Carregando frentes e terminais da escala…</div>
          ) : terminalScale ? (
            <TerminalFrontEditor
              scale={terminalScale}
              terminalFronts={terminalFronts}
              terminalDates={terminalDates}
              terminalOptions={terminalOptions}
              terminalById={terminalById}
              terminalIds={terminalIds}
              onTerminalChange={handleTerminalChange}
              onDateChange={handleTerminalDateChange}
              justification={justification}
              onJustificationChange={setJustification}
              showJustification={hasPriorTerminalAssignment || terminalScale.revision > 0}
              error={terminalError ?? terminalScale.error ?? null}
              blockers={closedBlockers}
              onReopenAdr={onReopenAdr}
            />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="RESTOW">
              <Input
                type="number"
                min="0"
                step="1"
                value={rtw}
                onChange={(event) => setRtw(event.target.value)}
                placeholder="Quantidade de restow"
              />
            </Field>
            <Field label="BLs e CEs">
              <select className="app-input" value={ceStatus} onChange={(event) => setCeStatus(event.target.value as EditableVoyagePodCeStatus)}>
                {POD_CE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="VINCULADA">
              <select className="app-input" value={linked} onChange={(event) => setLinked(event.target.value as 'true' | 'false')}>
                <option value="true">SIM</option>
                <option value="false">NÃO</option>
              </select>
            </Field>
            <Field label="Nº Escala (Mercante)">
              <Input value={escalaNumber} onChange={(event) => setEscalaNumber(event.target.value)} placeholder="Ex.: 25BR00481" />
            </Field>
          </div>

          <div className="grid gap-3 rounded-lg border border-[var(--app-border)] p-3">
            <div className="text-sm font-semibold text-[var(--app-text-strong)]">Tipo de operação da escala</div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={temImportacao}
                onChange={(event) => {
                  const checked = event.target.checked
                  if (!checked && !temExportacao) {
                    setTemExportacao(true)
                    setHasGranite(true)
                  }
                  setTemImportacao(checked)
                  setExportError(null)
                }}
                className="h-4 w-4 rounded border-slate-500 accent-amber-500"
              />
              <span className="text-sm text-[var(--app-text)]">Esta escala terá importação (descarregamento)</span>
            </label>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={temExportacao}
                disabled={escala.exportLocked && temExportacao}
                onChange={(event) => { void handleToggleExportacao(event.target.checked) }}
                className="h-4 w-4 rounded border-slate-500 accent-amber-500"
              />
              <span className="text-sm text-[var(--app-text)]">Esta escala terá exportação</span>
            </label>

            {temExportacao ? (
              <div className="grid gap-2 pl-6 pt-1 border-t border-[var(--app-border)]">
                <div className="text-xs font-semibold text-[var(--app-muted)]">Expectativa de exportação:</div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={hasGranite}
                      disabled={Boolean((escala.graniteLocked ?? escala.exportLocked) && hasGranite)}
                      onChange={(event) => { void handleDeclarationChange('granito', event.target.checked) }}
                      className="h-4 w-4 rounded border-slate-500 accent-amber-500"
                    />
                    <span className="text-sm text-[var(--app-text)]">Terá embarque de granito</span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={hasEmpty}
                      disabled={Boolean((escala.emptyLocked ?? escala.exportLocked) && hasEmpty)}
                      onChange={(event) => { void handleDeclarationChange('vazios', event.target.checked) }}
                      className="h-4 w-4 rounded border-slate-500 accent-amber-500"
                    />
                    <span className="text-sm text-[var(--app-text)]">Terá embarque de vazios</span>
                  </label>
                </div>
                <div className="text-xs text-[var(--app-muted)]">
                  {hasGranite && hasEmpty
                    ? 'Modalidade ativa: Ambos (granito e vazios)'
                    : hasGranite
                    ? 'Modalidade ativa: Somente granito'
                    : hasEmpty
                    ? 'Modalidade ativa: Somente vazios'
                    : 'Nenhuma modalidade selecionada'}
                </div>
              </div>
            ) : null}

            {exportError ? <p role="alert" className="text-xs text-red-300">{exportError}</p> : null}

            {escala.exportLocked && (hasGranite || hasEmpty) ? (
              <p className="text-xs text-[var(--app-muted)]">
                Há carga de exportação vinculada a esta escala (granito ou embarque de vazios); a
                declaração só pode ser retirada depois que a carga deixar de existir.
              </p>
            ) : null}

            {hasGranite || hasEmpty ? (
              <>
                {hasEmpty ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="CNTR (Vazios Exp.)">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={containersQty}
                        onChange={(event) => setContainersQty(event.target.value)}
                        placeholder="Opcional; quantidade operada"
                      />
                    </Field>
                    <Field label="Movimentos">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={movementsQty}
                        onChange={(event) => setMovementsQty(event.target.value)}
                        placeholder="Opcional; quantidade operada"
                      />
                    </Field>
                  </div>
                ) : null}

                <Field label="Portos de descarga">
                  <Input
                    value={dischargePorts}
                    onChange={(event) => setDischargePorts(event.target.value.toUpperCase())}
                    placeholder="Ex.: ITGOA, NLRTM"
                  />
                </Field>
                <p className="text-xs text-[var(--app-muted)]">
                  Destino da carga embarcada nesta escala. Separe por vírgula; é o que forma a
                  perna de exportação na rota da viagem. A declaração não exige quantidades.
                </p>
              </>
            ) : null}
          </div>

          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} disabled={saving || Boolean(terminalScale?.loading || terminalScale?.error)} type="submit">
              {isNew ? 'Adicionar escala' : 'Salvar escala'}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}
