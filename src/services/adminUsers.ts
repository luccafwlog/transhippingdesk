import { supabase } from './supabase'
import type { UserProfile } from '../types/database'

export async function listAllUserProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('full_name')
  if (error) throw error
  return (data ?? []) as UserProfile[]
}

export async function updateUserProfile(
  id: string,
  updates: { role?: 'admin' | 'operator'; active?: boolean },
): Promise<void> {
  const { error } = await supabase.from('user_profiles').update(updates).eq('id', id)
  if (error) throw error
}
