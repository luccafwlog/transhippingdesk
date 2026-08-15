import type { PortalDb } from './portalDb.ts'

export type PortalAlertInput = {
  type: string
  entityType: string
  entityId: string
  message: string
}

// `alerts` não tem restrição de unicidade geral (migration 001), então quem
// insere é quem precisa deduplicar. Sem isso, cada bounce do mesmo endereço
// abria mais um alerta para o mesmo Cliente e a fila do operador virava
// histórico.
//
// O predicado é `status <> 'closed'`, e não `status = 'open'`: é a regra que o
// login já usava e que o plano pediu para preservar. Ela é mais forte — um
// alerta apenas reconhecido (`acknowledged`) continua segurando o duplicado,
// porque o operador já o viu e ainda não o resolveu. Uma regra só, nos dois
// chamadores, em vez de um predicado por call site.
//
// A consulta sozinha não deduplica: entre ela e o INSERT não há nada segurando
// a linha, e os dois chamadores são justamente os que chegam em rajada (um
// evento do Resend por destinatário; um disparo por tentativa da rajada que
// bloqueou o login). Quem garante a regra é o índice único parcial da migration
// 303, com o mesmo predicado; a consulta continua aqui como caminho rápido, e o
// `23505` é o desfecho normal da corrida perdida — não um erro a propagar.
const CONFLITO_DE_UNICIDADE = '23505'

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
  const { error } = await db
    .from('alerts')
    .insert({ type: input.type, entity_type: input.entityType, entity_id: input.entityId, message: input.message, status: 'open' })
    .select('id')
    .maybeSingle()
  if (error) {
    if ((error as { code?: string }).code === CONFLITO_DE_UNICIDADE) return 'ja_aberto'
    throw error
  }
  return 'aberto'
}
