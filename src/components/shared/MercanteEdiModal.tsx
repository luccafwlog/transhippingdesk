import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import {
  blToMercanteBlData,
  generateEdiMercante,
  type MercanteBlData,
  type MercanteBlSource,
  type MercanteManifestData,
} from '../../services/mercanteEdiGenerator'
import { downloadEdiMercante } from '../../services/mercanteEdiDownload'
import { portNameToUf } from '../../services/mercanteEdiGenerator'
import type { BLContainer, BlFreightLine } from '../../types/database'
type VoyageBl = {
  id: string
  shipper?: string | null
  consignee?: string | null
  notify_party?: string | null
  consignee_block?: string | null
  consignee_address?: string | null
  consignee_phone?: string | null
  shipper_block?: string | null
  notify_cnpj_cpf?: string | null
  notify_block?: string | null
  notify2_block?: string | null
  total_packages?: number | null
  packages_unit?: string | null
  pol?: string | null
  pod?: string | null
  payment_type?: string | null
  cargo_description?: string | null
  total_weight_kg?: number | null
  total_cbm?: number | null
  manifest_customer_cnpj_cpf?: string | null
  manifest_customer_name?: string | null
  bl_containers?: Array<{
    id?: number
    bl_id?: string | null
    container_number: string
    seal_number?: string | null
    type?: string | null
    tare_weight_kg?: number | null
    gross_weight_kg?: number | null
    cbm?: number | null
    is_imo?: boolean | null
    imo_class?: string | null
    un_number?: string | null
    discharge_date?: string | null
    return_date?: string | null
    demurrage_status?: 'within_free_time' | 'overdue' | 'returned' | null
    created_at?: string | null
  }> | null
  bl_freight_lines?: BlFreightLine[] | null
  bl_breakbulk_items?: Array<{
    gross_weight_kg?: number | null
    cbm?: number | null
  }> | null
}

type ModalVoyage = {
  voyage_number: string
  etd?: string | null
  eta?: string | null
  vessel?: {
    name?: string | null
    imo?: string | null
    carrier?: { scac?: string | null } | null
  } | null
  pol?: { locode?: string | null; name?: string | null } | null
  pod?: { locode?: string | null; name?: string | null } | null
}

type MercanteEdiModalProps = {
  open: boolean
  onClose: () => void
  voyage: ModalVoyage
  bls: VoyageBl[]
  prefilledPol?: string
  prefilledPod?: string
}

function isLocode(value: string | null | undefined): value is string {
  return /^[A-Z]{2}[A-Z0-9]{3}$/.test((value ?? '').trim().toUpperCase())
}

