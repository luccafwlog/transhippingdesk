import { supabase } from './supabase'
import { reportBestEffortFailure } from '../lib/telemetry'

export type DeletedEntityType = 'bl' | 'container' | 'vehicle' | 'customer'

/**
 * Registra exclusoes em `audit_logs` (insert-only) para rastreabilidade de quem
 * excluiu o que e quando. Best-effort: uma falha de telemetria nunca deve
 * interromper a exclusao em si. Nada e registrado quando nao ha autor conhecido
 * (ex: chamadas de teste sem `changedBy`).
 */
export async function logDeletions(
  entityType: DeletedEntityType,
  ids: Array<string | number>,
  changedBy?: string | null,
) {
  if (!changedBy || ids.length === 0) return

  const payload = ids.map((id) => ({
    entity_type: entityType,
    entity_id: String(id),
    field_name: 'deleted',
    old_value: String(id),
    new_value: null,
    changed_by: changedBy,
    justification: 'exclusao manual',
  }))

  const { error } = await supabase.from('audit_logs').insert(payload)
  if (error) {
    reportBestEffortFailure('registrar exclusao em audit_logs', error, { entityType, count: ids.length })
  }
}
