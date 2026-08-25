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
const migration338 = readFileSync(resolve(process.cwd(), 'supabase/migrations/338_alerts_review_hardening.sql'), 'utf8')
const migration326 = readFileSync(resolve(process.cwd(), 'supabase/migrations/326_voyage_operation_alerts.sql'), 'utf8')
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
    expect(screen.getByRole('button', { name: /Portal do Cliente — convite expirado/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Baplie ausente/ })).toBeNull()
  })

  it('combina filtros no topo e limpa a combinação sem perder a regra selecionada', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Domínio' }), { target: { value: 'Portal' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Gravidade' }), { target: { value: 'critical' } })

    expect(screen.getByText('3 regras encontradas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Portal do Cliente — convite expirado/ })).toBeNull()

    const clearButton = screen.getByRole('button', { name: 'Limpar filtros' })
    expect((clearButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(clearButton)

    expect(screen.getByText('28 regras encontradas')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Domínio' }) as HTMLSelectElement).value).toBe('all')
    expect((screen.getByRole('combobox', { name: 'Gravidade' }) as HTMLSelectElement).value).toBe('all')
    expect((screen.getByRole('button', { name: 'Limpar filtros' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('abre uma regra por deep-link e aponta para a tela de tratamento', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras?regra=voyage_baplie_missing']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Baplie ausente' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Regras de alertas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Baplie ausente/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: /Abrir tela de resolução/ }).getAttribute('href')).toBe('/baplie')
  })

  it('mantém as entidades e o destino dinâmico dos detectores mais específicos', () => {
    const exportRule = ALERT_RULES.find((rule) => rule.type === 'voyage_export_after_atd')
    const scheduleRule = ALERT_RULES.find((rule) => rule.type === 'voyage_schedule_date_pending')
    const reprocessRule = ALERT_RULES.find((rule) => rule.type === 'portal_reprocessamento_falhou')

    expect(exportRule?.entityType).toBe('voyage_pod_schedule')
    expect(migration338).toContain("'voyage_export_after_atd', 'voyage_pod_schedule'")
    expect(scheduleRule?.trigger).toContain('ETD é a previsão compartilhada da escala')
    expect(migration326).toContain("'voyage_schedule_date_pending',\n      'voyage_pod_schedule'")
    expect(reprocessRule?.destination).toBe('/manifestos')
    expect(reprocessRule?.destinationNote).toContain('/manifestos/{id}?tab=faturamento')
    expect(migration325).toContain("'/manifestos/' || v_bl.id || '?tab=faturamento'")
  })
})
