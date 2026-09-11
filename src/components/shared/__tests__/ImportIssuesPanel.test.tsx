// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ImportIssuesPanel } from '../ImportIssuesPanel'

it('renderiza o relatório inteiro e a ação de exportação', () => {
  const issues = Array.from({ length: 25 }, (_, index) => ({
    row: index + 2,
    field: 'row',
    code: 'invalid_group' as const,
    severity: 'error' as const,
    message: `Erro da linha ${index + 2}`,
  }))

  render(<ImportIssuesPanel issues={issues} filename="veiculos-issues.csv" />)

  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Baixar relatório completo' })).toBeTruthy()
  expect(screen.getByText('Erro da linha 2')).toBeTruthy()
  expect(screen.getByText('Erro da linha 26')).toBeTruthy()
})
