import { describe, expect, it } from 'vitest'
import {
  formatCommunicationDateTime,
  renderInstitutionalTemplate,
  renderNoaTemplate,
  renderNobTemplate,
  renderNorTemplate,
  validateCommunicationAttachments,
  type CustomerCommunicationTemplateInput,
} from '../customerCommunicationTemplates'

function input(overrides: Partial<CustomerCommunicationTemplateInput> = {}): CustomerCommunicationTemplateInput {
  return {
    customerId: 10,
    customerName: 'Cliente <Importador>',
    vesselName: 'Navio <A>',
    voyageNumber: 'V001',
    port: 'BRSSZ',
    terminalName: 'Terminal Leste',
    terminalId: 'terminal-1',
    milestoneAt: '2026-09-01T15:00:00Z',
    bls: [{ id: 'BL-10', customerId: 10, terminalId: 'terminal-1' }],
    ...overrides,
  }
}

describe('templates de Comunicados', () => {
  it('formata timestamps no horário de Brasília', () => {
    expect(formatCommunicationDateTime('2026-09-01T15:00:00Z'))
      .toBe('01/09/2026 às 12:00 (horário de Brasília)')
  })

  it('renderiza NOA em português, com assunto bilíngue e escape por cliente', () => {
    const rendered = renderNoaTemplate(input())

    expect(rendered.subject).toContain('Notice of Arrival / Aviso de Chegada')
    expect(rendered.text).toContain('01/09/2026 às 12:00 (horário de Brasília)')
    expect(rendered.html).toContain('Cliente &lt;Importador&gt;')
    expect(rendered.html).toContain('BL-10')
    expect(rendered.html).not.toContain('BL-11')
  })

  it('mantém ATA no NOR e ATB/terminal no NOB', () => {
    const nor = renderNorTemplate(input({ milestoneAt: '2026-09-02T16:30:00Z' }))
    const nob = renderNobTemplate(input({ milestoneAt: '2026-09-03T17:45:00Z' }))

    expect(nor.subject).toContain('Notice of Readiness / Prontidão de Descarga')
    expect(nor.text).toContain('02/09/2026 às 13:30 (horário de Brasília)')
    expect(nob.subject).toContain('Notice of Berthing / Aviso de Atracação')
    expect(nob.subject).toContain('BRSSZ (Terminal Leste)')
    expect(nob.text).toContain('03/09/2026 às 14:45 (horário de Brasília)')
  })

  it('recusa mistura de terminais no NOB', () => {
    expect(() => renderNobTemplate(input({
      bls: [
        { id: 'BL-10', customerId: 10, terminalId: 'terminal-1' },
        { id: 'BL-11', customerId: 10, terminalId: 'terminal-2' },
      ],
    }))).toThrow('outro terminal')
  })

  it('usa a UUID da linha do terminal para isolar o NOB', () => {
    expect(() => renderNobTemplate(input({
      terminalStateId: 'state-1',
      bls: [{ id: 'BL-10', customerId: 10, terminalId: 'terminal-1', terminalStateId: 'state-2' }],
    }))).toThrow('outro terminal')
  })

  it('não aceita B/L em comunicado institucional', () => {
    expect(() => renderInstitutionalTemplate(input({ subject: 'Aviso', body: 'Mensagem' })))
      .toThrow('não pode conter B/Ls')
  })
})

describe('validação de anexos de Comunicados', () => {
  const pdf = (size: number) => ({
    filename: `arquivo-${size}.pdf`,
    contentType: 'application/pdf',
    size,
  })

  it('aceita NOA/NOR/NOB e institucional, mas limita a três arquivos e 10 MB', () => {
    expect(validateCommunicationAttachments('aviso_chegada_noa', [pdf(1)])).toMatchObject({ valid: true, totalBytes: 1 })
    expect(validateCommunicationAttachments('institucional', [pdf(1)])).toMatchObject({ valid: true, totalBytes: 1 })
    expect(validateCommunicationAttachments('aviso_prontidao_nor', [pdf(1), pdf(1), pdf(1), pdf(1)]).valid).toBe(false)
    expect(validateCommunicationAttachments('aviso_atracacao_nob', [pdf(10 * 1024 * 1024), pdf(1)]).valid).toBe(false)
  })

  it('proíbe anexos por kind em cobrança local e demurrage', () => {
    expect(validateCommunicationAttachments('ce_mercante_taxas', [pdf(1)]).errors.join(' ')).toContain('cobrança local')
    expect(validateCommunicationAttachments('cobranca_demurrage', [pdf(1)]).errors.join(' ')).toContain('demurrage')
  })

  it('recusa tipos MIME não permitidos', () => {
    const result = validateCommunicationAttachments('livre', [{ filename: 'arquivo.zip', contentType: 'application/zip', size: 10 }])
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('Tipo não permitido')
  })
})
