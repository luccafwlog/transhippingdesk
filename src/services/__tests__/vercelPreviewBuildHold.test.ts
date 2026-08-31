import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script de build em JS puro, sem tipos gerados.
import { resolvePreviewHoldReason } from '../../../scripts/vercel-build.mjs'

const SUPABASE_ENV = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }

describe('página de espera do Preview do Vercel (ADR 0056)', () => {
  it('segura o build só no Preview e só quando falta variável do Supabase', () => {
    expect(resolvePreviewHoldReason({ VERCEL: '1', VERCEL_ENV: 'preview' })).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
    ])
    expect(resolvePreviewHoldReason({ VERCEL: '1', VERCEL_ENV: 'preview', ...SUPABASE_ENV })).toBeNull()
    expect(
      resolvePreviewHoldReason({ VERCEL: '1', VERCEL_ENV: 'preview', VITE_SUPABASE_URL: 'https://x.supabase.co' }),
    ).toEqual(['VITE_SUPABASE_ANON_KEY'])
  })

  it('nunca segura o build de Production nem fora do Vercel — lá o guard continua falhando alto', () => {
    expect(resolvePreviewHoldReason({ VERCEL: '1', VERCEL_ENV: 'production' })).toBeNull()
    expect(resolvePreviewHoldReason({})).toBeNull()
  })

  it('mantém o vercel.json apontando para o wrapper e força build em SHA repetido', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../../../vercel.json'), 'utf-8'))
    expect(config.buildCommand).toBe('node scripts/vercel-build.mjs')
    expect(config.ignoreCommand).toMatch(/\[ "\$p" = "\$c" \] && exit 1/)
    expect(config.ignoreCommand).toContain('git diff --quiet "$p" "$c" -- .')
    expect(config.ignoreCommand.length).toBeLessThanOrEqual(256)
  })
})
