import { describe, expect, it } from 'vitest'
import {
  emailChangeAlertTemplate,
  emailChangeConfirmTemplate,
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
    ]) {
      expect(html).toContain(`mailto:${supportEmail}`)
    }
  })
})
