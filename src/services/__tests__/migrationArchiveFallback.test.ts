import { describe, it, expect } from 'vitest'
import nodeFs, { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import legacyFs from 'fs'
import path from 'node:path'

describe('migrationArchiveFallback (test harness)', () => {
  it('intercepta leituras tanto por named imports quanto por default import (node:fs e fs)', () => {
    const archiveOnlyRel = 'supabase/migrations/README.md'
    const archiveOnlyAbs = path.resolve(process.cwd(), archiveOnlyRel)

    // Caminho só existe em supabase/migrations_archive/README.md, não em supabase/migrations/
    expect(existsSync(archiveOnlyAbs)).toBe(true)
    expect(nodeFs.existsSync(archiveOnlyAbs)).toBe(true)
    expect(legacyFs.existsSync(archiveOnlyAbs)).toBe(true)

    const contentNamed = readFileSync(archiveOnlyAbs, 'utf8')
    const contentNodeDefault = nodeFs.readFileSync(archiveOnlyAbs, 'utf8')
    const contentLegacyDefault = legacyFs.readFileSync(archiveOnlyAbs, 'utf8')

    expect(contentNamed).toContain('Arquivo Histórico de Migrações')
    expect(contentNodeDefault).toBe(contentNamed)
    expect(contentLegacyDefault).toBe(contentNamed)

    const statNamed = statSync(archiveOnlyAbs)
    const statNodeDefault = nodeFs.statSync(archiveOnlyAbs)
    expect(statNamed.size).toBeGreaterThan(0)
    expect(statNodeDefault.size).toBe(statNamed.size)
  })

  it('lista migrations históricas via readdirSync e filtra arquivos não-SQL do arquivo morto', () => {
    const dir = path.resolve(process.cwd(), 'supabase/migrations')

    const filesNamed = readdirSync(dir)
    const filesDefault = nodeFs.readdirSync(dir)

    expect(filesNamed).toContain('001_schema.sql')
    expect(filesNamed).toContain('384_comunicados_automacao_falhas.sql')
    // README.md do migrations_archive não deve vazar para a listagem de migrations ativas
    expect(filesNamed).not.toContain('README.md')
    expect(filesDefault).toEqual(filesNamed)
  })

  it('a união inclui os arquivos ativos: um futuro 005 seria auditado, não invisível', () => {
    const dir = path.resolve(process.cwd(), 'supabase/migrations')

    const files = readdirSync(dir)
    expect(files).toContain('001_initial_schema.sql')
    expect(files).toContain('002_business_logic_and_security.sql')
    expect(files).toContain('003_pos_squash_objetos_fora_do_dump.sql')
    expect(files).toContain('004_vazios_delete_baplie_grant.sql')

    // Leitura de arquivo ativo lê o ativo, sem fallback para o morto
    const active = readFileSync(path.join(dir, '001_initial_schema.sql'), 'utf8')
    expect(active).toContain('Schema Inicial v1.0')
    expect(active).not.toContain('001_schema.sql')
  })

  it('suporta opção withFileTypes em readdirSync', () => {
    const dir = path.resolve(process.cwd(), 'supabase/migrations')
    const dirents = readdirSync(dir, { withFileTypes: true })

    const names = dirents.map((d) => (typeof d === 'string' ? d : d.name))
    expect(names).toContain('001_schema.sql')
    expect(names).not.toContain('README.md')
  })

  it('preserva comportamento padrão para arquivos fora de supabase/migrations', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    expect(nodeFs.existsSync(pkgPath)).toBe(true)

    const nonexistent = path.resolve(process.cwd(), 'nonexistent_file_xyz_123.tmp')
    expect(existsSync(nonexistent)).toBe(false)
    expect(nodeFs.existsSync(nonexistent)).toBe(false)
  })
})

