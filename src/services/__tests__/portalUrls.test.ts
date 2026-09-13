import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PORTAL_SUPPORT_EMAIL,
  DEFAULT_PORTAL_URL,
  canonicalPortalUrl,
  portalSupportEmail,
} from '../../../supabase/functions/_shared/portalUrls.ts'

describe('canonicalPortalUrl', () => {
  it('usa DEFAULT_PORTAL_URL e monta caminhos limpos quando PORTAL_URL não está definida', () => {
    expect(canonicalPortalUrl()).toBe(`${DEFAULT_PORTAL_URL}/portal`)
    expect(canonicalPortalUrl('ativar?token=xyz')).toBe(`${DEFAULT_PORTAL_URL}/portal/ativar?token=xyz`)
    expect(canonicalPortalUrl('/portal/ativar?token=xyz')).toBe(`${DEFAULT_PORTAL_URL}/portal/ativar?token=xyz`)
    expect(canonicalPortalUrl('/recuperar-senha?token=abc')).toBe(`${DEFAULT_PORTAL_URL}/portal/recuperar-senha?token=abc`)
    expect(canonicalPortalUrl('billing')).toBe(`${DEFAULT_PORTAL_URL}/portal/billing`)
  })

  it('retorna e-mail padrão do Portal Fwlog', () => {
    expect(portalSupportEmail()).toBe(DEFAULT_PORTAL_SUPPORT_EMAIL)
    expect(portalSupportEmail()).toBe('suporte@portalfwlog.com.br')
  })
})
