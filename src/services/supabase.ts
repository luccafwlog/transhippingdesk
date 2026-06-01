import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const fallbackSupabaseUrl = 'http://127.0.0.1:54321'
const fallbackSupabaseAnonKey = 'missing-supabase-anon-key'

export const isSupabaseConfigured = Boolean(supabaseUrl) && Boolean(supabaseAnonKey)

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[supabase] VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias. ' +
      'Configure o arquivo .env antes de iniciar a aplicação.',
  )
}

export const supabase = createClient<Database>(supabaseUrl ?? fallbackSupabaseUrl, supabaseAnonKey ?? fallbackSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
