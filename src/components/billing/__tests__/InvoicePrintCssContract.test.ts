import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

describe('contrato CSS de impressão de invoice', () => {
  it('preserva o ancestral da página que contém o modal de impressão', () => {
    const css = fs.readFileSync('src/index.css', 'utf8')
    expect(css).toContain('.app-main > *:not(:has(.app-modal-backdrop))')
    expect(css).toContain('.app-main > *:has(.app-modal-backdrop)')
  })

  it('isola tambem o relatorio de Demurrage por consignatario', () => {
    const css = fs.readFileSync('src/index.css', 'utf8')
    expect(css).toContain(':not(.customer-report-print-content)')
    expect(css).toMatch(/\.invoice-print-content,\s*\.agency-report-print-content,\s*\.customer-report-print-content/)
  })
})
