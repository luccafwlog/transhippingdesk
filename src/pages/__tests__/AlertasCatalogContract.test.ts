import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTITY_TYPE_LABELS, TYPE_LABELS } from '../../services/alerts'

const migration317 = readFileSync(resolve(process.cwd(), 'supabase/migrations/317_alerts_foundation_catalog.sql'), 'utf8')
const migration325 = readFileSync(resolve(process.cwd(), 'supabase/migrations/325_clientes_portal_disputes_alerts.sql'), 'utf8')

describe('Contrato do catálogo de alertas e tipos de entidade', () => {
  it('todo tipo ativo do alert_type_catalog possui rótulo definido em TYPE_LABELS', () => {
    const typeRegex = /^\s*\('([a-z0-9_]+)',\s*'(?:critical|normal)'/gm
    const foundTypes: string[] = []

    let match: RegExpExecArray | null
    while ((match = typeRegex.exec(migration317)) !== null) {
      foundTypes.push(match[1])
    }
    while ((match = typeRegex.exec(migration325)) !== null) {
      foundTypes.push(match[1])
    }

    expect(foundTypes.length).toBe(27)

    for (const catalogType of foundTypes) {
      expect(TYPE_LABELS[catalogType], `Tipo catalogado ${catalogType} não possui rótulo em TYPE_LABELS`).toBeDefined()
      expect(TYPE_LABELS[catalogType].length).toBeGreaterThan(0)
    }
  })

  it('todos os entity_types da §4 e do domínio possuem rótulo em ENTITY_TYPE_LABELS', () => {
    const requiredEntityTypes = [
      'invoice',
      'container',
      'bl',
      'granite_bl',
      'agency_departure_report',
      'voyage',
      'voyage_pod_schedule',
      'voyage_escala_terminal',
      'customer',
      'demurrage_invoice',
      'pix_transaction',
    ]

    for (const entityType of requiredEntityTypes) {
      expect(ENTITY_TYPE_LABELS[entityType], `Entity type ${entityType} não possui rótulo`).toBeDefined()
    }
  })
})
