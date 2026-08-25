// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ALERT_RULES } from '../../services/alertRulesCatalog'
import { AlertasRegras } from '../AlertasRegras'

const migration317 = readFileSync(resolve(process.cwd(), 'supabase/migrations/317_alerts_foundation_catalog.sql'), 'utf8')
const migration325 = readFileSync(resolve(process.cwd(), 'supabase/migrations/325_clientes_portal_disputes_alerts.sql'), 'utf8')
const typeRegex = /^\s*(?:VALUES\s+)?\('([a-z0-9_]+)',\s*'(?:critical|normal)'/gm

function activeCatalogTypes() {
  return [migration317, migration325].flatMap((migration) => Array.from(migration.matchAll(typeRegex), (match) => match[1]))
}

afterEach(cleanup)

describe('Regras de Alertas', () => {
  it('mantém um verbete educativo para cada tipo ativo do catálogo SQL', () => {
    const types = activeCatalogTypes()

    expect(types).toHaveLength(28)
    expect(ALERT_RULES).toHaveLength(types.length)
    expect(new Set(ALERT_RULES.map((rule) => rule.type))).toEqual(new Set(types))

    for (const rule of ALERT_RULES) {
      expect(rule.summary).toBeTruthy()
      expect(rule.trigger).toBeTruthy()
      expect(rule.timing).toBeTruthy()
      expect(rule.resolution).toBeTruthy()
      expect(rule.destination.startsWith('/')).toBe(true)
      expect(rule.dismissal).toContain('motivo obrigatório')
    }
  })

  it('filtra o catálogo por domínio e mantém a regra selecionável', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    expect(screen.getByText('28 regras encontradas')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Domínio' }), { target: { value: 'Portal' } })

    expect(screen.getByText('8 regras encontradas')).toBeTruthy()
    expect(screen.getByRole('option', { name: /Portal do Cliente — convite expirado/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Baplie ausente/ })).toBeNull()
  })

  it('abre uma regra por deep-link e aponta para a tela de tratamento', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras?regra=voyage_baplie_missing']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Baplie ausente' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Abrir tela de resolução/ }).getAttribute('href')).toBe('/baplie')
  })
})
