import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('useOperationalCounts realtime contract', () => {
  it('does not open a channel for alerts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/useOperationalCounts.ts'), 'utf8')
    expect(source).not.toContain('supabase.channel')
    expect(source).toContain('staleTime: 60_000')
    expect(source).toContain('countAlertQueue')
    expect(source).not.toContain(".from('alerts')")
  })
})
