import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MOJIBAKE = /Ã§|Ã£|Ã¡|Ã­|Ã©|Ãª|Ã³|Ãµ|â€"|â€¦|â†'|Â·/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('encoding do código-fonte', () => {
  it('nenhum arquivo de src/ contém mojibake de UTF-8 lido como cp1252', () => {
    const offenders = sourceFiles('src').filter((file) => !file.endsWith('encoding.test.ts') && MOJIBAKE.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
