// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AgencyReportDocument } from '../AgencyReportDocument'

it('imprime o snapshot fechado nos blocos e matrizes do modelo real', () => {
  render(<AgencyReportDocument snapshot={{
    header: {
      carrierName: 'Armador teste',
      voyageLabel: 'NAVIO TESTE / 01E',
      port: 'BRVIX',
      terminal: 'TVV',
      schedule: { ata: '2026-07-19', atb: '2026-07-19', atd: '2026-07-20', rtw: 2 },
    },
    sections: {
      cargaSolta: { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 },
      granito: { bls: 2, blocks: 14, weightTon: 35.5 },
      cargaDescarregada: { rows: { '40HC': { carga_geral: 3, imo: 1 } }, totals: { carga_geral: 3, imo: 1 } },
      vaziosDescarregados: { rows: { '20DC': { vazio_cama: 2 } }, totals: { vazio_cama: 2 } },
      veiculos: [{ brand: 'BYD', blCount: 2, vinCount: 3 }],
      vehicleLocations: { BYD: ['Pátio Alfa'] },
      vaziosEmbarcados: { rows: { '40HC': { carga_geral: 4 } }, totals: { carga_geral: 4 } },
      directEmbarkCount: 1,
      depots: ['VBR'],
      operation: { os_number: 'OS-42', reorg: [{ id: 'reorg-1', service: 'bundle', container_type: '40HC', qty: 2 }], overtime: [{ id: 'ot-1', depot: 'VBR', percent: 25 }] },
      storage: { containers: 4, days: 8 },
    },
    occurrences: [{ id: 'occ-1', body: 'Atracação concluída.', department: 'operacoes', created_at: '2026-07-20' }],
  }} />)

  for (const heading of [
    'Carga solta', 'Granito', 'Matriz de descarga', 'Vazios descarregados',
    'Container com veículo', 'Embarque de vazios', 'Serviço extra', 'Storage', 'Overtime', 'Ocorrências',
  ]) expect(screen.getByRole('heading', { name: heading })).toBeTruthy()

  expect(screen.getByRole('table', { name: 'Matriz de descarga' })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Vazios descarregados' })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Embarque de vazios' })).toBeTruthy()
  expect(screen.getByText('Pátio Alfa')).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Operação de vazios' }).textContent).toContain('OS-42')
  expect(screen.getByRole('table', { name: 'Operação de vazios' }).textContent).toContain('Embarque direto1')
  expect(screen.getByText('35,5 ton')).toBeTruthy()
  expect(screen.getByText('ATB')).toBeTruthy()
  expect(screen.getByText('Restow')).toBeTruthy()
})
