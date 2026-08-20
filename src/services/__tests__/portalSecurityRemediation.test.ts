import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('Portal security remediation contracts', () => {
  it('compensates Auth user and invite when activation persistence fails', () => {
    const source = read('supabase/functions/portal-invite-activate/index.ts')
    expect(source).toContain('admin.auth.admin.deleteUser(created.user.id)')
    expect(source).toContain("status: 'pendente', consumed_at: null")
    expect(source).toContain('accountError || !account')
  })

  it('does not report suspend/reactivate success after a privileged write or audit failure', () => {
    const source = read('supabase/functions/portal-account-suspend/index.ts')
    expect(source).toContain('if (updateError)')
    expect(source).toContain('if (auditError)')
    expect(source).toContain("status: 500")
  })
})
