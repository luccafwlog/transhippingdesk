import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import {
  generateEdiMercante,
  type MercanteBlData,
  type MercanteManifestData,
} from '../../services/mercanteEdiGenerator'
import { downloadEdiMercante } from '../../services/mercanteEdiDownload'
import { extractNcmCodes } from '../../lib/ncm'
type VoyageBl = {
  id: string
  shipper?: string | null
  consignee?: string | null
  pol?: string | null
  pod?: string | null
  cargo_description?: string | null
  total_weight_kg?: number | null
  total_cbm?: number | null
  manifest_customer_cnpj_cpf?: string | null
  manifest_customer_name?: string | null
  bl_containers?: Array<{
    container_number: string
    seal_number?: string | null
    type?: string | null
    tare_weight_kg?: number | null
    gross_weight_kg?: number | null
    cbm?: number | null
    is_imo?: boolean | null
    imo_class?: string | null
    un_number?: string | null
  }> | null
  bl_breakbulk_items?: Array<{
    gross_weight_kg?: number | null
    cbm?: number | null
  }> | null
}

type ModalVoyage = {
  voyage_number: string
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
      const blData: MercanteBlData[] = bls.map((bl) => ({
        blNumber: bl.id,
        consigneeCnpjCpf: bl.manifest_customer_cnpj_cpf ?? '',
        consigneeName: bl.manifest_customer_name ?? bl.consignee ?? '',
        consigneeAddress: '',
        shipperName: bl.shipper ?? '',
        shipperAddress: '',
        cargoDescription: bl.cargo_description ?? '',
        totalPackages: 0,
        totalWeightKg: bl.total_weight_kg ?? 0,
        totalCbm: bl.total_cbm ?? 0,
        containers: (bl.bl_containers ?? []).map((c) => ({
          containerNumber: c.container_number,
          sealNumber: c.seal_number ?? '',
          containerType: c.type ?? '',
          tareWeightKg: c.tare_weight_kg ?? 0,
          grossWeightKg: c.gross_weight_kg ?? 0,
          totalCbm: c.cbm ?? 0,
          ncmCodes: extractNcmCodes(bl.cargo_description ?? ''),
          isImo: c.is_imo ?? false,
          imoClass: c.imo_class ?? '',
          unNumber: c.un_number ?? '',
        })),
      }))

      const manifestData: MercanteManifestData = {
        shippingCompanyCode: shippingCompany || vessel?.carrier?.scac || '',
        agencyCnpj,
        voyageNumber: voyage.voyage_number,
        vesselImo: vessel?.imo ?? '',
        polLocode: polCode,
        podLocode: podCode,
        terminalCode: terminal,
        operationDate: emissionDate,
        closingDate: emissionDate,
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
