import { supabase, supabasePortal } from './supabase'
import type { PortalSessionOverview } from './portalBilling'

export type PortalScope = {
  mode: 'client' | 'inspect'
  customerId: number | null
  overview: PortalSessionOverview | null
  basePath: string
}

export const clientPortalScope: PortalScope = {
  mode: 'client',
  customerId: null,
  overview: null,
  basePath: '/portal',
}

export const portalWriteRpcNames = new Set([
  'portal_open_demurrage_dispute',
  'portal_update_profile',
  'portal_create_consolidation',
  'portal_obsolete_consolidation',
  'portal_mark_notification_read',
  'portal_mark_all_notifications_read',
])

export function portalPath(scope: PortalScope, suffix = '') {
  if (!suffix) return scope.basePath
  return `${scope.basePath}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
}

export function inspectionRpcArgs(scope: PortalScope, args: Record<string, unknown> = {}) {
  return scope.mode === 'inspect' ? { p_customer_id: scope.customerId, ...args } : args
}

export async function openPortalInspection(customerId: number, origin: string | null) {
  const result = await (supabase as unknown as { rpc: (rpc: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc('portal_open_inspection', { p_customer_id: customerId, p_origin: origin })
  if (result.error) throw result.error
  return result.data as PortalSessionOverview
}

export async function callPortalRpc<T = unknown>(scope: PortalScope, name: string, args: Record<string, unknown> = {}) {
  if (scope.mode === 'inspect' && portalWriteRpcNames.has(name)) {
    throw new Error('Ação do cliente indisponível em Modo Inspeção.')
  }

  const client = scope.mode === 'inspect' ? supabase : supabasePortal
  const rpcName = scope.mode === 'inspect' && name !== 'portal_ship_schedule' ? `portal_inspect_${name.replace(/^portal_/, '')}` : name
  const rpc = (client as unknown as { rpc: (rpc: string, params?: Record<string, unknown>) => Promise<{ data: T | null; error: unknown }> }).rpc
  const rpcArgs = inspectionRpcArgs(scope, args)
  const result = Object.keys(rpcArgs).length
    ? await rpc.call(client, rpcName, rpcArgs)
    : await rpc.call(client, rpcName)
  if (result.error) throw result.error
  return result.data
}
