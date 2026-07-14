export async function revokePortalSessions(userId: string): Promise<void> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!baseUrl || !serviceRoleKey) throw new Error('Supabase admin credentials are unavailable')
  const response = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}/logout`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw new Error(`Could not revoke portal sessions (HTTP ${response.status})`)
}
