// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { Painel } from '../Painel'

const { showToast, writeFileMock } = vi.hoisted(() => ({
  showToast: vi.fn(),
  writeFileMock: vi.fn(),
}))

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@e965/xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: writeFileMock,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'dashboard') {
      return { data: {}, isLoading: false, error: null }
    }
    return {
      data: {
        rows: [{
          id: '1::SSZ',
          voyageId: 1,
          voyageNumber: 'V1',
          voyageStatus: 'active',
          vesselName: 'Navio',
          pod: 'SSZ',
          eta: null,
          etb: null,
          rowType: 'import',
          vin: 0,
          car: 0,
          cg: 1,
          total: 1,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          atd: null,
          ceStatus: 'missing',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
        }],
        lastChangedAt: '2026-06-23T00:00:00Z',
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
  },
}))

beforeEach(() => {
  showToast.mockReset()
  writeFileMock.mockReset()
})

it('informa falha e encerra loading quando a exportacao do Line-Up falha', async () => {
  writeFileMock.mockImplementation(() => {
    throw new Error('disk full')
  })

  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }))

  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Falha ao exportar o Line Up.', 'error'))
  expect(screen.getByRole('button', { name: 'Exportar Excel' }).hasAttribute('disabled')).toBe(false)
})
