// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  partition: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/ceMercanteImport', () => ({
  parseCeMercanteFile: mocks.parse,
  partitionRowsByVoyage: mocks.partition,
  importCeMercanteRows: vi.fn(),
  importCeMercanteEdi: vi.fn(),
}))
vi.mock('../../../services/ceMercanteEdiParser', () => ({ parseCeMercanteEdiFile: vi.fn() }))

import { CeMercanteImportModal } from '../CeMercanteImportModal'

afterEach(cleanup)

it('exclui do preview o BL de outra viagem e mostra erro bloqueante', async () => {
  const row = { rowNumber: 2, bl_id: 'BL-OUTRA', ce_mercante: '122605051526081' }
  mocks.parse.mockResolvedValue({ rows: [row], rowErrors: [] })
  mocks.partition.mockResolvedValue({
    rows: [],
    blocked: [{ row: 2, bl_id: 'BL-OUTRA', message: 'B/L BL-OUTRA pertence a outra viagem' }],
  })
  const { container } = render(<CeMercanteImportModal open lockedVoyageId={7} onClose={vi.fn()} />)

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['x'], 'ce.xlsx')] },
  })

  await waitFor(() => expect(mocks.partition).toHaveBeenCalledWith([row], 7))
  expect(screen.getByText('Linha 2: B/L BL-OUTRA pertence a outra viagem')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Confirmar importação' }) as HTMLButtonElement).disabled).toBe(true)
})
