import { describe, expect, it } from 'vitest'
import {
  dailyDigestTemplate,
  emailChangeAlertTemplate,
  emailChangeConfirmTemplate,
  invoiceCriticalPendencyTemplate,
  invoiceIssuedTemplate,
  inviteTemplate,
  recoveryTemplate,
  resendTemplate,
} from '../../../supabase/functions/_shared/portalEmailTemplates.ts'

const portalUrl = 'https://portal.transhippingdesk.com.br'
const supportEmail = 'suporte@transhippingdesk.com.br'

describe('Identidade visual dos emails do Portal', () => {
  it('inclui a logo real da Transhipping, hospedada a partir do PORTAL_URL', () => {
    const { html } = inviteTemplate({ companyName: 'ACME LTDA', cnpjMasked: '12.***.***/0001-90', activationUrl: 'https://x/ativar', portalUrl, supportEmail })
    expect(html).toContain(`<img src="${portalUrl}/branding/tr-logo.png"`)
  })

  it('mostra um quadro de identificação com empresa e CNPJ mascarado quando fornecido', () => {
    const { html } = inviteTemplate({ companyName: 'ACME LTDA', cnpjMasked: '12.***.***/0001-90', activationUrl: 'https://x/ativar', portalUrl, supportEmail })
    expect(html).toContain('ACME LTDA')
    expect(html).toContain('12.***.***/0001-90')
  })

  it('escapa HTML no nome da empresa (evita injeção via razão social)', () => {
    const { html } = inviteTemplate({ companyName: '<script>alert(1)</script>', cnpjMasked: '12.***.***/0001-90', activationUrl: 'https://x/ativar', portalUrl, supportEmail })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('inclui botão de ação com a URL correta em convite, reenvio e recuperação', () => {
    const invite = inviteTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x/ativar?token=abc', portalUrl, supportEmail })
    expect(invite.html).toContain('https://x/ativar?token=abc')
    const resend = resendTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x/ativar?token=def', portalUrl, supportEmail })
    expect(resend.html).toContain('https://x/ativar?token=def')
    const recovery = recoveryTemplate({ companyName: 'ACME', cnpjMasked: '***', recoveryUrl: 'https://x/recuperar?token=ghi', portalUrl, supportEmail })
    expect(recovery.html).toContain('https://x/recuperar?token=ghi')
  })

  it('template de confirmação de troca de email não expõe quadro de identidade (sem CNPJ nesse contexto)', () => {
    const { html } = emailChangeConfirmTemplate({ companyName: 'ACME LTDA', confirmUrl: 'https://x/confirmar', portalUrl, supportEmail })
    expect(html).toContain('https://x/confirmar')
    expect(html).toContain('ACME LTDA')
  })

  it('template de alerta de troca de email não tem botão de ação nem dado sensível', () => {
    const { html, text } = emailChangeAlertTemplate({ portalUrl, supportEmail })
    expect(html).not.toContain('background:#152238;color:#ffffff')
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('todos os templates referenciam o mesmo email de suporte no rodapé', () => {
    for (const { html } of [
      inviteTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x', portalUrl, supportEmail }),
      resendTemplate({ companyName: 'ACME', cnpjMasked: '***', activationUrl: 'https://x', portalUrl, supportEmail }),
      recoveryTemplate({ companyName: 'ACME', cnpjMasked: '***', recoveryUrl: 'https://x', portalUrl, supportEmail }),
      emailChangeConfirmTemplate({ companyName: 'ACME', confirmUrl: 'https://x', portalUrl, supportEmail }),
      emailChangeAlertTemplate({ portalUrl, supportEmail }),
      invoiceIssuedTemplate({ companyName: 'ACME', cnpjMasked: '***', invoiceNumber: 'INV-1', totalFormatted: 'R$ 1,00', dueDateFormatted: '01/01/2026', portalUrl, supportEmail }),
      invoiceCriticalPendencyTemplate({ companyName: 'ACME', cnpjMasked: '***', invoiceNumber: 'INV-1', consoleUrl: 'https://x', portalUrl, supportEmail }),
      dailyDigestTemplate({ date: '2026-01-01', failures: 0, activity: 0, pending: 0, portalUrl, supportEmail }),
    ]) {
      expect(html).toContain(`mailto:${supportEmail}`)
    }
  })

  it('template de fatura emitida mostra a tabela de valores e destaca o total', () => {
    const { html, text } = invoiceIssuedTemplate({ companyName: 'ACME LTDA', cnpjMasked: '12.***.***/0001-90', invoiceNumber: 'INV-42', totalFormatted: 'R$ 4.250,00', dueDateFormatted: '30/07/2026', notes: 'Referente ao BL-1', portalUrl, supportEmail })
    expect(html).toContain('INV-42')
    expect(html).toContain('R$ 4.250,00')
    expect(html).toContain('30/07/2026')
    expect(html).toContain('Referente ao BL-1')
    expect(html).toContain(portalUrl)
    expect(text).toContain('R$ 4.250,00')
  })

  it('template de fatura emitida omite a linha de observações quando não há notas', () => {
    const { html } = invoiceIssuedTemplate({ companyName: 'ACME LTDA', cnpjMasked: '***', invoiceNumber: 'INV-42', totalFormatted: 'R$ 1,00', dueDateFormatted: '01/01/2026', portalUrl, supportEmail })
    expect(html).not.toContain('Observações')
  })

  it('template de pendência crítica escapa nome da empresa e leva ao console correto', () => {
    const { html } = invoiceCriticalPendencyTemplate({ companyName: '<b>ACME</b>', cnpjMasked: '***', invoiceNumber: 'INV-9', consoleUrl: 'https://transhippingdesk.com.br/clientes/portal?cliente=1', portalUrl, supportEmail })
    expect(html).not.toContain('<b>ACME</b>')
    expect(html).toContain('https://transhippingdesk.com.br/clientes/portal?cliente=1')
  })

  it('resumo diário lista as três contagens e não tem quadro de identidade', () => {
    const { html, text } = dailyDigestTemplate({ date: '2026-07-15', failures: 2, activity: 14, pending: 5, portalUrl, supportEmail })
    expect(html).toContain('Falhas/supressões: 2')
    expect(html).toContain('Atividade de provisionamento: 14')
    expect(html).toContain('Convites pendentes: 5')
    expect(html).not.toContain('CNPJ')
    expect(text).toContain('Resumo do Portal — 2026-07-15')
  })
})
