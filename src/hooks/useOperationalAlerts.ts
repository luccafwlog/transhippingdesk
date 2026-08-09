import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'

export interface OperationalAlerts {
  demurrageOverdue: number
}

export function useOperationalAlerts(): OperationalAlerts {
  const demurrageOverdue = useQuery({
    queryKey: ['header-alert', 'demurrage-overdue'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bl_containers')
        .select('*', { count: 'exact', head: true })
        .eq('demurrage_status', 'overdue')
      if (error) return 0
      return count ?? 0
    },
    staleTime: 5 * 60_000,
  })

  return {
    demurrageOverdue: demurrageOverdue.data ?? 0,
  }
}
