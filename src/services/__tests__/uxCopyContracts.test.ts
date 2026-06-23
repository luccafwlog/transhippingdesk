import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('does not promise unsupported schedule confirmation or update times', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/portal/ShipScheduleWidget.tsx'), 'utf8')
  expect(source).not.toContain('Evento confirmado')
  expect(source).not.toContain('Atualização diária às 09:00')
  expect(source).toContain('data programada já alcançada')
  expect(source).toContain('Atualizado conforme os dados publicados')
})

it('uses neutral report-limit copy instead of claiming one global limit', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Relatorios.tsx'), 'utf8')
  expect(source).not.toContain('Limite de 2.000 linhas por consulta')
  expect(source).toContain('Cada visão informa seu próprio limite')
})

it('exposes the audit author filter and clears it with the other filters', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/AdminUsuarios.tsx'), 'utf8')
  expect(source).toContain('Autor (ID)')
  expect(source).toContain('value={logFilters.changedBy}')
  expect(source).toContain('logFilters.entityType || logFilters.changedBy || logFilters.dateFrom || logFilters.dateTo')
})

it('distinguishes schedule export query failures from empty results', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/ChegadasSaidas.tsx'), 'utf8')
  expect(source).toContain('const { data, error } = await supabase.from(\'vessel_schedules\')')
  expect(source).toContain('Falha ao carregar os navios para gerar o modelo.')
  expect(source).toContain('const { data, error } = await supabase.from(\'ended_vessels\')')
  expect(source).toContain('Falha ao carregar os navios encerrados.')
})

it('only exposes Baplie import and reimport controls to administrators', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/Baplie.tsx'), 'utf8')
  expect(source).toContain('const { user, isAdmin } = useAuth()')
  expect(source).toContain('<StateA canImport={isAdmin}')
  expect(source).toContain('{isAdmin ? (')
  expect(source).toContain('A importacao Baplie exige perfil administrativo.')
})
