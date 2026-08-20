import { CustomerSummaryReport } from './CustomerSummaryReport'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import type { CustomerDemurrageSummary } from '../../services/demurrage/demurrageKpis'

type Props = {
  open: boolean
  rows: CustomerDemurrageSummary[]
  onClose: () => void
}

export function CustomerReportModal({ open, rows, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Demurrage em aberto por consignatário">
      <div className="customer-report-print-content p-2">
        <div className="print-hidden mb-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => window.print()}>Imprimir</Button>
        </div>
        <CustomerSummaryReport rows={rows} />
      </div>
    </Modal>
  )
}
