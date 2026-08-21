// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ValidacaoOperationsTable } from '../ValidacaoOperationsTable'
import type { LocalChargeOperationalRow } from '../../../services/charges/chargeOperationsService'

afterEach(cleanup)

const row: LocalChargeOperationalRow = {
  id: 'BL-001',
  cargo_mode: 'container',
  pol: 'BRVIX',
  pod: 'BRSSA',
  charge_status: 'ready_for_billing',
  financial_status: 'pending',
  ce_mercante: null,
  review_status: 'reviewed',
  notes: null,
  customer_reconciliation_status: 'reconciled',
  customer_reconciliation_notes: null,
  billing_hold_reason: null,
  last_billing_run_id: null,
  charge_exemption_reason: null,
  charges_calculated_at: null,
  charges_reviewed_at: null,
  created_at: null,
  voyage: { id: 1, voyage_number: '001', vessel: { name: 'Navio' } },
  customer: { id: 1, name: 'Cliente', cnpj_cpf: null },
  totals: { total_brl: 100, total_usd: 0, line_count: 1, review_required_count: 0 },
  trail: { last_event_at: null, last_event_by: null, last_event_field: null, last_event_message: null },
}

function renderTable(overrides: Partial<React.ComponentProps<typeof ValidacaoOperationsTable>> = {}) {
  const callbacks = {
    onToggleAllRows: vi.fn(),
    onToggleRow: vi.fn(),
    onToggleExpandedRow: vi.fn(),
    onIssueSingleInvoice: vi.fn(),
    onApproveQueueItem: vi.fn(),
    onRejectQueueItem: vi.fn(),
  }

  render(
    <MemoryRouter>
      <ValidacaoOperationsTable
        rows={[row]}
        isLoading={false}
        hasError={false}
        selectedRowIds={[]}
        areAllRowsSelected={false}
        expandedBlId={null}
        reconciliationQueue={[]}
        approvePending={false}
        rejectPending={false}
        {...callbacks}
        {...overrides}
      />
    </MemoryRouter>,
  )

  return callbacks
}

describe('ValidacaoOperationsTable', () => {
  it('não oferece emissão para Granito mesmo com CE e preserva o estado operacional', () => {
    renderTable({ rows: [{ ...row, id: 'GR-READY', cargo_mode: 'granito', ce_mercante: '122605051526081' }] })
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull()
    expect(screen.getByText('Pronto para emitir')).toBeTruthy()
    cleanup()

    renderTable({ rows: [{ ...row, id: 'GR-WAIT', cargo_mode: 'granito', ce_mercante: null }] })
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull()
    expect(screen.getByText('Aguardando CE Mercante')).toBeTruthy()
  })

  it('delega a emissão individual com a linha selecionada', async () => {
    const user = userEvent.setup()
    const { onIssueSingleInvoice } = renderTable()

    await user.click(screen.getByRole('button', { name: 'Emitir' }))

    expect(onIssueSingleInvoice).toHaveBeenCalledWith(row)
  })

  it('delega a seleção e a expansão do B/L', async () => {
    const user = userEvent.setup()
    const { onToggleRow, onToggleExpandedRow } = renderTable()

    await user.click(screen.getByRole('button', { name: 'Selecionar B/L BL-001' }))
    await user.click(screen.getByRole('button', { name: 'Expandir detalhes' }))

    expect(onToggleRow).toHaveBeenCalledWith('BL-001')
    expect(onToggleExpandedRow).toHaveBeenCalledWith('BL-001')
  })

  it('delega a aprovação da reconciliação com os IDs da fila', async () => {
    const user = userEvent.setup()
    const { onApproveQueueItem } = renderTable({
      rows: [{ ...row, customer_reconciliation_status: 'pending' }],
      expandedBlId: 'BL-001',
      reconciliationQueue: [{
        id: 42,
        bl_id: 'BL-001',
        customer_id: 7,
        current_customer_name: 'Cliente sugerido',
        cnpj_cpf: '00.000.000/0001-00',
        manifest_customer_name: 'Cliente manifesto',
        detection_type: 'document',
      }],
    })

    await user.click(screen.getByRole('button', { name: 'Aprovar' }))

    expect(onApproveQueueItem).toHaveBeenCalledWith(42, 7)
  })
})
