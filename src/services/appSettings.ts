import { supabase } from './supabase'
import type { AppSettings } from '../types/database'

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) throw error
  return data
}

export async function setCommunicationsEnabled(enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_communications_enabled', {
    p_enabled: enabled,
  })

  if (error) throw error
  return data
}

export async function setDemurrageDunningIntervalDays(days: number): Promise<number> {
  const { data, error } = await supabase.rpc('set_demurrage_dunning_interval_days', {
    p_days: days,
  })

  if (error) throw error
  return data
}