export function MercanteEdiModal({
  open,
  onClose,
  voyage,
  bls,
  prefilledPol,
  prefilledPod,
}: MercanteEdiModalProps) {
  const { showToast } = useToast()
  const [shippingCompany, setShippingCompany] = useState('CN001321')
  const [agencyCnpj, setAgencyCnpj] = useState('06352972000121')
  const [terminal, setTerminal] = useState('')
  const [emissionDate, setEmissionDate] = useState(new Date().toISOString().slice(0, 10))
  const [generating, setGenerating] = useState(false)

  const vessel = voyage.vessel
  const polCode = prefilledPol ?? voyage.pol?.locode ?? ''
  const podCode = prefilledPod ?? voyage.pod?.locode ?? ''
  const polName = voyage.pol?.name ?? polCode
  const podName = voyage.pod?.name ?? podCode

  function resetState() {
    setShippingCompany('CN001321')
    setAgencyCnpj('06352972000121')
    setTerminal('')
    setEmissionDate(new Date().toISOString().slice(0, 10))
  }

  function handleClose() {
    resetState()
    onClose()
  }

  function handleGenerate() {
    if (!bls.length) {
      showToast('Nenhum B/L encontrado para gerar o EDI.', 'error')
      return
    }

    setGenerating(true)
    try {
      const blData: MercanteBlData[] = bls.map((bl) => {
        const containers = bl.bl_containers ?? []
        const data = blToMercanteBlData(bl as unknown as MercanteBlSource, containers as BLContainer[])
        const resolvedPol = isLocode(bl.pol) ? bl.pol : polCode
        const resolvedPod = isLocode(bl.pod) ? bl.pod : podCode
        data.polLocode = resolvedPol
        data.podLocode = resolvedPod
        data.countryOfOrigin = resolvedPol.slice(0, 2)
        data.destinationUf = portNameToUf(bl.pod ?? '') || portNameToUf(podName)
        data.terminalCode = terminal
        return data
      })

      const manifestData: MercanteManifestData = {
        shippingCompanyCode: shippingCompany || vessel?.carrier?.scac || '',
        agencyCnpj,
        voyageNumber: voyage.voyage_number,
        vesselImo: vessel?.imo ?? '',
        polLocode: polCode,
        podLocode: podCode,
        terminalCode: terminal,
        emissionDate,
        operationDate: voyage.eta || emissionDate,
        closingDate: voyage.etd || emissionDate,
        bls: blData,
      }

      const edi = generateEdiMercante(manifestData)
      const filename = `MERCANTE_M5_${voyage.voyage_number ?? polCode ?? 'SINDICATO'}_${polCode}_${podCode}`
      downloadEdiMercante(edi, filename)
      showToast(`EDI Mercante gerado com ${bls.length} B/L(s).`, 'success')
      handleClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao gerar EDI Mercante.'
      showToast(message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Gerar EDI Mercante">
      <div className="grid gap-5">
        <div className="app-panel app-panel--padded text-sm">
          <div className="app-panel__title">Dados da viagem</div>
          <div className="mt-2 grid gap-2 grid-cols-2">
            <div>
              <span className="text-[var(--app-muted)]">Navio:</span>{' '}
              <span className="font-semibold text-[var(--app-text-strong)]">{vessel?.name ?? '-'}</span>
            </div>
            <div>
              <span className="text-[var(--app-muted)]">Viagem:</span>{' '}
              <span className="font-semibold text-[var(--app-text-strong)]">{voyage.voyage_number}</span>
            </div>
            <div>
              <span className="text-[var(--app-muted)]">POL:</span>{' '}
              <span className="font-semibold text-[var(--app-text-strong)]">{polName} ({polCode})</span>
            </div>
            <div>
              <span className="text-[var(--app-muted)]">POD:</span>{' '}
              <span className="font-semibold text-[var(--app-text-strong)]">{podName} ({podCode})</span>
            </div>
          </div>
          <div className="mt-2 text-[var(--app-muted)]">
            {bls.length} B/L(s) incluido(s) neste manifesto.
          </div>
        </div>

        <div className="grid gap-4">
          <Field label="Empresa de Navegação (opcional)">
            <Input
              placeholder="Código da empresa (ex: CN01321)"
              value={shippingCompany}
              onChange={(e) => setShippingCompany(e.target.value)}
            />
          </Field>

          <Field label="Agência de Navegação (opcional)">
            <Input
              placeholder={vessel?.carrier?.scac ? `CNPJ do armador` : 'CNPJ da agência (ex: 06352972000121)'}
              value={agencyCnpj}
              onChange={(e) => setAgencyCnpj(e.target.value)}
            />
          </Field>

          <Field label="Terminal de Descarregamento (opcional)">
            <Input
              placeholder="Código do terminal (ex: BRVIX004)"
              value={terminal}
              onChange={(e) => setTerminal(e.target.value)}
            />
          </Field>

          <Field label="Data de Emissão">
            <Input
              type="date"
              value={emissionDate}
              onChange={(e) => setEmissionDate(e.target.value)}
            />
          </Field>
        </div>

        <div className="app-modal__actions">
          <Button variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button disabled={!bls.length} loading={generating} onClick={handleGenerate}>
            <Download size={16} />
            Gerar EDI
          </Button>
        </div>
      </div>
    </Modal>
  )
}
