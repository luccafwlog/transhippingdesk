import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { ValidacaoOperationsTable } from '../ValidacaoOperationsTable'

it('preserva a linha pronta para faturar e seus controles acessíveis', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(ValidacaoOperationsTable, {
        rows: [
          {
            id: 'BL-001',
            cargo_mode: 'container',
            pol: 'BRVIX',
            pod: 'BRSSA',
            charge_status: 'ready_for_billing',
            financial_status: 'pending',
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
          },
        ],
        isLoading: false,
        hasError: false,
        selectedRowIds: [],
        areAllRowsSelected: false,
        expandedBlId: null,
        reconciliationQueue: [],
        approvePending: false,
        rejectPending: false,
        onToggleAllRows: vi.fn(),
        onToggleRow: vi.fn(),
        onToggleExpandedRow: vi.fn(),
        onIssueSingleInvoice: vi.fn(),
        onApproveQueueItem: vi.fn(),
        onRejectQueueItem: vi.fn(),
      }),
    ),
  )

  expect(html).toContain('BL-001')
  expect(html).toContain('Emitir')
  expect(html).toContain('aria-label="Selecionar B/L BL-001"')
  expect(html).toContain('aria-label="Expandir detalhes"')
})
