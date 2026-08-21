import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('ValidacaoTab delegates Granite batch actions to the canonical workflow', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/billing/ValidacaoTab.tsx'),
    'utf8',
  )

  expect(source).toMatch(
    /import\s+\{\s*runGraniteBatch\s*\}\s+from\s+['"]\.\.\/\.\.\/services\/graniteBillingWorkflow['"]/,
  )
  expect(source).not.toMatch(/function\s+runGraniteBatch\s*\(/)
  expect(source).not.toContain("if (action === 'review') {\n      return { total: ids.length, successCount: ids.length")
  expect(source).not.toContain("runGraniteBatch(graniteIds, action)")
  expect(source).toContain('runGraniteBatch(graniteIds)')
})
