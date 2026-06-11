import { useState, type FormEvent } from 'react'
import { Modal } from '../ui/Modal'
import { Field, Input } from '../ui/Input'
import { Button } from '../ui/Button'
import {
  getEditableVoyagePodCeStatus,
  POD_CE_STATUS_OPTIONS,
  type EditableVoyagePodCeStatus,
  type VoyagePodCeStatus,
} from '../../services/voyageRouteSchedules'
import type { ExportCeStatus, VoyageExportSchedule } from '../../services/voyageExportSchedules'

// Sugestões de POD para o autocomplete ao adicionar um POD ao planejamento.
const POD_SUGGESTIONS = ['BRSSA', 'BRVIX', 'BRSSZ', 'BRPEC', 'BRSUA', 'BRIGI'] as const

// Modais apresentacionais de agenda POL/POD; a persistência fica no callback do pai.

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
    etd: string | null
  } | null
  onClose: () => void
  onSaved: (payload: { voyageId: number; pol: string; etd: string | null }) => Promise<void>
}) {
  const [etd, setEtd] = useState('')
  const [saving, setSaving] = useState(false)

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // identidade do payload, durante o render (sem useEffect).
  const [prevSchedule, setPrevSchedule] = useState<typeof polSchedule>(null)
  if (open && polSchedule && polSchedule !== prevSchedule) {
    setPrevSchedule(polSchedule)
    setEtd(polSchedule.etd ?? '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!polSchedule) return

    setSaving(true)
    try {
      await onSaved({
        voyageId: polSchedule.voyageId,
        pol: polSchedule.pol,
        etd: etd || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Editar ETD do POL">
      {polSchedule ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="app-panel app-panel--padded text-sm">
            <div className="font-semibold text-[var(--app-text-strong)]">{polSchedule.voyageLabel}</div>
            <div className="mt-1">POL: {polSchedule.pol}</div>
          </div>

          <Field label="ETD">
            <Input type="date" value={etd} onChange={(event) => setEtd(event.target.value)} />
          </Field>

          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} type="submit">
              Salvar ETD
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}

export function PodScheduleModal({
  open,
  podSchedule,
  onClose,
  onSaved,
}: {
  open: boolean
  podSchedule: {
    voyageId: number
    voyageLabel: string
    pod: string
    eta: string | null
    etb: string | null
    ata: string | null
    atd: string | null
    rtw: number | null
    ceStatus: VoyagePodCeStatus | null
    linked: boolean | null
  } | null
  onClose: () => void
  onSaved: (payload: {
    voyageId: number
    pod: string
    eta: string | null
    etb: string | null
    ata: string | null
    atd: string | null
    rtw: number | null
    ceStatus: EditableVoyagePodCeStatus
    linked: boolean
  }) => Promise<void>
}) {
  const [eta, setEta] = useState('')
  const [etb, setEtb] = useState('')
  const [ata, setAta] = useState('')
  const [atd, setAtd] = useState('')
  const [rtw, setRtw] = useState('')
  const [ceStatus, setCeStatus] = useState<EditableVoyagePodCeStatus>('waiting')
  const [linked, setLinked] = useState<'true' | 'false'>('false')
  const [saving, setSaving] = useState(false)

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // identidade do payload, durante o render (sem useEffect).
  const [prevSchedule, setPrevSchedule] = useState<typeof podSchedule>(null)
  if (open && podSchedule && podSchedule !== prevSchedule) {
    setPrevSchedule(podSchedule)
    setEta(podSchedule.eta ?? '')
    setEtb(podSchedule.etb ?? '')
    setAta(podSchedule.ata ?? '')
    setAtd(podSchedule.atd ?? '')
    setRtw(podSchedule.rtw === null ? '' : String(podSchedule.rtw))
    setCeStatus(getEditableVoyagePodCeStatus(podSchedule.ceStatus))
    setLinked(podSchedule.linked ? 'true' : 'false')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!podSchedule) return

    setSaving(true)
    try {
      await onSaved({
        voyageId: podSchedule.voyageId,
        pod: podSchedule.pod,
        eta: eta || null,
        etb: etb || null,
        ata: ata || null,
        atd: atd || null,
        rtw: rtw.trim() ? Number(rtw) : null,
        ceStatus,
        linked: linked === 'true',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Editar planejamento do POD">
      {podSchedule ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="app-panel app-panel--padded text-sm">
            <div className="font-semibold text-[var(--app-text-strong)]">{podSchedule.voyageLabel}</div>
            <div className="mt-1">POD: {podSchedule.pod}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="ETA">
              <Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} />
            </Field>
            <Field label="ETB">
              <Input type="date" value={etb} onChange={(event) => setEtb(event.target.value)} />
            </Field>
            <Field label="ATA">
              <Input type="date" value={ata} onChange={(event) => setAta(event.target.value)} />
            </Field>
            <Field label="ATD">
              <Input type="date" value={atd} onChange={(event) => setAtd(event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
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
            <Field label="ESCALA">
              <select className="app-input" value={linked} onChange={(event) => setLinked(event.target.value as 'true' | 'false')}>
                <option value="true">YES</option>
                <option value="false">NO</option>
              </select>
            </Field>
          </div>

          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} type="submit">
              Salvar datas
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}

export function AddPodToVoyageModal({
  open,
  voyage,
  onClose,
  onSaved,
}: {
  open: boolean
  voyage: { voyageId: number; voyageLabel: string } | null
  onClose: () => void
  onSaved: (payload: {
    voyageId: number
    pod: string
    eta: string | null
    etb: string | null
    ata: string | null
    atd: string | null
    rtw: number | null
    ceStatus: EditableVoyagePodCeStatus
    linked: boolean
  }) => Promise<void>
}) {
  const [pod, setPod] = useState('')
  const [eta, setEta] = useState('')
  const [etb, setEtb] = useState('')
  const [ata, setAta] = useState('')
  const [atd, setAtd] = useState('')
  const [rtw, setRtw] = useState('')
  const [ceStatus, setCeStatus] = useState<EditableVoyagePodCeStatus>('waiting')
  const [linked, setLinked] = useState<'true' | 'false'>('false')
  const [saving, setSaving] = useState(false)

  // Formulário sempre nasce vazio a cada abertura; re-baseia durante o
  // render quando `open` transiciona (sem useEffect).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setPod('')
      setEta('')
      setEtb('')
      setAta('')
      setAtd('')
      setRtw('')
      setCeStatus('waiting')
      setLinked('false')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!voyage) return
    const normalizedPod = pod.trim().toUpperCase()
    if (!normalizedPod) return
    setSaving(true)
    try {
      await onSaved({
        voyageId: voyage.voyageId,
        pod: normalizedPod,
        eta: eta || null,
        etb: etb || null,
        ata: ata || null,
        atd: atd || null,
        rtw: rtw.trim() ? Number(rtw) : null,
        ceStatus,
        linked: linked === 'true',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Adicionar POD ao planejamento">
      {voyage ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="app-panel app-panel--padded text-sm">
            <div className="font-semibold text-[var(--app-text-strong)]">{voyage.voyageLabel}</div>
            <div className="mt-1">Sugestoes: {POD_SUGGESTIONS.join(', ')}</div>
          </div>
          <Field label="POD">
            <Input list="pod-suggestions" value={pod} onChange={(event) => setPod(event.target.value.toUpperCase())} placeholder="Ex.: BRSSA" />
            <datalist id="pod-suggestions">
              {POD_SUGGESTIONS.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="ETA">
              <Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} />
            </Field>
            <Field label="ETB">
              <Input type="date" value={etb} onChange={(event) => setEtb(event.target.value)} />
            </Field>
            <Field label="ATA">
              <Input type="date" value={ata} onChange={(event) => setAta(event.target.value)} />
            </Field>
            <Field label="ATD">
              <Input type="date" value={atd} onChange={(event) => setAtd(event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
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
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="ESCALA">
              <select className="app-input" value={linked} onChange={(event) => setLinked(event.target.value as 'true' | 'false')}>
                <option value="true">YES</option>
                <option value="false">NO</option>
              </select>
            </Field>
          </div>
          <div className="app-modal__actions">
            <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
            <Button loading={saving} type="submit" disabled={!pod.trim()}>Adicionar POD</Button>
          </div>
        </form>
      ) : null}
    </Modal>
  )
}

export function ExportScheduleModal({
  open,
  exportData,
  onClose,
  onSaved,
}: {
  open: boolean
  exportData: {
    voyageId: number
    voyageLabel: string
    existing: VoyageExportSchedule | null
  } | null
  onClose: () => void
  onSaved: (payload: {
    voyageId: number
    pol: string | null
    hasGranite: boolean
    containersQty: number | null
    movementsQty: number | null
    eta: string | null
    etb: string | null
    ceStatus: ExportCeStatus | null
    linked: boolean
  }) => Promise<void>
}) {
  const [pol, setPol] = useState('')
  const [eta, setEta] = useState('')
  const [etb, setEtb] = useState('')
  const [hasGranite, setHasGranite] = useState(false)
  const [containersQty, setContainersQty] = useState('')
  const [movementsQty, setMovementsQty] = useState('')
  const [ceStatus, setCeStatus] = useState<ExportCeStatus>('waiting')
  const [linked, setLinked] = useState<'true' | 'false'>('false')
  const [saving, setSaving] = useState(false)

  // O pai cria um payload novo a cada abertura; re-baseia os campos por
  // identidade do payload, durante o render (sem useEffect).
  const [prevExportData, setPrevExportData] = useState<typeof exportData>(null)
  if (open && exportData && exportData !== prevExportData) {
    setPrevExportData(exportData)
    const existing = exportData.existing
    setPol(existing?.pol ?? '')
    setEta(existing?.eta ?? '')
    setEtb(existing?.etb ?? '')
    setHasGranite(existing?.hasGranite ?? false)
    setContainersQty(existing?.containersQty !== null && existing?.containersQty !== undefined ? String(existing.containersQty) : '')
    setMovementsQty(existing?.movementsQty !== null && existing?.movementsQty !== undefined ? String(existing.movementsQty) : '')
    setCeStatus(existing?.ceStatus ?? 'waiting')
    setLinked(existing?.linked ? 'true' : 'false')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!exportData) return
    setSaving(true)
    try {
      await onSaved({
        voyageId: exportData.voyageId,
        pol: pol.trim().toUpperCase() || null,
        hasGranite,
        containersQty: containersQty.trim() ? Number(containersQty) : null,
        movementsQty: movementsQty.trim() ? Number(movementsQty) : null,
        eta: eta || null,
        etb: etb || null,
        ceStatus,
        linked: linked === 'true',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Planejamento de Exportação">
      {exportData ? (
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="app-panel app-panel--padded text-sm">
            <div className="font-semibold text-[var(--app-text-strong)]">{exportData.voyageLabel}</div>
            <div className="app-panel__meta mt-1">Linha dedicada de exportação no Painel e TV</div>
          </div>

          <Field label="POL (Porto de Embarque)">
            <Input
              type="text"
              value={pol}
              onChange={(event) => setPol(event.target.value)}
              placeholder="Ex: BRVIX"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="ETA">
              <Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} />
            </Field>
            <Field label="ETB">
              <Input type="date" value={etb} onChange={(event) => setEtb(event.target.value)} />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--app-border)] p-3">
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

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="BLs e CEs">
              <select className="app-input" value={ceStatus} onChange={(event) => setCeStatus(event.target.value as ExportCeStatus)}>
                {POD_CE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ESCALA">
              <select className="app-input" value={linked} onChange={(event) => setLinked(event.target.value as 'true' | 'false')}>
                <option value="true">YES</option>
                <option value="false">NO</option>
              </select>
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
