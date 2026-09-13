import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPANY } from '../../config/company'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const relativeBrandBoundaryFiles = [
  'supabase/functions/_shared/portalEmailTemplates.ts',
  'src/services/customerCommunicationTemplates.ts',
  'src/components/layout/PortalLayout.tsx',
  'src/components/billing/InvoiceDocumentLocal.tsx',
  'src/components/demurrage/InvoiceDocument.tsx',
  'src/components/demurrage/CustomerSummaryReport.tsx',
  'src/components/voyages/AgencyReportDocument.tsx',
  ...readdirSync(path.join(repositoryRoot, 'src/pages'))
    .filter((fileName) => /^Portal.*\.tsx$/.test(fileName))
    .map((fileName) => path.join('src/pages', fileName)),
]

describe('fronteira de marca entre Vela, Portal e documentos fiscais', () => {
  it('não entrega a marca interna Vela na superfície do cliente ou fiscal', () => {
    for (const relativePath of relativeBrandBoundaryFiles) {
      const content = readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
      expect(content, relativePath).not.toMatch(/\bvela\b/i)
    }
  })

  it('preserva o nome do beneficiário PIX da entidade jurídica', () => {
    expect(COMPANY.pixMerchantName).toBe('TRANSHIPPING AGENCIAMENTO MARITIMO')
  })
})
