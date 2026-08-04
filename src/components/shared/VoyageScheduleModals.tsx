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

// Portos brasileiros de escala, na ordem em que a operação os lê.
const ESCALA_PORT_SUGGESTIONS = ['BRVIX', 'BRSSA', 'BRPEC', 'BRSUA', 'BRSSZ', 'BRIGI', 'BRNVT'] as const

export type EscalaExportPayload = {
  temExportacao: boolean
  hasGranite: boolean
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
  containersQty: number | null
  movementsQty: number | null
  dischargePorts: string[]
  /**
   * Há granito ou Embarque de Vazios nesta escala: a exportação não pode ser
   * desdeclarada enquanto a carga existir.
   */
  exportLocked: boolean
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

/**
 * Um porto, uma escala, um modal: importação e exportação da mesma escala são
 * declaradas aqui (ADR 0035, nota editorial de 2026-08-03).
 */
export function EscalaModal({
  open,
  escala,
  onClose,
  onSaved,
}: {
  open: boolean
  escala: EscalaModalData | null
  onClose: () => void
  onSaved: (payload: EscalaModalPayload) => Promise<void>
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
  const [temExportacao, setTemExportacao] = useState(false)
  const [hasGranite, setHasGranite] = useState(false)
  const [containersQty, setContainersQty] = useState('')
  const [movementsQty, setMovementsQty] = useState('')
  const [dischargePorts, setDischargePorts] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // identidade do payload, durante o render (sem useEffect).
  const [prevEscala, setPrevEscala] = useState<EscalaModalData | null>(null)
  if (open && escala && escala !== prevEscala) {
    setPrevEscala(escala)
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
    setTemExportacao(escala.temExportacao)
    setHasGranite(escala.hasGranite)
    setContainersQty(escala.containersQty === null ? '' : String(escala.containersQty))
    setMovementsQty(escala.movementsQty === null ? '' : String(escala.movementsQty))
    setDischargePorts(escala.dischargePorts.join(', '))
    setPortError(null)
  }

  const isNew = escala?.port === null

  async function handleToggleExportacao(next: boolean) {
    if (next) {
      setTemExportacao(true)
      return
    }
    // A carga vinculada trava o toggle antes de chegar aqui; o que resta é o
    // planejamento digitado, e descartá-lo pede confirmação.
    if (escala?.exportLocked) return
    const hasPlanning = hasGranite || containersQty.trim() !== '' || movementsQty.trim() !== '' || dischargePorts.trim() !== ''
    if (hasPlanning) {
      const confirmed = await confirm({
        title: 'Retirar a exportação desta escala',
        message: 'O planejamento de exportação digitado (granito, containers, movimentos e portos de descarga) será descartado. Continuar?',
        confirmLabel: 'Retirar',
        tone: 'danger',
      })
      if (!confirmed) return
    }
    setHasGranite(false)
    setContainersQty('')
    setMovementsQty('')
    setDischargePorts('')
    setTemExportacao(false)
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

    setSaving(true)
    try {
      await onSaved({
        voyageId: escala.voyageId,
        port: normalizedPort,
        temImportacao: escala.temImportacao,
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
          containersQty: temExportacao && containersQty.trim() ? Number(containersQty) : null,
          movementsQty: temExportacao && movementsQty.trim() ? Number(movementsQty) : null,
          dischargePorts: temExportacao ? normalizeDischargePorts(dischargePorts.split(/[,;/\s]+/)) : [],
        },
        exportExistingId: escala.exportExistingId,
      })
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

            {escala.exportLocked && temExportacao ? (
              <p className="text-xs text-[var(--app-muted)]">
                Há carga de exportação vinculada a esta escala (granito ou embarque de vazios); a
                declaração só pode ser retirada depois que a carga deixar de existir.
              </p>
            ) : null}

            {temExportacao ? (
              <>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={hasGranite}
                    onChange={(event) => setHasGranite(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-500 accent-amber-500"
                  />
                  <span className="text-sm text-[var(--app-text)]">Terá embarque de granito</span>
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="CNTR (Vazios Exp.)">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={containersQty}
                      onChange={(event) => setContainersQty(event.target.value)}
                      placeholder="Qtd. de containers"
                    />
                  </Field>
                  <Field label="Movimentos">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={movementsQty}
                      onChange={(event) => setMovementsQty(event.target.value)}
                      placeholder="Qtd. de movimentos"
                    />
                  </Field>
                </div>

                <Field label="Portos de descarga">
                  <Input
                    value={dischargePorts}
                    onChange={(event) => setDischargePorts(event.target.value.toUpperCase())}
                    placeholder="Ex.: ITGOA, NLRTM"
                  />
                </Field>
                <p className="text-xs text-[var(--app-muted)]">
                  Destino da carga embarcada nesta escala (granito e containers). Separe por vírgula;
                  é o que forma a perna de exportação na rota da viagem.
                </p>
              </>
            ) : null}
          </div>

          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} type="submit">
              {isNew ? 'Adicionar escala' : 'Salvar escala'}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}
