import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Alertas — segurança do ciclo de renderização', () => {
  it('deriva a página por departamento, sem setState durante o render', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/Alertas.tsx'), 'utf8')

    expect(page).toContain('const page = pagination.department === departmentFilter ? pagination.page : 0')
    expect(page).toContain('setPage(0)')
    expect(page).not.toContain('const [prevDept, setPrevDept]')
    expect(page).not.toContain('if (prevDept !== departmentFilter)')
  })
})
