import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Auditoria 2026-08-14, achado A-03: `ALTER FUNCTION ... RENAME TO` preserva o
// ACL. As 13 RPCs renomeadas para `*_legacy` pela 292 herdaram o GRANT a `anon`
// e `authenticated` e ficaram fora do bloco de revoke daquela migration, que só
// casa `portal_inspect_%` e `_portal_%_core`. A 296 fecha isso.
describe('ACL das funções *_legacy (migration 296)', () => {
  const read = (file: string) =>
    fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', file), 'utf8')

  const migration = read('296_revoke_legacy_portal_functions.sql')
  const inspection = read('292_portal_inspection.sql')

  // O cabeçalho da 296 cita GRANTs em prosa (o ACL herdado e o rollback). Só o SQL
  // executável conta para as travas de "não concede de volta".
  const sql = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  it('revoga PUBLIC, anon e authenticated de toda função *_legacy de public', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/,
    )
    expect(migration).toMatch(/nspname = 'public'/)
    expect(migration).toMatch(/proname LIKE '%\\_legacy'/)
  })

  // O revoke em laço é silencioso por natureza: se o padrão de nome mudar, ele
  // aplica zero linhas e a migration passa dando a impressão de ter fechado o ACL.
  it('falha em vez de virar no-op quando nenhuma função casa o padrão', () => {
    expect(migration).toMatch(/IF v_count = 0 THEN/)
    expect(migration).toMatch(/RAISE EXCEPTION/)
  })

  it('não concede nada de volta a anon nem a authenticated', () => {
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/)
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\bauthenticated\b/)
  })

  // Trava de escopo: a 296 é só de grants. Criar, substituir ou remover função
  // aqui misturaria rollback de contrato com fechamento de ACL.
  it('não cria, substitui nem remove função', () => {
    expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION/)
    expect(sql).not.toMatch(/DROP FUNCTION/)
  })

  // Prova a premissa do achado: a 292 realmente deixa nomes `*_legacy` fora do
  // seu próprio revoke. Se um dia ela passar a cobri-los, este teste avisa que a
  // 296 virou redundante em vez de deixá-la sobrevivendo sem motivo.
  it('a 292 renomeia para *_legacy sem revogar esses nomes', () => {
    expect(inspection).toMatch(/RENAME TO [a-z_]*_legacy/)
    expect(inspection).not.toMatch(/REVOKE[^;]*_legacy/)
  })
})
