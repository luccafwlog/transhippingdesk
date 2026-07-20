// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AgencyReportDocument } from '../AgencyReportDocument'

it('imprime a carga solta congelada sob a chave cargaSolta', () => {
  render(<AgencyReportDocument snapshot={{
    sections: { cargaSolta: { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 } },
  }} />)

  const heading = screen.getByText('Carga solta')
  expect(heading).toBeTruthy()
  expect(screen.getByText(/machines: 3/)).toBeTruthy()
  expect(heading.closest('section')?.textContent).not.toContain('—')
})
