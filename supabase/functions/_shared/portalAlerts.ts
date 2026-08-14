import type { PortalDb } from './portalDb.ts'

export type PortalAlertInput = {
  type: string
  entityType: string
  entityId: string
  message: string
}

// `alerts` não tem restrição de unicidade (migration 001), então quem insere é
// quem precisa deduplicar. Sem isso, cada bounce do mesmo endereço abria mais
// um alerta para o mesmo Cliente e a fila do operador virava histórico.
//
// O predicado é `status <> 'closed'`, e não `status = 'open'`: é a regra que o
// login já usava e que o plano pediu para preservar. Ela é mais forte — um
// alerta apenas reconhecido (`acknowledged`) continua segurando o duplicado,
// porque o operador já o viu e ainda não o resolveu. Uma regra só, nos dois
// chamadores, em vez de um predicado por call site.
export async function openAlertOnce(db: PortalDb, input: PortalAlertInput): Promise<'aberto' | 'ja_aberto'> {
  const { data: existing } = await db
    .from('alerts')
    .select('id')
    .eq('type', input.type)
    .eq('entity_type', input.entityType)
    .eq('entity_id', input.entityId)
    .neq('status', 'closed')
    .limit(1)
    .maybeSingle()
  if (existing) return 'ja_aberto'
  await db
    .from('alerts')
    .insert({ type: input.type, entity_type: input.entityType, entity_id: input.entityId, message: input.message, status: 'open' })
    .select('id')
    .maybeSingle()
  return 'aberto'
}
