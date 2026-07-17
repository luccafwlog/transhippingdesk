import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/199_drop_import_manifest_cntr_rpc.sql',
)

type DroppedFunction = {
  name: string
  argumentTypes: string[]
}

const parseDroppedFunctions = (sql: string): DroppedFunction[] =>
  sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => /^DROP\s+FUNCTION\s+IF\s+EXISTS\b/i.test(statement))
    .map((statement) => {
      const declaration = statement
        .replace(/^DROP\s+FUNCTION\s+IF\s+EXISTS\s+/i, '')
        .trim()
      const openingParenthesis = declaration.indexOf('(')
      const closingParenthesis = declaration.lastIndexOf(')')

      if (
        openingParenthesis <= 0 ||
        closingParenthesis !== declaration.length - 1
      ) {
        throw new Error(`Invalid DROP FUNCTION declaration: ${statement}`)
      }

      return {
        name: declaration.slice(0, openingParenthesis).trim().toLowerCase(),
        argumentTypes: declaration
          .slice(openingParenthesis + 1, closingParenthesis)
          .split(',')
          .map((type) => type.trim().replace(/\s+/g, ' ').toUpperCase()),
      }
    })

const historicalSignature = [
  'TEXT',
  'BIGINT',
  'UUID',
  'TEXT',
  'TEXT',
  'INTEGER',
  'INTEGER',
  'JSONB',
  'JSONB',
  'JSONB',
  'JSONB',
  'JSONB',
  'JSONB',
]

describe('199 drop Manifesto CNTR RPC migration contract', () => {
  it('drops the historical and active post-process signatures in migration order', () => {
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, 'utf8')
      : ''

    // Migration 129 defined 13 arguments. Migration 165 removed that signature
    // and recreated the active RPC with BOOLEAN as its fourteenth argument.
    expect(parseDroppedFunctions(sql)).toEqual([
      {
        name: 'public.import_manifest_with_postprocess_transactional',
        argumentTypes: historicalSignature,
      },
      {
        name: 'public.import_manifest_with_postprocess_transactional',
        argumentTypes: [...historicalSignature, 'BOOLEAN'],
      },
    ])
  })

  it('does not drop any other import RPC', () => {
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, 'utf8')
      : ''
    const droppedFunctions = parseDroppedFunctions(sql)

    expect(droppedFunctions).toHaveLength(2)
    expect(
      droppedFunctions.every(
        ({ name }) =>
          name === 'public.import_manifest_with_postprocess_transactional',
      ),
    ).toBe(true)
    expect(
      droppedFunctions.some(
        ({ name }) => name === 'public.import_manifest_transactional',
      ),
    ).toBe(false)
  })
})
