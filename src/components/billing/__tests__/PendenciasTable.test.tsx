// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PendenciasTable } from '../PendenciasTable'
import type { LocalChargeOperationalRow } from '../../../services/charges/chargeOperationsService'

afterEach(cleanup)

function makeRows(count: number): LocalChargeOperationalRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `CSC${String(i + 1).padStart(6, '0')}`,
    cargo_mode: 'container',
    pod: 'SSZ',
    customer: { name: `Cliente ${i + 1}`, cnpj_cpf: '00.000.000/0001-00' },
    voyage: { voyage_number: `V${i + 1}`, vessel: { name: 'NAVIO' } },
    trail: { last_event_message: 'Revisão requerida' },
    billing_hold_reason: null,
  })) as unknown as LocalChargeOperationalRow[]
}

function renderTable(rows: LocalChargeOperationalRow[]) {
  return render(
    <MemoryRouter>
      <PendenciasTable rows={rows} />
    </MemoryRouter>,
  )
}

describe('PendenciasTable', () => {
  it('renderiza os cabeçalhos e o conteúdo das linhas', () => {
    renderTable(makeRows(2))
    for (const header of ['B/L', 'Cliente', 'Modo/POD', 'Viagem', 'Motivo', 'Acesso']) {
      expect(screen.getByText(header)).toBeTruthy()
    }
    expect(screen.getByText('CSC000001')).toBeTruthy()
    expect(screen.getByText('Cliente 1')).toBeTruthy()
    // link para o B/L
    const links = screen.getAllByRole('link', { name: 'Ver B/L' })
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe('/manifestos/CSC000001')
  })

  it('não mostra "Mostrar mais" quando há até 100 linhas', () => {
    renderTable(makeRows(100))
    expect(screen.queryByRole('button', { name: /Mostrar mais/i })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Ver B/L' })).toHaveLength(100)
  })

  it('renderiza apenas o lote inicial (100) e revela mais sob demanda', async () => {
    const user = userEvent.setup()
    renderTable(makeRows(250))

    // Inicialmente 100 linhas e botão com 150 restantes
    expect(screen.getAllByRole('link', { name: 'Ver B/L' })).toHaveLength(100)
    const more = screen.getByRole('button', { name: /Mostrar mais \(150 restantes\)/i })
    expect(more).toBeTruthy()

    await user.click(more)
    expect(screen.getAllByRole('link', { name: 'Ver B/L' })).toHaveLength(200)

    // Mais um clique cobre as 250
    await user.click(screen.getByRole('button', { name: /Mostrar mais \(50 restantes\)/i }))
    expect(screen.getAllByRole('link', { name: 'Ver B/L' })).toHaveLength(250)
    expect(screen.queryByRole('button', { name: /Mostrar mais/i })).toBeNull()
  })

  it('usa fallbacks quando campos opcionais estão ausentes', () => {
    const rows = [
      {
        id: 'CSC000099',
        cargo_mode: null,
        pod: null,
        customer: null,
        voyage: null,
        trail: { last_event_message: null },
        billing_hold_reason: null,
      },
    ] as unknown as LocalChargeOperationalRow[]
    renderTable(rows)
    const row = screen.getByText('CSC000099').closest('tr')!
    expect(within(row).getByText('Revisão requerida')).toBeTruthy()
    expect(within(row).getByText('Navio / -')).toBeTruthy()
  })
})
