import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { portalWriteRpcNames } from '../portalScope'

describe('Contratos negativos das telas e fronteira do Portal do Cliente', () => {
  it('Step 1: /perfil projeta identidade e não chama produtores de alerta ou notificação', () => {
    const profileContent = readFileSync(resolve(process.cwd(), 'src/pages/Profile.tsx'), 'utf8')
    expect(profileContent).not.toContain('createAlert')
    expect(profileContent).not.toContain('upsert_alert')
    expect(profileContent).not.toContain('dismissAlertItem')
    expect(profileContent).not.toContain('resolveAlertItem')
    expect(profileContent).not.toContain('alert_items')
    expect(profileContent).not.toContain('internal_notifications')
  })

  it('Step 2: /line-up-tv/display não produz evento e o sino não é montado nele (fora do AppLayout)', () => {
    const tvDisplayContent = readFileSync(resolve(process.cwd(), 'src/pages/LineUpTVDisplay.tsx'), 'utf8')
    expect(tvDisplayContent).not.toContain('createAlert')
    expect(tvDisplayContent).not.toContain('dismissAlertItem')
    expect(tvDisplayContent).not.toContain('InternalNotificationBell')

    const appContent = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const displayIndex = appContent.indexOf('path="/line-up-tv/display"')
    const appLayoutIndex = appContent.indexOf('<Route element={<AppLayout />}>')
    expect(displayIndex).toBeGreaterThan(-1)
    expect(appLayoutIndex).toBeGreaterThan(-1)
    // /line-up-tv/display está montado antes e fora do AppLayout
    expect(displayIndex).toBeLessThan(appLayoutIndex)
  })

  it('Step 3: /login interno não registra tentativa, bloqueio ou alerta de abuso (decisão 4 da §6)', () => {
    const loginContent = readFileSync(resolve(process.cwd(), 'src/pages/Login.tsx'), 'utf8')
    expect(loginContent).not.toContain('portal_abuso_login')
    expect(loginContent).not.toContain('createAlert')
    expect(loginContent).not.toContain('upsert_alert')
    expect(loginContent).not.toContain('login_attempts')
  })

  it('Step 4: Fronteira do Portal — portalScope não alcança RPCs ou tabelas de alertas internos', () => {
    const forbiddenInternalRpcs = [
      'list_alert_queue',
      'count_alert_queue',
      'list_internal_notifications',
      'mark_internal_notification_read',
      'dismiss_alert_item',
      'upsert_alert_item',
      'resolve_alert_item',
      'summarize_alert_queue_by_department',
      'count_unread_internal_notifications',
      'mark_all_internal_notifications_read',
    ]

    for (const rpc of forbiddenInternalRpcs) {
      expect(portalWriteRpcNames.has(rpc), `RPC interna ${rpc} não deve existir em portalWriteRpcNames`).toBe(false)
    }

    const portalScopeContent = readFileSync(resolve(process.cwd(), 'src/services/portalScope.ts'), 'utf8')
    for (const rpc of forbiddenInternalRpcs) {
      expect(portalScopeContent).not.toContain(`'${rpc}'`)
    }

    const portalBillingContent = readFileSync(resolve(process.cwd(), 'src/services/portalBilling.ts'), 'utf8')
    expect(portalBillingContent).not.toContain('alert_items')
    expect(portalBillingContent).not.toContain('alert_item_dismissals')
    expect(portalBillingContent).not.toContain('alert_notification_failures')
    expect(portalBillingContent).not.toContain('list_alert_queue')
  })
})
