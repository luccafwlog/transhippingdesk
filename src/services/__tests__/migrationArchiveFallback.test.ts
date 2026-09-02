import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

describe('migrationArchiveFallback (test harness)', () => {
  it('consegue ler migrations históricas via caminho de migrations mesmo com fallback para archive', () => {
    const filePath = path.resolve(process.cwd(), 'supabase/migrations/001_schema.sql')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('CREATE TABLE')
  })

  it('lista migrations históricas via readdirSync no diretório de migrations', () => {
    const dir = path.resolve(process.cwd(), 'supabase/migrations')
    const files = readdirSync(dir)
    expect(files).toContain('001_schema.sql')
    expect(files).toContain('384_comunicados_automacao_falhas.sql')
  })
})
